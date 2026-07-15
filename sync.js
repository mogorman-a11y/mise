// sync.js v14 — unified cloud sync for all modules (HACCP + Menus + shared tables)
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
  // Two item shapes share one localStorage array:
  //  - legacy day-record items: {dateStr, module, records, retries, ts}
  //    (saveDay/saveSettings — unchanged from before this refactor)
  //  - generic entity items: {id, userScope, entityType, operation, payload,
  //    createdAt, attemptCount, lastError, idempotencyKey, dependencyIds}
  //    (saveDish/deleteDish/saveMenu/deleteMenu/saveJob/deleteJob/
  //    saveClient/deleteClient)
  // The queue is scoped to the signed-in user via userScope and is cleared
  // entirely on sign-out (auth.js logout()) so one account's queued writes
  // can never be processed under a different account on the same device.
  var _RETRY_KEY = 'veriqo_sync_retry_queue';
  var _MAX_RETRIES = 5;
  var _MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  function _loadRetryQueue() {
    try { return JSON.parse(localStorage.getItem(_RETRY_KEY) || '[]'); } catch(e) { return []; }
  }
  function _saveRetryQueue(q) {
    try { localStorage.setItem(_RETRY_KEY, JSON.stringify(q)); } catch(e) {}
  }
  function _genId() {
    return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('rq_' + Date.now() + '_' + Math.random().toString(36).slice(2));
  }
  function _clearRetryQueue() {
    try { localStorage.removeItem(_RETRY_KEY); } catch(e) {}
  }

  // Legacy day-record retry (saveDay/saveSettings only).
  function _enqueueRetry(item) {
    var q = _loadRetryQueue();
    q = q.filter(function(x){ return !(x.dateStr === item.dateStr && x.module === item.module); });
    q.push(Object.assign({}, item, { retries: 0, ts: Date.now() }));
    _saveRetryQueue(q);
    console.log('[Veriqo sync] queued for retry:', item.dateStr, item.module || 'haccp');
  }

  // Generic entity retry — used by saveDish/deleteDish/saveMenu/deleteMenu/
  // saveJob/deleteJob/saveClient/deleteClient on failure.
  function _enqueueEntityRetry(entityType, operation, payload, opts) {
    opts = opts || {};
    var q = _loadRetryQueue();
    // menu-import payloads have no top-level .id (the identity is
    // payload.menu.id) — fall back to that so different imports don't all
    // collide onto the same queue key.
    var payloadId = payload && (payload.id != null ? payload.id : (payload.menu && payload.menu.id));
    var idempotencyKey = opts.idempotencyKey || (entityType + ':' + operation + ':' + (payloadId != null ? payloadId : ''));
    // Replace any existing queued item for the same entity+operation so
    // retries don't stack stale versions of the same edit.
    q = q.filter(function(x){ return x.idempotencyKey !== idempotencyKey; });
    q.push({
      id: _genId(),
      userScope: _userId,
      entityType: entityType,
      operation: operation,
      payload: payload,
      createdAt: Date.now(),
      attemptCount: 0,
      lastError: null,
      idempotencyKey: idempotencyKey,
      dependencyIds: opts.dependencyIds || []
    });
    _saveRetryQueue(q);
    console.log('[Veriqo sync] queued for retry:', entityType, operation, idempotencyKey);
  }

  // Core writers — no toast, no enqueue-on-failure. Shared by the public
  // save*/delete* functions (which DO toast + enqueue) and the retry drain
  // loop (which manages the queue array itself and must not trigger a
  // second, duplicate enqueue when a retry attempt itself fails).
  async function _coreSaveDish(d) {
    var r = await supabaseClient.from('dishes').upsert({
      id: String(d.id),
      user_id: _userId,
      name: d.dish || d.name || '',
      category: d.category || null,
      allergens: d.allergens || [],
      prep_tasks: Array.isArray(d.prep_tasks) ? d.prep_tasks : [],
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });
    return r.error ? { ok: false, error: r.error } : { ok: true, data: r.data };
  }
  async function _coreDeleteDish(id) {
    await supabaseClient.from('menu_dishes').delete().eq('dish_id', String(id)).eq('user_id', _userId);
    var r = await supabaseClient.from('dishes').delete().eq('id', String(id)).eq('user_id', _userId);
    return r.error ? { ok: false, error: r.error } : { ok: true };
  }
  async function _coreSaveMenu(m) {
    var menuId = String(m.id);
    var mr = await supabaseClient.from('menus').upsert({
      id: menuId,
      user_id: _userId,
      name: m.name,
      notes: m.notes || null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });
    if (mr.error) return { ok: false, error: mr.error };
    await supabaseClient.from('menu_dishes').delete().eq('menu_id', menuId).eq('user_id', _userId);

    var rows = [];
    if (m.dishes && m.dishes.length) {
      var dishRes = await supabaseClient.from('dishes').select('id, name').eq('user_id', _userId);
      var dishNameMap = {};
      if (!dishRes.error && dishRes.data) {
        dishRes.data.forEach(function (d) { dishNameMap[(d.name || '').toLowerCase()] = d.id; });
      }
      rows = m.dishes.map(function (d, i) {
        return {
          user_id: _userId,
          menu_id: menuId,
          dish_id: dishNameMap[(d.dish || d.name || '').toLowerCase()] || null,
          dish_name: d.dish || d.name || '',
          category: d.category || null,
          allergens: d.allergens || [],
          sort_order: i
        };
      });
    } else if (m.dishIds && m.dishIds.length) {
      var dishRes2 = await supabaseClient.from('dishes').select('id, name, category, allergens').eq('user_id', _userId);
      var dishById = {};
      if (!dishRes2.error && dishRes2.data) {
        dishRes2.data.forEach(function (d) { dishById[String(d.id)] = d; });
      }
      rows = m.dishIds.map(function (id, i) {
        var d = dishById[String(id)] || {};
        return {
          user_id: _userId,
          menu_id: menuId,
          dish_id: String(id),
          dish_name: d.name || '',
          category: d.category || null,
          allergens: d.allergens || [],
          sort_order: i
        };
      });
    }

    if (!rows.length) return { ok: true, data: { menu: mr.data, dishRows: 0 } };
    var ir = await supabaseClient.from('menu_dishes').insert(rows);
    return ir.error ? { ok: false, error: ir.error } : { ok: true, data: { menu: mr.data, dishRows: rows.length } };
  }
  async function _coreDeleteMenu(id) {
    await supabaseClient.from('menu_dishes').delete().eq('menu_id', String(id)).eq('user_id', _userId);
    var r = await supabaseClient.from('menus').delete().eq('id', String(id)).eq('user_id', _userId);
    return r.error ? { ok: false, error: r.error } : { ok: true };
  }
  async function _coreSaveJob(rec) {
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
        guests: rec.guests || [],
        tabDepositPaid: rec.tabDepositPaid || false,
        tabBalancePaid: rec.tabBalancePaid || false,
        tabClosed: rec.tabClosed || false
      },
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });
    return r.error ? { ok: false, error: r.error } : { ok: true, data: r.data };
  }
  async function _coreDeleteJob(id) {
    var r = await supabaseClient.from('jobs').delete().eq('id', String(id)).eq('user_id', _userId);
    return r.error ? { ok: false, error: r.error } : { ok: true };
  }
  async function _coreSaveClient(client) {
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
    return r.error ? { ok: false, error: r.error } : { ok: true, data: r.data };
  }
  async function _coreDeleteClient(id) {
    var r = await supabaseClient.from('clients').delete().eq('id', String(id)).eq('user_id', _userId);
    return r.error ? { ok: false, error: r.error } : { ok: true };
  }

  // ── importMenu ─────────────────────────────────────────────────────────────
  // Atomic AI-menu-import: upserts every new dish, upserts the menu, and
  // replaces its menu_dishes relationships in ONE Postgres transaction via
  // the menu_import_upsert() RPC — so a partial failure can never leave a
  // menu saved with no dish relationships (or vice versa). payload:
  // { dishes: [{id,name,category,allergens}], menu: {id,name}, dishIds: [id,...] }
  async function _coreImportMenu(payload) {
    var r = await supabaseClient.rpc('menu_import_upsert', {
      p_dishes: payload.dishes || [],
      p_menu: payload.menu,
      p_menu_dish_ids: payload.dishIds || []
    });
    return r.error ? { ok: false, error: r.error } : { ok: true, data: r.data };
  }

  var _ENTITY_CORE = {
    dish:   { save: function(p){ return _coreSaveDish(p); },   delete: function(p){ return _coreDeleteDish(p.id); } },
    menu:   { save: function(p){ return _coreSaveMenu(p); },   delete: function(p){ return _coreDeleteMenu(p.id); } },
    job:    { save: function(p){ return _coreSaveJob(p); },    delete: function(p){ return _coreDeleteJob(p.id); } },
    client: { save: function(p){ return _coreSaveClient(p); }, delete: function(p){ return _coreDeleteClient(p.id); } },
    menuImport: { save: function(p){ return _coreImportMenu(p); } }
  };

  var importMenu = _entityWrapper('menuImport', 'save', _coreImportMenu, function(p){ return p.menu && p.menu.name; });

  async function _drainRetryQueue() {
    if (!_userId) return;
    var q = _loadRetryQueue();
    if (!q.length) return;
    var now = Date.now();

    var legacy = q.filter(function(x){ return x.dateStr !== undefined; })
                  .filter(function(x){ return (now - x.ts) < _MAX_AGE_MS && x.retries < _MAX_RETRIES; });
    var entity = q.filter(function(x){ return x.dateStr === undefined; })
                  .filter(function(x){ return (now - x.createdAt) < _MAX_AGE_MS && x.attemptCount < _MAX_RETRIES && x.userScope === _userId; });

    var legacyRemaining = [];
    for (var i = 0; i < legacy.length; i++) {
      var item = legacy[i];
      var table = item.module === 'menus' ? 'mise_records' : 'haccp_records';
      try {
        var r = await supabaseClient.from(table).upsert({
          user_id: _userId, date: item.dateStr, records: item.records
        }, { onConflict: 'user_id,date' });
        if (r.error) throw r.error;
        console.log('[Veriqo sync] ✓ retry succeeded:', item.dateStr, item.module || 'haccp');
      } catch(err) {
        item.retries = (item.retries || 0) + 1;
        console.warn('[Veriqo sync] retry failed (attempt ' + item.retries + '):', item.dateStr, err.message || err);
        legacyRemaining.push(item);
      }
    }

    // Respect dependencyIds: don't retry an item while anything it depends
    // on (e.g. a menu waiting on its dishes) is still itself queued.
    var stillQueuedIds = {};
    entity.forEach(function(x){ stillQueuedIds[x.id] = true; });
    var entityRemaining = [];
    for (var j = 0; j < entity.length; j++) {
      var eItem = entity[j];
      var blocked = (eItem.dependencyIds || []).some(function(depId){ return stillQueuedIds[depId]; });
      if (blocked) { entityRemaining.push(eItem); continue; }
      var core = _ENTITY_CORE[eItem.entityType];
      var fn = core && core[eItem.operation];
      if (!fn) { entityRemaining.push(eItem); continue; }
      try {
        var result = await fn(eItem.payload);
        if (!result.ok) throw result.error || new Error('retry failed');
        console.log('[Veriqo sync] ✓ retry succeeded:', eItem.entityType, eItem.operation, eItem.idempotencyKey);
        delete stillQueuedIds[eItem.id];
      } catch (err) {
        eItem.attemptCount = (eItem.attemptCount || 0) + 1;
        eItem.lastError = (err && err.message) || String(err);
        console.warn('[Veriqo sync] retry failed (attempt ' + eItem.attemptCount + '):', eItem.entityType, eItem.idempotencyKey, eItem.lastError);
        entityRemaining.push(eItem);
      }
    }

    _saveRetryQueue(legacyRemaining.concat(entityRemaining));
    if (legacyRemaining.length === 0 && entityRemaining.length === 0 && q.length > 0) {
      if (typeof toast === 'function') toast('Sync recovered — all pending records saved');
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', function () {
      if (_userId) _drainRetryQueue().catch(function(){});
    });
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

  // ── entity save/delete wrappers ──────────────────────────────────────────
  // Each returns { ok:true, data } or { ok:false, error, queued }. On failure
  // the write is queued for retry (see _enqueueEntityRetry above) and a toast
  // tells the user it's saved locally but not yet synced — callers (e.g. the
  // AI-menu-import flow) must check `ok` rather than assuming success.
  //
  // Save payloads are the entity object itself (already has .id). Delete
  // functions are called with a bare id (matching every existing call site,
  // e.g. Mise.sync.deleteDish(id)) but are normalized to {id} before being
  // passed to the core function or the retry queue, so _ENTITY_CORE (used by
  // the retry drain loop) and every queued payload agree on one shape.
  function _entityWrapper(entityType, operation, coreFn, toPayload, labelFn) {
    return async function (arg) {
      if (!_userId) return { ok: false, error: new Error('not signed in') };
      var payload = toPayload ? toPayload(arg) : arg;
      var result = await coreFn(payload);
      if (!result.ok) {
        console.error('[Veriqo sync] ' + entityType + ' ' + operation + ' failed:', result.error && result.error.message);
        if (typeof toast === 'function') toast('Sync error — ' + entityType + ' saved locally, will retry when online', 'err');
        _enqueueEntityRetry(entityType, operation, payload);
        return { ok: false, error: result.error, queued: true };
      }
      console.log('[Veriqo sync] ✓ ' + entityType + ' ' + operation + ':', labelFn ? labelFn(payload) : '');
      return result;
    };
  }

  var saveDish     = _entityWrapper('dish', 'save', _coreSaveDish, null, function(d){ return d.dish || d.name; });
  var deleteDish   = _entityWrapper('dish', 'delete', function(p){ return _coreDeleteDish(p.id); }, function(id){ return { id: id }; }, function(p){ return p.id; });
  var saveMenu     = _entityWrapper('menu', 'save', _coreSaveMenu, null, function(m){ return m.name; });
  var deleteMenu   = _entityWrapper('menu', 'delete', function(p){ return _coreDeleteMenu(p.id); }, function(id){ return { id: id }; }, function(p){ return p.id; });
  var saveJob      = _entityWrapper('job', 'save', _coreSaveJob, null, function(rec){ return rec.id; });
  var deleteJob    = _entityWrapper('job', 'delete', function(p){ return _coreDeleteJob(p.id); }, function(id){ return { id: id }; }, function(p){ return p.id; });
  var saveClient   = _entityWrapper('client', 'save', _coreSaveClient, null, function(c){ return c.name; });
  var deleteClient = _entityWrapper('client', 'delete', function(p){ return _coreDeleteClient(p.id); }, function(id){ return { id: id }; }, function(p){ return p.id; });

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
      if (typeof records !== 'undefined' && !window._haccpDemoMode) {
        records.length = 0;
        localTodayRecs.forEach(function (r) { records.push(r); });
      }
      // Re-push local-ahead data to Supabase so it catches up
      supabaseClient.from('haccp_records').upsert({ user_id: userId, date: today, records: localTodayRecs }, { onConflict: 'user_id,date' }).then(function(r){ if(!r.error) console.log('[Veriqo sync] ✓ re-synced local-ahead today records'); });
    } else {
      if (typeof records !== 'undefined' && !window._haccpDemoMode) {
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
      // Capture local dishIds before the pull overwrites mSettings — used as
      // fallback for menus whose menu_dishes rows weren't written (legacy bug).
      var localMenuDishIds = {};
      try {
        var _localMs = JSON.parse(localStorage.getItem('mise_settings') || '{}');
        (_localMs.savedMenus || []).forEach(function (m) {
          if (m.dishIds && m.dishIds.length) localMenuDishIds[String(m.id)] = m.dishIds;
        });
      } catch (e) {}

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
        return { id: d.id, dish: d.name || '', category: d.category || '', allergens: Array.isArray(d.allergens) ? d.allergens : [], prep_tasks: Array.isArray(d.prep_tasks) ? d.prep_tasks : [] };
      });
      var dishesById = {};
      mappedDishes.forEach(function (d) { dishesById[String(d.id)] = d; });
      var mappedMenus = menusData.map(function (m) {
        var mDishRows = menuDishes
          .filter(function (md) { return md.menu_id === m.id; })
          .sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
        var dishIds = mDishRows.map(function (md) { return md.dish_id; }).filter(Boolean);
        // Fallback: if Supabase has no menu_dishes rows, use locally-saved dishIds
        if (!dishIds.length && localMenuDishIds[String(m.id)]) {
          dishIds = localMenuDishIds[String(m.id)];
        }
        var mDishes = mDishRows.map(function (md) { return { dish: md.dish_name, category: md.category || '', allergens: md.allergens || [] }; });
        // If the menu_dishes join produced nothing (missing relationship rows —
        // see the AI-import atomicity fix) but we do have dishIds, resolve
        // those against the just-pulled dish library instead of leaving
        // `dishes` empty — otherwise every consumer that reads menu.dishes
        // (Costing's menu library, HACCP's allergen views) silently shows 0
        // dishes for a menu that actually has real dish relationships.
        var resolvedDishes = mDishes.length ? mDishes : window.Veriqo.resolveMenuDishes({ dishIds: dishIds }, dishesById);
        return { id: m.id, name: m.name || '', dishes: resolvedDishes, dishIds: dishIds };
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
          guests: meta.guests || [],
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
    if (typeof _findJobForToday === 'function') _findJobForToday();
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
    importMenu,
    saveProfileField,
    refreshSharedJobs,
    clearRetryQueue: _clearRetryQueue,
    // expose profile via getter for app.html usage
    get profile() { return _resolveProfile(); }
  };

})();
