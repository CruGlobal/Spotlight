//Cru Connections (Salesforce) integration - replaces InfobaseConnection.gs.
//
//API docs live in the repo root: log-movement-stats-api.md, get-movements-api.md, stat-deep-link.md
//JIRA: INFO-406 (LogMovementStats), INFO-408 (GetMovements)
//
//THREE THINGS ARE DIFFERENT FROM THE INFOBASE PATH, AND EACH ONE CHANGES THE DESIGN:
//
// 1. LogMovementStats takes ONE MOVEMENT PER REQUEST. Infobase took a single batched
//    {"statistics":[...]}. So one POST becomes N, and N has to be bounded and parallelised.
//
// 2. Every call CREATES A NEW Staging_Activity__c. There is no upsert and no idempotency key.
//    Infobase's endpoint was keyed on activity_id + period, so re-posting the same week
//    overwrote. Here it would DOUBLE THE STATS. That is why submitMovementDataToConnections()
//    is per-row with a written ledger instead of a re-derived weekly aggregate: the old
//    getStatsForPeriod() had no record of what it had already sent, and its only guard was a
//    tries/date counter that permitted three attempts a day.
//
// 3. There is no period. Infobase took period_begin + period_end; this takes a single
//    activityDate. The reporting week becomes implicit in the row's own endDate.
//
//Seven of the fifteen Infobase fields have no home here (students_involved, faculty_involved,
//students_engaged, faculty_engaged, student_leaders, faculty_leaders, graduating_on_mission).
//Those are semester/quarterly figures and are entered through the deep link in lib.js, not here.

//---------------------------------------------------------------------------------------
// CONFIGURATION
//---------------------------------------------------------------------------------------

var SF_CLIENT_ID     = 'sf.clientId';
var SF_CLIENT_SECRET = 'sf.clientSecret';
var SF_LOGIN_URL     = 'sf.loginUrl';      //e.g. https://mycru--uat.sandbox.my.salesforce.com
var SF_DRY_RUN       = 'sf.dryRun';        //'true' builds and logs payloads without sending them
var SF_CUTOVER_DATE  = 'sf.cutoverDate';   //yyyy-MM-dd - rows dated before this are never sent

//Column added to the Responses sheet. This is the idempotency ledger and the ONLY thing standing
//between a re-run and duplicated stats, so it is created on demand and never cleared automatically.
var CONNECTIONS_SENT_COLUMN = 'connectionsSent';

//Bounds the blast radius of a misconfiguration. At roughly half a second per request a run of 500
//sits inside the 6 minute execution limit with room to spare; anything left over is picked up on
//the next run, because unmarked rows stay eligible.
var CONNECTIONS_MAX_PER_RUN = 500;
var CONNECTIONS_CHUNK_SIZE = 50;   //requests per fetchAll call

var CONNECTIONS_TOKEN_CACHE_KEY = 'sf_access_token';
var CONNECTIONS_TOKEN_TTL_SECONDS = 1800;  //30 min. Salesforce sessions outlive this; a short TTL
                                           //just means a cheap re-auth rather than a run of 401s.

//The Responses sheet's question ids ARE the Infobase field names - that is how the old
//INFOBASE_VALID allow-list worked. Translate rather than rename: a rename would orphan every
//historical column in the sheet, and writeCacheToSheets() never deletes a column once created.
var CONNECTIONS_FIELD_MAP = {
  'spiritual_conversations':   'spiritualConversations',
  'holy_spirit_presentations': 'holySpiritPresentations',
  'personal_evangelism':       'personalEvangelism',
  'personal_decisions':        'personalEvangelismDecisions',
  'group_evangelism':          'groupEvangelism',
  'group_decisions':           'groupEvangelismDecisions',
  'media_exposures':           'mediaExposures',
  'media_decisions':           'mediaExposuresDecisions'
};

//THE OTHER 15 STAT COLUMNS ARE ABSENT ON PURPOSE. DO NOT ADD THEM.
//
//The Responses sheet carries 23 stat columns; the 8 above are the only ones Connections accepts.
//These are the rest:
//
//  gospel_conversations            discipleship_conversations   bible_study_sessions
//  bible_study_sessions_christian  bible_study_sessions_seeker   evangelistic_initiations
//  corporate_prayer                cultivate_partnerships        spiritual_health
//  students_with_staff_evangelism  content_uses                  reach
//  contacts                        hot_contacts                  involved_students
//
//They are deliberately Spotlight-only measures, reported through the existing Looker report, and
//they never went to Infobase either - not one of them was in the old INFOBASE_VALID allow-list.
//Adding one here would not make Connections store it.
//
//involved_students deserves a second look before anyone "corrects" it: it is NOT Infobase's
//students_involved. Similar name, different question id, intentionally Spotlight-only.
//
//Conversely, the seven Infobase fields with no Connections equivalent - students_involved,
//faculty_involved, students_engaged, faculty_engaged, student_leaders, faculty_leaders,
//graduating_on_mission - are not columns in this sheet at all, so nothing is lost by their
//absence here. They are semester/quarterly figures, entered through the deep link in lib.js.

//---------------------------------------------------------------------------------------
// CREDENTIALS
//
// Same menu-prompt shape as the Infobase setKey/setURL it replaces, so the operational habit
// carries over. The secret is only ever written, never displayed or emailed.
//---------------------------------------------------------------------------------------

function setConnectionsCredentials(){
  var ui = SpreadsheetApp.getUi();
  var id = ui.prompt('Salesforce Connected App - Consumer Key (client_id)', ui.ButtonSet.OK);
  var secret = ui.prompt('Salesforce Connected App - Consumer Secret (client_secret)', ui.ButtonSet.OK);
  var login = ui.prompt('Salesforce login URL, no trailing slash. '
                      + 'UAT: https://mycru--uat.sandbox.my.salesforce.com  '
                      + 'Prod: https://mycru.my.salesforce.com', ui.ButtonSet.OK);

  SCRIPT_PROP.setProperty(SF_CLIENT_ID, id.getResponseText().trim());
  SCRIPT_PROP.setProperty(SF_CLIENT_SECRET, secret.getResponseText().trim());
  SCRIPT_PROP.setProperty(SF_LOGIN_URL, login.getResponseText().trim().replace(/\/+$/, ''));
  clearConnectionsToken();

  //Deliberately reports the login URL but not the key or secret.
  GmailApp.sendEmail(MAINTAINER_EMAIL, 'Server: Connections credentials set',
                     'Connected App credentials were set for ' + getConnectionsLoginUrl());
}

function deleteConnectionsCredentials(){
  SCRIPT_PROP.deleteProperty(SF_CLIENT_ID);
  SCRIPT_PROP.deleteProperty(SF_CLIENT_SECRET);
  SCRIPT_PROP.deleteProperty(SF_LOGIN_URL);
  clearConnectionsToken();
  GmailApp.sendEmail(MAINTAINER_EMAIL, 'Server: Connections credentials deleted',
                     'Connected App credentials were deleted');
}

function getConnectionsLoginUrl(){
  return SCRIPT_PROP.getProperty(SF_LOGIN_URL);
}

//The cutover date is a SAFETY INTERLOCK, not a preference. The Responses sheet is append-only and
//holds years of history; without a floor the first run would treat every historical row as unsent
//and post the entire archive into Connections. submitMovementDataToConnections() refuses to run
//until this is set, so the failure mode is "nothing happened" rather than "years of duplicate stats".
function setConnectionsCutoverDate(){
  var ui = SpreadsheetApp.getUi();
  var answer = ui.prompt('Send stats dated on or after which date? (yyyy-MM-dd). '
                       + 'Rows older than this are never sent to Connections.', ui.ButtonSet.OK);
  var text = answer.getResponseText().trim();
  //Validated by the SAME function the run uses. This was its own inline regex, which only checked
  //the shape - so '2026-13-45' saved happily, reported "Cutover date set", and then every run
  //refused with "no cutover date is set" because the run's check is stricter. Accepting something
  //here that the run will reject is worse than refusing it now.
  if(!isConnectionsDateString_(text)){
    ui.alert('Not saved - that is not a real date. It must look like 2026-09-01.');
    return;
  }
  SCRIPT_PROP.setProperty(SF_CUTOVER_DATE, text);
  ui.alert('Cutover date set to ' + text + '.');
}

function toggleConnectionsDryRun(){
  var ui = SpreadsheetApp.getUi();
  var on = SCRIPT_PROP.getProperty(SF_DRY_RUN) === 'true';
  SCRIPT_PROP.setProperty(SF_DRY_RUN, on ? 'false' : 'true');
  ui.alert('Connections dry run is now ' + (on ? 'OFF - stats will be sent.'
                                               : 'ON - payloads are logged but never sent.'));
}

//---------------------------------------------------------------------------------------
// OAUTH 2.0 CLIENT CREDENTIALS
//
// CacheService, not Script Properties, deliberately. That store is capped at 500kb, cacheSize()
// already warns at 480kb, and Config.gs records an outage caused by filling it. A token is
// short-lived, regenerable state - exactly what CacheService is for.
//---------------------------------------------------------------------------------------

function getConnectionsToken(){
  var cache = CacheService.getScriptCache();
  var cached = cache.get(CONNECTIONS_TOKEN_CACHE_KEY);
  if(cached){ return cached; }

  var loginUrl = getConnectionsLoginUrl();
  var clientId = SCRIPT_PROP.getProperty(SF_CLIENT_ID);
  var clientSecret = SCRIPT_PROP.getProperty(SF_CLIENT_SECRET);

  if(!loginUrl || !clientId || !clientSecret){
    throw new Error('Connections credentials are not set - use Authentication > Set Connections Credentials');
  }

  var response = UrlFetchApp.fetch(loginUrl + '/services/oauth2/token', {
    method: 'post',
    payload: {
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret
    },
    muteHttpExceptions: true  //muted so the body can be read; the status IS checked below
  });

  var code = response.getResponseCode();
  var body = response.getContentText();

  if(code !== 200){
    //The body carries Salesforce's own error - invalid_client_id, inactive user, an IP
    //restriction - and is worth far more than the status alone. It contains no secret.
    throw new Error('Salesforce token request failed with HTTP ' + code + ': ' + body);
  }

  var token = JSON.parse(body).access_token;
  if(!token){
    throw new Error('Salesforce token response carried no access_token: ' + body);
  }

  cache.put(CONNECTIONS_TOKEN_CACHE_KEY, token, CONNECTIONS_TOKEN_TTL_SECONDS);
  return token;
}

function clearConnectionsToken(){
  CacheService.getScriptCache().remove(CONNECTIONS_TOKEN_CACHE_KEY);
}

//---------------------------------------------------------------------------------------
// ID TRANSLATION
//
// Spotlight's INTERNAL key stays 'c' + the Infobase activity id. It is baked into every
// Users.mvmnts blob, every historical Responses row, every Movements row's fb/g1/g2/g3
// accumulators, and every onboarding link already in circulation (#onboarding/c10338&c15195).
// Re-keying would invalidate all of those at once.
//
// What goes OUT is the Salesforce Account Id. LogMovementStats accepts either, but Infobase_Id__c
// is a legacy external id: a movement created in Connections after Infobase retires will not have
// one at all, and Spotlight would then have no way to address it. That is a dead end, not a
// preference - so the outbound identifier is the Account Id from day one.
//
// The crosswalk is built IN MEMORY from GetMovements on each run rather than kept in a column,
// because the Movements tab is an IMPORTRANGE from another spreadsheet and Apps Script cannot
// write into it without destroying the formula.
//---------------------------------------------------------------------------------------

//Digits only, applied to BOTH sides of the match. This is what makes the crosswalk immune to the
//open question about Infobase_Id__c's format - get-movements-api.md shows "INF100001" while
//stat-deep-link.md says the ids are bare numeric. Normalising both sides means 'INF15195',
//'15195' and Spotlight's own 'c15195' all reduce to '15195' and match, so the code is correct
//either way and testConnectionsIdCrosswalk() settles the question from real data instead.
function normalizeInfobaseId_(value){
  return String(value === null || value === undefined ? '' : value).replace(/\D/g, '');
}

//Reduces a Spotlight movement id to the key used to look it up in the crosswalk. This is NOT the
//outbound identifier any more - that is the Account Id the crosswalk returns.
function toConnectionsMatchKey(spotlightId){
  return normalizeInfobaseId_(spotlightId);
}

//Only campus movements. LogMovementStats requires Cru_Ministry__c = 'Campus' and the
//Local_Movement record type, so an sm* id has nothing to match. getStatsForPeriod() already
//skipped these, so no summer mission stat has ever left Spotlight for Infobase either.
function isCampusMovementId(spotlightId){
  //A leading 'c' is the entire test. There used to be a second clause, indexOf('sm') !== 0, which
  //could never be false once the first held - position 0 is already 'c' - so it advertised a guard
  //the first clause alone provides. Summer mission ids begin 'sm' and fail the leading-'c' check
  //on their own.
  return String(spotlightId).toLowerCase().indexOf('c') === 0;
}

//---------------------------------------------------------------------------------------
// SHEET HELPERS
//---------------------------------------------------------------------------------------

//Resolve columns by HEADER NAME, never by position. writeCacheToSheets() appends a new column for
//every previously unseen question id, so the fixed row[0]/row[2]/i=3 indexing the Infobase path
//used was only ever correct by luck.
function responsesHeaderIndex_(headers){
  var index = {};
  for(var i = 0; i < headers.length; i++){
    if(headers[i] !== ''){ index[headers[i]] = i; }
  }
  return index;
}

//Appends the ledger column if it is missing. Same mechanism writeCacheToSheets() uses, and for the
//same reason: this is the only place the column is ever created.
function ensureConnectionsSentColumn_(sheet){
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var index = headers.indexOf(CONNECTIONS_SENT_COLUMN);
  if(index > -1){ return index; }

  //Grow the grid first when the data already fills it. getRange() past the last column of the
  //sheet throws rather than expanding, and the Responses sheet gains a column for every new
  //question id, so it does eventually run out.
  if(sheet.getLastColumn() >= sheet.getMaxColumns()){
    sheet.insertColumnAfter(sheet.getMaxColumns());
  }
  sheet.getRange(1, sheet.getLastColumn() + 1).setValue(CONNECTIONS_SENT_COLUMN);
  SpreadsheetApp.flush();
  return sheet.getLastColumn() - 1;
}

//Sheets hands back a Date for a date-formatted cell and a string for anything else. Accept both,
//and return null rather than guessing when neither works - a wrong activityDate is worse than a
//skipped row, because there is no way to correct it once staged.
function toConnectionsDate_(value){
  if(value === '' || value === null || value === undefined){ return null; }

  //Already yyyy-MM-dd: hand it back untouched.
  //
  //This guard lives INSIDE the function so no call site can skip it. The comment here used to
  //claim isConnectionsDateString_() dealt with these, but that helper was only ever wired to the
  //cutover property - a CELL holding the string '2026-09-01' still fell through to new Date()
  //below, which parses a bare date as UTC midnight. Formatted back in a western timezone that is
  //2026-08-31, so the date silently moved a day earlier and there is no way to tell after the
  //fact. Not reachable through the Timestamp column today, because a date-formatted cell arrives
  //as a Date object - but it is one hand-typed cell away, and the failure is invisible.
  if(isConnectionsDateString_(value)){ return String(value).trim(); }

  var date = (value instanceof Date) ? value : new Date(value);
  if(isNaN(date.getTime())){ return null; }

  //Pure JS, deliberately NOT Utilities.formatDate.
  //
  //Apps Script sets V8's default timezone to the script's timezone, so getFullYear/getMonth/
  //getDate already report script-local values - byte-identical output to
  //Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd'), for none of the cost.
  //
  //This is not micro-optimisation. The eligibility loop calls this once per Responses row, and
  //Utilities.* and Session.* are SERVICE calls that cross out of V8, not local functions. The old
  //line made TWO of them per row: at 16,000 rows that was ~32,000 service calls and most of a
  //two minute execution, against a six minute limit that an append-only sheet grows towards
  //forever. Measured on the real sheet it was the single dominant cost of a dry run.
  //
  //Still script timezone, not UTC: formatting as UTC would push an evening submission into the
  //following day. getStatsForPeriod() in InfobaseConnection.gs still does exactly that; this
  //path does not.
  var y = date.getFullYear();
  var m = date.getMonth() + 1;
  var d = date.getDate();
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
}

//Shape AND validity. The regex alone accepted 2026-13-45, and both callers read a pass as "this is
//a usable date": toConnectionsDate_ hands it straight back, and submitMovementDataToConnections
//uses it as the cutover floor. An impossible date therefore reached Salesforce, came back as a 4xx
//that is not 404, and a non-404 deliberately leaves the row unmarked - so it retried on every run
//forever, spending a request and a failure-report slot each time.
//
//Round-tripping through Date is what catches 2026-02-30 as well: Date silently rolls that to
//March 2nd, so requiring the components to survive intact rejects it.
function isConnectionsDateString_(value){
  var text = String(value === null || value === undefined ? '' : value).trim();
  var parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if(!parts){ return false; }

  var y = parseInt(parts[1], 10);
  var m = parseInt(parts[2], 10);
  var d = parseInt(parts[3], 10);

  var probe = new Date(y, m - 1, d);
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d;
}

function chunkForConnections_(array, size){
  var chunks = [];
  for(var i = 0; i < array.length; i += size){
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

//---------------------------------------------------------------------------------------
// THE CROSSWALK
//---------------------------------------------------------------------------------------

var CONNECTIONS_GET_MOVEMENTS_PER_PAGE = 5000;  //the API's documented maximum; there is no cursor

//Fetches every active movement and reduces it to {infobaseDigits: salesforceAccountId}.
//
//Only two fields are retained. The full response carries a nested team hierarchy and a locations
//array per movement, which at 5000 records is several megabytes - holding all of that for the
//length of a submission run is wasted memory when two fields are wanted.
//
//keepRaw is for diagnostics only. The submission run must NOT set it: at 5000 records the nested
//team and locations arrays are several megabytes, and holding them for the length of a run is
//exactly the waste this function exists to avoid. testConnectionsUnresolvedBreakdown() does set it,
//so it can build a name index from THIS fetch rather than issuing a second one and re-deriving an
//id map that disagrees with this one about collisions.
function buildConnectionsIdMap_(keepRaw){
  var url = getConnectionsLoginUrl() + '/services/apexrest/GetMovements?per_page='
          + CONNECTIONS_GET_MOVEMENTS_PER_PAGE;

  var response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {Authorization: 'Bearer ' + getConnectionsToken()},
    muteHttpExceptions: true  //muted so the body can be read; the status IS checked below
  });

  var code = response.getResponseCode();
  var body = response.getContentText();

  if(code !== 200){
    throw new Error('GetMovements returned HTTP ' + code + ': ' + String(body).substring(0, 1000));
  }

  var parsed;
  try { parsed = JSON.parse(body); }
  catch(err){
    throw new Error('GetMovements returned HTTP ' + code + ' but the body was not JSON: '
                    + String(body).substring(0, 1000));
  }
  if(!parsed || !Array.isArray(parsed.movements)){
    throw new Error('GetMovements returned HTTP ' + code + ' with no movements array: '
                    + String(body).substring(0, 1000));
  }

  var map = {};
  var blanks = 0;
  var collisions = [];
  var samples = [];

  for(var m of parsed.movements){
    if(samples.length < 5 && m.infobaseId){ samples.push(String(m.infobaseId)); }

    var key = normalizeInfobaseId_(m.infobaseId);
    //No Infobase id at all. Unreachable from Spotlight's key - and this is exactly the population
    //that grows once movements start being created in Connections rather than Infobase.
    if(!key){ blanks += 1; continue; }

    if(map[key] && map[key] !== m.id){
      //Two Connections movements reduce to the same digits. Choosing one silently would post a
      //movement's stats against the wrong account, so record it and keep the first.
      collisions.push(key);
      continue;
    }
    map[key] = m.id;
  }

  return {
    map: map,
    total: parsed.movements.length,
    blanks: blanks,
    collisions: collisions,
    samples: samples,
    //There is no cursor or offset, so a full page is indistinguishable from a truncated one.
    truncated: parsed.movements.length >= CONNECTIONS_GET_MOVEMENTS_PER_PAGE,
    //Null unless a diagnostic asked - see the note above this function.
    movements: keepRaw ? parsed.movements : null
  };
}

//---------------------------------------------------------------------------------------
// THE SUBMISSION RUN
//---------------------------------------------------------------------------------------

function submitMovementDataToConnections(){
  try {
    //Compared as a STRING against activityDate, which is also yyyy-MM-dd - that ordering is
    //correct lexically and avoids parsing the property into a Date, which would shift it a day.
    var cutover = String(SCRIPT_PROP.getProperty(SF_CUTOVER_DATE) || '').trim();
    if(!isConnectionsDateString_(cutover)){
      //Refuse rather than default. See the note on setConnectionsCutoverDate().
      notifyFailure('submitMovementDataToConnections',
        new Error('no cutover date is set, so nothing was sent - use Authentication > Set Stats Cutover Date'),
        {property: SF_CUTOVER_DATE});
      return;
    }

    var dryRun = SCRIPT_PROP.getProperty(SF_DRY_RUN) === 'true';

    var doc = SpreadsheetApp.openById(SCRIPT_PROP.getProperty('key'));
    var sheet = doc.getSheetByName(RESPONSE_SHEET);
    var sentColumn = ensureConnectionsSentColumn_(sheet);

    var lastRow = sheet.getLastRow();
    if(lastRow < 2){ return; }

    var values = sheet.getRange(1, 1, lastRow, sheet.getLastColumn()).getValues();
    var headers = values.shift();
    var col = responsesHeaderIndex_(headers);

    //BOTH are required, and Timestamp used not to be checked at all.
    //
    //A missing movementId was always fatal. A missing Timestamp instead degraded into a silent
    //no-op: col.Timestamp was undefined, row[undefined] was undefined, every row failed the date
    //lookup, and the run finished "successfully" having sent nothing - with one "rows with no
    //usable date" email as the only trace, which reads like a data-quality nag rather than total
    //failure. Four sibling deployments share this codebase with independently evolved sheets, so
    //a renamed or differently-cased header is a real possibility rather than a hypothetical.
    var missingColumns = ['movementId', 'Timestamp'].filter(function(c){ return col[c] === undefined; });
    if(missingColumns.length){
      notifyFailure('submitMovementDataToConnections: required column missing',
        new Error('the Responses sheet is missing a column this run cannot work without'),
        {sheet: RESPONSE_SHEET, missing: missingColumns.join(', '),
         headersFound: headers.filter(function(h){ return h !== ''; }).join(', ').substring(0, 500)});
      return;
    }

    //---- select the rows that are actually eligible -------------------------------------
    var eligible = [];
    var marks = {};        //sheet row number -> value to write into connectionsSent
    var skippedNoDate = 0;

    //Parsed once, not per row. getUser() re-parses the whole users property on every call, and at
    //CONNECTIONS_MAX_PER_RUN rows that is 500 parses of the largest blob in the store. Only the
    //email is wanted here, so the rest of what getUser() does is waste as well.
    var usersByPhone = {};
    try { usersByPhone = JSON.parse(SCRIPT_PROP.getProperty('users')) || {}; }
    catch(err){
      //Attribution is a bonus, not the point of the run. Report it and send the stats anyway.
      notifyFailure('submitMovementDataToConnections: users cache unreadable', err,
                    {action: 'stats will be sent without submitter email'});
      usersByPhone = {};
    }

    for(var i = 0; i < values.length; i++){
      var row = values[i];
      var sheetRow = i + 2;   //+1 for the header we shifted off, +1 because sheets are 1-indexed

      if(String(row[sentColumn]).trim() !== ''){ continue; }        //already dealt with

      var movementId = String(row[col.movementId]).trim();
      if(!movementId){ continue; }

      if(!isCampusMovementId(movementId)){
        marks[sheetRow] = 'not-campus';
        continue;
      }

      //Timestamp, explicitly. There is NO endDate column in this sheet - the columns are
      //Timestamp, userPhone, movementId, teamQ1-3, storyBox, then the stat fields. Reading
      //col.endDate first only "worked" because row[undefined] is undefined and the || fell
      //through: it read like a real fallback and was not one.
      //
      //CONSEQUENCE, and it cannot be fixed here: activityDate is the SUBMISSION time, not the week
      //being reported on. Somebody entering Tuesday for last week's activity gets last week's
      //numbers dated Tuesday. LogMovementStats has no period fields and the sheet has no
      //reporting-date column, so there is nothing better available to send.
      var activityDate = toConnectionsDate_(row[col.Timestamp]);
      if(!activityDate){
        //Left UNMARKED on purpose: a blank date is a data problem that someone can fix in the
        //sheet, after which the row becomes eligible again. Marking it would bury it.
        skippedNoDate += 1;
        continue;
      }
      if(activityDate < cutover){
        marks[sheetRow] = 'before-cutover';
        continue;
      }

      var stats = {};
      var anyNonZero = false;
      for(var spotlightField of Object.keys(CONNECTIONS_FIELD_MAP)){
        if(col[spotlightField] === undefined){ continue; }
        var n = parseInt(row[col[spotlightField]], 10);
        if(isNaN(n)){ n = 0; }
        stats[CONNECTIONS_FIELD_MAP[spotlightField]] = n;
        if(n !== 0){ anyNonZero = true; }
      }

      if(!anyNonZero){
        //"Every field is zero", NOT "the fields sum to zero" - and the difference is real data.
        //
        //This used to test a running total, so a correction row carrying +3 spiritual conversations
        //and -3 personal evangelism summed to zero, was marked 'no-stats', and was discarded
        //PERMANENTLY - the mark makes it ineligible on every future run. Negative corrections
        //demonstrably exist in this sheet; a UAT dry run emitted one with -3 and -1. Infobase hid
        //them because it aggregated a whole week before sending, so the signs cancelled inside the
        //total that went out. Posting per row exposes them, and the sum test then threw them away.
        //
        //Rows where everything really is zero are still marked: the API only creates downstream
        //tasks for non-zero values, so sending one costs a request to create an empty record, and
        //the eligible set has to stay small as an append-only sheet grows.
        marks[sheetRow] = 'no-stats';
        continue;
      }

      var payload = stats;
      //movementId is filled in AFTER the crosswalk below - it is the Salesforce Account Id, which
      //is only known once GetMovements has been read.
      payload.activityDate = activityDate;

      //Attribution Infobase never had - its batch endpoint carried no submitter field at all.
      //Optional on the API, so an unregistered or aged-out phone just means no email on the record.
      var user = usersByPhone[String(row[col.userPhone]).trim()];
      if(user && user.email){ payload.email = user.email; }

      eligible.push({sheetRow: sheetRow, movementId: movementId, payload: payload});
    }

    if(skippedNoDate){
      //Counts live in the context, never in the message - notifyFailure dedupes on the message's
      //first line, so a number that changes every run would mint a new signature and a new
      //fail_* Script Property each time. Same reason the clientError path allow-lists its 'where'.
      notifyFailure('submitMovementDataToConnections: rows with no usable date',
        new Error('row(s) have no usable endDate or Timestamp and were skipped'),
        {rows: skippedNoDate, action: 'left unmarked so they retry once the sheet is corrected'});
    }

    var overflow = 0;
    if(eligible.length > CONNECTIONS_MAX_PER_RUN){
      overflow = eligible.length - CONNECTIONS_MAX_PER_RUN;
      eligible = eligible.slice(0, CONNECTIONS_MAX_PER_RUN);
    }

    //Checked before the crosswalk so a quiet run costs no GetMovements call at all.
    if(eligible.length === 0){
      if(dryRun){
        Logger.log('DRY RUN - nothing eligible; ' + Object.keys(marks).length
                   + ' row(s) would be marked without sending.');
        return;
      }
      writeConnectionsMarks_(marks);
      return;
    }

    //---- resolve Spotlight ids to Salesforce Account Ids --------------------------------
    var crosswalk = buildConnectionsIdMap_();
    var unresolved = [];
    var resolved = [];

    for(var item of eligible){
      var accountId = crosswalk.map[toConnectionsMatchKey(item.movementId)];
      if(!accountId){
        //Left UNMARKED, deliberately. A miss here is either permanent (the movement has no
        //Infobase_Id__c in Connections) or transient (GetMovements came back truncated, or the
        //movement was briefly inactive). Marking a transient miss would discard real stats
        //forever, so these stay eligible and are reported instead - the count and the id list
        //below are what distinguish "three odd movements" from "the crosswalk is broken".
        unresolved.push(item.movementId);
        continue;
      }
      item.payload.movementId = accountId;
      resolved.push(item);
    }
    eligible = resolved;

    if(crosswalk.truncated){
      notifyFailure('submitMovementDataToConnections: GetMovements may be truncated',
        new Error('GetMovements returned a full page and the API has no cursor, so movements '
                + 'beyond the page limit are invisible and their stats cannot be sent'),
        {returned: crosswalk.total, perPage: CONNECTIONS_GET_MOVEMENTS_PER_PAGE,
         action: 'fetch per-strategy instead, or ask for a cursor'});
    }
    if(crosswalk.collisions.length){
      notifyFailure('submitMovementDataToConnections: infobase id collisions',
        new Error('movement(s) in Connections reduce to the same Infobase digits, so the mapping '
                + 'is ambiguous and the first was kept'),
        {count: crosswalk.collisions.length, keys: crosswalk.collisions.join(', ').substring(0, 2000)});
    }
    if(unresolved.length){
      notifyFailure('submitMovementDataToConnections: movements not in the crosswalk',
        new Error('row(s) name a movement with no matching Salesforce Account Id, so they were '
                + 'not sent and stay eligible for the next run'),
        {rows: unresolved.length,
         movementIds: unresolved.filter(onlyUnique).join(', ').substring(0, 2000),
         movementsReturned: crosswalk.total, withNoInfobaseId: crosswalk.blanks});
    }

    if(dryRun){
      Logger.log('DRY RUN - ' + eligible.length + ' request(s) would be sent, '
                 + Object.keys(marks).length + ' row(s) would be marked without sending, '
                 + unresolved.length + ' row(s) unresolved.');
      Logger.log('crosswalk: ' + crosswalk.total + ' movement(s) from GetMovements, '
                 + crosswalk.blanks + ' with no infobaseId, samples: ' + crosswalk.samples.join(', '));
      for(var dryItem of eligible){ Logger.log(JSON.stringify(dryItem.payload)); }
      return;
    }

    if(eligible.length === 0){
      writeConnectionsMarks_(marks);
      return;
    }

    //---- send ---------------------------------------------------------------------------
    var token = getConnectionsToken();
    var url = getConnectionsLoginUrl() + '/services/apexrest/LogMovementStats';
    var sent = 0, failed = 0, notFound = 0, sawUnauthorized = false;
    var failures = {};

    for(var batch of chunkForConnections_(eligible, CONNECTIONS_CHUNK_SIZE)){
      var requests = batch.map(function(item){
        return {
          url: url,
          method: 'post',
          contentType: 'application/json',
          headers: {Authorization: 'Bearer ' + token},
          payload: JSON.stringify(item.payload),
          //Muted so every response in the batch can be inspected individually. Without this a
          //single 404 throws and takes the whole fetchAll with it, losing the results of the
          //requests that DID succeed - and those are already staged in Salesforce by then.
          muteHttpExceptions: true
        };
      });

      var responses;
      try {
        responses = UrlFetchApp.fetchAll(requests);
      } catch(err){
        //Network-level failure. Nothing in this batch gets marked, so the whole batch retries
        //next run. Some of it may already have been staged - which is why this is reported.
        notifyFailure('submitMovementDataToConnections: fetchAll threw', err,
                      {batchSize: batch.length, sentSoFar: sent});
        break;
      }

      var batchSawUnauthorized = false;

      for(var j = 0; j < responses.length; j++){
        var res = responses[j];
        var thisItem = batch[j];
        var code = res.getResponseCode();

        if(code === 201 || code === 200){
          var stagingId = '';
          try { stagingId = JSON.parse(res.getContentText()).stagingId || ''; } catch(e){ stagingId = ''; }
          marks[thisItem.sheetRow] = stagingId || 'sent';
          sent += 1;
        }
        else if(code === 404){
          //Distinct from an unresolved id above: the Account Id DOES exist in GetMovements, but
          //LogMovementStats additionally requires Cru_Ministry__c = 'Campus', and GetMovements
          //returns every Local_Movement regardless of ministry. So this is a real, permanent
          //mismatch for this row - mark it so it stops consuming a request on every run.
          marks[thisItem.sheetRow] = 'not-in-connections';
          notFound += 1;
          failures['404 ' + thisItem.movementId] = (failures['404 ' + thisItem.movementId] || 0) + 1;
        }
        else {
          if(code === 401){ sawUnauthorized = true; batchSawUnauthorized = true; }
          //Left unmarked - retried on the next run.
          failed += 1;
          var key = code + ' ' + String(res.getContentText()).substring(0, 120);
          failures[key] = (failures[key] || 0) + 1;
        }
      }

      //Re-authenticate NOW rather than at the end of the run. The token is read once before this
      //loop, so without this every remaining batch keeps presenting a credential already known to
      //be dead - on a 294 row run that is roughly 250 requests spent proving the same thing.
      //
      //The 401'd rows themselves are deliberately NOT retried here. They stay unmarked, so the
      //next scheduled run collects them. Re-sending them inside this run would risk duplicating
      //any request in the same batch that had already succeeded, and a duplicate
      //Staging_Activity__c cannot be withdrawn once the downstream automation has seen it.
      if(batchSawUnauthorized){
        clearConnectionsToken();
        try { token = getConnectionsToken(); }
        catch(err){
          //Cannot re-auth, so every remaining batch would fail the same way. Stop and let the
          //next run try: everything unsent is still unmarked.
          notifyFailure('submitMovementDataToConnections: could not re-authenticate mid-run', err,
                        {sentSoFar: sent, failedSoFar: failed});
          break;
        }
      }
    }

    //No end-of-run clearConnectionsToken() any more. Every 401 is now handled inside the loop, which
    //both clears the dead token and caches a fresh one - so clearing again here would discard a
    //token that is known good and make the next run re-authenticate for nothing. The only path that
    //leaves the cache empty is the re-auth failure above, and that is correct: there is no token.
    //sawUnauthorized survives purely so the failure report can say the run hit auth trouble.

    writeConnectionsMarks_(marks);

    if(Object.keys(failures).length){
      //One report for the whole run. Reporting per row would spend the daily mail cap that PIN
      //and registration email share - emailTeamStories() learned this the expensive way.
      //
      //A 404 is NOT counted in `failed`: it is marked and never retried, because the movement is
      //not a campus Local_Movement. Worth reporting all the same - a sudden crop of them is how a
      //broken crosswalk would announce itself.
      notifyFailure('submitMovementDataToConnections: requests did not succeed',
        new Error('request(s) failed and will be retried next run, and/or movement(s) were not '
                  + 'found in Connections - see the counts below'),
        {sent: sent, failed: failed, notFound: notFound, notSentThisRun: overflow,
         reAuthenticatedMidRun: sawUnauthorized,
         reasons: Object.keys(failures).map(function(k){ return k + ' x' + failures[k]; }).join(' | ')});
    }

    Logger.log('Connections: sent ' + sent + ', failed ' + failed + ', notFound ' + notFound
               + ', unresolved ' + unresolved.length + ', deferred ' + overflow
               + ' (crosswalk: ' + crosswalk.total + ' movements, ' + crosswalk.blanks + ' with no infobaseId)');
  }
  catch(error){
    //No recursion and no retry counter. Unmarked rows are still eligible, so the next scheduled
    //run is the retry - which is what the tries/date counter on the Infobase path was badly
    //approximating.
    notifyFailure('submitMovementDataToConnections', error, {});
  }
}

//Writes the ledger in one setValues() rather than a call per row.
//
//The lock is taken HERE and not around the HTTP work above: writeCacheToSheets() and
//writeUsersToSheets() both take the same public lock, and holding it through several minutes of
//requests would block live stat submissions. Rows are only ever appended to this sheet, so the row
//numbers collected before the fetch are still correct afterwards; anything appended meanwhile sits
//below the range written here and is picked up on the next run.
function writeConnectionsMarks_(marks){
  var rows = Object.keys(marks);
  if(rows.length === 0){ return; }

  var lock = LockService.getPublicLock();
  try {
    lock.waitLock(30000);

    var doc = SpreadsheetApp.openById(SCRIPT_PROP.getProperty('key'));
    var sheet = doc.getSheetByName(RESPONSE_SHEET);

    //Re-resolve rather than trust the index from before the fetch, in case a column was added.
    var column = ensureConnectionsSentColumn_(sheet);

    var lastRow = sheet.getLastRow();
    if(lastRow < 2){ return; }
    var existing = sheet.getRange(2, column + 1, lastRow - 1, 1).getValues();

    for(var row of rows){
      var offset = parseInt(row, 10) - 2;
      //Only fill a cell that is still empty. If something else has written here since the scan,
      //that value is newer than ours and must win.
      if(offset >= 0 && offset < existing.length && String(existing[offset][0]).trim() === ''){
        existing[offset][0] = marks[row];
      }
    }

    sheet.getRange(2, column + 1, existing.length, 1).setValues(existing);
    SpreadsheetApp.flush();
  }
  catch(err){
    //Loud. Anything unwritten here was already staged in Salesforce, so the next run will send it
    //a second time - this log line is the only warning of that.
    Logger.log('writeConnectionsMarks_ failed; ' + rows.length
               + ' row(s) may be staged in Connections but unmarked: ' + err.message);
    notifyFailure('writeConnectionsMarks_', err, {rows: rows.length});
  }
  finally {
    try { lock.releaseLock(); } catch(e){ /* never held, or already released */ }
  }
}

//---------------------------------------------------------------------------------------
// MANUAL TESTS - run from the editor
//---------------------------------------------------------------------------------------

//Phase 1 of the migration plan: prove Apps Script can authenticate at all. This is the highest-risk
//unknown - the Connected App needs the client credentials flow enabled with a run-as user, and IP
//relaxation that permits Google's egress range - so run it before anything else.
function testConnectionsAuth(){
  clearConnectionsToken();
  var token = getConnectionsToken();
  Logger.log('Got a token of length ' + token.length + ' from ' + getConnectionsLoginUrl());

  var res = UrlFetchApp.fetch(getConnectionsLoginUrl() + '/services/apexrest/GetMovements?per_page=1', {
    method: 'get',
    headers: {Authorization: 'Bearer ' + token},
    muteHttpExceptions: true
  });
  Logger.log('GetMovements returned HTTP ' + res.getResponseCode());
  Logger.log(String(res.getContentText()).substring(0, 1000));
}

//Run this SECOND, straight after testConnectionsAuth(). It answers, from real data, three things
//the API docs either contradict each other on or do not cover at all:
//
//  1. What shape Infobase_Id__c actually has - the INF-prefix question. The samples line settles
//     it. (The crosswalk works either way, so this is for confirmation, not correctness.)
//  2. How many movements in Connections have NO Infobase id, and so can never be matched from
//     Spotlight's key. This is the population that grows as movements start life in Connections.
//  3. How many of THIS deployment's own campus movements resolve to a Salesforce Account Id -
//     which is the only number that says whether the integration will actually work here.
//
//Read the UNRESOLVED list closely. Every id on it is a movement whose stats would not be sent.
function testConnectionsIdCrosswalk(){
  var crosswalk = buildConnectionsIdMap_();

  Logger.log('GetMovements returned ' + crosswalk.total + ' movement(s)');
  Logger.log('  infobaseId samples: ' + (crosswalk.samples.join(', ') || '(none had one)'));
  Logger.log('  with no infobaseId: ' + crosswalk.blanks);
  Logger.log('  digit collisions:   ' + (crosswalk.collisions.join(', ') || 'none'));
  if(crosswalk.truncated){
    Logger.log('  WARNING: the page came back full and the API has no cursor, so this list may be '
               + 'truncated. Fetch per-strategy instead.');
  }

  var movements = {};
  try { movements = JSON.parse(SCRIPT_PROP.getProperty('movements')) || {}; }
  catch(e){ Logger.log('could not read the movements cache: ' + e.message); }

  var campus = Object.keys(movements).filter(isCampusMovementId);
  var missing = campus.filter(function(id){ return !crosswalk.map[toConnectionsMatchKey(id)]; });

  Logger.log('Spotlight campus movements: ' + campus.length
             + ' | resolved: ' + (campus.length - missing.length)
             + ' | UNRESOLVED: ' + missing.length);

  //Show a few RESOLVED pairs, not just the failures. Without this the only ids in the log are the
  //ones that did not work, which is exactly backwards when the next step needs a working one.
  logConnectionsSample_('resolved (spotlight -> infobase -> salesforce account)',
    campus.filter(function(id){ return crosswalk.map[toConnectionsMatchKey(id)]; })
          .map(function(id){
            var name = (movements[id] && movements[id].name) ? movements[id].name : '';
            return (name ? name + ' ' : '') + id + ' -> ' + toConnectionsMatchKey(id)
                   + ' -> ' + crosswalk.map[toConnectionsMatchKey(id)];
          }), 5);

  if(missing.length){
    //Named, not just counted - same labelling as the Infobase success email, because a bare list
    //of ids is not enough to go and fix anything. Capped, because the execution log truncates a
    //single oversized entry ("Logging output too large") and then you lose the counts too.
    logConnectionsSample_('unresolved', missing.map(function(id){
      var name = (movements[id] && movements[id].name) ? movements[id].name : '';
      return name ? name + ' (' + id + ')' : String(id);
    }));
    Logger.log('Run testConnectionsUnresolvedBreakdown() to find out WHY these did not match.');
  }
}

//The execution log truncates one oversized entry rather than wrapping it, so a 482-item list
//swallows everything after it. Log a bounded sample and always state the true total.
function logConnectionsSample_(title, list, limit){
  if(!list || !list.length){ return; }
  limit = limit || 15;
  Logger.log('  ' + title + ' - showing ' + Math.min(limit, list.length) + ' of ' + list.length
             + ':\n   - ' + list.slice(0, limit).join('\n   - '));
}

//---------------------------------------------------------------------------------------
// DIAGNOSTIC - WHY did a movement fail to resolve?
//
// testConnectionsIdCrosswalk() reports HOW MANY did not match. This reports WHY, which is what
// decides who has to fix it. It re-reads GetMovements and, for each unresolved Spotlight movement,
// looks for a Connections record carrying the same campus name. That splits the population three
// ways, and the three have different owners:
//
//   PRESENT, NO INFOBASE ID - the record is in Connections but Infobase_Id__c is empty. Connections
//                             can backfill it. Until then Spotlight cannot address it by Infobase id.
//   PRESENT, DIFFERENT ID   - in Connections under an Infobase id that is not the one Spotlight
//                             holds. A real data conflict; somebody has to say which is correct.
//   ABSENT BY NAME          - no Connections record with that name at all. Either the sandbox is an
//                             incomplete refresh, or the movement is Status__c = 'Inactive' (which
//                             GetMovements excludes outright), or it genuinely does not exist.
//
// Name matching is a HEURISTIC and exists ONLY for this diagnosis - it is never used to send a stat.
// A renamed campus will read as ABSENT, so treat that bucket as "needs a human", not as proof.
//---------------------------------------------------------------------------------------

function normalizeMovementName_(value){
  return String(value === null || value === undefined ? '' : value)
    .toLowerCase()
    .replace(/&/g, ' and ')       //"Texas A&M" and "Texas A and M" are the same campus
    .replace(/[^a-z0-9]+/g, ' ')  //punctuation and spacing vary between the two systems
    .trim();
}

function testConnectionsUnresolvedBreakdown(){
  //One fetch, and the SAME id map the real run uses. This used to issue its own request and build
  //its own first-wins index, which silently skipped the collision handling in buildConnectionsIdMap_
  //- so a movement whose digits collided counted as "resolved" here while the crosswalk reported it
  //as ambiguous, and the two functions disagreed about the only number that matters.
  var crosswalk = buildConnectionsIdMap_(true);
  var connections = crosswalk.movements || [];
  var byInfobase = crosswalk.map;

  var byName = {};       //normalised name -> [{id, infobaseId, status, strategy}]

  for(var m of connections){
    //Index every name this movement could plausibly be known by. Spotlight's movement name is
    //usually the campus, which lands in locations[].name - but team.name is worth indexing too,
    //because a movement with no locations has nothing else to offer.
    var names = (m.locations || []).map(function(l){ return l.name; });
    if(m.team && m.team.name){ names.push(m.team.name); }

    for(var nm of names){
      var nk = normalizeMovementName_(nm);
      if(!nk){ continue; }
      if(!byName[nk]){ byName[nk] = []; }
      byName[nk].push({id: m.id, infobaseId: m.infobaseId, status: m.status, strategy: m.strategy});
    }
  }

  var movements = {};
  try { movements = JSON.parse(SCRIPT_PROP.getProperty('movements')) || {}; }
  catch(e){ Logger.log('could not read the movements cache: ' + e.message); return; }

  var noId = [], wrongId = [], absent = [], resolved = 0;

  for(var sid of Object.keys(movements).filter(isCampusMovementId)){
    if(byInfobase[toConnectionsMatchKey(sid)]){ resolved += 1; continue; }

    var label = (movements[sid] && movements[sid].name) ? movements[sid].name : String(sid);
    var hits = byName[normalizeMovementName_(label)];

    if(!hits || !hits.length){
      absent.push(label + ' (' + sid + ')');
      continue;
    }
    //Prefer reporting a blank-id hit: that is the actionable one.
    var blank = hits.filter(function(h){ return !normalizeInfobaseId_(h.infobaseId); });
    if(blank.length){
      noId.push(label + ' (' + sid + ' -> ' + blank[0].id + ', status "' + blank[0].status + '")');
    }
    else {
      wrongId.push(label + ' (' + sid + ' -> Connections holds infobaseId ' + hits[0].infobaseId + ')');
    }
  }

  Logger.log('UNRESOLVED BREAKDOWN - ' + connections.length + ' Connections movement(s), '
             + resolved + ' Spotlight movement(s) already resolved by Infobase id');
  if(crosswalk.collisions.length){
    //Surfaced here too, because a collision is a reason a movement may LOOK resolved while pointing
    //at the wrong account - and this is the function people run to explain non-resolution.
    Logger.log('  NOTE: ' + crosswalk.collisions.length + ' infobase-digit collision(s) in the '
               + 'crosswalk (' + crosswalk.collisions.join(', ').substring(0, 300) + ') - the first '
               + 'match wins, so a movement here may resolve to the wrong account.');
  }
  Logger.log('  PRESENT, NO INFOBASE ID : ' + noId.length + '   <- Connections can backfill these');
  Logger.log('  PRESENT, DIFFERENT ID   : ' + wrongId.length + '   <- data conflict, needs a decision');
  Logger.log('  ABSENT BY NAME          : ' + absent.length + '   <- stale sandbox, Inactive, or truly missing');

  logConnectionsSample_('PRESENT, NO INFOBASE ID', noId);
  logConnectionsSample_('PRESENT, DIFFERENT ID', wrongId);
  logConnectionsSample_('ABSENT BY NAME', absent);
}

//Optional. Set this to a SPOTLIGHT movement id ('c15195') to test that specific movement. Left
//blank, the test picks the first one the crosswalk resolves.
//
//Deliberately a Spotlight id and never a Salesforce Account Id: you do not have Account Ids to
//hand, and you should not need them. The real run resolves them from GetMovements, so the test
//resolves them the same way - which also means this exercises the actual translation rather than
//a value copied out of a log.
var CONNECTIONS_TEST_MOVEMENT_ID = '';

//Sends exactly ONE Staging_Activity__c into whichever org the credentials point at. It does not
//touch the Responses sheet and writes no ledger mark, so it is safe to re-run - but each run does
//create another record in Salesforce.
function testLogOneMovementStat(){
  var crosswalk = buildConnectionsIdMap_();

  var movements = {};
  try { movements = JSON.parse(SCRIPT_PROP.getProperty('movements')) || {}; }
  catch(e){ Logger.log('could not read the movements cache: ' + e.message); return; }

  var spotlightId = String(CONNECTIONS_TEST_MOVEMENT_ID || '').trim();
  if(!spotlightId){
    spotlightId = Object.keys(movements)
      .filter(isCampusMovementId)
      .filter(function(id){ return crosswalk.map[toConnectionsMatchKey(id)]; })[0];
  }

  if(!spotlightId){
    Logger.log('No campus movement resolves to an Account Id, so there is nothing to send. '
               + 'Run testConnectionsUnresolvedBreakdown() to find out why.');
    return;
  }

  var accountId = crosswalk.map[toConnectionsMatchKey(spotlightId)];
  if(!accountId){
    Logger.log(spotlightId + ' does not resolve to an Account Id. Choose one that does, or clear '
               + 'CONNECTIONS_TEST_MOVEMENT_ID to auto-pick.');
    return;
  }

  var name = (movements[spotlightId] && movements[spotlightId].name) ? movements[spotlightId].name : '';
  var infobaseId = toConnectionsMatchKey(spotlightId);

  //The full chain, logged, because a 404 is only interpretable if you can see what was translated.
  Logger.log('testing ' + (name ? name + '  ' : '') + spotlightId
             + '  ->  infobase ' + infobaseId + '  ->  account ' + accountId);

  //---- attempt 1: the Salesforce Account Id, which is what the real run sends ----------
  //The payload is built in postOneConnectionsStat_ and echoed back, so there is exactly ONE place
  //that decides what gets sent. This function used to build its own copy as well, which was dead
  //the moment the fetch moved into the helper - and misleading, because it looked like the thing
  //being posted.
  var first = postOneConnectionsStat_(accountId);
  Logger.log('  payload: ' + JSON.stringify(first.payload));
  Logger.log('  as Account Id   ' + accountId + '  ->  HTTP ' + first.code + ': ' + first.body);

  if(first.code === 200 || first.code === 201){
    Logger.log('OK - the Account Id path works, which is the identifier the real run uses.');
    return;
  }

  //403 is a DIFFERENT grant from the one that blocked GetMovements - LogMovementStats is its own
  //Apex class and needs its own Apex Class Access entry on the Run-As user. No point retrying
  //with another identifier: the class is refusing the call before it looks at the body.
  if(first.code === 403){
    Logger.log('403 - the Apex class behind LogMovementStats is not granted to the Run-As user, '
               + 'separate from CruGetMovementsService. Its class name is in the message above; '
               + 'that is what the Salesforce admin needs. Not an identifier problem.');
    return;
  }

  //---- attempt 2: the SAME movement, addressed by Infobase id -------------------------
  //LogMovementStats accepts either form, so posting the same movement both ways is the only way
  //to tell an API-side lookup difference from a plain data problem. This is why the retry exists
  //and why it only runs after a failure - a working first attempt must not create a second record.
  Logger.log('  retrying the SAME movement by Infobase id, to separate identifier from data...');
  var second = postOneConnectionsStat_(infobaseId);
  Logger.log('  as Infobase id  ' + infobaseId + '  ->  HTTP ' + second.code + ': ' + second.body);

  if(second.code === 200 || second.code === 201){
    Logger.log('DIAGNOSIS: Infobase id WORKS, Account Id does NOT, for the same movement. That is '
               + 'an API-side lookup difference, not bad data. Report it - and until it is fixed, '
               + 'send the Infobase id (change the one line in submitMovementDataToConnections '
               + 'that assigns payload.movementId). Note that leaves Connections-native movements '
               + 'unreachable, since they have no Infobase id.');
  }
  else {
    Logger.log('DIAGNOSIS: BOTH identifier forms fail identically, so the identifier is not the '
               + 'problem - this Account is not a Campus Local_Movement in this org. Try a '
               + 'different movement, or ask which UAT movements actually have '
               + 'Cru_Ministry__c = \'Campus\'. GetMovements returns every Local_Movement '
               + 'regardless of ministry, so it will happily hand you ineligible ones.');
  }
}

//One POST, one identifier, no sheet writes. Returns the status and body so the caller can compare
//two attempts rather than just logging whichever ran last.
function postOneConnectionsStat_(movementIdValue){
  var payload = {
    movementId: movementIdValue,
    //Dated through toConnectionsDate_ rather than formatting inline, so the test carries the same
    //date the real run would and breaks with it if that ever regresses.
    activityDate: toConnectionsDate_(new Date()),
    email: MAINTAINER_EMAIL,
    spiritualConversations: 1
  };
  var res = UrlFetchApp.fetch(getConnectionsLoginUrl() + '/services/apexrest/LogMovementStats', {
    method: 'post',
    contentType: 'application/json',
    headers: {Authorization: 'Bearer ' + getConnectionsToken()},
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  //The payload rides back so the caller can log exactly what was sent without rebuilding it.
  return {code: res.getResponseCode(),
          body: String(res.getContentText()).substring(0, 500),
          payload: payload};
}

//Shows what a real run WOULD do, without sending anything and without touching the ledger.
function testConnectionsDryRun(){
  var was = SCRIPT_PROP.getProperty(SF_DRY_RUN);
  SCRIPT_PROP.setProperty(SF_DRY_RUN, 'true');
  try { submitMovementDataToConnections(); }
  finally {
    if(was === null){ SCRIPT_PROP.deleteProperty(SF_DRY_RUN); }
    else { SCRIPT_PROP.setProperty(SF_DRY_RUN, was); }
  }
}
