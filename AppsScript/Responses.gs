function saveResponseToCache(e){
  let formSubs = e.queryString.split('+').map(form => form.split('&').map(param => [param.split('=')[0],decodeURIComponent(param.split('=')[1])]));
  let phone = e.queryString.match(/userPhone=(\d*)&/)[1];

  for(form of formSubs){
    form.push(['Timestamp',new Date()]);
  }

  let success = false;
  
  //locking to be sure that we don't overwrite the same variable twice.  
  let lock = LockService.getPublicLock();
  lock.waitLock(30000);  // wait 30 seconds before conceding defeat.

  try {
    let responseCache = (JSON.parse(SCRIPT_PROP.getProperty('responseCache')) || []);
    responseCache.push(...formSubs);
    SCRIPT_PROP.setProperty('responseCache',JSON.stringify(responseCache));

    updateMovementsInCache(formSubs); 

    lock.releaseLock();

    success = phone;
    
  } catch (error) {
    MailApp.sendEmail('carl.hempel@cru.org', 'Script Error', JSON.stringify(error));
    lock.releaseLock();
  }
  return success;
}

function testResponseCache(){
  Logger.log(SCRIPT_PROP.getProperty('responseCache'))
  let e = {
    "parameters": {
        "movementId": [
            "96"
        ],
        "personalEvang": [
            "1"
        ],
        "userName": [
            "Carl Hempel"
        ],
        "startDate": [
            ""
        ],
        "userPhone": [
            "8453320550"
        ],
        "holySpiritPres": [
            "0"
        ],
        "spiritualConvo": [
            "4"
        ],
        "endDate": [
            "3/24/2022"
        ],
        "personalEvangDec": [
            "1"
        ]
    },
    "contextPath": "",
    "parameter": {
        "startDate": "",
        "spiritualConvo": "4",
        "personalEvangDec": "1",
        "personalEvang": "1",
        "movementId": "96",
        "userName": "Carl Hempel",
        "holySpiritPres": "0",
        "userPhone": "8453320550",
        "endDate": "3/24/2022"
    },
    "contentLength": -1,
    "queryString": "startDate=&endDate=3%2F24%2F2022&movementId=96&userName=Carl%20Hempel&userPhone=8453320550&spiritualConvo=4&personalEvang=1&personalEvangDec=1&holySpiritPres=0"
}
  Logger.log(saveResponseToCache(e))
}

function writeCacheToSheets(){
  // shortly after my original solution Google announced the LockService[1]
  // this prevents concurrent access overwritting data
  // [1] http://googleappsdeveloper.blogspot.co.uk/2011/10/concurrency-and-google-apps-script.html
  // we want a public lock, one that locks for all invocations
  let lock = LockService.getPublicLock();
  
  try {
    // set where we write the data - you could write to multiple/alternate destinations
    var doc = SpreadsheetApp.openById(SCRIPT_PROP.getProperty("key"));
    var sheet = doc.getSheetByName(RESPONSE_SHEET);

    lock.waitLock(30000);  // wait 30 seconds before conceding defeat.

    let formSubs = JSON.parse(SCRIPT_PROP.getProperty('responseCache'));

    let missing_params = [];
    //first loop through each sub and make sure that all headers are present.
    for(sub of formSubs){
      let headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      let param_ob = {};
      
      //create param_ob and add headers if missing
      for(param of sub){
        if(!headers.includes(param[0]) && !missing_params.includes(param[0])){ //we need to add this to the headers row.
          missing_params.push(param[0]);
        }
        param_ob[param[0]] = param[1];
      }
    }
    //set new headers and regen the headers var
    if(missing_params.length != 0){
      sheet.getRange(1,sheet.getMaxColumns()+1,1,missing_params.length).setValues([missing_params]);
    }

    let formattedSubs = [];

    //then loop through each submission and build array to save to the sheet.
    for(sub of formSubs){
      let headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      let param_ob = {};

      for(param of sub){
        param_ob[param[0]] = param[1];
      }

      var row = [];
      // loop through the header columns
      for (i in headers){
        let value = param_ob[headers[i]];
        if(value === undefined) { value = ''; }
        row.push(value);
      }
      formattedSubs.push(row);
    }

    var nextRow = sheet.getLastRow()+1; // get next row
    // finally write all subs to the sheet at the end.
    sheet.getRange(nextRow, 1, formattedSubs.length, formattedSubs[0].length).setValues(formattedSubs);
    
    SpreadsheetApp.flush();
    //setMovementsScriptProperty();
    //SCRIPT_PROP.deleteProperty('responseCache');

  } catch(error){
    MailApp.sendEmail('carl.hempel@cru.org', 'Script Error', JSON.stringify(error));
  } finally { //release lock
    lock.releaseLock();
  }
}
