// ── Push notifications & VAPID ────────────────────────────────────────────────
var VAPID_PUBLIC_KEY = 'BB7GwVMBajkN6LOoUAKwVAayzXxUydfdwfuIMLjz9IeNZrgGeftg8Rn1CWc7WY3c-bC4lxD1PUfGmhs9Mlt3kPs';

function urlBase64ToUint8Array(b64) {
  var pad = '='.repeat((4 - b64.length % 4) % 4);
  var raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(Array.from(raw).map(function(c) { return c.charCodeAt(0); }));
}

async function checkPushStatus() {
  if (!('Notification' in window) || !('PushManager' in window) || !('serviceWorker' in navigator)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.getSubscription();
    return sub ? 'enabled' : 'disabled';
  } catch(e) { return 'disabled'; }
}

async function _savePushSub(userId, sub) {
  var s = sub.toJSON();
  try {
    await supabaseClient.from('push_subscriptions').upsert(
      { user_id: userId, endpoint: s.endpoint, subscription: s },
      { onConflict: 'endpoint' }
    );
  } catch(e) { console.warn('[Veriqo] Push save error', e); }
}

async function enablePushReminders() {
  var userId = window._pushUserId;
  // Fallback: get userId from live session if not yet set
  if (!userId) {
    try {
      var s = await supabaseClient.auth.getSession();
      userId = s.data.session && s.data.session.user.id;
      if (userId) window._pushUserId = userId;
    } catch(e) {}
  }
  if (!userId) {
    if (typeof toast === 'function') toast('Please sign in to enable reminders', false);
    return 'error';
  }
  if (Notification.permission !== 'granted') {
    var perm = await Notification.requestPermission();
    if (perm !== 'granted') return 'denied';
  }
  try {
    var reg = await navigator.serviceWorker.ready;
    var existing = await reg.pushManager.getSubscription();
    if (existing) { await _savePushSub(userId, existing); return 'enabled'; }
    var sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
    await _savePushSub(userId, sub);
    return 'enabled';
  } catch(e) { console.warn('[Veriqo] Push subscribe error', e); return 'error'; }
}

async function disablePushReminders() {
  var userId = window._pushUserId;
  try {
    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.getSubscription();
    if (sub) {
      if (userId) await supabaseClient.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      await sub.unsubscribe();
    }
    return 'disabled';
  } catch(e) { return 'disabled'; }
}

async function toggleReminder(btn) {
  btn.disabled = true;
  var status = await checkPushStatus();
  var newStatus;
  if (status === 'enabled') {
    newStatus = await disablePushReminders();
    if (typeof toast === 'function') toast('Reminders turned off');
  } else {
    newStatus = await enablePushReminders();
    if (newStatus === 'enabled' && typeof toast === 'function') toast('Reminders enabled ✓');
    if (newStatus === 'denied' && typeof toast === 'function') toast('Notifications blocked — check your browser settings', false);
  }
  await renderRemindersCard();
  btn.disabled = false;
}

async function renderRemindersCard() {
  var card = document.getElementById('reminders-card');
  if (!card) return;
  var status = await checkPushStatus();

  var inner;
  if (status === 'unsupported') {
    inner = '<div style="font-size:13px;color:#aaa;line-height:1.55;padding:4px 0">'
      + 'Push reminders aren\'t available in this browser. '
      + 'For best results, add Veriqo to your home screen on iOS 16.4+ or use Chrome on Android.'
      + '</div>';
  } else if (status === 'denied') {
    inner = '<div style="font-size:13px;color:#555;line-height:1.55;padding:4px 0">'
      + 'Notifications are blocked. To enable, open your browser settings and allow notifications for this site, then come back here.'
      + '</div>';
  } else {
    var on = status === 'enabled';
    inner = '<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0">'
      + '<div>'
      +   '<div style="font-size:14px;font-weight:600;color:#1a1a18">Daily reminders</div>'
      +   '<div style="font-size:12px;color:#888;margin-top:2px">'
      +     (on ? '9am morning check · 5:30pm closing check' : 'Get a nudge when daily checks are due')
      +   '</div>'
      + '</div>'
      + '<button onclick="toggleReminder(this)" style="position:relative;width:44px;height:26px;border-radius:26px;border:none;cursor:pointer;flex-shrink:0;margin-left:12px;transition:background 0.2s;background:' + (on ? '#2D7A3A' : '#ccc') + '">'
      +   '<span style="position:absolute;top:3px;left:' + (on ? '21px' : '3px') + ';width:20px;height:20px;background:#fff;border-radius:50%;transition:left 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.2)"></span>'
      + '</button>'
      + '</div>';
  }
  card.innerHTML = '<div class="card-title">Daily reminders</div>' + inner;
}

function renderSetupBanner() {
  var banner = document.getElementById('settings-setup-banner');
  if (!banner) return;
  var hasFridge = settings.fridgeUnits && settings.fridgeUnits.length > 0;
  var hasStaff  = settings.staff && settings.staff.length > 0;
  banner.style.display = (hasFridge && hasStaff) ? 'none' : 'block';
}

// ── Tooltip system ────────────────────────────────────────────────────────────
var _activeTip = null;
function showTooltip(btn, text) {
  if (_activeTip) { _activeTip.remove(); _activeTip = null; }
  var rect = btn.getBoundingClientRect();
  var tip = document.createElement('div');
  tip.className = 'tooltip-bubble';
  tip.textContent = text;
  document.body.appendChild(tip);
  // Position below the icon, clamp to viewport edges
  var tipWidth = 260;
  var rawLeft = rect.left;
  var left = Math.max(10, Math.min(rawLeft, window.innerWidth - tipWidth - 10));
  var top = rect.bottom + 8;
  if (top + 120 > window.innerHeight) top = rect.top - 120; // flip up if near bottom
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
  _activeTip = tip;
  // Dismiss on next click outside
  setTimeout(function() {
    function handler(e) {
      if (!tip.contains(e.target) && e.target !== btn) {
        tip.remove();
        if (_activeTip === tip) _activeTip = null;
        document.removeEventListener('click', handler);
      }
    }
    document.addEventListener('click', handler);
  }, 50);
}

var TODAY = new Date().toISOString().slice(0,10);
var records = [];
var _haccpActiveJob = null;
window._pushUserId = null; // set after sign-in, used by push functions

var CHECKLISTS = { opening:[], closing:[], crosscontam:[] };

var DEFAULTS = {
  fridgeUnits:   ['Main fridge','Prep fridge','Walk-in fridge','Freezer 1','Freezer 2'],
  suppliers:     ['FreshFoods Ltd','Brakes','Bidfood','Local farm','Other'],
  cleaningTasks: ['Worktops & surfaces','Fridge interiors','Oven & grill','Floor & drainage','Bins & waste area','Dishwasher / glasswasher','Extraction & filters'],
  staff:         ['Chef','Sous chef','Kitchen assistant'],
  foodLibrary:   []
};

var TILE_DEFS = [
  {id:'opening',     icon:'☀️',  label:'Opening checks',      subDefault:'Start of day'},
  {id:'closing',     icon:'🌙',  label:'Closing checks',       subDefault:'End of day'},
  {id:'fridge',      icon:'🌡️', label:'Fridge temps',         subDefault:'No checks yet'},
  {id:'cooking',     icon:'🍳',  label:'Cooked food',          subDefault:'No checks yet'},
  {id:'cooling',     icon:'❄️',  label:'Cooling',              subDefault:'No records yet'},
  {id:'reheating',   icon:'♨️',  label:'Reheating',            subDefault:'No records yet'},
  {id:'delivery',    icon:'📦',  label:'Deliveries',           subDefault:'No records yet'},
  {id:'cleaning',    icon:'🧹',  label:'Cleaning',             subDefault:'No tasks yet'},
  {id:'crosscontam', icon:'🔵',  label:'Cross-contamination',  subDefault:'Daily check'},
  {id:'probe',       icon:'🔬',  label:'Probe calibration',    subDefault:'Weekly check'},
  {id:'pest',        icon:'🐀',  label:'Pest control',         subDefault:'No records yet'},
  {id:'illness',     icon:'🤒',  label:'Staff illness',        subDefault:'No records yet'},
  {id:'foodlibrary', icon:'📋',  label:'Food library',         subDefault:'Dishes for logging'},
  {id:'kitchenassess',icon:'🏠', label:'Kitchen assessment',   subDefault:'Pre-job check',      pc:true},
  {id:'allergen',    icon:'🌾',  label:'Allergen log',         subDefault:'Dishes &amp; allergens', pc:true},
  {id:'transport',   icon:'🚗',  label:'Transport temps',      subDefault:'Food in transit',    pc:true},
  {id:'mobileset',   icon:'🔧',  label:'Mobile setup',         subDefault:'Temporary kitchen',  pc:true},
  {id:'credentials', icon:'📜',  label:'My credentials',       subDefault:'Certs &amp; expiry dates', pc:true},
  {id:'incident',    icon:'⚠️',  label:'Incident log',         subDefault:'No incidents today', pc:true}
];
var DEFAULT_TILE_ORDER = TILE_DEFS.map(function(d){return d.id;});

var DEFAULT_THRESHOLDS = {
  'fridge-warn':   5,   'fridge-fail':   8,
  'freezer-warn': -18,  'freezer-fail': -15,
  'cooking-warn':  80,  'cooking-fail':  75,
  'reheat-warn':   80,  'reheat-fail':   75,
  'cooling-warn':   5,  'cooling-fail':   8,
  'delivery-warn':  5,  'delivery-fail':  8,
  'chilled-warn':   5,  'chilled-fail':   8,
  'frozen-warn':  -18,  'frozen-fail':  -15
};

function T(key) {
  var v = settings.thresholds && settings.thresholds[key] !== undefined ? settings.thresholds[key] : DEFAULT_THRESHOLDS[key];
  return parseFloat(v);
}

var DEFAULT_CHECKLISTS = {
  opening: [
    {label:'Fridge temperatures checked and within safe range', note:'Fridges 1-4°C, freezers -18°C or below'},
    {label:'All surfaces and equipment clean from previous session', note:''},
    {label:'Handwashing facilities stocked (soap, paper towels)', note:''},
    {label:'Staff checked — no one unwell or with symptoms', note:'D&V, skin infections, jaundice'},
    {label:'PPE available (gloves, aprons)', note:''},
    {label:'Colour-coded equipment in correct place', note:'Boards, knives, cloths'},
    {label:'Raw and ready-to-eat foods stored separately', note:'Raw meat below ready-to-eat'},
    {label:'Probe thermometer available and clean', note:''}
  ],
  closing: [
    {label:'All cooked food cooled and stored correctly', note:'Covered, labelled, dated'},
    {label:'Fridge temperatures checked and within safe range', note:''},
    {label:'All surfaces, equipment and floors cleaned', note:''},
    {label:'Bins emptied and waste removed', note:''},
    {label:'Raw meat stored below ready-to-eat foods', note:''},
    {label:'All food covered and protected from contamination', note:''},
    {label:'Cleaning chemicals stored away from food', note:''},
    {label:'Back door and windows closed/secured', note:'Pest prevention'}
  ],
  crosscontam: [
    {label:'Colour-coded chopping boards used correctly', note:'Red=raw meat, blue=raw fish, yellow=cooked, green=salad/veg, white=bakery/dairy'},
    {label:'Separate knives used for raw and ready-to-eat foods', note:''},
    {label:'Hands washed between handling raw and cooked food', note:''},
    {label:'Raw meat stored below and away from ready-to-eat', note:''},
    {label:'Separate cloths/equipment for raw and cooked areas', note:''},
    {label:'Allergen controls in place', note:'Ingredients checked, cross-contact prevented'},
    {label:'Food handlers not working with illness symptoms', note:''}
  ]
};

var settings = {};

function esc(s) { return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }

function loadHaccpSettings() {
  try { var r=localStorage.getItem('haccp_settings'); settings=r?JSON.parse(r):{}; } catch(e){ settings={}; }
  Object.keys(DEFAULTS).forEach(function(k){ if(!settings[k]||!settings[k].length) settings[k]=DEFAULTS[k].slice(); });
  if(!settings.foodLibrary) settings.foodLibrary=[];
  if(!settings.tileOrder) settings.tileOrder=DEFAULT_TILE_ORDER.slice();
  ['opening','closing','crosscontam'].forEach(function(k){
    var ck='checklist_'+k;
    if(!settings[ck]||!settings[ck].length) settings[ck]=DEFAULT_CHECKLISTS[k].map(function(i,idx){ return {id:k[0]+idx,label:i.label,note:i.note}; });
  });
  // rebuild CHECKLISTS from settings so rest of app uses live version
  CHECKLISTS.opening   = settings['checklist_opening'];
  CHECKLISTS.closing   = settings['checklist_closing'];
  CHECKLISTS.crosscontam = settings['checklist_crosscontam'];
  settings.enabledTiles = settings.enabledTiles || {
    opening:true, closing:true, fridge:true, cooking:true, cooling:true, reheating:true,
    delivery:true, cleaning:true, crosscontam:true, probe:true, pest:true, illness:true,
    job:true, customers:true, kitchenassess:true, transport:true, mobileset:true, credentials:true,
    records:true, suppliers:true
  };
}
function saveHaccpSettings() {
  try { localStorage.setItem('haccp_settings',JSON.stringify(settings)); } catch(e){}
  // Cloud sync — mirror to Supabase
  if (window.Mise && window.Mise.sync) Mise.sync.saveSettings(settings);
}

function populateSelect(elId, listKey) {
  var el=document.getElementById(elId); if(!el)return;
  var val=el.value;
  var items = settings[listKey].slice();
  if(listKey==='staff'){
    var profileName = window.Mise && window.Mise.profile && window.Mise.profile.chef_name;
    if(profileName && items.indexOf(profileName)===-1) items.unshift(profileName);
  }
  el.innerHTML=items.map(function(v){return '<option>'+v+'</option>';}).join('');
  if(val) el.value=val;
}
function populateHaccpSelects() {
  ['fridge-unit','fridge-by','cook-chef','cool-by','reheat-chef','del-supplier','del-by','clean-by','probe-by','pest-by','illness-staff','illness-by','opening-by','closing-by','crosscontam-by','tr-by','ms-by'].forEach(function(id){
    var key = (id==='fridge-unit') ? 'fridgeUnits' : (id==='del-supplier') ? 'suppliers' : (id==='clean-task') ? 'cleaningTasks' : 'staff';
    populateSelect(id, key);
  });
  populateSelect('clean-task','cleaningTasks');
  // Populate food library datalist — combines HACCP items + Menus saved dishes
  var dl = document.getElementById('food-library-list');
  if(dl) {
    var menusDishes = (window.mSettings && window.mSettings.savedDishes) ? window.mSettings.savedDishes.map(function(d){ return d.dish; }) : [];
    var haccpItems = settings.foodLibrary || [];
    // Merge: menus dishes first, then HACCP-only items not already in menus
    var allItems = menusDishes.slice();
    haccpItems.forEach(function(v){ if(allItems.indexOf(v)===-1) allItems.push(v); });
    dl.innerHTML = allItems.map(function(v){ return '<option value="'+v.replace(/"/g,'&quot;')+'">'; }).join('');
  }
}

function renderFoodLibraryTab() {
  // Menus dishes section
  var menusList = document.getElementById('foodlibrary-menus-list');
  if(menusList) {
    var dishes = (window.mSettings && window.mSettings.savedDishes) ? window.mSettings.savedDishes : [];
    if(!dishes.length) {
      menusList.innerHTML = '<div class="empty">No dishes saved in Menus yet — add dishes in the Menus module.</div>';
    } else {
      menusList.innerHTML = dishes.map(function(d){
        var cats = d.category ? '<span style="font-size:11px;color:#888;margin-left:6px">'+d.category+'</span>' : '';
        var alg = d.allergens && d.allergens.length ? '<div style="font-size:11px;color:#888;margin-top:2px">Allergens: '+d.allergens.join(', ')+'</div>' : '';
        return '<div class="setting-item"><div><span class="setting-item-name">'+d.dish+'</span>'+cats+alg+'</div></div>';
      }).join('');
    }
  }
  // HACCP-only items section
  var haccpList = document.getElementById('foodlibrary-haccp-list');
  if(haccpList) {
    renderSettingsList('foodLibrary','settings-food-list');
    // Mirror into the food library tab's own list element
    var items = settings.foodLibrary || [];
    if(!items.length) {
      haccpList.innerHTML = '<div class="empty">No HACCP-only items added yet.</div>';
    } else {
      haccpList.innerHTML = items.map(function(item,i){
        return '<div class="setting-item"><span class="setting-item-name">'+item+'</span>'+
          '<button class="btn-remove" aria-label="Remove" onclick="removeItem(\'foodLibrary\','+i+',\'settings-food-list\');renderFoodLibraryTab()">&times;</button></div>';
      }).join('');
    }
  }
  // Update home tile sub-text with total count
  var menusDishes = (window.mSettings && window.mSettings.savedDishes) ? window.mSettings.savedDishes : [];
  var total = menusDishes.length + (settings.foodLibrary||[]).length;
  var sub = document.getElementById('sub-foodlibrary');
  if(sub) sub.textContent = total ? total+' dish'+(total>1?'es':'')+' in library' : 'Dishes for logging';
  populateHaccpSelects();
}

function renderChecklists() {
  ['opening','closing','crosscontam'].forEach(function(type){
    var c=document.getElementById(type+'-checklist');
    if(!c)return;
    c.innerHTML=CHECKLISTS[type].map(function(item){
      return '<div class="checklist-item">'+
        '<input type="checkbox" id="chk-'+item.id+'">'+
        '<label for="chk-'+item.id+'">'+esc(item.label)+(item.note?'<span class="check-note">'+esc(item.note)+'</span>':'')+'</label>'+
      '</div>';
    }).join('');
  });
}

function renderSettingsList(listKey, containerId) {
  var c=document.getElementById(containerId);
  var items=settings[listKey]; var defs=DEFAULTS[listKey];
  if(!items.length){c.innerHTML='<div class="empty">No items.</div>';return;}
  c.innerHTML=items.map(function(item,i){
    var isDef=defs.indexOf(item)!==-1;
    return '<div class="setting-item"><span class="setting-item-name">'+esc(item)+(isDef?'<span class="setting-item-default"> (default)</span>':'')+'</span>'+
      '<button class="btn-remove" aria-label="Remove" onclick="removeItem(\''+listKey+'\','+i+',\''+containerId+'\')">&times;</button></div>';
  }).join('');
}
function renderSettingsChecklistList(type) {
  var key='checklist_'+type;
  var items=settings[key]||[];
  var defLabels=DEFAULT_CHECKLISTS[type].map(function(i){return i.label;});
  var c=document.getElementById('settings-'+type+'-list');
  if(!c)return;
  if(!items.length){c.innerHTML='<div class="empty">No items.</div>';return;}
  c.innerHTML=items.map(function(item,i){
    var isDef=defLabels.indexOf(item.label)!==-1;
    return '<div class="setting-item">'+
      '<div style="flex:1"><span class="setting-item-name">'+esc(item.label)+(isDef?'<span class="setting-item-default"> (default)</span>':'')+'</span>'+
      (item.note?'<div style="font-size:11px;color:#aaa;margin-top:2px">'+esc(item.note)+'</div>':'')+'</div>'+
      '<button class="btn-remove" aria-label="Remove item" onclick="removeChecklistItem(\''+type+'\','+i+')">&times;</button>'+
    '</div>';
  }).join('');
}

function addChecklistItem(type) {
  var labelEl=document.getElementById('add-'+type+'-label');
  var noteEl=document.getElementById('add-'+type+'-note');
  var label=labelEl.value.trim();
  var note=noteEl?noteEl.value.trim():'';
  if(!label){toast('Please enter a check item',false);return;}
  var key='checklist_'+type;
  var existing=settings[key].map(function(i){return i.label;});
  if(existing.indexOf(label)!==-1){toast('Already in the list','warn');return;}
  var newId=type[0]+Date.now();
  settings[key].push({id:newId,label:label,note:note});
  saveHaccpSettings();
  labelEl.value=''; if(noteEl) noteEl.value='';
  CHECKLISTS[type]=settings[key];
  renderSettingsChecklistList(type);
  renderChecklists();
  toast('Added: '+label);
}

function removeChecklistItem(type,idx) {
  var key='checklist_'+type;
  var item=settings[key][idx].label;
  settings[key].splice(idx,1);
  if(!settings[key].length) settings[key]=DEFAULT_CHECKLISTS[type].map(function(i,j){return {id:type[0]+j,label:i.label,note:i.note};});
  saveHaccpSettings();
  CHECKLISTS[type]=settings[key];
  renderSettingsChecklistList(type);
  renderChecklists();
  toast('Removed: '+item);
}

function renderThresholds() {
  Object.keys(DEFAULT_THRESHOLDS).forEach(function(key) {
    var el = document.getElementById('thresh-'+key);
    if(el) el.value = T(key);
  });
}

function saveThresholds() {
  if(!settings.thresholds) settings.thresholds = {};
  var proposed = {};
  Object.keys(DEFAULT_THRESHOLDS).forEach(function(key) {
    var el = document.getElementById('thresh-'+key);
    if(el && el.value !== '') proposed[key] = parseFloat(el.value);
  });
  var errors = validateThresholds(proposed);
  if(errors.length) { toast('Invalid threshold: ' + errors[0], false); return; }
  Object.assign(settings.thresholds, proposed);
  saveHaccpSettings();
  toast('Temperature thresholds saved');
}

function renderAllSettingsLists() {
  renderSettingsList('fridgeUnits','settings-fridge-list');
  renderSettingsList('suppliers','settings-supplier-list');
  renderSettingsList('cleaningTasks','settings-cleaning-list');
  renderSettingsList('staff','settings-staff-list');
  renderSettingsList('foodLibrary','settings-food-list');
  renderThresholds();
  renderSettingsChecklistList('opening');
  renderSettingsChecklistList('closing');
  renderSettingsChecklistList('crosscontam');
}
function addItem(listKey,inputId,containerId) {
  var input=document.getElementById(inputId); var val=input.value.trim();
  if(!val){toast('Please enter a value',false);return;}
  if(settings[listKey].indexOf(val)!==-1){toast('Already in the list','warn');return;}
  settings[listKey].push(val); saveHaccpSettings(); input.value='';
  renderSettingsList(listKey,containerId); populateHaccpSelects(); toast('Added: '+val);
}
function removeItem(listKey,idx,containerId) {
  var item=settings[listKey][idx]; settings[listKey].splice(idx,1);
  if(!settings[listKey].length) settings[listKey]=DEFAULTS[listKey].slice();
  saveHaccpSettings(); renderSettingsList(listKey,containerId); populateHaccpSelects(); toast('Removed: '+item);
}

function now() { var d=new Date(); return d.getHours().toString().padStart(2,'0')+':'+d.getMinutes().toString().padStart(2,'0')+':'+d.getSeconds().toString().padStart(2,'0'); }
function todayStr() { return new Date().toISOString().slice(0,10); }
function fmtDate(str) { var d=str?new Date(str+'T12:00:00'):new Date(); return d.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'}); }

document.getElementById('header-date').textContent = fmtDate();
['fridge-time','cook-time','cool-start-time','cool-end-time','reheat-time','del-time','clean-time'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=now(); });
['probe-date','pest-date','illness-date'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=todayStr(); });

function saveHaccpToday() {
  // Sample-day demo mode: never persist demo records to localStorage or Supabase
  if (_demoMode) return;
  var _today = todayStr();
  try { localStorage.setItem('haccp_'+_today,JSON.stringify(records)); } catch(e){ console.error('[HACCP] localStorage write failed:', e); toast('Storage error — check phone storage space', false); }
  // Cloud sync — pass snapshot so in-flight mutations don't corrupt the payload
  if (window.Mise && window.Mise.sync) Mise.sync.saveDay(_today, records.slice());
  // Track the most recently added record type
  if(window.posthog && records.length) {
    var last = records[records.length - 1];
    posthog.capture('record_added', { type: last.type, status: last.status });
  }
}
function loadHaccpToday() { try { var r=localStorage.getItem('haccp_'+todayStr()); records=r?JSON.parse(r):[]; } catch(e){ records=[]; } }
function getAllDays() {
  var days=[];
  try { for(var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(k&&k.indexOf('haccp_')===0&&k!=='haccp_settings'&&k!=='haccp_suppliers'&&k!=='haccp_credentials'){ days.push(k.replace('haccp_','')); } } } catch(e){}
  return days.sort().reverse();
}
function getDayRecords(d) { try { var r=localStorage.getItem('haccp_'+d); return r?JSON.parse(r):[]; } catch(e){ return []; } }
function saveSuppliers(list) { try { localStorage.setItem('haccp_suppliers',JSON.stringify(list)); } catch(e){} }
function loadSuppliers() { try { var r=localStorage.getItem('haccp_suppliers'); return r?JSON.parse(r):[]; } catch(e){ return []; } }

var titles={home:'Kitchen HACCP',opening:'Opening checks',closing:'Closing checks',crosscontam:'Cross-contamination',fridge:'Fridge temps',cooking:'Cooked food',cooling:'Cooling records',reheating:'Reheating records',delivery:'Deliveries',cleaning:'Cleaning',probe:'Probe calibration',pest:'Pest control',illness:'Staff illness',suppliers:'Approved suppliers',records:'Records',settings:'Settings',job:'Menus',customers:'Customer jobs',kitchenassess:'Kitchen assessment',allergen:'Allergen log',transport:'Transport temps',mobileset:'Mobile setup',credentials:'My credentials',incident:'Incident log',help:'Help & support',legal:'Privacy & legal',inspector:'Inspection Ready'};

var _homeScrollPos = 0;

function toggleTile(key, enabled) {
  settings.enabledTiles[key] = enabled;
  saveHaccpSettings();
  renderTileGrid();
  updateHaccpDashboard();
}

function syncTileToggles() {
  var keys = ['opening','closing','fridge','cooking','cooling','reheating','delivery','cleaning','crosscontam','probe','pest','illness','job','customers','kitchenassess','transport','mobileset','credentials','records','suppliers'];
  keys.forEach(function(k){
    var el = document.getElementById('toggle-'+k);
    if(el) el.checked = settings.enabledTiles[k] !== false;
  });
}

function toggleSettingsSection(id) {
  var el = document.getElementById(id);
  if (!el) return;
  var toggle = el.previousElementSibling;
  if (!toggle) return;
  var isCollapsed = toggle.classList.contains('collapsed');
  if (isCollapsed) {
    toggle.classList.remove('collapsed');
    el.style.maxHeight = el.scrollHeight + 'px';
    setTimeout(function(){ el.style.maxHeight = 'none'; }, 260);
  } else {
    el.style.maxHeight = el.scrollHeight + 'px';
    requestAnimationFrame(function(){ el.style.maxHeight = '0'; });
    toggle.classList.add('collapsed');
  }
}
function haccpHome(){ haccpTab('home'); }
function goHome(){ haccpHome(); } // alias kept for any remaining inline refs
function _getTodayJob() {
  // Check in-memory records (today already loaded)
  for (var i = 0; i < records.length; i++) {
    if (records[i].type === 'job' && records[i].eventDate === todayStr()) return records[i];
  }
  // Check haccp_ localStorage (HACCP-entered jobs)
  var hRecs = getDayRecords(TODAY);
  for (var i = 0; i < hRecs.length; i++) {
    if (hRecs[i].type === 'job' && hRecs[i].eventDate === todayStr()) return hRecs[i];
  }
  // Check mise_ localStorage (Menus/Carte-entered jobs)
  try {
    var mRaw = localStorage.getItem('mise_' + todayStr());
    if (mRaw) {
      var mRecs = JSON.parse(mRaw);
      for (var j = 0; j < mRecs.length; j++) {
        if (mRecs[j].type === 'job' && mRecs[j].eventDate === todayStr()) return mRecs[j];
      }
    }
  } catch (e) {}
  return null;
}

function haccpTab(name) {
  if(name !== 'home') _homeScrollPos = window.scrollY || window.pageYOffset || 0;
  document.querySelectorAll('.section').forEach(function(s){s.classList.remove('active');});
  document.getElementById('tab-home').style.display=name==='home'?'block':'none';
  if(name!=='home') document.getElementById('tab-'+name).classList.add('active');
  document.getElementById('back-btn').style.display=name==='home'?'none':'block';
  var sub=document.getElementById('haccp-header-sub');
  if(sub) sub.textContent=name==='home'?'HACCP':(titles[name]||name);
  if(name==='records')     renderRecords();
  if(name==='settings')    { renderAllSettingsLists(); renderSubscriptionCard(); renderRemindersCard(); renderSetupBanner(); syncTileToggles(); loadEmailPreferences(); }
  if(name==='suppliers')   renderSuppliersLog();
  if(name==='foodlibrary') renderFoodLibraryTab();
  // Re-populate selects when opening tabs that use staff names or food library,
  // so the chef's profile name is present even if it loaded after page init.
  if(name==='transport'||name==='mobileset'||name==='cooking'||name==='reheating'||name==='cooling'||name==='delivery'||name==='cleaning'||name==='probe'||name==='pest'||name==='illness'||name==='opening'||name==='closing'||name==='crosscontam'||name==='fridge') populateHaccpSelects();
  if(name==='credentials') renderCredentials();
  if(name==='inspector') renderInspector();
  if(PC_TYPES.indexOf(name)!==-1 && name!=='credentials') renderSection_PC(name);
  if(name==='allergen') { renderAllergenChecks(); renderGuestAllergenChecks(); renderAllergenGuests(); }
  if(name==='incident') { var _itf=document.getElementById('inc-time'); if(_itf&&!_itf.value) _itf.value=_incidentNowLocal(); }
  // Auto-fill client/location from today's booking — only when field is empty
  if (name === 'kitchenassess' || name === 'transport' || name === 'allergen') {
    var _tj = _getTodayJob();
    if (_tj) {
      var _clientLoc = (_tj.client || '') + (_tj.location ? ' — ' + _tj.location : '');
      if (name === 'kitchenassess') {
        var _ka = document.getElementById('ka-client');
        if (_ka && !_ka.value) _ka.value = _clientLoc;
      }
      if (name === 'allergen') {
        var _al = document.getElementById('al-client');
        if (_al && !_al.value) _al.value = _tj.client || '';
      }
      if (name === 'transport') {
        var _tr = document.getElementById('tr-destination');
        if (_tr && !_tr.value) _tr.value = _clientLoc;
      }
    }
  }
  updateHaccpDashboard();
  if(name === 'home') { var pos = _homeScrollPos; requestAnimationFrame(function(){ window.scrollTo(0, pos); }); }
  else { window.scrollTo(0, 0); }
  if(window.posthog) posthog.capture('tab_viewed', { tab: name });
}

function toast(msg,ok) {
  var t=document.getElementById('toast');
  t.textContent=msg;
  t.style.background=ok===false?'#A32D2D':(ok==='warn'?'#854F0B':'#2D7A3A');
  t.style.color=ok===false?'#FCEBEB':(ok==='warn'?'#FAEEDA':'#EAF3DE');
  t.classList.add('show'); setTimeout(function(){t.classList.remove('show');},2800);
}

function statusBadge(s) {
  var m={ok:'badge-ok',warn:'badge-warn',fail:'badge-fail',miss:'badge-miss'};
  var l={ok:'OK',warn:'Warning',fail:'Failed',miss:'Missed'};
  return '<span class="alert-badge '+m[s]+'">'+l[s]+'</span>';
}

function logChecklist(type) {
  var isPCType = type === 'mobileset';
  var items = isPCType
    ? (settings['checklist_pc_'+type] || DEFAULT_CHECKLISTS_PC[type].map(function(i,idx){return {id:type[0]+idx,label:i.label,note:i.note};}))
    : CHECKLISTS[type];
  // Scope checkbox lookups to the type's own container — 'closing' and 'crosscontam'
  // both generate IDs starting with 'c', so document.getElementById returns the wrong
  // element for whichever comes second in the DOM. querySelector('[id=...]') on the
  // specific checklist container fixes this without needing to change stored IDs.
  var container = document.getElementById(type+'-checklist');
  function _getChk(id) {
    return container
      ? container.querySelector('input[id="chk-'+id+'"]')
      : document.getElementById('chk-'+id);
  }
  var checked=[]; var unchecked=[];
  items.forEach(function(item){
    var el=_getChk(item.id);
    if(el&&el.checked) checked.push(item.label); else unchecked.push(item.label);
  });
  var byId = type+'-by';
  var notesId = type+'-notes';
  var by = document.getElementById(byId) ? document.getElementById(byId).value : '';
  var notes = document.getElementById(notesId) ? document.getElementById(notesId).value : '';
  var status=unchecked.length===0?'ok':(unchecked.length<=2?'warn':'fail');
  var msg=unchecked.length===0?'All '+items.length+' items confirmed':unchecked.length+' item'+(unchecked.length>1?'s':'')+' not confirmed';
  _pushRecord({type:type,by:by,notes:notes,checked:checked,unchecked:unchecked,time:now(),status:status,msg:msg});
  saveHaccpToday();
  items.forEach(function(item){ var el=_getChk(item.id); if(el) el.checked=false; });
  if (document.getElementById(notesId)) document.getElementById(notesId).value='';
  if (isPCType) renderSection_PC(type); else renderChecklistLog(type);
  updateHaccpDashboard();
  if(status==='ok') toast('Saved — '+msg); else toast('Saved — '+msg,'warn');
}

function renderChecklistLog(type) {
  var recs=records.filter(function(r){return r.type===type;});
  var c=document.getElementById(type+'-log');
  if(!recs.length){c.innerHTML='<div class="empty">Not signed off yet today — complete the checklist above and save.</div>';return;}
  c.innerHTML=recs.slice().reverse().map(function(r){
    var detail=r.unchecked&&r.unchecked.length?'<div class="log-time" style="color:#A32D2D">Not confirmed: '+r.unchecked.join(', ')+'</div>':'';
    return '<div class="log-row"><div style="flex:1"><div class="log-name">'+r.by+'</div><div class="log-time">'+r.time+' — '+r.msg+'</div>'+detail+'</div>'+statusBadge(r.status)+'</div>';
  }).join('');
}

// --- N/A TOGGLE ---
function toggleNA(inputId, btn) {
  var input = document.getElementById(inputId);
  var isNA = btn.getAttribute('data-na') === '1';
  if (isNA) {
    btn.removeAttribute('data-na');
    btn.classList.remove('na-btn-active');
    input.disabled = false;
    input.value = '';
    input.placeholder = input.getAttribute('data-orig-placeholder') || '';
  } else {
    btn.setAttribute('data-na', '1');
    btn.classList.add('na-btn-active');
    if (!input.getAttribute('data-orig-placeholder')) input.setAttribute('data-orig-placeholder', input.placeholder);
    input.value = '';
    input.placeholder = 'N/A';
    input.disabled = true;
  }
}

// --- MINUS TOGGLE ---
// type="number" inputs silently reject non-numeric strings (including bare '-'),
// so we track "armed" state via a data attribute when the field is empty.
function toggleMinus(inputId, btn) {
  var input = document.getElementById(inputId);
  var val = parseFloat(input.value);
  if (!isNaN(val)) {
    input.value = (-val).toString();
    btn.removeAttribute('data-neg-armed');
    btn.classList.toggle('na-btn-active', parseFloat(input.value) < 0);
  } else {
    var armed = btn.getAttribute('data-neg-armed') === '1';
    if (armed) {
      btn.removeAttribute('data-neg-armed');
      btn.classList.remove('na-btn-active');
    } else {
      btn.setAttribute('data-neg-armed', '1');
      btn.classList.add('na-btn-active');
    }
  }
}

function enforceNeg(inputId, btnId) {
  var input = document.getElementById(inputId);
  var btn = document.getElementById(btnId);
  if (!btn) return;
  var val = parseFloat(input.value);
  if (!isNaN(val)) {
    // If button was armed (tapped before typing), negate the entered value
    if (btn.getAttribute('data-neg-armed') === '1' && val > 0) {
      input.value = (-val).toString();
      btn.removeAttribute('data-neg-armed');
    }
    btn.classList.toggle('na-btn-active', parseFloat(input.value) < 0);
  }
}

// --- FRIDGE ---
function logFridge() {
  var unit=document.getElementById('fridge-unit').value;
  var by=document.getElementById('fridge-by').value;
  var naBtn=document.getElementById('fridge-temp-na-btn');
  var isNA=naBtn&&naBtn.getAttribute('data-na')==='1';
  var temp=isNA?null:parseFloat(document.getElementById('fridge-temp').value);
  var time=document.getElementById('fridge-time').value;
  var notes=document.getElementById('fridge-notes').value;
  if(!isNA&&isNaN(temp)){toast('Please enter a temperature',false);return;}
  var isFreezer=unit.toLowerCase().includes('freezer');
  var status,msg;
  if(isNA){
    status='ok';msg='N/A';
  } else if(isFreezer){
    if(temp>T('freezer-fail')){status='fail';msg=temp+'°C — freezer is too warm. Legal limit is -18°C or below';}
    else if(temp>T('freezer-warn')){status='warn';msg=temp+'°C — above legal limit of -18°C. Check freezer immediately';}
    else{status='ok';msg=temp+'°C — within legal range (-18°C or below)';}
  } else {
    if(temp>T('fridge-fail')){status='fail';msg=temp+'°C — fridge must be below '+T('fridge-fail')+'°C (UK legal limit)';}
    else if(temp>T('fridge-warn')){status='warn';msg=temp+'°C — above best practice (target 0–'+T('fridge-warn')+'°C)';}
    else if(temp<-5){status='fail';msg=temp+'°C — this is a freezer temperature. Is this unit a freezer? Rename it in Settings.';}
    else if(temp<0){status='warn';msg=temp+'°C — below 0°C, food may be freezing. Check fridge thermostat.';}
    else{status='ok';msg=temp+'°C — within safe range (0–'+T('fridge-warn')+'°C)';}
  }
  _pushRecord({type:'fridge',unit:unit,by:by,temp:temp,time:time,notes:notes,status:status,msg:msg});
  saveHaccpToday(); document.getElementById('fridge-temp').value=''; document.getElementById('fridge-notes').value=''; document.getElementById('fridge-time').value=now();
  if(isNA)toggleNA('fridge-temp',naBtn);
  renderSection('fridge'); updateHaccpDashboard();
  if(status==='ok')toast('Saved — '+unit+' '+msg); else if(status==='warn')toast('Warning — '+msg,'warn'); else toast('Alert — '+msg,false);
}

// --- COOKING ---
function logCooking() {
  var food=document.getElementById('cook-food').value.trim();
  var temp=parseFloat(document.getElementById('cook-temp').value);
  var time=document.getElementById('cook-time').value;
  var chef=document.getElementById('cook-chef').value;
  if(!food){toast('Please enter a food item',false);return;}
  if(isNaN(temp)){toast('Please enter a temperature',false);return;}
  var status,msg;
  if(temp<T('cooking-fail')){status='fail';msg=temp+'°C — must reach '+T('cooking-fail')+'°C minimum';}
  else if(temp<T('cooking-warn')){status='warn';msg=temp+'°C — borderline, target '+T('cooking-warn')+'°C';}
  else{status='ok';msg=temp+'°C — safe';}
  _pushRecord({type:'cooking',food:food,temp:temp,time:time,chef:chef,status:status,msg:msg});
  saveHaccpToday(); document.getElementById('cook-food').value=''; document.getElementById('cook-temp').value=''; document.getElementById('cook-time').value=now();
  renderSection('cooking'); updateHaccpDashboard();
  _checkCookingConflict(food);
  if(status==='ok')toast('Saved — '+food+' '+msg); else toast('Alert — '+food+' '+msg,false);
}

// --- COOLING ---
function _timeDiffMinutes(startHHMM, endHHMM) {
  if (!startHHMM || !endHHMM) return null;
  var sp = startHHMM.split(':'), ep = endHHMM.split(':');
  var startMins = parseInt(sp[0],10)*60 + parseInt(sp[1],10);
  var endMins   = parseInt(ep[0],10)*60 + parseInt(ep[1],10);
  var diff = endMins - startMins;
  if (diff < 0) diff += 1440; // crossed midnight
  return diff;
}

function logCooling() {
  var food=document.getElementById('cool-food').value.trim();
  var startTemp=parseFloat(document.getElementById('cool-start-temp').value);
  var startTime=document.getElementById('cool-start-time').value;
  var endTemp=parseFloat(document.getElementById('cool-end-temp').value);
  var endTime=document.getElementById('cool-end-time').value;
  var method=document.getElementById('cool-method').value;
  var by=document.getElementById('cool-by').value;
  if(!food){toast('Please enter a food item',false);return;}
  if(isNaN(endTemp)){toast('Please enter an end temperature',false);return;}
  if(!startTime){toast('Please enter a start time',false);return;}
  if(!endTime){toast('Please enter an end time',false);return;}

  var durationMins = _timeDiffMinutes(startTime, endTime);
  var durationStr = durationMins !== null ? (durationMins >= 60 ? Math.floor(durationMins/60)+'h '+( durationMins%60 ? (durationMins%60)+'m' : '') : durationMins+'m') : '';

  var status, msg;
  // Check end temperature first
  if(endTemp > T('cooling-fail')) {
    status='fail'; msg='End temp '+endTemp+'°C — must be below '+T('cooling-fail')+'°C';
  } else if(endTemp > T('cooling-warn')) {
    status='warn'; msg='End temp '+endTemp+'°C — borderline, monitor closely';
  } else {
    status='ok'; msg='Cooled to '+endTemp+'°C';
  }

  // Check cooling duration if start temp was in the hot-food danger zone
  if(!isNaN(startTemp) && startTemp > 60 && durationMins !== null) {
    if(durationMins > 120) {
      status='fail';
      msg='Took '+durationStr+' to cool — must cool below 8°C within 2 hours (UK FSA guidance)';
    } else if(durationMins > 90 && status !== 'fail') {
      status='warn';
      msg='Took '+durationStr+' to cool — target is under 90 minutes. End temp: '+endTemp+'°C';
    } else if(status==='ok') {
      msg='Cooled to '+endTemp+'°C in '+durationStr;
    }
  }

  _pushRecord({type:'cooling',food:food,startTemp:startTemp,startTime:startTime,endTemp:endTemp,endTime:endTime,durationMins:durationMins,method:method,by:by,time:startTime,status:status,msg:msg});
  saveHaccpToday();
  document.getElementById('cool-food').value=''; document.getElementById('cool-start-temp').value=''; document.getElementById('cool-end-temp').value='';
  document.getElementById('cool-start-time').value=now(); document.getElementById('cool-end-time').value=now();
  renderSection('cooling'); updateHaccpDashboard();
  if(status==='ok')toast('Saved — '+food+': '+msg); else if(status==='warn')toast('Warning — '+food+': '+msg,'warn'); else toast('Alert — '+food+': '+msg,false);
}

// --- REHEATING ---
function logReheating() {
  var food=document.getElementById('reheat-food').value.trim();
  var temp=parseFloat(document.getElementById('reheat-temp').value);
  var time=document.getElementById('reheat-time').value;
  var chef=document.getElementById('reheat-chef').value;
  var notes=document.getElementById('reheat-notes').value;
  if(!food){toast('Please enter a food item',false);return;}
  if(isNaN(temp)){toast('Please enter a temperature',false);return;}
  var status,msg;
  if(temp<T('reheat-fail')){status='fail';msg=temp+'°C — must reach '+T('reheat-fail')+'°C for reheating';}
  else if(temp<T('reheat-warn')){status='warn';msg=temp+'°C — borderline, target '+T('reheat-warn')+'°C';}
  else{status='ok';msg=temp+'°C — safe to serve';}
  _pushRecord({type:'reheating',food:food,temp:temp,time:time,chef:chef,notes:notes,status:status,msg:msg});
  saveHaccpToday(); document.getElementById('reheat-food').value=''; document.getElementById('reheat-temp').value=''; document.getElementById('reheat-notes').value=''; document.getElementById('reheat-time').value=now();
  renderSection('reheating'); updateHaccpDashboard();
  _checkCookingConflict(food);
  if(status==='ok')toast('Saved — '+food+' '+msg); else toast('Alert — '+food+' '+msg,false);
}

// --- DELIVERY ---
function previewPhoto(input) {
  if(!input.files||!input.files[0])return;
  var reader=new FileReader();
  reader.onload=function(e){ document.getElementById('del-photo-img').src=e.target.result; document.getElementById('del-photo-preview').style.display='block'; };
  reader.readAsDataURL(input.files[0]);
}
function clearPhoto() { document.getElementById('del-photo').value=''; document.getElementById('del-photo-img').src=''; document.getElementById('del-photo-preview').style.display='none'; }
function viewPhoto(src) {
  var o=document.createElement('div');
  o.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:999;display:flex;align-items:center;justify-content:center;padding:16px';
  o.innerHTML='<div style="position:relative;max-width:400px;width:100%"><img src="'+src+'" style="width:100%;border-radius:12px"><button onclick="this.parentElement.parentElement.remove()" style="position:absolute;top:-14px;right:-14px;width:32px;height:32px;border-radius:50%;background:#fff;border:none;font-size:18px;cursor:pointer">&times;</button></div>';
  document.body.appendChild(o);
}
function logDelivery() {
  var supplier=document.getElementById('del-supplier').value;
  var tempRaw=document.getElementById('del-temp').value;
  var temp=tempRaw!==''?parseFloat(tempRaw):null;
  var time=document.getElementById('del-time').value;
  var invoice=document.getElementById('del-invoice').value.trim();
  var by=document.getElementById('del-by').value;
  var condition=document.getElementById('del-condition').value;
  var chilledTemp=document.getElementById('del-chilled-temp').value;
  var chilledCond=document.getElementById('del-chilled-cond').value;
  var frozenTemp=document.getElementById('del-frozen-temp').value;
  var frozenCond=document.getElementById('del-frozen-cond').value;
  var notes=document.getElementById('del-notes').value;
  var photoImg=document.getElementById('del-photo-img');
  var photo=photoImg.src&&photoImg.src!==window.location.href?photoImg.src:'';
  // Delivery temp is optional — you may log chilled/frozen only. Only reject if
  // a value was entered but isn't a valid number.
  if(tempRaw!==''&&isNaN(temp)){toast('Please enter a valid delivery temperature',false);return;}
  var cF=chilledCond==='Rejected'||(chilledTemp!==''&&parseFloat(chilledTemp)>T('chilled-fail'));
  var cW=chilledCond==='Issues noted'||(chilledTemp!==''&&parseFloat(chilledTemp)>T('chilled-warn'));
  var fF=frozenCond==='Rejected'||(frozenTemp!==''&&parseFloat(frozenTemp)>T('frozen-fail'));
  var fW=frozenCond==='Issues noted'||(frozenTemp!==''&&parseFloat(frozenTemp)>T('frozen-warn'));
  var status,msg;
  if(condition==='Rejected'||cF||fF){status='fail';msg='One or more items failed';}
  else if(temp!==null&&temp>T('delivery-fail')){status='fail';msg=temp+'°C — above safe temp ('+T('delivery-fail')+'°C)';}
  else if((temp!==null&&temp>T('delivery-warn'))||condition==='Minor issues noted'||cW||fW){status='warn';msg=temp!==null?(temp+'°C — issues noted'):'Issues noted';}
  else{status='ok';msg=temp!==null?(temp+'°C — '+condition):condition;}
  _pushRecord({type:'delivery',supplier:supplier,temp:temp,time:time,invoice:invoice,by:by,condition:condition,chilledTemp:chilledTemp,chilledCond:chilledCond,frozenTemp:frozenTemp,frozenCond:frozenCond,notes:notes,photo:photo,status:status,msg:msg});
  saveHaccpToday();
  showNudge('delivery_logged');
  document.getElementById('del-temp').value=''; document.getElementById('del-invoice').value=''; document.getElementById('del-notes').value='';
  document.getElementById('del-chilled-temp').value=''; document.getElementById('del-chilled-cond').selectedIndex=0;
  document.getElementById('del-frozen-temp').value=''; document.getElementById('del-frozen-cond').selectedIndex=0;
  document.getElementById('del-time').value=now(); clearPhoto();
  renderSection('delivery'); updateHaccpDashboard();
  if(status==='ok')toast('Saved — '+supplier); else if(status==='warn')toast('Warning — '+supplier,'warn'); else toast('Alert — '+supplier,false);
}

// --- CLEANING ---
function logCleaning() {
  var task=document.getElementById('clean-task').value;
  var time=document.getElementById('clean-time').value;
  var by=document.getElementById('clean-by').value;
  var naBtn=document.getElementById('clean-chem-na-btn');
  var isNA=naBtn&&naBtn.getAttribute('data-na')==='1';
  var chem=isNA?'N/A':document.getElementById('clean-chem').value.trim();
  _pushRecord({type:'cleaning',task:task,time:time,by:by,chem:chem,status:'ok',msg:'Completed by '+by});
  saveHaccpToday(); document.getElementById('clean-chem').value=''; document.getElementById('clean-time').value=now();
  if(isNA)toggleNA('clean-chem',naBtn);
  renderSection('cleaning'); updateHaccpDashboard(); toast('Saved — '+task+' completed');
}

// --- PROBE ---
function logProbe() {
  var id=document.getElementById('probe-id').value.trim()||'Probe';
  var reading=parseFloat(document.getElementById('probe-reading').value);
  var date=document.getElementById('probe-date').value;
  var result=document.getElementById('probe-result').value;
  var by=document.getElementById('probe-by').value;
  if(isNaN(reading)){toast('Please enter a reading',false);return;}
  var status=result.indexOf('Pass')===0?'ok':'fail';
  var msg=result+' ('+reading+'°C)';
  _pushRecord({type:'probe',probeId:id,reading:reading,date:date,result:result,by:by,time:now(),status:status,msg:msg});
  saveHaccpToday(); document.getElementById('probe-reading').value=''; document.getElementById('probe-id').value='';
  renderSection('probe'); updateHaccpDashboard();
  if(status==='ok')toast('Saved — '+id+' passed'); else toast('Alert — '+id+' failed',false);
}

// --- PEST ---
function logPest() {
  var type=document.getElementById('pest-type').value;
  var location=document.getElementById('pest-location').value.trim();
  var date=document.getElementById('pest-date').value;
  var action=document.getElementById('pest-action').value.trim();
  var by=document.getElementById('pest-by').value;
  var status=type.indexOf('Routine')===0?'ok':(type==='Pest contractor visit'||type==='Bait station checked'?'ok':'fail');
  var msg=type+(location?' at '+location:'');
  _pushRecord({type:'pest',pestType:type,location:location,date:date,action:action,by:by,time:now(),status:status,msg:msg});
  saveHaccpToday(); document.getElementById('pest-location').value=''; document.getElementById('pest-action').value=''; document.getElementById('pest-date').value=todayStr();
  renderSection('pest'); updateHaccpDashboard(); toast('Saved — pest record logged');
}

// --- ILLNESS ---
function logIllness() {
  var staff=document.getElementById('illness-staff').value;
  var type=document.getElementById('illness-type').value;
  var symptoms=document.getElementById('illness-symptoms').value.trim();
  var date=document.getElementById('illness-date').value;
  var by=document.getElementById('illness-by').value;
  var status=type.indexOf('Reported')===0?'warn':'ok';
  var msg=type;
  _pushRecord({type:'illness',staff:staff,illnessType:type,symptoms:symptoms,date:date,by:by,time:now(),status:status,msg:msg});
  saveHaccpToday(); document.getElementById('illness-symptoms').value=''; document.getElementById('illness-date').value=todayStr();
  renderSection('illness'); updateHaccpDashboard();
  if(status==='ok')toast('Saved — '+staff+' return to work logged'); else toast('Saved — '+staff+' stood down','warn');
}

// --- INCIDENT LOG ---
var _incidentPhotos = [];
var _incidentLocation = null;

function _incidentNowLocal() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') + 'T' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
}

function logIncident() {
  var type = document.getElementById('inc-type').value;
  var severity = document.getElementById('inc-severity').value;
  var incidentTime = document.getElementById('inc-time').value;
  var locationText = document.getElementById('inc-location').value.trim();
  var description = document.getElementById('inc-description').value.trim();
  var action = document.getElementById('inc-action').value.trim();
  var by = document.getElementById('inc-by').value.trim() || 'Unknown';
  if (!description) { toast('Please describe the incident', false); return; }
  var status = severity === 'Critical' ? 'fail' : severity === 'High' ? 'warn' : 'ok';
  var locationObj = _incidentLocation ? Object.assign({}, _incidentLocation, { text: locationText || _incidentLocation.text }) : (locationText ? { text: locationText } : null);
  var msg = type + ' — ' + severity + ' severity. ' + description + (action ? ' Action: ' + action : '');
  _pushRecord({ type:'incident', incidentType:type, severity:severity, incidentTime:incidentTime, location:locationObj, description:description, action:action, by:by, photos:_incidentPhotos.slice(), loggedAt:now(), time:now(), status:status, msg:msg });
  saveHaccpToday(); renderSection_PC('incident'); updateHaccpDashboard();
  document.getElementById('inc-description').value = '';
  document.getElementById('inc-action').value = '';
  document.getElementById('inc-location').value = '';
  document.getElementById('inc-time').value = _incidentNowLocal();
  document.getElementById('inc-gps-status').style.display = 'none';
  _incidentPhotos = []; _incidentLocation = null;
  _renderIncidentPhotoThumbs();
  if (status === 'fail') toast('Critical incident logged', 'warn');
  else toast('Incident logged — ' + type);
}

function addIncidentPhoto(input) {
  if (!input.files || !input.files[0]) return;
  var file = input.files[0];
  if (file.size > 8 * 1024 * 1024) { toast('Photo too large — use an image under 8MB', false); return; }
  var reader = new FileReader();
  reader.onload = function(e) {
    var img = new Image();
    img.onload = function() {
      var maxW = 1024;
      var scale = img.width > maxW ? maxW / img.width : 1;
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      _incidentPhotos.push(canvas.toDataURL('image/jpeg', 0.78));
      _renderIncidentPhotoThumbs();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
  input.value = '';
}

function removeIncidentPhoto(idx) {
  _incidentPhotos.splice(idx, 1);
  _renderIncidentPhotoThumbs();
}

function _renderIncidentPhotoThumbs() {
  var c = document.getElementById('inc-photo-thumbs');
  if (!c) return;
  if (!_incidentPhotos.length) { c.innerHTML = ''; return; }
  c.innerHTML = _incidentPhotos.map(function(src, i) {
    return '<div style="position:relative;display:inline-block">'
      + '<img src="' + src + '" style="width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid #e5e4de;cursor:pointer" onclick="viewPhoto(this.src)">'
      + '<button type="button" aria-label="Remove photo" onclick="removeIncidentPhoto(' + i + ')" style="position:absolute;top:-6px;right:-6px;width:28px;height:28px;border-radius:50%;background:#A32D2D;border:none;color:#fff;font-size:13px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0">×</button>'
      + '</div>';
  }).join('');
}

function captureIncidentLocation() {
  var statusEl = document.getElementById('inc-gps-status');
  if (!navigator.geolocation) { toast('GPS not available on this device', false); return; }
  statusEl.textContent = 'Getting location…'; statusEl.style.display = 'block';
  navigator.geolocation.getCurrentPosition(function(pos) {
    var lat = pos.coords.latitude.toFixed(6);
    var lng = pos.coords.longitude.toFixed(6);
    var acc = Math.round(pos.coords.accuracy);
    _incidentLocation = { lat: parseFloat(lat), lng: parseFloat(lng), accuracy: acc, text: lat + ', ' + lng };
    var locInput = document.getElementById('inc-location');
    if (!locInput.value.trim()) locInput.value = lat + ', ' + lng;
    statusEl.textContent = '📍 GPS captured — ' + lat + ', ' + lng + ' (±' + acc + 'm)';
  }, function() {
    statusEl.textContent = 'Could not get location — enter manually above';
    toast('GPS unavailable — enter location manually', false);
  }, { timeout: 10000, enableHighAccuracy: true });
}

document.addEventListener('DOMContentLoaded', function() {
  var tf = document.getElementById('inc-time');
  if (tf) tf.value = _incidentNowLocal();
});

// --- SUPPLIERS ---
function logSupplier() {
  var name=document.getElementById('supp-name').value.trim();
  if(!name){toast('Please enter a supplier name',false);return;}
  var list=loadSuppliers();
  list.push({name:name,contact:document.getElementById('supp-contact').value.trim(),phone:document.getElementById('supp-phone').value.trim(),products:document.getElementById('supp-products').value.trim(),approval:document.getElementById('supp-approval').value,notes:document.getElementById('supp-notes').value.trim(),date:todayStr()});
  saveSuppliers(list);
  ['supp-name','supp-contact','supp-phone','supp-products','supp-notes'].forEach(function(id){document.getElementById(id).value='';});
  renderSuppliersLog(); toast('Saved — '+name+' added to register');
}
function renderSuppliersLog() {
  var list=loadSuppliers(); var c=document.getElementById('suppliers-log');
  if(!list.length){c.innerHTML='<div class="empty">No approved suppliers yet — add your regulars so they appear in the delivery dropdown.</div>';return;}
  document.getElementById('sub-suppliers').textContent=list.length+' supplier'+(list.length>1?'s':'');
  c.innerHTML=list.map(function(s,i){
    return '<div class="log-row" style="align-items:flex-start"><div style="flex:1"><div class="log-name">'+s.name+'</div>'+
      (s.products?'<div class="log-time">'+s.products+'</div>':'')+
      (s.contact||s.phone?'<div class="log-time">'+(s.contact||'')+(s.phone?' · '+s.phone:'')+'</div>':'')+
      '<div class="log-time">'+s.approval+'</div></div>'+
      '<button onclick="removeSupplier('+i+')" style="background:none;border:none;color:#A32D2D;font-size:16px;cursor:pointer;padding:4px">&times;</button></div>';
  }).join('');
}
function removeSupplier(i) {
  var list=loadSuppliers(); list.splice(i,1); saveSuppliers(list); renderSuppliersLog(); toast('Supplier removed');
}

// --- RENDER SECTIONS ---
function renderSection(type) {
  var checklistTypes=['opening','closing','crosscontam'];
  if(checklistTypes.indexOf(type)!==-1){ renderChecklistLog(type); return; }
  var ids={fridge:'fridge-log',cooking:'cooking-log',cooling:'cooling-log',reheating:'reheating-log',delivery:'delivery-log',cleaning:'cleaning-log',probe:'probe-log',pest:'pest-log',illness:'illness-log'};
  var c=document.getElementById(ids[type]); if(!c)return;
  var recs=records.filter(function(r){return r.type===type;});
  if(!recs.length){c.innerHTML='<div class="empty">No records logged yet today.</div>';return;}
  c.innerHTML=recs.slice().reverse().map(function(r){
    var label=r.type==='fridge'?r.unit:r.type==='cooking'?r.food:r.type==='cooling'?r.food:r.type==='reheating'?r.food:r.type==='delivery'?r.supplier:r.type==='cleaning'?r.task:r.type==='probe'?r.probeId:r.type==='pest'?r.pestType:r.staff;
    var extra='';
    if(r.type==='fridge'&&r.by) extra+='<div class="log-time">Checked by: '+r.by+'</div>';
    if(r.type==='cooling') extra+='<div class="log-time">'+r.startTemp+'°C at '+r.startTime+' → '+r.endTemp+'°C at '+r.endTime+' ('+r.method+')</div>';
    if(r.type==='delivery'){
      if(r.invoice) extra+='<div class="log-time">Invoice: '+r.invoice+'</div>';
      if(r.by) extra+='<div class="log-time">Received by: '+r.by+'</div>';
      var details=[];
      if(r.chilledTemp!=='') details.push('Chilled: '+r.chilledTemp+'°C');
      if(r.frozenTemp!=='') details.push('Frozen: '+r.frozenTemp+'°C');
      if(details.length) extra+='<div class="log-time">'+details.join(' · ')+'</div>';
      if(r.photo) extra+='<div style="margin-top:6px"><img src="'+r.photo+'" style="width:72px;height:54px;object-fit:cover;border-radius:6px;border:1px solid #e5e4de;cursor:pointer" onclick="viewPhoto(this.src)"/></div>';
    }
    return '<div class="log-row" style="align-items:flex-start"><div style="flex:1"><div class="log-name">'+label+'</div><div class="log-time">'+r.time+' — '+r.msg+'</div>'+extra+'</div>'+statusBadge(r.status)+'</div>';
  }).join('');
}

function renderHaccpSections() {
  ['opening','closing','crosscontam','fridge','cooking','cooling','reheating','delivery','cleaning','probe','pest','illness'].forEach(renderSection);
  ['customers','kitchenassess','allergen','transport','mobileset','incident'].forEach(renderSection_PC); renderCredentials();
}

// --- DASHBOARD ---
var ALL_TYPES=['fridge','cooking','cooling','reheating','delivery','cleaning','probe','pest','illness','opening','closing','crosscontam','job','kitchenassess','allergen','transport','mobileset','incident'];

function tileBadgeClass(recs) {
  if(!recs.length)return 'none';
  if(recs.some(function(r){return r.status==='fail';}))return 'fail';
  if(recs.some(function(r){return r.status==='warn';}))return 'warn';
  return 'ok';
}

var currentFilter = null;
function recordLabel(r) {
  var typeLabels={fridge:'Fridge',cooking:'Cooking',cooling:'Cooling',reheating:'Reheating',delivery:'Delivery',cleaning:'Cleaning',probe:'Probe',pest:'Pest',illness:'Illness',opening:'Opening',closing:'Closing',crosscontam:'Cross-contam'};
  var name=r.type==='fridge'?r.unit:r.type==='cooking'?r.food:r.type==='cooling'?r.food:r.type==='reheating'?r.food:r.type==='delivery'?r.supplier:r.type==='cleaning'?r.task:r.type==='opening'||r.type==='closing'||r.type==='crosscontam'?r.by:r.type==='probe'?r.probeId:r.type==='pest'?r.pestType:r.staff;
  return {type:typeLabels[r.type]||r.type, name:name||'—'};
}

function refreshFilterPanel(status) {
  var listEl=document.getElementById('filter-list');
  if(!listEl)return;
  var filtered=status==='all'?records.slice():records.filter(function(r){return r.status===status;});
  var colors={ok:'#2D7A3A',warn:'#854F0B',fail:'#A32D2D'};
  if(!filtered.length){
    listEl.innerHTML='<div class="empty">No records in this category today.</div>';
  } else {
    listEl.innerHTML=filtered.map(function(r){
      var lbl=recordLabel(r);
      var dotColor=colors[r.status]||'#888';
      return '<div class="log-row" style="align-items:flex-start">'+
        '<div style="width:8px;height:8px;border-radius:50%;background:'+dotColor+';margin-top:5px;flex-shrink:0;margin-right:10px"></div>'+
        '<div style="flex:1">'+
          '<div style="font-size:13px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:0.04em">'+lbl.type+'</div>'+
          '<div class="log-name">'+lbl.name+'</div>'+
          '<div class="log-time">'+r.time+' — '+r.msg+'</div>'+
        '</div>'+
        statusBadge(r.status)+
      '</div>';
    }).join('');
  }
}

function showFilter(status) {
  if(currentFilter===status){ hideFilter(); return; }
  currentFilter=status;
  var panel=document.getElementById('filter-panel');
  var titleEl=document.getElementById('filter-title');
  var statTitles={ok:'OK checks today',warn:'Warnings today',fail:'Failed checks today',all:'All checks today'};
  titleEl.textContent=statTitles[status]||'Records';
  ['ok','warn','fail','total'].forEach(function(s){
    var el=document.getElementById('stat-'+s);
    if(el) el.parentElement.style.outline=(s===status||(s==='total'&&status==='all'))?'2px solid #1a1a18':'none';
  });
  refreshFilterPanel(status);
  panel.style.display='block';
  panel.scrollIntoView({behavior:'smooth',block:'nearest'});
}

function hideFilter() {
  currentFilter=null;
  document.getElementById('filter-panel').style.display='none';
  ['ok','warn','fail','total'].forEach(function(s){
    var el=document.getElementById('stat-'+s);
    if(el) el.parentElement.style.outline='none';
  });
}

function renderTileGrid() {
  var grid = document.getElementById('haccp-tile-grid');
  if(!grid) return;
  var order = (settings.tileOrder || DEFAULT_TILE_ORDER.slice()).slice();
  TILE_DEFS.forEach(function(d){ if(order.indexOf(d.id)===-1) order.push(d.id); });
  var defMap = {};
  TILE_DEFS.forEach(function(d){ defMap[d.id]=d; });
  var hasBadgeIds = ['opening','closing','fridge','cooking','cooling','reheating','delivery','cleaning','crosscontam','probe','pest','illness','kitchenassess','transport','mobileset','credentials','incident'];
  var regularHtml = [], pcHtml = [];
  order.forEach(function(id) {
    var def = defMap[id]; if(!def) return;
    if(settings.enabledTiles[id]===false) return;
    var badge = hasBadgeIds.indexOf(id)!==-1 ? '<div class="tile-badge none" id="badge-'+id+'"></div>' : '';
    var tileHtml = '<div id="tile-'+id+'" class="tile" onclick="haccpTab(\''+id+'\')">'+
      badge+'<div class="tile-icon">'+def.icon+'</div>'+
      '<div class="tile-label">'+def.label+'</div>'+
      '<div class="tile-sub" id="sub-'+id+'">'+def.subDefault+'</div></div>';
    if(def.pc) pcHtml.push(tileHtml); else regularHtml.push(tileHtml);
  });
  var html = regularHtml.join('');
  if(pcHtml.length) {
    html += '<div id="haccp-grp-privatechef" style="grid-column:1/-1;margin:4px 0 0;display:flex;align-items:center;gap:8px">'+
      '<span style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.05em">Private chef</span>'+
      '<div style="flex:1;height:1px;background:#e5e4de"></div></div>'+pcHtml.join('');
  }
  // Fixed wide tiles always at the end
  html += '<div class="tile tile-wide" onclick="haccpTab(\'inspector\')" style="background:#2D7A3A;border-color:#2D7A3A">'+
    '<div class="tile-wide-inner"><span class="tile-icon-sm">🔍</span>'+
    '<div style="flex:1"><div class="tile-label" style="color:#fff">EHO Inspection View</div>'+
    '<div class="tile-sub" style="color:rgba(255,255,255,0.75)">Tap before an inspection</div></div>'+
    '<span id="inspector-badge" style="font-size:11px;font-weight:700;padding:4px 10px;background:rgba(255,255,255,0.2);border-radius:20px;color:#fff;white-space:nowrap;flex-shrink:0">READY</span></div></div>'+
    '<div id="tile-records" class="tile tile-wide" onclick="haccpTab(\'records\')">'+
    '<div class="tile-wide-inner"><span class="tile-icon-sm"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg></span>'+
    '<div><div class="tile-label">Records</div><div class="tile-sub" id="sub-records">Today &amp; previous days</div></div></div></div>'+
    '<div id="tile-suppliers" class="tile tile-wide" onclick="haccpTab(\'suppliers\')">'+
    '<div class="tile-wide-inner"><span class="tile-icon-sm">✅</span>'+
    '<div><div class="tile-label">Approved suppliers</div><div class="tile-sub" id="sub-suppliers">Supplier register</div></div></div></div>';
  grid.innerHTML = html;
}

function resetTileOrder() {
  settings.tileOrder = DEFAULT_TILE_ORDER.slice();
  TILE_DEFS.forEach(function(d){ settings.enabledTiles[d.id] = true; });
  saveHaccpSettings();
  renderTileGrid();
  updateHaccpDashboard();
  renderCustomisePanel();
}

function renderCustomisePanel() {
  var existing = document.getElementById('tile-customise-panel');
  var savedScroll = existing ? existing.scrollTop : 0;
  if(existing) existing.remove();
  var order = (settings.tileOrder || DEFAULT_TILE_ORDER.slice()).slice();
  TILE_DEFS.forEach(function(d){ if(order.indexOf(d.id)===-1) order.push(d.id); });
  var defMap = {}; TILE_DEFS.forEach(function(d){ defMap[d.id]=d; });
  var rowsHtml = order.map(function(id) {
    var def = defMap[id]; if(!def) return '';
    var enabled = settings.enabledTiles[id]!==false;
    var pcNote = def.pc ? ' <span style="font-size:10px;color:#888;font-weight:400">Private chef</span>' : '';
    return '<div style="display:flex;align-items:center;gap:10px;padding:11px 0;border-bottom:1px solid #f0efe9">'+
      '<span style="font-size:20px;width:28px;text-align:center;flex-shrink:0">'+def.icon+'</span>'+
      '<span style="flex:1;font-size:14px;font-weight:500;color:#1a1a18">'+def.label+pcNote+'</span>'+
      '<div style="display:flex;gap:4px;align-items:center">'+
        '<button onclick="moveTile(\''+id+'\',-1)" style="background:#f5f4f0;border:none;border-radius:6px;padding:5px 9px;cursor:pointer;font-size:13px;line-height:1">↑</button>'+
        '<button onclick="moveTile(\''+id+'\',1)" style="background:#f5f4f0;border:none;border-radius:6px;padding:5px 9px;cursor:pointer;font-size:13px;line-height:1">↓</button>'+
        '<label style="position:relative;display:inline-block;width:40px;height:22px;margin-left:6px;flex-shrink:0">'+
          '<input type="checkbox" onchange="toggleTile(\''+id+'\',this.checked)" '+(enabled?'checked':'')+' style="opacity:0;width:0;height:0;position:absolute">'+
          '<span onclick="" style="position:absolute;inset:0;background:'+(enabled?'#2D7A3A':'#ccc')+';border-radius:11px;transition:background 0.2s;cursor:pointer"></span>'+
          '<span style="position:absolute;top:3px;left:'+(enabled?'21px':'3px')+';width:16px;height:16px;background:#fff;border-radius:50%;transition:left 0.2s;pointer-events:none"></span>'+
        '</label>'+
      '</div></div>';
  }).join('');
  var panel = document.createElement('div');
  panel.id = 'tile-customise-panel';
  panel.style.cssText = 'position:fixed;inset:0;background:#fff;z-index:9999;overflow-y:auto;display:flex;flex-direction:column';
  panel.innerHTML =
    '<div style="display:flex;align-items:center;padding:16px 18px;border-bottom:1px solid #e5e4de;position:sticky;top:0;background:#fff;z-index:1">'+
      '<div style="font-size:17px;font-weight:700;color:#1a1a18;flex:1">Customise home screen</div>'+
      '<button onclick="resetTileOrder()" style="background:none;border:none;font-size:13px;color:#888;cursor:pointer;padding:4px 10px">Reset</button>'+
      '<button onclick="document.getElementById(\'tile-customise-panel\').remove()" style="background:#f0efe9;border:none;border-radius:8px;padding:8px 14px;font-size:14px;font-weight:600;cursor:pointer;color:#1a1a18">Done</button>'+
    '</div>'+
    '<div style="padding:0 18px 40px">'+
      '<p style="font-size:13px;color:#888;margin:12px 0 8px">Reorder tiles with the arrows. Toggle to show or hide.</p>'+
      rowsHtml+'</div>';
  document.body.appendChild(panel);
  panel.scrollTop = savedScroll;
}

function moveTile(id, dir) {
  var order = (settings.tileOrder || DEFAULT_TILE_ORDER.slice()).slice();
  TILE_DEFS.forEach(function(d){ if(order.indexOf(d.id)===-1) order.push(d.id); });
  var idx = order.indexOf(id);
  if(idx===-1) return;
  var newIdx = idx+dir;
  if(newIdx<0||newIdx>=order.length) return;
  order.splice(idx,1); order.splice(newIdx,0,id);
  settings.tileOrder = order;
  saveHaccpSettings();
  renderTileGrid();
  updateHaccpDashboard();
  renderCustomisePanel();
}

function updateHaccpDashboard() {
  var ok=0,warn=0,fail=0;
  records.forEach(function(r){if(r.status==='ok')ok++;else if(r.status==='warn')warn++;else if(r.status==='fail')fail++;});
  document.getElementById('stat-ok').textContent=ok;
  document.getElementById('stat-warn').textContent=warn;
  document.getElementById('stat-fail').textContent=fail;
  document.getElementById('stat-total').textContent=records.length;

  renderTileGrid();

  var subDefaults={fridge:'Log first temp',cooking:'Log a core temp',cooling:'Nothing cooling yet',reheating:'Nothing reheated yet',delivery:'Log a delivery',cleaning:'No tasks logged yet',probe:'Weekly check',pest:'Log an inspection',illness:'No incidents today',opening:'Start of day',closing:'End of day',crosscontam:'Daily check',job:'Build & save menus',kitchenassess:'Pre-job check',allergen:'Dishes & allergens',transport:'Food in transit',mobileset:'Temporary kitchen',incident:'No incidents today'};
  ALL_TYPES.forEach(function(t){
    var recs=records.filter(function(r){return r.type===t;});
    var badge=document.getElementById('badge-'+t);
    var sub=document.getElementById('sub-'+t);
    if(!badge||!sub)return;
    badge.className='tile-badge '+tileBadgeClass(recs);
    badge.textContent=recs.length;
    if(!recs.length){sub.textContent=subDefaults[t];return;}
    var fails=recs.filter(function(r){return r.status==='fail';}).length;
    var warns=recs.filter(function(r){return r.status==='warn';}).length;
    if(fails)sub.textContent=fails+' failed · '+recs.length+' total';
    else if(warns)sub.textContent=warns+' warning · '+recs.length+' total';
    else sub.textContent=recs.length+' record'+(recs.length>1?'s':'')+' — all OK';
  });
  // Customers tile counts 'job' type records (menu library stores nothing in records)
  (function(){
    var jobRecs=records.filter(function(r){return r.type==='job';});
    var badge=document.getElementById('badge-customers');
    var sub=document.getElementById('sub-customers');
    if(!badge||!sub)return;
    badge.className='tile-badge '+tileBadgeClass(jobRecs);
    badge.textContent=jobRecs.length;
    if(!jobRecs.length){sub.textContent='Log a customer job';return;}
    var warns=jobRecs.filter(function(r){return r.status==='warn';}).length;
    if(warns)sub.textContent=warns+' allergen conflict'+(warns>1?'s':'')+' · '+jobRecs.length+' total';
    else sub.textContent=jobRecs.length+' job'+(jobRecs.length>1?'s':'')+' — all OK';
  })();

  var suppCount=loadSuppliers().length;
  document.getElementById('sub-suppliers').textContent=suppCount?suppCount+' supplier'+(suppCount>1?'s':''):'Supplier register';

  var prevDays=getAllDays().filter(function(d){return d!==TODAY;});
  document.getElementById('sub-records').textContent='Today + '+(prevDays.length?prevDays.length+' previous day'+(prevDays.length>1?'s':''):'no previous days');

  var _flMenus = (window.mSettings && window.mSettings.savedDishes) ? window.mSettings.savedDishes.length : 0;
  var _flHaccp = (settings.foodLibrary||[]).length;
  var _flTotal = _flMenus + _flHaccp;
  var _flSub = document.getElementById('sub-foodlibrary');
  if(_flSub) _flSub.textContent = _flTotal ? _flTotal+' dish'+(_flTotal>1?'es':'')+' in library' : 'Dishes for logging';

  var alerts=records.filter(function(r){return r.type!=='job'&&r.status!=='ok';});
  var ac=document.getElementById('alerts-container');
  if(!alerts.length){
    ac.innerHTML=records.length?'<div class="alert-strip none"><div class="alert-text"><strong>All clear</strong><div class="alert-sub">All checks within safe ranges.</div></div></div>':'';
  } else {
    ac.innerHTML=alerts.slice().reverse().map(function(r){
      var cls=r.status==='fail'?'fail':'warn';
      var label=r.type==='fridge'?r.unit:r.type==='cooking'?r.food:r.type==='cooling'?r.food:r.type==='reheating'?r.food:r.type==='delivery'?r.supplier:r.type==='cleaning'?r.task:r.type==='opening'||r.type==='closing'||r.type==='crosscontam'?titles[r.type]:r.type;
      return '<div class="alert-strip '+cls+'"><div class="alert-text"><strong>'+label+'</strong><div class="alert-sub">'+r.time+' — '+r.msg+'</div></div>'+statusBadge(r.status)+'</div>';
    }).join('');
  }
  if(currentFilter) refreshFilterPanel(currentFilter);
  updateNextJobBanner();
  // Update home-screen allergen conflict banner
  var _acGuests = settings.allergenGuests || [];
  if (_acGuests.length) {
    var _acDishAllergens = {};
    records.filter(function(r){ return r.type==='allergen'; }).forEach(function(r){
      (r.allergens||[]).forEach(function(a){ if(!_acDishAllergens[a]) _acDishAllergens[a]=[]; _acDishAllergens[a].push(r.dish); });
    });
    var _acLines = [];
    _acGuests.forEach(function(g){
      var hits = (g.allergens||[]).filter(function(a){ return _acDishAllergens[a]; });
      if (hits.length) _acLines.push(g.name+' — '+hits.map(function(a){ return a+' (in: '+_acDishAllergens[a].join(', ')+')'; }).join('; '));
    });
    _renderAllergenConflictBanners(_acLines);
  } else {
    _renderAllergenConflictBanners([]);
  }
  renderStarterChecklist();
  _maybeShowSampleDayAnnounce();
}

function updateNextJobBanner() {
  var banner = document.getElementById('next-job-banner');
  if (!banner) return;
  var allJobs = []; var _seenJobIds = {};
  function _addJob(r){ if(r.type==='job'&&r.eventDate&&!_seenJobIds[r.id]){ _seenJobIds[r.id]=true; allJobs.push(r); } }
  // haccp_ keys (all days including today)
  getAllDays().forEach(function(d){ getDayRecords(d).forEach(_addJob); });
  // in-memory today records
  records.forEach(_addJob);
  // mise_ key for today — catches jobs booked in the Menus module
  try { var _m=localStorage.getItem('mise_'+todayStr()); if(_m) JSON.parse(_m).forEach(_addJob); } catch(e){};
  var upcoming = allJobs.filter(function(r){ return r.eventDate>=TODAY; });
  upcoming.sort(function(a,b){ return a.eventDate<b.eventDate?-1:a.eventDate>b.eventDate?1:0; });
  if(!upcoming.length){ banner.style.display='none'; return; }
  var job = upcoming[0];
  banner.style.display = 'block';

  document.getElementById('next-job-client').textContent = job.client || 'Unnamed client';
  var parts = [];
  if(job.eventDate===TODAY) parts.push('Today');
  else { var dd=new Date(job.eventDate+'T12:00:00'); parts.push(dd.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})); }
  if(job.jobType) parts.push(job.jobType);
  if(job.covers) parts.push(job.covers+' guests');
  if(job.location) parts.push(job.location);
  document.getElementById('next-job-detail').textContent = parts.join(' · ');

  // Build detail panel content
  function njRow(label, val){
    return '<div style="margin-top:10px"><div style="font-size:11px;color:rgba(255,255,255,0.6);margin-bottom:2px">'+label+'</div><div style="font-size:13px;color:#fff;line-height:1.4">'+val+'</div></div>';
  }
  var html = '';
  var dateStr = job.eventDate===TODAY ? 'Today' : fmtDate(job.eventDate);
  html += njRow('Date', dateStr + (job.eventTime ? ' at '+job.eventTime : ''));
  if(job.jobType) html += njRow('Type', job.jobType);
  if(job.covers)  html += njRow('Covers', job.covers+' guests');
  if(job.location) html += njRow('Location', '<a href="https://maps.google.com/?q='+encodeURIComponent(job.location)+'" onclick="event.stopPropagation()" style="color:#fff;text-decoration:underline;text-underline-offset:2px;opacity:0.9" target="_blank">'+job.location+' ↗</a>');
  if(job.phone)   html += njRow('Phone', '<a href="tel:'+job.phone+'" onclick="event.stopPropagation()" style="color:#fff;text-decoration:underline;text-underline-offset:2px;opacity:0.9">'+job.phone+'</a>');
  if(job.email)   html += njRow('Email', '<a href="mailto:'+job.email+'" onclick="event.stopPropagation()" style="color:#fff;text-decoration:underline;text-underline-offset:2px;opacity:0.9">'+job.email+'</a>');
  if(job.notes)   html += njRow('Notes', job.notes);
  if(job.menus&&job.menus.length){
    var mHtml = job.menus.map(function(m){
      var chips = (m.dishes||[]).map(function(d){ return '<span style="display:inline-block;background:rgba(255,255,255,0.08);border-radius:5px;padding:2px 7px;font-size:11px;margin:2px 2px 2px 0;color:#e8e0d0">'+d.dish+'</span>'; }).join('');
      return '<div style="margin-bottom:6px"><div style="font-size:12px;font-weight:600;color:rgba(255,255,255,0.9);margin-bottom:3px">'+m.name+'</div>'+(chips||'<span style="font-size:12px;color:rgba(255,255,255,0.5)">No dishes listed</span>')+'</div>';
    }).join('');
    html += njRow('Menu', mHtml);
  } else {
    html += njRow('Menu', '<span style="color:rgba(255,255,255,0.5)">No menu attached</span>');
  }
  document.getElementById('next-job-panel-content').innerHTML = html;

  // Wire the "View booking in Carte" button to deep-link to this job
  var carteBtn = document.getElementById('next-job-carte-btn');
  if (carteBtn) carteBtn.onclick = function(){ openCarte(job.id); };

  // Wire allergen matrix button — only show when the job has at least one menu
  var allergenBtn = document.getElementById('next-job-allergen-btn');
  if (allergenBtn) {
    var hasMenu = job.menus && job.menus.length > 0;
    allergenBtn.style.display = hasMenu ? 'block' : 'none';
    allergenBtn.onclick = function(){ _printNextJobAllergenMatrix(job); };
  }

  // Wire the HACCP checklist button
  var checklistBtn = document.getElementById('next-job-checklist-btn');
  if (checklistBtn) {
    checklistBtn.style.display = 'flex';
    checklistBtn.onclick = function(){ openJobHaccpChecklist(job); };
  }

  // Wire share button — only show for Carte-sourced jobs (have a jobs table row)
  var shareBtn = document.getElementById('next-job-share-btn');
  if (shareBtn) {
    shareBtn.style.display = job._fromCarte ? 'block' : 'none';
    shareBtn.onclick = function(){ openShareFreelancerModal(job.id, job.eventDate); };
  }
}

function toggleNextJobBanner(){
  var panel   = document.getElementById('next-job-panel');
  var chevron = document.getElementById('next-job-chevron');
  if(!panel) return;
  var open = panel.style.display !== 'none';
  panel.style.display   = open ? 'none' : 'block';
  if(chevron) chevron.style.transform = open ? '' : 'rotate(90deg)';
}

function buildDayBlock(dateStr,recs,isToday) {
  var ok=recs.filter(function(r){return r.status==='ok';}).length;
  var warn=recs.filter(function(r){return r.status==='warn';}).length;
  var fail=recs.filter(function(r){return r.status==='fail';}).length;
  var typeLabels={fridge:'Fridge temps',cooking:'Cooking',cooling:'Cooling',reheating:'Reheating',delivery:'Deliveries',cleaning:'Cleaning',probe:'Probe',pest:'Pest',illness:'Illness',opening:'Opening',closing:'Closing',crosscontam:'Cross-contam'};
  var bodyRows=ALL_TYPES.map(function(t){
    var tr=recs.filter(function(r){return r.type===t;});
    if(!tr.length)return '';
    return '<div class="divider" style="margin-top:10px">'+typeLabels[t]+'</div>'+tr.map(function(r){
      var label=r.type==='fridge'?r.unit:r.type==='cooking'?r.food:r.type==='cooling'?r.food:r.type==='reheating'?r.food:r.type==='delivery'?r.supplier:r.type==='cleaning'?r.task:r.type==='opening'||r.type==='closing'||r.type==='crosscontam'?r.by:r.type==='probe'?r.probeId:r.type==='pest'?r.pestType:r.staff;
      return '<div class="log-row"><div style="flex:1"><div class="log-name">'+label+'</div><div class="log-time">'+r.time+' — '+r.msg+'</div></div>'+statusBadge(r.status)+'</div>';
    }).join('');
  }).join('');
  var todayTag=isToday?'<span class="today-label">Today</span>':'';
  return '<div class="day-block">'+
    '<div class="day-block-header" onclick="toggleDay(\'day-'+dateStr+'\')">'+
      '<div><div class="day-block-title">'+fmtDate(dateStr)+todayTag+'</div>'+
      '<div class="day-block-meta">'+recs.length+' record'+(recs.length!==1?'s':'')+(fail?' · <span style="color:#A32D2D;font-weight:600">'+fail+' failed</span>':'')+(warn?' · <span style="color:#854F0B;font-weight:600">'+warn+' warning</span>':'')+'</div></div>'+
      '<span style="font-size:18px;color:#aaa" id="chevron-'+dateStr+'">›</span>'+
    '</div>'+
    '<div class="day-block-body'+(isToday?' open':'')+'" id="day-'+dateStr+'">'+
      '<div class="day-stat-row">'+
        '<div class="day-stat"><div class="day-stat-num" style="color:#2D7A3A">'+ok+'</div><div class="day-stat-label">OK</div></div>'+
        '<div class="day-stat"><div class="day-stat-num" style="color:#854F0B">'+warn+'</div><div class="day-stat-label">Warn</div></div>'+
        '<div class="day-stat"><div class="day-stat-num" style="color:#A32D2D">'+fail+'</div><div class="day-stat-label">Failed</div></div>'+
        '<div class="day-stat"><div class="day-stat-num" style="color:#888">'+recs.length+'</div><div class="day-stat-label">Total</div></div>'+
      '</div>'+
      (recs.length?bodyRows:'<div class="empty" style="padding:8px 0">No records yet.</div>')+
      '<div style="display:flex;gap:8px;margin-top:10px">'+
        '<button class="btn-secondary" onclick="exportDay(\''+dateStr+'\')">Export .txt</button>'+
        '<button class="btn-primary" onclick="exportDayPDF(\''+dateStr+'\')">Export PDF</button>'+
      '</div>'+
    '</div>'+
  '</div>';
}

function renderRecords() {
  var c=document.getElementById('records-list');
  var allDays=getAllDays().filter(function(d){return d!==TODAY;});
  var html=buildDayBlock(TODAY,records,true);
  if(allDays.length){html+='<div class="divider">Previous days</div>';html+=allDays.map(function(d){return buildDayBlock(d,getDayRecords(d),false);}).join('');}
  c.innerHTML=html;
  var chev=document.getElementById('chevron-'+TODAY); if(chev)chev.textContent='⌄';
}

function toggleDay(id) {
  var el=document.getElementById(id); var d=id.replace('day-',''); var chev=document.getElementById('chevron-'+d);
  if(el.classList.contains('open')){el.classList.remove('open');if(chev)chev.textContent='›';}
  else{el.classList.add('open');if(chev)chev.textContent='⌄';}
}

function exportDay(dateStr) { var recs=dateStr===TODAY?records:getDayRecords(dateStr); buildExport(fmtDate(dateStr),recs,'haccp-log-'+dateStr+'.txt'); }

function buildExport(dateLabel,recs,filename) {
  var header='HACCP Daily Log — '+dateLabel+'\n'+'='.repeat(40)+'\n\n';
  var sections=ALL_TYPES.map(function(t){
    var tr=recs.filter(function(r){return r.type===t;});
    if(!tr.length)return '';
    var label=titles[t]?titles[t].toUpperCase():t.toUpperCase();
    return label+'\n'+tr.map(function(r){
      var name=r.type==='fridge'?r.unit:r.type==='cooking'?r.food:r.type==='cooling'?r.food:r.type==='reheating'?r.food:r.type==='delivery'?r.supplier:r.type==='cleaning'?r.task:r.type==='opening'||r.type==='closing'||r.type==='crosscontam'?r.by:r.type==='probe'?r.probeId:r.type==='pest'?r.pestType:r.type==='incident'?r.incidentType:r.staff;
      return r.time+'  '+name+'  '+r.msg+'  ['+r.status.toUpperCase()+']';
    }).join('\n')+'\n';
  }).filter(Boolean).join('\n');
  var blob=new Blob([header+sections],{type:'text/plain'});
  var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click(); toast('Report exported');
}

function exportDayPDF(dateStr) {
  var recs = dateStr === todayStr() ? records : getDayRecords(dateStr);
  if(window.posthog) posthog.capture('pdf_exported', { date: dateStr, record_count: recs.length });
  buildPDFExport(fmtDate(dateStr), recs);
}

function buildPDFExport(dateLabel, recs) {
  var ok = recs.filter(function(r){return r.status==='ok';}).length;
  var warn = recs.filter(function(r){return r.status==='warn';}).length;
  var fail = recs.filter(function(r){return r.status==='fail';}).length;

  var typeHeadings = {
    fridge:'Fridge Temperatures', cooking:'Cooked Food Temperatures', cooling:'Cooling Records',
    reheating:'Reheating Records', delivery:'Delivery Checks', cleaning:'Cleaning Records',
    probe:'Probe Calibration', pest:'Pest Control', illness:'Staff Illness',
    opening:'Opening Checks', closing:'Closing Checks', crosscontam:'Cross-Contamination',
    job:'Job Details', kitchenassess:'Kitchen Assessment', allergen:'Allergen Log',
    transport:'Transport Temperatures', mobileset:'Mobile Setup', incident:'Incident Log'
  };

  function esc(s) { return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }

  function statusStyle(s) {
    if(s==='ok') return 'color:#2D7A3A;font-weight:600';
    if(s==='warn') return 'color:#854F0B;font-weight:600';
    return 'color:#A32D2D;font-weight:600';
  }

  function statusLabel(s) {
    return s==='ok' ? 'OK' : s==='warn' ? 'Warning' : 'Failed';
  }

  function detailsFor(r) {
    var parts = [];
    if(r.type==='fridge') { parts.push(esc(r.unit)); if(r.temp!==undefined&&r.temp!=='') parts.push(esc(r.temp)+'°C'); if(r.by) parts.push('By: '+esc(r.by)); if(r.notes) parts.push(esc(r.notes)); }
    else if(r.type==='cooking') { parts.push(esc(r.food)); if(r.temp!==undefined&&r.temp!=='') parts.push(esc(r.temp)+'°C'); if(r.chef) parts.push('Chef: '+esc(r.chef)); }
    else if(r.type==='cooling') { parts.push(esc(r.food)); if(r.startTemp!==undefined) parts.push(esc(r.startTemp)+'°C → '+esc(r.endTemp)+'°C'); if(r.method) parts.push('Method: '+esc(r.method)); if(r.by) parts.push('By: '+esc(r.by)); }
    else if(r.type==='reheating') { parts.push(esc(r.food)); if(r.temp!==undefined&&r.temp!=='') parts.push(esc(r.temp)+'°C'); if(r.chef) parts.push('Chef: '+esc(r.chef)); if(r.notes) parts.push(esc(r.notes)); }
    else if(r.type==='delivery') { parts.push(esc(r.supplier)); if(r.temp!==undefined&&r.temp!=='') parts.push(esc(r.temp)+'°C'); if(r.condition) parts.push('Condition: '+esc(r.condition)); if(r.by) parts.push('Received by: '+esc(r.by)); if(r.invoice) parts.push('Invoice: '+esc(r.invoice)); }
    else if(r.type==='cleaning') { parts.push(esc(r.task)); if(r.chem) parts.push('Chemical: '+esc(r.chem)); if(r.by) parts.push('By: '+esc(r.by)); }
    else if(r.type==='probe') { parts.push('Probe: '+esc(r.probeId)); if(r.reading!==undefined&&r.reading!=='') parts.push('Reading: '+esc(r.reading)+'°C'); if(r.result) parts.push('Result: '+esc(r.result)); if(r.by) parts.push('By: '+esc(r.by)); }
    else if(r.type==='pest') { parts.push(esc(r.pestType)); if(r.location) parts.push('Location: '+esc(r.location)); if(r.action) parts.push('Action: '+esc(r.action)); if(r.by) parts.push('By: '+esc(r.by)); }
    else if(r.type==='illness') { parts.push(esc(r.staff)); if(r.illnessType) parts.push(esc(r.illnessType)); if(r.symptoms) parts.push('Symptoms: '+esc(r.symptoms)); }
    else if(r.type==='opening'||r.type==='closing'||r.type==='crosscontam') { if(r.by) parts.push('By: '+esc(r.by)); if(r.notes) parts.push(esc(r.notes)); parts.push(esc(r.msg)); }
    else if(r.type==='job') { if(r.client) parts.push('Client: '+esc(r.client)); if(r.location) parts.push(esc(r.location)); if(r.jobType) parts.push(esc(r.jobType)); if(r.covers) parts.push(esc(r.covers)+' covers'); }
    else if(r.type==='kitchenassess') { if(r.client) parts.push('Client: '+esc(r.client)); if(r.fridgeTemp!==undefined&&r.fridgeTemp!=='') parts.push('Fridge: '+esc(r.fridgeTemp)+'°C'); if(r.condition) parts.push('Condition: '+esc(r.condition)); }
    else if(r.type==='allergen') { if(r.client) parts.push('Client: '+esc(r.client)); if(r.dish) parts.push('Dish: '+esc(r.dish)); if(r.allergens&&r.allergens.length) parts.push('Allergens: '+r.allergens.map(esc).join(', ')); }
    else if(r.type==='transport') { parts.push(esc(r.food)); if(r.destination) parts.push('To: '+esc(r.destination)); if(r.startTemp!==undefined) parts.push(esc(r.startTemp)+'°C → '+esc(r.endTemp)+'°C'); if(r.method) parts.push('Method: '+esc(r.method)); }
    else if(r.type==='incident') { parts.push(esc(r.incidentType)); parts.push('Severity: '+esc(r.severity)); if(r.incidentTime) parts.push('Time: '+esc(r.incidentTime.replace('T',' '))); if(r.location&&r.location.text) parts.push('Location: '+esc(r.location.text)+(r.location.accuracy?' (±'+r.location.accuracy+'m)':'')); if(r.description) parts.push(esc(r.description)); if(r.action) parts.push('Action: '+esc(r.action)); if(r.by) parts.push('By: '+esc(r.by)); var pc=(r.photos&&r.photos.length)||0; if(pc) parts.push(pc+' photo'+(pc>1?'s':'')+' attached'); }
    else { parts.push(esc(r.msg)); }
    return parts.filter(Boolean).join(' &nbsp;·&nbsp; ');
  }

  var sectionsHtml = ALL_TYPES.map(function(t) {
    var tr = recs.filter(function(r){return r.type===t;});
    if(!tr.length) return '';
    var heading = typeHeadings[t] || t;
    var rows = tr.map(function(r) {
      return '<tr>'
        +'<td style="white-space:nowrap;padding:6px 10px;border-bottom:1px solid #eee;color:#555;font-size:13px">'+esc(r.time||r.date||'')+'</td>'
        +'<td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px">'+detailsFor(r)+'</td>'
        +'<td style="white-space:nowrap;padding:6px 10px;border-bottom:1px solid #eee;font-size:13px;'+statusStyle(r.status)+'">'+statusLabel(r.status)+'</td>'
        +'</tr>';
    }).join('');
    return '<div style="margin-bottom:24px;page-break-inside:avoid">'
      +'<div style="font-size:12px;font-weight:700;letter-spacing:0.08em;color:#555;text-transform:uppercase;border-bottom:2px solid #2D7A3A;padding-bottom:4px;margin-bottom:0">'+esc(heading)+'</div>'
      +'<table style="width:100%;border-collapse:collapse"><thead>'
      +'<tr style="background:#f8f8f8"><th style="text-align:left;padding:6px 10px;font-size:11px;color:#888;font-weight:600;border-bottom:1px solid #ddd">Time</th>'
      +'<th style="text-align:left;padding:6px 10px;font-size:11px;color:#888;font-weight:600;border-bottom:1px solid #ddd">Details</th>'
      +'<th style="text-align:left;padding:6px 10px;font-size:11px;color:#888;font-weight:600;border-bottom:1px solid #ddd">Status</th></tr>'
      +'</thead><tbody>'+rows+'</tbody></table></div>';
  }).filter(Boolean).join('');

  // Pull business name and chef name from Supabase profile (set in Step 4)
  var profile      = (window.Mise && window.Mise.profile) || {};
  var businessName = profile.business_name || '';
  var chefName     = profile.chef_name     || '';

  // Generate a short reference number: date + record count e.g. "20260414-7"
  var refDate = new Date();
  var refNum  = refDate.getFullYear().toString()
    + String(refDate.getMonth()+1).padStart(2,'0')
    + String(refDate.getDate()).padStart(2,'0')
    + '-' + recs.length;

  var genDate = refDate.toLocaleDateString('en-GB', {day:'numeric', month:'long', year:'numeric'});
  var genTime = refDate.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8">'
    +'<meta name="viewport" content="width=device-width,initial-scale=1">'
    +'<title>HACCP Daily Log — '+esc(dateLabel)+'</title>'
    +'<style>'
    +'*{box-sizing:border-box;margin:0;padding:0}'
    +'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#222;background:#fff;padding:24px}'
    +'.toolbar{position:sticky;top:0;z-index:10;background:#fff;border-bottom:1px solid #eee;padding:10px 0 10px;margin:-24px -24px 20px;padding-left:24px;display:flex;gap:10px;align-items:center}'
    +'.btn-pdf{background:#2D7A3A;color:#fff;border:none;border-radius:6px;padding:9px 18px;font-size:14px;font-weight:600;cursor:pointer}'
    +'.btn-close{background:#f0f0f0;color:#444;border:none;border-radius:6px;padding:9px 14px;font-size:14px;cursor:pointer}'
    +'@media print{'
    +'@page{size:A4;margin:18mm 18mm 18mm 18mm}'
    +'.no-print{display:none!important}'
    +'body{padding:0}'
    +'.toolbar{display:none!important}'
    +'}'
    +'</style>'
    +'</head><body>'
    // Toolbar (hidden when printing)
    +'<div class="toolbar no-print">'
    +'<button class="btn-pdf" onclick="window.print()">Save as PDF</button>'
    +'<button class="btn-close" onclick="window.close()">Close</button>'
    +'</div>'
    // Header — logo + business name + chef name
    +'<div style="border-bottom:3px solid #2D7A3A;padding-bottom:14px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">'
    +  '<div style="display:flex;align-items:center;gap:14px">'
    +    (profile.logo ? '<img src="'+profile.logo+'" alt="" style="max-height:56px;max-width:140px;object-fit:contain;border-radius:4px">' : '')
    +    '<div>'
    +      '<div style="font-size:9px;letter-spacing:0.12em;text-transform:uppercase;color:#2D7A3A;font-weight:700;margin-bottom:4px">HACCP Daily Log</div>'
    +      '<div style="font-size:22px;font-weight:700;color:#222">'+esc(dateLabel)+'</div>'
    +      (businessName ? '<div style="font-size:14px;color:#444;margin-top:3px;font-weight:600">'+esc(businessName)+'</div>' : '')
    +      (chefName     ? '<div style="font-size:12px;color:#888;margin-top:1px">'+esc(chefName)+'</div>' : '')
    +    '</div>'
    +  '</div>'
    +  '<div style="text-align:right;flex-shrink:0">'
    +    '<div style="font-size:12px;font-weight:700;color:#2D7A3A;letter-spacing:0.02em">Veriqo</div>'
    +    '<div style="font-size:11px;color:#aaa;margin-top:3px">Ref: '+esc(refNum)+'</div>'
    +    '<div style="font-size:11px;color:#aaa;margin-top:2px">'+esc(genDate)+' · '+esc(genTime)+'</div>'
    +  '</div>'
    +'</div>'
    // Summary row
    +'<div style="display:flex;gap:24px;margin-bottom:24px;padding:12px 16px;background:#f8f8f8;border-radius:6px">'
    +'<div><span style="font-size:22px;font-weight:700;color:#2D7A3A">'+ok+'</span><span style="font-size:12px;color:#555;margin-left:5px">OK</span></div>'
    +'<div><span style="font-size:22px;font-weight:700;color:#854F0B">'+warn+'</span><span style="font-size:12px;color:#555;margin-left:5px">Warning</span></div>'
    +'<div><span style="font-size:22px;font-weight:700;color:#A32D2D">'+fail+'</span><span style="font-size:12px;color:#555;margin-left:5px">Failed</span></div>'
    +'<div><span style="font-size:22px;font-weight:700;color:#888">'+recs.length+'</span><span style="font-size:12px;color:#555;margin-left:5px">Total</span></div>'
    +'</div>'
    // Sections
    +(sectionsHtml || '<p style="color:#888;font-size:14px">No records for this day.</p>')
    // Footer
    +'<div style="margin-top:32px;padding-top:12px;border-top:1px solid #eee;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">'
    +  '<span style="font-size:11px;color:#aaa">Generated by Veriqo — Food Safety. Inspection Ready. &nbsp;|&nbsp; '+esc(genDate)+' at '+esc(genTime)+'</span>'
    +  '<span style="font-size:11px;color:#ccc">Ref: '+esc(refNum)+'</span>'
    +'</div>'
    +'</body></html>';

  // iOS Safari blocks window.open() on async calls — use a Blob URL instead
  // which works reliably across all browsers including mobile Safari
  var blob = new Blob([html], {type: 'text/html'});
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href   = url;
  a.target = '_blank';
  a.rel    = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after a short delay to allow the page to load
  setTimeout(function(){ URL.revokeObjectURL(url); }, 10000);
}

// --- PRIVATE CHEF MODE ---
var PC_TYPES = ['job','customers','kitchenassess','allergen','transport','mobileset','credentials','incident'];

var DISH_CATEGORIES = ['','Canapé','Starter','Fish course','Main','Side','Sauce','Pre-dessert','Dessert','Cheese','Petit four','Bread','Other'];
var ALLERGENS_14 = ['Celery','Cereals containing gluten','Crustaceans','Eggs','Fish','Lupin','Milk','Molluscs','Mustard','Nuts','Peanuts','Sesame','Soya','Sulphur dioxide'];
var DIETARY_PREFS = ['Vegetarian','Vegan','Gluten-free','Dairy-free','Halal','Kosher','Nut-free','Shellfish-free'];

var DEFAULT_CHECKLISTS_PC = {
  kitchenassess: [
    {label:'Fridge/freezer operational and at safe temperature', note:''},
    {label:'Surfaces and worktops clean and in good condition', note:''},
    {label:'Sink available with hot water, soap and hand drying', note:''},
    {label:'No evidence of pests or pest damage', note:''},
    {label:'Separate areas available for raw and ready-to-eat food', note:''},
    {label:'Adequate ventilation available', note:''},
    {label:'Client informed of any food safety concerns', note:''},
  ],
  mobileset: [
    {label:'All equipment cleaned and sanitised before use', note:''},
    {label:'Surfaces disinfected with appropriate food-safe product', note:''},
    {label:'Colour-coded equipment set up correctly', note:'Red=raw meat, blue=raw fish, yellow=cooked, green=salad/veg'},
    {label:'Probe thermometer cleaned and ready', note:''},
    {label:'Handwashing station set up', note:'Soap, paper towels, running water'},
    {label:'Raw food stored separately from ready-to-eat', note:''},
    {label:'Waste disposal plan in place', note:''},
    {label:'Client allergen requirements confirmed before cooking', note:''},
  ]
};

function togglePrivateChefMode(on) {
  settings.privateChefMode = on;
  saveHaccpSettings();
  var section = document.getElementById('pc-section');
  if (section) section.style.display = on ? 'block' : 'none';
  var slider = document.getElementById('pc-slider');
  var knob = document.getElementById('pc-knob');
  if (slider) slider.style.background = on ? '#1a1a18' : '#ccc';
  if (knob) knob.style.transform = on ? 'translateX(18px)' : 'translateX(0)';
  if (on) {
    renderPCChecklists();
    renderAllergenChecks();
    renderMenuDishAllergens();
    renderCustAllergens();
    renderCustDietaryPrefs();
    renderCustDishAllergens();
    renderMenuLibrary();
    renderDishLibrary();
    custPopulateMenuSelect();
    populateSelect('tr-by','staff');
    populateSelect('ms-by','staff');
  }
  updateHaccpDashboard();
}

function initPrivateChefMode() {
  renderPCChecklists();
  renderAllergenChecks();
  renderMenuDishAllergens();
  renderCustAllergens();
  renderCustDietaryPrefs();
  renderCustDishAllergens();
  renderMenuLibrary();
  renderDishLibrary();
  custPopulateMenuSelect();
  populateSelect('tr-by','staff');
  populateSelect('ms-by','staff');
}

function renderPCChecklists() {
  ['kitchenassess','mobileset'].forEach(function(type) {
    var c = document.getElementById(type === 'kitchenassess' ? 'ka-checklist' : 'mobileset-checklist');
    if (!c) return;
    var key = 'checklist_pc_' + type;
    var items = settings[key] || DEFAULT_CHECKLISTS_PC[type].map(function(i,idx){ return {id:type[0]+idx, label:i.label, note:i.note}; });
    if (!settings[key]) { settings[key] = items; saveHaccpSettings(); }
    c.innerHTML = items.map(function(item){
      return '<div class="checklist-item">'+
        '<input type="checkbox" id="chk-'+item.id+'">'+
        '<label for="chk-'+item.id+'">'+esc(item.label)+(item.note?'<span class="check-note">'+esc(item.note)+'</span>':'')+'</label>'+
      '</div>';
    }).join('');
  });
}

function renderAllergenChecks() {
  var c = document.getElementById('allergen-checks');
  if (!c) return;
  c.innerHTML = ALLERGENS_14.map(function(a){
    var id = 'al-' + a.replace(/\s/g,'_');
    return '<label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#555;padding:4px 0;cursor:pointer">'+
      '<input type="checkbox" id="'+id+'" style="width:16px;height:16px;accent-color:#1a1a18"> '+a+'</label>';
  }).join('');
}

// --- MENU LIBRARY ---

var _menuDishes = [];
var _editingMenuId = null;
var _expandedMenuDishIdx = null;

function _sortByMealOrder(dishes) {
  return dishes.slice().sort(function(a, b) {
    var ai = DISH_CATEGORIES.indexOf(a.category || '');
    var bi = DISH_CATEGORIES.indexOf(b.category || '');
    // '' is index 0 — treat uncategorised as last
    if (ai <= 0) ai = DISH_CATEGORIES.length;
    if (bi <= 0) bi = DISH_CATEGORIES.length;
    return ai - bi;
  });
}

// ═══════════════════════════════════════════════════ AI VISION ═══════════
// Normalise allergen names returned by /api/ai-scan + /api/parse-menu (which
// use Carte's allergen vocabulary) into Veriqo's ALLERGENS_14 vocabulary.
function _normaliseAllergenForVeriqo(a) {
  if (!a) return null;
  var lc = String(a).toLowerCase().trim();
  if (lc.indexOf('cereal') >= 0 || lc.indexOf('gluten') >= 0) return 'Cereals containing gluten';
  if (lc.indexOf('sulph') >= 0 || lc.indexOf('sulfite') >= 0)  return 'Sulphur dioxide';
  for (var i = 0; i < ALLERGENS_14.length; i++) {
    if (ALLERGENS_14[i].toLowerCase() === lc) return ALLERGENS_14[i];
  }
  return null;
}

function _veriqoReadFileAsDataUrl(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(e) { resolve(e.target.result); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function _setMenuDishAllergenCheckboxes(allergens) {
  // Clear all first
  ALLERGENS_14.forEach(function(a) {
    var el = document.getElementById('mda-' + a.replace(/\s+/g,'_'));
    if (el) el.checked = false;
  });
  // Tick the ones the AI identified
  (allergens || []).forEach(function(raw) {
    var canon = _normaliseAllergenForVeriqo(raw);
    if (!canon) return;
    var el = document.getElementById('mda-' + canon.replace(/\s+/g,'_'));
    if (el) el.checked = true;
  });
}

async function handleVeriqoMagicImport(event) {
  var file = event.target.files && event.target.files[0];
  if (!file) return;
  event.target.value = '';

  if (file.size > 4 * 1024 * 1024) {
    toast('File too large — please use an image under 4MB', false);
    return;
  }

  var btn = document.getElementById('vmagic-import-btn');
  var origHTML = btn ? btn.innerHTML : '';

  function resetBtn(failed) {
    if (!btn) return;
    if (failed) {
      btn.innerHTML = '❌ Import failed';
      btn.disabled = true;
      setTimeout(function() { btn.innerHTML = origHTML; btn.disabled = false; }, 3000);
    } else {
      btn.innerHTML = origHTML;
      btn.disabled = false;
    }
  }

  try {
    if (btn) { btn.innerHTML = '⏳ Analysing menu…'; btn.disabled = true; }
    var dataUrl = await _veriqoReadFileAsDataUrl(file);
    var base64 = dataUrl.indexOf(',') !== -1 ? dataUrl.split(',')[1] : dataUrl;
    var mimeType = file.type || 'image/jpeg';

    var res = await fetch('/api/parse-menu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64, mimeType: mimeType })
    });
    var data = await res.json();

    if (!res.ok || data.error) {
      resetBtn(true);
      toast('Import failed: ' + (data.error || 'server error'), false);
      console.error('[Veriqo] Magic import API:', data.error);
      return;
    }

    var dishes = Array.isArray(data.dishes) ? data.dishes : [];
    if (!dishes.length) {
      resetBtn(true);
      toast('No dishes detected — try a clearer photo', false);
      return;
    }

    // Populate menu name if blank
    var nameEl = document.getElementById('menu-name');
    if (nameEl && !nameEl.value && data.menuName) nameEl.value = data.menuName;

    // Append into the in-progress dish list, normalising allergens
    if (!Array.isArray(window._menuDishes)) window._menuDishes = _menuDishes || [];
    dishes.forEach(function(d) {
      var canon = (d.allergens || []).map(_normaliseAllergenForVeriqo).filter(Boolean);
      _menuDishes.push({ dish: d.name || 'Untitled dish', allergens: canon, category: d.category || '' });
    });
    _menuDishes = _sortByMealOrder(_menuDishes);
    if (typeof menuRenderDishes === 'function') menuRenderDishes();

    resetBtn(false);
    toast('✨ Imported ' + dishes.length + ' dish' + (dishes.length !== 1 ? 'es' : '') + ' — review & save', true);
  } catch (err) {
    resetBtn(true);
    toast('Import failed — check your connection', false);
    console.error('[Veriqo] Magic import fetch:', err);
  }
}

function renderMenuDishAllergens() {
  var c = document.getElementById('menu-dish-allergens');
  if (!c) return;
  c.innerHTML = ALLERGENS_14.map(function(a) {
    var id = 'mda-' + a.replace(/\s+/g,'_');
    return '<label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#555;padding:3px 0;cursor:pointer">'
      + '<input type="checkbox" id="' + id + '" style="width:15px;height:15px;accent-color:#1a1a18"> ' + a + '</label>';
  }).join('');
}

function menuAddDish() {
  var name = (document.getElementById('menu-dish-name').value || '').trim();
  if (!name) { toast('Enter a dish name first', false); return; }
  var allergens = ALLERGENS_14.filter(function(a) {
    var el = document.getElementById('mda-' + a.replace(/\s+/g,'_'));
    return el && el.checked;
  });
  var cat = (document.getElementById('menu-dish-cat').value || '').trim();
  _menuDishes.push({ dish: name, allergens: allergens, category: cat });
  _menuDishes = _sortByMealOrder(_menuDishes);
  document.getElementById('menu-dish-name').value = '';
  document.getElementById('menu-dish-cat').value = '';
  ALLERGENS_14.forEach(function(a) {
    var el = document.getElementById('mda-' + a.replace(/\s+/g,'_'));
    if (el) el.checked = false;
  });
  menuRenderDishes();
  document.getElementById('menu-dish-name').focus();
}

function menuRemoveDish(idx) {
  _menuDishes.splice(idx, 1);
  menuRenderDishes();
}

function menuRenderDishes() {
  var c = document.getElementById('menu-dishes-list');
  if (!c) return;
  if (!_menuDishes.length) {
    c.innerHTML = '<div style="font-size:13px;color:#aaa;text-align:center;padding:8px 0">No dishes added yet</div>';
    return;
  }
  var html = '';
  var lastCat = null;
  _menuDishes.forEach(function(d, idx) {
    var cat = d.category || '';
    if (cat !== lastCat) {
      if (cat) html += '<div style="font-size:11px;font-weight:700;color:#2D7A3A;text-transform:uppercase;letter-spacing:0.05em;padding:6px 0 3px">' + cat + '</div>';
      lastCat = cat;
    }
    var isEditing = _expandedMenuDishIdx === idx;
    var tags = d.allergens.length
      ? d.allergens.map(function(a) {
          return '<span style="display:inline-block;padding:2px 7px;border-radius:10px;font-size:11px;font-weight:600;margin:2px 2px 0 0;background:#f0f0ec;color:#555">' + a + '</span>';
        }).join('')
      : '<span style="font-size:12px;color:#aaa">No allergens</span>';
    var catOptions = DISH_CATEGORIES.map(function(co) {
      return '<option value="' + co + '"' + (d.category === co ? ' selected' : '') + '>' + (co || 'No category') + '</option>';
    }).join('');
    var editForm = isEditing
      ? '<div style="margin-top:10px;padding-top:10px;border-top:1px solid #e5e4de">'
        + '<input id="mde-name-' + idx + '" class="form-input" type="text" value="' + d.dish.replace(/"/g,'&quot;') + '" style="margin-bottom:8px">'
        + '<select id="mde-cat-' + idx + '" class="form-input" style="margin-bottom:8px;color:#555">' + catOptions + '</select>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:10px">'
        + ALLERGENS_14.map(function(a) {
            var eid = 'mde-al-' + idx + '-' + a.replace(/\s+/g,'_');
            var chk = d.allergens.indexOf(a) !== -1 ? ' checked' : '';
            return '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#555;padding:2px 0;cursor:pointer">'
              + '<input type="checkbox" id="' + eid + '"' + chk + ' style="width:14px;height:14px;accent-color:#1a1a18"> ' + a + '</label>';
          }).join('')
        + '</div>'
        + '<div style="display:flex;gap:8px">'
        + '<button onclick="menuDishSaveEdit(' + idx + ')" class="btn-primary" style="flex:1;margin:0;padding:9px">Save</button>'
        + '<button onclick="event.stopPropagation();menuDishToggleEdit(' + idx + ')" style="background:none;border:none;color:#aaa;font-size:13px;cursor:pointer;padding:4px;font-family:inherit">Cancel</button>'
        + '</div>'
        + '</div>'
      : '';
    html += '<div onclick="menuDishToggleEdit(' + idx + ')" style="padding:8px 12px;background:#fff;border:1px solid '+(isEditing?'#1a1a18':'#e5e4de')+';border-radius:8px;margin-bottom:6px;cursor:pointer">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">'
      + '<div style="flex:1">'
      + '<div style="font-size:14px;font-weight:600;color:#1a1a18;margin-bottom:2px">' + d.dish + '</div>'
      + '<div>' + tags + '</div>'
      + '</div>'
      + '<button onclick="event.stopPropagation();menuRemoveDish(' + idx + ')" style="background:none;border:none;color:#ccc;font-size:20px;cursor:pointer;padding:0;line-height:1;flex-shrink:0">&times;</button>'
      + '</div>'
      + editForm
      + '</div>';
  });
  c.innerHTML = html;
}

function menuDishToggleEdit(idx) {
  _expandedMenuDishIdx = (_expandedMenuDishIdx === idx) ? null : idx;
  menuRenderDishes();
}

function menuDishSaveEdit(idx) {
  var nameEl = document.getElementById('mde-name-' + idx);
  var name = nameEl ? (nameEl.value || '').trim() : '';
  if (!name) { toast('Dish name required', false); return; }
  var catEl = document.getElementById('mde-cat-' + idx);
  var cat = catEl ? catEl.value : '';
  var allergens = ALLERGENS_14.filter(function(a) {
    var el = document.getElementById('mde-al-' + idx + '-' + a.replace(/\s+/g,'_'));
    return el && el.checked;
  });
  _menuDishes[idx] = { dish: name, allergens: allergens, category: cat };
  _menuDishes = _sortByMealOrder(_menuDishes);
  _expandedMenuDishIdx = null;
  menuRenderDishes();
}

function menuSave() {
  var name = (document.getElementById('menu-name').value || '').trim();
  if (!name) { toast('Enter a menu name first', false); return; }
  if (!_menuDishes.length) { toast('Add at least one dish', false); return; }
  if (!settings.savedMenus) settings.savedMenus = [];
  var _savedMenu;
  if (_editingMenuId !== null) {
    // Update existing menu
    settings.savedMenus = settings.savedMenus.map(function(m) {
      if (m.id === _editingMenuId) { _savedMenu = { id: m.id, name: name, dishes: _menuDishes.slice() }; return _savedMenu; }
      return m;
    });
    _editingMenuId = null;
    var btn = document.getElementById('menu-save-btn');
    if (btn) btn.textContent = 'Save menu';
    toast('Menu updated');
  } else {
    _savedMenu = { id: String(Date.now()), name: name, dishes: _menuDishes.slice() };
    settings.savedMenus.push(_savedMenu);
    toast('Menu "' + name + '" saved');
  }
  saveHaccpSettings();
  if (_savedMenu && window.Mise && window.Mise.sync && window.Mise.sync.saveMenu) Mise.sync.saveMenu(_savedMenu);
  document.getElementById('menu-name').value = '';
  _menuDishes = [];
  menuRenderDishes();
  renderMenuLibrary();
  custPopulateMenuSelect();
}

function menuEdit(id) {
  var menus = settings.savedMenus || [];
  var menu = null;
  menus.forEach(function(m) { if (m.id === id) menu = m; });
  if (!menu) return;
  // Load into form
  document.getElementById('menu-name').value = menu.name;
  _menuDishes = _sortByMealOrder(menu.dishes.map(function(d) { return { dish: d.dish, allergens: d.allergens.slice(), category: d.category || '' }; }));
  _expandedMenuDishIdx = null;
  menuRenderDishes();
  _editingMenuId = id;
  var btn = document.getElementById('menu-save-btn');
  if (btn) btn.textContent = 'Update menu';
  // Scroll to top of menu form
  var tab = document.getElementById('tab-job');
  if (tab) tab.scrollIntoView({ behavior: 'smooth', block: 'start' });
  toast('Editing "' + menu.name + '" — make changes and tap Update menu');
}

function menuDelete(id) {
  if (!settings.savedMenus) return;
  settings.savedMenus = settings.savedMenus.filter(function(m) { return String(m.id) !== String(id); });
  saveHaccpSettings();
  renderMenuLibrary();
  custPopulateMenuSelect();
  toast('Menu deleted');
  if (window.Mise && window.Mise.sync && window.Mise.sync.deleteMenu) {
    window.Mise.sync.deleteMenu(String(id)).catch(function(){});
  }
}

function menuAddDishAndSave() {
  var name = (document.getElementById('menu-dish-name').value || '').trim();
  if (!name) { toast('Enter a dish name first', false); return; }
  var allergens = ALLERGENS_14.filter(function(a) {
    var el = document.getElementById('mda-' + a.replace(/\s+/g,'_'));
    return el && el.checked;
  });
  var cat = (document.getElementById('menu-dish-cat').value || '').trim();
  _menuDishes.push({ dish: name, allergens: allergens, category: cat });
  _menuDishes = _sortByMealOrder(_menuDishes);
  saveDishToLibrary(name, allergens, cat);
  document.getElementById('menu-dish-name').value = '';
  document.getElementById('menu-dish-cat').value = '';
  ALLERGENS_14.forEach(function(a) {
    var el = document.getElementById('mda-' + a.replace(/\s+/g,'_'));
    if (el) el.checked = false;
  });
  menuRenderDishes();
  document.getElementById('menu-dish-name').focus();
}


// --- DISH LIBRARY ---

// --- DISH AUTOCOMPLETE ---

function dishAutofill(prefix) {
  var inputId = prefix + '-dish-name';
  var dropId  = prefix + '-dish-suggestions';
  var input = document.getElementById(inputId);
  var drop  = document.getElementById(dropId);
  if (!input || !drop) return;
  var saved = settings.savedDishes || [];
  if (!saved.length) { drop.style.display = 'none'; return; }
  var q = input.value.trim().toLowerCase();
  var matches = q
    ? saved.filter(function(d) { return d.dish.toLowerCase().indexOf(q) !== -1; })
    : saved;
  if (!matches.length) { drop.style.display = 'none'; return; }
  drop.style.display = 'block';
  drop.innerHTML = matches.map(function(d) {
    return '<div onmousedown="dishSelect(\'' + prefix + '\',' + d.id + ')" '
      + 'style="padding:10px 14px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:8px;border-bottom:1px solid #f5f4ef">'
      + '<span style="font-size:14px;font-weight:600;color:#1a1a18">' + d.dish + '</span>'
      + (d.allergens.length
          ? '<span style="font-size:11px;color:#aaa;white-space:nowrap">' + d.allergens.join(', ') + '</span>'
          : '<span style="font-size:11px;color:#ccc">No allergens</span>')
      + '</div>';
  }).join('');
}

function dishHideSuggestions(prefix) {
  var drop = document.getElementById(prefix + '-dish-suggestions');
  if (drop) drop.style.display = 'none';
}

function dishSelect(prefix, id) {
  var saved = settings.savedDishes || [];
  var dish = null;
  saved.forEach(function(d) { if (d.id === id) dish = d; });
  if (!dish) return;
  var allergenPrefix = prefix === 'menu' ? 'mda' : 'cda';
  document.getElementById(prefix + '-dish-name').value = dish.dish;
  var catEl = document.getElementById(prefix + '-dish-cat');
  if (catEl) catEl.value = dish.category || '';
  ALLERGENS_14.forEach(function(a) {
    var el = document.getElementById(allergenPrefix + '-' + a.replace(/\s+/g,'_'));
    if (el) el.checked = dish.allergens.indexOf(a) !== -1;
  });
  dishHideSuggestions(prefix);
}

function saveDishToLibrary(name, allergens, category) {
  if (!name) return false;
  if (!settings.savedDishes) settings.savedDishes = [];
  var exists = settings.savedDishes.some(function(d) { return d.dish.toLowerCase() === name.toLowerCase(); });
  if (exists) { toast('"' + name + '" is already in your dish library'); return false; }
  var _newDish = { id: Date.now(), dish: name, allergens: allergens.slice(), category: category || '' };
  settings.savedDishes.push(_newDish);
  saveHaccpSettings();
  renderDishLibrary();
  if (window.Mise && window.Mise.sync && window.Mise.sync.saveDish) Mise.sync.saveDish(_newDish);
  showNudge('dish_added');
  return true;
}

function dishDelete(id) {
  if (!settings.savedDishes) return;
  settings.savedDishes = settings.savedDishes.filter(function(d) { return d.id !== id; });
  saveHaccpSettings();
  renderDishLibrary();
  toast('Dish removed from library');
  if (window.Mise && window.Mise.sync && window.Mise.sync.deleteDish) {
    window.Mise.sync.deleteDish(id).catch(function(){});
  }
}

function renderSavedDishChips() { /* replaced by dishAutofill autocomplete */ }

var _expandedDishId = null;

function dishToggleEdit(id) {
  _expandedDishId = (_expandedDishId === id) ? null : id;
  renderDishLibrary();
  // Scroll the expanded item into view
  if (_expandedDishId) {
    setTimeout(function() {
      var el = document.getElementById('dish-edit-' + id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  }
}

function dishSaveEdit(id) {
  var nameEl = document.getElementById('dish-edit-name-' + id);
  var name = nameEl ? (nameEl.value || '').trim() : '';
  if (!name) { toast('Dish name required', false); return; }
  var allergens = ALLERGENS_14.filter(function(a) {
    var el = document.getElementById('dish-edit-al-' + id + '-' + a.replace(/\s+/g,'_'));
    return el && el.checked;
  });
  var catEl = document.getElementById('dish-edit-cat-' + id);
  var category = catEl ? catEl.value : '';
  var _updDish;
  settings.savedDishes = (settings.savedDishes || []).map(function(d) {
    if (d.id === id) { _updDish = { id: d.id, dish: name, allergens: allergens, category: category }; return _updDish; }
    return d;
  });
  saveHaccpSettings();
  if (_updDish && window.Mise && window.Mise.sync && window.Mise.sync.saveDish) Mise.sync.saveDish(_updDish);
  _expandedDishId = null;
  renderDishLibrary();
  toast('"' + name + '" updated');
}

function renderDishLibrary() {
  var c = document.getElementById('dish-library-list');
  if (!c) return;
  var dishes = settings.savedDishes || [];
  if (!dishes.length) {
    c.innerHTML = '<div class="empty">No saved dishes yet — use "+ Save &amp; add" when building a menu to grow your library.</div>';
    return;
  }
  var ORDER = DISH_CATEGORIES.filter(function(cat) { return cat !== ''; });
  var grouped = {};
  dishes.forEach(function(d) {
    var key = d.category || 'Other';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(d);
  });
  var html = '';
  var shown = {};
  ORDER.forEach(function(cat) {
    if (!grouped[cat]) return;
    shown[cat] = true;
    html += '<div style="font-size:11px;font-weight:700;color:#2D7A3A;text-transform:uppercase;letter-spacing:0.05em;padding:8px 0 4px">' + cat + '</div>';
    grouped[cat].forEach(function(d) { html += _dishCard(d); });
  });
  Object.keys(grouped).forEach(function(cat) {
    if (shown[cat]) return;
    html += '<div style="font-size:11px;font-weight:700;color:#2D7A3A;text-transform:uppercase;letter-spacing:0.05em;padding:8px 0 4px">' + cat + '</div>';
    grouped[cat].forEach(function(d) { html += _dishCard(d); });
  });
  c.innerHTML = html;
}

function _dishCard(d) {
  var isEditing = _expandedDishId === d.id;
  var catOptions = DISH_CATEGORIES.map(function(cat) {
    return '<option value="' + cat + '"' + (d.category === cat ? ' selected' : '') + '>' + (cat || 'No category') + '</option>';
  }).join('');
  var editForm = isEditing
    ? '<div id="dish-edit-' + d.id + '" style="margin-top:10px;padding-top:10px;border-top:1px solid #e5e4de">'
      + '<input id="dish-edit-name-' + d.id + '" class="form-input" type="text" value="' + d.dish.replace(/"/g,'&quot;') + '" style="margin-bottom:8px">'
      + '<select id="dish-edit-cat-' + d.id + '" class="form-input" style="margin-bottom:8px;color:#555">' + catOptions + '</select>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:10px">'
      + ALLERGENS_14.map(function(a) {
          var eid = 'dish-edit-al-' + d.id + '-' + a.replace(/\s+/g,'_');
          var chk = d.allergens.indexOf(a) !== -1 ? ' checked' : '';
          return '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#555;padding:2px 0;cursor:pointer">'
            + '<input type="checkbox" id="' + eid + '"' + chk + ' style="width:14px;height:14px;accent-color:#1a1a18"> ' + a + '</label>';
        }).join('')
      + '</div>'
      + '<div style="display:flex;gap:8px;align-items:center">'
      + '<button onclick="dishSaveEdit(' + d.id + ')" class="btn-primary" style="flex:1;margin:0;padding:9px">Save changes</button>'
      + '<button onclick="event.stopPropagation();dishToggleEdit(' + d.id + ')" style="background:none;border:none;color:#aaa;font-size:13px;cursor:pointer;padding:4px;font-family:inherit">Cancel</button>'
      + '</div>'
      + '</div>'
    : '';
  return '<div onclick="dishToggleEdit(' + d.id + ')" style="padding:10px 14px;background:#fff;border:1px solid '+(isEditing?'#1a1a18':'#e5e4de')+';border-radius:10px;margin-bottom:8px;cursor:pointer">'
    + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">'
    + '<div style="flex:1">'
    + '<div style="font-size:14px;font-weight:600;color:#1a1a18">' + d.dish + '</div>'
    + (d.allergens.length
        ? '<div style="font-size:12px;color:#888;margin-top:2px">' + d.allergens.join(', ') + '</div>'
        : '<div style="font-size:12px;color:#aaa;margin-top:2px">No allergens</div>')
    + '</div>'
    + '<button onclick="event.stopPropagation();dishDelete(' + d.id + ')" style="background:none;border:none;color:#ccc;font-size:20px;cursor:pointer;padding:0;line-height:1;flex-shrink:0">&times;</button>'
    + '</div>'
    + editForm
    + '</div>';
}

function renderMenuLibrary() {
  var c = document.getElementById('menu-library-list');
  if (!c) return;
  var menus = settings.savedMenus || [];
  if (!menus.length) {
    c.innerHTML = '<div class="empty">No menus saved yet — create your first menu above.</div>';
    return;
  }
  c.innerHTML = menus.map(function(m) {
    var allergenSet = [];
    m.dishes.forEach(function(d) {
      d.allergens.forEach(function(a) {
        if (allergenSet.indexOf(a) === -1) allergenSet.push(a);
      });
    });
    return '<div class="card" onclick="menuEdit(\'' + m.id + '\')" style="margin-bottom:10px;cursor:pointer">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">'
      + '<div style="flex:1">'
      + '<div class="card-title" style="margin-bottom:4px">' + m.name + '</div>'
      + '<div style="font-size:13px;color:#888;margin-bottom:8px">' + m.dishes.length + ' dish' + (m.dishes.length !== 1 ? 'es' : '') + (allergenSet.length ? ' · Contains: ' + allergenSet.join(', ') : ' · No allergens') + '</div>'
      + (function() {
          var sorted = _sortByMealOrder(m.dishes);
          var lastCat = null;
          return sorted.map(function(d) {
            var cat = d.category || '';
            var header = (cat && cat !== lastCat) ? '<div style="font-size:10px;font-weight:700;color:#2D7A3A;text-transform:uppercase;letter-spacing:0.05em;padding:5px 0 1px">' + cat + '</div>' : '';
            lastCat = cat;
            return header + '<div style="font-size:13px;color:#555;padding:3px 0;border-bottom:1px solid #f0f0ec">'
              + '<strong>' + d.dish + '</strong>'
              + (d.allergens.length ? ' — ' + d.allergens.join(', ') : '')
              + '</div>';
          }).join('');
        })()
      + '</div>'
      + '<button onclick="event.stopPropagation();menuDelete(\'' + m.id + '\')" style="background:none;border:none;color:#ccc;font-size:20px;cursor:pointer;padding:0;line-height:1;flex-shrink:0;margin-top:2px">&times;</button>'
      + '</div></div>';
  }).join('');
}

// --- CUSTOMER JOBS ---

var _custDishes = [];          // custom ad-hoc dishes for the current job
var _custAddedMenus = [];      // saved menus added to the current job [{id, name}]
var _editingJobIdx = null;     // records[] index of job being edited

// Returns the combined flat dish list from all added menus + custom dishes
function custGetAllDishes() {
  var all = [];
  var savedMenus = settings.savedMenus || [];
  _custAddedMenus.forEach(function(entry) {
    if (entry.id === 'custom') {
      _custDishes.forEach(function(d) { all.push(d); });
    } else {
      savedMenus.forEach(function(m) {
        if (m.id === entry.id) m.dishes.forEach(function(d) { all.push(d); });
      });
    }
  });
  return all;
}

function custEditJob(recIdx) {
  var r = records[recIdx];
  if (!r || r.type !== 'job') return;

  // Fill customer details
  var _v = function(id, val) { var el = document.getElementById(id); if (el) el.value = val || ''; };
  _v('cust-name',       r.client);
  _v('cust-address',    r.location);
  _v('cust-phone',      r.phone);
  _v('cust-email',      r.email);
  _v('cust-event-date', r.eventDate);
  _v('cust-time',       r.time);
  _v('cust-covers',     r.covers);
  _v('cust-notes',      r.notes);
  _v('cust-diet-notes', r.dietNotes);

  // Event type
  var typeEl = document.getElementById('cust-type');
  if (typeEl && r.jobType) {
    for (var i = 0; i < typeEl.options.length; i++) {
      if (typeEl.options[i].text === r.jobType) { typeEl.selectedIndex = i; break; }
    }
  }

  // Allergens
  ALLERGENS_14.forEach(function(a) {
    var el = document.getElementById('cal-' + a.replace(/\s+/g,'_'));
    if (el) el.checked = r.clientAllergens && r.clientAllergens.indexOf(a) !== -1;
  });

  // Dietary prefs
  DIETARY_PREFS.forEach(function(p) {
    var id = 'cdp-' + p.replace(/\s+/g,'_');
    var el = document.getElementById(id);
    if (el) { el.checked = r.dietaryPrefs && r.dietaryPrefs.indexOf(p) !== -1; custTogglePref(id); }
  });

  // Restore menus — prefer new r.menus array, fall back to old single-menu format
  _custAddedMenus = [];
  _custDishes = [];
  var customSection = document.getElementById('cust-custom-section');
  if (customSection) customSection.style.display = 'none';
  if (r.menus && r.menus.length) {
    // New multi-menu format
    r.menus.forEach(function(m) {
      _custAddedMenus.push({ id: m.id, name: m.name });
      if (m.id === 'custom') {
        _custDishes = m.dishes.map(function(d) { return { dish: d.dish, allergens: d.allergens.slice() }; });
        if (customSection) customSection.style.display = 'block';
      }
    });
  } else if (r.menuName === 'Custom menu' && r.menu && r.menu.length) {
    // Old custom single-menu
    _custAddedMenus.push({ id: 'custom', name: 'Custom dishes' });
    _custDishes = r.menu.map(function(d) { return { dish: d.dish, allergens: d.allergens.slice() }; });
    if (customSection) customSection.style.display = 'block';
  } else if (r.menuName) {
    // Old saved single-menu — find by name
    var savedRef = settings.savedMenus || [];
    savedRef.forEach(function(m) { if (m.name === r.menuName) _custAddedMenus.push({ id: m.id, name: m.name }); });
  }
  custRenderCustomDishes();
  custRenderAddedMenus();
  custCheckConflicts();

  // Remove the old record so it gets re-saved cleanly
  records.splice(recIdx, 1);
  saveHaccpToday();
  renderSection_PC('customers');
  updateHaccpDashboard();

  // Scroll to top of customers form
  var tab = document.getElementById('tab-customers');
  if (tab) tab.scrollIntoView({ behavior: 'smooth', block: 'start' });
  toast('Editing job for ' + r.client + ' — make changes and tap Save customer job');
}

function renderCustAllergens() {
  var c = document.getElementById('cust-allergens');
  if (!c) return;
  c.innerHTML = ALLERGENS_14.map(function(a) {
    var id = 'cal-' + a.replace(/\s+/g,'_');
    return '<label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#555;padding:4px 0;cursor:pointer">'
      + '<input type="checkbox" id="' + id + '" style="width:16px;height:16px;accent-color:#A32D2D" onchange="custCheckConflicts()"> ' + a + '</label>';
  }).join('');
}

function renderCustDietaryPrefs() {
  var c = document.getElementById('cust-dietary-prefs');
  if (!c) return;
  c.innerHTML = DIETARY_PREFS.map(function(p) {
    var id = 'cdp-' + p.replace(/\s+/g,'_');
    return '<label id="cdp-lbl-' + id + '" style="display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border:1px solid #ccc;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;color:#555;background:#fff;transition:all .1s">'
      + '<input type="checkbox" id="' + id + '" style="display:none" onchange="custTogglePref(\'' + id + '\')"> ' + p + '</label>';
  }).join('');
}

function custTogglePref(id) {
  var inp = document.getElementById(id);
  var lbl = document.getElementById('cdp-lbl-' + id);
  if (!inp || !lbl) return;
  lbl.style.background  = inp.checked ? '#1a1a18' : '#fff';
  lbl.style.color       = inp.checked ? '#fff'    : '#555';
  lbl.style.borderColor = inp.checked ? '#1a1a18' : '#ccc';
}

function renderCustDishAllergens() {
  var c = document.getElementById('cust-dish-allergens');
  if (!c) return;
  c.innerHTML = ALLERGENS_14.map(function(a) {
    var id = 'cda-' + a.replace(/\s+/g,'_');
    return '<label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#555;padding:3px 0;cursor:pointer">'
      + '<input type="checkbox" id="' + id + '" style="width:15px;height:15px;accent-color:#1a1a18"> ' + a + '</label>';
  }).join('');
}

function custGetAllergens() {
  return ALLERGENS_14.filter(function(a) {
    var el = document.getElementById('cal-' + a.replace(/\s+/g,'_'));
    return el && el.checked;
  });
}

function custPopulateMenuSelect() {
  var sel = document.getElementById('cust-menu-select');
  if (!sel) return;
  while (sel.options.length > 2) sel.remove(2);
  var menus = settings.savedMenus || [];
  menus.forEach(function(m) {
    var opt = document.createElement('option');
    opt.value = String(m.id);
    opt.textContent = m.name;
    sel.appendChild(opt);
  });
}

function custAddMenu() {
  var sel = document.getElementById('cust-menu-select');
  if (!sel || !sel.value) { toast('Choose a menu to add', false); return; }
  var val = sel.value;
  // Don't add the same menu twice
  var already = _custAddedMenus.some(function(e) { return String(e.id) === val; });
  if (already) { toast('That menu is already added', false); return; }
  if (val === 'custom') {
    _custAddedMenus.push({ id: 'custom', name: 'Custom dishes' });
    var cs = document.getElementById('cust-custom-section');
    if (cs) cs.style.display = 'block';
  } else {
    var menus = settings.savedMenus || [];
    var menu = null;
    menus.forEach(function(m) { if (String(m.id) === val) menu = m; });
    if (!menu) return;
    _custAddedMenus.push({ id: menu.id, name: menu.name });
  }
  sel.selectedIndex = 0;
  custRenderAddedMenus();
  custCheckConflicts();
}

function custRemoveAddedMenu(idx) {
  var removed = _custAddedMenus.splice(idx, 1)[0];
  if (removed && removed.id === 'custom') {
    var cs = document.getElementById('cust-custom-section');
    if (cs) cs.style.display = 'none';
    _custDishes = [];
    custRenderCustomDishes();
  }
  custRenderAddedMenus();
  custCheckConflicts();
}

function custRenderAddedMenus() {
  var c = document.getElementById('cust-added-menus');
  if (!c) return;
  if (!_custAddedMenus.length) { c.innerHTML = ''; custRenderMenuPreview(null); return; }
  var savedMenus = settings.savedMenus || [];
  c.innerHTML = _custAddedMenus.map(function(entry, idx) {
    var dishCount = '';
    if (entry.id === 'custom') {
      dishCount = _custDishes.length ? _custDishes.length + ' dish' + (_custDishes.length !== 1 ? 'es' : '') : 'no dishes yet';
    } else {
      savedMenus.forEach(function(m) {
        if (m.id === entry.id) dishCount = m.dishes.length + ' dish' + (m.dishes.length !== 1 ? 'es' : '');
      });
    }
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 12px;background:#f8f7f3;border:1px solid #e5e4de;border-radius:8px;margin-bottom:6px">'
      + '<div>'
      + '<div style="font-size:13px;font-weight:600;color:#1a1a18">' + entry.name + '</div>'
      + '<div style="font-size:12px;color:#888">' + dishCount + '</div>'
      + '</div>'
      + '<button onclick="custRemoveAddedMenu(' + idx + ')" style="background:none;border:none;color:#ccc;font-size:20px;cursor:pointer;padding:0;line-height:1">&times;</button>'
      + '</div>';
  }).join('');
  custRenderMenuPreview(custGetAllDishes());
}

function custRenderMenuPreview(dishes) {
  var c = document.getElementById('cust-menu-preview');
  if (!c) return;
  if (!dishes || !dishes.length) { c.innerHTML = ''; return; }
  var clientAl = custGetAllergens();
  c.innerHTML = '<div style="margin-top:4px">'
    + dishes.map(function(d) {
        var conflicts = clientAl.filter(function(a) { return d.allergens.indexOf(a) !== -1; });
        var hasConflict = conflicts.length > 0;
        var tags = d.allergens.length
          ? d.allergens.map(function(a) {
              var clash = clientAl.indexOf(a) !== -1;
              return '<span style="display:inline-block;padding:2px 7px;border-radius:10px;font-size:11px;font-weight:600;margin:2px 2px 0 0;background:'+(clash?'#fde8e8':'#f0f0ec')+';color:'+(clash?'#A32D2D':'#555')+'">' + a + '</span>';
            }).join('')
          : '<span style="font-size:12px;color:#aaa">No allergens</span>';
        return '<div style="padding:8px 12px;background:'+(hasConflict?'#fff8f8':'#fafaf8')+';border:1px solid '+(hasConflict?'#f5c6c6':'#e5e4de')+';border-radius:8px;margin-bottom:6px">'
          + '<div style="font-size:13px;font-weight:600;color:#1a1a18;margin-bottom:4px">' + (hasConflict ? '⚠️ ' : '') + d.dish + '</div>'
          + '<div>' + tags + '</div>'
          + (hasConflict ? '<div style="font-size:11px;color:#A32D2D;margin-top:4px;font-weight:600">Client allergen conflict: ' + conflicts.join(', ') + '</div>' : '')
          + '</div>';
      }).join('')
    + '</div>';
}

function custCheckConflicts(dishes) {
  // When called with no args (e.g. from allergen checkboxes), use the current combined dish list
  if (dishes === undefined) {
    dishes = custGetAllDishes();
    custRenderMenuPreview(dishes.length ? dishes : null);
  }
  var banner = document.getElementById('cust-conflict-banner');
  if (!banner) return;
  if (!dishes || !dishes.length) { banner.style.display = 'none'; return; }
  var clientAl = custGetAllergens();
  if (!clientAl.length) { banner.style.display = 'none'; return; }
  var conflicts = [];
  dishes.forEach(function(d) {
    d.allergens.forEach(function(a) {
      if (clientAl.indexOf(a) !== -1 && conflicts.indexOf(a) === -1) conflicts.push(a);
    });
  });
  if (conflicts.length) {
    banner.style.display = 'block';
    banner.innerHTML = '⚠️ <strong>Allergen conflict</strong> — this menu contains allergens the client must avoid: <strong>' + conflicts.join(', ') + '</strong>. Review before service.';
  } else {
    banner.style.display = 'none';
  }
}

function custAddDish() {
  var name = (document.getElementById('cust-dish-name').value || '').trim();
  if (!name) { toast('Enter a dish name first', false); return; }
  var allergens = ALLERGENS_14.filter(function(a) {
    var el = document.getElementById('cda-' + a.replace(/\s+/g,'_'));
    return el && el.checked;
  });
  var cat = (document.getElementById('cust-dish-cat').value || '').trim();
  _custDishes.push({ dish: name, allergens: allergens, category: cat });
  document.getElementById('cust-dish-name').value = '';
  document.getElementById('cust-dish-cat').value = '';
  ALLERGENS_14.forEach(function(a) {
    var el = document.getElementById('cda-' + a.replace(/\s+/g,'_'));
    if (el) el.checked = false;
  });
  custRenderCustomDishes();
  custRenderAddedMenus();
  custCheckConflicts();
  document.getElementById('cust-dish-name').focus();
}

function custAddDishAndSave() {
  var name = (document.getElementById('cust-dish-name').value || '').trim();
  if (!name) { toast('Enter a dish name first', false); return; }
  var allergens = ALLERGENS_14.filter(function(a) {
    var el = document.getElementById('cda-' + a.replace(/\s+/g,'_'));
    return el && el.checked;
  });
  var cat = (document.getElementById('cust-dish-cat').value || '').trim();
  _custDishes.push({ dish: name, allergens: allergens, category: cat });
  saveDishToLibrary(name, allergens, cat);
  document.getElementById('cust-dish-name').value = '';
  document.getElementById('cust-dish-cat').value = '';
  ALLERGENS_14.forEach(function(a) {
    var el = document.getElementById('cda-' + a.replace(/\s+/g,'_'));
    if (el) el.checked = false;
  });
  custRenderCustomDishes();
  custRenderAddedMenus();
  custCheckConflicts();
  document.getElementById('cust-dish-name').focus();
}


function custRemoveDish(idx) {
  _custDishes.splice(idx, 1);
  custRenderCustomDishes();
  custRenderAddedMenus();
  custCheckConflicts();
}

function custRenderCustomDishes() {
  var c = document.getElementById('cust-dishes-list');
  if (!c) return;
  if (!_custDishes.length) {
    c.innerHTML = '<div style="font-size:13px;color:#aaa;text-align:center;padding:8px 0">No dishes added yet</div>';
    return;
  }
  c.innerHTML = _custDishes.map(function(d, idx) {
    var tags = d.allergens.length
      ? d.allergens.map(function(a) {
          return '<span style="display:inline-block;padding:2px 7px;border-radius:10px;font-size:11px;font-weight:600;margin:2px 2px 0 0;background:#f0f0ec;color:#555">' + a + '</span>';
        }).join('')
      : '<span style="font-size:12px;color:#aaa">No allergens</span>';
    return '<div style="padding:8px 12px;background:#fff;border:1px solid #e5e4de;border-radius:8px;margin-bottom:6px">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">'
      + '<div style="flex:1">'
      + '<div style="font-size:14px;font-weight:600;color:#1a1a18;margin-bottom:4px">' + d.dish + '</div>'
      + '<div>' + tags + '</div>'
      + '</div>'
      + '<button onclick="custRemoveDish(' + idx + ')" style="background:none;border:none;color:#ccc;font-size:20px;cursor:pointer;padding:0;line-height:1;flex-shrink:0">&times;</button>'
      + '</div></div>';
  }).join('');
}

// --- PC LOG FUNCTIONS ---
function logCustomerJob() {
  var client    = (document.getElementById('cust-name').value    || '').trim();
  var address   = (document.getElementById('cust-address').value || '').trim();
  var phone     = (document.getElementById('cust-phone').value   || '').trim();
  var email     = (document.getElementById('cust-email').value   || '').trim();
  var type      =  document.getElementById('cust-type').value;
  var eventDate =  document.getElementById('cust-event-date').value;
  var time      =  document.getElementById('cust-time').value || now();
  var covers    =  document.getElementById('cust-covers').value;
  var notes     =  document.getElementById('cust-notes').value;
  var dietNotes =  document.getElementById('cust-diet-notes').value;

  if (!client) { toast('Please enter a client name', false); return; }

  var clientAllergens = custGetAllergens();
  var dietaryPrefs = DIETARY_PREFS.filter(function(p) {
    var el = document.getElementById('cdp-' + p.replace(/\s+/g,'_'));
    return el && el.checked;
  });

  // Build menus array from added menus
  var savedMenusRef = settings.savedMenus || [];
  var menusToSave = _custAddedMenus.map(function(entry) {
    if (entry.id === 'custom') {
      return { id: 'custom', name: 'Custom dishes', dishes: _custDishes.slice() };
    }
    var found = null;
    savedMenusRef.forEach(function(m) { if (m.id === entry.id) found = m; });
    return found ? { id: found.id, name: found.name, dishes: found.dishes.slice() } : null;
  }).filter(Boolean);

  var allDishes = custGetAllDishes();
  var menuNamesStr = menusToSave.map(function(m) { return m.name; }).join(', ');

  var conflicts = [];
  allDishes.forEach(function(d) {
    d.allergens.forEach(function(a) {
      if (clientAllergens.indexOf(a) !== -1 && conflicts.indexOf(a) === -1) conflicts.push(a);
    });
  });

  var status = conflicts.length ? 'warn' : 'ok';
  var msg = type + (covers ? ' · ' + covers + ' covers' : '') + (menuNamesStr ? ' · ' + menuNamesStr : '');
  if (conflicts.length) msg += ' · ⚠️ ' + conflicts.length + ' allergen conflict' + (conflicts.length > 1 ? 's' : '');

  _pushRecord({
    type: 'job', client: client, location: address, phone: phone, email: email,
    jobType: type, covers: covers, time: time, eventDate: eventDate,
    notes: notes, dietNotes: dietNotes,
    clientAllergens: clientAllergens, dietaryPrefs: dietaryPrefs,
    menus: menusToSave,
    // legacy fields for backward compat with old records display
    menuName: menuNamesStr, menu: allDishes,
    conflicts: conflicts, status: status, msg: msg
  });
  saveHaccpToday();

  ['cust-name','cust-address','cust-phone','cust-email','cust-covers','cust-notes',
   'cust-diet-notes','cust-event-date','cust-time'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('cust-type').selectedIndex = 0;
  ALLERGENS_14.forEach(function(a) {
    var el = document.getElementById('cal-' + a.replace(/\s+/g,'_')); if (el) el.checked = false;
  });
  DIETARY_PREFS.forEach(function(p) {
    var el = document.getElementById('cdp-' + p.replace(/\s+/g,'_'));
    if (el) { el.checked = false; custTogglePref('cdp-' + p.replace(/\s+/g,'_')); }
  });
  _custDishes = [];
  _custAddedMenus = [];
  var sel = document.getElementById('cust-menu-select');
  if (sel) sel.selectedIndex = 0;
  var customSection = document.getElementById('cust-custom-section');
  if (customSection) customSection.style.display = 'none';
  var addedMenusEl = document.getElementById('cust-added-menus');
  if (addedMenusEl) addedMenusEl.innerHTML = '';
  var preview = document.getElementById('cust-menu-preview');
  if (preview) preview.innerHTML = '';
  var banner = document.getElementById('cust-conflict-banner');
  if (banner) banner.style.display = 'none';

  renderSection_PC('customers');
  updateHaccpDashboard();
  toast(conflicts.length
    ? '⚠️ Saved — ' + conflicts.length + ' allergen conflict' + (conflicts.length > 1 ? 's' : '')
    : 'Saved — job logged for ' + client,
    conflicts.length ? 'warn' : true);
}

function previewKaPhoto(input) {
  if(!input.files||!input.files[0])return;
  var reader=new FileReader();
  reader.onload=function(e){ document.getElementById('ka-photo-img').src=e.target.result; document.getElementById('ka-photo-preview').style.display='block'; };
  reader.readAsDataURL(input.files[0]);
}
function clearKaPhoto() { document.getElementById('ka-photo').value=''; document.getElementById('ka-photo-img').src=''; document.getElementById('ka-photo-preview').style.display='none'; }

function logKitchenAssess() {
  var client = document.getElementById('ka-client').value.trim();
  var fridgeTemp = parseFloat(document.getElementById('ka-fridge-temp').value);
  var condition = document.getElementById('ka-condition').value;
  var notes = document.getElementById('ka-notes').value;
  var photoImg = document.getElementById('ka-photo-img');
  var photo = photoImg.src && photoImg.src !== window.location.href ? photoImg.src : '';
  var items = settings['checklist_pc_kitchenassess'] || DEFAULT_CHECKLISTS_PC.kitchenassess.map(function(i,idx){return {id:'k'+idx,label:i.label,note:i.note};});
  var checked=[]; var unchecked=[];
  items.forEach(function(item){ var el=document.getElementById('chk-'+item.id); if(el&&el.checked)checked.push(item.label); else unchecked.push(item.label); });
  var fridgeFail = !isNaN(fridgeTemp) && fridgeTemp > T('fridge-fail');
  var fridgeWarn = !isNaN(fridgeTemp) && fridgeTemp > T('fridge-warn');
  var status = condition.indexOf('Unsuitable')===0||fridgeFail?'fail': (condition.indexOf('Minor')===0||condition.indexOf('Significant')===0||fridgeWarn||unchecked.length>0)?'warn':'ok';
  var msg = condition.split(' —')[0] + (!isNaN(fridgeTemp)?' · Fridge: '+fridgeTemp+'°C':'');
  _pushRecord({type:'kitchenassess', client:client, fridgeTemp:fridgeTemp, condition:condition, notes:notes, photo:photo, checked:checked, unchecked:unchecked, time:now(), status:status, msg:msg});
  saveHaccpToday();
  document.getElementById('ka-client').value=''; document.getElementById('ka-fridge-temp').value=''; document.getElementById('ka-notes').value=''; clearKaPhoto();
  items.forEach(function(item){ var el=document.getElementById('chk-'+item.id); if(el) el.checked=false; });
  renderSection_PC('kitchenassess'); updateHaccpDashboard();
  if(status==='ok')toast('Saved — kitchen assessment complete'); else if(status==='warn')toast('Warning — issues noted','warn'); else toast('Alert — kitchen unsuitable',false);
}

function logHaccpAllergen() {
  var client = document.getElementById('al-client').value.trim();
  var dish = document.getElementById('al-dish').value.trim();
  var confirmed = document.getElementById('al-confirmed').value;
  var notes = document.getElementById('al-notes').value;
  if (!dish) { toast('Please enter a dish name', false); return; }
  var present = ALLERGENS_14.filter(function(a){ var el=document.getElementById('al-'+a.replace(/\s/g,'_')); return el&&el.checked; });
  var status = present.length > 0 ? 'warn' : 'ok';
  var msg = present.length > 0 ? present.length+' allergen'+(present.length>1?'s':'')+' — '+confirmed.split(' —')[0] : 'No allergens — '+confirmed.split(' —')[0];
  var rec = {type:'allergen', client:client, dish:dish, allergens:present, confirmed:confirmed, notes:notes, time:now(), status:status, msg:msg};
  if (_editingAllergenIdx !== null) {
    rec.time = records[_editingAllergenIdx].time;
    records[_editingAllergenIdx] = rec;
    _editingAllergenIdx = null;
    var btn = document.getElementById('al-save-btn');
    if (btn) btn.textContent = 'Save allergen record';
  } else {
    _pushRecord(rec);
  }
  saveHaccpToday();
  document.getElementById('al-client').value=''; document.getElementById('al-dish').value=''; document.getElementById('al-notes').value='';
  ALLERGENS_14.forEach(function(a){ var el=document.getElementById('al-'+a.replace(/\s/g,'_')); if(el) el.checked=false; });
  renderSection_PC('allergen'); renderAllergenGuests(); updateHaccpDashboard();
  if (!_checkImmediateConflict(dish, present)) toast('Saved — allergen record for '+dish);
}

function editHaccpAllergen(recIdx) {
  var r = records[recIdx];
  if (!r || r.type !== 'allergen') return;
  _editingAllergenIdx = recIdx;
  document.getElementById('al-client').value = r.client || '';
  document.getElementById('al-dish').value = r.dish || '';
  document.getElementById('al-notes').value = r.notes || '';
  document.getElementById('al-confirmed').value = r.confirmed || 'Yes — verbally confirmed';
  ALLERGENS_14.forEach(function(a){ var el=document.getElementById('al-'+a.replace(/\s/g,'_')); if(el) el.checked=(r.allergens||[]).indexOf(a)!==-1; });
  var btn = document.getElementById('al-save-btn');
  if (btn) btn.textContent = 'Update allergen record';
  window.scrollTo(0, 0);
}

function deleteHaccpAllergen(recIdx) {
  if (!confirm('Delete this allergen record?')) return;
  records.splice(recIdx, 1);
  if (_editingAllergenIdx === recIdx) { _editingAllergenIdx = null; var btn=document.getElementById('al-save-btn'); if(btn) btn.textContent='Save allergen record'; }
  saveHaccpToday();
  renderSection_PC('allergen'); renderAllergenGuests(); updateHaccpDashboard();
}

function renderGuestAllergenChecks() {
  var c = document.getElementById('ga-allergen-checks');
  if (!c) return;
  c.innerHTML = ALLERGENS_14.map(function(a){
    var id = 'ga-' + a.replace(/\s/g,'_');
    return '<label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#555;padding:4px 0;cursor:pointer">'+
      '<input type="checkbox" id="'+id+'" style="width:16px;height:16px;accent-color:#c0392b"> '+a+'</label>';
  }).join('');
}

function addAllergenGuest() {
  var nameEl = document.getElementById('ga-name');
  if (!nameEl) return;
  var name = nameEl.value.trim();
  if (!name) { toast('Please enter a guest name', false); return; }
  var allergens = ALLERGENS_14.filter(function(a){ var el=document.getElementById('ga-'+a.replace(/\s/g,'_')); return el&&el.checked; });
  if (!settings.allergenGuests) settings.allergenGuests = [];
  settings.allergenGuests.push({id:'g'+Date.now(), name:name, allergens:allergens});
  saveHaccpSettings();
  nameEl.value = '';
  ALLERGENS_14.forEach(function(a){ var el=document.getElementById('ga-'+a.replace(/\s/g,'_')); if(el) el.checked=false; });
  renderAllergenGuests();
  var dishAllergens = {};
  records.filter(function(r){ return r.type==='allergen'; }).forEach(function(r){
    (r.allergens||[]).forEach(function(a){ if(!dishAllergens[a]) dishAllergens[a]=[]; dishAllergens[a].push(r.dish); });
  });
  var hits = allergens.filter(function(a){ return dishAllergens[a]; });
  if (hits.length) {
    toast('⚠ ALLERGEN CONFLICT — '+name+': '+hits.map(function(a){ return a+' (in: '+dishAllergens[a].join(', ')+')'; }).join('; '), false);
  } else {
    toast('Guest added — '+name);
  }
}

function deleteAllergenGuest(id) {
  if (!settings.allergenGuests) return;
  settings.allergenGuests = settings.allergenGuests.filter(function(g){ return g.id !== id; });
  saveHaccpSettings();
  renderAllergenGuests();
}

function renderAllergenGuests() {
  try {
    var c = document.getElementById('guest-allergen-list');
    var banner = document.getElementById('allergen-conflict-banner');
    if (!c) return;
    var globalGuests = settings.allergenGuests || [];
    var jobGuests = _haccpActiveJob ? (_haccpActiveJob.guests || []) : [];
    if (!globalGuests.length && !jobGuests.length) {
      c.innerHTML = '<div class="empty" style="padding:10px 0">No guests added yet.</div>';
      if (banner) { banner.style.display = 'none'; banner.innerHTML = ''; }
      return;
    }
    // Build dish allergen map: allergen log records + active job menu dishes
    var dishAllergens = {};
    records.filter(function(r){ return r.type==='allergen'; }).forEach(function(r){
      (r.allergens||[]).forEach(function(a){ if(!dishAllergens[a]) dishAllergens[a]=[]; dishAllergens[a].push(r.dish); });
    });
    var jobDishMap = _getJobDishAllergenMap();
    Object.keys(jobDishMap).forEach(function(a){
      if(!dishAllergens[a]) dishAllergens[a]=[];
      jobDishMap[a].forEach(function(d){ if(dishAllergens[a].indexOf(d)===-1) dishAllergens[a].push(d); });
    });
    var allConflictLines = [];
    function _guestCard(g, deletable) {
      var conflicts = (g.allergens||[]).filter(function(a){ return dishAllergens[a]; });
      var conflictHtml = '';
      if (conflicts.length) {
        var detail = conflicts.map(function(a){ return a+' (in: '+dishAllergens[a].join(', ')+')'; }).join('; ');
        allConflictLines.push(esc(g.name)+' — '+detail);
        var conflictRows = conflicts.map(function(a){
          return '<div><strong>'+esc(a)+'</strong> — in: '+dishAllergens[a].map(function(d){return esc(d);}).join(', ')+'</div>';
        }).join('');
        conflictHtml = '<div style="background:#fde8e8;border:1px solid #f5c6c6;border-radius:6px;padding:8px 12px;margin-top:8px;font-size:13px;color:#A32D2D">'
          +'<div style="font-weight:700;margin-bottom:4px">⚠ Allergen conflict</div>'
          +conflictRows
          +'<div style="margin-top:6px;font-size:12px;font-weight:400">Confirm a safe alternative is served or remove the dish from the menu.</div>'
          +'<button type="button" onclick="event.stopPropagation();document.getElementById(\'allergen-log\').scrollIntoView({behavior:\'smooth\'})" style="margin-top:8px;background:#fff;border:1px solid #A32D2D;color:#A32D2D;border-radius:5px;padding:5px 12px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">View allergen log ↑</button>'
          +'</div>';
      }
      var allergenTags = (g.allergens||[]).length
        ? (g.allergens||[]).map(function(a){ return '<span style="background:'+(conflicts.indexOf(a)!==-1?'#fde8e8':'#f5f4f0')+';border:1px solid '+(conflicts.indexOf(a)!==-1?'#f5c6c6':'#ccc')+';border-radius:4px;padding:1px 6px;font-size:12px;color:'+(conflicts.indexOf(a)!==-1?'#A32D2D':'#555')+'">'+a+'</span>'; }).join(' ')
        : '<span style="font-size:12px;color:#888">No specific allergens recorded</span>';
      var removeBtn = deletable
        ? '<button onclick="deleteAllergenGuest(\''+g.id+'\')" aria-label="Remove guest" style="background:none;border:none;color:#999;font-size:16px;cursor:pointer;padding:0;line-height:1;min-width:44px;min-height:44px;display:inline-flex;align-items:center;justify-content:center">×</button>'
        : '';
      return '<div style="background:#fff;border:1px solid '+(conflicts.length?'#f5c6c6':'#e0ddd6')+';border-radius:8px;padding:10px 12px;margin-bottom:8px">'
        +'<div style="display:flex;justify-content:space-between;align-items:center">'
        +'<div style="font-weight:600;font-size:14px">'+esc(g.name)+'</div>'
        +removeBtn
        +'</div>'
        +'<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">'+allergenTags+'</div>'
        +conflictHtml
        +'</div>';
    }
    var html = '';
    if (jobGuests.length) {
      html += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#2D7A3A;letter-spacing:0.05em;margin-bottom:6px">Today\'s job — '+esc(_haccpActiveJob.client)+'</div>';
      html += jobGuests.map(function(g){ return _guestCard(g, false); }).join('');
      if (globalGuests.length) html += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#A09890;letter-spacing:0.05em;margin:10px 0 6px">Saved guests</div>';
    }
    html += globalGuests.map(function(g){ return _guestCard(g, true); }).join('');
    c.innerHTML = html;
    _renderAllergenConflictBanners(allConflictLines);
  } catch(e) { console.error('[Veriqo] renderAllergenGuests error:', e); }
}

function _renderAllergenConflictBanners(conflictLines) {
  var defs = [
    { id: 'allergen-conflict-banner',
      cta: '<button type="button" onclick="event.stopPropagation();document.getElementById(\'guest-allergen-list\').scrollIntoView({behavior:\'smooth\'})" style="background:#fff;border:1px solid #A32D2D;color:#A32D2D;border-radius:5px;padding:5px 12px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;flex-shrink:0">Review guests ↓</button>'
    },
    { id: 'allergen-conflict-banner-home',
      cta: '<button type="button" onclick="event.stopPropagation();haccpTab(\'allergen\')" style="background:#fff;border:1px solid #A32D2D;color:#A32D2D;border-radius:5px;padding:5px 12px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;flex-shrink:0">View allergen log →</button>'
    }
  ];
  defs.forEach(function(def) {
    var banner = document.getElementById(def.id);
    if (!banner) return;
    if (conflictLines && conflictLines.length) {
      var n = conflictLines.length;
      var summary = n === 1 ? '1 guest has an allergen conflict' : n + ' guests have allergen conflicts';
      var detailHtml = conflictLines.map(function(line){
        return '<div style="margin-top:4px;font-weight:400;font-size:13px">'+line+'</div>';
      }).join('');
      banner.style.display = 'block';
      banner.style.cursor = 'pointer';
      banner.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">'
        +'<span>⚠ ALLERGEN CONFLICT — '+summary+'</span>'
        +'<div style="display:flex;gap:8px;align-items:center;flex-shrink:0">'
        +'<span class="acb-toggle" style="font-size:11px;font-weight:400;text-decoration:underline">Show details</span>'
        +def.cta
        +'</div>'
        +'</div>'
        +'<div class="acb-detail" style="display:none">'+detailHtml+'</div>';
      banner.onclick = function(e) {
        if (e.target.tagName === 'BUTTON') return;
        var detail = this.querySelector('.acb-detail');
        var toggle = this.querySelector('.acb-toggle');
        if (!detail) return;
        var open = detail.style.display !== 'none';
        detail.style.display = open ? 'none' : 'block';
        if (toggle) toggle.textContent = open ? 'Show details' : 'Hide details';
      };
    } else {
      banner.style.display = 'none';
      banner.innerHTML = '';
      banner.onclick = null;
    }
  });
}

var _editingAllergenIdx = null;

var _trType = 'cold';

function trSetType(type) {
  _trType = type;
  ['cold','hot','frozen','both'].forEach(function(t){
    var btn = document.getElementById('tr-type-'+t);
    if(btn) btn.classList.toggle('na-btn-active', t===type);
  });
  var showCold = (type==='cold'||type==='both'||type==='frozen');
  var showHot  = (type==='hot'||type==='both');
  var coldDiv = document.getElementById('tr-cold-fields');
  var hotDiv  = document.getElementById('tr-hot-fields');
  var frozenDiv = document.getElementById('tr-frozen-fields');
  if(coldDiv) coldDiv.style.display = showCold ? '' : 'none';
  if(hotDiv)  hotDiv.style.display  = showHot  ? '' : 'none';
  if(frozenDiv) frozenDiv.style.display = (type==='frozen') ? '' : 'none';
  // update cold-field labels
  if(coldDiv && type==='frozen') {
    var lbls = coldDiv.querySelectorAll('label');
    if(lbls[0]) lbls[0].textContent = 'Frozen temp at departure (°C)';
    if(lbls[1]) lbls[1].textContent = 'Frozen temp on arrival (°C)';
  } else if(coldDiv) {
    var lbls = coldDiv.querySelectorAll('label');
    if(lbls[0]) lbls[0].textContent = 'Cold temp at departure (°C)';
    if(lbls[1]) lbls[1].textContent = 'Cold temp on arrival (°C)';
  }
}

function _haccpLogTransport() {
  var food = document.getElementById('tr-food').value.trim();
  var dest = document.getElementById('tr-destination').value.trim();
  var startTime = document.getElementById('tr-start-time').value;
  var endTime = document.getElementById('tr-end-time').value;
  var method = document.getElementById('tr-method').value;
  var by = document.getElementById('tr-by').value;
  if (!food) { toast('Please enter a food item', false); return; }
  var type = _trType || 'cold';
  var status='ok', msgs=[], startTemp, endTemp, hotStart, hotEnd;

  if(type==='cold'||type==='both') {
    startTemp = parseFloat(document.getElementById('tr-start-temp').value);
    endTemp   = parseFloat(document.getElementById('tr-end-temp').value);
    if(isNaN(endTemp)){toast('Please enter the cold arrival temperature',false);return;}
    if(endTemp > T('fridge-fail')){status='fail';msgs.push('Cold arrived at '+endTemp+'°C — must be below '+T('fridge-fail')+'°C (UK legal limit)');}
    else if(endTemp > T('fridge-warn')){if(status!=='fail')status='warn';msgs.push('Cold arrived at '+endTemp+'°C — borderline, monitor closely');}
    else{msgs.push('Cold arrived safely at '+endTemp+'°C');}
  }

  if(type==='frozen') {
    startTemp = parseFloat(document.getElementById('tr-start-temp').value);
    endTemp   = parseFloat(document.getElementById('tr-end-temp').value);
    if(isNaN(endTemp)){toast('Please enter the frozen food arrival temperature',false);return;}
    // EC 37/2005: -18°C storage, +3°C transit tolerance permitted (so -15°C is the fail threshold in transit)
    if(endTemp > -15){status='fail';msgs.push('Frozen arrived at '+endTemp+'°C — must be -15°C or below in transit (EC 37/2005)');}
    else if(endTemp > -18){if(status!=='fail')status='warn';msgs.push('Frozen arrived at '+endTemp+'°C — approaching -18°C legal storage limit');}
    else{msgs.push('Frozen arrived safely at '+endTemp+'°C');}
  }

  if(type==='hot'||type==='both') {
    hotStart = parseFloat(document.getElementById('tr-hot-start-temp').value);
    hotEnd   = parseFloat(document.getElementById('tr-hot-end-temp').value);
    if(isNaN(hotEnd)){toast('Please enter the hot food arrival temperature',false);return;}
    // UK Food Safety (Temperature Control) Regulations: hot food must be held at 63°C or above
    if(hotEnd < 63){status='fail';msgs.push('Hot arrived at '+hotEnd+'°C — must be 63°C or above (UK law)');}
    else if(hotEnd < 70){if(status!=='fail')status='warn';msgs.push('Hot arrived at '+hotEnd+'°C — approaching minimum (63°C)');}
    else{msgs.push('Hot arrived safely at '+hotEnd+'°C');}
  }

  var msg = msgs.join(' | ');
  _pushRecord({type:'transport', foodType:type, food:food, destination:dest, startTemp:startTemp, startTime:startTime, endTemp:(type==='hot'?hotEnd:endTemp), endTime:endTime, method:method, by:by, time:startTime, status:status, msg:msg});
  saveHaccpToday();
  document.getElementById('tr-food').value=''; document.getElementById('tr-destination').value='';
  var st = document.getElementById('tr-start-temp'); if(st) st.value='';
  var et = document.getElementById('tr-end-temp'); if(et) et.value='';
  var hs = document.getElementById('tr-hot-start-temp'); if(hs) hs.value='';
  var he = document.getElementById('tr-hot-end-temp'); if(he) he.value='';
  document.getElementById('tr-start-time').value=now(); document.getElementById('tr-end-time').value=now();
  renderSection_PC('transport');
  updateHaccpDashboard();
  var _trCount = records.filter(function(r){return r.type==='transport';}).length;
  if(status==='ok')toast('Saved — '+food+' ('+_trCount+' transport logged)'); else if(status==='warn')toast('Warning — '+food+': '+msg,'warn'); else toast('Alert — '+food+': '+msg,false);
}
function haccpLogTransport(){_haccpLogTransport();}

function logCredential() {
  var type = document.getElementById('cred-type').value;
  var issued = document.getElementById('cred-issued').value;
  var expiry = document.getElementById('cred-expiry').value;
  var issuer = document.getElementById('cred-issuer').value.trim();
  var ref = document.getElementById('cred-ref').value.trim();
  if (!expiry) { toast('Please enter an expiry date', false); return; }
  var daysLeft = Math.floor((new Date(expiry) - new Date()) / (1000*60*60*24));
  var status = daysLeft < 0 ? 'fail' : daysLeft < 30 ? 'warn' : 'ok';
  var msg = daysLeft < 0 ? 'Expired '+Math.abs(daysLeft)+' days ago' : daysLeft < 30 ? 'Expires in '+daysLeft+' days' : 'Valid — expires '+new Date(expiry).toLocaleDateString('en-GB');
  var photoImg = document.getElementById('cred-photo-img');
  var photo = photoImg.src && photoImg.src !== window.location.href ? photoImg.src : '';
  var stored = loadCredentials();
  stored.push({credType:type, issued:issued, expiry:expiry, issuer:issuer, ref:ref, photo:photo, status:status, msg:msg, saved:todayStr()});
  saveCredentials(stored);
  document.getElementById('cred-issued').value=''; document.getElementById('cred-expiry').value='';
  document.getElementById('cred-issuer').value=''; document.getElementById('cred-ref').value='';
  clearCredPhoto();
  renderCredentials(); updateHaccpDashboard();
  if(status==='ok')toast('Saved — '+type); else if(status==='warn')toast('Warning — '+type+' expiring soon','warn'); else toast('Alert — '+type+' has expired',false);
}

function previewCredPhoto(input) {
  if (!input.files || !input.files[0]) return;
  var reader = new FileReader();
  reader.onload = function(e) { document.getElementById('cred-photo-img').src = e.target.result; document.getElementById('cred-photo-preview').style.display = 'block'; };
  reader.readAsDataURL(input.files[0]);
}
function clearCredPhoto() { document.getElementById('cred-photo').value=''; document.getElementById('cred-photo-img').src=''; document.getElementById('cred-photo-preview').style.display='none'; }
function saveCredentials(list) {
  try { localStorage.setItem('haccp_credentials', JSON.stringify(list)); } catch(e){}
  settings.credentials = list;
  saveHaccpSettings();
}
function loadCredentials() {
  var local = [];
  try { var r=localStorage.getItem('haccp_credentials'); local = r?JSON.parse(r):[]; } catch(e){ local = []; }
  var cloud = settings.credentials || [];
  var merged = local.slice();
  cloud.forEach(function(c){
    var name = c.name || c.credType || '';
    var expiry = c.expiry || '';
    var exists = merged.some(function(e){ return (e.name || e.credType || '') === name && (e.expiry || '') === expiry; });
    if(!exists) merged.push(Object.assign({}, c, { credType: c.credType || c.name || 'Credential' }));
  });
  if(merged.length !== local.length) {
    try { localStorage.setItem('haccp_credentials', JSON.stringify(merged)); } catch(e){}
  }
  return merged;
}

function renderCredentials() {
  var list = loadCredentials();
  var c = document.getElementById('credentials-log');
  if (!list.length) { c.innerHTML='<div class="empty">No credentials saved yet — add your food hygiene certificates, insurance and qualifications so you can track expiry dates.</div>'; return; }
  // recalculate status live
  list.forEach(function(cr) {
    var daysLeft = Math.floor((new Date(cr.expiry) - new Date()) / (1000*60*60*24));
    cr.status = daysLeft < 0 ? 'fail' : daysLeft < 30 ? 'warn' : 'ok';
    cr.msg = daysLeft < 0 ? 'Expired '+Math.abs(daysLeft)+' days ago' : daysLeft < 30 ? 'Expires in '+daysLeft+' days' : 'Valid — expires '+new Date(cr.expiry).toLocaleDateString('en-GB');
  });
  c.innerHTML = list.map(function(cr, i) {
    var photoHtml = cr.photo ? '<div style="margin-top:6px"><img src="'+cr.photo+'" style="width:72px;height:54px;object-fit:cover;border-radius:6px;border:1px solid #e5e4de;cursor:pointer" onclick="viewPhoto(this.src)"/></div>' : '';
    return '<div class="log-row" style="align-items:flex-start"><div style="flex:1">'+
      '<div class="log-name">'+cr.credType+'</div>'+
      '<div class="log-time">'+cr.msg+'</div>'+
      (cr.issuer?'<div class="log-time">'+cr.issuer+(cr.ref?' · '+cr.ref:'')+'</div>':'')+
      photoHtml+
    '</div>'+statusBadge(cr.status)+
    '<button onclick="removeCredential('+i+')" style="background:none;border:none;color:#A32D2D;font-size:16px;cursor:pointer;padding:4px 0 4px 8px">&times;</button></div>';
  }).join('');
  // update credentials badge on home
  var badge = document.getElementById('badge-credentials');
  var sub = document.getElementById('sub-credentials');
  if (badge && sub) {
    var expiring = list.filter(function(cr){ return cr.status !== 'ok'; }).length;
    badge.className = 'tile-badge ' + (expiring > 0 ? (list.some(function(cr){return cr.status==='fail';}) ? 'fail' : 'warn') : 'ok');
    badge.textContent = list.length;
    sub.textContent = expiring > 0 ? expiring+' expiring / expired' : list.length+' credential'+(list.length>1?'s':'')+' — all valid';
  }
}

function removeCredential(i) {
  var list = loadCredentials(); list.splice(i,1); saveCredentials(list); renderCredentials(); toast('Credential removed');
}

// --- PC RENDER ---
function renderSection_PC(type) {
  if (type === 'credentials') { renderCredentials(); return; }
  // 'customers' tab renders job-type records into #job-log
  var renderType = (type === 'customers') ? 'job' : type;
  var ids = {job:'job-log', customers:'job-log', kitchenassess:'kitchenassess-log', allergen:'allergen-log', transport:'transport-log', mobileset:'mobileset-log', incident:'incident-log'};
  var c = document.getElementById(ids[type]); if (!c) return;
  var recs = records.filter(function(r){ return r.type===renderType; });
  if (!recs.length) { c.innerHTML='<div class="empty">'+(type==='customers'?'No customer jobs logged yet today.':'No records logged yet today.')+'</div>'; return; }
  c.innerHTML = recs.slice().reverse().map(function(r) {
    var recIdx = records.indexOf(r);
    var label = r.type==='job'?r.client : r.type==='kitchenassess'?r.client : r.type==='allergen'?r.dish : r.type==='transport'?r.food : r.type==='incident'?r.incidentType : r.by||'';
    var extra = '';
    if (r.type==='allergen' && r.allergens && r.allergens.length) extra += '<div class="log-time">'+r.allergens.join(', ')+'</div>';
    if (r.type==='allergen') extra += '<div style="display:flex;gap:6px;margin-top:6px"><button onclick="event.stopPropagation();editHaccpAllergen('+recIdx+')" aria-label="Edit allergen record" style="padding:8px 14px;font-size:12px;background:#f5f4f0;border:1px solid #ccc;border-radius:5px;cursor:pointer;font-family:inherit">Edit</button><button onclick="event.stopPropagation();deleteHaccpAllergen('+recIdx+')" aria-label="Delete allergen record" style="padding:8px 14px;font-size:12px;background:#fde8e8;border:1px solid #f5c6c6;border-radius:5px;color:#A32D2D;cursor:pointer;font-family:inherit">Delete</button></div>';
    if (r.type==='transport') extra += '<div class="log-time">'+r.startTemp+'°C at '+r.startTime+' → '+r.endTemp+'°C at '+r.endTime+'</div>';
    if (r.type==='incident') {
      extra += '<div class="log-time">Severity: '+r.severity+'</div>';
      if (r.incidentTime) extra += '<div class="log-time">🕐 Occurred: '+r.incidentTime.replace('T',' ')+'</div>';
      if (r.location) extra += '<div class="log-time">📍 '+(r.location.text||'')+(r.location.accuracy?' (±'+r.location.accuracy+'m accuracy)':'')+'</div>';
      if (r.description) extra += '<div class="log-time">'+r.description+'</div>';
      if (r.action) extra += '<div class="log-time" style="color:#2D7A3A">✓ Action: '+r.action+'</div>';
      var photos = r.photos && r.photos.length ? r.photos : (r.photo ? [r.photo] : []);
      if (photos.length) extra += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">'+photos.map(function(src){ return '<img src="'+src+'" style="width:72px;height:54px;object-fit:cover;border-radius:6px;border:1px solid #e5e4de;cursor:pointer" onclick="event.stopPropagation();viewPhoto(this.src)"/>'; }).join('')+'</div>';
    }
    if (r.type==='job') {
      if (r.location)   extra += '<div class="log-time">📍 '+r.location+'</div>';
      if (r.eventDate)  extra += '<div class="log-time">📅 '+new Date(r.eventDate).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})+'</div>';
      if (r.menus && r.menus.length) {
        r.menus.forEach(function(m) {
          extra += '<div class="log-time">🍽 ' + m.name + ' (' + m.dishes.length + ' dish' + (m.dishes.length !== 1 ? 'es' : '') + ')</div>';
        });
      } else if (r.menuName) {
        extra += '<div class="log-time">🍽 ' + r.menuName + (r.menu&&r.menu.length?' ('+r.menu.length+' dish'+(r.menu.length>1?'es':'')+')'  :'') + '</div>';
      }
      if (r.dietaryPrefs&&r.dietaryPrefs.length) extra += '<div class="log-time">'+r.dietaryPrefs.join(', ')+'</div>';
      if (r.conflicts && r.conflicts.length) extra += '<div style="margin-top:4px;font-size:12px;color:#A32D2D;font-weight:600">⚠️ Allergen conflicts: '+r.conflicts.join(', ')+'</div>';
    }
    if (r.photo) extra += '<div style="margin-top:6px"><img src="'+r.photo+'" style="width:72px;height:54px;object-fit:cover;border-radius:6px;border:1px solid #e5e4de;cursor:pointer" onclick="event.stopPropagation();viewPhoto(this.src)"/></div>';
    var rowClick = (r.type === 'job') ? ' onclick="custEditJob('+recIdx+')" style="align-items:flex-start;cursor:pointer"' : ' style="align-items:flex-start"';
    return '<div class="log-row"' + rowClick + '><div style="flex:1"><div class="log-name">'+label+'</div><div class="log-time">'+r.time+' — '+r.msg+'</div>'+extra+'</div>'+statusBadge(r.status)+'</div>';
  }).join('');
}

// --- PROFILE ---

function previewProfileLogo(input) {
  if (!input.files || !input.files[0]) return;
  var file = input.files[0];
  // Resize to max 400px wide before storing — keeps Supabase row small
  var reader = new FileReader();
  reader.onload = function(e) {
    var img = new Image();
    img.onload = function() {
      var maxW = 400;
      var scale = img.width > maxW ? maxW / img.width : 1;
      var canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      var dataUrl = canvas.toDataURL('image/png', 0.85);
      document.getElementById('profile-logo-img').src = dataUrl;
      document.getElementById('profile-logo-preview').style.display = 'block';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function clearProfileLogo() {
  document.getElementById('profile-logo-img').src = '';
  document.getElementById('profile-logo-preview').style.display = 'none';
  document.getElementById('profile-logo-input').value = '';
}

// ── Subscription card in Settings ────────────────────────────────────────────
function renderSubscriptionCard() {
  var card = document.getElementById('subscription-card');
  if (!card) return;
  var profile = window.Mise && window.Mise.profile;
  if (!profile) return;

  var status   = profile.subscription_status;
  var plan     = profile.subscription_plan || null;
  var trialEnd = profile.trial_ends_at ? new Date(profile.trial_ends_at) : null;
  var inTrial  = status === 'trial' && trialEnd && trialEnd > new Date();
  var daysLeft = inTrial ? Math.ceil((trialEnd - new Date()) / (1000*60*60*24)) : 0;

  var planLabel = plan === 'suite' ? 'Veriqo + Carte Suite' : plan === 'carte' ? 'Carte' : 'Veriqo';
  var badge, body, actions;

  if (status === 'active') {
    badge   = '<span style="display:inline-block;background:#eaf7ec;color:#2D7A3A;font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px;letter-spacing:0.03em">ACTIVE</span>'
            + '<span style="display:inline-block;margin-left:6px;font-size:11px;color:#888">' + planLabel + '</span>';
    body    = '<div style="font-size:13px;color:#555;margin-top:8px">Your subscription is active. Use the link below to cancel, update your payment method, or view invoices.</div>';
    var upgradeRow = (plan === 'veriqo' || plan === null)
      ? '<div style="margin-top:10px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:8px">'
        + '<span style="font-size:12px;color:#15803d">Add Carte — upgrade to Suite for £20/mo</span>'
        + '<button onclick="Mise.subscription.startCheckout(\'suite\',\'monthly\')" style="flex-shrink:0;padding:5px 12px;background:#2D7A3A;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit">Upgrade →</button>'
        + '</div>'
      : '';
    actions = '<button onclick="openPortal(this)" style="margin-top:14px;width:100%;padding:11px;background:#1B3A5C;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">Manage subscription →</button>'
            + upgradeRow;
  } else if (inTrial) {
    var dayWord = daysLeft === 1 ? 'day' : 'days';
    badge   = '<span style="display:inline-block;background:#fef9ec;color:#92400e;font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px;letter-spacing:0.03em">FREE TRIAL</span>';
    body    = '<div style="font-size:13px;color:#555;margin-top:8px">' + daysLeft + ' ' + dayWord + ' remaining. Subscribe before your trial ends to keep your records and stay compliant.</div>';
    actions = '<div style="display:flex;gap:8px;margin-top:14px">'
      + '<button onclick="Mise.subscription.startCheckout(\'veriqo\',\'monthly\')" style="flex:1;padding:11px;background:#fff;border:2px solid #e5e4de;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;color:#1a1a18">£12/month</button>'
      + '<button onclick="Mise.subscription.startCheckout(\'veriqo\',\'annual\')" style="flex:1;padding:11px;background:#2D7A3A;border:2px solid #2D7A3A;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;color:#fff">£120/year</button>'
      + '</div>'
      + '<div style="margin-top:8px;text-align:center"><button onclick="Mise.subscription.startCheckout(\'suite\',\'monthly\')" style="background:none;border:none;color:#2D7A3A;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;text-decoration:underline">Or get both apps — Suite £20/month</button></div>';
  } else {
    var isExpiredTrial = status === 'trial';
    badge   = '<span style="display:inline-block;background:#fde8e8;color:#A32D2D;font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px;letter-spacing:0.03em">' + (isExpiredTrial ? 'TRIAL ENDED' : 'INACTIVE') + '</span>';
    body    = '<div style="font-size:13px;color:#555;margin-top:8px">Subscribe to restore full access to your HACCP records.</div>';
    actions = '<div style="display:flex;gap:8px;margin-top:14px">'
      + '<button onclick="Mise.subscription.startCheckout(\'veriqo\',\'monthly\')" style="flex:1;padding:11px;background:#fff;border:2px solid #e5e4de;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;color:#1a1a18">£12/month</button>'
      + '<button onclick="Mise.subscription.startCheckout(\'veriqo\',\'annual\')" style="flex:1;padding:11px;background:#2D7A3A;border:2px solid #2D7A3A;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;color:#fff">£120/year</button>'
      + '</div>'
      + '<div style="margin-top:8px;text-align:center"><button onclick="Mise.subscription.startCheckout(\'suite\',\'monthly\')" style="background:none;border:none;color:#2D7A3A;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;text-decoration:underline">Or get both apps — Suite £20/month</button></div>';
  }

  card.innerHTML = '<div class="card-title">Subscription</div>'
    + '<div style="padding-top:4px">'
    + badge + body + actions
    + '</div>';
}

async function openPortal(btn) {
  var orig = btn.textContent;
  btn.textContent = 'Opening…';
  btn.disabled = true;
  try {
    var sessionResult = await supabaseClient.auth.getSession();
    var token = sessionResult.data.session && sessionResult.data.session.access_token;
    if (!token) throw new Error('Not signed in');

    var res = await fetch(
      'https://yixrwyfodipfcbhjcszp.supabase.co/functions/v1/create-portal-session',
      {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': 'Bearer ' + token,
          'apikey':        SUPABASE_ANON,
        },
      }
    );
    var data = await res.json();
    if (!res.ok || !data.url) throw new Error(data.error || 'Could not open portal');
    window.location.href = data.url;
  } catch (err) {
    console.error('[Veriqo] Portal error:', err);
    btn.textContent = orig;
    btn.disabled = false;
    if (typeof toast === 'function') toast('Could not open — please try again', false);
  }
}

async function saveProfile() {
  var business = document.getElementById('profile-business').value.trim();
  var chefname = document.getElementById('profile-chefname').value.trim();
  var logoImg  = document.getElementById('profile-logo-img');
  var logo     = logoImg.src && logoImg.src !== window.location.href ? logoImg.src : '';

  // Update in-memory profile so PDF export and inspector view pick it up immediately
  window.Mise = window.Mise || {};
  window.Mise.profile = window.Mise.profile || {};
  window.Mise.profile.business_name = business;
  window.Mise.profile.chef_name     = chefname;
  window.Mise.profile.logo          = logo;

  // Always save to localStorage as a fast local cache — survives page refreshes
  // on the same browser even if Supabase is slow or unreachable
  try {
    localStorage.setItem('veriqo_profile', JSON.stringify({
      business_name: business,
      chef_name:     chefname,
      logo:          logo
    }));
  } catch(e) { /* ignore storage quota errors */ }

  // Also mirror to the settings object — synced via the proven settings channel.
  // This ensures business name + logo reach all browsers even if the profiles
  // table update below fails.
  settings = settings || {};
  settings.business_name = business;
  settings.chef_name     = chefname;
  settings.logo          = logo;
  try { localStorage.setItem('haccp_settings', JSON.stringify(settings)); } catch(e) {}
  if (window.Mise && window.Mise.sync) Mise.sync.saveSettings(settings);

  // Save to Supabase so the profile syncs across all devices / browsers.
  // Uses update().eq() not upsert() — the profile row is always created by
  // subscription.js on first login, so INSERT is never needed and avoids
  // potential RLS conflicts. updated_at is omitted to avoid column-missing errors.
  try {
    var userResult = await supabaseClient.auth.getUser();
    var user = userResult.data && userResult.data.user;
    if (!user) {
      // Not signed in — localStorage save above is all we can do
      toast('Saved locally (not signed in)', 'warn');
      return;
    }
    var { error } = await supabaseClient
      .from('profiles')
      .update({ business_name: business, chef_name: chefname, logo: logo })
      .eq('id', user.id);
    if (error) {
      // Show the real Supabase error so it can be diagnosed
      console.error('[Veriqo] saveProfile Supabase error:', error);
      toast('Cloud save failed: ' + error.message, false);
      return;
    }
  } catch(e) {
    console.warn('[Veriqo] saveProfile exception:', e.message);
    toast('Cloud save failed — check connection', false);
    return;
  }

  // Show confirmation
  var msg = document.getElementById('profile-save-msg');
  if (msg) { msg.style.display = 'block'; setTimeout(function(){ msg.style.display = 'none'; }, 2000); }
  toast('Profile saved ✓');
}

async function loadEmailPreferences(){
  var toggle = document.getElementById('email-pref-toggle');
  if (!toggle || typeof supabaseClient === 'undefined' || !supabaseClient) return;
  try {
    var ur = await supabaseClient.auth.getUser();
    var user = ur && ur.data && ur.data.user;
    if (!user) return;
    toggle.dataset.userId = user.id;
    var res = await supabaseClient.from('profiles').select('email_opt_out').eq('id', user.id).single();
    toggle.checked = !(res.data && res.data.email_opt_out);
  } catch (e) { console.warn('[Veriqo] loadEmailPreferences:', e); }
}

async function setEmailPref(optedIn){
  var toggle = document.getElementById('email-pref-toggle');
  var userId = toggle && toggle.dataset.userId;
  if (!userId || typeof supabaseClient === 'undefined' || !supabaseClient) return;
  try {
    var res = await supabaseClient.from('profiles').update({ email_opt_out: !optedIn }).eq('id', userId);
    if (res.error) throw res.error;
    toast(optedIn ? 'Emails turned back on ✓' : 'Emails turned off ✓', true);
  } catch (e) {
    console.error('[Veriqo] setEmailPref:', e);
    toast('Could not save preference');
    if (toggle) toggle.checked = !optedIn;
  }
}

function loadProfileUI() {
  // Build a merged profile from three sources, lowest → highest priority:
  //   1. settings object  — populated by cloud settings sync (proven cross-browser)
  //   2. localStorage veriqo_profile cache — written by saveProfile() on this browser
  //   3. window.Mise.profile — fetched directly from Supabase profiles table
  // Higher-priority sources only overwrite a field if they have a non-empty value,
  // so a gap in one source is filled by the next best option.
  var p = {};

  // Layer 1 — settings (set by saveProfile and pulled from cloud on sign-in)
  if (typeof settings !== 'undefined') {
    if (settings.business_name) p.business_name = settings.business_name;
    if (settings.chef_name)     p.chef_name     = settings.chef_name;
    if (settings.logo)          p.logo          = settings.logo;
  }

  // Layer 2 — localStorage veriqo_profile cache
  try {
    var cached = JSON.parse(localStorage.getItem('veriqo_profile') || '{}');
    if (cached.business_name) p.business_name = cached.business_name;
    if (cached.chef_name)     p.chef_name     = cached.chef_name;
    if (cached.logo)          p.logo          = cached.logo;
  } catch(e) {}

  // Layer 3 — Supabase profiles table (highest authority)
  var supaProf = (window.Mise && window.Mise.profile) || {};
  if (supaProf.business_name) p.business_name = supaProf.business_name;
  if (supaProf.chef_name)     p.chef_name     = supaProf.chef_name;
  if (supaProf.logo)          p.logo          = supaProf.logo;

  // Ensure window.Mise.profile is up to date (used by PDF export, inspector view)
  window.Mise = window.Mise || {};
  window.Mise.profile = window.Mise.profile || {};
  if (p.business_name) window.Mise.profile.business_name = p.business_name;
  if (p.chef_name)     window.Mise.profile.chef_name     = p.chef_name;
  if (p.logo)          window.Mise.profile.logo          = p.logo;

  var bEl = document.getElementById('profile-business');
  var cEl = document.getElementById('profile-chefname');
  if (bEl && p.business_name) bEl.value = p.business_name;
  if (cEl && p.chef_name)     cEl.value = p.chef_name;
  if (p.logo) {
    var img = document.getElementById('profile-logo-img');
    var pre = document.getElementById('profile-logo-preview');
    if (img && pre) { img.src = p.logo; pre.style.display = 'block'; }
  }
}

// ── renderInspector ──────────────────────────────────────────────────────────
// EHO Inspection Mode — one-tap inspector-ready view.
// Shows a summary header, any outstanding / failed checks, and a
// full chronological timeline of today's records. Includes a PDF export button.
function renderInspector() {
  var container = document.getElementById('inspector-content');
  if (!container) return;

  // Pull today's records and profile
  var recs    = records.slice();
  var profile = (window.Mise && window.Mise.profile) || {};

  // Fill gaps from settings sync and localStorage cache (same priority order as loadProfileUI)
  if (!profile.business_name && typeof settings !== 'undefined' && settings.business_name) profile.business_name = settings.business_name;
  if (!profile.chef_name     && typeof settings !== 'undefined' && settings.chef_name)     profile.chef_name     = settings.chef_name;
  if (!profile.logo          && typeof settings !== 'undefined' && settings.logo)          profile.logo          = settings.logo;
  try {
    var _c = JSON.parse(localStorage.getItem('veriqo_profile')||'{}');
    if (!profile.business_name && _c.business_name) profile.business_name = _c.business_name;
    if (!profile.chef_name     && _c.chef_name)     profile.chef_name     = _c.chef_name;
    if (!profile.logo          && _c.logo)          profile.logo          = _c.logo;
  } catch(e) {}

  var businessName = profile.business_name || '';
  var now  = new Date();
  var hour = now.getHours();

  // ── Count statuses ────────────────────────────────────────────────────────
  var ok   = recs.filter(function(r){ return r.status==='ok';   }).length;
  var warn = recs.filter(function(r){ return r.status==='warn'; }).length;
  var fail = recs.filter(function(r){ return r.status==='fail'; }).length;

  // ── Update badge on home tile ─────────────────────────────────────────────
  var badge = document.getElementById('inspector-badge');
  if (badge) {
    if (fail > 0) { badge.textContent = fail + ' FAILED'; badge.style.background = 'rgba(163,45,45,0.85)'; }
    else if (warn > 0) { badge.textContent = warn + ' WARN'; badge.style.background = 'rgba(133,79,11,0.75)'; }
    else { badge.textContent = 'READY'; badge.style.background = 'rgba(255,255,255,0.2)'; }
  }

  // ── Outstanding check detection ───────────────────────────────────────────
  // Which record types have been logged today?
  var loggedTypes = {};
  recs.forEach(function(r){ loggedTypes[r.type] = true; });

  // Expected checks for a typical kitchen HACCP file
  var EXPECTED = [
    { type:'opening',     icon:'☀️',  label:'Opening checks' },
    { type:'fridge',      icon:'🌡️', label:'Fridge temperature check' },
    { type:'crosscontam', icon:'🔵',  label:'Cross-contamination check' },
    { type:'closing',     icon:'🌙',  label:'Closing checks' }
  ];

  var missing = EXPECTED.filter(function(c) {
    if (c.type === 'closing' && hour < 16) return false; // only nag after 4pm
    return !loggedTypes[c.type];
  });

  var failures = recs.filter(function(r){ return r.status === 'fail'; });

  // ── Timeline icons and status styles ─────────────────────────────────────
  var TYPE_ICONS = {
    opening:'☀️', closing:'🌙', fridge:'🌡️', cooking:'🍳',
    cooling:'❄️', reheating:'♨️', delivery:'📦', cleaning:'🧹',
    crosscontam:'🔵', probe:'🔬', pest:'🐀', illness:'🤒',
    job:'📍', kitchenassess:'🏠', allergen:'⚠️', transport:'🚗',
    mobileset:'📱', credentials:'📋'
  };
  var STATUS_STYLE = {
    ok:   'background:#EAF3DE;color:#2D7A3A',
    warn: 'background:#FAEEDA;color:#854F0B',
    fail: 'background:#FCEBEB;color:#A32D2D'
  };
  var STATUS_LABEL = { ok:'OK', warn:'Warning', fail:'Failed' };

  // Brief plain-text detail for each record type (for timeline rows)
  function _detail(r) {
    var d = '';
    if (r.type==='fridge')     d = (r.unit||'') + (r.temp!==undefined&&r.temp!==''?' · '+r.temp+'°C':'');
    else if (r.type==='cooking')    d = (r.food||'') + (r.temp!==undefined&&r.temp!==''?' · '+r.temp+'°C':'');
    else if (r.type==='cooling')    d = (r.food||'') + (r.startTemp!==undefined?' · '+r.startTemp+'→'+r.endTemp+'°C':'');
    else if (r.type==='reheating')  d = (r.food||'') + (r.temp!==undefined&&r.temp!==''?' · '+r.temp+'°C':'');
    else if (r.type==='delivery')   d = (r.supplier||'') + (r.temp!==undefined&&r.temp!==''?' · '+r.temp+'°C':'');
    else if (r.type==='cleaning')   d = (r.task||'') + (r.by?' · '+r.by:'');
    else if (r.type==='probe')      d = (r.probeId||'') + (r.reading!==undefined&&r.reading!==''?' · '+r.reading+'°C':'');
    else if (r.type==='pest')       d = (r.pestType||'') + (r.location?' · '+r.location:'');
    else if (r.type==='illness')    d = (r.staff||'') + (r.illnessType?' · '+r.illnessType:'');
    else if (r.type==='opening'||r.type==='closing'||r.type==='crosscontam') d = r.msg||'';
    else if (r.type==='job')        d = (r.client||'') + (r.jobType?' · '+r.jobType:'');
    else if (r.type==='allergen')   d = (r.dish||'') + (r.allergens&&r.allergens.length?' · '+r.allergens.join(', '):'');
    else if (r.type==='transport')  d = (r.food||'') + (r.destination?' → '+r.destination:'');
    else d = r.msg||'';
    return d;
  }

  function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // Sort records chronologically by time string
  var sorted = recs.slice().sort(function(a,b){ return (a.time||'').localeCompare(b.time||''); });

  // ── Build HTML ─────────────────────────────────────────────────────────────
  var html = '';

  // ── Header card: business, date, counts, PDF button ──────────────────────
  html += '<div class="card" style="margin-bottom:12px">'
    + '<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px">'
    +   '<div>'
    +     (businessName ? '<div style="font-size:17px;font-weight:700;color:#1a1a18">'+_esc(businessName)+'</div>' : '')
    +     '<div style="font-size:13px;color:#888;margin-top:2px">'+_esc(fmtDate(TODAY))+'</div>'
    +     '<div style="font-size:12px;color:#aaa;margin-top:1px">'+recs.length+' record'+(recs.length!==1?'s':'')+' logged today</div>'
    +   '</div>'
    +   '<div style="text-align:right;flex-shrink:0;margin-left:12px">'
    +     '<div style="font-size:10px;font-weight:700;letter-spacing:0.1em;color:#2D7A3A">VERIQO</div>'
    +     '<div style="font-size:10px;color:#aaa">Inspection Ready</div>'
    +   '</div>'
    + '</div>'
    // Status counts
    + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">'
    +   '<div style="text-align:center;padding:10px 4px;background:#EAF3DE;border-radius:8px">'
    +     '<div style="font-size:24px;font-weight:700;color:#2D7A3A">'+ok+'</div>'
    +     '<div style="font-size:10px;font-weight:700;color:#2D7A3A;letter-spacing:0.05em">OK</div>'
    +   '</div>'
    +   '<div style="text-align:center;padding:10px 4px;background:#FAEEDA;border-radius:8px">'
    +     '<div style="font-size:24px;font-weight:700;color:#854F0B">'+warn+'</div>'
    +     '<div style="font-size:10px;font-weight:700;color:#854F0B;letter-spacing:0.05em">WARNING</div>'
    +   '</div>'
    +   '<div style="text-align:center;padding:10px 4px;background:'+(fail>0?'#FCEBEB':'#f5f4f0')+';border-radius:8px">'
    +     '<div style="font-size:24px;font-weight:700;color:'+(fail>0?'#A32D2D':'#bbb')+'">'+fail+'</div>'
    +     '<div style="font-size:10px;font-weight:700;color:'+(fail>0?'#A32D2D':'#bbb')+';letter-spacing:0.05em">FAILED</div>'
    +   '</div>'
    + '</div>'
    // PDF export button
    + '<button onclick="exportDayPDF(\''+TODAY+'\')" style="width:100%;padding:14px;background:#2D7A3A;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">📄 Export PDF report</button>'
    + '</div>';

  // ── Outstanding / missing checks card ─────────────────────────────────────
  if (missing.length > 0 || failures.length > 0) {
    html += '<div class="card" style="margin-bottom:12px;border-color:#fde68a">'
      + '<div class="card-title" style="color:#854F0B">⚠️ Outstanding checks</div>';

    // Missing expected records — each has a "Log now →" quick-action button
    missing.forEach(function(c) {
      html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid #f5f4f0">'
        +   '<div style="display:flex;align-items:center;gap:10px">'
        +     '<span style="font-size:20px;flex-shrink:0">'+c.icon+'</span>'
        +     '<div>'
        +       '<div style="font-size:14px;font-weight:600;color:#1a1a18">'+_esc(c.label)+'</div>'
        +       '<div style="font-size:12px;color:#888">Not yet logged today</div>'
        +     '</div>'
        +   '</div>'
        +   '<button onclick="haccpTab(\''+c.type+'\')" style="padding:7px 13px;background:#1a1a18;color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap;flex-shrink:0">Log now →</button>'
        + '</div>';
    });

    // Failed records — highlight with detail so they can be addressed
    failures.forEach(function(r) {
      html += '<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #f5f4f0">'
        +   '<span style="font-size:20px;flex-shrink:0">❌</span>'
        +   '<div style="min-width:0">'
        +     '<div style="font-size:14px;font-weight:600;color:#A32D2D">Failed: '+_esc(titles[r.type]||r.type)+'</div>'
        +     '<div style="font-size:12px;color:#888;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+(r.time?r.time+' · ':'')+_esc(_detail(r))+'</div>'
        +   '</div>'
        + '</div>';
    });

    html += '</div>';

  } else if (recs.length > 0) {
    // All expected checks done and no failures
    html += '<div class="card" style="margin-bottom:12px;background:#f0fdf4;border-color:#bbf7d0">'
      + '<div style="display:flex;align-items:center;gap:12px;padding:4px 0">'
      +   '<span style="font-size:28px">✅</span>'
      +   '<div>'
      +     '<div style="font-size:15px;font-weight:700;color:#2D7A3A">All checks completed</div>'
      +     '<div style="font-size:12px;color:#888;margin-top:2px">No outstanding items — inspection ready</div>'
      +   '</div>'
      + '</div>'
      + '</div>';
  }

  // ── Chronological timeline card ───────────────────────────────────────────
  html += '<div class="card" style="margin-bottom:12px">'
    + '<div class="card-title">Today\'s timeline</div>';

  if (sorted.length === 0) {
    html += '<div style="color:#bbb;font-size:14px;text-align:center;padding:20px 0">No records logged today yet.<br><span style="font-size:12px">Tap any tile on the home screen to start logging.</span></div>';
  } else {
    sorted.forEach(function(r) {
      var icon   = TYPE_ICONS[r.type] || '📝';
      var detail = _detail(r);
      var sStyle = STATUS_STYLE[r.status] || 'background:#f0f0ec;color:#888';
      var sLabel = STATUS_LABEL[r.status] || '';
      html += '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f5f4f0">'
        +   '<div style="font-size:11px;color:#aaa;font-weight:600;min-width:34px;flex-shrink:0;font-variant-numeric:tabular-nums">'+_esc(r.time||'')+'</div>'
        +   '<span style="font-size:18px;flex-shrink:0">'+icon+'</span>'
        +   '<div style="flex:1;min-width:0">'
        +     '<div style="font-size:13px;font-weight:600;color:#1a1a18">'+_esc(titles[r.type]||r.type)+'</div>'
        +     (detail ? '<div style="font-size:11px;color:#888;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+_esc(detail)+'</div>' : '')
        +   '</div>'
        +   (sLabel ? '<span style="font-size:10px;font-weight:700;padding:3px 7px;border-radius:20px;white-space:nowrap;flex-shrink:0;'+sStyle+'">'+_esc(sLabel)+'</span>' : '')
        + '</div>';
    });
  }

  html += '</div>';

  // ── Date range PDF download card ────────────────────────────────────────
  var _sevenAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0,10);
  var _btnStyle = 'padding:7px 13px;background:#f0f0ec;border:1px solid #e5e4de;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;color:#1a1a18';
  var _inputStyle = 'width:100%;padding:9px 10px;border:1px solid #e5e4de;border-radius:8px;font-size:14px;font-family:inherit;background:#fff;color:#1a1a18;-webkit-appearance:none';

  html += '<div class="card" style="margin-bottom:24px">'
    + '<div class="card-title">📅 Download date range</div>'
    + '<div style="font-size:13px;color:#888;line-height:1.5;margin-bottom:12px">Export a single PDF covering multiple days — ideal for showing an inspector a full week or month of records.</div>'
    // Quick preset buttons
    + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">'
    +   '<button onclick="setInspectorRange(7)"  style="'+_btnStyle+'">Last 7 days</button>'
    +   '<button onclick="setInspectorRange(30)" style="'+_btnStyle+'">Last 30 days</button>'
    +   '<button onclick="setInspectorRange(90)" style="'+_btnStyle+'">Last 3 months</button>'
    + '</div>'
    // Date pickers
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">'
    +   '<div>'
    +     '<div style="font-size:12px;color:#888;margin-bottom:4px;font-weight:600">From</div>'
    +     '<input type="date" id="range-from" value="'+_sevenAgo+'" max="'+TODAY+'" style="'+_inputStyle+'">'
    +   '</div>'
    +   '<div>'
    +     '<div style="font-size:12px;color:#888;margin-bottom:4px;font-weight:600">To</div>'
    +     '<input type="date" id="range-to" value="'+TODAY+'" max="'+TODAY+'" style="'+_inputStyle+'">'
    +   '</div>'
    + '</div>'
    + '<button onclick="downloadRangePDF()" id="range-pdf-btn" style="width:100%;padding:14px;background:#1a1a18;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">📄 Download range PDF</button>'
    + '</div>';

  container.innerHTML = html;
}

// ── setInspectorRange ──────────────────────────────────────────────────────
// Fills the date range pickers in the inspector view with a preset range.
function setInspectorRange(days) {
  var from = document.getElementById('range-from');
  var to   = document.getElementById('range-to');
  if (!from || !to) return;
  to.value   = todayStr();
  from.value = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000).toISOString().slice(0,10);
}

// ── downloadRangePDF ───────────────────────────────────────────────────────
// Reads the date inputs and kicks off a multi-day PDF download.
function downloadRangePDF() {
  var from = document.getElementById('range-from');
  var to   = document.getElementById('range-to');
  if (!from || !to || !from.value || !to.value) { toast('Please select a date range', false); return; }
  if (from.value > to.value) { toast('Start date must be before end date', false); return; }
  var btn = document.getElementById('range-pdf-btn');
  if (btn) { btn.textContent = 'Building PDF…'; btn.disabled = true; }
  // Small delay so the UI updates before blocking PDF build
  setTimeout(function() {
    buildMultiDayPDF(from.value, to.value);
    if (btn) { btn.textContent = '📄 Download range PDF'; btn.disabled = false; }
  }, 60);
}

// ── buildMultiDayPDF ───────────────────────────────────────────────────────
// Generates a single PDF covering every day in the selected range.
// Structure: cover page with summary table, then one section per day.
// Uses Blob URL so it works on iOS Safari (window.open blocked in async).
function buildMultiDayPDF(startDateStr, endDateStr) {

  // ── Shared helpers ───────────────────────────────────────────────────────
  function esc(s) { return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }
  function statusStyle(s) {
    if(s==='ok')   return 'color:#2D7A3A;font-weight:600';
    if(s==='warn') return 'color:#854F0B;font-weight:600';
    return 'color:#A32D2D;font-weight:700';
  }
  function statusLabel(s) { return s==='ok'?'OK':s==='warn'?'Warning':s==='fail'?'Failed':'—'; }
  function detailsFor(r) {
    var p=[];
    if(r.type==='fridge'){p.push(esc(r.unit));if(r.temp!==undefined&&r.temp!=='')p.push(esc(r.temp)+'°C');if(r.by)p.push('By: '+esc(r.by));}
    else if(r.type==='cooking'){p.push(esc(r.food));if(r.temp!==undefined&&r.temp!=='')p.push(esc(r.temp)+'°C');if(r.chef)p.push('Chef: '+esc(r.chef));}
    else if(r.type==='cooling'){p.push(esc(r.food));if(r.startTemp!==undefined)p.push(esc(r.startTemp)+'°C → '+esc(r.endTemp)+'°C');if(r.method)p.push('Method: '+esc(r.method));if(r.by)p.push('By: '+esc(r.by));}
    else if(r.type==='reheating'){p.push(esc(r.food));if(r.temp!==undefined&&r.temp!=='')p.push(esc(r.temp)+'°C');if(r.chef)p.push('Chef: '+esc(r.chef));}
    else if(r.type==='delivery'){p.push(esc(r.supplier));if(r.temp!==undefined&&r.temp!=='')p.push(esc(r.temp)+'°C');if(r.condition)p.push('Condition: '+esc(r.condition));if(r.by)p.push('Received by: '+esc(r.by));if(r.invoice)p.push('Invoice: '+esc(r.invoice));}
    else if(r.type==='cleaning'){p.push(esc(r.task));if(r.chem)p.push('Chemical: '+esc(r.chem));if(r.by)p.push('By: '+esc(r.by));}
    else if(r.type==='probe'){p.push('Probe: '+esc(r.probeId));if(r.reading!==undefined&&r.reading!=='')p.push('Reading: '+esc(r.reading)+'°C');if(r.result)p.push('Result: '+esc(r.result));if(r.by)p.push('By: '+esc(r.by));}
    else if(r.type==='pest'){p.push(esc(r.pestType));if(r.location)p.push('Location: '+esc(r.location));if(r.action)p.push('Action: '+esc(r.action));if(r.by)p.push('By: '+esc(r.by));}
    else if(r.type==='illness'){p.push(esc(r.staff));if(r.illnessType)p.push(esc(r.illnessType));if(r.symptoms)p.push('Symptoms: '+esc(r.symptoms));}
    else if(r.type==='opening'||r.type==='closing'||r.type==='crosscontam'){if(r.by)p.push('By: '+esc(r.by));if(r.notes)p.push(esc(r.notes));p.push(esc(r.msg));}
    else if(r.type==='job'){if(r.client)p.push('Client: '+esc(r.client));if(r.location)p.push(esc(r.location));if(r.jobType)p.push(esc(r.jobType));if(r.covers)p.push(esc(r.covers)+' covers');}
    else if(r.type==='kitchenassess'){if(r.client)p.push('Client: '+esc(r.client));if(r.fridgeTemp!==undefined&&r.fridgeTemp!=='')p.push('Fridge: '+esc(r.fridgeTemp)+'°C');if(r.condition)p.push('Condition: '+esc(r.condition));}
    else if(r.type==='allergen'){if(r.client)p.push('Client: '+esc(r.client));if(r.dish)p.push('Dish: '+esc(r.dish));if(r.allergens&&r.allergens.length)p.push('Allergens: '+r.allergens.map(esc).join(', '));}
    else if(r.type==='transport'){p.push(esc(r.food));if(r.destination)p.push('To: '+esc(r.destination));if(r.startTemp!==undefined)p.push(esc(r.startTemp)+'°C → '+esc(r.endTemp)+'°C');}
    else{p.push(esc(r.msg));}
    return p.filter(Boolean).join(' &nbsp;·&nbsp; ');
  }
  var typeHeadings = {
    fridge:'Fridge Temperatures', cooking:'Cooked Food Temperatures', cooling:'Cooling Records',
    reheating:'Reheating Records', delivery:'Delivery Checks', cleaning:'Cleaning Records',
    probe:'Probe Calibration', pest:'Pest Control', illness:'Staff Illness',
    opening:'Opening Checks', closing:'Closing Checks', crosscontam:'Cross-Contamination',
    job:'Job Details', kitchenassess:'Kitchen Assessment', allergen:'Allergen Log',
    transport:'Transport Temperatures', mobileset:'Mobile Setup', incident:'Incident Log'
  };

  // ── Collect records for every day in the range ───────────────────────────
  var days = [];
  var cur = new Date(startDateStr + 'T12:00:00');
  var end = new Date(endDateStr   + 'T12:00:00');
  while (cur <= end) { days.push(cur.toISOString().slice(0,10)); cur.setDate(cur.getDate()+1); }

  if (days.length > 93) { toast('Maximum range is 3 months', false); return; }

  var dayData = days.map(function(d) {
    var recs = d === todayStr() ? records.slice() : getDayRecords(d);
    return { dateStr: d, label: fmtDate(d), recs: recs };
  });

  var daysWithData = dayData.filter(function(d){ return d.recs.length > 0; });
  if (daysWithData.length === 0) { toast('No records found in that date range', false); return; }

  // ── Overall summary counts ────────────────────────────────────────────────
  var totalRecs = 0, totalOk = 0, totalWarn = 0, totalFail = 0;
  daysWithData.forEach(function(d) {
    totalRecs += d.recs.length;
    totalOk   += d.recs.filter(function(r){return r.status==='ok';}).length;
    totalWarn += d.recs.filter(function(r){return r.status==='warn';}).length;
    totalFail += d.recs.filter(function(r){return r.status==='fail';}).length;
  });

  // ── Profile ───────────────────────────────────────────────────────────────
  var profile = (window.Mise && window.Mise.profile) || {};
  try { if (!profile.business_name) { var _c = JSON.parse(localStorage.getItem('veriqo_profile')||'{}'); profile = Object.assign({}, _c, profile); } } catch(e) {}
  var businessName = profile.business_name || '';
  var chefName     = profile.chef_name     || '';

  var now        = new Date();
  var genDateStr = now.toLocaleDateString('en-GB', {day:'numeric', month:'long', year:'numeric'});
  var genTimeStr = now.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  var rangeLabel = fmtDate(startDateStr) + ' — ' + fmtDate(endDateStr);
  var refNum     = startDateStr.replace(/-/g,'') + '_' + endDateStr.replace(/-/g,'');

  // ── Build one section per day ─────────────────────────────────────────────
  function buildDaySection(d, isFirst) {
    var ok   = d.recs.filter(function(r){return r.status==='ok';}).length;
    var warn = d.recs.filter(function(r){return r.status==='warn';}).length;
    var fail = d.recs.filter(function(r){return r.status==='fail';}).length;

    var sec = '<div style="'+(isFirst?'':'page-break-before:always;')+'margin-bottom:0;padding-bottom:0">';

    // Day header bar
    sec += '<div style="border-bottom:2px solid #2D7A3A;padding-bottom:8px;margin-bottom:14px;display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:8px">'
      + '<div style="font-size:17px;font-weight:700;color:#1a1a18">'+esc(d.label)+'</div>'
      + '<div style="display:flex;gap:14px;font-size:12px;flex-shrink:0">'
      +   '<span style="color:#2D7A3A;font-weight:700">'+ok+' OK</span>'
      +   '<span style="color:#854F0B;font-weight:700">'+warn+' Warning</span>'
      +   '<span style="color:'+(fail>0?'#A32D2D':'#bbb')+';font-weight:700">'+fail+' Failed</span>'
      +   '<span style="color:#888">'+d.recs.length+' records</span>'
      + '</div>'
      + '</div>';

    // Record tables grouped by type
    var dayContent = ALL_TYPES.map(function(t) {
      var tr = d.recs.filter(function(r){return r.type===t;});
      if (!tr.length) return '';
      var rows = tr.map(function(r){
        return '<tr>'
          +'<td style="white-space:nowrap;padding:5px 8px;border-bottom:1px solid #eee;color:#555;font-size:12px">'+esc(r.time||'')+'</td>'
          +'<td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:12px">'+detailsFor(r)+'</td>'
          +'<td style="white-space:nowrap;padding:5px 8px;border-bottom:1px solid #eee;font-size:12px;'+statusStyle(r.status)+'">'+statusLabel(r.status)+'</td>'
          +'</tr>';
      }).join('');
      return '<div style="margin-bottom:16px;page-break-inside:avoid">'
        +'<div style="font-size:10px;font-weight:700;letter-spacing:0.08em;color:#555;text-transform:uppercase;border-bottom:1px solid #2D7A3A;padding-bottom:3px;margin-bottom:0">'+esc(typeHeadings[t]||t)+'</div>'
        +'<table style="width:100%;border-collapse:collapse"><thead>'
        +'<tr style="background:#f8f8f8">'
        +'<th style="text-align:left;padding:5px 8px;font-size:10px;color:#888;font-weight:600;border-bottom:1px solid #ddd">Time</th>'
        +'<th style="text-align:left;padding:5px 8px;font-size:10px;color:#888;font-weight:600;border-bottom:1px solid #ddd">Details</th>'
        +'<th style="text-align:left;padding:5px 8px;font-size:10px;color:#888;font-weight:600;border-bottom:1px solid #ddd">Status</th>'
        +'</tr></thead><tbody>'+rows+'</tbody></table></div>';
    }).filter(Boolean).join('');

    sec += (dayContent || '<p style="color:#bbb;font-size:13px;padding:8px 0">No records logged this day.</p>');
    sec += '</div>';
    return sec;
  }

  // ── Assemble complete HTML document ───────────────────────────────────────
  var daySections = daysWithData.map(function(d, i){ return buildDaySection(d, i===0); }).join('');

  // Daily summary table rows (one row per day with data)
  var summaryRows = daysWithData.map(function(d) {
    var ok   = d.recs.filter(function(r){return r.status==='ok';}).length;
    var warn = d.recs.filter(function(r){return r.status==='warn';}).length;
    var fail = d.recs.filter(function(r){return r.status==='fail';}).length;
    var rowBg = fail > 0 ? '#fff8f8' : warn > 0 ? '#fffdf4' : '#fff';
    return '<tr style="background:'+rowBg+'">'
      +'<td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:12px;font-weight:600">'+esc(d.label)+'</td>'
      +'<td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:12px;text-align:center">'+d.recs.length+'</td>'
      +'<td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:12px;text-align:center;color:#2D7A3A;font-weight:600">'+ok+'</td>'
      +'<td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:12px;text-align:center;color:#854F0B;font-weight:600">'+warn+'</td>'
      +'<td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:12px;text-align:center;color:'+(fail>0?'#A32D2D':'#bbb')+';font-weight:700">'+fail+'</td>'
      +'</tr>';
  }).join('');

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8">'
    +'<meta name="viewport" content="width=device-width,initial-scale=1">'
    +'<title>HACCP Records — '+esc(rangeLabel)+'</title>'
    +'<style>'
    +'*{box-sizing:border-box;margin:0;padding:0}'
    +'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#222;background:#fff;padding:24px}'
    +'.toolbar{position:sticky;top:0;z-index:10;background:#fff;border-bottom:1px solid #eee;padding:10px 0;margin:-24px -24px 20px;padding-left:24px;display:flex;gap:10px;align-items:center}'
    +'.btn-pdf{background:#2D7A3A;color:#fff;border:none;border-radius:6px;padding:9px 18px;font-size:14px;font-weight:600;cursor:pointer}'
    +'.btn-close{background:#f0f0f0;color:#444;border:none;border-radius:6px;padding:9px 14px;font-size:14px;cursor:pointer}'
    +'@media print{'
    +'@page{size:A4;margin:15mm 15mm 15mm 15mm}'
    +'.no-print{display:none!important}'
    +'body{padding:0}'
    +'}'
    +'</style>'
    +'</head><body>'

    // Toolbar
    +'<div class="toolbar no-print">'
    +'<button class="btn-pdf" onclick="window.print()">Save as PDF</button>'
    +'<button class="btn-close" onclick="window.close()">Close</button>'
    +'</div>'

    // Document header
    +'<div style="border-bottom:3px solid #2D7A3A;padding-bottom:14px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">'
    +  '<div style="display:flex;align-items:center;gap:14px">'
    +    (profile.logo ? '<img src="'+profile.logo+'" alt="" style="max-height:52px;max-width:130px;object-fit:contain;border-radius:4px">' : '')
    +    '<div>'
    +      '<div style="font-size:9px;letter-spacing:0.12em;text-transform:uppercase;color:#2D7A3A;font-weight:700;margin-bottom:4px">HACCP Records — Date Range Report</div>'
    +      '<div style="font-size:20px;font-weight:700;color:#222">'+esc(rangeLabel)+'</div>'
    +      (businessName ? '<div style="font-size:13px;color:#444;margin-top:3px;font-weight:600">'+esc(businessName)+'</div>' : '')
    +      (chefName     ? '<div style="font-size:11px;color:#888;margin-top:1px">'+esc(chefName)+'</div>' : '')
    +    '</div>'
    +  '</div>'
    +  '<div style="text-align:right;flex-shrink:0">'
    +    '<div style="font-size:11px;font-weight:700;color:#2D7A3A">Veriqo</div>'
    +    '<div style="font-size:10px;color:#aaa;margin-top:3px">Ref: '+esc(refNum)+'</div>'
    +    '<div style="font-size:10px;color:#aaa;margin-top:2px">Generated '+esc(genDateStr)+' · '+esc(genTimeStr)+'</div>'
    +  '</div>'
    +'</div>'

    // Overall totals strip
    +'<div style="display:flex;gap:20px;margin-bottom:20px;padding:12px 16px;background:#f8f8f8;border-radius:6px;flex-wrap:wrap">'
    +'<div><span style="font-size:20px;font-weight:700;color:#1a1a18">'+daysWithData.length+'</span><span style="font-size:11px;color:#555;margin-left:5px">days</span></div>'
    +'<div><span style="font-size:20px;font-weight:700;color:#888">'+totalRecs+'</span><span style="font-size:11px;color:#555;margin-left:5px">records</span></div>'
    +'<div><span style="font-size:20px;font-weight:700;color:#2D7A3A">'+totalOk+'</span><span style="font-size:11px;color:#555;margin-left:5px">OK</span></div>'
    +'<div><span style="font-size:20px;font-weight:700;color:#854F0B">'+totalWarn+'</span><span style="font-size:11px;color:#555;margin-left:5px">Warning</span></div>'
    +'<div><span style="font-size:20px;font-weight:700;color:'+(totalFail>0?'#A32D2D':'#bbb')+'">'+totalFail+'</span><span style="font-size:11px;color:#555;margin-left:5px">Failed</span></div>'
    +'</div>'

    // Daily summary table
    +'<div style="margin-bottom:28px;page-break-inside:avoid">'
    +'<div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:#555;text-transform:uppercase;border-bottom:2px solid #2D7A3A;padding-bottom:4px;margin-bottom:0">Daily summary</div>'
    +'<table style="width:100%;border-collapse:collapse"><thead>'
    +'<tr style="background:#f8f8f8">'
    +'<th style="text-align:left;padding:6px 10px;font-size:11px;color:#888;font-weight:600;border-bottom:1px solid #ddd">Date</th>'
    +'<th style="text-align:center;padding:6px 10px;font-size:11px;color:#888;font-weight:600;border-bottom:1px solid #ddd">Records</th>'
    +'<th style="text-align:center;padding:6px 10px;font-size:11px;color:#2D7A3A;font-weight:600;border-bottom:1px solid #ddd">OK</th>'
    +'<th style="text-align:center;padding:6px 10px;font-size:11px;color:#854F0B;font-weight:600;border-bottom:1px solid #ddd">Warning</th>'
    +'<th style="text-align:center;padding:6px 10px;font-size:11px;color:#A32D2D;font-weight:600;border-bottom:1px solid #ddd">Failed</th>'
    +'</tr></thead><tbody>'+summaryRows+'</tbody></table>'
    +'</div>'

    // Per-day detailed sections
    + daySections

    // Footer
    +'<div style="margin-top:32px;padding-top:12px;border-top:1px solid #eee;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">'
    +  '<span style="font-size:10px;color:#aaa">Generated by Veriqo — Food Safety. Inspection Ready. &nbsp;|&nbsp; '+esc(genDateStr)+' at '+esc(genTimeStr)+'</span>'
    +  '<span style="font-size:10px;color:#ccc">Ref: '+esc(refNum)+'</span>'
    +'</div>'
    +'</body></html>';

  // Blob URL approach — works on iOS Safari where window.open() is blocked
  var blob = new Blob([html], {type:'text/html'});
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href = url; a.target = '_blank'; a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 10000);
}

// ── Install banner ────────────────────────────────────────────────────────────
// Android/Chrome: capture the native beforeinstallprompt event so we can
// trigger it from our own button. iOS: detect Safari + not standalone and
// show a manual tap-share guide. Neither shows if already installed or dismissed.
var _deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', function(e) {
  e.preventDefault();
  _deferredInstallPrompt = e;
  _showInstallBanner('android');
});

function _showInstallBanner(type) {
  if (localStorage.getItem('veriqo_install_dismissed')) return;
  if (window.matchMedia('(display-mode: standalone)').matches) return;
  if (window.navigator.standalone) return;
  var banner = document.getElementById('install-banner');
  var body   = document.getElementById('install-banner-body');
  if (!banner || !body) return;
  if (type === 'android') {
    body.innerHTML = '<button onclick="_triggerInstall()" style="margin-top:5px;background:#2D7A3A;color:#fff;border:none;border-radius:7px;padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">Install app</button>';
  } else {
    body.innerHTML = 'Tap the <span style="display:inline-block;border:1.5px solid #555;border-radius:4px;padding:0 4px;font-size:12px;line-height:1.6;font-weight:700">&#8679;</span> <strong>Share</strong> button at the bottom of Safari, then tap <strong>Add to Home Screen</strong>';
  }
  banner.style.display = 'flex';
}

function _triggerInstall() {
  if (!_deferredInstallPrompt) return;
  _deferredInstallPrompt.prompt();
  _deferredInstallPrompt.userChoice.then(function(r) {
    _deferredInstallPrompt = null;
    if (r.outcome === 'accepted') dismissInstallBanner();
  });
}

function dismissInstallBanner() {
  var el = document.getElementById('install-banner');
  if (el) el.style.display = 'none';
  try { localStorage.setItem('veriqo_install_dismissed', '1'); } catch(e) {}
}

// iOS: show guide if opened in Safari but not yet added to home screen
(function() {
  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  var isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
  if (isIOS && !isStandalone) { setTimeout(function(){ _showInstallBanner('ios'); }, 300); }
})();

// --- SAMPLE DAY (DEMO MODE) ---
// Injects canned records into the real `records` var and lets the normal
// renderers draw them — pixel-identical to live data. saveHaccpToday() and
// the sync pull (sync.js checks window._haccpDemoMode) are short-circuited
// so demo data can never reach localStorage or Supabase.
var _demoMode = false;

function _demoTime(minsAgo) {
  var d = new Date(Date.now() - minsAgo * 60000);
  return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
}

function _buildDemoRecords() {
  var chef = 'Sam (sample)';
  var openItems = (CHECKLISTS.opening || []).map(function(i){ return i.label; });
  return [
    {type:'opening', by:chef, notes:'', checked:openItems, unchecked:[], time:_demoTime(260), status:'ok', msg:'All '+openItems.length+' items confirmed'},
    {type:'fridge', unit:'Main fridge',    by:chef, temp:3.2,   time:_demoTime(255), notes:'', status:'ok', msg:'3.2°C — within safe range (0–5°C)'},
    {type:'fridge', unit:'Prep fridge',    by:chef, temp:4.1,   time:_demoTime(253), notes:'', status:'ok', msg:'4.1°C — within safe range (0–5°C)'},
    {type:'fridge', unit:'Walk-in fridge', by:chef, temp:2.8,   time:_demoTime(251), notes:'', status:'ok', msg:'2.8°C — within safe range (0–5°C)'},
    {type:'fridge', unit:'Freezer 1',      by:chef, temp:-18.5, time:_demoTime(249), notes:'', status:'ok', msg:'-18.5°C — within legal range (-18°C or below)'},
    {type:'delivery', supplier:'FreshFoods Ltd', temp:null, time:_demoTime(215), invoice:'INV-4471', by:chef, condition:'Minor issues noted', chilledTemp:'6.1', chilledCond:'Issues noted', frozenTemp:'', frozenCond:'', notes:'Cream arrived at 6.1°C — moved straight to fridge, using first', photo:'', status:'warn', msg:'Issues noted'},
    {type:'cooling', food:'Chicken velouté base', startTemp:78, startTime:_demoTime(170), endTemp:4, endTime:_demoTime(85), durationMins:85, method:'Ice bath', by:chef, time:_demoTime(170), status:'ok', msg:'Cooled to 4°C in 1h 25m'},
    {type:'cooking', food:'Beef wellington',       temp:82, time:_demoTime(95), chef:chef, status:'ok', msg:'82°C — safe'},
    {type:'cooking', food:'Dauphinoise potatoes',  temp:88, time:_demoTime(80), chef:chef, status:'ok', msg:'88°C — safe'},
    {type:'cleaning', task:'Worktops & surfaces', time:_demoTime(55), by:chef, chem:'Sanitiser D10', status:'ok', msg:'Completed by '+chef}
  ];
}

function startSampleDay() {
  if (_demoMode) return;
  _demoMode = true;
  window._haccpDemoMode = true;
  records = _buildDemoRecords();
  var banner = document.getElementById('demo-banner');
  if (banner) banner.style.display = 'flex';
  var empty  = document.getElementById('shift-empty-state');
  var active = document.getElementById('shift-active-view');
  if (empty)  empty.style.display  = 'none';
  if (active) active.style.display = '';
  renderHaccpSections();
  haccpTab('home');
  window.scrollTo(0, 0);
  if (window.posthog) posthog.capture('sample_day_started');
}

function exitSampleDay() {
  if (!_demoMode) return;
  _demoMode = false;
  window._haccpDemoMode = false;
  loadHaccpToday(); // restore real records from localStorage (sync keeps it fresh)
  var banner = document.getElementById('demo-banner');
  if (banner) banner.style.display = 'none';
  renderHaccpSections();
  haccpTab('home');
  _restoreShiftState();
  if (window.posthog) posthog.capture('sample_day_exited');
}

// --- STARTER CHECKLIST (guided setup for new users) ---
// Completion is derived from data, never stored: a step is done when a record
// of that type exists on any day. Card hides itself once all steps are done,
// so established accounts never see it.
var _starterWasShown = false;

function _starterStepsDone() {
  var have = { opening:false, fridge:false, cooking:false };
  function scan(recs) { recs.forEach(function(r){ if (have.hasOwnProperty(r.type)) have[r.type] = true; }); }
  scan(records);
  getAllDays().forEach(function(d){ if (d !== todayStr()) scan(getDayRecords(d)); });
  return have;
}

function renderStarterChecklist() {
  var el = document.getElementById('starter-checklist');
  if (!el) return;
  if (_demoMode || settings.starterDismissed) { el.style.display = 'none'; return; }
  var have = _starterStepsDone();
  var doneCount = (have.opening?1:0) + (have.fridge?1:0) + (have.cooking?1:0);
  if (doneCount === 3) {
    el.style.display = 'none';
    if (_starterWasShown && !settings.starterCompleted) {
      settings.starterCompleted = true;
      saveHaccpSettings();
      toast('Setup complete — your kitchen is EHO-ready');
      if (window.posthog) posthog.capture('setup_checklist_completed');
    }
    return;
  }
  _starterWasShown = true;
  var steps = [
    {tab:'opening', label:'Complete your opening checks', sub:'Your first EHO-ready record', done:have.opening},
    {tab:'fridge',  label:'Log a fridge temp',            sub:'Takes 10 seconds',            done:have.fridge},
    {tab:'cooking', label:'Log a cooked-food temp',       sub:'Core temp of any dish',       done:have.cooking}
  ];
  var rows = steps.map(function(s, i) {
    var circle = s.done
      ? '<span style="width:24px;height:24px;border-radius:50%;background:#2D7A3A;color:#fff;font-size:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0">&#10003;</span>'
      : '<span style="width:24px;height:24px;border-radius:50%;background:#f0efe9;color:#888;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">'+(i+1)+'</span>';
    var labelStyle = s.done ? 'color:#999;text-decoration:line-through' : 'color:#1a1a18';
    return '<div onclick="haccpTab(\''+s.tab+'\')" style="display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid #f0efe9;cursor:pointer">'+
      circle+
      '<div style="flex:1"><div style="font-size:14px;font-weight:600;'+labelStyle+'">'+s.label+'</div>'+
      '<div style="font-size:12px;color:#999;margin-top:1px">'+s.sub+'</div></div>'+
      (s.done ? '' : '<span style="color:#ccc;font-size:16px">&#8250;</span>')+
      '</div>';
  }).join('');
  el.style.display = 'block';
  el.innerHTML =
    '<div class="card" style="margin-bottom:16px">'+
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:2px">'+
        '<div><div style="font-size:15px;font-weight:700;color:#1a1a18">Set up your kitchen</div>'+
        '<div style="font-size:12.5px;color:#888;margin-top:2px">Three quick steps to your first day of records</div></div>'+
        '<button onclick="dismissStarterChecklist()" aria-label="Dismiss" style="background:none;border:none;color:#ccc;font-size:20px;cursor:pointer;padding:0 0 0 10px;line-height:1">&times;</button>'+
      '</div>'+
      rows+
      '<div style="display:flex;align-items:center;justify-content:space-between;padding-top:10px">'+
        '<span style="font-size:12px;color:#999">'+doneCount+' of 3 done</span>'+
        '<button onclick="startSampleDay()" style="display:inline-flex;align-items:center;gap:6px;background:#fff;border:1.5px solid var(--vq-green);color:var(--vq-green);border-radius:8px;padding:6px 12px;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit">&#128064; See a sample day</button>'+
      '</div>'+
    '</div>';
}

function dismissStarterChecklist() {
  settings.starterDismissed = true;
  saveHaccpSettings();
  renderStarterChecklist();
  if (window.posthog) posthog.capture('setup_checklist_dismissed');
}

// --- SAMPLE DAY ANNOUNCE (one-time nudge for existing accounts) ---
// Established accounts never see the starter checklist's "See a sample day"
// link once its 3 steps are done, so they'd otherwise have no way to
// discover the feature. Show a one-time modal on their next login instead.
function _maybeShowSampleDayAnnounce() {
  if (_demoMode || settings.sampleDayAnnounceShown) return;
  var have = _starterStepsDone();
  var doneCount = (have.opening?1:0) + (have.fridge?1:0) + (have.cooking?1:0);
  if (doneCount < 3) return; // still onboarding — they'll see the checklist link instead
  var el = document.getElementById('sample-day-announce-modal');
  if (!el) return;
  el.style.display = 'flex';
  settings.sampleDayAnnounceShown = true;
  saveHaccpSettings();
  if (window.posthog) posthog.capture('sample_day_announce_shown');
}

function dismissSampleDayAnnounce() {
  var el = document.getElementById('sample-day-announce-modal');
  if (el) el.style.display = 'none';
  if (window.posthog) posthog.capture('sample_day_announce_dismissed');
}

function startSampleDayFromAnnounce() {
  dismissSampleDayAnnounce();
  if (window.posthog) posthog.capture('sample_day_announce_clicked');
  startSampleDay();
}

// --- SHIFT / KITCHEN OPEN STATE ---
function _shiftKey() { return 'haccp_shift_open_' + todayStr(); }

function startService() {
  localStorage.setItem(_shiftKey(), '1');
  var empty = document.getElementById('shift-empty-state');
  var active = document.getElementById('shift-active-view');
  if (empty)  empty.style.display  = 'none';
  if (active) active.style.display = '';
  updateHaccpDashboard();
}

function _restoreShiftState() {
  var isOpen = localStorage.getItem(_shiftKey()) === '1' || records.length > 0;
  var empty  = document.getElementById('shift-empty-state');
  var active = document.getElementById('shift-active-view');
  if (!empty || !active) return;
  if (isOpen) {
    empty.style.display  = 'none';
    active.style.display = '';
  } else {
    empty.style.display  = '';
    active.style.display = 'none';
  }
}

function closeJobHaccpChecklist() {
  var modal = document.getElementById('job-haccp-modal');
  if (modal) modal.style.display = 'none';
}

function openJobHaccpChecklist(job) {
  var modal = document.getElementById('job-haccp-modal');
  if (!modal) return;
  var nameEl = document.getElementById('job-checklist-event-name');
  var metaEl = document.getElementById('job-checklist-event-meta');
  var progEl = document.getElementById('job-checklist-progress');
  var contentEl = document.getElementById('job-checklist-content');
  if (nameEl) nameEl.textContent = job.client || 'Event';
  var parts = [];
  if (job.eventDate === TODAY) parts.push('Today');
  else { var dd = new Date(job.eventDate+'T12:00:00'); parts.push(dd.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})); }
  if (job.eventTime) parts.push('at '+job.eventTime);
  if (job.covers) parts.push(job.covers+' covers');
  if (metaEl) metaEl.textContent = parts.join(' · ');
  var isToday = job.eventDate === TODAY;
  var hasAllergenGuests = (job.guests || []).some(function(g){ return g.allergens && g.allergens.length; });
  var hasMenu = job.menus && job.menus.length > 0;
  var items = [
    { label: 'Opening checks', check: function(r){ return r.type==='opening'; } },
    { label: 'Fridge temperatures logged', check: function(r){ return r.type==='fridge'; } }
  ];
  if (hasMenu) items.push({ label: 'Cooking temperatures logged', check: function(r){ return r.type==='cooking'||r.type==='reheating'; } });
  if (hasAllergenGuests) items.push({ label: 'Allergen records logged', check: function(r){ return r.type==='allergen'; } });
  items.push({ label: 'Cleaning completed', check: function(r){ return r.type==='cleaning'; } });
  items.push({ label: 'Closing checks', check: function(r){ return r.type==='closing'; } });
  var dayRecs = isToday ? records : [];
  var done = 0;
  var html = items.map(function(item){
    var completed = isToday && dayRecs.some(item.check);
    if (completed) done++;
    return '<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #f0ede8">'
      +'<span style="font-size:18px;color:'+(completed?'#2D7A3A':'#ccc')+';font-weight:700;width:22px;text-align:center;flex-shrink:0">'+(completed?'✓':'○')+'</span>'
      +'<span style="font-size:14px;color:'+(completed?'#888':'#1a1a18')+';'+(completed?'text-decoration:line-through;':'')+'">'
      +esc(item.label)+'</span>'
      +'</div>';
  }).join('');
  if (contentEl) contentEl.innerHTML = html || '<div style="padding:20px 0;text-align:center;color:#888;font-size:14px">No checklist items</div>';
  if (progEl) {
    if (isToday) {
      var pct = items.length ? Math.round(done/items.length*100) : 0;
      progEl.innerHTML = '<div style="font-size:12px;color:#5a5752;margin-bottom:6px">'+done+' of '+items.length+' completed</div>'
        +'<div style="background:#f0ede8;border-radius:6px;height:8px;overflow:hidden">'
        +'<div style="background:#2D7A3A;height:100%;width:'+pct+'%;border-radius:6px"></div>'
        +'</div>';
    } else {
      progEl.innerHTML = '<div style="font-size:12px;color:#5a5752;padding:4px 0">HACCP checklist for '+esc(parts[0]||job.eventDate)+'</div>';
    }
  }
  modal.style.display = 'flex';
}

function _checkJobConflictsOnLoad() {
  var guests = _getJobGuestsForConflict();
  if (!guests.length) { _renderAllergenConflictBanners([]); return; }
  var dishMap = _getJobDishAllergenMap();
  records.filter(function(r){ return r.type==='allergen'; }).forEach(function(r){
    (r.allergens||[]).forEach(function(a){ if(!dishMap[a]) dishMap[a]=[]; if(dishMap[a].indexOf(r.dish)===-1) dishMap[a].push(r.dish); });
  });
  var conflictLines = [];
  guests.forEach(function(g){
    var hits = (g.allergens||[]).filter(function(a){ return dishMap[a]; });
    if (hits.length) conflictLines.push(esc(g.name)+' — '+hits.map(function(a){ return a+' (in: '+dishMap[a].join(', ')+')'; }).join('; '));
  });
  _renderAllergenConflictBanners(conflictLines);
}

// --- THRESHOLD VALIDATION ---
var THRESHOLD_BOUNDS = {
  'fridge-warn':   { min: 0,   max: 8   },
  'fridge-fail':   { min: 1,   max: 8   },
  'freezer-warn':  { min: -25, max: -10 },
  'freezer-fail':  { min: -25, max: -10 },
  'cooking-warn':  { min: 63,  max: 90  },
  'cooking-fail':  { min: 63,  max: 90  },
  'reheat-warn':   { min: 63,  max: 90  },
  'reheat-fail':   { min: 63,  max: 90  },
  'cooling-warn':  { min: 0,   max: 21  },
  'cooling-fail':  { min: 0,   max: 21  },
  'delivery-warn': { min: 0,   max: 8   },
  'delivery-fail': { min: 0,   max: 8   },
  'chilled-warn':  { min: 0,   max: 8   },
  'chilled-fail':  { min: 0,   max: 8   },
  'frozen-warn':   { min: -25, max: -10 },
  'frozen-fail':   { min: -25, max: -10 }
};

function validateThresholds(thresholds) {
  var errors = [];
  Object.keys(thresholds).forEach(function(key) {
    var bounds = THRESHOLD_BOUNDS[key];
    if (!bounds) return;
    var val = thresholds[key];
    if (val < bounds.min || val > bounds.max) {
      errors.push(key + ' must be between ' + bounds.min + '°C and ' + bounds.max + '°C (got ' + val + '°C)');
    }
  });
  return errors;
}

// --- JOB PACKET ---
function _findJobForToday() {
  var today = todayStr();
  var found = null;
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!k || k.indexOf('mise_') !== 0 || k === 'mise_settings') continue;
      var recs = JSON.parse(localStorage.getItem(k) || '[]');
      for (var j = 0; j < recs.length; j++) {
        if (recs[j].type === 'job' && recs[j].eventDate === today) { found = recs[j]; break; }
      }
      if (found) break;
    }
  } catch(e) {}
  _haccpActiveJob = found;
  _renderActiveJobBanner();
  _checkJobConflictsOnLoad();
}

function _renderActiveJobBanner() {
  var b = document.getElementById('active-job-banner');
  if (!b) return;
  if (!_haccpActiveJob) { b.style.display = 'none'; b.innerHTML = ''; return; }
  var j = _haccpActiveJob;
  var gCount = (j.guests || []).length;
  var gWithAllergens = (j.guests || []).filter(function(g){ return g.allergens && g.allergens.length; }).length;
  b.style.display = 'block';
  b.innerHTML = '🗓 Today: ' + esc(j.client)
    + (j.covers ? ' · ' + esc(j.covers) + ' covers' : '')
    + (gCount ? ' · ' + gCount + ' guest' + (gCount !== 1 ? 's' : '')
        + (gWithAllergens ? ' (' + gWithAllergens + ' with allergen requirements)' : '') : '');
}

function _getJobGuestsForConflict() {
  if (_haccpActiveJob) return _haccpActiveJob.guests || [];
  return settings.allergenGuests || [];
}

function _getJobDishAllergenMap() {
  var map = {};
  if (!_haccpActiveJob) return map;
  (_haccpActiveJob.menus || []).forEach(function(m) {
    (m.dishes || []).forEach(function(d) {
      (d.allergens || []).forEach(function(a) {
        if (!map[a]) map[a] = [];
        if (map[a].indexOf(d.dish) === -1) map[a].push(d.dish);
      });
    });
  });
  return map;
}

function _checkImmediateConflict(dishName, allergensPresentArray) {
  if (!allergensPresentArray || !allergensPresentArray.length) return;
  var guests = _getJobGuestsForConflict();
  var conflicts = [];
  guests.forEach(function(g) {
    var hits = (g.allergens || []).filter(function(a){ return allergensPresentArray.indexOf(a) !== -1; });
    if (hits.length) conflicts.push(esc(g.name) + ': ' + hits.map(esc).join(', '));
  });
  if (conflicts.length) {
    toast('⚠ ALLERGEN CONFLICT — ' + conflicts.join(' | '), false);
    renderAllergenGuests();
    _renderAllergenConflictBanners(conflicts);
  }
  return conflicts.length > 0;
}

function _checkCookingConflict(foodName) {
  if (!_haccpActiveJob || !foodName) return;
  var dishMap = _getJobDishAllergenMap();
  var foodLower = foodName.toLowerCase();
  var conflicts = [];
  var guests = _getJobGuestsForConflict();
  Object.keys(dishMap).forEach(function(allergen) {
    var matchesDish = dishMap[allergen].some(function(d){ return d.toLowerCase().indexOf(foodLower) !== -1 || foodLower.indexOf(d.toLowerCase()) !== -1; });
    if (!matchesDish) return;
    guests.forEach(function(g) {
      if ((g.allergens || []).indexOf(allergen) !== -1) {
        conflicts.push(esc(g.name) + ': ' + esc(allergen) + ' in ' + esc(foodName));
      }
    });
  });
  if (conflicts.length) toast('⚠ ALLERGEN CONFLICT — ' + conflicts.join(' | '), false);
}

function _pushRecord(rec) {
  if (_haccpActiveJob) rec.jobId = _haccpActiveJob.id;
  records.push(rec);
}

// --- INIT ---
loadHaccpSettings();
loadHaccpToday();
_findJobForToday();
populateHaccpSelects();
renderChecklists();
initPrivateChefMode();
haccpTab('home');
renderHaccpSections();
_restoreShiftState();
function openCarte(jobId) {
  if (typeof showModule === 'function') {
    showModule('menus');
    if (jobId) {
      // Navigate to Jobs tab and expand the job card
      setTimeout(function() {
        if (typeof showTab === 'function') showTab('jobs');
        setTimeout(function() {
          if (typeof toggleJobCard === 'function') toggleJobCard(String(jobId));
          // Scroll the expanded card into view
          setTimeout(function() {
            var el = document.querySelector('[data-job-id="' + jobId + '"]');
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 100);
        }, 50);
      }, 150);
    }
  } else {
    window.location.href = '/app';
  }
}
function openYield() { if (typeof showModule === 'function') showModule('costing'); else window.location.href = '/app'; }

function _printNextJobAllergenMatrix(job) {
  var jobDishes = [];
  if (job.menus && job.menus.length) {
    job.menus.forEach(function(m){ if (m.dishes) jobDishes = jobDishes.concat(m.dishes); });
  }
  if (!jobDishes.length) { alert('No dishes on this job\'s menu yet.'); return; }

  function _e(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  var tableRows = '';
  jobDishes.forEach(function(d) {
    var libDish = (settings.savedDishes || []).find(function(ld){ return ld.dish === d.dish; });
    var dishAllergens = (d.allergens || []).concat(libDish ? (libDish.allergens || []) : []);
    var row = '<tr><td class="dc">' + _e(d.dish || 'Unnamed dish') + '</td>';
    ALLERGENS_14.forEach(function(a) {
      var hit = dishAllergens.indexOf(a) !== -1;
      row += '<td class="ac' + (hit ? ' hit' : '') + '">' + (hit ? '✓' : '') + '</td>';
    });
    row += '</tr>';
    tableRows += row;
  });

  var headers = ALLERGENS_14.map(function(a){
    return '<th class="ah"><span>' + _e(a) + '</span></th>';
  }).join('');

  var clientName = _e(job.client || 'Unknown client');
  var dateStr = job.eventDate ? fmtDate(job.eventDate) : '';
  var coverStr = job.covers ? job.covers + ' covers' : '';
  var businessName = _e(settings.businessName || settings.chefName || '');
  var todayStr = new Date().toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });

  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8">'
    + '<title>Allergen Matrix</title>'
    + '<style>'
    + 'body{font-family:-apple-system,Arial,sans-serif;color:#111;background:#fff;margin:0;padding:28px 32px}'
    + '@page{size:A4 landscape;margin:1.5cm}'
    + '.header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111;padding-bottom:14px;margin-bottom:20px}'
    + '.hl h1{font-size:22px;font-weight:700;margin:0 0 3px}'
    + '.hl p{font-size:13px;color:#444;margin:0}'
    + '.hr{text-align:right;font-size:12px;color:#555;line-height:1.5}'
    + 'table{width:100%;border-collapse:collapse}'
    + 'th.dish-th{text-align:left;padding:8px 10px;border:1px solid #ccc;background:#f4f4f4;font-size:11px;min-width:140px}'
    + '.ah{padding:4px 3px;border:1px solid #ccc;background:#f4f4f4;text-align:center;vertical-align:bottom}'
    + '.ah span{writing-mode:vertical-rl;transform:rotate(180deg);display:block;height:100px;font-size:10px;font-weight:600;white-space:nowrap}'
    + '.dc{padding:8px 10px;border:1px solid #ddd;font-weight:600;font-size:12px;background:#fafafa}'
    + '.ac{padding:7px 4px;border:1px solid #ddd;text-align:center;font-size:13px;color:#999}'
    + '.ac.hit{background:#fff3cd;color:#7a5a00;font-weight:700}'
    + '.footer{margin-top:14px;font-size:10px;color:#999;display:flex;justify-content:space-between}'
    + '</style></head><body>'
    + '<div class="header">'
    + '<div class="hl"><h1>Allergen Matrix</h1>'
    + '<p>' + clientName + (dateStr ? ' &nbsp;·&nbsp; ' + dateStr : '') + (coverStr ? ' &nbsp;·&nbsp; ' + coverStr : '') + '</p></div>'
    + '<div class="hr">' + (businessName ? businessName + '<br>' : '') + 'Printed ' + todayStr + '</div>'
    + '</div>'
    + '<table><thead><tr><th class="dish-th">Dish</th>' + headers + '</tr></thead>'
    + '<tbody>' + tableRows + '</tbody></table>'
    + '<div class="footer"><span>✓ = allergen present as an intentional ingredient &nbsp;·&nbsp; Highlighted = allergen present</span>'
    + '<span>Always verify with your supplier &nbsp;·&nbsp; Generated by Veriqo</span></div>'
    + '</body></html>';

  var w = window.open('', '_blank');
  if (!w) { alert('Allow pop-ups to print the allergen matrix.'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.addEventListener('load', function() { w.print(); });
}

// ── NUDGE_MAP — cross-module upgrade nudges ────────────────
var HACCP_NUDGE_MAP = {
  delivery_logged: { module: 'costing', text: "Track this supplier's pricing in Costing →" },
  dish_added:      { module: 'menus',   text: 'Build a full spec sheet for this dish in Menus →' }
};
var _haccp_nudge_dismissed = {};

function showNudge(key) {
  var nudge = HACCP_NUDGE_MAP[key];
  if (!nudge) return;
  if (_haccp_nudge_dismissed[key]) return;
  // Only show if the target module is locked
  if (typeof canAccess === 'function' && canAccess(nudge.module)) return;

  // Remove any existing nudge
  var existing = document.getElementById('haccp-nudge-banner');
  if (existing) existing.remove();

  var container = document.getElementById('module-haccp');
  if (!container) return;
  var header = container.querySelector('.header');
  if (!header) return;

  var el = document.createElement('div');
  el.id = 'haccp-nudge-banner';
  el.className = 'module-nudge';
  el.innerHTML = '<span>' + nudge.text.replace(' →', '') + '</span>'
    + '<a href="#" onclick="event.preventDefault();showModule(\'' + nudge.module + '\');">' + nudge.text.match(/→/) ? 'Unlock →' : 'View →' + '</a>'
    + '<button class="module-nudge-dismiss" onclick="document.getElementById(\'haccp-nudge-banner\').remove();_haccp_nudge_dismissed[\'' + key + '\']=true;" aria-label="Dismiss">&times;</button>';
  header.insertAdjacentElement('afterend', el);
}
