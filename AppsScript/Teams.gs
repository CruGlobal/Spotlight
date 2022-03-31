function setTeamsScriptProperty(){
  let doc = SpreadsheetApp.openById(SCRIPT_PROP.getProperty("key"));
  let sheet = doc.getSheetByName(TEAM_SHEET);

  let teams = sheet.getRange(2,1,getLastRow(sheet) - 2,sheet.getLastColumn()).getValues();
  let teamObjs = {};
  //for each row in the 2d array from getValues();
  for(team of teams){
    let teamOb = {};
    teamOb.name=team[1];
    teamOb.teamQ1=team[2];
    teamOb.teamQ2=team[3];
    teamOb.teamQ3=team[4];
    teamOb.teamSum=team[5];

    teamObjs[team.shift()]=teamOb;
  }

  SCRIPT_PROP.setProperty("teams", JSON.stringify(teamObjs));
}

function getTeams(teamsList, userCat) {
  let teams = JSON.parse(SCRIPT_PROP.getProperty('teams'));
  let object = {};
  
  if(teamsList === undefined){
    object = teams;
  }
  else {
    for(team of teamsList){
      let teamOb = teams[team];
      if(userCat){
        for(i = 1; i <= 3; i++){  // Need to filter out questions that don't apply to this user
          let question = teamOb['teamQ'+i]
          if(question != null){ //sometimes there's no question
            let questionUser = question.match('^.*Ͱ');
            if(question == '' || (questionUser[0].indexOf(userCat) < 0 && questionUser[0].indexOf('B') < 0) ){
              delete teamOb['teamQ'+i];
            }
            else teamOb['teamQ'+i] = teamOb['teamQ'+i].replace(/^.*Ͱ/,'');
          }
        }
      }
      object[team] = teamOb;
    }
  }
  
  return object;
}

function testTeams() {
  Logger.log(getTeams())
}
