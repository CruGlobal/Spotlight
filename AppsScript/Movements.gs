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
    moveOb.fb=JSON.parse(movement[4]);
    moveOb.g1=JSON.parse(movement[5]);
    moveOb.g2=JSON.parse(movement[6]);
    moveOb.g3=JSON.parse(movement[7]);

    moveObjs[movement.shift().toString()]=moveOb;
  }

  SCRIPT_PROP.setProperty("movements", JSON.stringify(moveObjs));
}

function updateMovementsScriptProperty(){
  let doc = SpreadsheetApp.openById(SCRIPT_PROP.getProperty("key"));
  let sheet = doc.getSheetByName(MOVEMENT_SHEET);
  
  let movements = sheet.getRange(2,1,getLastRow(sheet) - 1,sheet.getLastColumn()).getValues();
  let currrentMovementsObs = JSON.parse(SCRIPT_PROP.getProperty('movements'));

  //check for a change in id, team, strategy, or name in the list of movements
  if(JSON.stringify(movements.map(mov => mov[0]+mov[1]+mov[2]+mov[3]).sort()) != JSON.stringify(Object.keys(currrentMovementsObs).map(key => key+currrentMovementsObs[key].tID+currrentMovementsObs[key].strat+currrentMovementsObs[key].name).sort())) {
    //we've got new movements to add
   
    let moveObjs = currrentMovementsObs;
    //for each row in the 2d array from getValues();
    for(movement of movements){
      let moveOb = moveObjs[movement[0].toString()];
      //Logger.log(moveOb)
      if(moveOb == undefined) { //we've got a new movement and we need to add it to the object along with it's summary data.
        moveOb = {};
        moveOb.fb=JSON.parse(movement[4]);
        moveOb.g1=JSON.parse(movement[5]);
        moveOb.g2=JSON.parse(movement[6]);
        moveOb.g3=JSON.parse(movement[7]);
      }//else, we don't have a new movement, and we can just update the id/strat/name if needed
      moveOb.tID=movement[1];
      moveOb.strat=movement[2];
      moveOb.name=movement[3];

      moveObjs[movement.shift().toString()]=moveOb;
    }  
    
    //put it back where it goes
    SCRIPT_PROP.setProperty("movements", JSON.stringify(moveObjs));
  }
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

    function addToMovementSummary(key,value){
      if(typeof movements[movementId][key] === "object"){
        movements[movementId][key][param_ob["userPhone"]] = parseInt(value || 0);
      }
      else {
        movements[movementId][key] += parseInt(value || 0);
      }
    }

    addToMovementSummary('fb', param_ob[global.fb]);
    addToMovementSummary('g1', param_ob[global.g1]);
    
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

    addToMovementSummary('g2', param_ob[strat_summary_id]); //summary from geography or AFC/EFC or Global if not set

    //need to know which team for this movement
    let team = teams[movements[param_ob.movementId].tID];
    let team_summary_id = '';
    if(team.teamSum != '') {
      team_summary_id = team.teamSum;
    }
    else {
      team_summary_id = global.g3;
    }
    addToMovementSummary('g3', param_ob[team_summary_id]);
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
  //Logger.log(movements);
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
    function getMovementSummaryNumber(key){
      if(typeof movement[key] === 'object'){
        return Object.values(movement[key]).reduce((a, b) => parseInt(a) + parseInt(b), 0) || 0;
      }
      else {
        return movement[key] || 0;
      }
    }
    groupNum[fbID] = (groupNum[fbID] || 0) + getMovementSummaryNumber('fb');
    groupNum[g1ID] = (groupNum[g1ID] || 0) + getMovementSummaryNumber('g1');

    //STRATEGY
    let strat_lookup = strategies[movement.strat];
    if(!strat_lookup){  //if strategy is not in database, use our default strategy.
      strat_lookup = strategies['default'];
    }
    let stratID = strat_lookup.summaryId;
    if(stratID.trim() == ''){
      stratID = global.g2;
    }
    groupNum[stratID] = (groupNum[stratID] || 0) + getMovementSummaryNumber('g2');

    //TEAM
    let teamID = teams[movement.tID].teamSum;
    if(teamID.trim() != ''){
      if(teams[movement.tID][teamID]){ //teamID may be a non-team question only if it is a team question do we process this.
        questions[teamID] = teams[movement.tID][teamID].replace(/^.*Ͱ/,''); //want to have the team question too.
      }
    } else {
      teamID = global.g3;
    }
    groupNum[teamID]  = (groupNum[teamID] || 0) + getMovementSummaryNumber('g3');
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
  Logger.log(summarizeMovements(['c15195','c3276']))
}

function myMovements() {
  Logger.log(getMovements(['c900','c901']));
}

function testUpdateMovementsInCache() {
  let responses = [[["startDate",""],["endDate","2/25/2022"],["movementId","sm453"],["userName","Carl Hempel"],["userPhone","8453320550"],["spiritualConvo","2"],["personalEvang","1"],["personalEvangDec","0"],["holySpiritPres","0"],["Timestamp","2022-02-25T16:51:40.652Z"]],[["startDate",""],["endDate","2/25/2022"],["movementId","15452"],["userName","Carl Hempel"],["userPhone","8453320550"],["spiritualConvo","4"],["personalEvang","3"],["personalEvangDec","2"],["holySpiritPres","2"],["Timestamp","2022-02-25T16:51:40.652Z"]],[["startDate",""],["endDate","2/25/2022"],["movementId","11639"],["userName","Carl Hempel"],["userPhone","8453320550"],["spiritualConvo","1"],["personalEvang","1"],["personalEvangDec","1"],["holySpiritPres","1"],["Timestamp","2022-02-25T16:55:37.905Z"]],[["startDate",""],["endDate","2/25/2022"],["movementId","15452"],["userName","Carl Hempel"],["userPhone","8453320550"],["spiritualConvo","1"],["personalEvang","1"],["personalEvangDec","1"],["holySpiritPres","1"],["Timestamp","2022-02-25T16:55:37.905Z"]],[["startDate",""],["endDate","2/25/2022"],["movementId","15452"],["userName","Carl Hempel"],["userPhone","8453320550"],["spiritualConvo","1"],["personalEvang","1"],["personalEvangDec","1"],["holySpiritPres","1"],["Timestamp","2022-02-25T16:58:29.792Z"]],[["startDate","2/25/2022"],["endDate","2/25/2022"],["movementId","11639"],["userName","Carl Hempel"],["userPhone","8453320550"],["spiritualConvo","1"],["personalEvang","1"],["personalEvangDec","1"],["holySpiritPres","0"],["Timestamp","2022-02-25T18:31:47.811Z"]],[["startDate",""],["endDate","2/25/2022"],["movementId","11639"],["userName","Carl Hempel"],["userPhone","8453320550"],["spiritualConvo","1"],["personalEvang","1"],["personalEvangDec","1"],["holySpiritPres","0"],["Timestamp","2022-02-25T18:32:24.532Z"]]];
  updateMovementsInCache(responses);
}
