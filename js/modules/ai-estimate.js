// js/modules/ai-estimate.js — AI Cost Estimate screen (#screen-ai-estimate)
//
// Wires the 16 functions app.html's AI Estimate screen already calls via
// onclick/onchange but that were never implemented (startAIEstimate,
// _aiSetMode, _aiAddCourse, _aiHandleMenuUpload, _aiSetTargetGP,
// _aiUpdateCustomGP, _refreshAIGPTargets, setAIQuotePrice,
// quickReconcileAIJob, loadAIJobs, handleAIScanReceipt) against the
// already-working backend (api/veriqo-estimate.js, api/veriqo-job.js).
//
// This is a second, AI-specific estimation flow alongside the existing
// module-based Costing system (js/modules/costing.js, yield_-prefixed
// localStorage). The costing_* RPC-backed job system here is the AI-specific
// working/staging representation during estimation and reconciliation, but
// once a quote price is set, the result is also saved as a normal row in
// the same `costings` table manual costing uses (via Mise.yieldSync.saveCosting)
// so it shows up in the Costing module's own list — not a second silo the
// rest of the app can't see. Creating an actual Quote from an AI estimate
// deliberately reuses the Costing module's own saveQuote() flow once a
// costing exists, rather than duplicating quote-creation UI here (this
// screen has no client/event-date fields to build a real quote from).
//
// Depends on: supabaseClient (supabase.js), toast (menus.js/haccp.js),
// js/core/gp-math.js, window.Mise.yieldSync (yield-sync.js).
(function () {
  'use strict';

  var _state = {
    mode: 'describe',        // 'describe' | 'multi-course' | 'menu-image'
    courses: [],              // [{name, dishesText}] for multi-course mode
    uploadedImage: null,      // {base64, mimeType} for menu-image mode
    currentJob: null,         // last successful estimate/reconcile response
    submitting: false,
    reconciling: false,
    scanning: false
  };

  var MAX_IMAGE_BYTES = 8 * 1024 * 1024; // matches the upload-zone copy ("up to 8 MB")
  var REQUEST_TIMEOUT_MS = 90000; // GPT-4o vision calls can be slow

  // ── helpers ────────────────────────────────────────────────────────────────
  async function _getToken() {
    var res = await supabaseClient.auth.getSession();
    return res.data && res.data.session ? res.data.session.access_token : null;
  }

  function _isVatRegistered() {
    try {
      var s = JSON.parse(localStorage.getItem('yield_settings') || '{}');
      return !!s.vatEnabled;
    } catch (e) { return false; }
  }

  function _fmtGBP(pence) {
    return '£' + (Math.round(pence || 0) / 100).toFixed(2);
  }

  function _poundsToPence(val) {
    var n = parseFloat(val);
    return isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
  }

  async function _apiFetch(path, opts) {
    var token = await _getToken();
    if (!token) return { ok: false, status: 401, error: 'You need to be signed in.' };
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS) : null;
    try {
      var res = await fetch(path, Object.assign({}, opts, {
        headers: Object.assign({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, (opts && opts.headers) || {}),
        signal: controller ? controller.signal : undefined
      }));
      var data;
      try { data = await res.json(); } catch (e) { return { ok: false, status: res.status, error: 'The server returned an unexpected response — please try again.' }; }
      if (!res.ok) return { ok: false, status: res.status, error: data.error || ('Request failed (' + res.status + ')') };
      return { ok: true, status: res.status, data: data };
    } catch (err) {
      if (err && err.name === 'AbortError') return { ok: false, status: 0, error: 'That took too long — check your connection and try again.' };
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, status: 0, error: 'You appear to be offline — reconnect and try again.' };
      return { ok: false, status: 0, error: 'Network error — check your connection and try again.' };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function _validateImageFile(file, maxBytes) {
    if (!file) return 'No file selected';
    if (!/^image\//.test(file.type)) return 'Please choose an image file (JPG, PNG, or WEBP)';
    if (file.size > maxBytes) return 'File too large — please use an image under ' + Math.round(maxBytes / (1024 * 1024)) + 'MB';
    return null;
  }

  function _readFileAsBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var dataUrl = reader.result;
        var base64 = dataUrl.indexOf(',') !== -1 ? dataUrl.split(',')[1] : dataUrl;
        resolve({ base64: base64, dataUrl: dataUrl });
      };
      reader.onerror = function () { reject(new Error('Could not read file')); };
      reader.readAsDataURL(file);
    });
  }

  // ── _aiSetMode ─────────────────────────────────────────────────────────────
  function _aiSetMode(mode) {
    _state.mode = mode;
    var tabs = { 'describe': 'ai-tab-btn-describe', 'multi-course': 'ai-tab-btn-multicourse', 'menu-image': 'ai-tab-btn-upload' };
    var panels = { 'describe': 'ai-tab-describe', 'multi-course': 'ai-tab-multicourse', 'menu-image': 'ai-tab-upload' };
    Object.keys(tabs).forEach(function (m) {
      var btn = document.getElementById(tabs[m]);
      var panel = document.getElementById(panels[m]);
      if (btn) {
        var active = m === mode;
        btn.style.background = active ? '#2D7A3A' : '#f5f4f0';
        btn.style.color = active ? '#fff' : 'var(--text)';
        btn.style.borderColor = active ? '#2D7A3A' : 'var(--border)';
        btn.style.fontWeight = active ? '700' : '500';
      }
      if (panel) panel.style.display = m === mode ? '' : 'none';
    });
    if (mode === 'multi-course' && !_state.courses.length) { _aiAddCourse(); _aiAddCourse(); }
  }

  // ── _aiAddCourse / _aiRemoveCourse ───────────────────────────────────────────
  function _aiAddCourse() {
    _state.courses.push({ name: '', dishesText: '' });
    _renderCourseBuilder();
  }

  function _aiRemoveCourse(idx) {
    _state.courses.splice(idx, 1);
    _renderCourseBuilder();
  }

  function _renderCourseBuilder() {
    var el = document.getElementById('ai-course-builder');
    if (!el) return;
    el.innerHTML = _state.courses.map(function (c, i) {
      return '<div style="display:flex;gap:6px;margin-bottom:8px;align-items:flex-start">'
        + '<div style="flex:1;display:flex;flex-direction:column;gap:6px">'
        + '<input class="form-input" placeholder="Course name (e.g. Starter)" value="' + _esc(c.name) + '" oninput="_aiUpdateCourseField(' + i + ',\'name\',this.value)">'
        + '<input class="form-input" placeholder="Dishes, comma separated" value="' + _esc(c.dishesText) + '" oninput="_aiUpdateCourseField(' + i + ',\'dishesText\',this.value)">'
        + '</div>'
        + '<button type="button" aria-label="Remove course" onclick="_aiRemoveCourse(' + i + ')" style="background:none;border:1px solid var(--border);border-radius:8px;width:40px;height:40px;flex-shrink:0;color:var(--red,#b3261e);cursor:pointer;font-size:16px">×</button>'
        + '</div>';
    }).join('');
  }

  function _aiUpdateCourseField(idx, field, value) {
    if (!_state.courses[idx]) return;
    _state.courses[idx][field] = value;
  }

  function _esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── _aiHandleMenuUpload ───────────────────────────────────────────────────
  async function _aiHandleMenuUpload(event) {
    var file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    var err = _validateImageFile(file, MAX_IMAGE_BYTES);
    if (err) { toast(err, 'err'); return; }
    try {
      var read = await _readFileAsBase64(file);
      _state.uploadedImage = { base64: read.base64, mimeType: file.type };
      var preview = document.getElementById('ai-upload-preview');
      var zone = document.getElementById('ai-upload-zone');
      if (preview) {
        preview.innerHTML = '<img src="' + read.dataUrl + '" alt="Uploaded menu" style="width:100%;border-radius:10px;max-height:220px;object-fit:cover">';
        preview.style.display = '';
      }
      if (zone) zone.style.display = 'none';
    } catch (e) {
      toast('Could not read that image — try a different file', 'err');
    }
  }

  // ── startAIEstimate ────────────────────────────────────────────────────────
  async function startAIEstimate() {
    if (_state.submitting) return; // prevent double submission
    var btn = document.getElementById('ai-estimate-btn');
    var covers = parseInt(document.getElementById('ai-covers').value, 10);
    var style = document.getElementById('ai-style').value;

    if (!covers || covers < 1) { toast('Enter the number of covers', 'err'); return; }

    var payload;
    if (_state.mode === 'describe') {
      var dish = (document.getElementById('ai-dish').value || '').trim();
      if (!dish) { toast('Describe the dish or menu first', 'err'); return; }
      payload = { dish: dish, serves: covers, serviceStyle: style, vatRegistered: _isVatRegistered() };
    } else if (_state.mode === 'multi-course') {
      var courses = _state.courses
        .map(function (c) { return { name: (c.name || '').trim() || 'Course', dishes: (c.dishesText || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean) }; })
        .filter(function (c) { return c.dishes.length; });
      if (!courses.length) { toast('Add at least one course with dishes', 'err'); return; }
      payload = { action: 'multi-course', courses: courses, serves: covers, serviceStyle: style, vatRegistered: _isVatRegistered() };
    } else {
      if (!_state.uploadedImage) { toast('Upload a menu photo first', 'err'); return; }
      payload = { action: 'menu-image', image: _state.uploadedImage.base64, mimeType: _state.uploadedImage.mimeType, serves: covers, serviceStyle: style, vatRegistered: _isVatRegistered() };
    }

    _state.submitting = true;
    var origHTML = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Estimating…'; }

    var result = await _apiFetch('/api/veriqo-estimate', { method: 'POST', body: JSON.stringify(payload) });

    if (btn) { btn.disabled = false; btn.innerHTML = origHTML; }
    _state.submitting = false;

    if (!result.ok) {
      toast(result.error || 'Estimate failed — please try again', 'err');
      return;
    }
    if (!_setCurrentJob(result.data)) return;
    _renderResult(_state.currentJob);
  }

  // Validates + sanitizes an API job response before trusting it as the
  // active job. Returns true and updates _state.currentJob on success; shows
  // an error toast and leaves the previous state untouched on failure.
  function _setCurrentJob(job) {
    if (!window.Veriqo.isValidJobShape(job)) {
      console.error('[ai-estimate] malformed response:', job);
      toast('The AI response looked incomplete — please try again', 'err');
      return false;
    }
    job.post_job_actuals = window.Veriqo.sanitizePostJobActuals(job.post_job_actuals);
    _state.currentJob = job;
    return true;
  }

  // ── result rendering ──────────────────────────────────────────────────────
  function _totalEstimatedPence(job) {
    return (job.post_job_actuals || []).reduce(function (s, x) { return s + (x.estimated_portion_cost_pence || 0); }, 0);
  }

  function _renderResult(job) {
    var section = document.getElementById('ai-result-section');
    if (section) section.style.display = '';

    var titleEl = document.getElementById('ai-result-title');
    if (titleEl) titleEl.textContent = job.dish_name || 'Estimate';
    var metaEl = document.getElementById('ai-result-meta');
    if (metaEl) metaEl.textContent = job.serves + ' covers · ' + (job.service_style || '');
    var badgeEl = document.getElementById('ai-result-badge');
    if (badgeEl) {
      var statusLabel = { estimated: 'estimated — review', partial: 'partially reconciled', reconciled: 'reconciled', reconciled_total_only: 'reconciled' }[job.reconciliation_status] || 'estimated — review';
      badgeEl.textContent = statusLabel;
    }

    var totalPence = _totalEstimatedPence(job);
    var totalEl = document.getElementById('ai-total-estimated');
    if (totalEl) totalEl.textContent = _fmtGBP(totalPence);
    var perHeadEl = document.getElementById('ai-cost-per-head');
    if (perHeadEl) perHeadEl.textContent = _fmtGBP(job.serves ? totalPence / job.serves : 0);

    var listEl = document.getElementById('ai-ingredients-list');
    if (listEl) {
      var byCourse = {};
      var order = [];
      (job.post_job_actuals || []).forEach(function (ing) {
        var course = ing.course || '';
        if (!(course in byCourse)) { byCourse[course] = []; order.push(course); }
        byCourse[course].push(ing);
      });
      listEl.innerHTML = order.map(function (course) {
        var rows = byCourse[course].map(function (ing) {
          var reconciledBadge = ing.reconciled
            ? '<span style="font-size:10px;color:var(--muted)">actual: ' + _fmtGBP(ing.actual_spend_pence) + '</span>'
            : '<span style="font-size:10px;color:#B8860B" title="AI estimate — review before relying on it">estimate</span>';
          return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;font-size:13px">'
            + '<span>' + _esc(ing.ingredient_name) + '</span>'
            + '<span style="display:flex;gap:8px;align-items:center">' + reconciledBadge + '<strong>' + _fmtGBP(ing.estimated_portion_cost_pence) + '</strong></span>'
            + '</div>';
        }).join('');
        return (course ? '<div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--muted);margin-top:8px">' + _esc(course) + '</div>' : '') + rows;
      }).join('');
    }

    if (document.getElementById('ai-quote-price')) document.getElementById('ai-quote-price').value = job.quoted_price_pence != null ? (job.quoted_price_pence / 100).toFixed(2) : '';
    _refreshAIGPTargets();

    var reconcileResult = document.getElementById('ai-reconcile-result');
    if (reconcileResult && !job._lastScanResult) reconcileResult.style.display = 'none';
  }

  // ── GP targets / custom GP / margin ──────────────────────────────────────
  function _currentAllInCostPence() {
    if (!_state.currentJob) return 0;
    var food = _totalEstimatedPence(_state.currentJob);
    var otherEl = document.getElementById('ai-other-costs');
    var other = otherEl ? _poundsToPence(otherEl.value) : 0;
    return food + other;
  }

  function _refreshAIGPTargets() {
    if (!_state.currentJob) return;
    var targetsEl = document.getElementById('ai-gp-targets');
    if (targetsEl) targetsEl.style.display = '';
    var cost = _currentAllInCostPence();
    [65, 75].forEach(function (gp) {
      var el = document.getElementById('ai-gp' + gp + '-price');
      if (!el) return;
      var price = window.Veriqo.priceForTargetGP(cost, gp);
      el.textContent = price != null ? _fmtGBP(price) : '£—';
    });
  }

  function _aiSetTargetGP(pct) {
    if (!_state.currentJob) return;
    var cost = _currentAllInCostPence();
    var price = window.Veriqo.priceForTargetGP(cost, pct);
    if (price == null) return;
    var input = document.getElementById('ai-quote-price');
    if (input) input.value = (price / 100).toFixed(2);
    _aiUpdateCustomGP(price / 100);
  }

  function _aiUpdateCustomGP(rawValue) {
    if (!_state.currentJob) return;
    var pricePence = _poundsToPence(rawValue);
    var cost = _currentAllInCostPence();
    var gpBlock = document.getElementById('ai-custom-gp');
    var marginBlock = document.getElementById('ai-margin-display');
    if (!pricePence) {
      if (gpBlock) gpBlock.style.display = 'none';
      if (marginBlock) marginBlock.style.display = 'none';
      return;
    }
    var gp = window.Veriqo.gpForPrice(cost, pricePence);
    var pctEl = document.getElementById('ai-custom-gp-pct');
    if (pctEl) pctEl.textContent = gp + '%';
    if (gpBlock) gpBlock.style.display = '';

    var marginPence = pricePence - cost;
    var marginPenceEl = document.getElementById('ai-margin-pence');
    if (marginPenceEl) marginPenceEl.textContent = _fmtGBP(marginPence);
    var marginPctEl = document.getElementById('ai-margin-pct');
    if (marginPctEl) marginPctEl.textContent = gp + '%';
    if (marginBlock) marginBlock.style.display = '';
  }

  // ── setAIQuotePrice ────────────────────────────────────────────────────────
  async function setAIQuotePrice() {
    if (!_state.currentJob) { toast('Get an estimate first', 'err'); return; }
    var input = document.getElementById('ai-quote-price');
    var pricePence = input ? _poundsToPence(input.value) : 0;
    if (!pricePence) { toast('Enter a quote price', 'err'); return; }

    var btn = document.querySelector('button[onclick="setAIQuotePrice()"]');
    if (btn) { if (btn.dataset.busy === '1') return; btn.dataset.busy = '1'; btn.disabled = true; }

    var result = await _apiFetch('/api/veriqo-job', { method: 'PATCH', body: JSON.stringify({ id: _state.currentJob.id, quoted_price_pence: pricePence }) });

    if (btn) { btn.disabled = false; delete btn.dataset.busy; }

    if (!result.ok) { toast(result.error || 'Could not save quote price', 'err'); return; }
    if (!_setCurrentJob(result.data)) return;

    // Mirror into the existing Costing module's costings table (same schema
    // manual costing uses) so this AI estimate shows up in the normal
    // Costing list — not only inside this screen's own "Past Estimates".
    _saveAsCosting(_state.currentJob);

    toast('Quote price saved ✓');
  }

  function _saveAsCosting(job) {
    if (!window.Mise || !window.Mise.yieldSync) return;
    var ingredients = (job.post_job_actuals || []).map(function (ing) {
      return { name: ing.ingredient_name, packDesc: ing.course || '', packCost: ((ing.estimated_portion_cost_pence || 0) / 100).toFixed(2), qty: '1' };
    });
    var costing = {
      id: 'ai_' + job.id, // stable id derived from the AI job — re-saving (e.g. after reconciliation) updates the same row rather than creating a duplicate
      jobName: job.dish_name,
      covers: String(job.serves || ''),
      wastage: '0',
      hourlyRate: '', hours: '', miles: '', overhead: '',
      margin: job.quoted_price_pence ? String(window.Veriqo.gpForPrice(_totalEstimatedPence(job), job.quoted_price_pence)) : '',
      ingredients: ingredients,
      source: 'ai-estimate',
      aiJobId: job.id,
      createdAt: job.created_at || new Date().toISOString()
    };
    window.Mise.yieldSync.saveCosting(costing);
  }

  // ── quickReconcileAIJob ────────────────────────────────────────────────────
  async function quickReconcileAIJob() {
    if (!_state.currentJob) { toast('Get an estimate first', 'err'); return; }
    if (_state.reconciling) return;
    var input = document.getElementById('ai-quick-spend');
    var spendPence = input ? _poundsToPence(input.value) : 0;
    if (!spendPence) { toast('Enter your actual spend', 'err'); return; }

    _state.reconciling = true;
    var btn = document.getElementById('ai-quick-reconcile-btn');
    var origHTML = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳'; }

    var result = await _apiFetch('/api/veriqo-job', { method: 'POST', body: JSON.stringify({ jobId: _state.currentJob.id, action: 'quick', totalActualSpendPence: spendPence }) });

    if (btn) { btn.disabled = false; btn.innerHTML = origHTML; }
    _state.reconciling = false;

    if (!result.ok) { toast(result.error || 'Reconcile failed — please try again', 'err'); return; }
    if (!_setCurrentJob(result.data)) return;
    _renderResult(_state.currentJob);
    _renderReconcileSummary(_state.currentJob.financials);
    _saveAsCosting(_state.currentJob);
    toast('Reconciled ✓');
  }

  function _renderReconcileSummary(financials) {
    var el = document.getElementById('ai-reconcile-result');
    if (!el || !financials) return;
    var varianceColor = financials.variance_pence > 0 ? '#b3261e' : '#2D7A3A';
    el.innerHTML = '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0"><span>Actual spend</span><strong>' + _fmtGBP(financials.total_actual_cost_pence) + '</strong></div>'
      + '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0"><span>Variance vs estimate</span><strong style="color:' + varianceColor + '">' + (financials.variance_pence > 0 ? '+' : '') + _fmtGBP(financials.variance_pence) + ' (' + financials.variance_percentage + '%)</strong></div>'
      + (financials.actual_margin_pence != null ? '<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0"><span>Actual margin</span><strong>' + _fmtGBP(financials.actual_margin_pence) + ' (' + financials.actual_margin_percentage + '%)</strong></div>' : '');
    el.style.display = '';
  }

  // ── handleAIScanReceipt ────────────────────────────────────────────────────
  async function handleAIScanReceipt(event) {
    var file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    if (!_state.currentJob) { toast('Get an estimate first', 'err'); return; }
    if (_state.scanning) return;
    var err = _validateImageFile(file, 5 * 1024 * 1024); // backend caps ~5MB after base64 inflation
    if (err) { toast(err, 'err'); return; }

    _state.scanning = true;
    toast('⏳ Scanning receipt…');
    try {
      var read = await _readFileAsBase64(file);
      var result = await _apiFetch('/api/veriqo-estimate', {
        method: 'POST',
        body: JSON.stringify({ action: 'scan', jobId: _state.currentJob.id, image: read.base64, mimeType: file.type, vatRegistered: _isVatRegistered() })
      });
      if (!result.ok) { toast(result.error || 'Receipt scan failed — please try again', 'err'); return; }

      var scan = result.data;
      var el = document.getElementById('ai-reconcile-result');
      if (el) {
        var reviewNote = scan.needs_manual_review
          ? '<div style="background:#fff3cd;border-radius:8px;padding:8px 10px;font-size:12px;margin-bottom:8px">⚠ Receipt total doesn\'t closely match matched items — please review before trusting this reconciliation.</div>'
          : '';
        var missing = (scan.missing_items || []).length
          ? '<div style="font-size:12px;color:var(--muted);margin-top:6px">' + scan.missing_items.length + ' ingredient(s) not found on the receipt — still using the original estimate for those.</div>'
          : '';
        el.innerHTML = reviewNote
          + '<div style="font-size:13px;font-weight:600;margin-bottom:4px">Receipt scanned — ' + ((scan.high_confidence_matches || []).length) + ' matched, ' + ((scan.needs_review || []).length) + ' need review</div>'
          + '<div style="font-size:11px;color:var(--muted)">AI-matched — review before relying on these figures.</div>'
          + missing;
        el.style.display = '';
      }

      // Refetch the job so post_job_actuals/status/financials reflect the scan.
      var refreshed = await _apiFetch('/api/veriqo-job?id=' + encodeURIComponent(_state.currentJob.id), { method: 'GET' });
      if (refreshed.ok && _setCurrentJob(refreshed.data)) {
        _renderResult(_state.currentJob);
        if (_state.currentJob.financials) _renderReconcileSummary(_state.currentJob.financials);
        _saveAsCosting(_state.currentJob);
      }
    } catch (e) {
      toast('Receipt scan failed — please try again', 'err');
    } finally {
      _state.scanning = false;
    }
  }

  // ── loadAIJobs ─────────────────────────────────────────────────────────────
  async function loadAIJobs() {
    var listEl = document.getElementById('ai-jobs-list');
    if (!listEl) return;
    var result = await _apiFetch('/api/veriqo-job', { method: 'GET' });
    if (!result.ok) {
      listEl.innerHTML = '<p style="color:var(--muted);font-size:14px;text-align:center;padding:16px 0">Could not load past estimates — ' + _esc(result.error) + '</p>';
      return;
    }
    var jobs = (result.data && result.data.jobs) || [];
    if (!jobs.length) {
      listEl.innerHTML = '<p style="color:var(--muted);font-size:14px;text-align:center;padding:16px 0">No estimates yet — create your first one above.</p>';
      return;
    }
    listEl.innerHTML = jobs.map(function (job) {
      var total = job.post_job_actuals.reduce(function (s, x) { return s + (x.estimated_portion_cost_pence || 0); }, 0);
      var statusLabel = { estimated: 'estimated', partial: 'partial', reconciled: 'reconciled', reconciled_total_only: 'reconciled' }[job.reconciliation_status] || job.reconciliation_status;
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="_aiLoadJob(\'' + job.id + '\')">'
        + '<div><div style="font-weight:600;font-size:14px">' + _esc(job.dish_name) + '</div>'
        + '<div style="font-size:12px;color:var(--muted)">' + job.serves + ' covers · ' + statusLabel + '</div></div>'
        + '<strong>' + _fmtGBP(total) + '</strong></div>';
    }).join('');
  }

  async function _aiLoadJob(jobId) {
    var result = await _apiFetch('/api/veriqo-job?id=' + encodeURIComponent(jobId), { method: 'GET' });
    if (!result.ok) { toast(result.error || 'Could not load that estimate', 'err'); return; }
    if (!_setCurrentJob(result.data)) return;
    _renderResult(_state.currentJob);
    if (_state.currentJob.financials) _renderReconcileSummary(_state.currentJob.financials);
    var section = document.getElementById('ai-result-section');
    if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── expose on window (referenced directly by app.html onclick/onchange) ───
  window._aiSetMode = _aiSetMode;
  window._aiAddCourse = _aiAddCourse;
  window._aiRemoveCourse = _aiRemoveCourse;
  window._aiUpdateCourseField = _aiUpdateCourseField;
  window._aiHandleMenuUpload = _aiHandleMenuUpload;
  window.startAIEstimate = startAIEstimate;
  window._aiSetTargetGP = _aiSetTargetGP;
  window._aiUpdateCustomGP = _aiUpdateCustomGP;
  window._refreshAIGPTargets = _refreshAIGPTargets;
  window.setAIQuotePrice = setAIQuotePrice;
  window.quickReconcileAIJob = quickReconcileAIJob;
  window.handleAIScanReceipt = handleAIScanReceipt;
  window.loadAIJobs = loadAIJobs;
  window._aiLoadJob = _aiLoadJob;
})();
