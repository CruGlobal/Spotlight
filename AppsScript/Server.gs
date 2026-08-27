// original from: http://mashe.hawksey.info/2014/07/google-sheets-as-a-database-insert-with-apps-script-using-postget-methods-with-ajax-example/
// original gist: https://gist.github.com/willpatera/ee41ae374d3c9839c2d6 

function doGet(e){
  //SEND movments list ---- USED in Onboarding only
  if(e.parameter.movements){  
    return sendMovements(e);
  }
  //SEND user - receives phone number; return movements, name, last date || error - user not found
  else if(e.parameter.requestUser){
    return requestUser(e);
  }
  //SAVE new user - receives phone number, name, movements; returns success || error - already registered.
  else if(e.parameter.registerUser){
    return registerUser(e);
  }
  //SAVE over existing user - receives phone number, movements; returns success, name || error no user found
  else if(e.parameter.updateUser){
    return updateUser(e);
  }
  else if(e.parameter.requestPin){
    return requestPin(e);
  }
  else if(e.parameter.requestSummary){
    return requestSummary(e);
  }
  //SAVE submitted form - recieves data; return summary of movement stats
  else {
    return saveForm(e);
  }
}

//SENDING list of movements
function sendMovements(e) {
  try {
    let object = getMovements(e.parameter.movements.split(','),'onboard');
      
    return ContentService
      .createTextOutput(JSON.stringify(object))
      .setMimeType(ContentService.MimeType.JSON);
  } 
  catch(error) {
    // if error return this
    return ContentService
      .createTextOutput(JSON.stringify({"result":"error", "error": error.message}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

//SENDING User's movements, last entered date, question_rels, etc name || Not found
function requestUser(e) {
  //check to see if we are authenticated
  let user = getUser(e.parameter.phone);
  if(!user) {
    return ContentService
      .createTextOutput(JSON.stringify({'result':'failure', 'text':'User is not registered.  \n\nTo register please click on the onboarding link you were sent.'}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  else if(user.pin != e.parameter.pin){
    return ContentService
      .createTextOutput(JSON.stringify({'result':'failure', 'text':'Phone and pin combo are not correct, please try again'}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  //Now try to get information
  try {
    let userInfo = gatherUserInfo(e.parameter.phone, e.parameter.pin)
    
    if(userInfo){
      return ContentService
        .createTextOutput(JSON.stringify({"result":"success", "user": userInfo}))
        .setMimeType(ContentService.MimeType.JSON);
    }
    else {
      return ContentService
            .createTextOutput(JSON.stringify({'result':'failure', 'text':'Phone and pin combo are not correct'}))
            .setMimeType(ContentService.MimeType.JSON);
    }
  } catch(e){
    // if error return this
    return ContentService
          .createTextOutput(JSON.stringify({"result":"error", "error": e}))
          .setMimeType(ContentService.MimeType.JSON);
  }
}

//SAVE new User - receives phone number, name, movements; returns success || error if already registered.
function registerUser(e){
  let userInfo = registerUserInCache(e);
  if(userInfo) {
    return ContentService
      .createTextOutput(JSON.stringify({"result":"success", "user": userInfo}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  else {
    return ContentService
      .createTextOutput(JSON.stringify({'result':'failure', 'text':'That phone number is already registered'}))
      .setMimeType(ContentService.MimeType.JSON);
  }  
}

//SAVE over existing user - receives phone number, movements; returns success, name || error no user found
function updateUser(e) {
  //e.parameter.mvmnts needs to check our responses sheet for a last update in theses movements? or do we just remove last update message?
  let userInfo = updateUserInCache(e.parameter.phone, e.parameter.mvmnts, e.parameter.cat, e.parameter.pin);
  if(userInfo) {
    return ContentService
      .createTextOutput(JSON.stringify({"result":"success", "user": userInfo}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  else {
    return ContentService
      .createTextOutput(JSON.stringify({'result':'failure', 'text':'Phone number and pin do not match or is not registered'}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

//SENDING User's pin to them at their email address | not found
function requestPin(e) {
  //check to see if we are authenticated
  let user = getUser(e.parameter.phone);
  if(user && user.email){
    let subject = `Spotlight: requested pin for ${user.phone}`;
    let body = `Hi ${user.name}, \n\nYour pin is: ${user.pin}\n\nIf you have received this in error or have other questions - please let us know at ${SUPPORT_EMAIL} \n\n- the Spotlight team`;
    try {
      GmailApp.sendEmail(user.email,subject, body, {'from': SUPPORT_EMAIL, 'name': 'Spotlight'});
      GmailApp.sendEmail(SUPPORT_EMAIL,subject, 'pin requested', {'from': SUPPORT_EMAIL, 'name': 'Spotlight'});
    }
    catch(error){
      GmailApp.sendEmail(SUPPORT_EMAIL,'Pin request error:', error, {'from': SUPPORT_EMAIL, 'name': 'Spotlight'});
    }
  }
  return ContentService
    .createTextOutput(JSON.stringify({'result':'success', 'text':'The pin associated with your phone number has been sent to the email address we have on file.\n\nIf you do not have access to that email address or have further questions - please let us know at '+SUPPORT_EMAIL+'!'}))
    .setMimeType(ContentService.MimeType.JSON);
}

function testSaveForm(){
  let e = {
    "parameters": {
        "userPhone": [
            "8453320550"
        ],
        "holySpiritPres": [
            "0"
        ],
        "startDate": [
            "3/15/2022"
        ],
        "endDate": [
            "3/29/2022"
        ],
        "personalEvangDec": [
            "0"
        ],
        "userName": [
            "Carl Hempel"
        ],
        "movementId": [
            "96"
        ],
        "spiritualConvo": [
            "1"
        ],
        "personalEvang": [
            "1"
        ]
    },
    "contextPath": "",
    "contentLength": -1,
    "queryString": "startDate=3%2F15%2F2022&endDate=3%2F29%2F2022&movementId=96&userName=Carl%20Hempel&userPhone=8453320550&spiritualConvo=1&personalEvang=1&personalEvangDec=0&holySpiritPres=0",
    "parameter": {
        "startDate": "3/15/2022",
        "endDate": "3/29/2022",
        "holySpiritPres": "0",
        "userPhone": "8453320550",
        "movementId": "96",
        "personalEvangDec": "0",
        "personalEvang": "1",
        "spiritualConvo": "1",
        "userName": "Carl Hempel"
    }
  };

  saveForm(e);
}

//SENDING summary | not found
function requestSummary(e) {
  //check to see if we are authenticated
  try {
    let user = getUser(e.parameter.phone);
    let movements = Object.keys(user.mvmnts);
    let summary = summarizeMovements(movements);
    let userInfo = gatherUserInfo(e.parameter.phone);

    return ContentService
      .createTextOutput(JSON.stringify({"result":"success", "summary": summary, 'user': userInfo}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(error) {
    return ContentService
      .createTextOutput(JSON.stringify({'result':'failure', 'text':'Could not find movements associated with user','error': error}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function testRequestSummary(){
  let e = {
    "parameters": {
        "phone": [
            "8453320550"
        ],
        "requestSummary": [true]
    },
    "contextPath": "",
    "contentLength": -1,
    "queryString": "requestSummary=true&phone=8453320550",
    "parameter": {
        "requestSummary": true,
        "phone": "8453320550",
    }
  };
  requestSummary(e);
}

//SAVE form data to Responses, return summary for included movements
function saveForm(e) {
  //check to see if we are authenticated
  let user = getUser(e.parameters.userPhone[0]);
  if(!user || user.pin != e.parameters.userPin[0]){
    return ContentService
      .createTextOutput(JSON.stringify({'result':'failure', 'text':'Phone and pin combo are not correct, please login again'}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  try {
    let success = saveResponseToCache(e);  //uses Lock, will return summarizeMovements and gatherUserInfo

    if(success){
      // return json success results
      return ContentService
        .createTextOutput(JSON.stringify({"result":"success", "number": e.parameters.movementId.length,"summary": success.summary, 'user': success.userInfo}))
        .setMimeType(ContentService.MimeType.JSON);
    }
    else {
      return ContentService
        .createTextOutput(JSON.stringify({'result':'failure', 'text':'Could not save response to cache'}))
        .setMimeType(ContentService.MimeType.JSON);
    }
  } catch(error){
    // if error return this
    return ContentService
      .createTextOutput(JSON.stringify({"result":"error", "error": error}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


//POST entry point.  Mirrors doGet's dispatch table exactly and calls the same handlers, so doGet is
//left completely untouched - any device still running old cached client JS keeps sending GETs and
//keeps working indefinitely.
function doPost(e){
  Logger.log('doPost');

  //New-style stats submissions arrive as a JSON string with Content-Type: text/plain;charset=utf-8.
  //Use indexOf, NOT === - the browser sends the charset suffix, so an exact match against the bare
  //"text/plain" would silently fall through to saveForm() below and throw before it could respond.
  if(e.postData && e.postData.type && e.postData.type.indexOf('text/plain') === 0){
    return saveFormJSON(e);
  }

  //Everything else is a normal application/x-www-form-urlencoded POST body.  Apps Script fills
  //e.parameter from that body exactly as it does from a query string, so every handler below is the
  //same unchanged function doGet calls.
  //SEND movments list ---- USED in Onboarding only
  if(e.parameter.movements){
    return sendMovements(e);
  }
  //SEND user - receives phone number; return movements, name, last date || error - user not found
  else if(e.parameter.requestUser){
    return requestUser(e);
  }
  //SAVE new user - receives phone number, name, movements; returns success || error - already registered.
  else if(e.parameter.registerUser){
    return registerUser(e);
  }
  //SAVE over existing user - receives phone number, movements; returns success, name || error no user found
  else if(e.parameter.updateUser){
    return updateUser(e);
  }
  else if(e.parameter.requestPin){
    return requestPin(e);
  }
  else if(e.parameter.requestSummary){
    return requestSummary(e);
  }
  //Fallback: old-style form-urlencoded submission sent by POST instead of GET.  e.queryString and
  //e.parameters reflect the POST body here, so the untouched legacy saveForm() still works.
  else {
    return saveForm(e);
  }
}

//SAVE submitted form (new JSON format) - receives {userPin, submissions:[{movementId, userPhone, ...fields}, ...]}
function saveFormJSON(e){
  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch(err){
    return ContentService
      .createTextOutput(JSON.stringify({"result":"error", "error": "Could not parse submission: "+err.message}))
      .setMimeType(ContentService.MimeType.JSON);
  }

  let submissions = payload.submissions;
  if(!submissions || submissions.length === 0){
    return ContentService
      .createTextOutput(JSON.stringify({'result':'failure', 'code':'no_submission_data', 'text':'No submission data received'}))
      .setMimeType(ContentService.MimeType.JSON);
  }

  //check to see if we are authenticated
  let user = getUser(submissions[0].userPhone);
  if(!user || user.pin != payload.userPin){
    return ContentService
      .createTextOutput(JSON.stringify({'result':'failure', 'code':'pin_mismatch_login', 'text':'Phone and pin combo are not correct, please login again'}))
      .setMimeType(ContentService.MimeType.JSON);
  }

  try {
    let success = saveResponseToCacheFromJSON(payload);  //uses Lock, will return summarizeMovements and gatherUserInfo

    if(success){
      // return json success results
      return ContentService
        .createTextOutput(JSON.stringify({"result":"success", "number": submissions.length, "summary": success.summary, "user": success.userInfo}))
        .setMimeType(ContentService.MimeType.JSON);
    }
    else {
      return ContentService
        .createTextOutput(JSON.stringify({'result':'failure', 'code':'save_failed', 'text':'Could not save response to cache'}))
        .setMimeType(ContentService.MimeType.JSON);
    }
  } catch(error){
    // if error return this
    return ContentService
      .createTextOutput(JSON.stringify({"result":"error", "error": error.message}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

//Manual test - run in the Apps Script editor.  Deliberately includes a storyBox with an ampersand,
//since that is the exact character class that corrupted sheet columns under the old GET parser.
//NOTE: set movementId to a real id from THIS deployment's Movements sheet and userPhone to a real
//registered test user, otherwise this just returns pin_mismatch_login without exercising the save.
function testSaveFormJSON(){
  let e = {
    postData: {
      type: 'text/plain',
      contents: JSON.stringify({
        userPin: "5978",
        submissions: [{
          movementId: "c10338",
          userPhone: "8453320550",
          spiritual_conversations: "1",
          storyBox: "Great things happened this week & we're so grateful!"
        }]
      })
    }
  };
  let result = saveFormJSON(e);
  let content = result.getContent();
  Logger.log(content);
  return content; //NOT result - the editor cannot serialize a TextOutput
}

//Regression test for the charset dispatch bug specifically - routes through doPost() itself (not
//saveFormJSON directly), using the exact Content-Type the real client sends.
function testDoPostJSONWithCharset(){
  let e = {
    postData: {
      type: 'text/plain;charset=utf-8',
      contents: JSON.stringify({
        userPin: "5978",
        submissions: [{ movementId: "c10338", userPhone: "8453320550", spiritual_conversations: "1" }]
      })
    },
    parameter: {}
  };
  let result = doPost(e);
  let content = result.getContent();
  Logger.log(content);
  return content; //NOT result - the editor cannot serialize a TextOutput
}
