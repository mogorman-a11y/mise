// sync.js v15 — unified cloud sync for all modules (HACCP + Menus + shared tables)
// Handles: haccp_records, mise_records, settings, mise_settings, clients, dishes,
//          menus, menu_dishes, jobs tables. Each module passes its name as the
//          third argument to saveDay/saveSettings to route to the correct table.

window.Mise = window.Mise || {};
window.Mise.sync = (function () {

  var _userId = null;
  var _visibilityBound = false;
  var _haccpUser = null;
  var _haccpWork = Promise.resolve();
  var _haccpChecked = false;
  var _haccpLocalOnly = new Set();
  var _haccpPendingTime = 0;
  var _HACCP_PENDING = 'haccp_pending_';

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
    setHaccpUser(userId);
    console.log('[Veriqo sync] loadAll — userId:', userId);
    try {
      await Promise.all([
        _syncHaccp(userId, true),
        _pullMiseRecords(userId)
      ]);
      await Promise.all([
        _pullHaccpSettings(userId),
        _pullMiseSettings(userId)
      ]);
      await _pullSharedJobs(userId);
      _applyProfileToSettings();
      _safeRefreshAppViews('full sync');
      await _drainRetryQueue();
      console.log('[Veriqo sync] ✓ full sync complete');
    } catch (err) {
      console.error('[Veriqo sync] loadAll error:', err.message || err);
    }

    if (!_visibilityBound) {
      _visibilityBound = true;
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible' && _userId) {
          _drainRetryQueue().catch(function(){});
          Promise.all([_syncHaccp(_userId, true), _pullMiseRecords(_userId)])
            .then(function() { return Promise.all([_pullHaccpSettings(_userId), _pullMiseSettings(_userId)]); })
            .then(function() { return _pullSharedJobs(_userId); })
            .then(_refreshAppViews)
            .catch(function () {});
        }
      });
    }
  }

  // ── Retry queue ────────────────────────────────────────────────────────────
  // Menus and generic entities share one localStorage array:
  //  - legacy menu day-record snapshots: {dateStr, module, records, retries, ts}
  //    (older HACCP snapshots migrate to the HACCP outbox when their owner signs in)
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
        tabClosed: rec.tabClosed || false,
        prepAndPack: rec.prepAndPack || null
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

  async function _coreSaveSettings(payload) {
    var table = payload.module === 'menus' ? 'mise_settings' : 'settings';
    var r = await supabaseClient.from(table).upsert({
      id: _userId,
      config: payload.config,
      updated_at: new Date().toISOString()
    });
    if (r.error) return { ok: false, error: r.error };
    var storageKey = payload.module === 'menus' ? 'mise_settings' : 'haccp_settings';
    try { localStorage.setItem(storageKey, JSON.stringify(payload.config)); } catch(e) {}
    if (payload.module === 'menus' && typeof mSettings !== 'undefined') {
      Object.keys(mSettings).forEach(function(k) { delete mSettings[k]; });
      Object.assign(mSettings, payload.config);
    } else if (payload.module !== 'menus' && typeof settings !== 'undefined') {
      Object.keys(settings).forEach(function(k) { delete settings[k]; });
      Object.assign(settings, payload.config);
    }
    return { ok: true, data: r.data };
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
    menuImport: { save: function(p){ return _coreImportMenu(p); } },
    settings: { save: function(p){ return _coreSaveSettings(p); } }
  };

  var importMenu = _entityWrapper('menuImport', 'save', _coreImportMenu, null, function(p){ return p.menu && p.menu.name; });

  async function _drainRetryQueue() {
    if (!_userId) return;
    var q = _loadRetryQueue();
    if (!q.length) return;
    var now = Date.now();

    var legacy = q.filter(function(x){ return x.dateStr !== undefined && x.module === 'menus'; })
                  .filter(function(x){ return x.userScope === _userId && (now - x.ts) < _MAX_AGE_MS && x.retries < _MAX_RETRIES; });
    // Keep any HACCP item here if the HACCP outbox could not take it yet.
    var hadLegacyHaccp = q.some(function(x){ return x.dateStr !== undefined && x.module !== 'menus'; });
    var entity = q.filter(function(x){ return x.dateStr === undefined; })
                  .filter(function(x){ return (now - x.createdAt) < _MAX_AGE_MS && x.attemptCount < _MAX_RETRIES && x.userScope === _userId; });

    var legacyRemaining = [];
    for (var i = 0; i < legacy.length; i++) {
      var item = legacy[i];
      var table = 'mise_records';
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

    _saveRetryQueue(legacyRemaining.concat(entityRemaining,
      _loadRetryQueue().filter(function(x){ return x.dateStr !== undefined && x.module !== 'menus'; })));
    if (!hadLegacyHaccp && !legacyRemaining.length && !entityRemaining.length && q.length > 0) {
      _safeRefreshAppViews('retry recovery');
      if (typeof toast === 'function') toast('Sync recovered — all pending records saved');
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', function () {
      if (_userId) _drainRetryQueue().catch(function(){});
      refreshHaccpRecords();
    });
  }

  // ── saveDay ────────────────────────────────────────────────────────────────
  // Menu day snapshots use the legacy retry path. HACCP uses saveHaccpChanges.
  async function saveDay(dateStr, recordsArray, module) {
    if (module !== 'menus') return { ok: false };
    var recordsSnapshot = Array.isArray(recordsArray) ? recordsArray.slice() : [];
    if (!_userId) {
      try {
        var sessionResult = await supabaseClient.auth.getSession();
        var session = sessionResult && sessionResult.data && sessionResult.data.session;
        if (session && session.user) _userId = session.user.id;
      } catch (e) {}
    }
    if (!_userId) {
      console.warn('[Veriqo sync] saveDay deferred — no signed-in session; data remains on this device');
      return { ok: false, localOnly: true, sessionExpired: true };
    }
    var table = 'mise_records';
    try {
      var r = await supabaseClient.from(table).upsert({
        user_id: _userId,
        date: dateStr,
        records: recordsSnapshot
      }, { onConflict: 'user_id,date' });
      if (r.error) throw r.error;
      console.log('[Veriqo sync] ✓ day saved (' + (module || 'haccp') + '):', dateStr);
      _safeRefreshAppViews('day save');
      return { ok: true };
    } catch (err) {
      console.error('[Veriqo sync] saveDay failed (' + (module || 'haccp') + '):', err.message || err);
      if (typeof toast === 'function') toast('Sync error — data saved locally, will retry when online', 'err');
      _enqueueRetry({ dateStr: dateStr, records: recordsSnapshot, module: module || 'haccp', userScope: _userId });
      return { ok: false, error: err, queued: true };
    }
  }

  // ── saveSettings ───────────────────────────────────────────────────────────
  // module: 'haccp' (default) → settings table
  //         'menus'            → mise_settings table
  async function saveSettings(settingsObj, module) {
    var settingsModule = module === 'menus' ? 'menus' : 'haccp';
    var configSnapshot;
    try { configSnapshot = JSON.parse(JSON.stringify(settingsObj)); }
    catch(e) { configSnapshot = Object.assign({}, settingsObj); }
    var payload = { module: settingsModule, config: configSnapshot };
    if (!_userId) {
      console.warn('[Veriqo sync] saveSettings skipped — not signed in');
      if (typeof toast === 'function') toast('Sign in to sync — settings are saved on this device', 'err');
      return { ok: false, sessionExpired: true, queued: false };
    }
    try {
      var sessionResult = await supabaseClient.auth.getSession();
      if (sessionResult.error || !sessionResult.data || !sessionResult.data.session) {
        var sessionError = sessionResult.error || new Error('Session expired');
        sessionError.sessionExpired = true;
        throw sessionError;
      }
      var result = await _coreSaveSettings(payload);
      if (!result.ok) throw result.error;
      console.log('[Veriqo sync] ✓ settings saved (' + settingsModule + ')');
      _safeRefreshAppViews('settings save');
      return { ok: true };
    } catch (err) {
      var message = (err && err.message) || String(err);
      var status = err && err.status;
      var code = err && err.code;
      var sessionExpired = !!(err && err.sessionExpired) || status === 401 || code === 'PGRST301' || /jwt|session|token/i.test(message);
      console.error('[Veriqo sync] saveSettings failed (' + settingsModule + '):', code || status || '', message);
      _enqueueEntityRetry('settings', 'save', payload, { idempotencyKey: 'settings:save:' + settingsModule });
      if (typeof toast === 'function') {
        toast(sessionExpired
          ? 'Session expired — sign in again. Settings are saved on this device.'
          : 'Sync issue — settings saved on this device and will retry automatically', 'err');
      }
      return { ok: false, error: err, sessionExpired: sessionExpired, queued: true };
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
  function _isHaccpDayStorageKey(k) {
    return /^haccp_\d{4}-\d{2}-\d{2}$/.test(k || '');
  }

  function _recordArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function setHaccpUser(userId) {
    if (userId === _haccpUser) return;
    _haccpUser = userId;
    _haccpChecked = false;
    _haccpLocalOnly.clear();
    _updateHaccpSyncStatus();
  }

  function _readHaccpPending(userId) {
    if (!userId) return [];
    var prefix = _HACCP_PENDING + userId + '_';
    return Object.keys(localStorage).filter(function(key) {
      return key.indexOf(prefix) === 0;
    }).flatMap(function(key) {
      try { return [Object.assign(JSON.parse(localStorage.getItem(key)), { key: key })]; }
      catch (err) { return []; }
    }).sort(function(a, b) { return a.time - b.time || a.key.localeCompare(b.key); });
  }

  function hasPendingHaccp() {
    return _haccpLocalOnly.size > 0 || _readHaccpPending(_haccpUser).length > 0 ||
      _loadRetryQueue().some(function(item) {
        return item.dateStr && item.module !== 'menus' && item.userScope === _haccpUser;
      });
  }

  function _updateHaccpSyncStatus() {
    var el = document.getElementById('haccp-sync-status');
    if (!el) return;
    var pending = _readHaccpPending(_haccpUser);
    el.textContent = _haccpLocalOnly.size ? 'Some checks are saved on this device only. Keep an export from Records.'
      : pending.length ? 'HACCP changes waiting to sync.'
      : _haccpChecked ? 'HACCP records synced.' : '';
    el.hidden = !el.textContent;
  }

  // JSONB may return an object with keys in a different order.
  function _haccpRecordKey(value) {
    return JSON.stringify(value, function(key, item) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
      return Object.fromEntries(Object.keys(item).sort().map(function(name) {
        return [name, item[name]];
      }));
    });
  }

  function _haccpDifference(records, baseline) {
    var counts = new Map();
    baseline.forEach(function(record) {
      var key = _haccpRecordKey(record);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return records.filter(function(record) {
      var key = _haccpRecordKey(record);
      var count = counts.get(key);
      if (!count) return true;
      counts.set(key, count - 1);
      return false;
    });
  }

  function _applyHaccpChange(records, change) {
    var retained = _haccpDifference(records, change.removed);
    return retained.concat(_haccpDifference(change.added, retained));
  }

  function _saveHaccpPending(userId, id, change) {
    localStorage.setItem(_HACCP_PENDING + userId + '_' + id, JSON.stringify(change));
  }

  function saveHaccpChanges(date, previous, next) {
    var added = _haccpDifference(next, previous);
    var removed = _haccpDifference(previous, next);
    if (!added.length && !removed.length) return true;
    if (_haccpUser) {
      try {
        _haccpPendingTime = Math.max(Date.now(), _haccpPendingTime + 1);
        _saveHaccpPending(_haccpUser, _genId(), { date: date, added: added, removed: removed, time: _haccpPendingTime });
        _updateHaccpSyncStatus();
        _syncHaccp(_haccpUser, false).then(function() {
          _safeRefreshAppViews('HACCP save');
        }).catch(function() {});
        return true;
      } catch (err) {
        console.warn('[Veriqo sync] Could not queue HACCP changes:', err);
      }
    }
    _haccpLocalOnly.add(date);
    _updateHaccpSyncStatus();
    return false;
  }

  function _migrateHaccpRetries(userId) {
    var queue = _loadRetryQueue();
    var retained = queue.filter(function(item) {
      if (item.dateStr === undefined || item.module === 'menus' || item.userScope !== userId) return true;
      try {
        // Old snapshots do not describe deletions. Keep their records without
        // using the snapshot to replace a day from another device.
        _saveHaccpPending(userId, 'legacy_' + item.ts + '_' + item.dateStr, {
          date: item.dateStr, added: _recordArray(item.records), removed: [], time: item.ts
        });
        return false;
      } catch (err) {
        return true;
      }
    });
    if (retained.length !== queue.length) _saveRetryQueue(retained);
  }

  async function _writeHaccpChange(userId, change) {
    for (var attempt = 0; attempt < 3; attempt++) {
      var current = await supabaseClient.from('haccp_records').select('records')
        .eq('user_id', userId).eq('date', change.date).maybeSingle();
      if (current.error) throw current.error;
      var original = current.data ? current.data.records : null;
      var merged = _applyHaccpChange(_recordArray(original), change);
      if (current.data && _haccpRecordKey(original) === _haccpRecordKey(merged)) return merged;
      var result = await supabaseClient.rpc('haccp_compare_and_save_day', {
        p_user_id: userId, p_date: change.date, p_exists: Boolean(current.data),
        p_expected: original, p_records: merged
      });
      if (result.error) throw result.error;
      if (result.data === true) return merged;
    }
    throw new Error('HACCP records changed on another device');
  }

  function _cacheHaccpDay(date, remote, pending) {
    if (_haccpLocalOnly.has(date)) return;
    var merged = pending.filter(function(item) { return item.date === date; })
      .reduce(_applyHaccpChange, _recordArray(remote));
    localStorage.setItem('haccp_' + date, JSON.stringify(merged));
  }

  async function _flushHaccpPending(userId) {
    var blocked = new Set();
    for (var change of _readHaccpPending(userId)) {
      if (userId !== _haccpUser) return;
      if (blocked.has(change.date) || !localStorage.getItem(change.key)) continue;
      try {
        var saved = await _writeHaccpChange(userId, change);
        if (userId !== _haccpUser) return;
        var remaining = _readHaccpPending(userId).filter(function(item) { return item.key !== change.key; });
        _cacheHaccpDay(change.date, saved, remaining);
        localStorage.removeItem(change.key);
        _haccpChecked = true;
      } catch (err) {
        blocked.add(change.date);
        console.warn('[Veriqo sync] HACCP changes still pending:', err.message || err);
      }
    }
  }

  async function _pullHaccpRecords(userId) {
    var result = await supabaseClient.from('haccp_records').select('date, records')
      .eq('user_id', userId).order('date', { ascending: false });
    if (result.error) throw result.error;
    if (!result.data || userId !== _haccpUser) return;
    var pending = _readHaccpPending(userId);
    var remote = new Map(result.data.filter(function(row) {
      return _isHaccpDayStorageKey('haccp_' + row.date);
    }).map(function(row) { return [row.date, row.records]; }));
    var dates = new Set(Array.from(remote.keys()).concat(pending.map(function(item) { return item.date; })));

    // Preserve local-only checks if the queue could not be written.
    Object.keys(localStorage).filter(_isHaccpDayStorageKey).forEach(function(key) {
      var date = key.slice(6);
      if (!dates.has(date) && !_haccpLocalOnly.has(date)) localStorage.removeItem(key);
    });
    dates.forEach(function(date) { _cacheHaccpDay(date, remote.get(date), pending); });
    _haccpChecked = true;
  }

  function _syncHaccp(userId, pull) {
    var work = _haccpWork.then(async function() {
      if (!userId || userId !== _haccpUser) return;
      var session = await supabaseClient.auth.getSession();
      if (session.error || session.data.session?.user.id !== userId) return;
      var sync = async function() {
        if (userId !== _haccpUser) return;
        _migrateHaccpRetries(userId);
        await _flushHaccpPending(userId);
        if (pull) await _pullHaccpRecords(userId);
      };
      if (typeof navigator !== 'undefined' && navigator.locks) {
        await navigator.locks.request('veriqo-haccp-' + userId, sync);
      } else {
        await sync();
      }
    }).finally(_updateHaccpSyncStatus);
    _haccpWork = work.catch(function() {});
    return work;
  }

  function refreshHaccpRecords() {
    if (!_haccpUser) return;
    return _syncHaccp(_haccpUser, true).then(function() {
      _safeRefreshAppViews('HACCP records');
    }).catch(function(err) {
      console.warn('[Veriqo sync] Could not refresh HACCP records:', err.message || err);
    });
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
        // A legacy/partial cloud row may omit newer HACCP fields such as
        // `staff`. Re-run the normal hydrator so defaults are restored before
        // any settings UI or record dropdown reads those lists.
        if (typeof loadHaccpSettings === 'function') loadHaccpSettings();
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
          prepAndPack: meta.prepAndPack || null,
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
    var haccpRecordTab = document.getElementById('tab-records');
    if (haccpRecordTab && haccpRecordTab.classList.contains('active') && typeof renderRecords === 'function') renderRecords();
    if (typeof renderMiseSections === 'function') renderMiseSections();
    if (typeof updateNextJobBanner === 'function') updateNextJobBanner();
    document.dispatchEvent(new CustomEvent('vq:sync-complete'));
  }

  // A renderer failure must never turn a successful database write into a
  // misleading sync error. Refresh is best-effort; the saved data remains the
  // source of truth and the next navigation/reload will render it again.
  function _safeRefreshAppViews(context) {
    try { _refreshAppViews(); }
    catch (err) { console.warn('[Veriqo sync] view refresh failed after ' + context + ':', err && err.message ? err.message : err); }
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
    saveDay, saveSettings, saveHaccpChanges, setHaccpUser, hasPendingHaccp, refreshHaccpRecords,
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
