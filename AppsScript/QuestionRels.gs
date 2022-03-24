function setQuestionRelsScriptProperty(){
  let doc = SpreadsheetApp.openById(SCRIPT_PROP.getProperty("key"));
  let sheet = doc.getSheetByName(QUESTION_RELS);
  
  let questionRelsList = sheet.getRange(2,1, getLastRow(sheet,'B')-1,3).getValues(); 
  let questionObjs = {};
  //for each row in the 2d array from getValues();
  for(question of questionRelsList){
    //Logger.log(questionRelsList)
    let questionOb = {};
    questionOb.notCumulative=Boolean(question[2]);
    let lessThan = question[0];
    if(lessThan.trim() == ''){
      questionOb.lessThan = false;
    }
    else {
      questionOb.lessThan=question[0].split(',');
    }

    questionObjs[question[1]]=questionOb;
  }

  SCRIPT_PROP.setProperty("questionRelsList", JSON.stringify(questionObjs));
}

function myQuestiinRels() {
  Logger.log(JSON.stringify(getQuestionRels()))
}

function getQuestionRels(){
  let questionRelsList = JSON.parse(SCRIPT_PROP.getProperty('questionRelsList'));
  
  return questionRelsList;
}
