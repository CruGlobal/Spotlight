function setMovementsScriptProperty(){
  let doc = SpreadsheetApp.openById(SCRIPT_PROP.getProperty("key"));
  let sheet = doc.getSheetByName(MOVEMENT_SHEET);
  
  let movements = sheet.getRange(2,1,getLastRow(sheet) - 1,sheet.getLastColumn()).getValues();
  let moveObjs = {};
  //for each row in the 2d array from getValues();
  for(movement of movements){
    let moveOb = {};
    moveOb.tID=movement[1];
    moveOb.strat=movement[2];
    moveOb.name=movement[3];
    moveOb.fb=parseInt(movement[4]);
    moveOb.g1=parseInt(movement[5]);
    moveOb.g2=parseInt(movement[6]);
    moveOb.g3=parseInt(movement[7]);

    moveObjs[movement.shift().toString()]=moveOb;
  }

  SCRIPT_PROP.setProperty("movements", JSON.stringify(moveObjs));
}

function updateMovementsInCache(responses, strategies, teams, global){
  let movements = JSON.parse(SCRIPT_PROP.getProperty("movements"));
  if(strategies === undefined){
    strategies = getStrategies();
  }
  if(teams === undefined){
    teams = getTeams();
  }
  if(global === undefined){
    global = JSON.parse(SCRIPT_PROP.getProperty('globalSums'));
  }

  for(response of responses) {
    let param_ob = {};
    for(param of response){
      param_ob[param[0]] = param[1];
    }

    let movementId = param_ob.movementId;

    movements[movementId].fb += parseInt(param_ob[global.fb] || 0);
    movements[movementId].g1 += parseInt(param_ob[global.g1] || 0);
    
    //need to know which strategy for this movement
    let strategy = movements[param_ob.movementId].strat;
    let strat_lookup = strategies[strategy];
    if(!strat_lookup){  //if strategy is not in database, use our default strategy.
      strat_lookup = strategies['default'];
    }
    let strat_summary_id = strat_lookup.summaryId;
    if(strat_summary_id.trim() == ''){
      strat_summary_id = global.g2;
    }
    movements[movementId].g2 += (parseInt(param_ob[strat_summary_id]) || 0); //summary from geography or AFC/EFC or Global if not set

    //need to know which team for this movement
    let team = teams[movements[param_ob.movementId].tID];
    let team_summary_id = '';
    if(team.teamSum != '') {
      team_summary_id = team.teamSum;
    }
    else {
      team_summary_id = global.g3;
    }
    movements[movementId].g3 += (parseInt(param_ob[team_summary_id]) || 0);
  }

  //set changed movement values back to cache  
  SCRIPT_PROP.setProperty("movements", JSON.stringify(movements));

  return true;
}

function getMovements(movementsList, purpose) {
  let movements = JSON.parse(SCRIPT_PROP.getProperty("movements"));
  movementsList = movementsList.map(mvmnt => mvmnt.toString());

  let object = [];
  for(mvmntIn of movementsList){
    try {
      if(purpose == 'summary'){                    //we want everything
        let mvmnt = movements[mvmntIn];
        mvmnt.id = mvmntIn;
        object.push(mvmnt);
      } else {                                     //we only need the id, name, and strategy
        let mvmnt = {};
        mvmnt.id = mvmntIn;                         //id
        mvmnt.name = movements[mvmntIn].name;       //name
        mvmnt.strat = movements[mvmntIn].strat;     //strategy
        mvmnt.tID = movements[mvmntIn].tID;         //team ID
        object.push(mvmnt);
      }
    } catch(e) {
      console.log(e);
    }
  }
  return object;
}

function summarizeMovements(movements, strategies, teams, global){
  let summaryMovements = getMovements(movements, 'summary');
  if(strategies === undefined){
    strategies = getStrategies();
  }
  if(teams === undefined){
    teams = getTeams();
  }
  if(global === undefined){
    global = JSON.parse(SCRIPT_PROP.getProperty('globalSums'));
  }

  let fbID = global.fb
  let g1ID = global.g1

  let groupNum = {};

  let usedStrats = summaryMovements.map(movement => movement.strat).filter(onlyUnique);
  let questions = {};
  for(strat of usedStrats) {
    let strat_lookup = strategies[strat];
    if(!strat_lookup){  //if strategy is not in database, use our default strategy.
      strat_lookup = strategies['default'];
    }
    for(question of strat_lookup.questions){
      questions[question.id] = question.name;
    }
  }
  for(movement of summaryMovements){
    groupNum[fbID] = (groupNum[fbID] || 0) + parseInt(movement.fb || 0);
    groupNum[g1ID] = (groupNum[g1ID] || 0) + parseInt(movement.g1 || 0);

    //STRATEGY
    let strat_lookup = strategies[movement.strat];
    if(!strat_lookup){  //if strategy is not in database, use our default strategy.
      strat_lookup = strategies['default'];
    }
    let stratID = strat_lookup.summaryId;
    if(stratID.trim() == ''){
      stratID = global.g2;
    }
    groupNum[stratID] = (groupNum[stratID] || 0) + parseInt(movement.g2);

    //TEAM
    let teamID = teams[movement.tID].teamSum;
    if(teamID.trim() != ''){
      questions[teamID] = teams[movement.tID][teamID].replace(/^.*Ͱ/,''); //want to have the team question too.
    } else {
      teamID = global.g3;
    }
    groupNum[teamID]  = (groupNum[teamID] || 0) + parseInt(movement.g3);
  }
  
  if(groupNum[global.fb] == 0){
    delete groupNum[global.fb];
  }
  for(num of Object.keys(groupNum)) {
    if(Object.keys(groupNum).length > 3 && groupNum[num] == 0) {
      delete groupNum[num];
      delete questions[num];
    }
  }
  if(Object.keys(groupNum).length > 3){
    delete groupNum[global.fb];
    delete questions[global.fb];
  }

  let summary = {};
  summary.groupNum = groupNum;
  summary.questions = questions;
  
  return summary;
}

function testSummarize() {
  Logger.log(summarizeMovements(['c12860']))
}

function myMovements() {
  Logger.log(SCRIPT_PROP.getProperty("movements"));
}

function testUpdateMovementsInCache() {
  let responses = [[["startDate",""],["endDate","2/25/2022"],["movementId","sm453"],["userName","Carl Hempel"],["userPhone","8453320550"],["spiritualConvo","2"],["personalEvang","1"],["personalEvangDec","0"],["holySpiritPres","0"],["Timestamp","2022-02-25T16:51:40.652Z"]],[["startDate",""],["endDate","2/25/2022"],["movementId","15452"],["userName","Carl Hempel"],["userPhone","8453320550"],["spiritualConvo","4"],["personalEvang","3"],["personalEvangDec","2"],["holySpiritPres","2"],["Timestamp","2022-02-25T16:51:40.652Z"]],[["startDate",""],["endDate","2/25/2022"],["movementId","11639"],["userName","Carl Hempel"],["userPhone","8453320550"],["spiritualConvo","1"],["personalEvang","1"],["personalEvangDec","1"],["holySpiritPres","1"],["Timestamp","2022-02-25T16:55:37.905Z"]],[["startDate",""],["endDate","2/25/2022"],["movementId","15452"],["userName","Carl Hempel"],["userPhone","8453320550"],["spiritualConvo","1"],["personalEvang","1"],["personalEvangDec","1"],["holySpiritPres","1"],["Timestamp","2022-02-25T16:55:37.905Z"]],[["startDate",""],["endDate","2/25/2022"],["movementId","15452"],["userName","Carl Hempel"],["userPhone","8453320550"],["spiritualConvo","1"],["personalEvang","1"],["personalEvangDec","1"],["holySpiritPres","1"],["Timestamp","2022-02-25T16:58:29.792Z"]],[["startDate","2/25/2022"],["endDate","2/25/2022"],["movementId","11639"],["userName","Carl Hempel"],["userPhone","8453320550"],["spiritualConvo","1"],["personalEvang","1"],["personalEvangDec","1"],["holySpiritPres","0"],["Timestamp","2022-02-25T18:31:47.811Z"]],[["startDate",""],["endDate","2/25/2022"],["movementId","11639"],["userName","Carl Hempel"],["userPhone","8453320550"],["spiritualConvo","1"],["personalEvang","1"],["personalEvangDec","1"],["holySpiritPres","0"],["Timestamp","2022-02-25T18:32:24.532Z"]]];
  updateMovementsInCache(responses);
}
