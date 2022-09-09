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
  let old_e = e;
  try {
    let object = getMovements(e.parameter.movements.split(','),'onboard');
      
    return ContentService
      .createTextOutput(JSON.stringify(object))
      .setMimeType(ContentService.MimeType.JSON);
  } 
  catch(e) {
    // if error return this
    return ContentService
      .createTextOutput(JSON.stringify({"result":"error", "error": e.message, 'orig_e': old_e}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

//SENDING User's movements, last entered date, question_rels, etc name || Not found
function requestUser(e) {
  //check to see if we are authenticated
  let user = getUser(e.parameter.phone);
  if(!user || user.pin != e.parameter.pin){
    return ContentService
      .createTextOutput(JSON.stringify({'result':'failure', 'text':'Phone and pin combo are not correct, please login again'}))
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
    let body = `Hi ${user.name}, \n\nYour pin is: ${user.pin}\n\nIf you have received this in error or have other questions - please let us know at spotlight@cru.org \n\n- the Spotlight team`;
    try {
      GmailApp.sendEmail(user.email,subject, body, {'from': 'spotlight@cru.org', 'name': 'Spotlight','bcc': 'spotlight@cru.org'});
    }
    catch(error){
      GmailApp.sendEmail('spotlight@cru.org','Pin request error:', error, {'from': 'spotlight@cru.org', 'name': 'Spotlight'});
    }
  }
  return ContentService
    .createTextOutput(JSON.stringify({'result':'success', 'text':'The pin associated with your phone number has been sent to the email address we have on file.\n\nIf you do not have access to that email address or have further questions - please let us know at spotlight@cru.org!'}))
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
      .createTextOutput(JSON.stringify({"result":"success", "summary": summary, 'user': userInfo, 'orig_e': e}))
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
        .createTextOutput(JSON.stringify({"result":"success", "number": e.parameters.movementId.length,"summary": success.summary, 'user': success.userInfo, 'orig_e': e}))
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
      .createTextOutput(JSON.stringify({"result":"error", "error": error,'data': e}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

