function saveResponseToCache(e){
  let phone = e.queryString.match(/userPhone=(\d*)&/)[1];
  let formSubs = e.queryString.split('+');

  var storyRegex = /&storyBox(\=[^&]*)?(?=&|$)|^storyBox(\=[^&]*)?(&|$)/;
  var movementRegex = /&movementId(\=[^&]*)?(?=&|$)|^movementId(\=[^&]*)?(&|$)/;

  let listOfStories = [];
  for(formSub of formSubs){
    let storyBox = formSub.match(storyRegex);
    if(storyBox){ //there's a match, and the match isn't empty
      storyBox = storyBox[0].replace('&','').replace('storyBox=','');
      if(storyBox != ''){
        //Now we need to email the right person.
        let movement = formSub.match(movementRegex)[0].replace('&','').replace('movementId=','');
        listOfStories.push([movement,storyBox]);
      }
    }
  }
    
  formSubs = formSubs.map(formSub => formSub.replace(storyRegex, '')); //remove all our storyBox entries.
  formSubs = formSubs.map(form => form.split('&').map(param => [param.split('=')[0],decodeURIComponent(param.split('=')[1])]));

  for(form of formSubs){
    form.push(['Timestamp',GoogleDate(new Date())]);
  }

  let result = false;
  
  //locking to be sure that we don't overwrite the same variable twice.  
  let lock = LockService.getPublicLock();
  lock.waitLock(30000);  // wait 30 seconds before conceding defeat.
  let strategies, teams, global;

  try {
    //FIRST write Response Cache
    let responseCache = (JSON.parse(SCRIPT_PROP.getProperty('responseCache')) || []);
    responseCache.push(...formSubs);
    SCRIPT_PROP.setProperty('responseCache',JSON.stringify(responseCache));

    //get reference tables, used in updateMovements, SummarizeMovements, and GatherUser
    strategies = getStrategies();
    teams = getTeams();
    global = JSON.parse(SCRIPT_PROP.getProperty('globalSums'));

    //SECOND Update movements in Cache
    updateMovementsInCache(formSubs, strategies, teams, global);
    
    //THIRD Update user profile information
    let movements = e.parameters.movementId;
    let mvmnts = {};
    for(movement of movements){
      mvmnts[movement] = new Date().toLocaleString().split(',')[0];
    }
    updateUserInCache(phone, mvmnts, false); 
    lock.releaseLock();

    //FOURTH Summarize movements
    let summary = summarizeMovements(movements, strategies, teams, global);

    //FITH Gather user information
    let userInfo = gatherUserInfo(phone);

    result = {'summary': summary, 'userInfo': userInfo};
    
  } catch (error) {
    MailApp.sendEmail('carl.hempel@cru.org', 'Script Error', JSON.stringify(error));
    lock.releaseLock();
  }

  //Now send emails to the team leaders.
  let teamStories = {};
  let movements = JSON.parse(SCRIPT_PROP.getProperty("movements"));
  let users = JSON.parse(SCRIPT_PROP.getProperty('users'));
  for(story of listOfStories){  //need to associate the stories with a team and it's associated email address
    try {
      let teamID = movements[story[0]].tID;
      if(!teamStories[teamID]){ //make sure we have a defined team in the teamStories object
        teamStories[teamID] = [];
      }
      teamStories[teamID].push(story);
    }
    catch {

    }
  }
  //then send all the stories for each team.  We don't assume that all movements in a submission are associated with the same team.
  for(teamID of Object.keys(teamStories)) {
    let storyBox = teams[teamID].storyBox;
    let teamName = teams[teamID].name;
    let email = storyBox.match(/Ͱ.*?ͱ/)[0].replace(/Ͱ|ͱ/g,'');
    let subject = 'StoryBox: ' + teamName
    let question = storyBox.replace(/^.*ͱ/,'');
    let body = `Hi ${teamName},

You've got new comments for your question: "${question}"\n`;

    for(story of teamStories[teamID]){
      body += `- ${movements[story[0]].name}(${users[phone].name}): ${decodeURIComponent(story[1])}\n`;
    }
    body += '\n - Spotlight'

    GmailApp.sendEmail(email, subject, body, {'from': 'spotlight@cru.org', 'name': 'Spotlight'});
  }

  return result;
}

function testResponseCache(){
  Logger.log(SCRIPT_PROP.getProperty('responseCache'))
  let e = {
    "parameter": {
        "groupEvangDec": "0",
        "groupEvang": "0",
        "storyBox": "Jimmy, Bifor",
        "userName": "Carl",
        "endDate": "5/11/2022",
        "holySpiritPres": "0",
        "personalEvang": "0",
        "personalEvangDec": "0",
        "movementId": "sm453",
        "mediaDec": "0",
        "userPhone": "8453320550",
        "media": "0",
        "teamQ1": "0",
        "startDate": "5/10/2022",
        "spiritualConvo": "0"
    },
    "contextPath": "",
    "parameters": {
        "groupEvangDec": [
            "0"
        ],
        "teamQ1": [
            "1"
        ],
        "media": [
            "0"
        ],
        "holySpiritPres": [
            "0"
        ],
        "personalEvangDec": [
            "0"
        ],
        "mediaDec": [
            "0"
        ],
        "spiritualConvo": [
            "0"
        ],
        "userPhone": [
            "8453320550"
        ],
        "userName": [
            "Carl"
        ],
        "endDate": [
            "5/11/2022"
        ],
        "startDate": [
            "5/10/2022"
        ],
        "groupEvang": [
            "0"
        ],
        "movementId": [
            "sm453"
        ],
        "storyBox": [
            "Jimmy, Bifor"
        ],
        "personalEvang": [
            "0"
        ]
    },
    "queryString": "startDate=5%2F10%2F2022&endDate=5%2F11%2F2022&movementId=sm453&userName=Carl&userPhone=8453320550&spiritualConvo=0&personalEvang=0&personalEvangDec=0&holySpiritPres=0&groupEvang=0&groupEvangDec=0&media=0&mediaDec=0&teamQ1=1&storyBox=Jimmy%2C%20Bifor",
    "contentLength": -1
}
  Logger.log(saveResponseToCache(e))
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
