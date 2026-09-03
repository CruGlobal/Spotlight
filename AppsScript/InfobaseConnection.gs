//Infobase API documentation at https://campus-contacts-api.cru.org/docs/apis::v4::movementindicatorstats/submit_movement_indicator_stats

const API_KEY = 'api.key';
const API_URL = 'api.url';

function setKey(){
  var ui = SpreadsheetApp.getUi();
  var scriptValue = ui.prompt('Please provide your Infobase Authorization Token.' , ui.ButtonSet.OK);
  SCRIPT_PROP.setProperty(API_KEY, scriptValue.getResponseText());
  GmailApp.sendEmail(MAINTAINER_EMAIL,'Server: API key set', 'API Key was set');
}
function deleteKey(){
  SCRIPT_PROP.deleteProperty(API_KEY);
  GmailApp.sendEmail(MAINTAINER_EMAIL,'Server: API key deleted', 'API Key was deleted');
}
function getKey() {
  return SCRIPT_PROP.getProperty(API_KEY);
}
function setURL(){
  var ui = SpreadsheetApp.getUi();
  var scriptValue = ui.prompt('Please provide the Infobase base URL(Ex: https://infobase-stage.cru.org/api/v1/ - must include the last "/").' , ui.ButtonSet.OK);
  SCRIPT_PROP.setProperty(API_URL, scriptValue.getResponseText());
  GmailApp.sendEmail(MAINTAINER_EMAIL,'Server: API URL set', 'API URL was set');
}
function deleteURL(){
  SCRIPT_PROP.deleteProperty(API_URL);
  GmailApp.sendEmail(MAINTAINER_EMAIL,'Server: API URL deleted', 'API URL was deleted');
}
function getURL() {
  return SCRIPT_PROP.getProperty(API_URL);
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

  //Counted, because both of the movement skips below are SILENT DATA LOSS and neither left any
  //trace. A campus row whose id is missing from the Infobase activity list is simply never
  //reported, and that is indistinguishable from a week where nobody submitted anything.
  let skippedNotCampus = 0;
  let skippedNotInInfobase = [];
  let skippedOutOfPeriod = 0;
  let included = 0;

  //Hoisted. Built inside the loop these were two Date allocations per row - roughly 32,000 of
  //them on a sheet this size, every run, against a 6 minute execution limit.
  let periodBegin = new Date(period.begin);
  let periodEnd = new Date(period.end);

  for(row of data){ //rows are response submissions
    //THE PERIOD CHECK COMES FIRST, and that ordering is the whole point.
    //
    //It used to sit AFTER the two movement checks, which meant every row in the sheet's entire
    //history was tested against the Infobase activity list before anything looked at its date.
    //The Responses sheet is append-only and holds years of submissions, so any movement that has
    //since left that list contributed one "dropped" count per historical row it had ever
    //submitted. The first report read 708 dropped rows across 51 movements when THREE were in the
    //period - the other 705 were 2022-2026 history, 367 of them from 2023 alone.
    //
    //Which rows get skipped is unchanged either way. What changes is that all three counters now
    //describe the reporting period and nothing else, so the number in the email is actionable.
    let submissionDate = new Date(Utilities.formatDate(new Date(row[0]), "UTC", "YYYY-MM-dd"));
    if(submissionDate < periodBegin || submissionDate > periodEnd){
      skippedOutOfPeriod += 1;
      continue;
    }

    let movementId = String(row[2]);
    //Split into two checks purely so the log can tell them apart - the combined condition is
    //unchanged, and so is which rows get skipped.
    if(movementId.toLowerCase().indexOf('c') != 0){ //We don't want to include SM IDs
      skippedNotCampus += 1;
      continue;
    }
    if(movementsList.indexOf(parseInt(movementId.replace('c', ''))) == -1){ //or non-infobase movement ids
      skippedNotInInfobase.push(movementId);
      continue;
    }

    if(!movementsObject[movementId]){ //check to be sure that the mvoement exists.
      movementsObject[movementId] = {"activity_id": movementId.replace('c',""),
                                     "period_begin": period.begin,
                                     "period_end": period.end};
    }
    for(i=3; i < row.length; i++){
      let header = headers[i];
      if(INFOBASE_VALID.indexOf(header) > -1 && !isNaN(parseInt(row[i]))){ //make sure we've got a valid infobase id and there's a number recorded
        if(!movementsObject[movementId][header]){  //check to be sure that the property for this header exists.
          movementsObject[movementId][header] = 0;
        }
        movementsObject[movementId][header] += parseInt(row[i]) || 0;
      }
    }
    included += 1;
  }

  //The one line that answers "is this actually working?". skippedNotInInfobase is the number that
  //matters: those are campus submissions that Spotlight accepted from a real user and then threw
  //away, usually because the Movements sheet and Infobase's activity list have drifted apart.
  Logger.log('getStatsForPeriod ' + period.begin + '..' + period.end
             + ' - included ' + included + ' row(s) across ' + Object.keys(movementsObject).length
             + ' movement(s); skipped ' + skippedOutOfPeriod + ' outside the period, '
             + skippedNotCampus + ' non-campus, '
             + skippedNotInInfobase.length + ' campus rows whose movement is not in Infobase');

  if(skippedNotInInfobase.length){
    //The COUNT stays out of the message and lives in the context instead. notifyFailure dedupes on
    //where + the first line of the message, so a count that changes every run would mint a fresh
    //signature - and therefore a fresh fail_* Script Property - every time. That is the same
    //unbounded-signature problem the clientError path in Config.gs was fixed for.
    notifyFailure('getStatsForPeriod: campus submissions dropped',
      new Error('campus row(s) were discarded because their movement id is not in the Infobase activity list'),
      {rows: skippedNotInInfobase.length,
       movementIds: skippedNotInInfobase.filter(onlyUnique).join(', ').substring(0, 3000),
       period: period.begin + '..' + period.end});
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
        "period_begin": "2022-10-30",
        "period_end": "2022-11-02",
        "students_involved": 10,
        "faculty_involved": 11,
        "students_engaged": 12,
        "faculty_engaged": 13,
        "student_leaders": 14,
        "faculty_leaders": 15,
        "spiritual_conversations": 16,
        "holy_spirit_presentations": 17,
        "personal_evangelism": 18,
        "personal_decisions": 19,
        "graduating_on_mission": 20,
        "group_evangelism": 21,
        "group_decisions": 22,
        "media_exposures": 23,
        "media_decisions": 24
      }
    ]
  });*/

  try {
    let timeZone = Session.getScriptTimeZone();
    let date = Utilities.formatDate(new Date(SCRIPT_PROP.getProperty('date')),timeZone,"MM/dd/yyyy");
    let today = Utilities.formatDate(new Date(),timeZone,"MM/dd/yyyy");

    //first time today!
    if(date != today){
      SCRIPT_PROP.setProperty('tries', 1);
      SCRIPT_PROP.setProperty('date', today);
    }
    else if(parseInt(SCRIPT_PROP.getProperty('tries')) > 3){  //we're done trying!
      //This return was commented out, so the give-up guard did nothing: execution fell
      //straight through and tried again anyway. Combined with the recursive retry that used
      //to sit in the catch below, any persistent failure looped until the 6 minute timeout,
      //emailing on every pass and eating the mail quota that PIN and registration email share.
      notifyFailure('submitMovementData', new Error('gave up after more than 3 tries today'),
                    {tries: SCRIPT_PROP.getProperty('tries')});
      return;
    }
    else {
      SCRIPT_PROP.setProperty('tries', parseInt(SCRIPT_PROP.getProperty('tries')) + 1);
    }

    let allMovements = getAllMovements();
    let listOfPossibleMovements = allMovements.activities.map(min => min.id); //get movements from Infobase
    Logger.log(Boolean(listOfPossibleMovements.find(itm => itm == 7264)) )

    let statistics = JSON.stringify({'statistics': getStatsForPeriod(listOfPossibleMovements)});
    Logger.log(JSON.parse(statistics).statistics.length);
    Logger.log(JSON.parse(statistics).statistics.map(el => el.activity_id));

    var requestOptions = {
      method: 'POST',
      headers: myHeaders,
      payload: statistics,
      contentLength: statistics.length,
      contentType: "application/json",
      redirect: 'follow',
      muteHttpExceptions: true
    };

    let url = getURL()+'statistics';

    var response = UrlFetchApp.fetch(url, requestOptions);

    //muteHttpExceptions above stops a non-2xx from throwing, which is what we want - the response
    //BODY carries Infobase's own explanation and is worth more than a bare exception. But muting
    //without then checking the status is what made this function report success unconditionally:
    //a 401 from an expired token and a 500 from Infobase both arrived here, were assigned to an
    //unused variable, and were followed by an email saying "Successful Update!".
    //
    //Logger.log(response) was the other half of it. That logs the HTTPResponse OBJECT, which
    //stringifies to something useless, so even the execution log held no evidence.
    var code = response.getResponseCode();
    var body = response.getContentText();
    //Parsed once and reused - the email template below used to re-parse the whole payload twice more.
    var submitted = JSON.parse(statistics).statistics;
    var count = submitted.length;

    Logger.log('Infobase POST ' + url + ' -> HTTP ' + code);
    Logger.log(body);

    if(code < 200 || code >= 300){
      notifyFailure('submitMovementData: Infobase rejected the statistics POST',
                    new Error('HTTP ' + code),
                    {url: url, movements: count, tries: SCRIPT_PROP.getProperty('tries'),
                     response: String(body).substring(0, 3000)});
      return;  //no success email on a failed post
    }

    //Movement NAMES come from the movements cache, never from the payload. getStatsForPeriod()'s
    //objects are stringified straight into the POST above, so hanging a name on them would send
    //Infobase a field it never asked for.
    //
    //The cache is keyed WITH the prefix ('c15195') while activity_id is the bare number, so the
    //lookup key is 'c' + activity_id. That is safe rather than lucky: an uppercase 'C15195' clears
    //getStatsForPeriod's first check but parseInt()s to NaN and fails its activity-list check, so
    //only lowercase-'c' ids ever reach the payload.
    var movementNames = {};
    try {
      movementNames = JSON.parse(SCRIPT_PROP.getProperty('movements')) || {};
    } catch(err){
      //A label is a convenience and must never cost the success email. Rows fall back to bare ids.
      Logger.log('could not read the movements cache for email labels: ' + err.message);
    }

    //Plain text, deliberately. Campus names contain ampersands ("Texas A&M"), there is no
    //HTML-escape helper anywhere in this project, and an unescaped & in an htmlBody renders wrong.
    //Mail clients auto-link a bare URL anyway, so nothing is gained by going to HTML.
    var movementLines = submitted.map(function(el){
      var cached = movementNames['c' + el.activity_id];
      //Same fallback as emailTeamStories(): a movement missing from the cache shows its id rather
      //than blanking the row.
      var label = (cached && cached.name) ? cached.name + ' (' + el.activity_id + ')'
                                          : String(el.activity_id);
      return label + ': https://infobase.cru.org/locations/0/movements/' + el.activity_id + '/stats';
    }).join('\n - ');

    //The body is included even on success. A 2xx here means Infobase ACCEPTED the request, not
    //that every record in it was stored - per-record problems come back inside a 200, and until
    //now nobody could see them.
    GmailApp.sendEmail('carl.hempel@cru.org','Successful Update!',
      `HTTP ${code}\n\nNum of Movements: ${count} \n\nMovements: \n - ${movementLines}`
      + `\n\nInfobase response:\n${String(body).substring(0, 3000)}`);
  }
  catch(error) {
    //Deliberately does NOT call submitMovementData() again. It used to, which made every
    //failure recurse without bound. The time-based trigger will run this again on schedule,
    //and the tries counter above caps the attempts per day.
    notifyFailure('submitMovementData', error, {tries: SCRIPT_PROP.getProperty('tries')});
  }
}

function getAllMovements() {
  var myHeaders = {};
  myHeaders.Authorization = "Bearer " + getKey();

  var requestOptions = {
    method: 'GET',
    headers: myHeaders,
    contentType: "application/json",
    redirect: 'follow',
    //Muted so the body can be read and reported. Unmuted, a 401 threw an Apps Script exception
    //whose message truncates the body, and an HTML error page then reached JSON.parse and failed
    //as "Unexpected token <" - which says nothing about the token having expired.
    muteHttpExceptions: true
  };

  let url = getURL()+'activities?per_page=10000';

  var response = UrlFetchApp.fetch(url, requestOptions);
  var code = response.getResponseCode();
  var body = response.getContentText();

  if(code < 200 || code >= 300){
    throw new Error('Infobase GET ' + url + ' returned HTTP ' + code + ': '
                    + String(body).substring(0, 1000));
  }

  var parsed;
  try {
    parsed = JSON.parse(body);
  } catch(err){
    throw new Error('Infobase GET ' + url + ' returned HTTP ' + code
                    + ' but the body was not JSON: ' + String(body).substring(0, 1000));
  }

  //This list is a FILTER, not just a lookup: getStatsForPeriod() drops every movement that is not
  //in it. So a response that parses but carries no activities is not a harmless empty result - it
  //silently discards the whole week's stats. Fail loudly instead, and log the count either way so
  //a list that is merely short is visible too.
  if(!parsed || !Array.isArray(parsed.activities)){
    throw new Error('Infobase GET ' + url + ' returned HTTP ' + code
                    + ' with no activities array: ' + String(body).substring(0, 1000));
  }
  Logger.log('Infobase GET ' + url + ' -> HTTP ' + code + ', ' + parsed.activities.length + ' activities');

  return parsed;
}
