//Infobase API documentation at https://campus-contacts-api.cru.org/docs/apis::v4::movementindicatorstats/submit_movement_indicator_stats

const API_KEY = 'api.key';

function onOpen(){
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Authentication')
    .addItem('Set Authorization Token', 'setKey')
    .addItem('Delete Authorization Token', 'deleteKey')
  .addToUi();
}
function setKey(){
  var ui = SpreadsheetApp.getUi();
  var scriptValue = ui.prompt('Please provide your Infobase Authorization Token.' , ui.ButtonSet.OK);
  SCRIPT_PROP.setProperty(API_KEY, scriptValue.getResponseText());
  GmailApp.sendEmail('spotlight@cru.org','Server: API key set', 'API Key was set', {'from': 'spotlight@cru.org', 'name': 'Spotlight'});
}
function deleteKey(){
  SCRIPT_PROP.deleteProperty(API_KEY);
  GmailApp.sendEmail('spotlight@cru.org','Server: API key deleted', 'API Key was deleted', {'from': 'spotlight@cru.org', 'name': 'Spotlight'});
}
function getKey() {
  return SCRIPT_PROP.getProperty(API_KEY);
}
function getStatsPeriodDates() {
  let beginDate = new Date();
  let endDate = new Date();

  let beginOffset = beginDate.getDate() - (beginDate.getDay() || 7);
  let endOffset = endDate.getDate() - (endDate.getDay() ? 0 : 1);
  let end = Utilities.formatDate(new Date(endDate.setDate(endOffset)), "UTC", "YYYY-MM-dd");
  let begin = Utilities.formatDate(new Date(beginDate.setDate(beginOffset)), "UTC", "YYYY-MM-dd");

  return {'begin': begin, 'end': end};
}
function getStatsForPeriod(movementsList){ //defaults to the previous sunday until now.
  let period = getStatsPeriodDates();
  Logger.log(JSON.stringify(period));
  
  let doc = SpreadsheetApp.openById(SCRIPT_PROP.getProperty("key"));
  let sheet = doc.getSheetByName('Responses');
  let data = sheet.getDataRange().getValues();

  let INFOBASE_VALID = ["students_involved",
        "faculty_involved",
        "students_engaged",
        "faculty_engaged",
        "student_leaders",
        "faculty_leaders",
        "spiritual_conversations",
        "holy_spirit_presentations",
        "personal_evangelism",
        "personal_decisions",
        "graduating_on_mission",
        "group_evangelism",
        "group_decisions",
        "media_exposures",
        "media_decisions"];

  let movementsObject = {};
  let headers = data.shift();

  for(row of data){ //rows are response submissions
    let movementId = String(row[5]);
    if(movementId.toLowerCase().indexOf('c') != 0 || movementsList.indexOf(parseInt(movementId.replace('c', ''))) == -1){ //We don't want to include SM IDs or non-infobase movement ids
      continue;
    }

    let submissionDate = new Date(Utilities.formatDate(new Date(row[2]), "UTC", "YYYY-MM-dd"));
    
    //Check that data row falls in the right period and is a campus activity.  
    if(submissionDate >= new Date(period.begin) && submissionDate <= new Date(period.end)){
      if(!movementsObject[movementId]){ //check to be sure that the mvoement exists.
        movementsObject[movementId] = {"activity_id": movementId.replace('c',""),
                                       "period_begin": period.begin,
                                       "period_end": period.end};
      }
      for(i=6; i < row.length; i++){
        let header = headers[i];
        if(INFOBASE_VALID.indexOf(header) > -1 && !isNaN(parseInt(row[i]))){ //make sure we've got a valid infobase id and there's a number recorded
          if(!movementsObject[movementId][header]){  //check to be sure that the property for this header exists.
            movementsObject[movementId][header] = 0;
          }
          movementsObject[movementId][header] += parseInt(row[i]) || 0;      
        }
      }
    }
    else {
      //Logger.log('not in range');
    }
  }
  return Object.values(movementsObject);
}
function submitMovementData() {
  var myHeaders = {};
  myHeaders.Authorization = "Bearer " + getKey();

  /*var statistics = JSON.stringify({
    "statistics": [
      {
        "activity_id": 14042,
        "period_begin": "2022-10-09",
        "period_end": "2022-10-16",
        "students_involved": "42",
        "faculty_involved": 2,
        "students_engaged": 2,
        "faculty_engaged": 1,
        "student_leaders": 1,
        "faculty_leaders": 1,
        "spiritual_conversations": 11,
        "holy_spirit_presentations": 1,
        "personal_evangelism": 1,
        "personal_decisions": 1,
        "graduating_on_mission": 1
      },
      {
        "activity_id": 5962,
        "period_begin": "2022-06-26",
        "period_end": "2022-07-02",
        "students_involved": 10,
        "faculty_involved": 11,
        "students_engaged": 12,
        "faculty_engaged": 13,
        "student_leaders": 14,
        "faculty_leaders": 15,
        "spiritual_conversations": 2,
        "holy_spirit_presentations": 5,
        "personal_evangelism": 3,
        "personal_decisions": 4,
        "graduating_on_mission": 0,
        "group_evangelism": 3,
        "group_decisions": 5,
        "media_exposures": 4,
        "media_decisions": 3
      }
    ]
  });*/

  let allMovements = getAllMovements()
  let listOfPossibleMovements = allMovements.activities.map(min => min.id); //get movements from Infobase

  let statistics = JSON.stringify({'statistics': getStatsForPeriod(listOfPossibleMovements)});
  Logger.log(JSON.parse(statistics).statistics.length);

  var requestOptions = {
    method: 'POST',
    headers: myHeaders,
    payload: statistics,
    contentLength: statistics.length,
    contentType: "application/json",
    redirect: 'follow'
  };

  let url = 'https://infobase-stage.cru.org/api/v1/statistics';

  var response = UrlFetchApp.fetch(url, requestOptions);

  Logger.log(response);

}

function getAllMovements() {
  var myHeaders = {};
  myHeaders.Authorization = "Bearer " + getKey();

  var requestOptions = {
    method: 'GET',
    headers: myHeaders,
    contentType: "application/json",
    redirect: 'follow'
  };

  let url = 'https://infobase-stage.cru.org/api/v1/activities?per_page=10000';

  return JSON.parse(UrlFetchApp.fetch(url, requestOptions));
}
