function setUserScriptProperty(){
  let doc = SpreadsheetApp.openById(SCRIPT_PROP.getProperty("key"));
  let sheet = doc.getSheetByName(USER_SHEET_UPDATE);
  
  let users = sheet.getRange(2,1, getLastRow(sheet) - 1, 7).getValues();
  let userObjs = {};
  //for each row in the 2d array from getValues();
  for(user of users){
    let userOb = {};
    userOb.tmstmp=GoogleDate(user[0]);
    userOb.pin=user[2];
    userOb.email=user[3];
    userOb.name=user[4];
    userOb.cat=user[5];
    userOb.mvmnts=user[6];
    if(user[5]!= ''){
      userOb.txtOn=user[5];
    }

    userObjs[user[1]]=userOb;
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
  userOb.tmstmp = GoogleDate(new Date());
  userOb.name = e.parameter.name;
  userOb.cat = e.parameter.cat;
  userOb.email = e.parameter.email;
  userOb.pin = e.parameter.pin;

  //A js object that has the movement ids as keys and the date updated as the value.
  userOb.mvmnts = e.parameter.mvmnts;

  users[e.parameter.phone]=userOb;

  SCRIPT_PROP.setProperty("users", JSON.stringify(users));
  lock.releaseLock();

  let subject = `Spotlight: registered ${e.parameter.phone}`;
  let body = `Hi ${userOb.name}, \n\nYou have registered with Spotlight.\n\nYour pin is: ${userOb.pin}\n\nIf you have received this in error or have other questions - please let us know at spotlight@cru.org \n\n- the Spotlight team`;
  try {
    GmailApp.sendEmail(userOb.email,subject, body, {'from': 'spotlight@cru.org', 'name': 'Spotlight'});
    GmailApp.sendEmail('spotlight@cru.org',subject, 'user registered', {'from': 'spotlight@cru.org', 'name': 'Spotlight'});
  }
  catch(error){
    GmailApp.sendEmail('spotlight@cru.org','Pin request error:', error, {'from': 'spotlight@cru.org', 'name': 'Spotlight'});
  }
  
  return gatherUserInfo(e.parameter.phone);
}

function testmyPhone(){
  Logger.log(gatherUserInfo(4145145566))
}

function updateUserInCache(phone, mvmnts, cat, pin){
  //check to see if the phone is already registered, and if the pin matches
  let user = getUser(phone);
  if(!user || user.pin != pin){
    return false;
  }

  //ok, we do have the user in our cache and they sent the right pin - time to update them.
  if(cat){ //default when onboarding
    var lock = LockService.getPublicLock();
    lock.waitLock(30000);  // wait 30 seconds before conceding defeat.

    let users = JSON.parse(SCRIPT_PROP.getProperty('users'));
    users[phone].tmstmp = GoogleDate(new Date());
    users[phone].mvmnts = mvmnts; //JS object with key as mvmntID, and value is last update.
    users[phone].cat = cat;

    SCRIPT_PROP.setProperty("users", JSON.stringify(users));
    lock.releaseLock();
    
    return gatherUserInfo(phone);
  }
  else { //when we are saving our movement responses to cache, already have a waitlock
    let users = JSON.parse(SCRIPT_PROP.getProperty('users'));

    mvmntOb = JSON.parse(users[phone].mvmnts);

    for(obKey of Object.keys(mvmntOb)){
      if(mvmnts[obKey]){
        mvmntOb[obKey] = mvmnts[obKey];
      }
    }
    users[phone].tmstmp = GoogleDate(new Date());
    users[phone].mvmnts = JSON.stringify(mvmntOb)
    SCRIPT_PROP.setProperty("users", JSON.stringify(users));
    
    return true;
  }
}

function gatherUserInfo(phone){
  let userInfo = getUser(phone);

  if(userInfo){
    userInfo.questionRels = getQuestionRels();

    //need to get movements table, look up our movement id's and get the unique set of strategies that are related to them.
    let userMvmntsIds = Object.keys(userInfo.mvmnts);
    let movements = getMovements(userMvmntsIds);

    let strategiesList = movements.map(mvmnt => mvmnt.strat);
    let userCat = userInfo.cat;
    if(userCat == '!staff'){
      userCat = 'non-staff';
    }
    userInfo.strategies = getStrategies(strategiesList, userCat); //get's the unique strategies as a list

    let teamsList = movements.map(mvmnt => mvmnt.tID ).filter(onlyUnique);
    if(userCat == 'staff'){
      userCat = 'S';
    } else if(userCat == 'non-staff') {
      userCat = 'N';
    } else {
      userCat = 'B';
    }
    userInfo.teams = getTeams(teamsList, userCat);

    userInfo.movements = movements;
    
    return userInfo;
  }
  else {
    return false;
  }
}

//Save our cached users table to the sheet
function writeUsersToSheets() {
  var lock = LockService.getPublicLock();
  lock.waitLock(30000);  // wait 30 seconds before conceding defeat.

  try {
    //Full Cache of Users
    let usersOb = JSON.parse(SCRIPT_PROP.getProperty('users'));

    let doc = SpreadsheetApp.openById(SCRIPT_PROP.getProperty("key"));
    let sheet = doc.getSheetByName(USER_SHEET);
    let users = sheet.getRange(2,1, getLastRow(sheet) - 1, 7).getValues();

    // cycle through our existing users
    for(i in users){  
      let userPhone = users[i][1]; //Second column in a row is the phone number
      try { //let's see if it exists in our data.  If yes then place it there.
        let userOb = usersOb[userPhone];
        users[i][0] = userOb.tmstmp;
        users[i][2] = userOb.pin || '';
        users[i][3] = userOb.email || '';
        users[i][4] = userOb.name;
        users[i][5] = userOb.cat;
        users[i][6] = userOb.mvmnts;
        delete usersOb[userPhone];
      } catch {
        Logger.log('missing user: '+ userPhone + ' in cached data');
      }
    }
    //cycle through remaining new users and add to the bottom of the users table
    for (const [userPhone, userOb] of Object.entries(usersOb)) {
      let userRow = [];
      userRow.push(userOb.tmstmp);
      userRow.push(userPhone);
      userRow.push(userOb.pin || '');
      userRow.push(userOb.email || '');
      userRow.push(userOb.name);
      userRow.push(userOb.cat);
      userRow.push(userOb.mvmnts);
      users.push(userRow);
    }

    //Write 2d Data store to sheet
    sheet.getRange(2, 1, users.length, users[0].length).setValues(users);
    SpreadsheetApp.flush();
    setUserScriptProperty();

  // Release Lock
  } finally { //release lock
    lock.releaseLock();
  }
}

function allUsers() {
  Logger.log(JSON.stringify(SCRIPT_PROP.getProperty('users')));
}
