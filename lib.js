// Production
window.indicatorAppURL = "https://script.google.com/macros/s/AKfycbzluLRHNFKprWcw6lK5dIgwKw8k-f5XJ4zi1jE-5cjFBdYj8VRAi5fjtY2A2JurzkTM/exec";

// Dev
//window.indicatorAppURL = "https://script.google.com/macros/s/AKfycbxWTt86lv0Jpr7AqTaL1yHzTv5NOl7UdAOfYeSUcx8n9-IOLUPPcEATLhV1K8fuCfblBg/exec";

var online = false;

function updateOnlineStatus(event) {
  if(event == undefined) {
    event = {};
    event.type = 'windowLoad';
  }
  var condition = navigator.onLine ? "online" : "offline";

  if(!(document.documentElement.classList=='' && condition=='online')){ //no need to notify of online if we start out that way.
    document.documentElement.className = condition;
  }
  online = navigator.onLine;
  console.log("beforeend", "Event: " + event.type + "; Status: " + condition);
}
//Update Online status
window.addEventListener('load', function() {
  function update(event) {
    updateOnlineStatus(event);
  }
  window.addEventListener('online',  update);
  window.addEventListener('offline', update);

  //let people install on their own schedule
//ANDROID
  window.deferredPrompt;
  const addBtn = document.getElementById('add-button');
  addBtn.style.display = 'none';

  window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent Chrome 67 and earlier from automatically showing the prompt
    e.preventDefault();
    // Stash the event so it can be triggered later.
    window.deferredPrompt = e;
    // Update UI to notify the user they can add to home screen
    addBtn.style.display = 'block';
  }); 
//iOS - Detects if device is on iOS 
  const isIos = () => {
    return /iPad|iPhone|iPod/.test(navigator.platform) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  }
  // Detects if device is in standalone mode
  var isInStandaloneMode = false;
  if (matchMedia('(display-mode: standalone)').matches) { // replace standalone with fullscreen or minimal-ui according to your manifest
    isInStandaloneMode = true; // Android and iOS 11.3+
  } else if ('standalone' in navigator) {
    isInStandaloneMode = navigator.standalone; // useful for iOS < 11.3
  }
  // Checks if should display install popup notification:
  if (isIos() && !isInStandaloneMode) {
    addBtn.style.display = 'block';
  }
});
updateOnlineStatus();

function installPWA(){
  if(window.deferredPrompt){ //we've got a deferred prompt!
    // Show the prompt
    window.deferredPrompt.prompt();
    // Wait for the user to respond to the prompt
    window.deferredPrompt.userChoice.then((choiceResult) => {
      if (choiceResult.outcome === 'accepted') {
        document.getElementById('add-button').style.display = 'none';
        document.getElementById('projector').classList.remove('menu');
        window.deferredPrompt = null;
        console.log('User accepted the A2HS prompt');
      } else {
        console.log('User dismissed the A2HS prompt');
      }
      //window.deferredPrompt = null;  //if you want to nullify after a cancel
    });
  }
  else { //we don't have a deferred - let's show iOS or others.
    document.getElementById('install-prompt').style.display = 'block';
    document.addEventListener('click', (e) => {
      if(!e.target.closest('#menu')){
        document.getElementById('install-prompt').style.display = 'none';
      }
    });
  }
}

function toggleRegister(){
  if(document.getElementById('register').checked){
    document.getElementById('regUserName').setAttribute('required', true);
    document.getElementById('regUserEmail').setAttribute('required', true);
    document.getElementById('userToggle').style.display = '';
    document.querySelectorAll('#formSubmit span').forEach(el => el.style.display = '');
  }
  else{
    document.getElementById('regUserName').removeAttribute('required');
    document.getElementById('regUserEmail').removeAttribute('required');
    document.getElementById('userToggle').style.display = 'none';
    document.querySelectorAll('#formSubmit span').forEach(el => el.style.display = "none");
  }
}
function toggleStaff(){
  if(document.getElementById('regUserStaff').checked){
    document.getElementById('staffAcct').setAttribute('required', true);
    document.getElementById('staffToggle').style.display = '';
  }
  else{
    document.getElementById('staffAcct').removeAttribute('required');
    document.getElementById('staffToggle').style.display = "none";
  }
}
//SERVICE WORKER
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', {
    scope: './'
  })
  .then((serviceWorker) => {
    console.log('service worker registration successful');
  })
  .catch((err) => {
    console.error('service worker registration failed');
    console.error(err);
  });
} else {
  console.log('service worker unavailable');
}

//HELPER FUNCTIONS FOR USER
function getUser(){
  try{
    return JSON.parse(localStorage.getItem('SC_user'));
  }
  catch(error) {
    console.log(error, "Clearing local storage");
    removeLocalStorage();
    return false;
  }
}
function setUser(user){
  localStorage.setItem('SC_user', JSON.stringify(user));
  return;
}

async function loadMovements(listOfMovementIDs){
  startSpin();
  let success = false;

  await fetch(window.indicatorAppURL+`?movements=${listOfMovementIDs.join(',')}`, {
    method: "GET",
    dataType: "json"
  }).then(handleErrors)
  .then(json)
  .then(function(data) {
    if(data.result == 'error'){
      alert(data.error);
    }
    success = data;
  }).catch(function(error){
    catchError(error);
  }).then(function(data){
    stopSpin();
  });
  return success;
}

async function registerUser(name, phone, mvmnts, cat, pin, email){
  startSpin();
  phone = phone.replace(/\D/g,'');
  let success = false;
  await fetch(window.indicatorAppURL+`?registerUser=true&phone=${phone}&name=${name}&cat=${cat}&mvmnts=${JSON.stringify(mvmnts)}&pin=${pin}&email=${email}`, {
    method: "GET",
    dataType: "json"
  }).then(handleErrors)
  .then(json)
  .then(function(data){
    //console.log(data);
    setUser(data.user);
    success = data;
  }).catch(function(error){
    catchError(error, false);
  }).then(function(data){
    stopSpin();
  });
  return success;
}
async function updateUser(phone, mvmnts, cat, pin){
  startSpin();
  phone = phone.replace(/\D/g,'');
  let success = false;
  await fetch(window.indicatorAppURL+`?updateUser=true&phone=${phone}&mvmnts=${JSON.stringify(mvmnts)}&cat=${cat}&pin=${pin}`, {
    method: "GET",
    dataType: "json"
  }).then(handleErrors)
  .then(json)
  .then(function(data){
    //console.log(data);
    setUser(data.user);
    success = data;
  }).catch(function(error){
    catchError(error, false);
  }).then(function(data){
    stopSpin();
  });
  return success;
}
async function requestUser(phone, pin, spin=true){
  if(spin) {startSpin();}
  let success = false;
  await fetch(window.indicatorAppURL+`?requestUser=true&phone=${phone}&pin=${pin}`, {
    method: "GET",
    dataType: "json"
  }).then(handleErrors)
  .then(json)
  .then(function(data){
    success = data;
    let user = data.user;
    setUser(user);
    window.user = user;
  }).catch(function(error){
    catchError(error, false);
  });
  if(spin) {stopSpin();}
  return success;
}
async function requestPin(){
  let phone = document.getElementById('regUserPhone').value.replace(/\D/g,'');
  if(phone.length != 10){
    alert('please enter a valid 10 digit phone number');
    return
  }
  startSpin()
  await fetch(window.indicatorAppURL+`?requestPin=true&phone=${phone}`, {
    method: "GET",
    dataType: "json"
  }).then(handleErrors)
  .then(json)
  .done(function(data){
    //console.log(data);
    alert(data.text);
  });
  stopSpin();
  return jqxhr;
}

//ADD EVENT LISTENERS HASHCHANGE, AND setup variables
document.addEventListener("DOMContentLoaded", function(){
  window.addEventListener("hashchange", hashchanged, false);
  hashchanged();

  //clean up masked input fields.
  for(elment of document.getElementsByClassName('masked')){
    elment.dispatchEvent(new Event('keyup'));
  }
  const links = document.querySelectorAll("[data-part1][data-part2][data-part3][data-part4]");
  for (const link of links) {
    const attrs = link.dataset;
    link.setAttribute(
      "href",
      `mailto:${attrs.part1}@${attrs.part2}.${attrs.part3}?subject=${encodeURIComponent(attrs.part4)}`
    );
  }

  window.formSubs = JSON.parse(localStorage.getItem('formSubs')) || {};

  document.body.addEventListener("click", function (e) {
    if(document.getElementById('projector').classList.contains('summary')){
      party.confetti(e, {
          count: party.variation.range(20, 20)
        });
    }
  });

  //setup form listeners.
  var form = document.getElementById('onboard-form');
  if (form.attachEvent) {
      form.attachEvent("submit", processOnboardForm);
  } else {
      form.addEventListener("submit", processOnboardForm);
  }

  //add +/- buttons to input[type="number"]
  document.getElementById('statsList').addEventListener('click', function(e) {
    if(e.target && e.target.classList.contains('button')){
      let button = e.target;
      let inputEl = button.parentElement.querySelectorAll('input')[0];
      let oldValue = inputEl.value;
      let newVal = parseInt(oldValue) || 0;
      if (button.textContent == "+") {
        newVal += 1;
      } else {
        newVal -= 1;
      }
      inputEl.value = newVal;
      document.getElementById('statsList').dispatchEvent(new Event("change"));
    }
  });
  document.getElementById('statsList').addEventListener('change', saveFormToFormSubs);
});
function saveFormToFormSubs(e) {
  //get all question values
  let varVals = {};
  for(question of document.querySelectorAll('#statsList input')) { //compile object for tooLow calcs.
    varVals[question.id] = question.value;
  }

  for(question of Object.keys(user.questionRels)){
    let tooLow = 0;
    //checking if any are greater than the question
    if(user.questionRels[question].lessThan) {
      for(relVar of user.questionRels[question].lessThan){
        tooLow += (parseInt(varVals[question]) < parseInt(varVals[relVar]));
      }
    }
    if(document.getElementById(question)){
      if(tooLow){ //Add Too Low bubble
        document.getElementById(question).parentElement.classList.add('tooLow');
      } else {
        document.getElementById(question).parentElement.classList.remove('tooLow');
      }
      if(parseInt(varVals[question]) < 0){  //Add red highlight to negative numbers
        document.getElementById(question).classList.add('negative');
      } else {
        document.getElementById(question).classList.remove('negative');
      }
    }
  }
  processLocationForm();
}

function resetUser(){
  removeLocalStorage();
  location.hash = '#';
  location.reload();
}

//HASHCHANGE AND LOAD MOVEMENT LIST INTO MEMORY
async function hashchanged(){
  var hash = location.hash;
  let projector = document.getElementById('projector');

  //Set sidebar menu icon
  document.getElementsByClassName('hamburger')[0].classList.remove('active');

  //RESET CODE
  if(hash.startsWith('#reset')) {
    if(confirm('Log out?')){
      resetUser();
    }
    else{
      location.hash = '#';
    }
    return;
  }

  //Make sure we've got a user.
  let local_user = getUser();
  if(local_user){
    if(!window.user){ //first time opening the website - let's check for changes to the user.
      console.log('requesting user', local_user.phone);
      let result = await requestUser(local_user.phone, local_user.pin);
      if(!result){ //we'll go with what we've got if no internet
        window.user = local_user;
      }
      else if(result.result == "success"){
        console.log('got the user from db');
      }
      else {
        alert("Please log in again")
        resetUser();
        return;
      }
    }
  }
  else if(!hash.startsWith('#onboarding')){
    console.log('redirecting to onboarding b/c no user exists');
    location.hash = "#onboarding";
    return;
  }

//IF BLANK WE START HERE>
  if(hash == ''){
    location.hash = '#locations/0/'+window.user.movements[0].id;
  }
//ONBOARDING!-----------------------------------------------------------------
  else if(hash.startsWith('#onboarding')){
    document.querySelectorAll('.pin').forEach(el => el.style.display = 'none');
    if(window.user){
      let notifyEl = document.getElementById('notification');
      if(notifyEl){notifyEl.remove()}
      let notification = `<div id="notification">You visited an onboarding link. Click <a onclick="removeLocalStorage(); 
        document.getElementById('notification').remove();" href="${hash}">here</a> to set up!<button style="float:right; background: unset; height: unset;" 
        onclick="document.getElementById('notification').remove();">X</button></div>`
      document.getElementById('locations').insertAdjacentHTML('afterbegin', notification);
      location.hash = "#";
      return;
    }
    document.getElementById('movements').innerHTML = '';
    document.querySelectorAll('input[type="checkbox"]').forEach(el => el.removeAttribute('checked'));
    document.getElementById('userToggle').style.display = 'none';
    document.getElementById('staffToggle').style.display = 'none';
    document.querySelectorAll('#formSubmit span').forEach(el => el.style.display = 'none');

    let movements = [];
    try {
      movements = hash.split('/')[1].split('&');
    }
    catch {
      movements = false;
    }
    //then lets show our movements page
    if(movements){
      let movementsList = await loadMovements(movements);
      if(!movementsList){
        location.hash = '#onboarding';
        document.getElementById('onboarding').insertAdjacentHTML('afterbegin', '<div id="notification">You visited an onboarding link. Click <a onclick="removeLocalStorage(); document.getElementById(\'notification\').remove();" href="'+hash+'">here</a> to set up!</div>')
        return;
      }
      for(movement of movementsList) {
        document.getElementById('movements').insertAdjacentHTML('beforeend', '<input id="n'+movement.id+'" name="'+movement.id+'" type="checkbox" ><label for="n'+movement.id+'" >'+movement.name+'</label>');
      }
      document.querySelectorAll('.movementInfo').forEach(el => el.style.display = '');
      document.querySelectorAll('.loginInfo').forEach(el => el.style.display = 'none');
    }
    //otherwise, lets login or add movements from a dropdown if/when that's added.
    else {
      document.querySelectorAll('.movementInfo').forEach(el => el.style.display = 'none');
      document.querySelectorAll('.loginInfo').forEach(el => el.style.display = '');
      toggleRegister();
      toggleStaff();
    }

    projector.classList = 'onboarding';
    window.document.title = "Let's get you onboarded!";
  }
//LOCATIONS!-----------------------------------------------------------------
  else if(hash.startsWith('#locations')){
    // #locations - start with current location
    let user = window.user;
    let movement_num = parseInt(hash.split('/')[1]);
    (user.movements.length == 1 ? document.querySelectorAll('.mvBtn').forEach(el => el.style.display = 'none') : document.querySelectorAll('.mvBtn').forEach(el => el.style.display = ''));

    //if we fail, redirect to first location
    try {
      var movement = user.movements[movement_num];
      let strategy = user.strategies[movement.strat];

      document.getElementById('strategyWelcomeText').innerHTML = user.name + ', ' +strategy.welcomeText.charAt(0).toLowerCase() + strategy.welcomeText.slice(1); 
      document.documentElement.style.setProperty('--main-color', strategy.primaryColor);

      let statsListContent='';
      for(question of strategy.questions){
        let helpText='';
        if(user.questionRels[question.id] && user.questionRels[question.id].lessThan){
          helpText = user.questionRels[question.id].lessThan;
          let newHelp = [];
          for(i = 0; i < helpText.length; i++){
            try {
              newHelp.push(strategy.questions.filter(item => item.id == helpText[i])[0].name);
            }
            catch {
            }
          }
          helpText = newHelp;
          helpText = helpText.join(', ').replace(/, ([^,]*)$/, ', and $1');
        }
        statsListContent += `<div class="statsListLeft">
          <label for="${question.id}">${question.name}</label>
          <span rel="tooltip" title="${question.description.replace(/"/g,"'")}">i</span>          
        </div>
        <div class="statsListRight" data-over="should be as high as ${helpText}">
          <span class="dec button">-</span>
          <input id="${question.id}" name="${question.id}" type="number" inputmode="numeric" value="0">
          <span class="inc button">+</span>
        </div>`;
      }
      //add Team Questions.  Will need to send team table, and what teamid in user.movements
      for(i = 1; i <= 3; i++){
        try {
          let teamQ = user.teams[movement.tID]['teamQ'+i].trim().replace(/^.*Ͱ/,'');
          if(teamQ != ''){
            statsListContent += `<div class="statsListLeft">
              <label for="teamQ${i}">${teamQ}</label>
              <span rel="tooltip" title="${teamQ.replace(/"/g,"'")}">i</span>
            </div>
            <div class="statsListRight">
              <span class="dec button">-</span>
              <input id="teamQ${i}" name="teamQ${i}" type="number" inputmode="numeric" value="0">
              <span class="inc button">+</span>
            </div>`;
          }
        } 
        catch {
          
        }
      }

      document.getElementById('statsList').innerHTML = statsListContent;
      setToolTips();

      let storyBox = user.teams[movement.tID].storyBox;
      let storyBoxContent = '';
      if(storyBox) {
        storyBoxContent += `<label for="storyBox">${storyBox}</label><br>
        <div class="grow-wrap">
          <textarea id="storyBox" style="width: 100%" name="storyBox" onInput="this.parentNode.dataset.replicatedValue = this.value; saveFormToFormSubs()"></textarea>
        </div>`
        
      }
      document.getElementById('storyBoxContainer').innerHTML = storyBoxContent;
      
      let prefix = '';
      if(user.movements.length > 1){
        prefix = (movement_num + 1)+"/"+user.movements.length+" ";
      }
      document.getElementById('movementName').textContent = prefix + movement.name;
      document.getElementById('movementId').value = movement.id; //hidden field
      document.getElementById('userPhone').value = user.phone; //hidden field

      // set dates for the movement
      var fourteenDays = new Date(); //used if the date is older than 
      fourteenDays.setTime(fourteenDays.getTime() - (24*60*60*1000) * 14);

      let endDate = new Date().toLocaleString().split(',')[0];
      let startDate = user.mvmnts[movement.id];

      if(new Date(startDate).getTime() < fourteenDays.getTime()){
        startDate = fourteenDays.toLocaleString().split(',')[0];
      }
      
      document.getElementById('startDate').value = startDate;
      document.querySelectorAll('.startDate').forEach(el => el.textContent = startDate);
      document.getElementById('endDate').value = startDate;
      document.querySelectorAll('.endDate').forEach(el => el.textContent = endDate);

      //let's load the data from formSubs
      let formSub = window.formSubs[movement.id];
      if(formSub != undefined){
        let data = unserialize(formSub);
        for(const item of data){
          let questionId = item[0];
          let value = item[1];
          if(questionId.toLowerCase().indexOf("date") === -1 && questionId.toLowerCase().indexOf('userpin') === -1){
            let element = document.getElementById(questionId);
            if(!element){
              continue;
            }
            element.value = value;
            if(value != 0){
              setTimeout(() => {
                element.classList.add('highlightBg');
              },200);
              setTimeout(() => {
                element.classList.remove('highlightBg');
              },2200);
            }
          }
        }
      }
      document.getElementById('statsList').dispatchEvent(new Event('change'));

      projector.classList = 'locations';
      window.document.title = "Enter Stats for "+movement.name;
    }
    catch(error){
      console.log(error);
      window.location.hash = '#locations/0/'+user.movements[0].id;
    }
  }
//SUMMARY!-----------------------------------------------------------------
  else if(hash.startsWith('#summary')) {
    if(!window.statSummary){
      let phone = user.phone;
      if(phone.length != 10){
        alert('user not set up properly...');
        return
      }
      startSpin()
      await fetch(window.indicatorAppURL+`?requestSummary=true&phone=${phone}`, {
        method: "GET",
        dataType: "json"
      }).then(handleErrors)
      .then(json)
      .then(function(data) {
        console.log(data);
        window.statSummary = data.summary;
        setUser(data.user);
        window.user = data.user;
      }).catch(function(error){
        catchError(error);
      }).then(function(data){
        stopSpin();
      });
    }

    console.log(window.statSummary)
    document.getElementById('cards').innerHTML = '';

    for(question of Object.keys(window.statSummary.groupNum)){
      let num = window.statSummary.groupNum[question];
      //let text = window.user.strategies[]
      let card = `<div class="card">
        <object data="${question.replace(/\d/g,'')}.png" type="image/png" width="80px" height="80px">
          <img src="genericQ.png" width="80px" height="80px">
        </object>
        <p>Your group had</p>
        <h1 id="${question+'Sum'}">${num}</h1>
        <p>${window.statSummary.questions[question]}${(num >  0?'!':'')}</p>
      </div>`;

      document.getElementById('cards').insertAdjacentHTML('beforeend', card);
    }
    projector.classList = 'summary';
    window.document.title = "Stats Summary";
    let time = 500;

    function doSetTimeout(stat,time) {
      setTimeout(function(){
        party.confetti(document.getElementById(stat+'Sum').previousElementSibling, {
          count: party.variation.range(40, 80)
        })
      }, time);
    }
    for(stat of  Object.keys(window.statSummary.groupNum).sort(function(a,b){return window.statSummary.groupNum[b]-window.statSummary.groupNum[a]})){
      if(document.getElementById(stat+'Sum') && window.statSummary.groupNum[stat] != 0){
        doSetTimeout(stat,time);
        time += 2000;
      }
    }
    window.statSummary = null;
  }
  else {
    location.hash = '#';
  }
}
//PROCESS ONBOARDING FORM
async function processOnboardForm(e) {
  if (e.preventDefault) e.preventDefault();

  let user = {};
  let nameEl = document.getElementById('regUserName');
  let catEl = document.getElementById('regUserStaff');
  let phoneEl = document.getElementById('regUserPhone');
  let pinEl = document.getElementById('regUserPin');
  let emailEl = document.getElementById('regUserEmail');
  let accountEl = document.getElementById('staffAcct');
  let register = document.getElementById('register').checked;

  user.name = nameEl.value;
  user.phone = phoneEl.value.replace(/\D/g,'');
  user.email = emailEl.value;
  user.pin = pinEl.value;
  user.cat = (catEl.checked ? 'staff' : '!staff');
  user.mvmnts = {};


  let defaultMovements = false;
  //overwrites whatever is there... if username and phone are same, let's add new movements. If user exists, let's load the user name and phone to preload...
  try {
   defaultMovements = location.hash.split('/')[1].split('&').length > 0
  }
  catch {
    defaultMovements = false;
  }
  //we are overwriting existing movements or adding a user.
  if(defaultMovements){
    document.querySelectorAll('#movements input').forEach(function(el){
      if(el.checked) {
        user.mvmnts[el.name] = false;
      }
    });

    if(Object.keys(user.mvmnts).length == 0) {
      alert('Select a movement friend!');
      return;
    }

    //we send in and add a new user
    if(register){
      let result = await registerUser(user.name, user.phone, user.mvmnts, user.cat, user.pin, user.email);
      if(!result){ //assuming we're offline;
        alert("You're currently offline, please try again when you have data");
        return;
      }
      else if(result.result != "success"){
        alert("I'm sorry that phone number is already registered with a name, if it's yours, try unchecking register, and click Setup Device");
        return;
      }
    }
    //OR we overwrite the existing.
    else {
      let result = await updateUser(user.phone, user.mvmnts, user.cat, user.pin);
      if(!result){ //assuming we're offline;
        alert("You're currently offline, please try again when you have data");
        return;
      }
      else if(result.result == "success"){
        console.log(result)
      }
      else {
        alert(result.text);
        return;
      }
    }
  }
  //attempt to load information from db
  else {
    let result = await requestUser(user.phone, user.pin);
    if(!result){
      alert("You're currently offline, please try again when you have data");
      return;
    }
    else if(result.result == "success"){
      console.log('got the user from db');
    }
    else {
      alert("Either your number and pin combo are not correct, or you need to register.  \n\nTo register please click on the custom link you were sent.")
      return;
    }
  }

  //after all that we set the user and return
  location.hash = "#";

  //clear form
  document.getElementById('onboard-form').reset();
  document.getElementById('staffAcct').removeAttribute('required');
  document.getElementById('regUserName').removeAttribute('required');
  document.getElementById('regUserEmail').removeAttribute('required');

  return false;
}

//PROCESS LOCATION FORM
function processLocationForm(submitMovementId) {
  let user = window.user;
  //save the data from the form for submittal later
  var form = document.getElementById('location-form');

  var serializedForm = new URLSearchParams(new FormData(form)).toString().replace(/\+/g,'%20');

  let data = unserialize(serializedForm);
  let sum = data.filter(itm => ['startDate','endDate','movementId','userPhone']
                               .indexOf(itm[0]) === -1)
                .map(itm => itm[1])
                .reduce((total, amount) => Number(total) + Number(amount));
  let movementId = document.getElementById('movementId').value;
  let storyContents = data.filter(itm => itm[0] == 'storyBox')[0];
  if(storyContents) {storyContents = (storyContents[1] != '')}
  if(sum != 0 || submitMovementId == movementId || storyContents){
    window.formSubs[document.getElementById('movementId').value] = `userPin=${user.pin}&`+serializedForm;
  }
  else {
    delete window.formSubs[movementId];
  }  
  localStorage.setItem('formSubs', JSON.stringify(window.formSubs));

  let movement_num = parseInt(location.hash.split('/')[1]);

  //clear form
  document.querySelectorAll('input[type="checkbox"]').forEach(el => el.setAttribute('checked', false));

  //clear notification
  let notification = document.getElementById('notification');
  if(notification) {
    notification.remove();
  }
}

//SUBMIT LOCATION FORM AFTER PROCESSING CURRENT PAGE
async function submitLocationForm(){
  let movementId = document.getElementById('movementId').value;
  processLocationForm(movementId);

  //notify user that they are submitting data for movements they can't see
  let startingMvmnt = parseInt(location.hash.split('/')[1]);
  let prompt = false;

  let message = "You are about to submit data for the following locations:\n";

  for(const [key, formSub] of Object.entries(window.formSubs)) {
    let data = unserialize(formSub);
    let sum = data.filter(itm => ['startDate','endDate','movementId','userPhone']
                                 .indexOf(itm[0]) === -1)
                  .map(itm => itm[1])
                  .reduce((total, amount) => Number(total) + Number(amount));
    if(sum != 0 || key == movementId){
      let currentMvmnt = window.user.movements.map(mvmnt => mvmnt.id).indexOf(key);
      message += `* ${currentMvmnt + 1}: ${window.user.movements.filter(itm => itm.id == key)[0].name}\n`
      if(startingMvmnt != currentMvmnt){ //Only need to prompt the user if they can't see all the data they are submitting
        prompt = true;
      }
    }
  }

  message += 'Do you want to continue?'

  if(prompt) {
    if(!window.confirm(message)) {
      return;
    }
  }

  startSpin();
  var url  =  window.indicatorAppURL;

  //submit everything - we can do this in one go.
  await fetch(window.indicatorAppURL+`?${Object.values(window.formSubs).join('+')}`, {
    method: "GET",
    dataType: "json",
  }).then(handleErrors)
  .then(json)
  .then(function(data){
    console.log(data);
    window.statSummary = data.summary;
    location.hash = "#summary";
    setUser(data.user);
    window.user = data.user;
    window.formSubs = {}; //reset window.formSubs
    localStorage.setItem('formSubs', JSON.stringify(window.formSubs));
  }).catch(function(error){
    catchError(error);
  }).then(function(data){
    stopSpin();
  });
}

function goToNextMovement() {
  document.getElementById('slideable').classList.add('transition');
  setTimeout(function(){
    document.getElementById('slideable').classList.remove('transition');
  }, 250);
  let movement_num = parseInt(location.hash.split('/')[1]);
  if(window.user.movements.length == movement_num + 1){
    movement_num = 0;
    location.hash = "#";
  }
  else{
    movement_num += 1;
    location.hash = "#locations/"+movement_num+"/"+user.movements[movement_num].id;
  }
}
function goToPrevMovement() {
  document.getElementById('slideable').classList.add('transition-l');
  setTimeout(function(){
    document.getElementById('slideable').classList.remove('transition-l');
  }, 250);
  let movement_num = parseInt(location.hash.split('/')[1]);
  if(movement_num == 0){
    movement_num = window.user.movements.length - 1;
  }
  else{
    movement_num -= 1;
  }
  location.hash = "#locations/"+movement_num+"/"+user.movements[movement_num].id;
}

function startSpin() {
  document.getElementById('spin-container').classList = "spin";
}
function stopSpin() {
  document.getElementById('spin-container').classList = "";
}

function setCalendarReminder(){
  let details = encodeURI("Time to celebrate what God is doing on your campus with your team!\n\nhttps://cruglobal.github.io/Spotlight/");
  //get's the next selected date
  var d = new Date();
  d.setDate(d.getDate() + (parseInt(document.querySelector('input[name="weekday"]:checked').value) + 7 - d.getDay()) % 7);

  let date = (new Date(d.getMonth()+1+'/'+d.getDate()+'/'+d.getFullYear()+' '+document.getElementById('reminderTime').value)).toISOString().replace(/-|:|\.\d\d\d/g,"");
  let title = encodeURI("Time to celebrate what God is doing on your campus with your team!");

  let url = 'https://www.google.com/calendar/render?action=TEMPLATE&text='+
    title+'&dates='+date+'/'+date+
  '&details='+details+'&recur=RRULE:FREQ=WEEKLY&location=&sf=true&output=xml'
  window.open(url);

  document.getElementById('hiddenReminder').style.display = 'none';
  document.getElementById('blurBackground').style.display = 'none';
}
async function setTextReminder(){
  startSpin();
  let weekMap = {0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday'};
  let time = weekMap[parseInt(document.querySelector('input[name="weekday"]:checked').value)]+' '+document.getElementById('reminderTime').value;

  await fetch(window.indicatorAppURL+"?updateUser=true&phone="+window.user.phone+"&txtReminderTime="+encodeURI(time+' '+Intl.DateTimeFormat().resolvedOptions().timeZone), {
    method: "GET",
    dataType: "json"
  }).then(handleErrors)
  .then(json)
  .then(function(data){
    console.log(data);
    if(data.result=="success"){
      alert('Text Reminders are set for: '+time+ '\n\nRespond to a text with "STOP" to stop at any time');
    }
    else{
      alert('Could not complete your request');
    }
    document.getElementById('blurBackground').dispatchEvent(new Event('click'));
  }).catch(function(error){
    catchError(error);
  }).then(function(data){
    stopSpin();
  });
}

function catchError(error, notify=true){
  if(!navigator.onLine && notify){
    alert('You are offline, try submitting again when you are back online.')
  }
  console.log(error);
  return; 
}

//TOOLTIP CODE
function setToolTips() {
  var targets = document.querySelectorAll('[rel~=tooltip]');

  targets.forEach(function(el) {
    el.addEventListener('mouseenter', function() {
      let target  = el;
      let tip     = target.getAttribute('title');
      let tooltip = document.createElement('div');
      tooltip.setAttribute('id','tooltip');

      if( !tip || tip == '' ) {
        return false;
      }

      target.removeAttribute('title');
      tooltip.style.opacity = 0;
      tooltip.innerHTML = tip;
      document.body.appendChild(tooltip);

      var init_tooltip = function() {
        tooltip.style.maxWidth= `min(${window.innerWidth / 1.2}px, 340px)`;

        var targetOffset = target.getBoundingClientRect();
        var pos_left = target.offsetLeft + ( target.offsetWidth / 2 ) - ( tooltip.offsetWidth / 2 );
        var pos_top  = targetOffset.top - tooltip.offsetHeight - 20;

        if( pos_left < 0 )
        {
          pos_left = target.offsetLeft + target.offsetWidth / 2 - 20;
          tooltip.classList.add('left');
        }
        else {
          tooltip.classList.remove('left');
        }
  /*
        if( pos_left + tooltip.offsetWidth > window.innerWidth ) {
          pos_left = target.offsetLeft - tooltip.offsetWidth + target.offsetWidth / 2 + 20;
          tooltip.classList.add('right');
        }
        else {
          tooltip.classList.remove('right');
        }*/

        if( pos_top < 0 ) {
          var pos_top  = targetOffset.top + target.offsetHeight;
          tooltip.classList.add('top');
        }
        else {
          tooltip.classList.remove('top');
        }
        tooltip.style.left = pos_left + 'px';
        tooltip.style.top = pos_top + 'px';
        tooltip.classList.add('inAndDown');
      }

      init_tooltip();
      window.addEventListener('resize', init_tooltip);

      var remove_tooltip = function() {
        tooltip.classList.remove('inAndDown');
        setTimeout(function(){
          tooltip.remove();
        }, 50);

        target.setAttribute('title', tip);
      };
    
      document.getElementById('locations').addEventListener('scroll', remove_tooltip);

      target.addEventListener('mouseleave', remove_tooltip);
      tooltip.addEventListener('click', remove_tooltip);
    });
  });
};

function removeLocalStorage(){
  localStorage.removeItem('SC_user');
  localStorage.removeItem('formSubs');
  window.formSubs = {};
  window.user = null;
}

function unserialize(data) {
  data = data.split('&');
  var response = [];
  for (var k in data){
    var newData = data[k].split('=');
    response.push([newData[0], decodeURI(newData[1])]);
  }
  return response;
}

function json(response) {
  return response.json();
}

function handleErrors(response) {
  if(!response.ok) {
    throw new Error("Request failed " + response.statusText);
  }
  return response;
}
