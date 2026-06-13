// sync.js v13 — unified cloud sync for all modules (HACCP + Menus + shared tables)
// Handles: haccp_records, mise_records, settings, mise_settings, clients, dishes,
//          menus, menu_dishes, jobs tables. Each module passes its name as the
//          third argument to saveDay/saveSettings to route to the correct table.

window.Mise = window.Mise || {};
window.Mise.sync = (function () {

  var _userId = null;
  var _visibilityBound = false;

  function _resolveProfile() {
    if (window.Mise && window.Mise.profile) return window.Mise.profile;
    try { return JSON.parse(localStorage.getItem('veriqo_profile') || 'null'); } catch(e) { return null; }
  }

  function _applyProfileToSettings() {
    var profile = _resolveProfile();
    if (!profile) return;
    ['haccp_settings', 'mise_settings'].forEach(function(lsKey) {
      var settingsVar = lsKey === 'haccp_settings' ? (typeof settings !== 'undefined' ? settings : null) : (typeof mSettings !== 'undefined' ? mSettings : null);
      var s;
      try { s = JSON.parse(localStorage.getItem(lsKey) || '{}'); } catch(e) { s = {}; }
      if (!s) s = {};
      var changed = false;
      if (profile.business_name && s.business_name !== profile.business_name) { s.business_name = profile.business_name; changed = true; }
      if (profile.chef_name     && s.chef_name     !== profile.chef_name)     { s.chef_name     = profile.chef_name;     changed = true; }
      if (profile.logo          && s.logo          !== profile.logo)          { s.logo          = profile.logo;          changed = true; }
      if (!changed) return;
      try { localStorage.setItem(lsKey, JSON.stringify(s)); } catch(e) {}
      if (settingsVar) Object.assign(settingsVar, s);
    });
  }

  // ── loadAll ────────────────────────────────────────────────────────────────
  async function loadAll(userId) {
    _userId = userId;
    console.log('[Veriqo sync] loadAll — userId:', userId);
    try {
      await Promise.all([
        _pullHaccpRecords(userId),
        _pullMiseRecords(userId)
      ]);
      await Promise.all([
        _pullHaccpSettings(userId),
        _pullMiseSettings(userId)
      ]);
      await _pullSharedJobs(userId);
      _applyProfileToSettings();
      _refreshAppViews();
      console.log('[Veriqo sync] ✓ full sync complete');
    } catch (err) {
      console.error('[Veriqo sync] loadAll error:', err.message || err);
    }

    if (!_visibilityBound) {
      _visibilityBound = true;
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible' && _userId) {
          _drainRetryQueue().catch(function(){});
          Promise.all([_pullHaccpRecords(_userId), _pullMiseRecords(_userId)])
            .then(function() { return Promise.all([_pullHaccpSettings(_userId), _pullMiseSettings(_userId)]); })
            .then(function() { return _pullSharedJobs(_userId); })
            .then(_refreshAppViews)
            .catch(function () {});
        }
      });
    }
  }

  // ── Retry queue ────────────────────────────────────────────────────────────
  var _RETRY_KEY = 'veriqo_sync_retry_queue';
  var _MAX_RETRIES = 5;
  var _MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  function _loadRetryQueue() {
    try { return JSON.parse(localStorage.getItem(_RETRY_KEY) || '[]'); } catch(e) { return []; }
  }
  function _saveRetryQueue(q) {
    try { localStorage.setItem(_RETRY_KEY, JSON.stringify(q)); } catch(e) {}
  }
  function _enqueueRetry(item) {
    var q = _loadRetryQueue();
    // Replace any existing entry for same date+module to avoid stacking stale versions
    q = q.filter(function(x){ return !(x.dateStr === item.dateStr && x.module === item.module); });
    q.push(Object.assign({}, item, { retries: 0, ts: Date.now() }));
    _saveRetryQueue(q);
    console.log('[Veriqo sync] queued for retry:', item.dateStr, item.module || 'haccp');
  }
  async function _drainRetryQueue() {
    if (!_userId) return;
    var q = _loadRetryQueue();
    if (!q.length) return;
    // Drop stale items
    var now = Date.now();
    q = q.filter(function(x){ return (now - x.ts) < _MAX_AGE_MS && x.retries < _MAX_RETRIES; });
    var remaining = [];
    for (var i = 0; i < q.length; i++) {
      var item = q[i];
      var table = item.module === 'menus' ? 'mise_records' : 'haccp_records';
      try {
        var r = await supabaseClient.from(table).upsert({
          user_id: _userId,
          date: item.dateStr,
          records: item.records
        }, { onConflict: 'user_id,date' });
        if (r.error) throw r.error;
        console.log('[Veriqo sync] ✓ retry succeeded:', item.dateStr, item.module || 'haccp');
      } catch(err) {
        item.retries = (item.retries || 0) + 1;
        console.warn('[Veriqo sync] retry failed (attempt ' + item.retries + '):', item.dateStr, err.message || err);
        remaining.push(item);
      }
    }
    _saveRetryQueue(remaining);
    if (remaining.length === 0 && q.length > 0) {
      if (typeof toast === 'function') toast('Sync recovered — all pending records saved');
    }
  }

  // ── saveDay ────────────────────────────────────────────────────────────────
  // module: 'haccp' (default) → haccp_records table
  //         'menus'            → mise_records table
  async function saveDay(dateStr, recordsArray, module) {
    if (!_userId) { console.warn('[Veriqo sync] saveDay skipped — not signed in'); return; }
    var table = module === 'menus' ? 'mise_records' : 'haccp_records';
    var conflict = module === 'menus' ? 'user_id,date' : 'user_id,date';
    try {
      var r = await supabaseClient.from(table).upsert({
        user_id: _userId,
        date: dateStr,
        records: recordsArray
      }, { onConflict: conflict });
      if (r.error) throw r.error;
      console.log('[Veriqo sync] ✓ day saved (' + (module || 'haccp') + '):', dateStr);
      _refreshAppViews();
    } catch (err) {
      console.error('[Veriqo sync] saveDay failed (' + (module || 'haccp') + '):', err.message || err);
      if (typeof toast === 'function') toast('Sync error — data saved locally, will retry when online', 'err');
      _enqueueRetry({ dateStr: dateStr, records: recordsArray, module: module || 'haccp' });
    }
  }

  // ── saveSettings ───────────────────────────────────────────────────────────
  // module: 'haccp' (default) → settings table
  //         'menus'            → mise_settings table
  async function saveSettings(settingsObj, module) {
    if (!_userId) { console.warn('[Veriqo sync] saveSettings skipped — not signed in'); return; }
    var table = module === 'menus' ? 'mise_settings' : 'settings';
    try {
      var r = await supabaseClient.from(table).upsert({
        id: _userId,
        config: settingsObj,
        updated_at: new Date().toISOString()
      });
      if (r.error) throw r.error;
      console.log('[Veriqo sync] ✓ settings saved (' + (module || 'haccp') + ')');
      _refreshAppViews();
    } catch (err) {
      console.error('[Veriqo sync] saveSettings failed (' + (module || 'haccp') + '):', err.message || err);
      if (typeof toast === 'function') toast('Sync error — settings saved locally only', 'err');
    }
  }

  // ── saveDish ───────────────────────────────────────────────────────────────
  async function saveDish(d) {
    if (!_userId) return;
    var r = await supabaseClient.from('dishes').upsert({
      id: String(d.id),
      user_id: _userId,
      name: d.dish || d.name || '',
      category: d.category || null,
      allergens: d.allergens || [],
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });
    if (r.error) console.error('[Veriqo sync] saveDish failed:', r.error.message);
    else console.log('[Veriqo sync] ✓ dish saved:', d.dish || d.name);
  }

  // ── deleteDish ─────────────────────────────────────────────────────────────
  async function deleteDish(id) {
    if (!_userId) return;
    await supabaseClient.from('menu_dishes').delete().eq('dish_id', String(id)).eq('user_id', _userId);
    var r = await supabaseClient.from('dishes').delete().eq('id', String(id)).eq('user_id', _userId);
    if (r.error) console.error('[Veriqo sync] deleteDish failed:', r.error.message);
  }

  // ── saveMenu ───────────────────────────────────────────────────────────────
  async function saveMenu(m) {
    if (!_userId) return;
    var menuId = String(m.id);
    var mr = await supabaseClient.from('menus').upsert({
      id: menuId,
      user_id: _userId,
      name: m.name,
      notes: m.notes || null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });
    if (mr.error) { console.error('[Veriqo sync] saveMenu failed:', mr.error.message); return; }
    await supabaseClient.from('menu_dishes').delete().eq('menu_id', menuId).eq('user_id', _userId);
    var dishes = m.dishes || [];
    if (!dishes.length) return;
    var dishRes = await supabaseClient.from('dishes').select('id, name').eq('user_id', _userId);
    var dishMap = {};
    if (!dishRes.error && dishRes.data) {
      dishRes.data.forEach(function (d) { dishMap[d.name.toLowerCase()] = d.id; });
    }
    var rows = dishes.map(function (d, i) {
      return {
        user_id: _userId,
        menu_id: menuId,
        dish_id: dishMap[(d.dish || d.name || '').toLowerCase()] || null,
        dish_name: d.dish || d.name || '',
        category: d.category || null,
        allergens: d.allergens || [],
        sort_order: i
      };
    });
    var ir = await supabaseClient.from('menu_dishes').insert(rows);
    if (ir.error) console.error('[Veriqo sync] saveMenu dishes failed:', ir.error.message);
    else console.log('[Veriqo sync] ✓ menu saved:', m.name);
  }

  // ── deleteMenu ─────────────────────────────────────────────────────────────
  async function deleteMenu(id) {
    if (!_userId) return;
    await supabaseClient.from('menu_dishes').delete().eq('menu_id', String(id)).eq('user_id', _userId);
    var r = await supabaseClient.from('menus').delete().eq('id', String(id)).eq('user_id', _userId);
    if (r.error) console.error('[Veriqo sync] deleteMenu failed:', r.error.message);
  }

  // ── saveJob ────────────────────────────────────────────────────────────────
  async function saveJob(rec) {
    if (!_userId) return;
    var r = await supabaseClient.from('jobs').upsert({
      id: String(rec.id),
      user_id: _userId,
      title: rec.jobType || '',
      job_date: rec.eventDate,
      start_time: rec.eventTime || null,
      location: rec.location || null,
      headcount: rec.covers ? (parseInt(rec.covers) || null) : null,
      status: rec.status || 'confirmed',
      notes: rec.notes || null,
      source: rec.source || 'carte',
      metadata: {
        client_name: rec.client || '',
        menus: rec.menus || [],
        tabDepositPaid: rec.tabDepositPaid || false,
        tabBalancePaid: rec.tabBalancePaid || false,
        tabClosed: rec.tabClosed || false
      },
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });
    if (r.error) console.error('[Veriqo sync] saveJob failed:', r.error.message);
    else console.log('[Veriqo sync] ✓ job saved:', rec.id);
  }

  // ── deleteJob ──────────────────────────────────────────────────────────────
  async function deleteJob(id) {
    if (!_userId) return;
    var r = await supabaseClient.from('jobs').delete().eq('id', String(id)).eq('user_id', _userId);
    if (r.error) console.error('[Veriqo sync] deleteJob failed:', r.error.message);
  }

  // ── saveClient ─────────────────────────────────────────────────────────────
  async function saveClient(client) {
    if (!_userId) return;
    var r = await supabaseClient.from('clients').upsert({
      id: String(client.id),
      user_id: _userId,
      name: client.name || '',
      email: client.email || null,
      phone: client.phone || null,
      address: client.address || null,
      notes: client.diet || client.notes || null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });
    if (r.error) console.error('[Veriqo sync] saveClient failed:', r.error.message);
    else console.log('[Veriqo sync] ✓ client saved:', client.name);
  }

  // ── deleteClient ───────────────────────────────────────────────────────────
  async function deleteClient(id) {
    if (!_userId) return;
    var r = await supabaseClient.from('clients').delete().eq('id', String(id)).eq('user_id', _userId);
    if (r.error) console.error('[Veriqo sync] deleteClient failed:', r.error.message);
  }

  // ── saveProfileField ───────────────────────────────────────────────────────
  async function saveProfileField(field, value) {
    if (!_userId) return;
    var payload = {}; payload[field] = value;
    await supabaseClient.from('profiles').update(payload).eq('id', _userId);
  }

  // ── _pullHaccpRecords ──────────────────────────────────────────────────────
  async function _pullHaccpRecords(userId) {
    var result = await supabaseClient
      .from('haccp_records')
      .select('date, records')
      .eq('user_id', userId)
      .order('date', { ascending: false });
    if (result.error) throw result.error;
    if (!result.data) return;
    console.log('[Veriqo sync] _pullHaccpRecords: got', result.data.length, 'rows');
    var today = new Date().toISOString().slice(0, 10);
    // Snapshot local today records before wiping — guard against race where
    // saveDay hasn't finished writing to Supabase yet when a visibility-change
    // pull fires and would otherwise overwrite the just-saved local data.
    var localTodayRaw = localStorage.getItem('haccp_' + today);
    var localTodayRecs = localTodayRaw ? JSON.parse(localTodayRaw) : [];
    Object.keys(localStorage)
      .filter(function (k) {
        return k.startsWith('haccp_') && k !== 'haccp_settings' && k !== 'haccp_credentials' && k !== 'haccp_suppliers';
      })
      .forEach(function (k) { localStorage.removeItem(k); });
    result.data.forEach(function (row) {
      try { localStorage.setItem('haccp_' + row.date, JSON.stringify(row.records)); } catch (e) {}
    });
    var todayRow = result.data.find(function (r) { return r.date === today; });
    var remoteLen = todayRow ? todayRow.records.length : 0;
    // If local has more records than remote, local data is ahead of Supabase —
    // keep it and re-save so Supabase catches up.
    if (localTodayRecs.length > remoteLen) {
      try { localStorage.setItem('haccp_' + today, JSON.stringify(localTodayRecs)); } catch (e) {}
      if (typeof records !== 'undefined') {
        records.length = 0;
        localTodayRecs.forEach(function (r) { records.push(r); });
      }
      // Re-push local-ahead data to Supabase so it catches up
      supabaseClient.from('haccp_records').upsert({ user_id: userId, date: today, records: localTodayRecs }, { onConflict: 'user_id,date' }).then(function(r){ if(!r.error) console.log('[Veriqo sync] ✓ re-synced local-ahead today records'); });
    } else {
      if (typeof records !== 'undefined') {
        records.length = 0;
        if (todayRow) todayRow.records.forEach(function (r) { records.push(r); });
      }
    }
  }

  // ── _pullMiseRecords ───────────────────────────────────────────────────────
  async function _pullMiseRecords(userId) {
    var result = await supabaseClient
      .from('mise_records')
      .select('date, records')
      .eq('user_id', userId)
      .order('date', { ascending: false });
    if (result.error) { console.warn('[Veriqo sync] _pullMiseRecords error:', result.error.message); return; }
    if (!result.data) return;
    console.log('[Veriqo sync] _pullMiseRecords: got', result.data.length, 'rows');
    Object.keys(localStorage)
      .filter(function (k) { return k.startsWith('mise_') && k !== 'mise_settings'; })
      .forEach(function (k) { localStorage.removeItem(k); });
    result.data.forEach(function (row) {
      try { localStorage.setItem('mise_' + row.date, JSON.stringify(row.records)); } catch (e) {}
    });
    var today = new Date().toISOString().slice(0, 10);
    var todayRow = result.data.find(function (r) { return String(r.date) === today; });
    if (typeof mRecords !== 'undefined') {
      mRecords.length = 0;
      if (todayRow) todayRow.records.forEach(function (r) { mRecords.push(r); });
    }
  }

  // ── _pullHaccpSettings ─────────────────────────────────────────────────────
  async function _pullHaccpSettings(userId) {
    var result = await supabaseClient.from('settings').select('config').eq('id', userId).single();
    if (result.error && result.error.code !== 'PGRST116') { console.warn('[Veriqo sync] _pullHaccpSettings error:', result.error.message); return; }
    if (result.data && result.data.config) {
      var _cloud = result.data.config;
      // Guard: skip if the cloud row is contaminated Menus data (has Menus-only keys but no HACCP keys).
      // This happened when loadSettings() was shadowed by menus.js causing the wrong data to be saved.
      var isHaccpData = (_cloud.staff !== undefined || _cloud.fridgeUnits !== undefined ||
                         _cloud.thresholds !== undefined || _cloud.enabledTiles !== undefined ||
                         _cloud.checklist_opening !== undefined);
      var isMesonlyData = (_cloud.chefName !== undefined || _cloud.businessName !== undefined ||
                           _cloud.dashboardConfig !== undefined) && !isHaccpData;
      if (!isMesonlyData && typeof settings !== 'undefined') {
        Object.keys(settings).forEach(function (k) { delete settings[k]; });
        Object.assign(settings, _cloud);
        try { localStorage.setItem('haccp_settings', JSON.stringify(_cloud)); } catch (e) {}
      } else if (isMesonlyData) {
        console.warn('[Veriqo sync] HACCP settings row contains Menus data — skipping to preserve local defaults');
      }
    }
    await _pullSharedLibrary(userId);
    _applyProfileToSettings();
  }

  // ── _pullMiseSettings ──────────────────────────────────────────────────────
  async function _pullMiseSettings(userId) {
    var result = await supabaseClient.from('mise_settings').select('config').eq('id', userId).single();
    if (result.error && result.error.code !== 'PGRST116') { console.warn('[Veriqo sync] _pullMiseSettings error:', result.error.message); return; }
    if (result.data && result.data.config && typeof mSettings !== 'undefined') {
      var _cloud = result.data.config;
      Object.keys(mSettings).forEach(function (k) { delete mSettings[k]; });
      Object.assign(mSettings, _cloud);
      try { localStorage.setItem('mise_settings', JSON.stringify(mSettings)); } catch (e) {}
      if (typeof loadMiseSettings === 'function') loadMiseSettings();
    }
  }

  // ── _pullSharedLibrary ─────────────────────────────────────────────────────
  // Updates BOTH HACCP (settings) and Menus (mSettings) with shared table data
  async function _pullSharedLibrary(userId) {
    try {
      var results = await Promise.all([
        supabaseClient.from('clients').select('*').eq('user_id', userId).order('name'),
        supabaseClient.from('dishes').select('*').eq('user_id', userId).order('name'),
        supabaseClient.from('menus').select('*').eq('user_id', userId).order('name'),
        supabaseClient.from('menu_dishes').select('*').eq('user_id', userId).order('sort_order')
      ]);
      var clients    = results[0].data || [];
      var dishesData = results[1].data || [];
      var menusData  = results[2].data || [];
      var menuDishes = results[3].data || [];

      var mappedClients = clients.map(function (c) {
        return { id: c.id, name: c.name || '', address: c.address || '', phone: c.phone || '', email: c.email || '', diet: c.notes || '' };
      });
      var mappedDishes = dishesData.map(function (d) {
        return { id: d.id, dish: d.name || '', category: d.category || '', allergens: Array.isArray(d.allergens) ? d.allergens : [] };
      });
      var mappedMenus = menusData.map(function (m) {
        var mDishRows = menuDishes
          .filter(function (md) { return md.menu_id === m.id; })
          .sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
        var dishIds = mDishRows.map(function (md) { return md.dish_id; }).filter(Boolean);
        var mDishes = mDishRows.map(function (md) { return { dish: md.dish_name, category: md.category || '', allergens: md.allergens || [] }; });
        return { id: m.id, name: m.name || '', dishes: mDishes, dishIds: dishIds };
      });

      // Apply to HACCP settings var + localStorage
      if (typeof settings !== 'undefined') {
        if (clients.length)    settings.savedClients = mappedClients;
        if (dishesData.length) settings.savedDishes  = mappedDishes;
        if (menusData.length)  settings.savedMenus   = mappedMenus;
        try { localStorage.setItem('haccp_settings', JSON.stringify(settings)); } catch (e) {}
      }

      // Apply to Menus mSettings var + localStorage
      if (typeof mSettings !== 'undefined') {
        if (clients.length)    mSettings.savedClients = mappedClients;
        if (dishesData.length) mSettings.savedDishes  = mappedDishes;
        if (menusData.length)  mSettings.savedMenus   = mappedMenus;
        try { localStorage.setItem('mise_settings', JSON.stringify(mSettings)); } catch (e) {}
      }

      console.log('[Veriqo sync] ✓ shared library — clients:', clients.length, 'dishes:', dishesData.length, 'menus:', menusData.length);
    } catch (err) {
      console.error('[Veriqo sync] _pullSharedLibrary failed:', err.message || err);
    }
  }

  // ── _pullSharedJobs ────────────────────────────────────────────────────────
  // Injects yield-sourced jobs into BOTH haccp_* and mise_* localStorage keys
  async function _pullSharedJobs(userId) {
    try {
      var res = await supabaseClient.from('jobs').select('*').eq('user_id', userId).order('job_date');
      if (!res.data || !res.data.length) return;
      res.data.forEach(function (j) {
        if (!j.job_date) return;
        var meta = j.metadata || {};
        var rec = {
          id: j.id,
          type: 'job',
          date: j.job_date,
          time: j.start_time || '',
          client: meta.client_name || '',
          location: j.location || '',
          eventDate: j.job_date,
          eventTime: j.start_time || '',
          covers: j.headcount ? String(j.headcount) : '',
          jobType: j.title || '',
          notes: j.notes || '',
          menus: meta.menus || [],
          source: j.source || 'carte',
          _fromCarte: j.source === 'carte',
          _fromYield: j.source === 'yield'
        };
        // Inject into mise_ key (Menus module)
        var mKey = 'mise_' + j.job_date;
        try {
          var mEx = JSON.parse(localStorage.getItem(mKey) || '[]');
          var mIdx = mEx.findIndex(function (r) { return r.id === rec.id; });
          if (mIdx >= 0) mEx[mIdx] = rec; else mEx.push(rec);
          localStorage.setItem(mKey, JSON.stringify(mEx));
        } catch (e) {}
        // Inject into haccp_ key (HACCP module) for yield-sourced jobs only
        if (j.source !== 'carte') {
          var hKey = 'haccp_' + j.job_date;
          try {
            var hEx = JSON.parse(localStorage.getItem(hKey) || '[]');
            var hIdx = hEx.findIndex(function (r) { return r.id === rec.id; });
            if (hIdx >= 0) hEx[hIdx] = rec; else hEx.push(rec);
            localStorage.setItem(hKey, JSON.stringify(hEx));
          } catch (e) {}
        }
      });
      console.log('[Veriqo sync] ✓ shared jobs pulled:', res.data.length);
    } catch (e) {
      console.warn('[Veriqo sync] _pullSharedJobs failed:', e.message);
    }
  }

  // ── _refreshAppViews ───────────────────────────────────────────────────────
  function _refreshAppViews() {
    if (typeof loadHaccpSettings === 'function') loadHaccpSettings();
    if (typeof loadMiseSettings === 'function') loadMiseSettings();
    if (typeof loadHaccpToday === 'function') loadHaccpToday();
    if (typeof loadMiseToday === 'function') loadMiseToday();
    if (typeof populateHaccpSelects === 'function') populateHaccpSelects();
    if (typeof populateMiseSelects === 'function') populateMiseSelects();
    if (typeof renderMenuLibrary === 'function') renderMenuLibrary();
    if (typeof renderDishLibrary === 'function') renderDishLibrary();
    if (typeof renderSavedMenus === 'function') renderSavedMenus();
    if (typeof renderCalendar === 'function') renderCalendar();
    if (typeof updateDashboard === 'function') updateDashboard();
    if (typeof updateHaccpDashboard === 'function') updateHaccpDashboard();
    if (typeof syncTileToggles === 'function') syncTileToggles();
    if (typeof renderHaccpSections === 'function') renderHaccpSections();
    if (typeof renderMiseSections === 'function') renderMiseSections();
    if (typeof updateNextJobBanner === 'function') updateNextJobBanner();
    document.dispatchEvent(new CustomEvent('vq:sync-complete'));
  }

  // ── refreshSharedJobs ──────────────────────────────────────────────────────
  // Re-pulls the jobs table and refreshes local views immediately.
  // Called by yield-sync.js after syncQuoteToCarte / removeQuoteFromCarte
  // so Menus and HACCP see the change without needing a page reload.
  async function refreshSharedJobs() {
    if (!_userId) return;
    try {
      await _pullSharedJobs(_userId);
      _refreshAppViews();
    } catch (e) {
      console.warn('[Veriqo sync] refreshSharedJobs failed:', e.message);
    }
  }

  // Aliases for backwards compatibility
  async function deleteSuiteMenu(id) { return deleteMenu(id); }
  async function deleteSuiteDish(id) { return deleteDish(id); }

  return {
    loadAll,
    saveDay, saveSettings,
    saveDish, deleteDish,
    saveMenu, deleteMenu, deleteSuiteMenu, deleteSuiteDish,
    saveJob, deleteJob,
    saveClient, deleteClient,
    saveProfileField,
    refreshSharedJobs,
    // expose profile via getter for app.html usage
    get profile() { return _resolveProfile(); }
  };

})();
