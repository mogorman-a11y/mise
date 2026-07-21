// js/modules/prep-pack.js — "Prep & Pack": job readiness checklist.
//
// New feature on top of (not a replacement for) Prep Lists. Prep Lists is
// food/menu execution tasks generated from dishes; Prep & Pack is "what must
// I remember to bring/do for this specific event" — equipment, food safety
// kit, service kit, admin/travel. Template-only for v1, no AI.
//
// Stored on the job itself (job.prepAndPack, round-tripped through
// jobs.metadata.prepAndPack in sync.js — see _coreSaveJob/_pullSharedJobs),
// not in the prep_lists table, per the explicit design call: this is job
// readiness, not a food-prep record, and doesn't share prep_lists' shape
// (dish-linked items, course sorting) at all.
//
// Relies on: supabaseClient's caller (Mise.sync.saveJob), mRecords/
// getDayRecords/saveMiseToday/saveDayRecords/getAllJobs/toast/_esc (menus.js,
// loaded before this file), _prepLists (prep.js, true global — used only to
// cross-reference an existing food Prep List for the same date).

var PREP_PACK_SECTIONS = [
  { id: 'equipment',    label: 'Equipment' },
  { id: 'food_safety',  label: 'Food Safety Kit' },
  { id: 'service',      label: 'Service Kit' },
  { id: 'admin_travel', label: 'Admin / Travel' }
];

// Every job gets these regardless of type/style.
var PREP_PACK_ALWAYS = {
  food_safety:  ['Probe thermometer', 'Sanitiser', 'Gloves', 'Blue roll', 'Food labels'],
  admin_travel: ['Phone charger', 'Client address & contact notes']
};

// Layered on top of the always-list based on inferred service style —
// a job can match more than one (e.g. a wedding that's buffet AND canapes).
// private_dinner is the fallback when nothing else matches, since plated
// service is this app's default private-chef use case.
var PREP_PACK_PROFILES = {
  private_dinner: {
    equipment: ['Knives', 'Chopping boards', 'Pans'],
    service:   ['Hot box', 'Service spoons']
  },
  bbq: {
    equipment: ['Gas/charcoal', 'Lighter/firelighters', 'Grill tools', 'Gazebo', 'Extension lead']
  },
  buffet: {
    service: ['Chafing dishes', 'Chafing fuel', 'Serving spoons', 'Risers']
  },
  canapes: {
    service: ['Serving trays', 'Napkins', 'Garnish kit', 'Tweezers']
  }
};

function _inferPrepPackProfiles(job) {
  var text = [
    job.jobType || '',
    job.notes || '',
    (job.menus || []).map(function (m) { return m.name || ''; }).join(' ')
  ].join(' ').toLowerCase();

  var profiles = [];
  if (/\bbbq\b|barbecue|barbeque|\bgrill/.test(text)) profiles.push('bbq');
  if (/buffet/.test(text)) profiles.push('buffet');
  if (job.jobType === 'Canapes' || /canap/.test(text)) profiles.push('canapes');
  if (!profiles.length) profiles.push('private_dinner');
  return profiles;
}

function _ppItemId() { return 'ppi_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

function _ppMakeItem(description) {
  return { id: _ppItemId(), description: description, checked: false };
}

function generatePrepPackSections(job) {
  var byId = {};
  PREP_PACK_SECTIONS.forEach(function (s) { byId[s.id] = []; });

  Object.keys(PREP_PACK_ALWAYS).forEach(function (sectionId) {
    PREP_PACK_ALWAYS[sectionId].forEach(function (desc) { byId[sectionId].push(_ppMakeItem(desc)); });
  });

  _inferPrepPackProfiles(job).forEach(function (profileKey) {
    var profile = PREP_PACK_PROFILES[profileKey];
    if (!profile) return;
    Object.keys(profile).forEach(function (sectionId) {
      profile[sectionId].forEach(function (desc) {
        // Skip an exact duplicate description within the same section —
        // e.g. two matched profiles both wanting "Serving spoons".
        var already = byId[sectionId].some(function (it) { return it.description === desc; });
        if (!already) byId[sectionId].push(_ppMakeItem(desc));
      });
    });
  });

  return {
    generatedAt: new Date().toISOString(),
    sections: PREP_PACK_SECTIONS.map(function (s) { return { id: s.id, label: s.label, items: byId[s.id] }; })
  };
}

function prepPackStatus(prepAndPack) {
  if (!prepAndPack || !prepAndPack.sections) return { status: 'not_generated', checkedCount: 0, totalCount: 0 };
  var checked = 0, total = 0;
  prepAndPack.sections.forEach(function (s) {
    (s.items || []).forEach(function (it) { total++; if (it.checked) checked++; });
  });
  if (total === 0) return { status: 'not_generated', checkedCount: 0, totalCount: 0 };
  if (checked === total) return { status: 'ready', checkedCount: checked, totalCount: total };
  return { status: 'in_progress', checkedCount: checked, totalCount: total };
}

// ── Local find-and-persist, mirroring saveJobEdit()/toggleJobPayment()'s
// dual-path lookup (mRecords first, then scan every mise_<date> localStorage
// key) — kept private to this file since three functions below need it.
function _ppFindAndSaveJob(jobId, mutateFn) {
  var updatedRec = null;
  for (var i = 0; i < mRecords.length; i++) {
    if (mRecords[i].id === jobId) {
      mutateFn(mRecords[i]);
      saveMiseToday();
      updatedRec = mRecords[i];
      break;
    }
  }
  if (!updatedRec) {
    try {
      for (var li = 0; li < localStorage.length; li++) {
        var lk = localStorage.key(li);
        if (!lk || lk.indexOf('mise_') !== 0 || lk === 'mise_settings') continue;
        var lds = lk.replace('mise_', '');
        var lrecs = getDayRecords(lds);
        for (var ri = 0; ri < lrecs.length; ri++) {
          if (lrecs[ri].id === jobId) {
            mutateFn(lrecs[ri]);
            saveDayRecords(lds, lrecs);
            updatedRec = lrecs[ri];
            break;
          }
        }
        if (updatedRec) break;
      }
    } catch (e) {}
  }
  if (!updatedRec) return null;
  if (window.Mise && window.Mise.sync && window.Mise.sync.saveJob) Mise.sync.saveJob(updatedRec);
  return updatedRec;
}

function generatePrepPack(jobId) {
  var job = getAllJobs().filter(function (j) { return j.id === jobId; })[0];
  if (!job) { toast('Job not found', 'err'); return; }
  var sections = generatePrepPackSections(job);
  var updated = _ppFindAndSaveJob(jobId, function (rec) { rec.prepAndPack = sections; });
  if (!updated) { toast('Job not found', 'err'); return; }
  _renderPrepPackPanel(jobId);
  toast('Prep & Pack list generated ✓');
}

function togglePrepPackItem(jobId, sectionId, itemId) {
  var updated = _ppFindAndSaveJob(jobId, function (rec) {
    if (!rec.prepAndPack || !rec.prepAndPack.sections) return;
    var section = rec.prepAndPack.sections.filter(function (s) { return s.id === sectionId; })[0];
    if (!section) return;
    var item = (section.items || []).filter(function (it) { return it.id === itemId; })[0];
    if (item) item.checked = !item.checked;
  });
  if (updated) _renderPrepPackPanel(jobId);
}

function addPrepPackItem(jobId, sectionId) {
  var input = document.getElementById('pp-add-' + jobId + '-' + sectionId);
  if (!input) return;
  var desc = (input.value || '').trim();
  if (!desc) { toast('Enter an item first', 'err'); return; }
  var updated = _ppFindAndSaveJob(jobId, function (rec) {
    if (!rec.prepAndPack || !rec.prepAndPack.sections) return;
    var section = rec.prepAndPack.sections.filter(function (s) { return s.id === sectionId; })[0];
    if (!section) return;
    section.items = section.items || [];
    section.items.push(_ppMakeItem(desc));
  });
  if (!updated) return;
  input.value = '';
  _renderPrepPackPanel(jobId);
}

// ── Rendering ────────────────────────────────────────────────────────────

function _ppSectionHTML(jobId, section) {
  var rows = (section.items || []).map(function (it) {
    var checkedStyle = it.checked ? 'text-decoration:line-through;color:#A09890' : 'color:#1C2B1E';
    return '<div onclick="event.stopPropagation();togglePrepPackItem(\'' + jobId + '\',\'' + section.id + '\',\'' + it.id + '\')" style="display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer">'
      + '<span style="width:16px;height:16px;border-radius:4px;border:1.5px solid ' + (it.checked ? '#3A7D44' : '#D0C8BE') + ';background:' + (it.checked ? '#3A7D44' : '#fff') + ';flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;font-size:11px;color:#fff">' + (it.checked ? '✓' : '') + '</span>'
      + '<span style="font-size:13px;' + checkedStyle + '">' + _esc(it.description) + '</span>'
      + '</div>';
  }).join('');

  return '<div style="margin-bottom:10px">'
    + '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#3A7D44;margin-bottom:4px">' + _esc(section.label) + '</div>'
    + (rows || '<div style="font-size:12px;color:#A09890;padding:4px 0">No items yet</div>')
    + '<div style="display:flex;gap:6px;margin-top:6px">'
    + '<input id="pp-add-' + jobId + '-' + section.id + '" type="text" placeholder="Add item…" onclick="event.stopPropagation()" onkeydown="if(event.key===\'Enter\'){event.preventDefault();addPrepPackItem(\'' + jobId + '\',\'' + section.id + '\');}" style="flex:1;padding:5px 8px;border:1px solid #D0C8BE;border-radius:6px;font-size:12px;font-family:inherit">'
    + '<button onclick="event.stopPropagation();addPrepPackItem(\'' + jobId + '\',\'' + section.id + '\')" style="padding:5px 10px;background:#F5F0E8;color:#1C2B1E;border:1px solid #D0C8BE;border-radius:6px;font-size:12px;cursor:pointer;font-family:inherit">+</button>'
    + '</div>'
    + '</div>';
}

// Best-effort cross-reference to an existing food Prep List for the same
// date — prep_lists has no job_id column, so date is the closest reliable
// match available without a schema change. Purely informational, no data
// written either direction.
function _ppFoodPrepLinkHTML(job) {
  if (typeof _prepLists === 'undefined' || !Array.isArray(_prepLists)) return '';
  var match = _prepLists.filter(function (pl) { return pl.date === job.eventDate; })[0];
  if (!match) {
    return '<div style="font-size:12px;color:#A09890;margin-top:10px;padding-top:10px;border-top:1px solid #F0EBE2">No food Prep List yet for this date — <a onclick="showModule(\'menus\');showTab(\'prep\')" style="color:#3A7D44;text-decoration:underline;cursor:pointer">create one</a>.</div>';
  }
  var items = match.items || [];
  var done = items.filter(function (it) { return it.completed; }).length;
  return '<div style="font-size:12px;color:#1C2B1E;margin-top:10px;padding-top:10px;border-top:1px solid #F0EBE2">🍽 Food Prep List: <a onclick="showModule(\'menus\');showTab(\'prep\');openPrepListView(\'' + match.id + '\')" style="color:#3A7D44;text-decoration:underline;cursor:pointer">' + _esc(match.name) + '</a> — ' + done + '/' + items.length + ' done</div>';
}

function _renderPrepPackPanel(jobId) {
  var el = document.getElementById('prep-pack-' + jobId);
  if (!el) return;
  var job = getAllJobs().filter(function (j) { return j.id === jobId; })[0];
  if (!job) { el.innerHTML = ''; return; }

  var pp = job.prepAndPack;
  var state = prepPackStatus(pp);

  var html = '<div style="font-size:11px;font-weight:600;text-transform:uppercase;color:#A09890;letter-spacing:0.05em;margin-bottom:6px">🎒 Prep &amp; Pack</div>';

  if (state.status === 'not_generated') {
    html += '<button onclick="event.stopPropagation();generatePrepPack(\'' + jobId + '\')" style="width:100%;padding:9px;background:#F97316;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">Generate Prep &amp; Pack list</button>';
  } else {
    html += pp.sections.map(function (s) { return _ppSectionHTML(jobId, s); }).join('');
    html += _ppFoodPrepLinkHTML(job);
  }

  el.innerHTML = html;
}

// ── Dashboard integration ───────────────────────────────────────────────

// Called from menus.js's calViewJob/toggleJobCard-adjacent navigation and
// from the Dashboard banner's "Open" button — jumps to Menus > Jobs, expands
// the job card (which renders the panel above), scrolls it into view.
function openPrepAndPackForJob(jobId) {
  if (typeof showModule === 'function') showModule('menus');
  if (typeof calViewJob === 'function') calViewJob(jobId);
}

// Returns the single next upcoming job (today or later), or null. Mirrors
// haccp.js's updateNextJobBanner() job-selection logic but via the shared
// getAllJobs() rather than re-scanning localStorage directly, since this
// runs well after menus.js has loaded (dashboard.js's render() only runs on
// module init/navigation, never at page-load time).
function _nextUpcomingJob() {
  if (typeof getAllJobs !== 'function' || typeof TODAY === 'undefined') return null;
  var jobs = getAllJobs().filter(function (j) { return j.eventDate && j.eventDate >= TODAY; });
  jobs.sort(function (a, b) { return a.eventDate.localeCompare(b.eventDate); });
  return jobs[0] || null;
}

function renderPrepPackDashboardBanner() {
  var job = _nextUpcomingJob();
  if (!job) return '';

  var state = prepPackStatus(job.prepAndPack);
  var statusLabel = state.status === 'ready' ? 'Ready ✓' : state.status === 'in_progress' ? 'In progress' : 'Not started';
  var statusColor = state.status === 'ready' ? '#1C6B2A' : state.status === 'in_progress' ? '#8A6820' : '#A09890';
  var statusBg    = state.status === 'ready' ? '#EAF4EC' : state.status === 'in_progress' ? '#FBF3E0' : '#F5F0E8';
  var progressText = state.totalCount > 0 ? state.checkedCount + '/' + state.totalCount + ' packed' : 'Not generated yet';
  var when = job.eventDate === TODAY ? 'Today' : new Date(job.eventDate + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  var btnLabel = state.status === 'not_generated' ? 'Create' : 'Open';

  return '<div class="db-card" style="cursor:pointer" onclick="openPrepAndPackForJob(\'' + job.id + '\')">'
    + '<div class="db-card-header"><span class="db-card-icon">🎒</span><span class="db-card-label">Prep &amp; Pack for ' + (job.client ? _esc(job.client) : 'next job') + '</span><span class="db-card-arrow">›</span></div>'
    + '<div style="font-size:12px;color:#A09890;margin-top:2px">' + _esc(when) + (job.jobType ? ' · ' + _esc(job.jobType) : '') + '</div>'
    + '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px">'
    + '<span style="font-size:11px;font-weight:700;padding:3px 9px;border-radius:5px;background:' + statusBg + ';color:' + statusColor + '">' + statusLabel + '</span>'
    + '<span style="font-size:12px;color:#1C2B1E">' + progressText + '</span>'
    + '</div>'
    + '<button onclick="event.stopPropagation();openPrepAndPackForJob(\'' + job.id + '\')" style="width:100%;margin-top:10px;padding:9px;background:#F97316;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">' + btnLabel + ' →</button>'
    + '</div>';
}
