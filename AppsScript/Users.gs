function setUserScriptProperty(){
  let doc = SpreadsheetApp.openById(SCRIPT_PROP.getProperty("key"));
  let sheet = doc.getSheetByName(USER_SHEET_UPDATE);
  
  let users = sheet.getRange(2,1, getLastRow(sheet) - 1, 5).getValues();
  let userObjs = {};
  //for each row in the 2d array from getValues();
  for(user of users){
    let userOb = {};
    userOb.name=user[1];
    userOb.cat=user[2];
    userOb.mvmnts=user[3];
    if(user[4]!= ''){
      userOb.txtOn=user[4];
    }

    userObjs[user.shift()]=userOb;
  }

  SCRIPT_PROP.setProperty("users", JSON.stringify(userObjs));
}

function getUser(phone){
  let users = JSON.parse(SCRIPT_PROP.getProperty('users'));
  let user = users[phone];

  if(typeof user == 'undefined'){
    user = false;
  }
  else {
    user.mvmnts = JSON.parse(user.mvmnts);
    user.phone = phone;
  }

  return user;
}

function registerUserInCache(e){
  //check to see if the phone is already registered.
  if(getUser(e.parameter.phone)) {
    return false;
  }
  
  //ok, we don't have this in our users system - time to load up the full script property
  var lock = LockService.getPublicLock();
  lock.waitLock(30000);  // wait 30 seconds before conceding defeat.

  let users = JSON.parse(SCRIPT_PROP.getProperty('users'));

  //compile our new user information
  let userOb = {};
  userOb.name = e.parameter.name;
  userOb.cat = e.parameter.cat;

  //A js object that has the movement ids as keys and the date updated as the value.
  userOb.mvmnts = e.parameter.mvmnts;

  users[e.parameter.phone]=userOb;

  SCRIPT_PROP.setProperty("users", JSON.stringify(users));
  lock.releaseLock();
  
  return gatherUserInfo(e.parameter.phone);
}

function testmyPhone(){
  Logger.log(gatherUserInfo(8453320550))
}

function updateUserInCache(e){
  //check to see if the phone is already registered.
  let user = getUser(e.parameter.phone);
  if(!user){
    return false;
  }
  
  //ok, we do have the user in our cache - time to update them.
  var lock = LockService.getPublicLock();
  lock.waitLock(30000);  // wait 30 seconds before conceding defeat.

  let users = JSON.parse(SCRIPT_PROP.getProperty('users'));
  users[e.parameter.phone].mvmnts = e.parameter.mvmnts; //JS object with key as mvmntID, and value is last update.

  SCRIPT_PROP.setProperty("users", JSON.stringify(users));
  lock.releaseLock();
  
  return gatherUserInfo(e.parameter.phone);
}

function gatherUserInfo(phone){
  let userInfo = getUser(phone);

  if(userInfo){
    userInfo.questionRels = getQuestionRels();

    //need to get movements table, look up our movement id's and get the unique set of strategies that are related to them.
    let userMvmntsIds = Object.keys(userInfo.mvmnts);
    let movements = getMovements(userMvmntsIds);
    let strategiesList = movements.map(mvmnt => mvmnt.strat);

    userInfo.strategies = getStrategies(strategiesList); //get's the unique strategies as a list
    userInfo.movements = movements;
    
    return userInfo;
  }
  else {
    return false;
  }
}

//SAVE new User - receives phone number, name, movements; returns success || error if already registered.
function saveUser(e) {
  var lock = LockService.getPublicLock();
  lock.waitLock(30000);  // wait 30 seconds before conceding defeat.
  
  try {
    // next set where we write the data - you could write to multiple/alternate destinations
    var doc = SpreadsheetApp.openById(SCRIPT_PROP.getProperty("key"));
    var sheet = doc.getSheetByName(USER_SHEET);
    
    //CHECK TO BE SURE PHONE NUMBER IS NOT Already registered.  NEED TO VALIDATE PHONE NUMBER client side and here.
    e.parameter.phone = e.parameter.phone.replace(/\D/g,'');
    
    //for each item in list of users, check if it is the same as the one we received.
    let users = sheet.getRange(2,1, sheet.getLastRow(), 3).getValues();
    let newUser = true;     
    for(i in users){
        //Logger.log(users[i])
      if(users[i][0] == e.parameter.phone) {
        newUser = false;
      }
    }    
   
    if(newUser){   
      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      var nextRow = sheet.getLastRow()+1; // get next row
      var row = []; 
      // loop through the header columns
      for (i in headers){
        if (headers[i] == "Timestamp"){ // special case if you include a 'Timestamp' column
          row.push(new Date());
        } else { // else use header name to get data
          row.push(e.parameter[headers[i]]);
        }
      }
      // more efficient to set values as [][] array than individually
      sheet.getRange(nextRow, 1, 1, row.length).setValues([row]);
      SpreadsheetApp.flush();
      setUserScriptProperty();
      let user = getUser(e.parameter.phone);
      return ContentService
            .createTextOutput(JSON.stringify({"result":"success", "user": {'phone':user[0],'name':user[1],'mvmnts':user[2],'lastUpdate':user[3]}}))
            .setMimeType(ContentService.MimeType.JSON);
    }
    else {
      Logger.log('hi')
      return ContentService
            .createTextOutput(JSON.stringify({'result':'failure', 'text':'That phone number is already registered'}))
            .setMimeType(ContentService.MimeType.JSON);
    }
  } catch(e){
    // if error return this
    Logger.log(e)
    return ContentService
          .createTextOutput(JSON.stringify({"result":"error", "error": e}))
          .setMimeType(ContentService.MimeType.JSON);
  } finally { //release lock
    lock.releaseLock();
  }
}

function saveMyUser(){
  registerUser({"parameter":{"phone":"834242121","name":"Jimmy","movementIds":"12321,12,1231,0"}})
}

function allUsers() {
  Logger.log(JSON.stringify(SCRIPT_PROP.getProperty('users')));
}
