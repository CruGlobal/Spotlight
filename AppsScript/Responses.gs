function saveResponseToCache(e){
  //Logger.log(e.queryString);
  let phone = e.queryString.match(/userPhone=(\d*)&/)[1];
  let pinRegex = /userPin(\=[^&]*)?(&|$)|^userPin(\=[^&]*)?(&|$)/g;
  let pin = e.queryString.match(/userPin=(\d*)&/)[1];

  let formSubs = e.queryString.replace(pinRegex,'').split('+');

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
      let storyBox = storyMatch[1];
      //Decode only to test for emptiness - what gets cached stays the raw encoded value, because
      //emailTeamStories() calls decodeURIComponent on every storyCache entry.
      let asText = storyBox;
      try { asText = decodeURIComponent(storyBox.replace(/\+/g, ' ')); } catch(err) { asText = storyBox; }
      if(asText.trim() !== ''){ //a blank or whitespace-only box is not a story
        //Now we need to email the right person.
        let movement = formSub.match(movementRegex)[0].replace('&','').replace('movementId=','');
        listOfStories.push([movement,storyBox,phone]);
      }
    }
  }

  storyRegex = /&storyBox\=([^&]+)(?=&|$)|^storyBox\=([^&]+)(&|$)/;  //modified to only match entries that have entries.
    
  formSubs = formSubs.map(formSub => formSub.replace(storyRegex, '&storyBox=1')); //record that we had a story
  formSubs = formSubs.map(form => form.split('&').map(param => [param.split('=')[0],decodeURIComponent(param.split('=')[1])]));

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
    lock.releaseLock();

    //FITH Gather user information
    let userInfo = gatherUserInfo(phone);

    //FOURTH Summarize movements
    let summary = summarizeMovements(Object.keys(userInfo.mvmnts), strategies, teams, global);


    result = {'summary': summary, 'userInfo': userInfo};
    
  } catch (error) {
    MailApp.sendEmail(MAINTAINER_EMAIL, 'Script Error', JSON.stringify(error.message) + '\n\n' + JSON.stringify(e.queryString));
    lock.releaseLock();
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
    lock.releaseLock();
    errorLocation += 1;

    //FITH Gather user information
    let userInfo = gatherUserInfo(phone);
    errorLocation += 1;

    //FOURTH Summarize movements
    let summary = summarizeMovements(Object.keys(userInfo.mvmnts), strategies, teams, global);
    errorLocation += 1;

    result = {'summary': summary, 'userInfo': userInfo};

  } catch (error) {
    //Logger.log as well as the email - a failing test otherwise only reports itself by email, which
    //is much slower to debug than reading the execution log directly.
    Logger.log('saveResponseToCacheFromJSON failed at step ' + errorLocation + ': ' + error.message);
    MailApp.sendEmail(MAINTAINER_EMAIL, 'Script Error', JSON.stringify(error.message) + '\n\n' + JSON.stringify(payload) + '\n\n' + errorLocation);
    lock.releaseLock();
  }
  return result;
}

function emailTeamStories(){
  //Now send emails to the team leaders.
  let teamStories = {};
  let movements = JSON.parse(SCRIPT_PROP.getProperty("movements"));
  let teams = getTeams();
  let users = JSON.parse(SCRIPT_PROP.getProperty('users'));
  let listOfStories = JSON.parse(SCRIPT_PROP.getProperty('storyCache')) || [];

  for(story of listOfStories){  //need to associate the stories with a team and it's associated email address
    try {
      let teamID = movements[story[0]].tID;
      if(!teamStories[teamID]){ //make sure we have a defined team in the teamStories object
        teamStories[teamID] = [];
      }
      teamStories[teamID].push(story);
    }
    catch (error) {
      MailApp.sendEmail(MAINTAINER_EMAIL, 'Script Error while trying to send stories', JSON.stringify(error.message));
    }
  }
  //then send all the stories for each team.  We don't assume that all movements in a submission are associated with the same team.
  for(teamID of Object.keys(teamStories)) {
    let storyBox = teams[teamID].storyBox;
    let teamName = teams[teamID].name;
    let email_match = storyBox.match(/Ͱ.*?ͱ/);
    if(email_match == null){
      continue;
    }
    let email = email_match[0].replace(/Ͱ|ͱ/g,'');
    let subject = 'StoryBox: ' + teamName + ' as of ' + new Date().toLocaleDateString();
    let question = storyBox.replace(/^.*ͱ/,'');
    let body = `Hi ${teamName},

You've got new comments for your question: "${question}"\n\n`;

    //group our movements
    let mvmnts = {};

    for(story of teamStories[teamID]){
      let movementId = story[0];
      let storyTxt = story[1];
      let phone = story[2];
      let record = `• ${users[phone].name}: \n     ${decodeURIComponent(storyTxt)}\n`;
      if(mvmnts[movementId] == undefined){
        mvmnts[movementId] = [];
      }
      mvmnts[movementId].push(record);
    }
    for(mvmnt of Object.keys(mvmnts)) {
      body += `${movements[mvmnt].name}\n ${mvmnts[mvmnt].join()}`
    }
    body += '\n - Spotlight'

    let draft = GmailApp.createDraft(email, subject, body, {'from': SUPPORT_EMAIL, 'name': 'Spotlight'});
    draft.send()
    //GmailApp.moveMessageToTrash(draft.send());
  }

  SCRIPT_PROP.deleteProperty('storyCache');

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
