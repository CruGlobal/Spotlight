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
  try {
    let userInfo = gatherUserInfo(e.parameter.phone)
    
    if(userInfo){
      return ContentService
        .createTextOutput(JSON.stringify({"result":"success", "user": userInfo}))
        .setMimeType(ContentService.MimeType.JSON);
    }
    else {
      return ContentService
            .createTextOutput(JSON.stringify({'result':'failure', 'text':'That phone number is not registered'}))
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
  let userInfo = updateUserInCache(e.parameter.phone, e.parameter.mvmnts);
  if(userInfo) {
    return ContentService
      .createTextOutput(JSON.stringify({"result":"success", "user": userInfo}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  else {
    return ContentService
      .createTextOutput(JSON.stringify({'result':'failure', 'text':'That phone number is not registered'}))
      .setMimeType(ContentService.MimeType.JSON);
  }
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

//SAVE form data to Responses, return summary for included movements
function saveForm(e) {
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

