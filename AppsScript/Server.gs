// original from: http://mashe.hawksey.info/2014/07/google-sheets-as-a-database-insert-with-apps-script-using-postget-methods-with-ajax-example/
// original gist: https://gist.github.com/willpatera/ee41ae374d3c9839c2d6 

function doGet(e){
  //SEND movments list
  if(e.parameter.movements){
    return sendMovements(e);
  }
  //SEND onboarding - receives phone number; return movements, name, last date || error - user not found
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

//SENDING User's movements, last entered date, name || Not found
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
  let userInfo = updateUserInCache(e);
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
    "contentLength": -1,
    "parameter": {
        "movementId": "8072",
        "endDate": "3/24/2022",
        "personalEvangDec": "0",
        "personalEvang": "0",
        "startDate": "",
        "userPhone": "8453320550",
        "spiritualConvo": "0",
        "userName": "Carl Hempel",
        "holySpiritPres": "0"
    },
    "parameters": {
        "personalEvangDec": [
            "0"
        ],
        "movementId": [
            "8072"
        ],
        "holySpiritPres": [
            "0"
        ],
        "personalEvang": [
            "0"
        ],
        "spiritualConvo": [
            "0"
        ],
        "userName": [
            "Carl Hempel"
        ],
        "userPhone": [
            "8453320550"
        ],
        "startDate": [
            ""
        ],
        "endDate": [
            "3/24/2022"
        ]
    },
    "contextPath": "",
    "queryString": "startDate=&endDate=3%2F24%2F2022&movementId=8072&userName=Carl%20Hempel&userPhone=8453320550&spiritualConvo=0&personalEvang=0&personalEvangDec=0&holySpiritPres=0"
};

  saveForm(e);
}

//SAVE form data to Responses, return summary for included movements
function saveForm(e) {
  try {
    let success = saveResponseToCache(e);

    let movements = e.parameters.movementId;
    let summary = summarizeMovements(movements);

    let userInfo = gatherUserInfo(success);

    if(success){
      // return json success results
      return ContentService
        .createTextOutput(JSON.stringify({"result":"success", "number": e.parameters.movementId.length,"summary": summary, 'user': userInfo, 'orig_e': e}))
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

