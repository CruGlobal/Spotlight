// Production
window.analyticsURL = "https://script.google.com/macros/s/AKfycbxzRc9PkVmB7aMxVr96K03h2s7DXQtycmrbaJ5iWe_EqJBXQ6LpplGdODelCcKg_hO-gg/exec";

//HELPER FUNCTIONS 
function getOS() {
  var userAgent = window.navigator.userAgent,
      platform = window.navigator?.userAgentData?.platform || window.navigator.platform,
      macosPlatforms = ['Macintosh', 'MacIntel', 'MacPPC', 'Mac68K'],
      windowsPlatforms = ['Win32', 'Win64', 'Windows', 'WinCE'],
      iosPlatforms = ['iPhone', 'iPad', 'iPod'],
      os = userAgent || platform;

  if (macosPlatforms.indexOf(platform) !== -1) {
    os = 'Mac OS';
  } else if (iosPlatforms.indexOf(platform) !== -1) {
    os = 'iOS';
  } else if (windowsPlatforms.indexOf(platform) !== -1) {
    os = 'Windows';
  } else if (/Android/.test(userAgent)) {
    os = 'Android';
  } else if (/Linux/.test(platform)) {
    os = 'Linux';
  }

  return os;
}
function getScreenSize() {
  const width  = window.innerWidth  || document.documentElement.clientWidth  || document.body.clientWidth;
  const height = window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight;

  return `${width}x${height}`;
}
function isTouchCapable() {
  return window.matchMedia("(pointer: coarse)").matches;
}

//DeviceInfo(deviceID, os, screen dimensions, touch capable, )
if(!localStorage.getItem('analyticID')){
  localStorage.setItem('analyticID',self.crypto.randomUUID()); //random anyonymous id
  logData('platform', getOS());
  logData('screenSize', getScreenSize());
  logData('touch', isTouchCapable());
}
else {
  console.log(localStorage.getItem('analyticID'));
}

window.addEventListener("load", (event) => {
  logData('loadTime', window.performance.timing.domContentLoadedEventEnd - window.performance.timing.navigationStart);
  submitLogData();
});
window.addEventListener("visibilitychange", (event)=> {
  logData('timing', 'visibilityChange');
  submitLogData();
});

//Capture function
function logData(header, information, time = new Date().getTime()) {
  let id = localStorage.getItem('analyticID');
  let dataLog = JSON.parse(localStorage.getItem('dataLog')) || [];
  if(typeof information == 'string'){
    information = information.replace('#','');
  }
  dataLog.push(encodeURI(`Timestamp=${time}&analyticId=${id}&${header}=${information}`));
  localStorage.setItem('dataLog', JSON.stringify(dataLog));
}

//SUBMIT LOCATION FORM AFTER PROCESSING CURRENT PAGE
async function submitLogData(){
  let dataLog = JSON.parse(localStorage.getItem('dataLog')) || [];

  let queryString = dataLog.join('+');

  //submit everything - we can do this in one go.
  await fetch(window.analyticsURL+`?${queryString}`, {
    method: "GET",
    dataType: "json",
  }).then(handleErrors)
  .then(json)
  .then(function(data){
   // console.log(data);
    localStorage.removeItem('dataLog'); //reset datalogs
  }).catch(function(error){
    console.log(error.message);
  });
}
