//Form-urlencoded decode: '+' means a space, and only then percent-decode. That order keeps a
//literal plus the user actually typed (%2B) intact, and treats a missing or literally
//"undefined" value as empty - decodeURIComponent(undefined) returns the STRING "undefined",
//which is how that word ended up in the storyBox column of the Responses sheet.
//At file scope rather than nested, because emailTeamStories() and writeCacheToSheets() need it too.
function formDecode(value){
  if(value === undefined || value === null || value === 'undefined'){ return ''; }
  try {
    return decodeURIComponent(String(value).replace(/\+/g, ' '));
  } catch(err){
    //A malformed percent-escape - a story truncated mid-'%E2' - throws URIError and used to take
    //the whole submission down. The raw text is worth more than a dead save.
    return String(value).replace(/\+/g, ' ');
  }
}

//A pin must never become a sheet column name. Anchored, and tested against the DECODED name, so it
//catches a bare "userPin" and the encoded "userPin%3D1983" (which decodes to "userPin=1983" and
//hits the \W branch) without also matching innocent fields that merely contain those letters -
//"equipping_leaders" and "helping_hands" both contain "pin".
function isSecretParamName(name){
  return /^(userpin|pin|password)(\W|$)/i.test(formDecode(name));
}

function saveResponseToCache(e){
  //Logger.log(e.queryString);
  let phone = e.queryString.match(/userPhone=(\d*)&/)[1];
  let pinRegex = /userPin(\=[^&]*)?(&|$)|^userPin(\=[^&]*)?(&|$)/g;
  let pin = e.queryString.match(/userPin=(\d*)&/)[1];

  //Every arrival here is a client still running the pre-doPost JS. notifyFailure dedupes and caps,
  //so this cannot flood the inbox - it exists to show when the legacy path is safe to delete.
  notifyFailure('legacy GET submission',
                new Error('client submitted via the pre-JSON query-string path'),
                requestContext(e));

  //'+' did two jobs in the old client: it separated one movement's submission from the next, AND
  //per form-urlencoding it encoded a space inside a value. Splitting on it blindly therefore tore
  //every multi-word story apart at its spaces, which produced junk rows and junk columns.
  //Every real submission carries movementId=; a torn-off story fragment never does. So a chunk
  //without it is a continuation, and the '+' that split them was a space - rejoin and the original
  //submission comes back whole, story and all. Nothing is discarded.
  let rawChunks = e.queryString.replace(pinRegex,'').split('+');
  let formSubs = [];
  for(let chunk of rawChunks){
    if(formSubs.length === 0 || chunk.indexOf('movementId=') > -1){
      formSubs.push(chunk);
    }
    else {
      formSubs[formSubs.length - 1] += '+' + chunk;
    }
  }
  if(formSubs.length !== rawChunks.length){
    Logger.log('saveResponseToCache: rejoined ' + (rawChunks.length - formSubs.length)
               + ' story fragment(s) that the old + format had split apart');
  }

  //storyBox must actually HAVE a value to count as a story. The previous pattern made the "=value"
  //part optional, so a bare "storyBox" param (no '=' at all) still matched, and the follow-up
  //replace('storyBox=','') then found nothing to strip - leaving the literal word "storyBox" as the
  //story text. That is what got cached and mailed out to team leaders as somebody's story.
  //Capturing the value directly removes the string surgery that made that possible.
  var storyRegex = /(?:^|&)storyBox=([^&]+)/;
  var movementRegex = /&movementId(\=[^&]*)?(?=&|$)|^movementId(\=[^&]*)?(&|$)/;

  let listOfStories = [];
  for(formSub of formSubs){
    let storyMatch = formSub.match(storyRegex);
    if(storyMatch){
      let storyBox = formDecode(storyMatch[1]);
      if(storyBox.trim() !== ''){ //a blank or whitespace-only box is not a story
        //A torn fragment can carry a storyBox with no movementId at all, and then .match()
        //returns null and [0] throws - uncaught, because this loop is outside the try below.
        let movementMatch = formSub.match(movementRegex);
        if(!movementMatch){
          notifyFailure('saveResponseToCache', new Error('story fragment carried no movementId'),
                        {phone: phone});
          continue;
        }
        //Now we need to email the right person.
        let movement = movementMatch[0].replace('&','').replace('movementId=','');
        //Re-encode after form-decoding, because emailTeamStories() decodes every storyCache entry -
        //so it needs real spaces, not the raw '+' form that would render as Great+things+happened.
        listOfStories.push([movement,encodeURIComponent(storyBox),phone]);
      }
    }
  }

  //Capture the boundary and put it back with $1 instead of consuming it. The old second alternative
  //(^storyBox\=([^&]+)(&|$)) swallowed the trailing '&', which glued the next parameter onto the
  //story flag - "&storyBox=1teamQ1=1" - losing teamQ1's value and creating an empty-named column.
  storyRegex = /(^|&)storyBox=[^&]+/;  //only matches entries that actually have a value

  formSubs = formSubs.map(formSub => formSub.replace(storyRegex, '$1storyBox=1')); //record that we had a story
  formSubs = formSubs.map(form => form.split('&')
    .filter(param => param !== '')
    .map(function(param){
      return [param.split('=')[0], formDecode(param.split('=')[1])];
    })
    //A pin must never become a sheet column. The pinRegex above only catches a literal "userPin=",
    //so an encoded one (userPin%3D1983, which is what a rejoined boundary carries) used to survive
    //and create its own column - naming the column after somebody's pin.
    .filter(param => !isSecretParamName(param[0])));

  for(form of formSubs){
    form.push(['Timestamp',GoogleDate(new Date())]);
  }

  let result = false;
  //Logger.log(JSON.stringify(formSubs));
  //locking to be sure that we don't overwrite the same variable twice.  
  let lock = LockService.getPublicLock();
  lock.waitLock(30000);  // wait 30 seconds before conceding defeat.

  try {
    //store story cache
    let storyCache = (JSON.parse(SCRIPT_PROP.getProperty('storyCache')) || []);
    storyCache.push(...listOfStories);
    SCRIPT_PROP.setProperty('storyCache',JSON.stringify(storyCache));

    //FIRST write Response Cache
    let responseCache = (JSON.parse(SCRIPT_PROP.getProperty('responseCache')) || []);
    responseCache.push(...formSubs);
    SCRIPT_PROP.setProperty('responseCache',JSON.stringify(responseCache));

    //get reference tables, used in updateMovements, SummarizeMovements, and GatherUser
    let strategies = getStrategies();
    let teams = getTeams();
    let global = JSON.parse(SCRIPT_PROP.getProperty('globalSums'));

    //SECOND Update movements in Cache
    updateMovementsInCache(formSubs, strategies, teams, global);
    
    //THIRD Update user profile information
    let movements = e.parameters.movementId;
    let mvmnts = {};
    for(movement of movements){
      mvmnts[movement] = new Date().toLocaleString().split(',')[0];
    }
    updateUserInCache(phone, mvmnts, false, pin); 
    if(lock.hasLock()){ lock.releaseLock(); }

    //FITH Gather user information
    let userInfo = gatherUserInfo(phone);

    //FOURTH Summarize movements
    let summary = summarizeMovements(Object.keys(userInfo.mvmnts), strategies, teams, global);


    result = {'summary': summary, 'userInfo': userInfo};
    
  } catch (error) {
    //The query string is kept deliberately: it is the only complete copy of the submission,
    //and it is what made recovering people's stories possible. But userPin is stripped first -
    //pins had no business being in admin email, least of all after a migration whose whole
    //point was getting them out of URLs.
    //hasLock(), because the success path above already releases it partway through the try: whether
    //we still hold it here depends on how far execution got before throwing.
    if(lock.hasLock()){ lock.releaseLock(); } //released first: reporting must not hold the lock
    notifyFailure('saveResponseToCache', error,
                  {phone: phone,
                   submission: String(e.queryString).replace(/userPin=[^&+]*/g, 'userPin=[redacted]')});
  }
  return result;
}

//JSON version of saveResponseToCache, used by doPost -> saveFormJSON.  Produces the exact same
//formSubs shape (an array of [key,value] pairs per submission) and the same listOfStories shape that
//the legacy function does, so nothing downstream - updateMovementsInCache, writeCacheToSheets,
//emailTeamStories, InfobaseConnection - needs any changes.
//
//Deliberately matches the legacy function's quirks: userPin never becomes a recorded field (the
//legacy pinRegex strips it, so it has never been a sheet column), the storyBox column only ever
//records that a story was present, and the story text itself is percent-encoded into storyCache
//because emailTeamStories() calls decodeURIComponent on every entry.
function saveResponseToCacheFromJSON(payload){
  let pin = payload.userPin;
  let submissions = payload.submissions;
  let phone = submissions[0].userPhone;

  //Never let null/undefined or the literal string "undefined" reach the sheet.
  function cleanValue(value){
    return (value === null || value === undefined || value === 'undefined') ? '' : value;
  }

  let listOfStories = [];
  let formSubs = [];

  for(let sub of submissions){
    let entries = [];

    for(let key of Object.keys(sub)){
      let value = cleanValue(sub[key]);

      if(key === 'storyBox'){
        if(value !== ''){
          //Now we need to email the right person.
          listOfStories.push([String(sub.movementId), encodeURIComponent(value), phone]);
        }
        entries.push(['storyBox', (value !== '') ? '1' : '']); //record that we had a story
      }
      else {
        entries.push([key, value]);
      }
    }

    entries.push(['Timestamp', GoogleDate(new Date())]);
    formSubs.push(entries);
  }

  let result = false;
  //locking to be sure that we don't overwrite the same variable twice.
  let lock = LockService.getPublicLock();
  lock.waitLock(30000);  // wait 30 seconds before conceding defeat.
  let errorLocation = 0;
  try {
    //store story cache
    let storyCache = (JSON.parse(SCRIPT_PROP.getProperty('storyCache')) || []);
    storyCache.push(...listOfStories);
    SCRIPT_PROP.setProperty('storyCache', JSON.stringify(storyCache));
    errorLocation += 1;

    //FIRST write Response Cache
    let responseCache = (JSON.parse(SCRIPT_PROP.getProperty('responseCache')) || []);
    responseCache.push(...formSubs);
    SCRIPT_PROP.setProperty('responseCache', JSON.stringify(responseCache));
    errorLocation += 1;

    //get reference tables, used in updateMovements, SummarizeMovements, and GatherUser
    let strategies = getStrategies();
    let teams = getTeams();
    let global = JSON.parse(SCRIPT_PROP.getProperty('globalSums'));
    errorLocation += 1;

    //SECOND Update movements in Cache
    updateMovementsInCache(formSubs, strategies, teams, global);
    errorLocation += 1;

    //THIRD Update user profile information
    let mvmnts = {};
    for(let sub of submissions){
      mvmnts[sub.movementId] = new Date().toLocaleString().split(',')[0];
    }
    updateUserInCache(phone, mvmnts, false, pin);
    if(lock.hasLock()){ lock.releaseLock(); }
    errorLocation += 1;

    //FITH Gather user information
    let userInfo = gatherUserInfo(phone);
    errorLocation += 1;

    //FOURTH Summarize movements
    let summary = summarizeMovements(Object.keys(userInfo.mvmnts), strategies, teams, global);
    errorLocation += 1;

    result = {'summary': summary, 'userInfo': userInfo};

  } catch (error) {
    //hasLock(), because the success path above already releases it partway through the try: whether
    //we still hold it here depends on how far execution got before throwing.
    if(lock.hasLock()){ lock.releaseLock(); } //released first: reporting must not hold the lock
    //Routed through notifyFailure so this path is deduped, capped and pin-redacted like every
    //other failure. The payload is kept because it is the only full copy of the submission.
    //The pin comes out of a shallow copy first, so the original payload is untouched.
    //failureContextToText_ redacts a JSON-shaped pin as a backstop, but the call site should
    //not be handing it one at all.
    let safePayload = {};
    for(let k of Object.keys(payload || {})){ safePayload[k] = payload[k]; }
    safePayload.userPin = '[redacted]';
    notifyFailure('saveResponseToCacheFromJSON', error,
                  {step: errorLocation, phone: phone,
                   submission: JSON.stringify(safePayload)});
  }
  return result;
}

//An entry whose text is empty, or literally "storyBox" or "undefined", is parser damage rather than
//anybody's story - those are the exact shapes the old query-string parser manufactured, and what
//got mailed to a team leader as five people's stories. Whole-string match after trimming, never a
//substring, so a real story that happens to contain the word survives.
function isPoisonedStory_(decodedText){
  var t = String(decodedText).trim();
  return t === '' || t === 'storyBox' || t === 'undefined';
}

//Remove specific entries from storyCache, re-reading under the lock rather than writing back a
//snapshot taken at the top of the digest: a submission that lands WHILE the digest is running would
//otherwise be erased. The old blanket deleteProperty did exactly that.
//Never throws - a failure here must not abort a digest that has already sent mail.
function dropStoriesFromCache_(storiesToDrop){
  if(!storiesToDrop || storiesToDrop.length === 0){ return; }
  var lock = LockService.getPublicLock();
  try {
    lock.waitLock(30000);
    var current = JSON.parse(SCRIPT_PROP.getProperty('storyCache')) || [];
    var drop = {};
    for(var i = 0; i < storiesToDrop.length; i++){
      var dk = JSON.stringify(storiesToDrop[i]);
      drop[dk] = (drop[dk] || 0) + 1;
    }
    var kept = [];
    for(var j = 0; j < current.length; j++){
      var k = JSON.stringify(current[j]);
      if(drop[k]){ drop[k] -= 1; }  //one occurrence at a time, so identical stories aren't over-removed
      else { kept.push(current[j]); }
    }
    if(kept.length === 0){ SCRIPT_PROP.deleteProperty('storyCache'); }
    else { SCRIPT_PROP.setProperty('storyCache', JSON.stringify(kept)); }
  }
  catch(err){
    //Loud, because anything left in the cache is a candidate for being mailed twice.
    Logger.log('dropStoriesFromCache_ failed, entries remain queued: ' + err.message
               + '\n' + JSON.stringify(storiesToDrop));
    notifyFailure('emailTeamStories: could not clear sent stories from the cache', err,
                  {entries: storiesToDrop.length});
  }
  finally {
    try { lock.releaseLock(); } catch(e){ /* never held, or already released */ }
  }
}

//Readable enough that a team leader's digest can be rebuilt and forwarded from the failure email
//alone, without going back to the sheet.
function undeliveredStoriesText_(stories, movements, users){
  var lines = [];
  for(var i = 0; i < stories.length; i++){
    var movementId = stories[i][0];
    var phone = stories[i][2];
    var who = (users && users[phone] && users[phone].name) ? users[phone].name : phone;
    var where = (movements && movements[movementId] && movements[movementId].name)
                ? movements[movementId].name : movementId;
    lines.push('• ' + who + ' (' + where + '): ' + formDecode(stories[i][1]));
  }
  return lines.join('\n');
}

function emailTeamStories(){
  //Now send emails to the team leaders.
  let teamStories = {};
  let movements = JSON.parse(SCRIPT_PROP.getProperty("movements"));
  let teams = getTeams();
  let users = JSON.parse(SCRIPT_PROP.getProperty('users'));
  let listOfStories = JSON.parse(SCRIPT_PROP.getProperty('storyCache')) || [];

  //Drop parser damage before grouping, so it can neither be mailed nor left to re-queue.
  let clean = [];
  let poisoned = [];
  let unmatched = [];  //stories whose movement id is not in the cache - dropped in one batch below
  for(let story of listOfStories){
    //A malformed entry must not abort the whole digest. This pre-pass sits OUTSIDE the per-story try
    //below, so without this guard a single null in storyCache threw here and NO team received
    //anything - and because nothing then drained the cache, every later run failed identically.
    //Nothing in this codebase writes such an entry (every writer pushes [movementId, story, phone]),
    //so this is defensive: it covers a hand-edited Script Property or a future writer.
    if(!story || !Array.isArray(story) || story.length < 3){ poisoned.push(story); continue; }
    if(isPoisonedStory_(formDecode(story[1]))){ poisoned.push(story); }
    else { clean.push(story); }
  }
  if(poisoned.length){
    //Logged rather than silent: if this ever drops a real story, this line is the evidence.
    Logger.log('emailTeamStories: dropped ' + poisoned.length
               + ' unusable story entry/entries: ' + JSON.stringify(poisoned));
    dropStoriesFromCache_(poisoned);
  }

  for(let story of clean){  //need to associate the stories with a team and it's associated email address
    try {
      let teamID = movements[story[0]].tID;
      if(!teamStories[teamID]){ //make sure we have a defined team in the teamStories object
        teamStories[teamID] = [];
      }
      teamStories[teamID].push(story);
    }
    catch (error) {
      //Collected, not reported one at a time. The movement id used to sit in 'where', which IS the
      //dedupe signature, so a stale movements cache sent one email per unknown id - 150 of them in
      //a single run, spending the entire daily budget and silencing every other failure report
      //until midnight. getMovements() already keeps its id in the context; this now matches.
      unmatched.push(story);
    }
  }
  //One report and one drop for the whole loop. dropStoriesFromCache_() takes the public lock and
  //rewrites the entire storyCache on every call, so doing either once per story contended with
  //writeCacheToSheets() and ate into the 6-minute execution limit.
  //
  //One email naming every unknown id is also far more useful than 150 separate ones: the cause is
  //almost always a single stale movements cache. The story text rides along in the context, so
  //notifyFailure's unconditional Logger.log preserves it even if the mail cap is already spent.
  if(unmatched.length){
    notifyFailure('emailTeamStories: stories matched no movement',
                  new Error(unmatched.length + ' story entry/entries carried a movement id that is not in the cache'),
                  {count: unmatched.length,
                   movementIds: unmatched.map(function(s){ return s[0]; }).join(', '),
                   stories: undeliveredStoriesText_(unmatched, movements, users)});
    dropStoriesFromCache_(unmatched);
  }
  //then send all the stories for each team.  We don't assume that all movements in a submission are associated with the same team.
  for(let teamID of Object.keys(teamStories)) {
    let stories = teamStories[teamID];
    let teamName = teamID;
    let question = '';
    try {
      let team = teams[teamID];
      if(!team || !team.storyBox){
        throw new Error('team has no storyBox question configured');
      }
      let storyBox = team.storyBox;
      teamName = team.name;
      let email_match = storyBox.match(/Ͱ.*?ͱ/);
      if(email_match == null){
        //No recipient configured, so nothing was ever meant to be sent. Not a failure - but the
        //entries still have to go, or they sit in the cache forever.
        Logger.log('emailTeamStories: team ' + teamID + ' has no notification address; dropping '
                   + stories.length + ' story entry/entries');
        dropStoriesFromCache_(stories);
        continue;
      }
      let email = email_match[0].replace(/Ͱ|ͱ/g,'');
      let subject = 'StoryBox: ' + teamName + ' as of ' + new Date().toLocaleDateString();
      question = storyBox.replace(/^.*ͱ/,'');
      let body = `Hi ${teamName},

You've got new comments for your question: "${question}"\n\n`;

      //group our movements
      let mvmnts = {};

      for(let story of stories){
        let movementId = story[0];
        let storyTxt = story[1];
        let phone = story[2];
        //An unregistered phone threw here and took the whole digest down with it. The story is the
        //point; a missing name is not worth losing every team's email over.
        let who = (users && users[phone] && users[phone].name) ? users[phone].name : phone;
        let record = `• ${who}: \n     ${formDecode(storyTxt)}\n`;
        if(mvmnts[movementId] == undefined){
          mvmnts[movementId] = [];
        }
        mvmnts[movementId].push(record);
      }
      for(let mvmnt of Object.keys(mvmnts)) {
        let mvmntName = (movements[mvmnt] && movements[mvmnt].name) ? movements[mvmnt].name : mvmnt;
        //join('') - the bare join() defaults to ',' and every record already ends in '\n', which is
        //what put ",•" in front of every name after the first.
        body += `${mvmntName}\n ${mvmnts[mvmnt].join('')}`
      }
      body += '\n - Spotlight'

      let draft = GmailApp.createDraft(email, subject, body, senderOptions());
      draft.send()
      //GmailApp.moveMessageToTrash(draft.send());

      //Sent. Drop these now so the next run cannot mail them a second time.
      dropStoriesFromCache_(stories);
    }
    catch (error) {
      //No retry. Hand the content to the admin and drop it: leaving it queued is what let one
      //broken team re-send every other team's digest on every subsequent run.
      //teamID MUST be in 'where'. notifyFailure dedupes on where + the first line of the message for
      //FAILURE_DEDUPE_MINUTES, every team in a run fails seconds apart, and a systemic cause gives
      //them all the same message - so a shared 'where' would suppress every team after the first and
      //destroy the very content this email exists to preserve.
      let readable = undeliveredStoriesText_(stories, movements, users);
      //Logged separately as well: failureContextToText_ truncates each value at 4000 characters,
      //and the execution log is the only copy that is not subject to the daily mail cap.
      Logger.log('emailTeamStories: undelivered stories for team ' + teamID + '\n' + readable);
      notifyFailure('emailTeamStories: undelivered stories for team ' + teamID, error,
                    {teamID: teamID, team: teamName, question: question, stories: readable});
      dropStoriesFromCache_(stories);
    }
  }

  return;
}

function testStoryCache(){
  Logger.log(SCRIPT_PROP.getProperty('storyCache'));
 // SCRIPT_PROP.deleteProperty('storyCache');
}

function testResponseCache(){
  Logger.log(SCRIPT_PROP.getProperty('responseCache'));
  let e = {
  "contextPath": "",
  "parameters": {
    "endDate": [
      "11/7/2022"
    ],
    "spiritual_conversations": [
      "1"
    ],
    "storyBox": [
      ""
    ],
    "startDate": [
      "11/7/2022"
    ],
    "userPin": [
      "6729"
    ],
    "teamQ3": [
      "1"
    ],
    "personal_decisions": [
      "1"
    ],
    "teamQ2": [
      "1"
    ],
    "teamQ1": [
      "1"
    ],
    "userPhone": [
      "4145145566"
    ],
    "movementId": [
      "c10338"
    ],
    "userName": [
      "Joshua Graham"
    ],
    "holy_spirit_presentations": [
      "1"
    ],
    "personal_evangelism": [
      "1"
    ]
  },
  "contentLength": -1,
  "parameter": {
    "userPhone": "4145145566",
    "personal_decisions": "1",
    "movementId": "c10338",
    "endDate": "11/7/2022",
    "teamQ2": "1",
    "startDate": "11/7/2022",
    "userName": "Joshua Graham",
    "personal_evangelism": "1",
    "teamQ3": "1",
    "spiritual_conversations": "1",
    "storyBox": "",
    "holy_spirit_presentations": "1",
    "userPin": "6729",
    "teamQ1": "1"
  },
  "queryString": "userPin=6729&startDate=11%2F7%2F2022&endDate=11%2F7%2F2022&movementId=c10338&userName=Joshua+Graham&userPhone=4145145566&spiritual_conversations=1&personal_evangelism=1&personal_decisions=1&holy_spirit_presentations=1&teamQ1=1&teamQ2=1&teamQ3=1&storyBox="
}
  //Logger.log(saveResponseToCache(e))
}

function writeCacheToSheets(){
  // shortly after my original solution Google announced the LockService[1]
  // this prevents concurrent access overwritting data
  // [1] http://googleappsdeveloper.blogspot.co.uk/2011/10/concurrency-and-google-apps-script.html
  // we want a public lock, one that locks for all invocations
  let lock = LockService.getPublicLock();
  
  // set where we write the data - you could write to multiple/alternate destinations
  var doc = SpreadsheetApp.openById(SCRIPT_PROP.getProperty("key"));
  var sheet = doc.getSheetByName(RESPONSE_SHEET);

  lock.waitLock(30000);  // wait 30 seconds before conceding defeat.

  let formSubs = JSON.parse(SCRIPT_PROP.getProperty('responseCache'));

  if(formSubs){    
    let missing_params = [];
    //first loop through each sub and make sure that all headers are present.
    let headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    
    for(sub of formSubs){
      let param_ob = {};
      
      //create param_ob and add headers if missing
      for(param of sub){
        //This is the ONE place a new column is ever created, which makes it the right place for
        //the invariant: a pin must never become a column name. The parser filters these out
        //upstream, but that only covers the route we know about - and a header, once written, is
        //permanent, because nothing in this project ever deletes one.
        if(isSecretParamName(param[0])){
          Logger.log('writeCacheToSheets: refused to create a column for a credential-shaped '
                     + 'parameter name (value withheld)');
          continue;
        }
        if(!headers.includes(param[0]) && !missing_params.includes(param[0])){ //we need to add this to the headers row.
          missing_params.push(param[0]);
        }
        param_ob[param[0]] = param[1];
      }
    }
    //set new headers and regen the headers var
    if(missing_params.length != 0){
      sheet.getRange(1,sheet.getMaxColumns()+1,1,missing_params.length).setValues([missing_params]);
    }

    let formattedSubs = [];

    //then loop through each submission and build array to save to the sheet.
    headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    for(sub of formSubs){
      let param_ob = {};

      for(param of sub){
        param_ob[param[0]] = param[1];
      }

      var row = [];
      // loop through the header columns
      for (i in headers){
        Logger.log(i);
        let value = param_ob[headers[i]];
        if(value === undefined) { value = ''; }
        row.push(value);
      }
      formattedSubs.push(row);
    }

    var nextRow = sheet.getLastRow()+1; // get next row
    // finally write all subs to the sheet at the end.
    sheet.getRange(nextRow, 1, formattedSubs.length, formattedSubs[0].length).setValues(formattedSubs);
    
    SpreadsheetApp.flush();
    setMovementsScriptProperty();
    SCRIPT_PROP.deleteProperty('responseCache');

  }
  lock.releaseLock();
}
