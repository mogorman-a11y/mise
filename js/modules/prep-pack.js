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

// mSettings.prepPackTemplates lets a chef customize the always-list and any
// profile's items (Settings > "Manage default items"); Generate reads through
// these resolvers rather than the raw constants, so a customization applies
// to every future job, not just the one being edited. Falls back to the
// built-in defaults for anything not yet customized (whole thing, or just
// one profile) — a chef who's never opened the editor sees identical
// behaviour to before this existed.
function _ppEffectiveAlways() {
  var custom = window.mSettings && mSettings.prepPackTemplates && mSettings.prepPackTemplates.always;
  return custom || PREP_PACK_ALWAYS;
}
function _ppEffectiveProfile(key) {
  var custom = window.mSettings && mSettings.prepPackTemplates && mSettings.prepPackTemplates[key];
  return custom || PREP_PACK_PROFILES[key];
}

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

  var always = _ppEffectiveAlways();
  Object.keys(always).forEach(function (sectionId) {
    always[sectionId].forEach(function (desc) { byId[sectionId].push(_ppMakeItem(desc)); });
  });

  _inferPrepPackProfiles(job).forEach(function (profileKey) {
    var profile = _ppEffectiveProfile(profileKey);
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

function removePrepPackItem(jobId, sectionId, itemId) {
  var updated = _ppFindAndSaveJob(jobId, function (rec) {
    if (!rec.prepAndPack || !rec.prepAndPack.sections) return;
    var section = rec.prepAndPack.sections.filter(function (s) { return s.id === sectionId; })[0];
    if (!section) return;
    section.items = (section.items || []).filter(function (it) { return it.id !== itemId; });
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
    return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0">'
      + '<span onclick="event.stopPropagation();togglePrepPackItem(\'' + jobId + '\',\'' + section.id + '\',\'' + it.id + '\')" style="display:flex;align-items:center;gap:8px;flex:1;cursor:pointer;min-width:0">'
      + '<span style="width:16px;height:16px;border-radius:4px;border:1.5px solid ' + (it.checked ? '#3A7D44' : '#D0C8BE') + ';background:' + (it.checked ? '#3A7D44' : '#fff') + ';flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;font-size:11px;color:#fff">' + (it.checked ? '✓' : '') + '</span>'
      + '<span style="font-size:13px;' + checkedStyle + '">' + _esc(it.description) + '</span>'
      + '</span>'
      + '<button onclick="event.stopPropagation();removePrepPackItem(\'' + jobId + '\',\'' + section.id + '\',\'' + it.id + '\')" aria-label="Remove item" style="background:none;border:none;color:#C0BDB5;font-size:16px;cursor:pointer;padding:0;line-height:1;flex-shrink:0;min-width:24px;min-height:24px">&times;</button>'
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

  var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'
    + '<div style="font-size:11px;font-weight:600;text-transform:uppercase;color:#A09890;letter-spacing:0.05em">🎒 Prep &amp; Pack</div>'
    + '<button onclick="event.stopPropagation();openPrepPackTemplateEditor()" style="background:none;border:none;color:#3A7D44;font-size:11px;cursor:pointer;font-family:inherit;padding:0;text-decoration:underline">Manage default items</button>'
    + '</div>';

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

// ── "Manage default items" — editable per-profile templates ──────────────
// Generate always reads through _ppEffectiveAlways()/_ppEffectiveProfile()
// above, so anything saved here applies to every future job, not just the
// one open when this was edited. Values here are plain description-string
// arrays (unlike a job's prepAndPack, which has id/checked per item) — a
// template has no checked-state of its own.

var PP_TEMPLATE_GROUPS = [
  { key: 'always',         label: 'Always included',          sections: [{ id: 'food_safety', label: 'Food Safety Kit' }, { id: 'admin_travel', label: 'Admin / Travel' }] },
  { key: 'private_dinner', label: 'Private Dinner (default)',  sections: [{ id: 'equipment', label: 'Equipment' }, { id: 'service', label: 'Service Kit' }] },
  { key: 'bbq',             label: 'BBQ',                      sections: [{ id: 'equipment', label: 'Equipment' }] },
  { key: 'buffet',          label: 'Buffet',                   sections: [{ id: 'service', label: 'Service Kit' }] },
  { key: 'canapes',         label: 'Canapés',                  sections: [{ id: 'service', label: 'Service Kit' }] }
];

var _ppTemplateDraft = null;

function _ppDefaultForGroup(key) {
  return key === 'always' ? PREP_PACK_ALWAYS : PREP_PACK_PROFILES[key];
}

function openPrepPackTemplateEditor() {
  var draft = {};
  PP_TEMPLATE_GROUPS.forEach(function (g) {
    var current = g.key === 'always' ? _ppEffectiveAlways() : _ppEffectiveProfile(g.key);
    draft[g.key] = JSON.parse(JSON.stringify(current || _ppDefaultForGroup(g.key)));
  });
  _ppTemplateDraft = draft;
  _renderPrepPackTemplateModal();
}

function closePrepPackTemplateEditor() {
  var el = document.getElementById('pp-template-modal');
  if (el) el.remove();
  _ppTemplateDraft = null;
}

function savePrepPackTemplates() {
  if (!_ppTemplateDraft) return;
  mSettings.prepPackTemplates = _ppTemplateDraft;
  saveMiseSettings();
  toast('Default Prep & Pack items saved ✓');
  closePrepPackTemplateEditor();
}

function resetDraftTemplateGroup(groupKey) {
  if (!_ppTemplateDraft) return;
  _ppTemplateDraft[groupKey] = JSON.parse(JSON.stringify(_ppDefaultForGroup(groupKey)));
  _renderPrepPackTemplateModal();
}

function removeDraftTemplateItem(groupKey, sectionId, index) {
  if (!_ppTemplateDraft || !_ppTemplateDraft[groupKey] || !_ppTemplateDraft[groupKey][sectionId]) return;
  _ppTemplateDraft[groupKey][sectionId].splice(index, 1);
  _renderPrepPackTemplateModal();
}

function addDraftTemplateItem(groupKey, sectionId) {
  var input = document.getElementById('pp-tpl-add-' + groupKey + '-' + sectionId);
  if (!input) return;
  var desc = (input.value || '').trim();
  if (!desc) { toast('Enter an item first', 'err'); return; }
  if (!_ppTemplateDraft[groupKey]) _ppTemplateDraft[groupKey] = {};
  if (!_ppTemplateDraft[groupKey][sectionId]) _ppTemplateDraft[groupKey][sectionId] = [];
  _ppTemplateDraft[groupKey][sectionId].push(desc);
  _renderPrepPackTemplateModal();
}

function _ppTemplateSectionListHTML(groupKey, sectionId, label) {
  var items = (_ppTemplateDraft[groupKey] && _ppTemplateDraft[groupKey][sectionId]) || [];
  var rows = items.map(function (desc, idx) {
    return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0">'
      + '<span style="font-size:13px;color:#1C2B1E;flex:1">' + _esc(desc) + '</span>'
      + '<button onclick="removeDraftTemplateItem(\'' + groupKey + '\',\'' + sectionId + '\',' + idx + ')" aria-label="Remove item" style="background:none;border:none;color:#C0BDB5;font-size:16px;cursor:pointer;padding:0;line-height:1;min-width:24px;min-height:24px">&times;</button>'
      + '</div>';
  }).join('');
  return '<div style="margin-bottom:8px">'
    + '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#A09890;margin-bottom:2px">' + _esc(label) + '</div>'
    + (rows || '<div style="font-size:12px;color:#C8BFB0;padding:3px 0">No items</div>')
    + '<div style="display:flex;gap:6px;margin-top:4px">'
    + '<input id="pp-tpl-add-' + groupKey + '-' + sectionId + '" type="text" placeholder="Add item…" onkeydown="if(event.key===\'Enter\'){event.preventDefault();addDraftTemplateItem(\'' + groupKey + '\',\'' + sectionId + '\');}" style="flex:1;padding:5px 8px;border:1px solid #D0C8BE;border-radius:6px;font-size:12px;font-family:inherit">'
    + '<button onclick="addDraftTemplateItem(\'' + groupKey + '\',\'' + sectionId + '\')" style="padding:5px 10px;background:#F5F0E8;color:#1C2B1E;border:1px solid #D0C8BE;border-radius:6px;font-size:12px;cursor:pointer;font-family:inherit">+</button>'
    + '</div>'
    + '</div>';
}

function _ppTemplateGroupHTML(group) {
  return '<div style="border:1px solid #E8E2D8;border-radius:8px;padding:10px 12px;margin-bottom:10px">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'
    + '<div style="font-size:13px;font-weight:700;color:#1C2B1E">' + _esc(group.label) + '</div>'
    + '<button onclick="resetDraftTemplateGroup(\'' + group.key + '\')" style="background:none;border:none;color:#A09890;font-size:11px;cursor:pointer;text-decoration:underline;font-family:inherit">Reset to default</button>'
    + '</div>'
    + group.sections.map(function (s) { return _ppTemplateSectionListHTML(group.key, s.id, s.label); }).join('')
    + '</div>';
}

function _renderPrepPackTemplateModal() {
  if (!_ppTemplateDraft) return;
  var body = PP_TEMPLATE_GROUPS.map(_ppTemplateGroupHTML).join('');
  var existing = document.getElementById('pp-template-modal');
  if (existing) {
    var bodyEl = existing.querySelector('.pp-modal-body');
    if (bodyEl) bodyEl.innerHTML = body;
    return;
  }
  var overlay = document.createElement('div');
  overlay.id = 'pp-template-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(28,43,30,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.onclick = function (e) { if (e.target === overlay) closePrepPackTemplateEditor(); };
  overlay.innerHTML = '<div style="background:#fff;border-radius:12px;max-width:480px;width:100%;max-height:85vh;overflow-y:auto;padding:20px" onclick="event.stopPropagation()">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'
    + '<div style="font-size:16px;font-weight:700;color:#1C2B1E">Default Prep &amp; Pack items</div>'
    + '<button onclick="closePrepPackTemplateEditor()" aria-label="Close" style="background:none;border:none;font-size:22px;color:#A09890;cursor:pointer;line-height:1;min-width:32px;min-height:32px">&times;</button>'
    + '</div>'
    + '<div style="font-size:12px;color:#A09890;margin-bottom:14px">Changes apply to every job you generate a Prep &amp; Pack list for from now on — not to lists already generated.</div>'
    + '<div class="pp-modal-body">' + body + '</div>'
    + '<button onclick="savePrepPackTemplates()" style="width:100%;margin-top:4px;padding:11px;background:#3A7D44;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Save defaults</button>'
    + '</div>';
  document.body.appendChild(overlay);
}
