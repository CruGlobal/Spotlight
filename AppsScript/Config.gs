//  Enter sheet name where data is to be written below
        var RESPONSE_SHEET = "Responses";
//  Enter sheet name where Movements are
        var MOVEMENT_SHEET = "Movements";
//  Enter sheet name where Teams are
        var TEAM_SHEET = "Teams";
//  Enter sheet name where Strategies are
        var STRATEGY_SHEET = "Strategies";
//  Enter sheet name where Users are
        var USER_SHEET = "Users";
//  Enter sheet name where Users are
        var USER_SHEET_UPDATE = "Users";
//  Enter sheet name where Question Relatioships are
        var QUESTION_RELS = "QuestionRels";

var SCRIPT_PROP = PropertiesService.getScriptProperties(); // new property service
var MAINTAINER_EMAIL = 'spotlight@cru.org'  //change where all maintainer and error emails should go.
var SUPPORT_EMAIL = 'spotlight@cru.org'    //the address users see - see SENDER IDENTITY below
var SENDER_NAME = 'Spotlight'

function setup() {
  var doc = SpreadsheetApp.getActiveSpreadsheet();
  SCRIPT_PROP.setProperty("key", doc.getId());

  //Install SM form
  var form = FormApp.openById('1jV9A3_h4U2qvy4ohksEjwLmOp6HG0GICy1PnsuoZx7k');
  ScriptApp.newTrigger('updateAutoScriptProperties')
  .forForm(form)
  .onFormSubmit()
  .create();

  //install Campus form
  form = FormApp.openById('1lfG0JOC0Lr3rhQvprCiXy7EsPoV7ZY-EDrDt2qa235U');
  ScriptApp.newTrigger('updateAutoScriptProperties')
  .forForm(form)
  .onFormSubmit()
  .create();
}

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  // Or DocumentApp, SlidesApp or FormApp.
  ui.createMenu('Spotlight Server')
      .addItem('Update Teams and Movements', 'updateTeamAndMovements')
      .addItem('Full Server Update', 'updateAutoScriptProperties')
      .addItem('Reimport Users Table', 'setUserScriptProperty')
      .addToUi();
  ui.createMenu('Authentication')
    .addItem('Set Authorization Token', 'setKey')
    .addItem('Delete Authorization Token', 'deleteKey')
    .addItem('Set API URL', 'setURL')
    .addItem('Delete API URL', 'deleteURL')
  .addToUi();
}

function updateScriptProperties(){
  setMovementsScriptProperty();
  setQuestionRelsScriptProperty();
  setStrategiesScriptProperty();
  setTeamsScriptProperty();
  setUserScriptProperty();
  setGlobalSumsScriptProperty();
  
  return cacheSize();
}

function updateAutoScriptProperties() {
  setQuestionRelsScriptProperty();
  setGlobalSumsScriptProperty();
  setTeamsScriptProperty();
  setStrategiesScriptProperty();
  writeCacheToSheets();
  writeUsersToSheets();
  setMovementsScriptProperty();
  GmailApp.sendEmail(MAINTAINER_EMAIL,'updateAutoScript ran','');
}

function updateTeamAndMovements(e) {
  if(!e || e.changeType == 'OTHER') {
    updateTeamsScriptProperty();
    updateMovementsScriptProperty();
    //GmailApp.sendEmail(MAINTAINER_EMAIL,'updateTeamAndMovements ran','');
  }
}

function cacheSize() {
  // Get multiple script properties in one call, then log them all.
  var scriptProperties = PropertiesService.getScriptProperties();
  var data = scriptProperties.getProperties();
  var store_size = 0;
  for (var key in data) {
    //Logger.log(data[key])
    Logger.log('Key: %s, Size: %s', key, data[key].length);
    store_size += data[key].length
  }
  Logger.log(store_size);
  if(store_size > 480000){
    GmailApp.sendEmail(MAINTAINER_EMAIL,'Server script properties are at 480kb!','You should check it out: \n\nhttps://docs.google.com/spreadsheets/d/'+SCRIPT_PROP.getProperty("key"));
  }

  return store_size;
}

function clearResponseCacheIfTooBig() {
  if(cacheSize() > 420000) {
    updateAutoScriptProperties();
    GmailApp.sendEmail(MAINTAINER_EMAIL,'Wrote Response Cache to sheets','New size is: '+cacheSize()+'\n\nhttps://docs.google.com/spreadsheets/d/'+SCRIPT_PROP.getProperty("key"));
  }
}

function getLastRow(sheet,column){
  if(column == null){
    //Logger.log(column);
    column = 'A';
  }
  let testColumn = sheet.getRange(column+'1:'+column).getValues();
  let lastRow=0;
  for(cell of testColumn){
    if(cell != ""){
      lastRow += 1;
    }
    else {
      break;
    }
  }
  return lastRow;
}

function validateNumber(number) {
  return number;
}

function setGlobalSumsScriptProperty(){
  let doc = SpreadsheetApp.openById(SCRIPT_PROP.getProperty("key"));
  let sheet = doc.getSheetByName('Config');

  let globalSums = sheet.getRange("A7:B10").getValues();
  let globalSumsOb = {};
  //for each row in the 2d array from getValues();
  for(globalSum of globalSums){
    globalSumsOb[globalSum[0]] = globalSum[1]
  }

  SCRIPT_PROP.setProperty("globalSums", JSON.stringify(globalSumsOb));
}

function onlyUnique(value, index, self) {
  return self.indexOf(value) === index;
}

function GoogleDate(jSdate) { 
   var d = new Date(jSdate) ;
   var googleStart = new Date(Date.UTC(1899,11,30,0,0,0,0)) ; // the starting value for Google
   return ((d.getTime()  - googleStart.getTime())/60000 - d.getTimezoneOffset()) / 1440 ;
}

function deepEqual(object1, object2) {
  const keys1 = Object.keys(object1);
  const keys2 = Object.keys(object2);

  if (keys1.length !== keys2.length) {
    return false;
  }

  for (const key of keys1) {
    const val1 = object1[key];
    const val2 = object2[key];
    const areObjects = isObject(val1) && isObject(val2);
    if (
      areObjects && !deepEqual(val1, val2) ||
      !areObjects && val1 !== val2
    ) {
      return false;
    }
  }

  return true;
}

function isObject(object) {
  return object != null && typeof object === 'object';
}

function ExcelDateToJSDate(serial) {
  var utc_days  = Math.floor(serial - 25569);
  var utc_value = utc_days * 86400;                                        
  var date_info = new Date(utc_value * 1000);

  var fractional_day = serial - Math.floor(serial) + 0.0000001;

  var total_seconds = Math.floor(86400 * fractional_day);

  var seconds = total_seconds % 60;

  total_seconds -= seconds;

  var hours = Math.floor(total_seconds / (60 * 60));
  var minutes = Math.floor(total_seconds / 60) % 60;

  return new Date(date_info.getFullYear(), date_info.getMonth(), date_info.getDate(), hours, minutes, seconds);
}

//=========================================================================================
// CENTRAL FAILURE REPORTING
//
// Every catch block should call notifyFailure() instead of hand-rolling its own email.
//
// Three things here are deliberate, each of them learned the hard way:
//
//  1. Logger.log happens FIRST and unconditionally, so the execution log always has the
//     failure even when mail is broken or over quota.
//
//  2. The whole body is wrapped, because a notification must never be able to fail its
//     caller. That is exactly what took campus registration down: a malformed
//     GmailApp.sendEmail inside writeUsersToSheets() propagated out through doGet and
//     broke registration and device setup for real users.
//
//  3. Sends are throttled by error signature. This shares a daily mail quota with the PIN
//     and registration emails users actually depend on, so a repeating failure must not be
//     able to burn through it. First occurrence goes out immediately; repeats are counted
//     and reported on the next send.
//
// Context must be built from NAMED SCALAR FIELDS ONLY - never JSON.stringify(e). Passing a
// whole Apps Script event object is what the old 'orig_e' bug did: e.postData exists only
// on POST, stringifying it breaks serialization, and the response comes back with no CORS
// header, which looks like a network error rather than a server error.
//=========================================================================================

var FAILURE_DEDUPE_MINUTES = 30;  //same error is counted, not re-sent, inside this window
var FAILURE_DAILY_CAP = 150;      //Enterprise Gmail allows 1500 recipients/day; this leaves the rest for user-facing email
var FAILURE_REDACT_KEYS = ['userpin','pin','password','pwd'];
//Which deployment sent this. Three of the four share MAINTAINER_EMAIL and Latvia's
//spotlight+latvia@cru.org plus-addresses into that same mailbox, so without a marker every failure
//email reads 'Spotlight failure: doGet' and cannot be attributed to an app. Its own constant rather
//than SENDER_NAME, because Latvia does not define SENDER_NAME.
var FAILURE_SUBJECT_PREFIX = 'Spotlight';
var CLIENT_ERROR_SOURCES = ['catchError'];  //every 'where' value lib.js actually sends
var CLIENT_ERROR_DAILY_CAP = 20;            //browser-reported failures get their own, smaller share

function notifyFailure(where, error, context){
  var message = 'unknown error';
  try {
    message = (error && error.message) ? error.message : String(error);
  } catch(e){ /* keep the default */ }

  var contextText = context ? failureContextToText_(context) : '';

  //(1) log first, always, whatever happens below
  Logger.log('FAILURE [' + where + '] ' + message + (contextText ? '\n' + contextText : ''));

  //(2) nothing past this point may throw into the caller
  try {
    //Client-reported failures dedupe on `where` ALONE. Their `message` is whatever an anonymous
    //caller supplied, so including it made the signature space unbounded: one fail_* script
    //property per distinct message, and ~10,500 requests fill the 500kb store that also holds the
    //users/movements/responseCache caches - at which point registration and stats submission break.
    //`where` is allow-listed to two values, so this bounds client signatures at two.
    var fromClientSig = String(where).indexOf('client: ') === 0;
    var signature = fromClientSig ? where : (where + '|' + String(message).split('\n')[0]);
    var key = 'fail_' + failureSignatureKey_(signature);
    var now = new Date().getTime();

    var state = {};
    try { state = JSON.parse(SCRIPT_PROP.getProperty(key)) || {}; } catch(e){ state = {}; }
    var lastSent = state.lastSent || 0;
    var suppressed = state.suppressed || 0;

    //(3a) dedupe: same failure again inside the window is counted, not re-sent
    if(lastSent && (now - lastSent) < FAILURE_DEDUPE_MINUTES * 60 * 1000){
      //No property write here, deliberately. This path runs once per OCCURRENCE - up to one per
      //sheet row in writeUsersToSheets(), which holds the public lock while it does so, and a
      //Script Property write costs 10-50ms. Every occurrence is already in the execution log,
      //because the Logger.log above runs unconditionally. The only thing given up is the
      //"also occurred N more time(s)" line, which is now rarely populated.
      return;
    }

    //(3b) daily cap: protect the quota that sends PIN and registration email
    if(!failureQuotaAvailable_(where)){
      Logger.log('FAILURE notification suppressed: daily cap of ' + FAILURE_DAILY_CAP + ' reached.');
      //No write here at all. Writing carried the OLD lastSent forward, and lastSent is what the
      //dedupe gate above measures against - so it could never re-close. Once the daily cap was spent
      //AND the record was older than the window, EVERY further request performed a Script Property
      //write. Measured: 500 requests -> 500 writes. The store stayed bounded (one key) but the write
      //quota did not, and this path is reachable anonymously through clientError. The suppressed
      //counter is not worth that: every occurrence is already in the execution log, because the
      //Logger.log at the top of notifyFailure runs unconditionally.
      return;
    }

    var body = 'Where:  ' + where + '\n'
             + 'Error:  ' + message + '\n'
             + 'Time:   ' + new Date().toString() + '\n'
             + (contextText ? '\nContext:\n' + contextText + '\n' : '')
             + (suppressed ? '\nThis same failure also occurred ' + suppressed
                             + ' more time(s) since the last notification.\n' : '');

    MailApp.sendEmail(MAINTAINER_EMAIL, FAILURE_SUBJECT_PREFIX + ' failure: ' + where, body);
    SCRIPT_PROP.setProperty(key, JSON.stringify({lastSent: now, suppressed: 0}));
  }
  catch(err){
    //Reporting failed. The Logger.log above already captured the original failure, which is
    //the whole point of doing it first.
    Logger.log('notifyFailure could not send a notification: ' + err.message);
  }
}

//Short, stable key for a Script Property name. Signatures are long and contain characters
//that make poor property names, so hash them.
function failureSignatureKey_(signature){
  var hash = 0;
  for(var i = 0; i < signature.length; i++){
    hash = ((hash << 5) - hash) + signature.charCodeAt(i);
    hash = hash & hash; //force to 32-bit
  }
  return String(Math.abs(hash));
}

//Named scalars only, pins redacted. Nested objects are omitted rather than stringified -
//see the note about 'orig_e' at the top of this section.
function failureContextToText_(context){
  var lines = [];
  try {
    for(var k of Object.keys(context)){
      var v = context[k];
      if(v === null || v === undefined){ v = ''; }
      if(typeof v === 'object'){ v = '[object omitted]'; }
      if(FAILURE_REDACT_KEYS.indexOf(String(k).toLowerCase()) > -1){ v = '[redacted]'; }
      //Also scrub a pin embedded INSIDE a value, not just a value under a pin-named key.
      //Call sites are expected to strip it, but this is the one place that guarantees it -
      //and the whole reason this helper exists is that pins were reaching admin email.
      v = String(v).replace(/(userPin|pin|password)=[^&+\s]*/gi, '$1=[redacted]');
      //Same job again for the JSON shape. The POST path reports its context as
      //JSON.stringify(payload), where the pin reads "userPin":"1234" - a colon, not an equals -
      //so the rule above sails straight past it and the pin reached the maintainer inbox in
      //clear text. Matches a quoted or a bare value, since a numeric pin stringifies unquoted.
      v = String(v).replace(/"(userPin|pin|password)"\s*:\s*("[^"]*"|[^,}\]\s]+)/gi, '"$1":"[redacted]"');
      lines.push('  ' + k + ': ' + v.substring(0, 4000));
    }
  } catch(e){
    return '  [context unavailable: ' + e.message + ']';
  }
  return lines.join('\n');
}

//Counts a send against today's budget. Returns false once the cap is hit.
//
//Browser-reported failures ('client: ...') are ALSO counted against their own, smaller allowance.
//clientError() is an anonymous endpoint and its 'message' is still whatever the caller supplied, so
//a flood of distinct messages would be a flood of distinct dedupe signatures, each earning its own
//send. Capping them separately means that can never spend the budget the server-side reports - the
//ones that tell you the app is broken - depend on.
//
//Checked from inside notifyFailure, AFTER the dedupe gate, rather than up in clientError(): a report
//that is going to be deduped anyway then costs no property write at all.
function failureQuotaAvailable_(where){
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var day = {};
  try { day = JSON.parse(SCRIPT_PROP.getProperty('fail_day')) || {}; } catch(e){ day = {}; }
  if(day.date !== today){
    day = {date: today, sent: 0, clientSent: 0};
    pruneFailureState_(); //new day - drop throttle records that can no longer throttle anything
  }
  var fromClient = String(where).indexOf('client: ') === 0;
  if(day.sent >= FAILURE_DAILY_CAP){ return false; }
  if(fromClient && (day.clientSent || 0) >= CLIENT_ERROR_DAILY_CAP){
    Logger.log('FAILURE notification suppressed: daily client cap of ' + CLIENT_ERROR_DAILY_CAP + ' reached.');
    return false;
  }
  day.sent += 1;
  if(fromClient){ day.clientSent = (day.clientSent || 0) + 1; }
  SCRIPT_PROP.setProperty('fail_day', JSON.stringify(day));
  return true;
}

//Sweeps expired throttle records. These CANNOT be deleted when the notification is sent - the
//record IS the throttle state, and lastSent is what the dedupe window measures against, so
//clearing it on send would let the very next occurrence mail again and turn the throttle into a
//no-op. What they need is expiry, not deletion on use.
//
//The cutoff is a day rather than FAILURE_DEDUPE_MINUTES. A record is useless as a THROTTLE once
//it is older than the dedupe window, but it still carries the suppressed count that the next
//notification reports, and this only runs once a day anyway - so a longer cutoff keeps that
//count honest for the whole day at no practical cost in storage.
//
//Storage is not really the point: at roughly 60 bytes a record it would take thousands of
//DISTINCT error signatures to approach the 480kb that Config.gs already warns about. It matters
//because a signature that varies per occurrence - the 'client: ...' path forwards whatever text
//the browser produced - would both accumulate records AND defeat the dedupe, mailing every time
//up to the daily cap. If these ever pile up, that is the thing to go and look at.
var FAILURE_STATE_TTL_HOURS = 24;

function pruneFailureState_(){
  try {
    var cutoff = new Date().getTime() - (FAILURE_STATE_TTL_HOURS * 60 * 60 * 1000);
    var props = SCRIPT_PROP.getProperties();
    var removed = 0;
    for(var k of Object.keys(props)){
      if(k.indexOf('fail_') !== 0 || k === 'fail_day'){ continue; } //never the day counter itself
      var state = null;
      try { state = JSON.parse(props[k]); } catch(e){ state = null; }
      //Unreadable records go too: they cannot be parsed, so they cannot throttle either.
      if(!state || !state.lastSent || state.lastSent < cutoff){
        SCRIPT_PROP.deleteProperty(k);
        removed += 1;
      }
    }
    if(removed){ Logger.log('pruned ' + removed + ' expired failure-tracking property(ies)'); }
  }
  catch(err){
    //Reached only from inside notifyFailure's own try, but belt and braces: housekeeping must
    //never be the reason a failure notification fails.
    Logger.log('pruneFailureState_ could not run: ' + err.message);
  }
}

//Safe context for a web-app request. Named fields only, and never the event object itself.
function requestContext(e){
  var c = {};
  try {
    if(!e){ return {note: 'no event object'}; }
    if(e.parameter){
      var interesting = ['movements','requestUser','registerUser','updateUser','requestPin',
                         'requestSummary','clientError','phone','userPhone','movementId','cat'];
      for(var k of interesting){
        if(e.parameter[k] !== undefined){ c[k] = String(e.parameter[k]).substring(0, 120); }
      }
    }
    if(e.parameters && e.parameters.movementId){ c.movementCount = e.parameters.movementId.length; }
    if(e.postData && e.postData.type){ c.postDataType = e.postData.type; }
    if(e.postData && e.postData.contents){ c.postDataLength = String(e.postData.contents).length; }
  }
  catch(err){ c.note = 'context extraction failed: ' + err.message; }
  return c;
}

//Standard failure body, so the shape stays consistent across handlers.
//
//Do NOT use this in doGet/doPost's catch. Returning parseable JSON there turns an HTTP 500 into an
//HTTP 200, and every client cached before the doPost migration reads any 200 as success: it stores
//an undefined user (localStorage gets the literal string "undefined", so the next getUser() throws
//and wipes everything) and clears the stats the person just entered. A crash must keep coming back
//as a 500 - see the comment in doGet(). Use this only for deliberate, non-crash refusals.
function jsonFailure(code, text){
  return ContentService
    .createTextOutput(JSON.stringify({'result':'failure', 'code': code, 'text': text}))
    .setMimeType(ContentService.MimeType.JSON);
}

//Manual test - run from the editor. Sends one email, then proves the dedupe path.
function testNotifyFailure(){
  var fakeError = new Error('deliberate test failure');
  notifyFailure('testNotifyFailure', fakeError, {movementId: 'TEST1', userPhone: '0000000000', userPin: '1234'});
  notifyFailure('testNotifyFailure', fakeError, {movementId: 'TEST1'});
  notifyFailure('testNotifyFailure', fakeError, {movementId: 'TEST1'});
  Logger.log('Expect ONE email above, with userPin shown as [redacted], and two suppressed repeats.');
  Logger.log('Run testClearFailureState() to reset before testing again.');
}

//Clears the throttle bookkeeping so the notification tests can be re-run.
function testClearFailureState(){
  var props = SCRIPT_PROP.getProperties();
  var cleared = 0;
  for(var k of Object.keys(props)){
    if(k.indexOf('fail_') === 0){ SCRIPT_PROP.deleteProperty(k); cleared += 1; }
  }
  Logger.log('cleared ' + cleared + ' failure-tracking propertie(s)');
}

//=========================================================================================
// SENDER IDENTITY
//
// Two addresses, two jobs, deliberately kept apart:
//
//   MAINTAINER_EMAIL - RECIPIENT ONLY, never a 'from'. Where breakage is reported. Needs no
//                      alias, no access, no mailbox ownership, so it keeps working no matter
//                      which account happens to be executing the script or its triggers.
//
//   SUPPORT_EMAIL    - the identity USERS see: the 'from' on user-facing mail, the address
//                      printed inside it, and where support notices (a registration, a pin
//                      request) are sent so a human can act on them. This one must be a Gmail
//                      send-as alias ON THE EXECUTING ACCOUNT, and must be monitored.
//
// A 'from' that is not a send-as alias is SILENTLY IGNORED by Gmail - the mail simply goes out
// from the raw account address instead. So check it and report, rather than letting the sender
// change without anyone noticing.
//=========================================================================================

var SEND_AS_ALIASES_CACHE = null;

function getSendAsAliases(){
  if(SEND_AS_ALIASES_CACHE === null){
    try {
      SEND_AS_ALIASES_CACHE = GmailApp.getAliases();
    } catch(err){
      //No Gmail scope, or a service account with no aliases at all.
      SEND_AS_ALIASES_CACHE = [];
    }
  }
  return SEND_AS_ALIASES_CACHE;
}

//Options for any user-facing email. Use this instead of writing {'from': ...} by hand, so the
//alias check can never be skipped at a call site.
function senderOptions(){
  let options = {'name': SENDER_NAME};
  if(getSendAsAliases().indexOf(SUPPORT_EMAIL) > -1){
    options.from = SUPPORT_EMAIL;
  }
  else {
    //Omit 'from' entirely rather than passing one Gmail will drop. Same visible outcome, but now
    //it is reported instead of silent.
    notifyFailure('senderOptions',
      new Error('SUPPORT_EMAIL is not a send-as alias on the executing account, so user-facing '
              + 'mail is going out from that account instead'),
      {supportEmail: SUPPORT_EMAIL,
       aliasesAvailable: getSendAsAliases().join(', ') || '(none)'});
  }
  return options;
}

//Manual check - run from the editor to confirm the executing account can actually send as
//SUPPORT_EMAIL. Worth running after any change of script owner or authorisation.
function testSenderAlias(){
  let aliases = getSendAsAliases();
  Logger.log('SUPPORT_EMAIL:      ' + SUPPORT_EMAIL);
  Logger.log('MAINTAINER_EMAIL:   ' + MAINTAINER_EMAIL + '  (recipient only - no alias needed)');
  Logger.log('send-as aliases:    ' + (aliases.length ? aliases.join(', ') : '(none)'));
  Logger.log(aliases.indexOf(SUPPORT_EMAIL) > -1
    ? 'OK - user-facing mail will come from ' + SUPPORT_EMAIL
    : 'PROBLEM - Gmail will ignore the from and send as the executing account instead.');
}
