// ═══════════════════════════════════════════════════════ CONSTANTS & STATE ═══
// Canonical list now lives in js/core/allergens.js (loaded before this file) —
// keep this local alias so existing call sites below don't all need editing.
var ALLERGENS_14 = window.Veriqo.ALLERGENS_14;
var DISH_CATEGORIES = ['','Canapé','Starter','Fish course','Main','Side','Sauce','Pre-dessert','Dessert','Cheese','Petit four','Bread','Other'];
var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
var DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

var mSettings = {};
var mRecords  = [];  // today's job records
var TODAY = (function(){ var d = new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })();
var _activeTab = 'home';
var _calYear   = new Date().getFullYear();
var _calMonth  = new Date().getMonth();
var _calSelectedDate = null;
var _expandedClientId = null;
var _expandedJobId    = null;
var _editingJobId     = null;
var _editingJobGuests = {};
var _newJobFormOpen   = false;
var _pastJobsOpen     = false;

// ═══════════════════════════════════════════════════════ UTILITIES ═══════════
function _esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function fmtDate(d){
  if(!d) return '';
  var parts = d.split('-');
  if(parts.length !== 3) return d;
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return parseInt(parts[2],10)+' '+months[parseInt(parts[1],10)-1]+' '+parts[0];
}
function fmtDateLong(d){
  if(!d) return '';
  var dt = new Date(d + 'T12:00:00');
  var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return days[dt.getDay()]+' '+dt.getDate()+' '+months[dt.getMonth()]+' '+dt.getFullYear();
}
function daysUntil(dateStr){
  var now = new Date(TODAY + 'T00:00:00');
  var then = new Date(dateStr + 'T00:00:00');
  return Math.round((then - now) / 86400000);
}
function toast(msg, type){
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = type === 'err' ? '#8A2D2D' : type === 'warn' ? '#8A6820' : '#1C2B1E';
  t.style.color = '#F5F0E8';
  t.classList.add('show');
  setTimeout(function(){ t.classList.remove('show'); }, 2800);
}
function initAllergenGrid(){
  var g = document.getElementById('al-allergens-grid');
  if(!g) return;
  g.innerHTML = ALLERGENS_14.map(function(a){
    return '<label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#1C2B1E;padding:5px 8px;border:1px solid #E2DDD5;border-radius:6px;cursor:pointer;background:#fff">'
      + '<input type="checkbox" id="al-a-'+a.replace(/\s/g,'_')+'" style="accent-color:#3A7D44">'
      + _esc(a) + '</label>';
  }).join('');
}
function initDishAllergenGrid(){
  var g = document.getElementById('dish-allergens-grid');
  if(!g) return;
  g.innerHTML = ALLERGENS_14.map(function(a){
    return '<label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#1C2B1E;padding:5px 8px;border:1px solid #E2DDD5;border-radius:6px;cursor:pointer;background:#fff">'
      + '<input type="checkbox" id="dish-a-'+a.replace(/\s/g,'_')+'" style="accent-color:#3A7D44">'
      + _esc(a) + '</label>';
  }).join('');
}
function getDishAllergens(){
  return ALLERGENS_14.filter(function(a){
    var el = document.getElementById('dish-a-'+a.replace(/\s/g,'_'));
    return el && el.checked;
  });
}
function setDishAllergens(arr){
  arr = _normaliseAllergens(arr);
  ALLERGENS_14.forEach(function(a){
    var el = document.getElementById('dish-a-'+a.replace(/\s/g,'_'));
    if(el) el.checked = arr.indexOf(a) !== -1;
  });
}
function _normaliseAllergens(value){
  if(Array.isArray(value)) return value.filter(Boolean);
  if(!value) return [];
  return String(value).split(',').map(function(a){ return a.trim(); }).filter(Boolean);
}

// ═══════════════════════════════════════════════════════ SETTINGS ═══════════
function loadMiseSettings(){
  try { mSettings = JSON.parse(localStorage.getItem('mise_settings') || '{}'); } catch(e){ mSettings = {}; }
  mSettings.dashboardConfig = mSettings.dashboardConfig || { showNextBooking: true, showStats: true, showQuickActions: true };
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
  } catch (e) { console.warn('[Carte] loadEmailPreferences:', e); }
}

async function setEmailPref(optedIn){
  var toggle = document.getElementById('email-pref-toggle');
  var userId = toggle && toggle.dataset.userId;
  if (!userId || typeof supabaseClient === 'undefined' || !supabaseClient) return;
  try {
    var res = await supabaseClient.from('profiles').update({ email_opt_out: !optedIn }).eq('id', userId);
    if (res.error) throw res.error;
    toast(optedIn ? 'Emails turned back on ✓' : 'Emails turned off ✓');
  } catch (e) {
    console.error('[Carte] setEmailPref:', e);
    toast('Could not save preference', false);
    if (toggle) toggle.checked = !optedIn;
  }
}

function saveMiseSettings(){
  try { localStorage.setItem('mise_settings', JSON.stringify(mSettings)); } catch(e){}
  // Optional cloud sync via shared Mise.sync if available
  if (window.Mise && window.Mise.sync) Mise.sync.saveSettings(mSettings, 'menus');
}

// ═══════════════════════════════════════════════════════ RECORDS ════════════
function loadMiseToday(){
  try { mRecords = JSON.parse(localStorage.getItem('mise_'+TODAY) || '[]'); } catch(e){ mRecords = []; }
}
function saveMiseToday(){
  try { localStorage.setItem('mise_'+TODAY, JSON.stringify(mRecords)); } catch(e){}
  if (window.Mise && window.Mise.sync) Mise.sync.saveDay(TODAY, mRecords, 'menus');
}
function getDayRecords(ds){
  try { return JSON.parse(localStorage.getItem('mise_'+ds) || '[]'); } catch(e){ return []; }
}
function saveDayRecords(ds, arr){
  try { localStorage.setItem('mise_'+ds, JSON.stringify(arr)); } catch(e){}
  // Strip Yield-sourced jobs before syncing to mise_records — they live in the shared jobs table only
  var carteRecords = arr.filter(function(r){ return !r._fromYield; });
  if (window.Mise && window.Mise.sync) Mise.sync.saveDay(ds, carteRecords, 'menus');
}
function getAllJobs(){
  var all = []; var seen = {};
  mRecords.filter(function(r){ return r.type==='job'; }).forEach(function(r){
    if(!seen[r.id]){ seen[r.id]=true; all.push(r); }
  });
  try {
    for(var i=0;i<localStorage.length;i++){
      var k=localStorage.key(i);
      if(!k || k.indexOf('mise_')!==0 || k==='mise_settings') continue;
      var ds=k.replace('mise_','');
      getDayRecords(ds).filter(function(r){ return r.type==='job'; }).forEach(function(r){
        if(!seen[r.id]){ seen[r.id]=true; all.push(r); }
      });
    }
  } catch(e){}
  all.sort(function(a,b){ return (b.eventDate||'').localeCompare(a.eventDate||''); });
  return all;
}
function getAllTypeRecords(type){
  var all = []; var seen = {};
  mRecords.filter(function(r){ return r.type===type; }).forEach(function(r){
    if(!seen[r.id]){ seen[r.id]=true; all.push(r); }
  });
  try {
    for(var i=0;i<localStorage.length;i++){
      var k=localStorage.key(i);
      if(!k||k.indexOf('mise_')!==0||k==='mise_settings') continue;
      var ds=k.replace('mise_','');
      getDayRecords(ds).filter(function(r){ return r.type===type; }).forEach(function(r){
        if(!seen[r.id]){ seen[r.id]=true; all.push(r); }
      });
    }
  } catch(e){}
  all.sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); });
  return all;
}

// ═══════════════════════════════════════════════════════ ADDRESS BOOK ════════
function getAddressBook(){
  var book=[]; var seen={};
  (mSettings.savedClients||[]).forEach(function(c){
    var norm=c.name.trim().toLowerCase(); seen[norm]=true;
    book.push({key:'crm_'+c.id, name:c.name, address:c.address||'', phone:c.phone||'', email:c.email||'', diet:c.diet||'', fromCRM:true});
  });
  mRecords.filter(function(r){ return r.type==='job' && r.client; }).forEach(function(r){
    var norm=r.client.trim().toLowerCase();
    if(seen[norm]) return; seen[norm]=true;
    book.push({key:'hist_'+norm, name:r.client, address:r.location||'', phone:'', email:'', diet:'', fromCRM:false});
  });
  try {
    for(var i=0;i<localStorage.length;i++){
      var k=localStorage.key(i);
      if(!k||k.indexOf('mise_')!==0||k==='mise_settings') continue;
      var ds=k.replace('mise_','');
      getDayRecords(ds).filter(function(r){ return r.type==='job' && r.client; }).forEach(function(r){
        var norm=r.client.trim().toLowerCase();
        if(seen[norm]) return; seen[norm]=true;
        book.push({key:'hist_'+norm, name:r.client, address:r.location||'', phone:'', email:'', diet:'', fromCRM:false});
      });
    }
  } catch(e){}
  book.sort(function(a,b){ return a.name.localeCompare(b.name); });
  return book;
}
function addressBookLookup(key){
  return getAddressBook().find(function(e){ return e.key===key; }) || null;
}

// ═══════════════════════════════════════════════════════ NAVIGATION ══════════
var _homeScrollPos = 0;
var _NAV_TABS = ['home','clients','calendar','menus','more'];
var _SECTION_TABS = ['clients','calendar','menus','jobs','more','transport','assess','allergen','credentials','mise-settings','install','help','legal','prep'];
var _TITLES = {
  clients:'Clients', calendar:'Calendar', menus:'Menus & Dishes', jobs:'Jobs',
  more:'More', transport:'Transport Temps', assess:'Kitchen Assessment',
  allergen:'Allergen Log', credentials:'Credentials', 'mise-settings':'Settings',
  install:'Save as App', help:'Help & Getting Started', legal:'Privacy & Legal',
  prep:'Prep Lists'
};


function showTab(name){
  if(name !== 'home') _homeScrollPos = window.scrollY || 0;

  // Show/hide sections
  var menus_home = document.getElementById('menus-tab-home');
  if(menus_home) menus_home.style.display = name==='home' ? 'block' : 'none';
  _SECTION_TABS.forEach(function(t){
    var el = document.getElementById('tab-'+t);
    if(el) el.classList.toggle('active', t===name);
  });

  // Back button
  var backBtn = document.getElementById('menus-back-btn');
  if(backBtn) backBtn.style.display = name==='home' ? 'none' : 'block';

  // Header sub-label
  var headerTitle = document.getElementById('mise-header-title');
  if(headerTitle) headerTitle.textContent = name==='home' ? 'Menus' : (_TITLES[name]||name);

  // Nav button active state (bottom nav + sidebar)
  _NAV_TABS.forEach(function(t){
    var isActive = t===name || (t==='more' && ['more','assess','allergen','credentials','mise-settings','install','help','legal'].indexOf(name)!==-1);
    var btn = document.getElementById('nav-'+t);
    if(btn) btn.classList.toggle('active', isActive);
    var sideBtn = document.getElementById('snav-'+t);
    if(sideBtn) sideBtn.classList.toggle('active', isActive);
  });

  _activeTab = name;

  // Tab-specific renders
  if(name==='home')        updateDashboard();
  if(name==='clients')     { renderClientList(); populateClientSelects(); }
  if(name==='calendar')    renderCalendar();
  if(name==='menus')       { renderDishLibrary(); renderMenuDishSelect(); renderSavedMenus(); }
  if(name==='jobs')        { populateJobClientSelect(); renderJobsHistory(); renderJobMenuPicker(); renderTemplateDropdown(); }
  if(name==='transport')   { populateStaffSelects(); populateClientSelects(); renderTransportList(); }
  if(name==='assess')      { populateStaffSelects(); populateClientSelects(); renderAssessList(); }
  if(name==='allergen')    { populateClientSelects(); renderAllergenList(); }
  if(name==='credentials') { populateStaffSelects(); renderCredentialsList(); }
  if(name==='mise-settings')    { loadProfileUI(); renderStaffList(); loadSettingsToggles(); renderCarteSubscriptionCard(); loadEmailPreferences(); }
  if(name==='prep')             { if (typeof renderPrepIndex === 'function') renderPrepIndex(); }

  // Set date fields to today if empty
  ['tr-date','as-date'].forEach(function(id){
    var el = document.getElementById(id);
    if(el && !el.value) el.value = TODAY;
  });

  if(name === 'home'){ window.scrollTo(0, _homeScrollPos); }
  else { window.scrollTo(0, 0); }
}

// ═══════════════════════════════════════════════════════ DASHBOARD ══════════
function updateDashboard(){
  // Greeting (vq-module-greeting block handles the header; no legacy dash-greeting divs)

  // Find next upcoming job
  var allJobs = getAllJobs();
  var upcoming = allJobs.filter(function(j){ return j.eventDate && j.eventDate >= TODAY; })
                        .sort(function(a,b){ return a.eventDate.localeCompare(b.eventDate); });
  var cfg      = mSettings.dashboardConfig || {};
  var nextBook = document.getElementById('dash-next');
  var noNext   = document.getElementById('dash-no-next');
  if(cfg.showNextBooking === false){
    nextBook.style.display = 'none';
    noNext.style.display   = 'none';
  } else if(upcoming.length > 0){
    var nj = upcoming[0];
    nextBook.style.display = 'block';
    nextBook.dataset.jobId = nj.id;
    noNext.style.display   = 'none';
    document.getElementById('dash-next-client').textContent = nj.client || 'Unnamed client';
    var d = daysUntil(nj.eventDate);
    var dStr = d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : 'In '+d+' days';
    var meta = dStr + ' · ' + fmtDate(nj.eventDate);
    if(nj.covers) meta += ' · ' + nj.covers + ' covers';
    if(nj.jobType) meta += ' · ' + nj.jobType;
    document.getElementById('dash-next-meta').textContent = meta;
  } else {
    nextBook.style.display = 'none';
    noNext.style.display   = 'block';
  }

  // Stats
  var clients = (mSettings.savedClients||[]).length;
  var thisMonth = new Date().toISOString().slice(0,7);
  var monthJobs = allJobs.filter(function(j){ return (j.eventDate||'').slice(0,7)===thisMonth; }).length;
  document.getElementById('dash-stat-clients').textContent  = clients;
  document.getElementById('dash-stat-upcoming').textContent = upcoming.length;
  document.getElementById('dash-stat-month').textContent    = monthJobs;
  var lblC = document.getElementById('dash-lbl-clients');
  if (lblC) lblC.textContent = clients === 1 ? 'Client' : 'Clients';
  var lblU = document.getElementById('dash-lbl-upcoming');
  if (lblU) lblU.textContent = upcoming.length === 1 ? 'Upcoming' : 'Upcoming';
  var statsEl = document.getElementById('dash-stats-strip');
  if(statsEl) statsEl.style.display = cfg.showStats !== false ? '' : 'none';
  var qaEl = document.getElementById('dash-quick-actions');
  if(qaEl) qaEl.style.display = cfg.showQuickActions !== false ? '' : 'none';

  // Tile sub-labels
  var nextCal = upcoming.length > 0 ? fmtDate(upcoming[0].eventDate) : 'No bookings';
  var elCal   = document.getElementById('tile-sub-calendar');
  if(elCal) elCal.textContent = nextCal;
  var dishes  = (mSettings.savedDishes||[]).length;
  var menus   = (mSettings.savedMenus||[]).length;
  var elMenus = document.getElementById('tile-sub-menus');
  if(elMenus) elMenus.textContent = dishes + ' dishes · ' + menus + ' menus';
  var elJobs = document.getElementById('tile-sub-jobs');
  if(elJobs) elJobs.textContent = allJobs.length + ' total';

  // Balance warning banner
  var warnBanner = document.getElementById('dash-balance-warn');
  var warnText   = document.getElementById('dash-balance-warn-text');
  if(warnBanner && warnText) {
    var flagged = upcoming.filter(function(j) {
      return !j.tabBalancePaid && daysUntil(j.eventDate) <= 3;
    });
    if(flagged.length > 0) {
      var earliest = flagged[0];
      var d = daysUntil(earliest.eventDate);
      var dLabel = d === 0 ? 'today' : d === 1 ? 'tomorrow' : 'in ' + d + ' days';
      warnText.textContent = flagged.length === 1
        ? 'Balance unpaid — ' + (earliest.client || 'upcoming job') + ' is ' + dLabel
        : flagged.length + ' jobs with balance outstanding within 3 days';
      warnBanner.style.display = 'block';
    } else {
      warnBanner.style.display = 'none';
    }
  }
}

function startNewJob(){
  showTab('jobs');
  setTimeout(function(){
    if(!_newJobFormOpen) toggleNewJobForm();
    var el = document.getElementById('job-event-date');
    if(el && !el.value) el.value = TODAY;
    window.scrollTo(0,0);
  }, 80);
}

function toggleNewJobForm(){
  _newJobFormOpen = !_newJobFormOpen;
  var form = document.getElementById('new-job-form');
  var btn  = document.getElementById('new-job-btn');
  if(form) form.style.display = _newJobFormOpen ? 'block' : 'none';
  if(btn)  btn.textContent    = _newJobFormOpen ? '✕  Cancel' : '＋ Book a New Job';
  if(_newJobFormOpen){
    _jobMenuState['log'] = [];
    _renderMenuState('log');
    var el = document.getElementById('job-event-date');
    if(el && !el.value) el.value = TODAY;
  }
}

function togglePastJobs(){
  _pastJobsOpen = !_pastJobsOpen;
  var el = document.getElementById('jobs-past');
  if(el) el.style.display = _pastJobsOpen ? 'block' : 'none';
  renderJobsHistory();
}

// ═══════════════════════════════════════════════════════ CLIENTS / CRM ══════
function addClient(){
  var name = (document.getElementById('cl-name').value||'').trim();
  if(!name){ toast('Client name required', 'err'); return; }
  var client = {
    id: uid(),
    name: name,
    address: (document.getElementById('cl-address').value||'').trim(),
    phone:   (document.getElementById('cl-phone').value||'').trim(),
    email:   (document.getElementById('cl-email').value||'').trim(),
    diet:    (document.getElementById('cl-diet').value||'').trim()
  };
  if(!mSettings.savedClients) mSettings.savedClients = [];
  mSettings.savedClients.push(client);
  saveMiseSettings();
  if (window.Mise && window.Mise.sync && window.Mise.sync.saveClient) Mise.sync.saveClient(client);
  ['cl-name','cl-address','cl-phone','cl-email','cl-diet'].forEach(function(id){
    document.getElementById(id).value='';
  });
  renderClientList();
  populateClientSelects();
  toast('Client saved ✓');
  showScriptModal(1);
}

function renderClientList(){
  var list = document.getElementById('clients-list');
  if(!list) return;
  var clients = mSettings.savedClients || [];
  if(clients.length === 0){
    list.innerHTML = '<p class="empty">No clients yet. Add one above.</p>';
    return;
  }
  list.innerHTML = clients.map(function(c){
    var initials = c.name.trim().split(/\s+/).map(function(w){ return w[0]; }).slice(0,2).join('').toUpperCase();
    var isOpen = _expandedClientId === c.id;
    var quickBtns = '';
    if(c.phone) quickBtns += '<a class="contact-link" href="tel:'+_esc(c.phone)+'" onclick="event.stopPropagation()"><span class="contact-icon">📞</span>Call</a>';
    if(c.email) quickBtns += '<a class="contact-link" href="mailto:'+_esc(c.email)+'" onclick="event.stopPropagation()"><span class="contact-icon" style="display:inline-flex;align-items:center">'+vqIcon('mail',14)+'</span>Email</a>';
    if(c.address) quickBtns += '<a class="contact-link" href="https://maps.apple.com/?q='+encodeURIComponent(c.address)+'" target="_blank" onclick="event.stopPropagation()"><span class="contact-icon">📍</span>Map</a>';
    var headerHtml = '<div class="client-card-header" onclick="clientToggle(\''+c.id+'\')">'
      + '<div class="client-avatar">'+_esc(initials)+'</div>'
      + '<div class="client-info"><div class="client-name">'+_esc(c.name)+'</div>'
      + (c.diet ? '<div class="client-sub">'+_esc(c.diet)+'</div>' : (c.address ? '<div class="client-sub">'+_esc(c.address.split(',')[0])+'</div>' : ''))
      + (quickBtns ? '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:7px">'+quickBtns+'</div>' : '')
      + '</div><div class="client-expand">'+(isOpen?'▲':'▼')+'</div></div>';

    var bodyHtml = '';
    if(isOpen){
      var editHtml = '<div style="padding-top:12px">'
        + '<div class="form-group"><label class="form-label">Name</label>'
        + '<input class="form-input" id="cedit-name-'+c.id+'" value="'+_esc(c.name)+'"></div>'
        + '<div class="form-group"><label class="form-label">Address</label>'
        + '<input class="form-input" id="cedit-address-'+c.id+'" value="'+_esc(c.address)+'"></div>'
        + '<div class="form-row">'
        + '<div class="form-group"><label class="form-label">Phone</label><input class="form-input" id="cedit-phone-'+c.id+'" value="'+_esc(c.phone)+'"></div>'
        + '<div class="form-group"><label class="form-label">Email</label><input class="form-input" id="cedit-email-'+c.id+'" value="'+_esc(c.email)+'"></div>'
        + '</div><div class="form-group"><label class="form-label">Dietary notes</label>'
        + '<input class="form-input" id="cedit-diet-'+c.id+'" value="'+_esc(c.diet)+'"></div>'
        + '<div style="display:flex;gap:8px;margin-top:4px">'
        + '<button class="btn-primary btn-green" style="flex:1;margin-top:0" onclick="clientSaveEdit(\''+c.id+'\')">Save</button>'
        + '<button style="flex:0 0 auto;padding:12px 16px;background:#FBECEC;color:#8A2D2D;border:1px solid #E8C5C5;border-radius:8px;font-size:14px;cursor:pointer;font-family:inherit" onclick="clientDelete(\''+c.id+'\')">Delete</button>'
        + '</div></div>';

      var contactsHtml = '';
      if(c.phone) contactsHtml += '<a class="contact-link" href="tel:'+_esc(c.phone)+'"><span class="contact-icon">📞</span>'+_esc(c.phone)+'</a>';
      if(c.email) contactsHtml += '<a class="contact-link" href="mailto:'+_esc(c.email)+'"><span class="contact-icon" style="display:inline-flex;align-items:center">'+vqIcon('mail',14)+'</span>'+_esc(c.email)+'</a>';
      if(c.address) contactsHtml += '<a class="contact-link" href="https://maps.apple.com/?q='+encodeURIComponent(c.address)+'" target="_blank"><span class="contact-icon">📍</span>'+_esc(c.address)+'</a>';

      bodyHtml = '<div class="client-body">'
        + (contactsHtml ? '<div style="padding:6px 0 0">'+contactsHtml+'</div>' : '')
        + editHtml + '</div>';
    }
    return '<div class="client-card">'+headerHtml+bodyHtml+'</div>';
  }).join('');
}

function clientToggle(id){
  _expandedClientId = (_expandedClientId === id) ? null : id;
  renderClientList();
}

function clientSaveEdit(id){
  var fields = ['name','address','phone','email','diet'];
  var updates = {};
  fields.forEach(function(f){
    var el = document.getElementById('cedit-'+f+'-'+id);
    updates[f] = el ? el.value.trim() : '';
  });
  if(!updates.name){ toast('Name required','err'); return; }
  mSettings.savedClients = (mSettings.savedClients||[]).map(function(c){
    return c.id===id ? Object.assign({},c,updates) : c;
  });
  _expandedClientId = null;
  saveMiseSettings();
  var _updClient = (mSettings.savedClients||[]).find(function(c){ return c.id===id; });
  if (_updClient && window.Mise && window.Mise.sync && window.Mise.sync.saveClient) Mise.sync.saveClient(_updClient);
  renderClientList();
  populateClientSelects();
  toast('Client updated ✓');
}

function clientDelete(id){
  if(!confirm('Delete this client? This cannot be undone.')) return;
  mSettings.savedClients = (mSettings.savedClients||[]).filter(function(c){ return c.id!==id; });
  _expandedClientId = null;
  saveMiseSettings();
  if (window.Mise && window.Mise.sync && window.Mise.sync.deleteClient) Mise.sync.deleteClient(id);
  renderClientList();
  populateClientSelects();
  toast('Client removed');
}

function populateClientSelects(){
  var book = getAddressBook();
  var opts = '<option value="">Select client…</option>'
    + book.map(function(e){
        return '<option value="'+_esc(e.key)+'">'+_esc(e.name)+(e.fromCRM?'':' *')+'</option>';
      }).join('');
  ['job-client-select','tr-client-select','as-client-select','al-client-select'].forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.innerHTML = opts;
  });
}

function jobFillFromCRM(key){
  if(!key) return;
  var e = addressBookLookup(key);
  if(!e) return;
  var mn = document.getElementById('job-client-manual');
  var loc = document.getElementById('job-location');
  if(mn) mn.value = e.name;
  if(loc && !loc.value) loc.value = e.address;
}
function trFillFromCRM(key){
  if(!key) return;
  var e = addressBookLookup(key);
  if(!e) return;
  var m = document.getElementById('tr-client-manual');
  var d = document.getElementById('tr-dest');
  if(m) m.value = e.name;
  if(d && !d.value) d.value = e.address;
}
function asFillFromCRM(key){
  if(!key) return;
  var e = addressBookLookup(key);
  if(!e) return;
  var m = document.getElementById('as-client');
  if(m) m.value = e.name;
}
function alFillFromCRM(key){
  if(!key) return;
  var e = addressBookLookup(key);
  if(!e) return;
  var m = document.getElementById('al-client');
  if(m) m.value = e.name;
}

// ═══════════════════════════════════════════════════════ CALENDAR ══════════
function calPrev(){ _calMonth--; if(_calMonth<0){_calMonth=11;_calYear--;} renderCalendar(); }
function calNext(){ _calMonth++; if(_calMonth>11){_calMonth=0;_calYear++;} renderCalendar(); }

function getAllJobsByDate(){
  var map = {};
  var seen = {};
  function add(r){
    if(r.type!=='job' || !r.eventDate) return;
    if(seen[r.id]) return;
    seen[r.id] = true;
    if(!map[r.eventDate]) map[r.eventDate]=[];
    map[r.eventDate].push(r);
  }
  mRecords.forEach(add);
  try {
    for(var i=0;i<localStorage.length;i++){
      var k=localStorage.key(i);
      if(!k||k.indexOf('mise_')!==0||k==='mise_settings') continue;
      getDayRecords(k.replace('mise_','')).forEach(add);
    }
  } catch(e){}
  return map;
}

function renderCalendar(){
  var label = document.getElementById('cal-month-label');
  var grid  = document.getElementById('cal-grid');
  if(!label||!grid) return;
  label.textContent = MONTHS[_calMonth] + ' ' + _calYear;

  var jobsByDate = getAllJobsByDate();
  var unavail    = mSettings.unavailableDates || [];

  // Day-of-week headers
  var html = DAYS.map(function(d){ return '<div class="cal-dow">'+d+'</div>'; }).join('');

  // Blank cells before 1st
  var first = new Date(_calYear, _calMonth, 1).getDay();
  for(var b=0;b<first;b++) html += '<div class="cal-day empty"></div>';

  // Day cells
  var daysInMonth = new Date(_calYear, _calMonth+1, 0).getDate();
  for(var day=1;day<=daysInMonth;day++){
    var ds = _calYear+'-'+String(_calMonth+1).padStart(2,'0')+'-'+String(day).padStart(2,'0');
    var isToday    = ds === TODAY;
    var isSelected = ds === _calSelectedDate;
    var isUnavail  = unavail.indexOf(ds) !== -1;
    var hasJob     = !!(jobsByDate[ds] && jobsByDate[ds].length);
    var isPast     = ds < TODAY;

    var cls = 'cal-day';
    if(isSelected)         cls += ' selected';
    else if(hasJob && isUnavail) cls += ' has-job unavail';
    else if(hasJob)        cls += ' has-job';
    else if(isUnavail)     cls += ' unavail';
    if(isToday && !isSelected) cls += ' today';
    if(isPast && !isToday) cls += ' past';

    var dot = (hasJob && !isSelected) ? '<div class="cal-dot"></div>' : '';
    html += '<div class="'+cls+'" onclick="calDayClick(\''+ds+'\')">'+day+dot+'</div>';
  }
  grid.innerHTML = html;

  // Detail panel
  var detail = document.getElementById('cal-detail');
  if(_calSelectedDate){
    detail.style.display = 'block';
    detail.innerHTML = _renderCalDetail(_calSelectedDate, jobsByDate);
  } else {
    detail.style.display = 'none';
  }
}

function calDayClick(ds){
  _calSelectedDate = (_calSelectedDate === ds) ? null : ds;
  renderCalendar();
}

function calToggleUnavailable(ds){
  if(!mSettings.unavailableDates) mSettings.unavailableDates = [];
  var idx = mSettings.unavailableDates.indexOf(ds);
  if(idx !== -1){ mSettings.unavailableDates.splice(idx,1); toast('Removed from unavailable'); }
  else { mSettings.unavailableDates.push(ds); toast('Marked unavailable'); }
  saveMiseSettings();
  renderCalendar();
}

function _renderCalDetail(ds, jobsByDate){
  var jobs    = jobsByDate[ds] || [];
  var unavail = (mSettings.unavailableDates||[]).indexOf(ds) !== -1;
  var isPast  = ds < TODAY;
  var html    = '<div class="card-title" style="margin-bottom:6px">'+fmtDateLong(ds)+'</div>';

  if(jobs.length > 0){
    jobs.forEach(function(j){
      html += '<div onclick="calViewJob(\''+j.id+'\')" style="padding:8px 0;border-bottom:1px solid #F0EBE2;cursor:pointer">'
        + '<div style="font-size:15px;font-weight:600;color:#1C2B1E">'+_esc(j.client||'Unnamed')+'</div>'
        + '<div style="font-size:13px;color:#7A7468;margin-top:3px">'
        + (j.eventTime ? j.eventTime+' · ' : '')
        + (j.covers ? j.covers+' covers · ' : '')
        + (j.jobType || '')
        + '</div>'
        + (j.location ? '<div style="font-size:12px;color:#A09890;margin-top:2px">📍 '+_esc(j.location)+'</div>' : '')
        + '</div>';
    });
  } else {
    html += '<div class="empty">No bookings on this date.</div>';
  }

  html += '<div style="display:flex;gap:8px;margin-top:12px">';
  if(!isPast){
    html += '<button onclick="calBookJob(\''+ds+'\')" style="flex:1;padding:11px;background:#3A7D44;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">＋ Book Job</button>';
  }
  if(unavail){
    html += '<button onclick="calToggleUnavailable(\''+ds+'\')" style="flex:1;padding:11px;background:#FBF0F0;color:#8A2D2D;border:1px solid #E8C5C5;border-radius:8px;font-size:13px;cursor:pointer;font-family:inherit">✓ Unavailable — remove</button>';
  } else if(!isPast){
    html += '<button onclick="calToggleUnavailable(\''+ds+'\')" style="flex:1;padding:11px;background:#F5F0E8;color:#5A544E;border:1px solid #E2DDD5;border-radius:8px;font-size:13px;cursor:pointer;font-family:inherit">Mark unavailable</button>';
  }
  html += '</div>';
  return html;
}

function calBookJob(ds){
  showTab('jobs');
  setTimeout(function(){
    var el = document.getElementById('job-event-date');
    if(el) el.value = ds;
    window.scrollTo(0,0);
  }, 120);
}

function calViewJob(id){
  _expandedJobId = id;
  var job = getAllJobs().filter(function(j){ return j.id === id; })[0];
  if(job && job.eventDate && job.eventDate < TODAY && !_pastJobsOpen){
    _pastJobsOpen = true;
  }
  showTab('jobs');
  setTimeout(function(){
    var el = document.querySelector('[data-job-id="'+id+'"]');
    if(el) el.scrollIntoView({behavior:'smooth', block:'center'});
  }, 150);
}

// ═══════════════════════════════════════════════════════ DISH LIBRARY ════════
function addDish(){
  var name = (document.getElementById('dish-name').value||'').trim();
  if(!name){ toast('Dish name required','err'); return; }
  if(!mSettings.savedDishes) mSettings.savedDishes = [];
  var dishData = {
    id: uid(),
    dish: name,
    category: document.getElementById('dish-cat').value||'',
    allergens: getDishAllergens()
  };
  mSettings.savedDishes.push(dishData);
  saveMiseSettings();
  if (window.Mise && window.Mise.sync && window.Mise.sync.saveDish) Mise.sync.saveDish(dishData);
  document.getElementById('dish-name').value='';
  document.getElementById('dish-cat').value='';
  setDishAllergens([]);
  _editingDishId = null;
  renderDishLibrary();
  renderMenuDishSelect();
  toast('Dish saved ✓');
  showMenusNudge('dish_added');
}

function _dishRowHTML(d) {
  var isEditing = _editingDishId !== null && String(_editingDishId) === String(d.id);
  var allergens = _normaliseAllergens(d.allergens);
  var catOptions = DISH_CATEGORIES.map(function(c){
    return '<option value="'+_esc(c)+'"'+(d.category===c?' selected':'')+'>'+_esc(c||'No category')+'</option>';
  }).join('');
  var prepTasksHtml = '<div style="margin-bottom:10px;padding:10px;background:#FFF8F5;border:1px solid #FFD5B8;border-radius:8px">'
    + '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#C05A18;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between">'
    + '<span>Prep Tasks</span>'
    + '<button id="prep-ai-btn-'+d.id+'" onclick="event.stopPropagation();generatePrepTasksAI()" style="background:#F97316;color:#fff;border:none;padding:3px 9px;border-radius:5px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;text-transform:none;letter-spacing:0">✨ AI</button>'
    + '</div>'
    + '<div id="prep-task-list-'+d.id+'">'
    + _editingDishPrepTasks.map(function(task){
        var icon = task.section==='finishing' ? '🔥' : '🥄';
        return '<div data-prep-task-id="'+task.id+'" style="display:flex;align-items:center;gap:6px;margin-bottom:6px;padding:7px 10px;background:#fff;border-radius:7px;border:1px solid #F0EDE8">'
          + '<span style="font-size:13px;flex-shrink:0">'+icon+'</span>'
          + '<div style="flex:1;font-size:13px;color:#1C2B1E">'+_esc(task.description)+'</div>'
          + '<button onclick="event.stopPropagation();editPrepTask(\''+task.id+'\')" style="background:none;border:none;color:#C0BDB5;font-size:13px;cursor:pointer;padding:0 3px;line-height:1;flex-shrink:0">✏️</button>'
          + '<button onclick="event.stopPropagation();removePrepTask(\''+task.id+'\')" style="background:none;border:none;color:#C0BDB5;font-size:16px;cursor:pointer;padding:0;line-height:1;flex-shrink:0">&times;</button>'
          + '</div>';
      }).join('')
    + '</div>'
    + '<div style="display:flex;gap:5px;align-items:stretch">'
    + '<input id="prep-task-input" type="text" placeholder="Add prep task…" style="flex:1;padding:7px 9px;border:1px solid #D0C8BE;border-radius:7px;font-size:13px;font-family:inherit;background:#fff;color:#1C2B1E;min-width:0" onclick="event.stopPropagation()">'
    + '<select id="prep-task-section" style="padding:7px 5px;border:1px solid #D0C8BE;border-radius:7px;font-size:12px;font-family:inherit;background:#fff;color:#1C2B1E;flex-shrink:0" onclick="event.stopPropagation()">'
    + '<option value="prep_ahead">🥄 Prep</option>'
    + '<option value="finishing">🔥 Finish</option>'
    + '</select>'
    + '<button onclick="event.stopPropagation();addPrepTask()" style="padding:7px 10px;background:#F97316;color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;flex-shrink:0">Add</button>'
    + '</div>'
    + '</div>';
  var editForm = isEditing
    ? '<div id="dish-edit-'+d.id+'" style="margin-top:10px;padding-top:10px;border-top:1px solid #D4C9B5">'
      + '<input id="dish-edit-name-'+d.id+'" class="form-input" type="text" value="'+_esc(d.dish)+'" style="margin-bottom:8px" placeholder="Dish name">'
      + '<select id="dish-edit-cat-'+d.id+'" class="form-input" style="margin-bottom:8px">'+catOptions+'</select>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:10px">'
      + ALLERGENS_14.map(function(a){
          var eid = 'dish-edit-al-'+d.id+'-'+a.replace(/\s+/g,'_');
          var chk = allergens.indexOf(a)!==-1?' checked':'';
          return '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#1C2B1E;padding:2px 0;cursor:pointer">'
            + '<input type="checkbox" id="'+eid+'"'+chk+' style="width:14px;height:14px;accent-color:#1C2B1E"> '+_esc(a)+'</label>';
        }).join('')
      + '</div>'
      + prepTasksHtml
      + '<div style="display:flex;gap:8px">'
      + '<button onclick="saveDishEdit(\''+d.id+'\')" class="btn-primary" style="flex:1;margin:0;padding:9px">Save changes</button>'
      + '<button onclick="event.stopPropagation();cancelDishEdit()" style="background:none;border:none;color:#A09890;font-size:13px;cursor:pointer;padding:4px 8px;font-family:inherit">Cancel</button>'
      + '</div>'
      + '</div>'
    : '';
  return '<div onclick="editDish(\''+d.id+'\')" style="padding:10px 14px;background:#fff;border:1px solid '+(isEditing?'#1C2B1E':'#E8E2D8')+';border-radius:10px;margin-bottom:8px;cursor:pointer">'
    + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">'
    + '<div style="flex:1">'
    + '<div style="font-size:14px;font-weight:600;color:#1C2B1E">'+_esc(d.dish)+'</div>'
    + (allergens.length
        ? '<div style="font-size:12px;color:#A09890;margin-top:2px">'+_esc(allergens.join(', '))+'</div>'
        : '<div style="font-size:12px;color:#C8BFB0;margin-top:2px">No allergens</div>')
    + '</div>'
    + '<button onclick="event.stopPropagation();deleteDish(\''+d.id+'\')" style="background:none;border:none;color:#C8BFB0;font-size:20px;cursor:pointer;padding:0;line-height:1;flex-shrink:0">&times;</button>'
    + '</div>'
    + editForm
    + '</div>';
}

function renderDishLibrary(){
  var el = document.getElementById('dish-library');
  if(!el) return;
  var dishes = mSettings.savedDishes||[];
  if(dishes.length===0){ el.innerHTML='<p class="empty">No dishes yet.</p>'; return; }

  var grouped = {};
  var ORDER = DISH_CATEGORIES.filter(function(c){ return c!==''; });
  dishes.forEach(function(d){
    var cat = d.category || 'Other';
    if(!grouped[cat]) grouped[cat]=[];
    grouped[cat].push(d);
  });

  var html='<div style="padding:4px 0">';
  var shown = {};
  ORDER.forEach(function(cat){
    if(!grouped[cat] || grouped[cat].length===0) return;
    shown[cat] = true;
    html += '<div class="cat-header">'+_esc(cat)+'</div>';
    grouped[cat].forEach(function(d){ html += _dishRowHTML(d); });
  });
  // Uncategorised dishes not in ORDER
  Object.keys(grouped).forEach(function(cat){
    if(shown[cat]) return;
    html += '<div class="cat-header">'+_esc(cat)+'</div>';
    grouped[cat].forEach(function(d){ html += _dishRowHTML(d); });
  });
  html += '</div>';
  el.innerHTML = html;
}

function deleteDish(id){
  mSettings.savedDishes = (mSettings.savedDishes||[]).filter(function(d){ return String(d.id)!==String(id); });
  saveMiseSettings();
  renderDishLibrary();
  renderMenuDishSelect();
  toast('Dish removed');
  if (window.Mise && window.Mise.sync && window.Mise.sync.deleteDish) Mise.sync.deleteDish(id);
}

var _editingDishId = null;
var _editingDishPrepTasks = [];
function editDish(id){
  if (_editingDishId === id) {
    _editingDishId = null;
    _editingDishPrepTasks = [];
  } else {
    _editingDishId = id;
    var _d = (mSettings.savedDishes||[]).find(function(x){ return String(x.id)===String(id); });
    _editingDishPrepTasks = (_d && Array.isArray(_d.prep_tasks)) ? _d.prep_tasks.map(function(t){ return Object.assign({},t); }) : [];
  }
  renderDishLibrary();
  if(_editingDishId){
    setTimeout(function(){
      var el = document.getElementById('dish-edit-'+id);
      if(el) el.scrollIntoView({behavior:'smooth',block:'nearest'});
    }, 50);
  }
}
function saveDishEdit(id){
  var nameEl = document.getElementById('dish-edit-name-'+id);
  var name = nameEl ? (nameEl.value||'').trim() : '';
  if(!name){ toast('Dish name required', false); return; }
  var allergens = ALLERGENS_14.filter(function(a){
    var el = document.getElementById('dish-edit-al-'+id+'-'+a.replace(/\s+/g,'_'));
    return el && el.checked;
  });
  var catEl = document.getElementById('dish-edit-cat-'+id);
  var category = catEl ? catEl.value : '';
  mSettings.savedDishes = (mSettings.savedDishes||[]).map(function(d){
    return String(d.id)===String(id) ? {id:d.id, dish:name, allergens:allergens, category:category, prep_tasks:_editingDishPrepTasks.slice()} : d;
  });
  saveMiseSettings();
  var _updDish = (mSettings.savedDishes||[]).find(function(d){ return String(d.id)===String(id); });
  if (_updDish && window.Mise && window.Mise.sync && window.Mise.sync.saveDish) Mise.sync.saveDish(_updDish);
  _editingDishId = null;
  _editingDishPrepTasks = [];
  renderDishLibrary();
  renderMenuDishSelect();
  toast('Dish updated ✓');
}
function cancelDishEdit(){
  _editingDishId = null;
  _editingDishPrepTasks = [];
  renderDishLibrary();
}

function addPrepTask() {
  var inputEl = document.getElementById('prep-task-input');
  var sectionEl = document.getElementById('prep-task-section');
  if (!inputEl || !_editingDishId) return;
  var desc = (inputEl.value || '').trim();
  if (!desc) { toast('Enter a task description', 'warn'); return; }
  var section = sectionEl ? sectionEl.value : 'prep_ahead';
  var taskId = 'pt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  var task = { id: taskId, description: desc, section: section };
  _editingDishPrepTasks.push(task);
  inputEl.value = '';
  var listEl = document.getElementById('prep-task-list-' + _editingDishId);
  if (listEl) {
    var icon = task.section === 'finishing' ? '🔥' : '🥄';
    var div = document.createElement('div');
    div.setAttribute('data-prep-task-id', taskId);
    div.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;padding:7px 10px;background:#fff;border-radius:7px;border:1px solid #F0EDE8';
    div.innerHTML = '<span style="font-size:13px;flex-shrink:0">' + icon + '</span>'
      + '<div style="flex:1;font-size:13px;color:#1C2B1E">' + _esc(desc) + '</div>'
      + '<button onclick="event.stopPropagation();editPrepTask(\'' + taskId + '\')" style="background:none;border:none;color:#C0BDB5;font-size:13px;cursor:pointer;padding:0 3px;line-height:1;flex-shrink:0">✏️</button>'
      + '<button onclick="event.stopPropagation();removePrepTask(\'' + taskId + '\')" style="background:none;border:none;color:#C0BDB5;font-size:16px;cursor:pointer;padding:0;line-height:1;flex-shrink:0">&times;</button>';
    listEl.appendChild(div);
  }
}

function removePrepTask(taskId) {
  _editingDishPrepTasks = _editingDishPrepTasks.filter(function(t) { return t.id !== taskId; });
  var row = document.querySelector('[data-prep-task-id="' + taskId + '"]');
  if (row) row.remove();
}

function _prepTaskDisplayInner(task) {
  var icon = task.section === 'finishing' ? '🔥' : '🥄';
  return '<span style="font-size:13px;flex-shrink:0">' + icon + '</span>'
    + '<div style="flex:1;font-size:13px;color:#1C2B1E">' + _esc(task.description) + '</div>'
    + '<button onclick="event.stopPropagation();editPrepTask(\'' + task.id + '\')" style="background:none;border:none;color:#C0BDB5;font-size:13px;cursor:pointer;padding:0 3px;line-height:1;flex-shrink:0">✏️</button>'
    + '<button onclick="event.stopPropagation();removePrepTask(\'' + task.id + '\')" style="background:none;border:none;color:#C0BDB5;font-size:16px;cursor:pointer;padding:0;line-height:1;flex-shrink:0">&times;</button>';
}

function editPrepTask(taskId) {
  var task = _editingDishPrepTasks.find(function(t) { return t.id === taskId; });
  if (!task) return;
  var row = document.querySelector('[data-prep-task-id="' + taskId + '"]');
  if (!row) return;
  var secLabel = task.section === 'finishing' ? '🔥 Finish' : '🥄 Prep';
  row.innerHTML = '<input id="pte-' + taskId + '" type="text" value="' + _esc(task.description) + '" data-section="' + task.section + '"'
    + ' onclick="event.stopPropagation()" onkeydown="if(event.key===\'Enter\')savePrepTaskEdit(\'' + taskId + '\')"'
    + ' style="flex:1;padding:4px 6px;border:1px solid #D0C8BE;border-radius:5px;font-size:13px;font-family:inherit;background:#fff;color:#1C2B1E;min-width:0">'
    + '<button id="pte-sec-' + taskId + '" onclick="event.stopPropagation();_cyclePrepTaskSection(\'' + taskId + '\')"'
    + ' style="padding:4px 8px;background:#F0EDE8;border:1px solid #D0C8BE;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;flex-shrink:0;white-space:nowrap">' + secLabel + '</button>'
    + '<button onclick="event.stopPropagation();savePrepTaskEdit(\'' + taskId + '\')"'
    + ' style="padding:4px 8px;background:#2D7A3A;color:#fff;border:none;border-radius:5px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;flex-shrink:0">✓</button>'
    + '<button onclick="event.stopPropagation();cancelPrepTaskEdit(\'' + taskId + '\')"'
    + ' style="background:none;border:none;color:#A09890;font-size:16px;cursor:pointer;padding:2px 4px;line-height:1;flex-shrink:0">&times;</button>';
  var inputEl = document.getElementById('pte-' + taskId);
  if (inputEl) { inputEl.focus(); inputEl.select(); }
}

function _cyclePrepTaskSection(taskId) {
  var input = document.getElementById('pte-' + taskId);
  if (!input) return;
  var newSection = input.dataset.section === 'prep_ahead' ? 'finishing' : 'prep_ahead';
  input.dataset.section = newSection;
  var secBtn = document.getElementById('pte-sec-' + taskId);
  if (secBtn) secBtn.textContent = newSection === 'finishing' ? '🔥 Finish' : '🥄 Prep';
}

function savePrepTaskEdit(taskId) {
  var input = document.getElementById('pte-' + taskId);
  if (!input) return;
  var desc = (input.value || '').trim();
  if (!desc) { toast('Task description required', 'warn'); return; }
  var section = input.dataset.section || 'prep_ahead';
  var task = _editingDishPrepTasks.find(function(t) { return t.id === taskId; });
  if (task) { task.description = desc; task.section = section; }
  var row = document.querySelector('[data-prep-task-id="' + taskId + '"]');
  if (row) row.innerHTML = _prepTaskDisplayInner({ id: taskId, description: desc, section: section });
}

function cancelPrepTaskEdit(taskId) {
  var task = _editingDishPrepTasks.find(function(t) { return t.id === taskId; });
  if (!task) return;
  var row = document.querySelector('[data-prep-task-id="' + taskId + '"]');
  if (row) row.innerHTML = _prepTaskDisplayInner(task);
}

async function generatePrepTasksAI() {
  if (!_editingDishId) return;
  var dish = (mSettings.savedDishes || []).find(function(d) { return String(d.id) === String(_editingDishId); });
  var dishName = dish ? dish.dish : '';
  var dishCategory = dish ? (dish.category || '') : '';
  if (!dishName) return;

  var btn = document.getElementById('prep-ai-btn-' + _editingDishId);
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }

  try {
    var res = await fetch('/api/parse-menu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'prep-tasks', dishName: dishName, dishCategory: dishCategory })
    });
    var data = await res.json();
    if (!res.ok || !Array.isArray(data.tasks)) throw new Error(data.error || 'AI generation failed');

    var listEl = document.getElementById('prep-task-list-' + _editingDishId);
    data.tasks.forEach(function(t) {
      var taskId = 'pt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      var task = { id: taskId, description: t.description || '', section: t.section === 'finishing' ? 'finishing' : 'prep_ahead' };
      _editingDishPrepTasks.push(task);
      if (listEl) {
        var div = document.createElement('div');
        div.setAttribute('data-prep-task-id', taskId);
        div.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;padding:7px 10px;background:#fff;border-radius:7px;border:1px solid #F0EDE8';
        div.innerHTML = _prepTaskDisplayInner(task);
        listEl.appendChild(div);
      }
    });
    toast(data.tasks.length + ' tasks generated — edit or save');
  } catch(e) {
    toast(e.message || 'AI generation failed', 'err');
  } finally {
    if (btn) { btn.textContent = '✨ AI'; btn.disabled = false; }
  }
}

// ═══════════════════════════════════════════════════════ MENUS ═══════════════
function renderMenuDishSelect(){
  var el = document.getElementById('menu-dish-select');
  if(!el) return;
  var dishes = mSettings.savedDishes||[];
  if(dishes.length===0){ el.innerHTML='<div style="padding:10px;font-size:13px;color:#A09890">Add dishes to the library first</div>'; return; }
  var ORDER = DISH_CATEGORIES.filter(function(c){ return c!==''; });
  var grouped = {};
  dishes.forEach(function(d){
    var cat = d.category||'Other';
    if(!grouped[cat]) grouped[cat]=[];
    grouped[cat].push(d);
  });
  var html = '';
  var shown = {};
  ORDER.forEach(function(cat){
    if(!grouped[cat]||!grouped[cat].length) return;
    shown[cat] = true;
    html += '<div style="padding:5px 10px 2px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#2D7A3A;background:#EAF4EC">'+_esc(cat)+'</div>';
    grouped[cat].forEach(function(d){
      html += '<label style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #F0EBE2;cursor:pointer;font-size:14px;color:#1C2B1E">'
        +'<input type="checkbox" id="menu-d-'+d.id+'" style="accent-color:#3A7D44;flex-shrink:0">'
        +_esc(d.dish)+'</label>';
    });
  });
  Object.keys(grouped).forEach(function(cat){
    if(shown[cat]) return;
    html += '<div style="padding:5px 10px 2px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#2D7A3A;background:#EAF4EC">'+_esc(cat)+'</div>';
    grouped[cat].forEach(function(d){
      html += '<label style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #F0EBE2;cursor:pointer;font-size:14px;color:#1C2B1E">'
        +'<input type="checkbox" id="menu-d-'+d.id+'" style="accent-color:#3A7D44;flex-shrink:0">'
        +_esc(d.dish)+'</label>';
    });
  });
  el.innerHTML = html;
}

function saveMenu(){
  var name = (document.getElementById('menu-name').value||'').trim();
  if(!name){ toast('Menu name required','err'); return; }
  var dishes = mSettings.savedDishes||[];
  var selectedDishes = dishes.filter(function(d){
    var cb = document.getElementById('menu-d-'+d.id);
    return cb && cb.checked;
  });
  var selected = selectedDishes.map(function(d){ return d.id; });
  if(selected.length===0){ toast('Select at least one dish','err'); return; }
  if(!mSettings.savedMenus) mSettings.savedMenus=[];
  var _newMenu = { id: uid(), name: name, dishIds: selected, dishes: selectedDishes };
  mSettings.savedMenus.push(_newMenu);
  saveMiseSettings();
  if (window.Mise && window.Mise.sync && window.Mise.sync.saveMenu) Mise.sync.saveMenu(_newMenu);
  document.getElementById('menu-name').value='';
  renderMenuDishSelect();
  renderSavedMenus();
  toast('Menu saved ✓');
}

function _menuInlineEditHTML(m){
  var dishes = mSettings.savedDishes||[];
  var ORDER = DISH_CATEGORIES.filter(function(c){ return c!==''; });
  var grouped = {};
  dishes.forEach(function(d){
    var cat = d.category||'Other';
    if(!grouped[cat]) grouped[cat]=[];
    grouped[cat].push(d);
  });
  var cbHTML = '';
  var shown = {};
  function _renderGroup(cat){
    shown[cat]=true;
    cbHTML += '<div style="padding:4px 0 2px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#2D7A3A">'+_esc(cat)+'</div>';
    grouped[cat].forEach(function(d){
      var chk = (m.dishIds||[]).some(function(id){ return String(id)===String(d.id); }) ? ' checked' : '';
      cbHTML += '<label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;font-size:14px;color:#1C2B1E" onclick="event.stopPropagation()">'
        +'<input type="checkbox" id="medit-d-'+d.id+'"'+chk+' style="accent-color:#3A7D44;flex-shrink:0"> '+_esc(d.dish)+'</label>';
    });
  }
  ORDER.forEach(function(cat){ if(grouped[cat]&&grouped[cat].length) _renderGroup(cat); });
  Object.keys(grouped).forEach(function(cat){ if(!shown[cat]) _renderGroup(cat); });
  return '<div style="margin-top:12px;padding-top:12px;border-top:1px solid #D4C9B5" onclick="event.stopPropagation()">'
    +'<input id="medit-name-'+m.id+'" class="form-input" type="text" value="'+_esc(m.name)+'" style="margin-bottom:10px" placeholder="Menu name">'
    +'<div style="border:1px solid #E2DDD5;border-radius:8px;padding:4px 10px;margin-bottom:10px">'+cbHTML+'</div>'
    +'<div style="display:flex;gap:8px">'
    +'<button onclick="saveMenuEdit(\''+m.id+'\')" class="btn-primary" style="flex:1;margin:0;padding:9px">Save changes</button>'
    +'<button onclick="cancelMenuEdit()" style="background:none;border:none;color:#A09890;font-size:13px;cursor:pointer;padding:4px 8px;font-family:inherit">Cancel</button>'
    +'</div></div>';
}

function renderSavedMenus(){
  var el = document.getElementById('saved-menus-list');
  if(!el) return;
  var menus  = mSettings.savedMenus||[];
  var dishes = mSettings.savedDishes||[];
  var dishMap = {};
  dishes.forEach(function(d){ dishMap[String(d.id)]=d; });

  if(menus.length===0){ el.innerHTML='<p class="empty">No saved menus.</p>'; return; }

  el.innerHTML = menus.map(function(m){
    var isEditing = _editingMenuId === m.id;
    var dishList = (m.dishIds||[]).map(function(id){
      var d = dishMap[String(id)];
      return d ? '<span class="badge badge-grey" style="margin:2px">'+_esc(d.dish)+'</span>' : '';
    }).join('');
    return '<div class="card" style="margin-bottom:8px;border-color:'+(isEditing?'#1C2B1E':'#E2DDD5')+'" '+(isEditing?'':'onclick="editMenu(\''+m.id+'\')" style="cursor:pointer"')+'>'
      +'<div style="display:flex;align-items:center;justify-content:space-between">'
      +'<div style="font-size:15px;font-weight:600;color:#1C2B1E">'+_esc(m.name)+'</div>'
      +'<div style="display:flex;align-items:center;gap:4px">'
      +(isEditing?'':'<button onclick="event.stopPropagation();editMenu(\''+m.id+'\')" style="background:none;border:none;color:#A09890;font-size:12px;cursor:pointer;font-family:inherit;padding:2px 6px">Edit</button>')
      +'<button onclick="event.stopPropagation();deleteMenu(\''+m.id+'\')" class="btn-remove" aria-label="Delete menu">×</button>'
      +'</div></div>'
      +(dishList?'<div style="display:flex;flex-wrap:wrap;gap:2px;margin-top:8px">'+dishList+'</div>':'')
      +(isEditing ? _menuInlineEditHTML(m) : '')
      +'</div>';
  }).join('');
}

var _editingMenuId = null;
function editMenu(id){
  _editingMenuId = (_editingMenuId===id) ? null : id;
  renderSavedMenus();
  if(_editingMenuId){
    setTimeout(function(){
      var nameEl = document.getElementById('medit-name-'+id);
      if(nameEl) nameEl.closest('.card').scrollIntoView({behavior:'smooth',block:'nearest'});
    },50);
  }
}
function saveMenuEdit(id){
  var nameEl = document.getElementById('medit-name-'+id);
  var name = nameEl ? (nameEl.value||'').trim() : '';
  if(!name){ toast('Menu name required','err'); return; }
  var dishes = mSettings.savedDishes||[];
  var selectedDishes = dishes.filter(function(d){
    var cb = document.getElementById('medit-d-'+d.id);
    return cb && cb.checked;
  });
  var selected = selectedDishes.map(function(d){ return d.id; });
  if(!selected.length){ toast('Select at least one dish','err'); return; }
  mSettings.savedMenus = (mSettings.savedMenus||[]).map(function(m){
    return m.id===id ? Object.assign({},m,{name:name,dishIds:selected,dishes:selectedDishes}) : m;
  });
  saveMiseSettings();
  var _updMenu = (mSettings.savedMenus||[]).find(function(m){ return m.id===id; });
  if (_updMenu && window.Mise && window.Mise.sync && window.Mise.sync.saveMenu) Mise.sync.saveMenu(_updMenu);
  _editingMenuId = null;
  renderSavedMenus();
  toast('Menu updated ✓');
}
function cancelMenuEdit(){
  _editingMenuId = null;
  renderSavedMenus();
}

function deleteMenu(id){
  mSettings.savedMenus = (mSettings.savedMenus||[]).filter(function(m){ return m.id!==id; });
  saveMiseSettings(); renderSavedMenus(); toast('Menu removed');
  if (window.Mise && window.Mise.sync && window.Mise.sync.deleteMenu) Mise.sync.deleteMenu(id);
}

// ═══════════════════════════════════════════════════════ JOBS ════════════════
function populateJobClientSelect(){
  var book = getAddressBook();
  var el   = document.getElementById('job-client-select');
  if(!el) return;
  el.innerHTML = '<option value="">Select client…</option>'
    + book.map(function(e){ return '<option value="'+_esc(e.key)+'">'+_esc(e.name)+(e.fromCRM?'':' *')+'</option>'; }).join('');
}

function logJob(){
  var sel = document.getElementById('job-client-select');
  var manual = (document.getElementById('job-client-manual').value||'').trim();
  var client = manual;
  if(!client && sel && sel.value){
    var e = addressBookLookup(sel.value);
    client = e ? e.name : '';
  }
  if(!client){ toast('Client name required','err'); return; }
  var eventDate = document.getElementById('job-event-date').value;
  if(!eventDate){ toast('Event date required','err'); return; }

  var rec = {
    id: uid(), type: 'job', date: TODAY, time: new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}),
    client: client,
    location: (document.getElementById('job-location').value||'').trim(),
    eventDate: eventDate,
    eventTime: (document.getElementById('job-time').value||'').trim(),
    covers: (document.getElementById('job-covers').value||'').trim(),
    jobType: document.getElementById('job-type').value||'',
    notes: (document.getElementById('job-notes').value||'').trim(),
    menus: _getSelectedMenusSnapshot('log'),
    guests: []
  };

  // If client isn't already in CRM, offer to add
  var inCRM = (mSettings.savedClients||[]).some(function(c){ return c.name.trim().toLowerCase()===client.toLowerCase(); });

  // Save record
  if(rec.date === TODAY){
    mRecords.push(rec); saveMiseToday();
  } else {
    var day = getDayRecords(rec.date); day.push(rec); saveDayRecords(rec.date, day);
  }

  if (window.Mise && window.Mise.sync && window.Mise.sync.saveJob) Mise.sync.saveJob(rec);

  // Mirror into yield_jobs so Costing picks it up immediately without needing a sync round-trip
  try {
    var _yj = JSON.parse(localStorage.getItem('yield_jobs') || '[]');
    if (!_yj.some(function(j){ return j.id === rec.id; })) { _yj.push(rec); }
    localStorage.setItem('yield_jobs', JSON.stringify(_yj));
  } catch(e) {}

  // Reset form
  ['job-client-manual','job-location','job-time','job-covers','job-notes'].forEach(function(id){
    document.getElementById(id).value='';
  });
  document.getElementById('job-client-select').value='';
  document.getElementById('job-type').value='';
  document.getElementById('job-event-date').value='';
  document.getElementById('newJobTemplate').value='';

  renderJobMenuPicker();
  updateDashboard();
  if(_newJobFormOpen) toggleNewJobForm();
  renderJobsHistory();
  toast(inCRM ? 'Job saved ✓' : 'Job saved ✓ (add client to CRM for full details)');
}

function _jobCardHTML(j){
  var JOB_TYPES = ['Dinner party','Wedding','Corporate','Lunch','Canapes','Meal prep','Private class','Other'];
  var isOpen    = _expandedJobId === j.id;
  var isEditing = _editingJobId  === j.id;
  var isMirrored = j.id && j.id.indexOf('veriqo_') === 0;
  var bodyHtml = '';

  if(isEditing){
    var typeOpts = JOB_TYPES.map(function(t){
      return '<option'+(j.jobType===t?' selected':'')+'>'+t+'</option>';
    }).join('');
    bodyHtml = '<div class="job-card-body open" onclick="event.stopPropagation()">'
      + '<div class="form-group"><label class="form-label">Client</label>'
      + '<input class="form-input" id="jedit-client-'+j.id+'" value="'+_esc(j.client||'')+'"></div>'
      + '<div class="form-group"><label class="form-label">Location</label>'
      + '<input class="form-input" id="jedit-location-'+j.id+'" value="'+_esc(j.location||'')+'"></div>'
      + '<div class="form-row">'
      + '<div class="form-group"><label class="form-label">Event date</label>'
      + '<input class="form-input" type="date" id="jedit-eventdate-'+j.id+'" value="'+_esc(j.eventDate||'')+'"></div>'
      + '<div class="form-group"><label class="form-label">Time</label>'
      + '<input class="form-input" type="time" id="jedit-eventtime-'+j.id+'" value="'+_esc(j.eventTime||'')+'"></div>'
      + '</div>'
      + '<div class="form-row">'
      + '<div class="form-group"><label class="form-label">Covers</label>'
      + '<input class="form-input" type="number" id="jedit-covers-'+j.id+'" value="'+_esc(j.covers||'')+'"></div>'
      + '<div class="form-group"><label class="form-label">Job type</label>'
      + '<select class="form-input" id="jedit-jobtype-'+j.id+'"><option value="">Select…</option>'+typeOpts+'</select></div>'
      + '</div>'
      + '<div class="form-group"><label class="form-label">Notes</label>'
      + '<input class="form-input" id="jedit-notes-'+j.id+'" value="'+_esc(j.notes||'')+'"></div>'
      + '<div class="form-group"><label class="form-label">Menus</label>'
      + '<div id="jmcurrent-'+j.id+'"></div>'
      + '<button type="button" onclick="openJobMenuBuilder(\''+j.id+'\')" style="background:rgba(45,122,58,0.08);border:1px dashed #2D7A3A;color:#2D7A3A;width:100%;padding:12px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:14px;margin-top:6px;-webkit-tap-highlight-color:transparent">+ Attach or Build a Menu</button>'
      + '</div>'
      + '<div class="form-group"><label class="form-label">Guests &amp; allergens</label>'
      + '<div id="jguests-'+j.id+'"><div style="font-size:12px;color:#aaa;padding:4px 0">Loading…</div></div>'
      + '</div>'
      + '<div style="display:flex;gap:8px;margin-top:4px">'
      + '<button class="btn-primary btn-green" style="flex:1;margin-top:0" onclick="saveJobEdit(\''+j.id+'\')">Save</button>'
      + '<button style="flex:0 0 auto;padding:12px 16px;background:#f5f4f0;color:#1C2B1E;border:1px solid #2D7A3A;border-radius:8px;font-size:14px;cursor:pointer;font-family:inherit" onclick="_editingJobId=null;renderJobsHistory()">Cancel</button>'
      + '<button style="flex:0 0 auto;padding:12px 16px;background:#FBECEC;color:#8A2D2D;border:1px solid #E8C5C5;border-radius:8px;font-size:14px;cursor:pointer;font-family:inherit" onclick="deleteJob(\''+j.id+'\')">Delete</button>'
      + '</div></div>';
  } else if(isOpen){
    var editBtn = !isMirrored
      ? '<div style="margin-top:10px"><button style="width:100%;padding:10px;background:#2D7A3A;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer;font-family:inherit" onclick="event.stopPropagation();startJobEdit(\''+j.id+'\')">Edit job</button></div>'
      : '';
    var allergenBtn = '<div style="margin-top:8px"><button style="width:100%;padding:10px;background:none;color:#2D7A3A;border:1px solid #2D7A3A;border-radius:8px;font-size:13px;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:8px" onclick="event.stopPropagation();generateAllergenMatrix(\''+j.id+'\')">'+vqIcon('file-text',15)+' Print Allergen Matrix</button></div>';
    var isJobPast = j.eventDate && j.eventDate < TODAY;
    var followUpBtn = isJobPast ? '<div style="margin-top:8px"><button style="width:100%;padding:10px;background:#2D7A3A;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:8px" onclick="event.stopPropagation();draftFollowUpEmail(\''+j.id+'\')">'+vqIcon('mail',15)+' Draft Follow-up Email</button></div>' : '';
    bodyHtml = '<div class="job-card-body open" onclick="event.stopPropagation()">'
      + (j.location ? '<div class="job-detail-row"><span class="job-detail-key">Location</span>'+_esc(j.location)+'</div>' : '')
      + (j.eventTime ? '<div class="job-detail-row"><span class="job-detail-key">Time</span>'+_esc(j.eventTime)+'</div>' : '')
      + (j.covers ? '<div class="job-detail-row"><span class="job-detail-key">Covers</span>'+_esc(j.covers)+'</div>' : '')
      + (j.jobType ? '<div class="job-detail-row"><span class="job-detail-key">Type</span>'+_esc(j.jobType)+'</div>' : '')
      + (j.notes ? '<div class="job-detail-row"><span class="job-detail-key">Notes</span>'+_esc(j.notes)+'</div>' : '')
      + (j.menus&&j.menus.length ? '<div style="margin-top:10px">'
          + j.menus.map(function(m){
              var dishChips = (m.dishes||[]).map(function(d){
                return '<span style="display:inline-block;background:#F5F0E8;border:1px solid #E8E2D8;border-radius:6px;padding:2px 8px;font-size:12px;margin:2px 2px 2px 0;color:#1C2B1E">'+_esc(d.dish)+(d.allergens&&d.allergens.length?' <span style="color:#A09890;font-size:11px">('+_esc(d.allergens.join(', '))+')</span>':'')+'</span>';
              }).join('');
              return '<div style="margin-bottom:8px">'
                +'<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#2D7A3A;margin-bottom:4px">'+_esc(m.name)+'</div>'
                +(dishChips||'<span style="font-size:12px;color:#A09890">No dishes</span>')
                +'</div>';
            }).join('')
          +'</div>' : '')
      + (j.guests && j.guests.length ? (function() {
          var withAllergens = j.guests.filter(function(g){ return g.allergens && g.allergens.length; });
          var rows = j.guests.map(function(g) {
            var tags = (g.allergens||[]).map(function(a){
              return '<span style="background:#fde8e8;border:1px solid #f5c6c6;border-radius:4px;padding:1px 6px;font-size:11px;color:#A32D2D">'+_esc(a)+'</span>';
            }).join(' ');
            return '<div style="padding:4px 0;font-size:13px"><span style="font-weight:600">'+_esc(g.name)+'</span>'
              +(tags?' — <span style="display:inline-flex;flex-wrap:wrap;gap:3px">'+tags+'</span>':'<span style="color:#aaa;font-size:12px"> — no allergens</span>')+'</div>';
          }).join('');
          return '<div style="margin-top:10px;padding-top:10px;border-top:1px solid #F0EBE2">'
            +'<div style="font-size:11px;font-weight:600;text-transform:uppercase;color:#A09890;letter-spacing:0.05em;margin-bottom:6px">Guests'+(withAllergens.length?' · '+withAllergens.length+' with allergen requirements':'')+'</div>'
            +rows+'</div>';
        })() : '')
      + allergenBtn + followUpBtn
      + '<div style="margin-top:10px;padding-top:10px;border-top:1px solid #F0EBE2">'
      + '<div style="font-size:11px;font-weight:600;text-transform:uppercase;color:#A09890;letter-spacing:0.05em;margin-bottom:6px">Payments</div>'
      + '<div style="display:flex;gap:8px;margin-bottom:4px">'
      + '<span style="flex:1;font-size:13px;color:#1C2B1E;line-height:1.4">💳 Deposit</span>'
      + '<button onclick="event.stopPropagation();toggleJobPayment(\''+j.id+'\',\'tabDepositPaid\')" style="padding:4px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;-webkit-tap-highlight-color:transparent;'+(j.tabDepositPaid?'background:#EAF4EC;color:#1C6B2A;border:1px solid #A8D5B0':'background:#f5f4f0;color:#2D7A3A;border:1px solid #2D7A3A')+'">'+(j.tabDepositPaid?'✓ Paid':'Mark paid')+'</button>'
      + '</div>'
      + '<div style="display:flex;gap:8px">'
      + '<span style="flex:1;font-size:13px;color:#1C2B1E;line-height:1.4;display:inline-flex;align-items:center;gap:6px">'+vqIcon('coins',13)+' Balance</span>'
      + '<button onclick="event.stopPropagation();toggleJobPayment(\''+j.id+'\',\'tabBalancePaid\')" style="padding:4px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;-webkit-tap-highlight-color:transparent;'+(j.tabBalancePaid?'background:#EAF4EC;color:#1C6B2A;border:1px solid #A8D5B0':'background:#f5f4f0;color:#2D7A3A;border:1px solid #2D7A3A')+'">'+(j.tabBalancePaid?'✓ Paid':'Mark paid')+'</button>'
      + '</div>'
      + '</div>'
      + '<div style="margin-top:8px"><button style="width:100%;padding:10px;background:none;color:#2D7A3A;border:1px solid rgba(45,122,58,0.4);border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;-webkit-tap-highlight-color:transparent;display:flex;align-items:center;justify-content:center;gap:8px" onclick="event.stopPropagation();openSaveTemplateModal(\''+j.id+'\')">'+vqIcon('save',15)+' Save as template</button></div>'
      + editBtn + '</div>';
  }

  var isUpcoming = j.eventDate && j.eventDate >= TODAY;
  var balWarn = isUpcoming && !j.tabBalancePaid && daysUntil(j.eventDate) <= 3;
  return '<div class="job-card" data-job-id="'+j.id+'" onclick="toggleJobCard(\''+j.id+'\')" style="'+(balWarn?'border-color:#2D7A3A;':'')+'">'
    + '<div class="job-card-header">'
    + '<div style="flex:1">'
    + '<div class="job-card-name">'+_esc(j.client||'Unnamed')+'</div>'
    + '<div class="job-card-date">'+fmtDate(j.eventDate)+(j.jobType?' · '+_esc(j.jobType):'')+'</div>'
    + (j.covers ? '<div class="job-card-meta">'+j.covers+' covers</div>' : '')
    + (j._fromYield ? '<div style="font-size:11px;color:#2D7A3A;font-weight:700;letter-spacing:0.04em;margin-top:3px">'+(j._quoteStatus==='accepted'?'✓ ACCEPTED — COSTING':'📊 COSTING QUOTE')+'</div>' : '')
    + (balWarn ? '<div style="display:inline-block;margin-top:4px;font-size:11px;font-weight:700;color:#1C6B2A;background:#EAF4EC;border:1px solid #A8D5B0;border-radius:4px;padding:2px 7px;letter-spacing:0.02em">⚠ Balance due</div>' : '')
    + '</div>'
    + '<div style="font-size:16px;color:#C0B8B0;flex-shrink:0">'+(isOpen||isEditing?'▲':'▼')+'</div>'
    + '</div>'
    + bodyHtml + '</div>';
}

function _jobsByMonth(jobs){
  var byMonth = {};
  jobs.forEach(function(j){
    var mo = (j.eventDate||j.date||'').slice(0,7);
    if(!byMonth[mo]) byMonth[mo]=[];
    byMonth[mo].push(j);
  });
  return Object.keys(byMonth).sort().reverse().map(function(mo){
    var parts = mo.split('-');
    var moLabel = MONTHS[parseInt(parts[1],10)-1] + ' ' + parts[0];
    return '<div class="month-group"><div class="month-label">'+moLabel+'</div>'
      + byMonth[mo].map(_jobCardHTML).join('') + '</div>';
  }).join('');
}

function renderJobsHistory(){
  var upcomingEl = document.getElementById('jobs-upcoming');
  var pastEl     = document.getElementById('jobs-past');
  var pastBtn    = document.getElementById('jobs-past-btn');
  if(!upcomingEl) return;

  var allJobs  = getAllJobs();
  var upcoming = allJobs.filter(function(j){ return j.eventDate && j.eventDate >= TODAY; })
                        .sort(function(a,b){ return a.eventDate.localeCompare(b.eventDate); });
  var past     = allJobs.filter(function(j){ return !j.eventDate || j.eventDate < TODAY; })
                        .sort(function(a,b){ return (b.eventDate||b.date||'').localeCompare(a.eventDate||a.date||''); });

  if(upcoming.length === 0){
    upcomingEl.innerHTML = '<p class="empty" style="margin-top:4px;margin-bottom:8px">No upcoming bookings</p>';
  } else {
    upcomingEl.innerHTML = '<div class="divider" style="margin-top:0">Upcoming</div>'
      + upcoming.map(_jobCardHTML).join('');
  }

  if(pastEl){
    var exportBtn = '<button onclick="exportJobsPDF()" style="display:flex;align-items:center;gap:8px;width:100%;padding:11px 16px;background:#2D7A3A;color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;margin-bottom:14px">'+vqIcon('file-down',16)+' Export Booking Report PDF</button>';
    pastEl.innerHTML = past.length === 0
      ? '<p class="empty">No previous bookings</p>'
      : exportBtn + _jobsByMonth(past);
    pastEl.style.display = _pastJobsOpen ? 'block' : 'none';
  }

  if(pastBtn){
    pastBtn.style.display = past.length > 0 ? 'block' : 'none';
    pastBtn.textContent   = (_pastJobsOpen ? '▲ Hide' : '▼ View') + ' previous bookings (' + past.length + ')';
  }
}

function toggleJobCard(id){
  if(_editingJobId === id) return;
  _expandedJobId = (_expandedJobId===id) ? null : id;
  _editingJobId = null;
  renderJobsHistory();
}

function _renderJobGuestEditor(jobId) {
  var c = document.getElementById('jguests-' + jobId);
  if (!c) return;
  var guests = _editingJobGuests[jobId] || [];
  var guestRows = guests.map(function(g) {
    var tags = (g.allergens || []).map(function(a) {
      return '<span style="background:#fde8e8;border:1px solid #f5c6c6;border-radius:4px;padding:1px 6px;font-size:11px;color:#A32D2D">' + _esc(a) + '</span>';
    }).join(' ');
    return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f0efeb">'
      + '<div style="flex:1"><div style="font-size:13px;font-weight:600">' + _esc(g.name) + '</div>'
      + (tags ? '<div style="margin-top:3px;display:flex;flex-wrap:wrap;gap:3px">' + tags + '</div>'
              : '<div style="font-size:11px;color:#aaa;margin-top:2px">No allergens recorded</div>')
      + '</div>'
      + '<button type="button" aria-label="Remove guest" onclick="_removeJobGuest(\'' + jobId + '\',\'' + g.id + '\')" style="background:none;border:none;color:#999;font-size:16px;cursor:pointer;padding:0;min-width:44px;min-height:44px;display:inline-flex;align-items:center;justify-content:center">×</button>'
      + '</div>';
  }).join('');

  var checks = ALLERGENS_14.map(function(a) {
    var key = a.replace(/\s/g, '_');
    return '<label style="display:flex;align-items:center;gap:6px;font-size:12px;padding:3px 0;cursor:pointer">'
      + '<input type="checkbox" id="jga-' + jobId + '-' + key + '"> ' + _esc(a) + '</label>';
  }).join('');

  c.innerHTML = (guestRows || '<div style="font-size:12px;color:#aaa;padding:4px 0">No guests added yet.</div>')
    + '<div style="margin-top:10px;border:1px solid #e0ddd6;border-radius:8px;padding:10px 12px;background:#fafaf8">'
    + '<div style="font-size:12px;font-weight:600;color:#555;margin-bottom:6px">Add a guest</div>'
    + '<input id="jg-name-' + jobId + '" class="form-input" placeholder="Guest name" style="margin-bottom:8px">'
    + '<div style="columns:2;column-gap:8px;margin-bottom:8px">' + checks + '</div>'
    + '<button type="button" onclick="_addJobGuest(\'' + jobId + '\')" style="background:#2D7A3A;color:#fff;border:none;border-radius:6px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;width:100%">+ Add guest</button>'
    + '</div>';
}

function _addJobGuest(jobId) {
  var nameEl = document.getElementById('jg-name-' + jobId);
  var name = nameEl ? nameEl.value.trim() : '';
  if (!name) { if (nameEl) nameEl.focus(); return; }
  var allergens = ALLERGENS_14.filter(function(a) {
    var el = document.getElementById('jga-' + jobId + '-' + a.replace(/\s/g, '_'));
    return el && el.checked;
  });
  if (!_editingJobGuests[jobId]) _editingJobGuests[jobId] = [];
  _editingJobGuests[jobId].push({ id: 'g' + Date.now(), name: name, allergens: allergens });
  _renderJobGuestEditor(jobId);
}

function _removeJobGuest(jobId, guestId) {
  if (!_editingJobGuests[jobId]) return;
  _editingJobGuests[jobId] = _editingJobGuests[jobId].filter(function(g) { return g.id !== guestId; });
  _renderJobGuestEditor(jobId);
}

function startJobEdit(id){
  _editingJobId = id;
  _expandedJobId = id;
  var job = getAllJobs().filter(function(j){ return j.id===id; })[0];
  _jobMenuState[id] = job
    ? (job.menus||[]).map(function(m){ return {name:m.name,dishes:(m.dishes||[]).slice()}; })
    : [];
  _editingJobGuests[id] = job
    ? (job.guests||[]).map(function(g){ return Object.assign({},g); })
    : [];
  renderJobsHistory();
  setTimeout(function(){
    if(_editingJobId===id) { _renderMenuState(id); _renderJobGuestEditor(id); }
  }, 0);
}

function saveJobEdit(id){
  var client = (document.getElementById('jedit-client-'+id).value||'').trim();
  if(!client){ toast('Client required','err'); return; }
  var eventDate = (document.getElementById('jedit-eventdate-'+id).value||'').trim();
  if(!eventDate){ toast('Event date required','err'); return; }
  var updates = {
    client:    client,
    location:  (document.getElementById('jedit-location-'+id).value||'').trim(),
    eventDate: eventDate,
    eventTime: (document.getElementById('jedit-eventtime-'+id).value||'').trim(),
    covers:    (document.getElementById('jedit-covers-'+id).value||'').trim(),
    jobType:   document.getElementById('jedit-jobtype-'+id).value||'',
    notes:     (document.getElementById('jedit-notes-'+id).value||'').trim(),
    menus:     _getSelectedMenusSnapshot(id),
    guests:    _editingJobGuests[id] || []
  };
  var found = false;
  var updatedRec = null;
  for(var i=0;i<mRecords.length;i++){
    if(mRecords[i].id===id){ Object.assign(mRecords[i],updates); saveMiseToday(); updatedRec=mRecords[i]; found=true; break; }
  }
  if(!found){
    try {
      for(var li=0;li<localStorage.length;li++){
        var lk=localStorage.key(li);
        if(!lk||lk.indexOf('mise_')!==0||lk==='mise_settings') continue;
        var lds=lk.replace('mise_','');
        var lrecs=getDayRecords(lds);
        for(var ri=0;ri<lrecs.length;ri++){
          if(lrecs[ri].id===id){ Object.assign(lrecs[ri],updates); saveDayRecords(lds,lrecs); updatedRec=lrecs[ri]; found=true; break; }
        }
        if(found) break;
      }
    } catch(e){}
  }
  if(!found){ toast('Job not found','err'); return; }
  if(updatedRec && window.Mise && window.Mise.sync && window.Mise.sync.saveJob) Mise.sync.saveJob(updatedRec);
  _editingJobId=null;
  updateDashboard();
  renderCalendar();
  renderJobsHistory();
  toast('Job updated ✓');
}

function toggleJobPayment(id, field) {
  var found = false;
  var updatedRec = null;
  for(var i = 0; i < mRecords.length; i++) {
    if(mRecords[i].id === id) {
      mRecords[i][field] = !mRecords[i][field];
      saveMiseToday();
      updatedRec = mRecords[i];
      found = true;
      break;
    }
  }
  if(!found) {
    try {
      for(var li = 0; li < localStorage.length; li++) {
        var lk = localStorage.key(li);
        if(!lk || lk.indexOf('mise_') !== 0 || lk === 'mise_settings') continue;
        var lds = lk.replace('mise_', '');
        var lrecs = getDayRecords(lds);
        for(var ri = 0; ri < lrecs.length; ri++) {
          if(lrecs[ri].id === id) {
            lrecs[ri][field] = !lrecs[ri][field];
            saveDayRecords(lds, lrecs);
            updatedRec = lrecs[ri];
            found = true;
            break;
          }
        }
        if(found) break;
      }
    } catch(e) {}
  }
  if(!updatedRec) return;
  if(window.Mise && window.Mise.sync && window.Mise.sync.saveJob) Mise.sync.saveJob(updatedRec);
  updateDashboard();
  renderJobsHistory();
  var label = field === 'tabBalancePaid' ? 'Balance' : 'Deposit';
  toast(label + (updatedRec[field] ? ' marked paid ✓' : ' marked unpaid'));
}

function deleteJob(id){
  if(!confirm('Delete this job?')) return;
  var found = false;
  for(var i=0;i<mRecords.length;i++){
    if(mRecords[i].id===id){ mRecords.splice(i,1); saveMiseToday(); found=true; break; }
  }
  if(!found){
    try {
      for(var li=0;li<localStorage.length;li++){
        var lk=localStorage.key(li);
        if(!lk||lk.indexOf('mise_')!==0||lk==='mise_settings') continue;
        var lds=lk.replace('mise_','');
        var lrecs=getDayRecords(lds);
        for(var ri=0;ri<lrecs.length;ri++){
          if(lrecs[ri].id===id){ lrecs.splice(ri,1); saveDayRecords(lds,lrecs); found=true; break; }
        }
        if(found) break;
      }
    } catch(e){}
  }
  if (window.Mise && window.Mise.sync && window.Mise.sync.deleteJob) Mise.sync.deleteJob(id);
  _expandedJobId=null; _editingJobId=null;
  updateDashboard();
  renderCalendar();
  renderJobsHistory();
  toast('Job deleted');
}

// ══════════════════════════════════════════════════ JOB MENU HELPERS ══════════
var _jobMenuState = {};

function _buildDishCheckboxesHTML(prefix){
  var dishes = mSettings.savedDishes||[];
  if(!dishes.length) return '<div style="padding:6px 4px;font-size:12px;color:#A09890">No dishes saved — add one below</div>';
  var catMap = {};
  dishes.forEach(function(d){ var c=d.category||''; if(!catMap[c]) catMap[c]=[]; catMap[c].push(d); });
  var html = '';
  DISH_CATEGORIES.forEach(function(cat){
    var group = catMap[cat]||[];
    if(!group.length) return;
    if(cat) html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#2D7A3A;padding:6px 4px 2px">'+_esc(cat)+'</div>';
    group.forEach(function(d){
      html += '<label style="display:flex;align-items:center;gap:8px;padding:5px 4px;cursor:pointer">'
        +'<input type="checkbox" id="jcdish-'+prefix+'-'+d.id+'" style="accent-color:#1C2B1E;width:14px;height:14px;flex-shrink:0">'
        +'<span style="font-size:13px;color:#1C2B1E">'+_esc(d.dish)+'</span>'
        +(d.allergens&&d.allergens.length?' <span style="font-size:11px;color:#A09890">('+_esc(d.allergens.join(', '))+')</span>':'')
        +'</label>';
    });
  });
  return html;
}

function _buildMenuPickerHTML(prefix, currentMenus){
  _jobMenuState[prefix] = (currentMenus||[]).map(function(m){ return {name:m.name,dishes:(m.dishes||[]).slice()}; });
  var saved = mSettings.savedMenus||[];
  var dishes = mSettings.savedDishes||[];
  var dishMap = {};
  dishes.forEach(function(d){ dishMap[d.id]=d; });
  var savedOpts = saved.length ? saved.map(function(m){
    var preview = (m.dishIds||[]).slice(0,3).map(function(id){ return dishMap[id]?_esc(dishMap[id].dish):''; }).filter(Boolean).join(', ');
    if((m.dishIds||[]).length>3) preview += '…';
    return '<label onclick="event.preventDefault();toggleSavedMenuOnJob(\''+prefix+'\',\''+m.id+'\')" style="display:flex;align-items:flex-start;gap:10px;padding:8px 4px;border-bottom:1px solid #F0EBE2;cursor:pointer">'
      +'<input type="checkbox" id="jmchk-'+prefix+'-'+m.id+'" onclick="event.stopPropagation()" style="margin-top:3px;accent-color:#1C2B1E;width:15px;height:15px;flex-shrink:0">'
      +'<div><div style="font-size:14px;font-weight:600;color:#1C2B1E">'+_esc(m.name)+'</div>'
      +(preview?'<div style="font-size:12px;color:#A09890;margin-top:1px">'+preview+'</div>':'')
      +'</div></label>';
  }).join('') : '<div style="font-size:12px;color:#A09890;padding:6px 0 2px">No saved menus yet.</div>';
  var catOptions = DISH_CATEGORIES.map(function(c){ return '<option value="'+_esc(c)+'">'+(c||'Uncategorised')+'</option>'; }).join('');
  setTimeout(function(){ _renderMenuState(prefix); _syncLibraryCheckboxes(prefix); }, 0);
  return '<div id="jmcurrent-'+prefix+'"></div>'
    +'<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#A09890;margin:4px 0 6px">From your library</div>'
    +savedOpts
    +'<div style="margin-top:10px;border-top:1px solid #E8E2D8;padding-top:10px">'
    +'<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#A09890;margin-bottom:8px">Build a custom menu</div>'
    +'<input type="text" id="jcustom-'+prefix+'-name" class="form-input" placeholder="Menu name (e.g. 6-course dinner)" style="margin-bottom:8px;font-size:13px">'
    +'<div id="jcustom-'+prefix+'-dishes" style="max-height:160px;overflow-y:auto;margin-bottom:8px;border:1px solid #F0EBE2;border-radius:6px;padding:2px 6px">'+_buildDishCheckboxesHTML(prefix)+'</div>'
    +'<div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">'
    +'<input type="text" id="jcustom-'+prefix+'-newdish" class="form-input" placeholder="Add a dish…" style="flex:1;font-size:13px;padding:8px 10px" onkeydown="if(event.key===\'Enter\'){event.preventDefault();addQuickDish(\''+prefix+'\');}">'
    +'<select id="jcustom-'+prefix+'-newcat" class="form-input" style="width:110px;font-size:12px;padding:8px 6px">'+catOptions+'</select>'
    +'<button type="button" onclick="addQuickDish(\''+prefix+'\')" style="padding:8px 12px;background:#2D7A3A;color:#fff;border:none;border-radius:8px;font-size:13px;cursor:pointer;white-space:nowrap;font-family:inherit;flex-shrink:0">+ Add</button>'
    +'</div>'
    +'<button type="button" onclick="addCustomMenuToJob(\''+prefix+'\')" style="width:100%;padding:9px;background:#EAF4EC;color:#1C6B2A;border:1px solid #2D7A3A;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">+ Add this menu to booking</button>'
    +'</div>';
}

function _renderMenuState(prefix){
  var el = document.getElementById('jmcurrent-'+prefix);
  if(!el) return;
  var menus = _jobMenuState[prefix]||[];
  if(!menus.length){ el.innerHTML=''; return; }
  el.innerHTML = '<div style="margin-bottom:8px">'+menus.map(function(m,idx){
    var chips = (m.dishes||[]).map(function(d){
      return '<span style="display:inline-flex;align-items:center;gap:3px;background:#E8F5E9;border:1px solid #b8dfbf;border-radius:6px;padding:2px 7px;font-size:11px;color:#1C2B1E;margin:2px 2px 2px 0">'
        +_esc(d.dish)+'<button type="button" onclick="removeDishFromJobMenu(\''+prefix+'\','+idx+',\''+d.id+'\')" aria-label="Remove dish" style="cursor:pointer;color:#888;font-size:15px;line-height:1;margin-left:2px;background:none;border:none;padding:0;min-width:24px;min-height:24px;display:inline-flex;align-items:center;justify-content:center;vertical-align:middle">×</button></span>';
    }).join('');
    return '<div style="background:#F0F8F1;border:1px solid #b8dfbf;border-radius:8px;padding:10px 12px;margin-bottom:6px">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">'
      +'<div style="font-size:13px;font-weight:700;color:#1C2B1E">'+_esc(m.name)+'</div>'
      +'<button onclick="removeJobMenu(\''+prefix+'\','+idx+')" type="button" aria-label="Remove menu" style="background:none;border:none;color:#A09890;font-size:20px;cursor:pointer;padding:0;line-height:1;min-width:44px;min-height:44px;display:inline-flex;align-items:center;justify-content:center">×</button>'
      +'</div>'+(chips||'<span style="font-size:12px;color:#A09890">No dishes</span>')+'</div>';
  }).join('')+'</div>';
}

function _syncLibraryCheckboxes(prefix){
  var names = (_jobMenuState[prefix]||[]).map(function(m){ return m.name; });
  (mSettings.savedMenus||[]).forEach(function(m){
    var chk = document.getElementById('jmchk-'+prefix+'-'+m.id);
    if(chk) chk.checked = names.indexOf(m.name)!==-1;
  });
}

function toggleSavedMenuOnJob(prefix, menuId){
  var saved = mSettings.savedMenus||[];
  var menu = null;
  for(var i=0;i<saved.length;i++){ if(String(saved[i].id)===String(menuId)){ menu=saved[i]; break; } }
  if(!menu) return;
  var dishes = mSettings.savedDishes||[];
  var dishMap = {};
  dishes.forEach(function(d){ dishMap[d.id]=d; });
  if(!_jobMenuState[prefix]) _jobMenuState[prefix]=[];
  var menus = _jobMenuState[prefix];
  var idx=-1;
  for(var i=0;i<menus.length;i++){ if(menus[i].name===menu.name){ idx=i; break; } }
  if(idx!==-1) menus.splice(idx,1);
  else menus.push({name:menu.name, dishes:window.Veriqo.resolveMenuDishes(menu, dishMap)});
  _renderMenuState(prefix);
  _syncLibraryCheckboxes(prefix);
}

function removeJobMenu(prefix, idx){
  if(!_jobMenuState[prefix]) return;
  _jobMenuState[prefix].splice(idx,1);
  _renderMenuState(prefix);
  _syncLibraryCheckboxes(prefix);
}

function removeDishFromJobMenu(prefix, menuIdx, dishId){
  if(!_jobMenuState[prefix]||!_jobMenuState[prefix][menuIdx]) return;
  _jobMenuState[prefix][menuIdx].dishes = (_jobMenuState[prefix][menuIdx].dishes||[]).filter(function(d){ return String(d.id)!==String(dishId); });
  _renderMenuState(prefix);
}

function addCustomMenuToJob(prefix){
  var nameEl = document.getElementById('jcustom-'+prefix+'-name');
  if(!nameEl) return;
  var name = (nameEl.value||'').trim();
  if(!name){ toast('Enter a menu name','err'); return; }
  var allDishes = mSettings.savedDishes||[];
  var selected = allDishes.filter(function(d){
    var el = document.getElementById('jcdish-'+prefix+'-'+d.id);
    return el && el.checked;
  });
  if(!selected.length){ toast('Select at least one dish','err'); return; }
  if(!_jobMenuState[prefix]) _jobMenuState[prefix]=[];
  _jobMenuState[prefix].push({name:name, dishes:selected.map(function(d){ return Object.assign({},d); })});
  _renderMenuState(prefix);
  nameEl.value='';
  allDishes.forEach(function(d){ var el=document.getElementById('jcdish-'+prefix+'-'+d.id); if(el) el.checked=false; });
  toast('Menu added to booking ✓');
}

function addQuickDish(prefix){
  var nameEl = document.getElementById('jcustom-'+prefix+'-newdish');
  var catEl  = document.getElementById('jcustom-'+prefix+'-newcat');
  var name = (nameEl.value||'').trim();
  if(!name){ toast('Enter a dish name','err'); return; }
  var cat = catEl ? catEl.value : '';
  var dish = { id: uid(), dish: name, category: cat, allergens: [] };
  if(!mSettings.savedDishes) mSettings.savedDishes = [];
  mSettings.savedDishes.push(dish);
  saveMiseSettings();
  if (window.Mise && window.Mise.sync && window.Mise.sync.saveDish) Mise.sync.saveDish(dish);
  var listEl = document.getElementById('jcustom-'+prefix+'-dishes');
  if(listEl){
    if(!listEl.querySelector('input[type="checkbox"]')) listEl.innerHTML = '';
    var lbl = document.createElement('label');
    lbl.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 4px;cursor:pointer';
    var chk = document.createElement('input');
    chk.type='checkbox'; chk.id='jcdish-'+prefix+'-'+dish.id; chk.checked=true;
    chk.style.cssText='accent-color:#1C2B1E;width:14px;height:14px;flex-shrink:0';
    var span = document.createElement('span');
    span.style.cssText='font-size:13px;color:#1C2B1E';
    span.textContent=dish.dish;
    lbl.appendChild(chk); lbl.appendChild(span);
    listEl.appendChild(lbl);
  }
  nameEl.value='';
  toast('Dish added ✓');
}

function _getSelectedMenusSnapshot(prefix){
  return (_jobMenuState[prefix]||[]).map(function(m){ return {name:m.name,dishes:(m.dishes||[]).slice()}; });
}

function renderJobMenuPicker(){
  _jobMenuState['log'] = [];
  _renderMenuState('log');
}

// ═══════════════════════════════════ JOB MENU BUILDER MODAL ══════════════════
var _jmbPrefix = null;
var _jmbSelectedDishes = [];

function openJobMenuBuilder(prefix) {
  _jmbPrefix = prefix;
  _jmbSelectedDishes = [];
  if (!_jobMenuState[prefix]) _jobMenuState[prefix] = [];
  var modal = document.getElementById('jobMenuBuilderModal');
  if (modal) modal.style.display = 'flex';
  switchMenuBuilderTab('library');
  _renderJobMenuLibrary();
  var nameEl = document.getElementById('jmb-menu-name');
  var searchEl = document.getElementById('jmb-search');
  if (nameEl) nameEl.value = '';
  if (searchEl) searchEl.value = '';
}

function closeJobMenuBuilder() {
  var modal = document.getElementById('jobMenuBuilderModal');
  if (modal) modal.style.display = 'none';
  _jmbPrefix = null;
}

function switchMenuBuilderTab(tab) {
  var libBtn   = document.getElementById('jmb-tab-library');
  var custBtn  = document.getElementById('jmb-tab-custom');
  var libPanel = document.getElementById('jmb-panel-library');
  var custPanel= document.getElementById('jmb-panel-custom');
  if (libBtn) {
    libBtn.style.color = tab === 'library' ? '#2D7A3A' : '#7A8A7C';
    libBtn.style.borderBottomColor = tab === 'library' ? '#2D7A3A' : 'transparent';
  }
  if (custBtn) {
    custBtn.style.color = tab === 'custom' ? '#2D7A3A' : '#7A8A7C';
    custBtn.style.borderBottomColor = tab === 'custom' ? '#2D7A3A' : 'transparent';
  }
  if (libPanel)  libPanel.style.display  = tab === 'library' ? 'block' : 'none';
  if (custPanel) custPanel.style.display = tab === 'custom'  ? 'block' : 'none';
  if (tab === 'custom') _renderJobMenuBuilderDishes('');
}

function _renderJobMenuLibrary() {
  var el = document.getElementById('job-menu-library-cards');
  if (!el) return;
  var menus   = mSettings.savedMenus  || [];
  var dishes  = mSettings.savedDishes || [];
  var dishMap = {};
  dishes.forEach(function(d) { dishMap[d.id] = d; });

  if (menus.length === 0) {
    el.innerHTML = '<div style="text-align:center;padding:36px 16px">'
      + '<div style="margin-bottom:12px;color:#7A8A7C">'+vqIcon('book-open',36)+'</div>'
      + '<div style="font-size:14px;color:#7A8A7C;line-height:1.5">No saved menus yet.<br>Go to the Menus tab to build your library,<br>or use the Custom Menu tab.</div>'
      + '</div>';
    return;
  }

  var addedNames = (_jobMenuState[_jmbPrefix] || []).map(function(m) { return m.name; });

  el.innerHTML = menus.map(function(m) {
    var dishCount = (m.dishIds || []).length;
    var preview = (m.dishIds || []).slice(0, 4).map(function(id) {
      return dishMap[id] ? dishMap[id].dish : '';
    }).filter(Boolean).join(' · ');
    if (dishCount > 4) preview += '…';
    var isAdded = addedNames.indexOf(m.name) !== -1;
    return '<div onclick="' + (isAdded ? '' : 'addLibraryMenuToJob(\''+m.id+'\')') + '"'
      + ' style="background:' + (isAdded ? 'rgba(45,122,58,0.08)' : '#1A1A1A') + ';'
      + 'border:1px solid ' + (isAdded ? '#2D7A3A' : 'rgba(45,122,58,0.2)') + ';'
      + 'border-radius:10px;padding:14px;margin-bottom:8px;'
      + 'cursor:' + (isAdded ? 'default' : 'pointer') + ';-webkit-tap-highlight-color:transparent">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">'
      + '<div style="font-size:15px;font-weight:600;color:#F5F0E8">' + _esc(m.name) + '</div>'
      + (isAdded
          ? '<span style="font-size:11px;font-weight:700;color:#2D7A3A;background:rgba(45,122,58,0.15);padding:2px 9px;border-radius:20px">Added ✓</span>'
          : '<span style="font-size:12px;color:#7ACC8A;font-weight:600">Attach →</span>')
      + '</div>'
      + '<div style="font-size:12px;color:#7A8A7C">'
      + dishCount + ' dish' + (dishCount !== 1 ? 'es' : '')
      + (preview ? ' · ' + _esc(preview) : '')
      + '</div></div>';
  }).join('');
}

function addLibraryMenuToJob(menuId) {
  if (!_jmbPrefix) return;
  var saved = mSettings.savedMenus || [];
  var menu = null;
  for (var i = 0; i < saved.length; i++) { if (String(saved[i].id) === String(menuId)) { menu = saved[i]; break; } }
  if (!menu) return;
  var dishes  = mSettings.savedDishes || [];
  var dishMap = {};
  dishes.forEach(function(d) { dishMap[d.id] = d; });
  if (!_jobMenuState[_jmbPrefix]) _jobMenuState[_jmbPrefix] = [];
  var alreadyAdded = _jobMenuState[_jmbPrefix].some(function(m) { return m.name === menu.name; });
  if (alreadyAdded) { toast('"' + menu.name + '" already attached', 'warn'); return; }
  _jobMenuState[_jmbPrefix].push({
    name: menu.name,
    dishes: window.Veriqo.resolveMenuDishes(menu, dishMap)
  });
  _renderMenuState(_jmbPrefix);
  closeJobMenuBuilder();
  toast('"' + menu.name + '" added to booking ✓');
}

function _renderJobMenuBuilderDishes(filter) {
  var dishListEl = document.getElementById('jmb-dish-list');
  var chipEl     = document.getElementById('jmb-selected-chips');
  var dishes     = mSettings.savedDishes || [];
  var dishMap    = {};
  dishes.forEach(function(d) { dishMap[d.id] = d; });

  if (chipEl) {
    chipEl.innerHTML = _jmbSelectedDishes.length === 0 ? '' : _jmbSelectedDishes.map(function(id) {
      var d = dishMap[id];
      return d
        ? '<span onclick="toggleJmbDish(\'' + id + '\')" style="display:inline-flex;align-items:center;gap:4px;background:rgba(45,122,58,0.15);border:1px solid rgba(45,122,58,0.4);border-radius:20px;padding:3px 10px;font-size:12px;color:#2D7A3A;cursor:pointer">'
          + _esc(d.dish) + ' <span style="font-size:14px;line-height:1">×</span></span>'
        : '';
    }).join('');
  }

  if (!dishListEl) return;

  var f = (filter || '').toLowerCase().trim();
  var filtered = f ? dishes.filter(function(d) { return d.dish.toLowerCase().indexOf(f) !== -1; }) : dishes;

  if (filtered.length === 0) {
    dishListEl.innerHTML = '<div style="padding:18px;font-size:13px;color:#7A8A7C;text-align:center">'
      + (dishes.length === 0
          ? 'No dishes in library — add some in the Menus tab first.'
          : 'No dishes match your search.')
      + '</div>';
    return;
  }

  var grouped = {};
  var ORDER   = DISH_CATEGORIES.filter(function(c) { return c !== ''; });
  filtered.forEach(function(d) {
    var cat = d.category || 'Other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(d);
  });

  function renderGroup(cat) {
    var html = '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#7ACC8A;padding:10px 0 4px">' + _esc(cat) + '</div>';
    grouped[cat].forEach(function(d) {
      var sel = _jmbSelectedDishes.indexOf(d.id) !== -1;
      html += '<div onclick="toggleJmbDish(\'' + d.id + '\')" style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06);cursor:pointer;-webkit-tap-highlight-color:transparent">'
        + '<span style="font-size:14px;color:' + (sel ? '#7ACC8A' : '#F5F0E8') + '">' + _esc(d.dish) + '</span>'
        + '<span style="font-size:16px;color:' + (sel ? '#7ACC8A' : 'rgba(255,255,255,0.2)') + ';font-weight:700">' + (sel ? '✓' : '+') + '</span>'
        + '</div>';
    });
    return html;
  }

  var html = '';
  var shown = {};
  ORDER.forEach(function(cat) { if (grouped[cat] && grouped[cat].length) { shown[cat] = true; html += renderGroup(cat); } });
  Object.keys(grouped).forEach(function(cat) { if (!shown[cat]) html += renderGroup(cat); });
  dishListEl.innerHTML = html;
}

function filterJobMenuBuilderDishes() {
  var f = document.getElementById('jmb-search');
  _renderJobMenuBuilderDishes(f ? f.value : '');
}

function toggleJmbDish(dishId) {
  var idx = _jmbSelectedDishes.indexOf(dishId);
  if (idx !== -1) _jmbSelectedDishes.splice(idx, 1);
  else _jmbSelectedDishes.push(dishId);
  var f = document.getElementById('jmb-search');
  _renderJobMenuBuilderDishes(f ? f.value : '');
}

function addCustomMenuFromModal() {
  if (!_jmbPrefix) return;
  var nameEl = document.getElementById('jmb-menu-name');
  var name   = nameEl ? (nameEl.value || '').trim() : '';
  if (!name) { toast('Enter a menu name', 'err'); return; }
  if (!_jmbSelectedDishes.length) { toast('Select at least one dish', 'err'); return; }
  var dishes   = mSettings.savedDishes || [];
  var selected = dishes.filter(function(d) { return _jmbSelectedDishes.indexOf(d.id) !== -1; });
  if (!_jobMenuState[_jmbPrefix]) _jobMenuState[_jmbPrefix] = [];
  _jobMenuState[_jmbPrefix].push({ name: name, dishes: selected.map(function(d) { return Object.assign({}, d); }) });
  _renderMenuState(_jmbPrefix);
  closeJobMenuBuilder();
  toast('"' + name + '" added to booking ✓');
}

// ═══════════════════════════════════════════ MAGIC IMPORT ════════════════════
async function handleMagicImport(event) {
  var file = event.target.files && event.target.files[0];
  if (!file) return;
  event.target.value = '';

  if (file.size > 4 * 1024 * 1024) {
    toast('File too large — please use an image under 4MB', 'err');
    return;
  }

  var btn = document.getElementById('magic-import-btn');
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

  var dataUrl, mimeType;
  try {
    var isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      if (btn) { btn.innerHTML = '⏳ Reading PDF…'; btn.disabled = true; }
      dataUrl = await _carteReadPdfAsDataUrl(file);
      mimeType = 'image/jpeg';
    } else {
      if (btn) { btn.innerHTML = '⏳ Analysing menu…'; btn.disabled = true; }
      dataUrl = await _carteReadFileAsDataUrl(file);
      mimeType = file.type || 'image/jpeg';
    }
  } catch (e) {
    resetBtn(true);
    toast('Could not read file — try a different format', 'err');
    console.error('[Carte] Magic import read:', e);
    return;
  }

  if (btn) btn.innerHTML = '⏳ Analysing menu…';
  var base64 = dataUrl.indexOf(',') !== -1 ? dataUrl.split(',')[1] : dataUrl;

  try {
    var res = await fetch('/api/parse-menu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64, mimeType: mimeType })
    });
    var data = await res.json();

    if (data.error) {
      resetBtn(true);
      toast('Import failed: ' + data.error, 'err');
      console.error('[Carte] Magic import API:', data.error);
      return;
    }

    if (!mSettings.savedDishes) mSettings.savedDishes = [];
    if (!mSettings.savedMenus)  mSettings.savedMenus  = [];

    var existingNames = mSettings.savedDishes.map(function(d) { return d.dish.toLowerCase(); });
    var newDishIds    = [];

    (data.dishes || []).forEach(function(d) {
      var lower = (d.name || '').trim().toLowerCase();
      if (!lower) return;
      var existingIdx = existingNames.indexOf(lower);
      if (existingIdx !== -1) {
        var existing = mSettings.savedDishes[existingIdx];
        if (existing) newDishIds.push(existing.id);
      } else {
        var _importedAllergens = (d.allergens || []).map(window.Veriqo.normalizeAllergen);
        var dish = { id: uid(), dish: d.name.trim(), category: d.category || '', allergens: _importedAllergens };
        mSettings.savedDishes.push(dish);
        existingNames.push(lower);
        newDishIds.push(dish.id);
      }
    });

    if (newDishIds.length > 0) {
      var baseName = data.menuName || ('Imported ' + new Date().toLocaleDateString('en-GB', {day:'numeric', month:'short'}));
      var existingMenuNames = mSettings.savedMenus.map(function(m) { return m.name.toLowerCase(); });
      var finalName = baseName;
      var suffix    = 2;
      while (existingMenuNames.indexOf(finalName.toLowerCase()) !== -1) {
        finalName = baseName + ' (' + suffix++ + ')';
      }
      var _importedMenu = { id: uid(), name: finalName, dishIds: newDishIds };
      // Local save always happens first and is never lost, regardless of
      // whether the cloud sync below succeeds — the user's import is never
      // at risk even if they're offline or the request fails.
      mSettings.savedMenus.push(_importedMenu);
      saveMiseSettings();
      renderDishLibrary();
      renderMenuDishSelect();
      renderSavedMenus();
      // Button stays disabled until the sync below settles (success or
      // failure) — re-enabling it immediately would let a rapid double-click
      // kick off a second concurrent import of the same file/menu.

      // Sync: upsert dishes + menu + menu_dishes relationships atomically
      // (one Postgres transaction via menu_import_upsert) so this can never
      // show success with the menu saved but its dish relationships missing
      // — the exact bug that silently produced 0-dish "AI-imported" menus in
      // Costing/HACCP before this fix. On failure the import is queued for
      // retry and the toast says so instead of claiming an unqualified win.
      if (window.Mise && window.Mise.sync && window.Mise.sync.importMenu) {
        var _newDishObjs = (mSettings.savedDishes || []).filter(function(d){ return newDishIds.indexOf(d.id) !== -1; })
          .map(function(d){ return { id: d.id, name: d.dish, category: d.category, allergens: d.allergens }; });
        var _importResult = await Mise.sync.importMenu({ dishes: _newDishObjs, menu: { id: _importedMenu.id, name: finalName }, dishIds: newDishIds });
        resetBtn(false);
        if (_importResult && _importResult.ok) {
          toast('✨ ' + newDishIds.length + ' dish' + (newDishIds.length !== 1 ? 'es' : '') + ' imported into "' + finalName + '"');
        } else {
          toast('Imported locally — syncing to your other devices, will retry', 'warn');
        }
      } else {
        resetBtn(false);
        toast('✨ ' + newDishIds.length + ' dish' + (newDishIds.length !== 1 ? 'es' : '') + ' imported into "' + finalName + '" (saved locally only)');
      }
    } else {
      saveMiseSettings();
      resetBtn(false);
      toast('No new dishes found in image', 'warn');
    }

  } catch (err) {
    resetBtn(true);
    toast('Import failed — check your connection and try again', 'err');
    console.error('[Carte] Magic import fetch:', err);
  }
}

// ══════════════════════════════════════════════ SCAN LABEL (ALLERGEN) ════════
async function handleScanLabel(event) {
  var file = event.target.files && event.target.files[0];
  if (!file) return;
  event.target.value = '';

  if (file.size > 4 * 1024 * 1024) {
    toast('File too large — please use an image under 4MB', 'err');
    return;
  }

  var btn = document.getElementById('scan-label-btn');
  var origHTML = btn ? btn.innerHTML : '';
  if (btn) { btn.innerHTML = '⏳ Scanning…'; btn.disabled = true; }

  function resetBtn(failed) {
    if (!btn) return;
    if (failed) {
      btn.innerHTML = '❌ Scan failed';
      btn.disabled = true;
      setTimeout(function() { btn.innerHTML = origHTML; btn.disabled = false; }, 3000);
    } else {
      btn.innerHTML = origHTML;
      btn.disabled = false;
    }
  }

  var dataUrl;
  try {
    dataUrl = await _carteReadFileAsDataUrl(file);
  } catch (e) {
    resetBtn(true);
    toast('Could not read file', 'err');
    return;
  }

  var base64 = dataUrl.indexOf(',') !== -1 ? dataUrl.split(',')[1] : dataUrl;

  try {
    var res = await fetch('/api/ai-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'label', image: base64, mimeType: file.type || 'image/jpeg' })
    });
    var data = await res.json();

    if (data.error) {
      resetBtn(true);
      toast('Scan failed: ' + data.error, 'err');
      console.error('[Carte] Scan label API:', data.error);
      return;
    }

    var nameEl = document.getElementById('dish-name');
    if (nameEl && data.ingredientName) nameEl.value = data.ingredientName;
    setDishAllergens(data.allergens || []);
    var count = (data.allergens || []).length;
    resetBtn(false);
    toast('✨ Label scanned — ' + (count ? count + ' allergen' + (count !== 1 ? 's' : '') + ' found' : 'no allergens declared'));

  } catch (err) {
    resetBtn(true);
    toast('Scan failed — check your connection and try again', 'err');
    console.error('[Carte] Scan label fetch:', err);
  }
}

function _carteReadFileAsDataUrl(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(e) { resolve(e.target.result); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function _carteReadPdfAsDataUrl(file) {
  if (!window.pdfjsLib) {
    await new Promise(function(resolve, reject) {
      var script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
  var arrayBuffer = await file.arrayBuffer();
  var pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  var page = await pdf.getPage(1);
  var viewport = page.getViewport({ scale: 2.0 });
  var canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
  return canvas.toDataURL('image/jpeg', 0.85);
}

// ═══════════════════════════════════════════════════════ PDF EXPORT ══════════
function exportJobsPDF(){
  var jobs = getAllJobs().filter(function(j){ return j.id && j.id.indexOf('veriqo_') !== 0; });
  if(!jobs.length){ toast('No jobs to export','err'); return; }
  buildJobsPDF(jobs);
}

function buildJobsPDF(jobs){
  function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  var businessName = mSettings.businessName || '';
  var chefName     = mSettings.chefName     || '';
  var logo         = mSettings.logo         || '';

  var now      = new Date();
  var genDate  = now.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
  var genTime  = now.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  var refNum   = now.getFullYear().toString()+String(now.getMonth()+1).padStart(2,'0')+String(now.getDate()).padStart(2,'0')+'-'+jobs.length;

  // Group by month (same as renderJobsHistory)
  var byMonth = {};
  jobs.forEach(function(j){
    var mo = (j.eventDate||j.date||'').slice(0,7);
    if(!byMonth[mo]) byMonth[mo]=[];
    byMonth[mo].push(j);
  });
  var months = Object.keys(byMonth).sort().reverse();

  var sectionsHtml = months.map(function(mo){
    var parts = mo.split('-');
    var moLabel = MONTHS[parseInt(parts[1],10)-1] + ' ' + parts[0];
    var catOrder = DISH_CATEGORIES.filter(function(c){ return c!==''; });
    var rows = byMonth[mo].map(function(j){
      var dateStr = j.eventDate ? fmtDate(j.eventDate) : (j.date || '');
      var timeStr = j.eventTime || '';
      var when    = dateStr + (timeStr ? ' · ' + timeStr : '');
      var details = [
        j.location ? esc(j.location) : '',
        j.covers   ? esc(j.covers) + ' covers' : '',
        j.jobType  ? esc(j.jobType) : '',
        j.notes    ? '<em>' + esc(j.notes) + '</em>' : ''
      ].filter(Boolean).join(' &nbsp;·&nbsp; ');
      var mainRow = '<tr>'
        +'<td style="padding:8px 10px;border-bottom:'+(j.menus&&j.menus.length?'none':'1px solid #EFE9DE')+';font-size:13px;color:#444;white-space:nowrap;vertical-align:top">'+esc(when)+'</td>'
        +'<td style="padding:8px 10px;border-bottom:'+(j.menus&&j.menus.length?'none':'1px solid #EFE9DE')+';font-size:14px;font-weight:600;color:#1C2B1E;vertical-align:top">'+esc(j.client||'')+'</td>'
        +'<td style="padding:8px 10px;border-bottom:'+(j.menus&&j.menus.length?'none':'1px solid #EFE9DE')+';font-size:13px;color:#555;vertical-align:top">'+details+'</td>'
        +'</tr>';
      var menuRows = '';
      if(j.menus && j.menus.length){
        var menuCells = j.menus.map(function(m){
          var grouped = {};
          (m.dishes||[]).forEach(function(d){
            var cat = d.category||'Other';
            if(!grouped[cat]) grouped[cat]=[];
            grouped[cat].push(d);
          });
          var dishParts = [];
          catOrder.forEach(function(cat){
            if(!grouped[cat]||!grouped[cat].length) return;
            dishParts.push('<strong style="color:#1C2B1E">'+esc(cat)+':</strong> '+grouped[cat].map(function(d){
              return esc(d.dish)+(d.allergens&&d.allergens.length?' <em style="color:#A09890">('+d.allergens.map(esc).join(', ')+')</em>':'');
            }).join(', '));
          });
          // uncategorised
          if(grouped['Other']&&grouped['Other'].length&&catOrder.indexOf('Other')===-1){
            dishParts.push(grouped['Other'].map(function(d){ return esc(d.dish); }).join(', '));
          }
          return '<div style="margin-bottom:6px">'
            +'<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#2D7A3A;margin-bottom:3px">'+esc(m.name)+'</div>'
            +(dishParts.length ? '<div style="font-size:12px;color:#444;line-height:1.6">'+dishParts.join('<br>')+'</div>' : '')
            +'</div>';
        }).join('');
        menuRows = '<tr><td colspan="3" style="padding:0 10px 10px 10px;border-bottom:1px solid #EFE9DE">'+menuCells+'</td></tr>';
      }
      return mainRow + menuRows;
    }).join('');
    return '<div style="margin-bottom:28px;page-break-inside:avoid">'
      +'<div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#2D7A3A;border-bottom:2px solid #2D7A3A;padding-bottom:4px;margin-bottom:0">'+esc(moLabel)+'</div>'
      +'<table style="width:100%;border-collapse:collapse">'
      +'<thead><tr style="background:#EAF4EC">'
      +'<th style="text-align:left;padding:7px 10px;font-size:11px;color:#888;font-weight:600;border-bottom:1px solid #D4C9B5">Date</th>'
      +'<th style="text-align:left;padding:7px 10px;font-size:11px;color:#888;font-weight:600;border-bottom:1px solid #D4C9B5">Client</th>'
      +'<th style="text-align:left;padding:7px 10px;font-size:11px;color:#888;font-weight:600;border-bottom:1px solid #D4C9B5">Details</th>'
      +'</tr></thead>'
      +'<tbody>'+rows+'</tbody></table></div>';
  }).join('');

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8">'
    +'<meta name="viewport" content="width=device-width,initial-scale=1">'
    +'<title>Booking Report — '+esc(businessName||chefName||'Menus')+'</title>'
    +'<style>'
    +'*{box-sizing:border-box;margin:0;padding:0}'
    +'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1C2B1E;background:#fff;padding:24px}'
    +'.toolbar{position:sticky;top:0;z-index:10;background:#fff;border-bottom:1px solid #EFE9DE;padding:10px 0;margin:-24px -24px 20px;padding-left:24px;display:flex;gap:10px;align-items:center}'
    +'.btn-pdf{background:#2D7A3A;color:#fff;border:none;border-radius:6px;padding:9px 18px;font-size:14px;font-weight:600;cursor:pointer}'
    +'.btn-close{background:#f5f4f0;color:#1C2B1E;border:1px solid #D4C9B5;border-radius:6px;padding:9px 14px;font-size:14px;cursor:pointer}'
    +'@media print{'
    +'@page{size:A4;margin:18mm}'
    +'.no-print{display:none!important}'
    +'body{padding:0}'
    +'}'
    +'</style></head><body>'
    +'<div class="toolbar no-print">'
    +'<button class="btn-pdf" onclick="window.print()">Save as PDF</button>'
    +'<button class="btn-close" onclick="window.close()">Close</button>'
    +'</div>'
    // Header
    +'<div style="border-bottom:3px solid #1C2B1E;padding-bottom:14px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">'
    +  '<div style="display:flex;align-items:center;gap:14px">'
    +    (logo ? '<img src="'+logo+'" alt="" style="max-height:56px;max-width:140px;object-fit:contain;border-radius:4px">' : '')
    +    '<div>'
    +      '<div style="font-size:9px;letter-spacing:0.12em;text-transform:uppercase;color:#2D7A3A;font-weight:700;margin-bottom:4px">Booking Report</div>'
    +      '<div style="font-size:22px;font-weight:700;color:#1C2B1E">'+(businessName ? esc(businessName) : 'Menus')+'</div>'
    +      (chefName ? '<div style="font-size:13px;color:#555;margin-top:3px">'+esc(chefName)+'</div>' : '')
    +    '</div>'
    +  '</div>'
    +  '<div style="text-align:right;flex-shrink:0">'
    +    '<div style="font-size:12px;font-weight:700;color:#2D7A3A;letter-spacing:0.02em">Veriqo</div>'
    +    '<div style="font-size:11px;color:#A09890;margin-top:3px">'+jobs.length+' job'+(jobs.length!==1?'s':'')+'</div>'
    +    '<div style="font-size:11px;color:#A09890;margin-top:2px">'+esc(genDate)+' · '+esc(genTime)+'</div>'
    +  '</div>'
    +'</div>'
    // Sections
    + sectionsHtml
    // Footer
    +'<div style="margin-top:32px;padding-top:12px;border-top:1px solid #EFE9DE;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">'
    +  '<span style="font-size:11px;color:#A09890">Generated by Carte — Private chef. Perfectly organised. &nbsp;|&nbsp; '+esc(genDate)+' at '+esc(genTime)+'</span>'
    +  '<span style="font-size:11px;color:#C8C0B5">Ref: '+esc(refNum)+'</span>'
    +'</div>'
    +'</body></html>';

  var blob = new Blob([html],{type:'text/html'});
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href   = url; a.target = '_blank'; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 10000);
}

// ═══════════════════════════════════════════════════════ TRANSPORT ══════════
function logTransport(){
  var food = (document.getElementById('mise-tr-food').value||'').trim();
  if(!food){ toast('Food item required','err'); return; }
  var client = (document.getElementById('tr-client-manual').value||'').trim()
    || (function(){ var e=addressBookLookup(document.getElementById('tr-client-select').value); return e?e.name:''; })();
  var tempStart = document.getElementById('tr-temp-start').value;
  var tempEnd   = document.getElementById('tr-temp-end').value;
  var ts = parseFloat(tempStart); var te = parseFloat(tempEnd);
  var status = (!isNaN(ts) && ts > 8) || (!isNaN(te) && te > 8) ? 'warn' : 'ok';
  var rec = {
    id: uid(), type: 'transport', date: document.getElementById('tr-date').value || TODAY,
    time: new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}),
    client: client, food: food,
    destination: (document.getElementById('tr-dest').value||'').trim(),
    tempStart: tempStart, tempEnd: tempEnd, status: status,
    by: document.getElementById('mise-tr-by').value||''
  };
  mRecords.push(rec); saveMiseToday();
  ['tr-client-manual','mise-tr-food','tr-dest','tr-temp-start','tr-temp-end'].forEach(function(id){
    document.getElementById(id).value='';
  });
  document.getElementById('tr-client-select').value='';
  document.getElementById('tr-date').value=TODAY;
  renderTransportList();
  toast(status==='warn' ? 'Saved — temperature above 8°C ⚠️' : 'Transport record saved ✓');
}

function renderTransportList(){
  var el = document.getElementById('transport-list');
  if(!el) return;
  var recs = getAllTypeRecords('transport').slice(0,15);
  if(recs.length===0){ el.innerHTML='<p class="empty">No transport records yet.</p>'; return; }
  el.innerHTML = recs.map(function(r){
    var statusBadge = r.status==='warn'
      ? '<span class="badge badge-gold">⚠ Warm</span>'
      : '<span class="badge badge-green">✓ OK</span>';
    return '<div class="card" style="margin-bottom:8px">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start">'
      + '<div><div style="font-size:14px;font-weight:600;color:#1C2B1E">'+_esc(r.food)+'</div>'
      + (r.client ? '<div style="font-size:12px;color:#A09890">'+_esc(r.client)+'</div>' : '')
      + '<div style="font-size:12px;color:#A09890;margin-top:2px">'+fmtDate(r.date)+' · '+(r.by?_esc(r.by):'')+'</div>'
      + '</div>'+statusBadge+'</div>'
      + '<div style="margin-top:8px;font-size:13px;color:#5A544E">'
      + (r.tempStart ? '📦 Load: <b>'+r.tempStart+'°C</b> ' : '')
      + (r.tempEnd   ? '🏁 Arrival: <b>'+r.tempEnd+'°C</b>' : '')
      + '</div></div>';
  }).join('');
}

// ═══════════════════════════════════════════════════════ ASSESS ════════════
function logAssess(){
  var client = (document.getElementById('as-client').value||'').trim()
    || (function(){ var e=addressBookLookup(document.getElementById('as-client-select').value); return e?e.name:''; })();
  if(!client){ toast('Client / location required','err'); return; }
  var rec = {
    id: uid(), type: 'assess', date: document.getElementById('as-date').value||TODAY,
    time: new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}),
    client: client,
    fridgeTemp:   document.getElementById('as-fridge-temp').value,
    freezerTemp:  document.getElementById('as-freezer-temp').value,
    condition:    document.getElementById('as-condition').value,
    notes:        (document.getElementById('as-notes').value||'').trim(),
    by:           document.getElementById('as-by').value||''
  };
  mRecords.push(rec); saveMiseToday();
  ['as-client','as-fridge-temp','as-freezer-temp','as-notes'].forEach(function(id){
    document.getElementById(id).value='';
  });
  document.getElementById('as-condition').value='';
  document.getElementById('as-client-select').value='';
  document.getElementById('as-date').value=TODAY;
  renderAssessList();
  toast('Assessment saved ✓');
}

function renderAssessList(){
  var el = document.getElementById('assess-list');
  if(!el) return;
  var recs = getAllTypeRecords('assess').slice(0,10);
  if(recs.length===0){ el.innerHTML='<p class="empty">No assessments yet.</p>'; return; }
  el.innerHTML = recs.map(function(r){
    return '<div class="card" style="margin-bottom:8px">'
      + '<div style="font-size:14px;font-weight:600;color:#1C2B1E">'+_esc(r.client)+'</div>'
      + '<div style="font-size:12px;color:#A09890;margin-top:2px">'+fmtDate(r.date)+(r.by?' · '+_esc(r.by):'')+'</div>'
      + (r.fridgeTemp ? '<div style="font-size:13px;color:#5A544E;margin-top:6px">🌡 Fridge: <b>'+r.fridgeTemp+'°C</b>'+(r.freezerTemp?' &nbsp;Freezer: <b>'+r.freezerTemp+'°C</b>':'')+'</div>' : '')
      + (r.condition  ? '<div style="font-size:12px;color:#5A544E;margin-top:4px">'+_esc(r.condition)+'</div>' : '')
      + '</div>';
  }).join('');
}

// ═══════════════════════════════════════════════════════ ALLERGEN ══════════
function logAllergen(){
  var client = (document.getElementById('al-client').value||'').trim()
    || (function(){ var e=addressBookLookup(document.getElementById('al-client-select').value); return e?e.name:''; })();
  var dish = (document.getElementById('al-dish').value||'').trim();
  if(!dish){ toast('Dish name required','err'); return; }
  var present = ALLERGENS_14.filter(function(a){
    var cb = document.getElementById('al-a-'+a.replace(/\s/g,'_'));
    return cb && cb.checked;
  });
  var rec = {
    id: uid(), type: 'allergen', date: TODAY,
    time: new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}),
    client: client, dish: dish,
    allergens: present.join(', '),
    notes: (document.getElementById('al-notes').value||'').trim()
  };
  mRecords.push(rec); saveMiseToday();
  document.getElementById('al-client').value='';
  document.getElementById('al-dish').value='';
  document.getElementById('al-notes').value='';
  document.getElementById('al-client-select').value='';
  ALLERGENS_14.forEach(function(a){
    var cb=document.getElementById('al-a-'+a.replace(/\s/g,'_'));
    if(cb) cb.checked=false;
  });
  renderAllergenList();
  toast('Allergen record saved ✓');
}

function renderAllergenList(){
  var el = document.getElementById('allergen-list');
  if(!el) return;
  var recs = getAllTypeRecords('allergen').slice(0,15);
  if(recs.length===0){ el.innerHTML='<p class="empty">No allergen records yet.</p>'; return; }
  el.innerHTML = recs.map(function(r){
    return '<div class="card" style="margin-bottom:8px">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start">'
      + '<div><div style="font-size:14px;font-weight:600;color:#1C2B1E">'+_esc(r.dish)+'</div>'
      + (r.client ? '<div style="font-size:12px;color:#A09890">'+_esc(r.client)+'</div>' : '')
      + '</div><div style="font-size:12px;color:#A09890">'+fmtDate(r.date)+'</div></div>'
      + (r.allergens ? '<div style="margin-top:8px;font-size:13px;color:#8A2D2D;background:#FBECEC;padding:6px 8px;border-radius:6px">⚠ '+_esc(r.allergens)+'</div>' : '<div style="margin-top:8px;font-size:13px;color:#2A6432">✓ No major allergens declared</div>')
      + '</div>';
  }).join('');
}

// ═══════════════════════════════════════════════════════ CREDENTIALS ═══════
function addCredential(){
  var name = (document.getElementById('cred-name').value||'').trim();
  if(!name){ toast('Certificate name required','err'); return; }
  if(!mSettings.credentials) mSettings.credentials=[];
  mSettings.credentials.push({
    id: uid(),
    name: name,
    holder:  document.getElementById('cred-holder').value||'',
    issuer:  (document.getElementById('cred-issuer').value||'').trim(),
    issued:  document.getElementById('cred-issued').value||'',
    expiry:  document.getElementById('cred-expiry').value||''
  });
  saveMiseSettings();
  ['cred-name','cred-issuer','cred-issued','cred-expiry'].forEach(function(id){ document.getElementById(id).value=''; });
  document.getElementById('cred-holder').value='';
  renderCredentialsList();
  toast('Credential saved ✓');
}

function renderCredentialsList(){
  var el = document.getElementById('credentials-list');
  if(!el) return;
  var creds = mSettings.credentials||[];
  if(creds.length===0){ el.innerHTML='<p class="empty">No credentials added yet.</p>'; return; }
  var today = TODAY;
  var soon  = new Date(Date.now()+90*86400000).toISOString().slice(0,10);
  el.innerHTML = '<div class="card">' + creds.map(function(c){
    var expClass='', expText='';
    if(c.expiry){
      if(c.expiry < today){ expClass='cred-exp'; expText='Expired '+fmtDate(c.expiry); }
      else if(c.expiry <= soon){ expClass='cred-soon'; expText='Exp '+fmtDate(c.expiry); }
      else { expClass='cred-ok'; expText='Exp '+fmtDate(c.expiry); }
    }
    return '<div class="cred-row">'
      + '<div class="cred-name"><div class="cred-title">'+_esc(c.name)+'</div>'
      + '<div class="cred-issuer">'+(c.holder?_esc(c.holder)+' · ':'')+( c.issuer?_esc(c.issuer):'')+'</div></div>'
      + (expText ? '<div class="cred-expiry '+expClass+'">'+expText+'</div>' : '')
      + '<button onclick="deleteCred(\''+c.id+'\')" class="btn-remove" aria-label="Delete credential">×</button>'
      + '</div>';
  }).join('') + '</div>';
}

function deleteCred(id){
  mSettings.credentials=(mSettings.credentials||[]).filter(function(c){ return c.id!==id; });
  saveMiseSettings(); renderCredentialsList(); toast('Removed');
}

// ═══════════════════════════════════════════════════════ SETTINGS ══════════
// ── Subscription card in Settings ─────────────────────────────────────────────
function renderCarteSubscriptionCard() {
  var card = document.getElementById('carte-subscription-card');
  if (!card) return;
  var profile = window.Mise && window.Mise.profile;
  if (!profile) return;

  var status   = profile.subscription_status;
  var plan     = profile.subscription_plan || null;
  var trialEnd = profile.trial_ends_at ? new Date(profile.trial_ends_at) : null;
  var inTrial  = status === 'trial' && trialEnd && trialEnd > new Date();
  var daysLeft = inTrial ? Math.ceil((trialEnd - new Date()) / (1000*60*60*24)) : 0;

  var planLabel = plan === 'suite' ? 'Carte + Veriqo Suite' : plan === 'carte' ? 'Menus' : plan === 'veriqo' ? 'Veriqo' : 'Free trial';
  var badge, body, actions;

  if (status === 'active') {
    badge = '<span style="display:inline-block;background:rgba(58,125,68,0.15);color:#3A7D44;font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px;letter-spacing:0.03em">ACTIVE</span>'
          + '<span style="display:inline-block;margin-left:6px;font-size:11px;color:#A09890">' + planLabel + '</span>';
    body  = '<div style="font-size:13px;color:#5A544E;margin-top:8px">Your subscription is active. Use the link below to cancel, update your payment method, or view invoices.</div>';
    actions = '<button onclick="openCartePortal(this)" style="margin-top:14px;width:100%;padding:11px;background:#2D7A3A;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">Manage subscription →</button>';
  } else if (inTrial) {
    var dayWord = daysLeft === 1 ? 'day' : 'days';
    badge  = '<span style="display:inline-block;background:rgba(45,122,58,0.12);color:#1C6B2A;font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px;letter-spacing:0.03em">FREE TRIAL</span>';
    body   = '<div style="font-size:13px;color:#5A544E;margin-top:8px">' + daysLeft + ' ' + dayWord + ' remaining. Subscribe to keep full access to Veriqo.</div>';
    actions = '<div style="display:flex;gap:8px;margin-top:14px">'
      + '<button onclick="Mise.carteSubscription.startCheckout(\'carte\',\'monthly\')" style="flex:1;padding:11px;background:#fff;border:2px solid #D0C8BE;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;color:#1C2B1E">£12/month</button>'
      + '<button onclick="Mise.carteSubscription.startCheckout(\'carte\',\'annual\')" style="flex:1;padding:11px;background:#2D7A3A;border:2px solid #2D7A3A;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;color:#fff">£120/year</button>'
      + '</div>';
  } else {
    var isExpiredTrial = status === 'trial';
    badge  = '<span style="display:inline-block;background:#fde8e8;color:#A32D2D;font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px;letter-spacing:0.03em">' + (isExpiredTrial ? 'TRIAL ENDED' : 'INACTIVE') + '</span>';
    body   = '<div style="font-size:13px;color:#5A544E;margin-top:8px">Subscribe to restore full access to Veriqo.</div>';
    actions = '<div style="display:flex;gap:8px;margin-top:14px">'
      + '<button onclick="Mise.carteSubscription.startCheckout(\'carte\',\'monthly\')" style="flex:1;padding:11px;background:#fff;border:2px solid #D0C8BE;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;color:#1C2B1E">£12/month</button>'
      + '<button onclick="Mise.carteSubscription.startCheckout(\'carte\',\'annual\')" style="flex:1;padding:11px;background:#2D7A3A;border:2px solid #2D7A3A;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;color:#fff">£120/year</button>'
      + '</div>';
  }

  card.innerHTML = '<div class="card-title">Subscription</div>'
    + '<div style="padding-top:4px">'
    + badge + body + actions
    + '</div>';
}

async function openCartePortal(btn) {
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
        method: 'POST',
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
    console.error('[Carte] Portal error:', err);
    btn.textContent = orig;
    btn.disabled = false;
    if (typeof toast === 'function') toast('Could not open — please try again', false);
  }
}

function loadProfileUI(){
  var fields = {
    'set-chef-name':'chefName',
    'set-business':'businessName',
    'set-phone':'phone',
    'set-email':'email'
  };
  Object.keys(fields).forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.value = mSettings[fields[id]]||'';
  });
  // Restore logo if stored
  var logoImg  = document.getElementById('carte-logo-img');
  var logoPrev = document.getElementById('carte-logo-preview');
  if(logoImg && mSettings.logo){
    logoImg.src = mSettings.logo;
    if(logoPrev) logoPrev.style.display = 'block';
  }
  var bioEl = document.getElementById('pdfBio');
  if(bioEl && mSettings.bio) bioEl.value = mSettings.bio;
  renderTemplatesList();
  renderTemplateDropdown();
}

function previewCarteLogo(input){
  var file = input.files && input.files[0]; if(!file) return;
  var reader = new FileReader();
  reader.onload = function(e){
    var img = document.getElementById('carte-logo-img');
    if(img){ img.src = e.target.result; }
    var prev = document.getElementById('carte-logo-preview');
    if(prev) prev.style.display = 'block';
  };
  reader.readAsDataURL(file);
}

function clearCarteLogo(){
  var img = document.getElementById('carte-logo-img');
  if(img) img.src = '';
  var prev = document.getElementById('carte-logo-preview');
  if(prev) prev.style.display = 'none';
  mSettings.logo = '';
}

function saveProfile(){
  var logoImg = document.getElementById('carte-logo-img');
  var logo = (logoImg && logoImg.src && logoImg.src !== window.location.href) ? logoImg.src : (mSettings.logo||'');
  mSettings.chefName      = (document.getElementById('set-chef-name').value||'').trim();
  mSettings.businessName  = (document.getElementById('set-business').value||'').trim();
  mSettings.phone         = (document.getElementById('set-phone').value||'').trim();
  mSettings.email         = (document.getElementById('set-email').value||'').trim();
  mSettings.logo          = logo;
  saveMiseSettings();
  updateDashboard();
  // Also update shared profiles table so Veriqo picks up the latest name/company/logo
  (async function(){
    try {
      var userResult = await supabaseClient.auth.getUser();
      var user = userResult.data && userResult.data.user;
      if(user){
        await supabaseClient.from('profiles').update({
          business_name: mSettings.businessName||null,
          chef_name:     mSettings.chefName||null,
          logo:          mSettings.logo||null
        }).eq('id', user.id);
      }
    } catch(e){ console.warn('[Carte] saveProfile profiles update failed:', e.message); }
  })();
  toast('Profile saved ✓');
}

function renderStaffList(){
  var el = document.getElementById('staff-list');
  if(!el) return;
  var staff = mSettings.staff||[];
  if(staff.length===0){ el.innerHTML='<p class="empty" style="padding:4px 0 8px">No staff added yet.</p>'; return; }
  el.innerHTML = staff.map(function(s){
    return '<div class="setting-item"><span class="setting-item-name">'+_esc(s)+'</span>'
      + '<button class="btn-remove" aria-label="Remove" onclick="removeStaff(\''+_esc(s)+'\')">×</button></div>';
  }).join('');
}

function addStaff(){
  var input = document.getElementById('staff-input');
  var val = (input.value||'').trim();
  if(!val) return;
  if(!mSettings.staff) mSettings.staff=[];
  if(mSettings.staff.indexOf(val)===-1) mSettings.staff.push(val);
  saveMiseSettings();
  input.value='';
  renderStaffList();
  populateStaffSelects();
  toast('Staff member added');
}

function removeStaff(name){
  mSettings.staff=(mSettings.staff||[]).filter(function(s){ return s!==name; });
  saveMiseSettings(); renderStaffList(); populateStaffSelects();
}

function populateStaffSelects(){
  var staff = mSettings.staff||[];
  var opts  = '<option value="">Select…</option>'
    + staff.map(function(s){ return '<option value="'+_esc(s)+'">'+_esc(s)+'</option>'; }).join('');
  ['tr-by','as-by','cred-holder'].forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.innerHTML = opts;
  });
}

function loadSettingsToggles(){
  var cfg = mSettings.dashboardConfig || {};
  var elNext  = document.getElementById('dash-pref-next');
  var elStats = document.getElementById('dash-pref-stats');
  var elQa    = document.getElementById('dash-pref-qa');
  if(elNext)  elNext.checked  = cfg.showNextBooking  !== false;
  if(elStats) elStats.checked = cfg.showStats        !== false;
  if(elQa)    elQa.checked    = cfg.showQuickActions !== false;
}

function toggleDashWidget(key, val){
  mSettings.dashboardConfig[key] = val;
  saveMiseSettings();
  updateDashboard();
}

function toggleVeriqoSync(val){
}

function mirrorJobToVeriqo(rec){ /* Phase 3: replaced by Mise.sync.saveJob */ }
function openVeriqo(){ window.location.href = '/app'; }
// ── Carte install banner ──────────────────────────────────────────────────────
var _carteInstallPrompt = null;
window.addEventListener('beforeinstallprompt', function(e){
  e.preventDefault(); _carteInstallPrompt = e; _showCarteBanner('android');
});
function _showCarteBanner(type){
  if(localStorage.getItem('carte_install_dismissed')) return;
  if(window.matchMedia('(display-mode: standalone)').matches) return;
  if(window.navigator.standalone) return;
  var banner = document.getElementById('menus-install-banner');
  var body   = document.getElementById('menus-install-banner-body');
  if(!banner || !body) return;
  if(type === 'android'){
    body.innerHTML = '<button onclick="_triggerCarteInstall()" style="margin-top:5px;background:#3A7D44;color:#fff;border:none;border-radius:7px;padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">Install app</button>';
  } else {
    body.innerHTML = 'Tap the <span style="display:inline-block;border:1.5px solid #555;border-radius:4px;padding:0 4px;font-size:12px;line-height:1.6;font-weight:700">&#8679;</span> <strong>Share</strong> button at the bottom of Safari, then tap <strong>Add to Home Screen</strong>';
  }
  banner.style.display = 'flex';
}
function _triggerCarteInstall(){
  if(!_carteInstallPrompt) return;
  _carteInstallPrompt.prompt();
  _carteInstallPrompt.userChoice.then(function(r){
    _carteInstallPrompt = null;
    if(r.outcome === 'accepted') dismissMenusBanner();
  });
}
function dismissMenusBanner(){
  var el = document.getElementById('menus-install-banner');
  if(el) el.style.display = 'none';
  try { localStorage.setItem('carte_install_dismissed','1'); } catch(e){}
}
(function(){
  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  var isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
  if(isIOS && !isStandalone){ setTimeout(function(){ _showCarteBanner('ios'); }, 300); }
})();

// ═══════════════════════════════════════════════════════ INIT ════════════════
function populateMiseSelects(){
  populateClientSelects();
  populateStaffSelects();
}

function renderMiseSections(){
  if(_activeTab !== 'home') return;
  updateDashboard();
}

(function init(){
  loadMiseSettings();
  loadMiseToday();
  populateMiseSelects();
  initAllergenGrid();
  initDishAllergenGrid();
  showTab('home');
  // Set default dates
  var tDate = document.getElementById('tr-date');
  if(tDate) tDate.value = TODAY;
  var aDate = document.getElementById('as-date');
  if(aDate) aDate.value = TODAY;
})();

// Deep link from Veriqo "View booking in Carte" button: ?job=ID
(function(){
  var _djId = new URLSearchParams(window.location.search).get('job');
  if (!_djId) return;
  window.history.replaceState({}, '', '/mise'); // clean URL immediately
  // Poll until auth + sync have run (Mise.profile set = app ready)
  var _djAttempts = 0;
  var _djTimer = setInterval(function(){
    _djAttempts++;
    if (typeof calViewJob === 'function' && window.Mise && window.Mise.profile) {
      clearInterval(_djTimer);
      calViewJob(decodeURIComponent(_djId));
    }
    if (_djAttempts > 60) clearInterval(_djTimer); // give up after 6s
  }, 100);
})();

// Unified shell stubs — routing handled by showModule() in app.html
function openVeriqo() { if (typeof showModule === 'function') showModule('haccp'); }
function openYield()  { if (typeof showModule === 'function') showModule('costing'); }
function dismissMenusBanner() { var b = document.getElementById('menus-install-banner'); if (b) b.style.display = 'none'; }

// ── NUDGE_MAP — cross-module upgrade nudges ────────────────
var MENUS_NUDGE_MAP = {
  dish_added: { module: 'costing', text: "See the food cost for this dish in Costing →" }
};
var _menus_nudge_dismissed = {};

function showMenusNudge(key) {
  var nudge = MENUS_NUDGE_MAP[key];
  if (!nudge) return;
  if (_menus_nudge_dismissed[key]) return;
  if (typeof canAccess === 'function' && canAccess(nudge.module)) return;

  var existing = document.getElementById('menus-nudge-banner');
  if (existing) existing.remove();

  var container = document.getElementById('module-menus');
  if (!container) return;
  var header = container.querySelector('.header');
  if (!header) return;

  var el = document.createElement('div');
  el.id = 'menus-nudge-banner';
  el.className = 'module-nudge';
  el.innerHTML = '<span>' + nudge.text.replace(/ →$/, '') + '</span>'
    + '<a href="#" onclick="event.preventDefault();showModule(\'' + nudge.module + '\');">Unlock →</a>'
    + '<button class="module-nudge-dismiss" onclick="document.getElementById(\'menus-nudge-banner\').remove();_menus_nudge_dismissed[\'' + key + '\']=true;" aria-label="Dismiss">&times;</button>';
  header.insertAdjacentElement('afterend', el);
}
