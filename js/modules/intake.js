// js/modules/intake.js — Client intake links + booking event templates.
//
// app.html has called openIntakeFormModal/generateIntakeLink/
// openSaveTemplateModal/applyEventTemplate (and their helpers) since before
// the Carte→Veriqo unification, but the backing JS was never ported when
// the old single-file Carte app (mise.html, now in _archive/) was
// consolidated into app.html — only the button markup made the move. This
// restores it as a proper module (not inline app.html script) so the
// onclick-handler scanner stays accurate and the code lives alongside the
// rest of the module-per-file structure.
//
// Depends on: supabaseClient (supabase.js), toast/_esc/mSettings/
// saveMiseSettings/getAllJobs (menus.js, loaded before this file).
(function () {
  'use strict';

  var _intakeLink = null;
  var _tplSource = null;

  var EVENT_TEMPLATES = {
    private_dinner: '--- EVENT TIMELINE ---\n16:00 - Chef Arrival & Prep\n19:00 - Guest Arrival / Canapés\n19:45 - Starters Served\n20:30 - Mains Served\n21:30 - Dessert & Petit Fours\n22:30 - Kitchen Clean-down & Departure\n\n--- SETUP & NOTES ---\nDietary Log: \nMenu Selection: \nEquipment Needed: ',
    wedding: '--- WEDDING TIMELINE ---\n09:00 - Venue Access / Kitchen Setup\n13:00 - Ceremony Start\n14:30 - Drinks Reception / Canapés\n16:00 - Guests Seated for Wedding Breakfast\n16:30 - Starters\n17:15 - Mains\n18:15 - Dessert\n19:30 - Evening Guests Arrive / Buffet Setup\n\n--- SUPPLIER CONTACTS ---\nWedding Planner: \nFlorist: \nVenue Manager: ',
    corporate: '--- CORPORATE BRIEF ---\nCompany Name: \nInternal Contact: \nInvoice To (Company vs Individual): \nService Style: (Buffet / Bowl Food / Seated)\n\n--- EVENT TIMELINE ---\nArrival Time: \nService Time: \nClear-down Time: '
  };

  // ── Event templates ────────────────────────────────────────────────────────
  function applyEventTemplate() {
    var templateKey = document.getElementById('newJobTemplate').value;
    var notesField = document.getElementById('job-notes');
    if (!notesField) return;
    if (!templateKey) { notesField.value = ''; return; }
    if (EVENT_TEMPLATES[templateKey]) {
      notesField.value = EVENT_TEMPLATES[templateKey];
      return;
    }
    var custom = (mSettings.savedTemplates || []).find(function (t) { return t.id === templateKey; });
    if (custom) {
      notesField.value = custom.notes || '';
      if (custom.jobType) document.getElementById('job-type').value = custom.jobType;
      if (custom.covers) document.getElementById('job-covers').value = custom.covers;
      if (custom.time) document.getElementById('job-time').value = custom.time;
    }
  }

  function renderTemplateDropdown() {
    var sel = document.getElementById('newJobTemplate');
    if (!sel) return;
    var existing = sel.querySelector('optgroup[data-custom]');
    if (existing) existing.remove();
    var customs = mSettings.savedTemplates || [];
    if (!customs.length) return;
    var grp = document.createElement('optgroup');
    grp.label = 'My Templates';
    grp.dataset.custom = '1';
    customs.forEach(function (t) {
      var opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      grp.appendChild(opt);
    });
    sel.appendChild(grp);
  }

  function openSaveTemplateModal(source) {
    _tplSource = source;
    var defaultName = '';
    if (source === 'form') {
      defaultName = (document.getElementById('job-type') || {}).value || '';
    } else {
      var job = getAllJobs().filter(function (j) { return j.id === source; })[0];
      if (job) defaultName = job.jobType || '';
    }
    var inp = document.getElementById('tpl-name-input');
    if (inp) inp.value = defaultName;
    var modal = document.getElementById('saveTemplateModal');
    if (modal) modal.style.display = 'flex';
    if (inp) { inp.focus(); inp.select(); }
  }

  function closeSaveTemplateModal() {
    var modal = document.getElementById('saveTemplateModal');
    if (modal) modal.style.display = 'none';
    _tplSource = null;
  }

  function confirmSaveTemplate() {
    var name = ((document.getElementById('tpl-name-input') || {}).value || '').trim();
    if (!name) { toast('Please enter a template name', 'err'); return; }
    var tpl = { id: 'tpl_' + Date.now(), name: name, jobType: '', notes: '', covers: '', time: '' };
    if (_tplSource === 'form') {
      tpl.jobType = (document.getElementById('job-type') || {}).value || '';
      tpl.notes = ((document.getElementById('job-notes') || {}).value || '').trim();
      tpl.covers = (document.getElementById('job-covers') || {}).value || '';
      tpl.time = (document.getElementById('job-time') || {}).value || '';
    } else if (_tplSource) {
      var job = getAllJobs().filter(function (j) { return j.id === _tplSource; })[0];
      if (job) {
        tpl.jobType = job.jobType || '';
        tpl.notes = job.notes || '';
        tpl.covers = job.covers || '';
        tpl.time = job.eventTime || '';
      }
    }
    mSettings.savedTemplates = mSettings.savedTemplates || [];
    mSettings.savedTemplates.push(tpl);
    saveMiseSettings();
    renderTemplateDropdown();
    renderTemplatesList();
    closeSaveTemplateModal();
    toast('Template saved ✓');
  }

  function renderTemplatesList() {
    var el = document.getElementById('user-templates-list');
    if (!el) return;
    var tmpls = mSettings.savedTemplates || [];
    if (!tmpls.length) {
      el.innerHTML = '<p class="empty" style="padding:4px 0 8px">No saved templates yet — save a setup from any booking.</p>';
      return;
    }
    el.innerHTML = tmpls.map(function (t) {
      return '<div class="setting-item"><span class="setting-item-name">' + _esc(t.name) + '</span>'
        + '<button class="btn-remove" aria-label="Remove template" onclick="removeUserTemplate(\'' + t.id + '\')">×</button></div>';
    }).join('');
  }

  function removeUserTemplate(id) {
    mSettings.savedTemplates = (mSettings.savedTemplates || []).filter(function (t) { return t.id !== id; });
    saveMiseSettings();
    renderTemplatesList();
    renderTemplateDropdown();
    toast('Template removed');
  }

  // ── Client intake links ──────────────────────────────────────────────────
  function _intakeStyleRadios() {
    document.querySelectorAll('input[name="intake-exp"]').forEach(function (r) {
      var lbl = document.getElementById('intake-exp-' + r.value + '-lbl');
      if (lbl) lbl.style.borderColor = r.checked ? '#2D7A3A' : '#e5e4de';
    });
  }

  function openIntakeFormModal() {
    _intakeLink = null;
    document.getElementById('intake-label').value = '';
    document.getElementById('intake-exp-30').checked = true;
    _intakeStyleRadios();
    document.getElementById('intake-link-row').style.display = 'none';
    var btn = document.getElementById('intake-generate-btn');
    btn.textContent = 'Generate Link';
    btn.disabled = false;
    document.getElementById('intakeFormModal').style.display = 'flex';
  }

  function closeIntakeFormModal() {
    document.getElementById('intakeFormModal').style.display = 'none';
    _intakeLink = null;
  }

  async function generateIntakeLink() {
    var btn = document.getElementById('intake-generate-btn');
    btn.textContent = 'Generating…';
    btn.disabled = true;

    var label = (document.getElementById('intake-label').value || '').trim();
    var expDays = parseInt(document.querySelector('input[name="intake-exp"]:checked').value, 10);
    var expiresAt = null;
    if (expDays > 0) {
      var d = new Date();
      d.setDate(d.getDate() + expDays);
      expiresAt = d.toISOString();
    }

    try {
      var userRes = await supabaseClient.auth.getUser();
      var userId = userRes.data && userRes.data.user && userRes.data.user.id;
      if (!userId) throw new Error('Not signed in');

      var payload = { owner_user_id: userId };
      if (label) payload.label = label;
      if (expiresAt) payload.expires_at = expiresAt;

      var res = await supabaseClient.from('client_intake_tokens').insert(payload).select('token').single();
      if (res.error) throw res.error;

      _intakeLink = 'https://www.getveriqo.co.uk/client-intake?t=' + res.data.token;
      document.getElementById('intake-link-display').textContent = _intakeLink;
      document.getElementById('intake-link-row').style.display = 'block';
      btn.textContent = 'Generate New Link';
      btn.disabled = false;
    } catch (e) {
      console.error('[Veriqo] generateIntakeLink:', e);
      toast('Could not generate link — try again', 'err');
      btn.textContent = 'Generate Link';
      btn.disabled = false;
    }
  }

  function copyIntakeLink() {
    if (!_intakeLink) return;
    navigator.clipboard.writeText(_intakeLink).catch(function () {
      var ta = document.createElement('textarea');
      ta.value = _intakeLink;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    });
    toast('Link copied ✓');
  }

  function mailtoIntakeLink() {
    if (!_intakeLink) return;
    var label = (document.getElementById('intake-label').value || '').trim();
    var subject = label ? label + ' — your details' : 'A quick form before we get started';
    var chefName = (mSettings && mSettings.chefName) || 'Your chef';
    var businessName = (mSettings && mSettings.businessName) || chefName;
    var body = 'Hi,\n\nBefore your event I\'d love to get a few details from you — dietary requirements, preferences, and contact information.\n\nIt takes about two minutes:\n\n' + _intakeLink + '\n\nLooking forward to cooking for you.\n\n' + chefName + '\n' + businessName;
    window.location.href = 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  }

  // ── expose on window (referenced directly by app.html onclick/onchange) ───
  window.applyEventTemplate = applyEventTemplate;
  window.renderTemplateDropdown = renderTemplateDropdown;
  window.openSaveTemplateModal = openSaveTemplateModal;
  window.closeSaveTemplateModal = closeSaveTemplateModal;
  window.confirmSaveTemplate = confirmSaveTemplate;
  window.renderTemplatesList = renderTemplatesList;
  window.removeUserTemplate = removeUserTemplate;
  window._intakeStyleRadios = _intakeStyleRadios;
  window.openIntakeFormModal = openIntakeFormModal;
  window.closeIntakeFormModal = closeIntakeFormModal;
  window.generateIntakeLink = generateIntakeLink;
  window.copyIntakeLink = copyIntakeLink;
  window.mailtoIntakeLink = mailtoIntakeLink;
})();
