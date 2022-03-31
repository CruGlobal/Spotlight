function setStrategiesScriptProperty(){
  let doc = SpreadsheetApp.openById(SCRIPT_PROP.getProperty("key"));
  let sheet = doc.getSheetByName(STRATEGY_SHEET);
  
  let strategies = sheet.getRange(1,2,sheet.getLastRow(),sheet.getLastColumn()).getValues();
  let stratObjs = {};
  //Data arranged in columns, so we are iterating over them instead of rows.
  for(j = 0; j < strategies[0].length -1; j++){ //j = columns
    let questions = [];  //list of objects because the order matters for the app.
    for(i = 4; i < 61; i+=4){  //i = row indices starting at 0; start at 4 - first question(in 5th row), i < 61 because 61 is 15th question's start row,  i+=4 because their are 4 rows per question
      if(strategies[i][j] != ''){ // if there is a strategy selected.
        let question = {};
        question.id = strategies[i][j];
        question.name = strategies[i+1][j];
        question.users = strategies[i+2][j];
        question.description = strategies[i+3][j];
        questions.push(question);
      }
    }
    let strategy = {};
    strategy.welcomeText = strategies[1][j];
    strategy.primaryColor = strategies[2][j];
    strategy.summaryId = strategies[3][j];
    strategy.questions = questions;
    
    stratObjs[strategies[0][j]] = strategy;
  }
  
  SCRIPT_PROP.setProperty("strategies", JSON.stringify(stratObjs));
}

function getStrategies(strategiesList, userCat) {
  let strategies = JSON.parse(SCRIPT_PROP.getProperty('strategies'));
 
  if(strategiesList !== undefined){
    let subset = {};
    for(strategy of strategiesList){
      subset[strategy] = strategies[strategy];
      subset[strategy].questions = subset[strategy].questions.filter(question => ['','both',userCat].indexOf(question.users.toLowerCase()) > -1);
    }
    strategies = subset;
  }

  return strategies;
}
