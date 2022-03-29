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

function setup() {
    var doc = SpreadsheetApp.getActiveSpreadsheet();
    SCRIPT_PROP.setProperty("key", doc.getId());
}

function updateScriptProperties(){
  setMovementsScriptProperty();
  setQuestionRelsScriptProperty();
  setStrategiesScriptProperty();
  setTeamsScriptProperty();
  setUserScriptProperty();
  setGlobalSumsScriptProperty();

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
    GmailApp.sendEmail('carl.hempel@cru.org','Server script properties are at 480kb!','You should check it out: \n\nhttps://docs.google.com/spreadsheets/d/'+SCRIPT_PROP.getProperty("key"));
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
