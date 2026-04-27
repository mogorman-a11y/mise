// mise-sync.js — cloud sync for Carte (mirrors localStorage ↔ Supabase)
// ──────────────────────────────────────────────────────────────────────
// Strategy: Supabase is the source of truth for multi-device sync.
// localStorage is a write-through cache — cloud data fully replaces it on pull.
//
// On sign-in:  pull from Supabase → REPLACE localStorage → app reads normally
// On save:     push to Supabase → update localStorage
// On tab focus: re-pull from Supabase so open tabs stay current
//
// Dish/menu library is shared across the suite: on login this module also
// pulls from settings (Veriqo) and merges savedDishes + savedMenus so
// both apps always have the combined library without the user entering data twice.
//
// Tables:
//   mise_records  — user_id, date, records (JSON array)
//   mise_settings — id (user_id), config (JSON), updated_at

window.Mise = window.Mise || {};
window.Mise.sync = (function () {

  var _userId = null;
  var _visibilityBound = false;

  // ── loadAll ────────────────────────────────────────────────────────────────
  // Called by auth.js after sign-in. Pulls the user's data from Supabase and
  // replaces localStorage so the rest of the app works with current cloud data.
  async function loadAll(userId) {
    _userId = userId;
    console.log('[Carte sync] loadAll — userId:', userId);

    try {
      await Promise.all([
        _pullRecords(userId),
        _pullSettings(userId)
      ]);
      _refreshAppViews();
      console.log('[Carte sync] ✓ full sync complete');
    } catch (err) {
      console.error('[Carte sync] loadAll error:', err.message || err);
    }

    if (!_visibilityBound) {
      _visibilityBound = true;
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible' && _userId) {
          Promise.all([_pullRecords(_userId), _pullSettings(_userId)])
            .then(_refreshAppViews)
            .catch(function () {});
        }
      });
    }
  }

  // ── saveDay ────────────────────────────────────────────────────────────────
  // Called alongside saveDayRecords(). Upserts the full day's records as a
  // single JSON blob. One row per user per day keeps queries simple.
  async function saveDay(dateStr, recordsArray) {
    if (!_userId) { console.warn('[Carte sync] saveDay skipped — not signed in'); return; }

    try {
      var r = await supabaseClient.from('mise_records').upsert({
        user_id: _userId,
        date: dateStr,
        records: recordsArray
      }, { onConflict: 'user_id,date' });
      if (r.error) throw r.error;
      console.log('[Carte sync] ✓ day saved:', dateStr);
      _mirrorJobsToVeriqo(dateStr, recordsArray).catch(function (e) {
        console.error('[Carte sync] mirror jobs→Veriqo failed:', e.message || e);
      });
      _refreshAppViews();
    } catch (err) {
      console.error('[Carte sync] saveDay failed:', err.message || err);
      if (typeof toast === 'function') toast('Sync error — data saved locally only', 'err');
    }
  }

  // ── saveSettings ───────────────────────────────────────────────────────────
  // Called alongside saveSettings(). Upserts config to Supabase.
  async function saveSettings(settingsObj) {
    if (!_userId) { console.warn('[Carte sync] saveSettings skipped — not signed in'); return; }

    try {
      var r = await supabaseClient.from('mise_settings').upsert({
        id: _userId,
        config: settingsObj,
        updated_at: new Date().toISOString()
      });
      if (r.error) throw r.error;
      console.log('[Carte sync] ✓ settings saved');
      _mirrorSettingsToVeriqo(settingsObj).catch(function (e) {
        console.error('[Carte sync] mirror settings→Veriqo failed:', e.message || e);
      });
      _refreshAppViews();
    } catch (err) {
      console.error('[Carte sync] saveSettings failed:', err.message || err);
      if (typeof toast === 'function') toast('Sync error — settings saved locally only', 'err');
    }
  }

  // ── _pullRecords ───────────────────────────────────────────────────────────
  // Fetches all daily record rows for this user and writes them into localStorage.
  async function _pullRecords(userId) {
    var result = await supabaseClient
      .from('mise_records')
      .select('date, records')
      .eq('user_id', userId)
      .order('date', { ascending: false });

    if (result.error) throw result.error;
    if (!result.data) return;

    // Clear any records left by a previously logged-in user before writing
    // this user's data — prevents data from a different account bleeding through.
    Object.keys(localStorage)
      .filter(function(k){ return k.startsWith('mise_') && k !== 'mise_settings'; })
      .forEach(function(k){ localStorage.removeItem(k); });

    result.data.forEach(function (row) {
      try {
        localStorage.setItem('mise_' + row.date, JSON.stringify(row.records));
      } catch (e) {}
    });

    // Also update the in-memory records array for today
    var today = new Date().toISOString().slice(0, 10);
    var todayRow = result.data.find(function (r) { return r.date === today; });
    if (typeof mRecords !== 'undefined') {
      mRecords.length = 0;
      if (todayRow) todayRow.records.forEach(function (r) { mRecords.push(r); });
    }

    await _pullVeriqoJobs(userId);
  }

  async function _pullVeriqoJobs(userId) {
    var result = await supabaseClient
      .from('haccp_records')
      .select('date, records')
      .eq('user_id', userId)
      .order('date', { ascending: false });
    if (result.error || !result.data) return;
    result.data.forEach(function(row){
      var jobs = (row.records || []).filter(function(r){ return r && r.type === 'job' && r.sourceApp !== 'carte'; }).map(function(r){
        return Object.assign({}, r, { id: String(r.id).indexOf('veriqo_') === 0 ? r.id : 'veriqo_' + r.id, sourceApp: 'veriqo' });
      });
      if (!jobs.length) return;
      var key = 'mise_' + row.date;
      var existing = [];
      try { existing = JSON.parse(localStorage.getItem(key) || '[]'); } catch(e) { existing = []; }
      jobs.forEach(function(job){
        if (!existing.some(function(r){ return r.id === job.id; })) existing.push(job);
      });
      try { localStorage.setItem(key, JSON.stringify(existing)); } catch(e) {}
      if (row.date === new Date().toISOString().slice(0, 10) && typeof mRecords !== 'undefined') {
        mRecords.length = 0;
        existing.forEach(function(r){ mRecords.push(r); });
      }
    });
  }

  // ── _pullSettings ──────────────────────────────────────────────────────────
  // Fetches own settings then cross-pulls the dish/menu library from Veriqo
  // (settings) so the suite shares one library across both apps.
  async function _pullSettings(userId) {
    // Own settings
    var result = await supabaseClient
      .from('mise_settings')
      .select('config')
      .eq('id', userId)
      .single();

    // PGRST116 = row not found — first login, no settings yet, that's fine
    if (result.error && result.error.code !== 'PGRST116') throw result.error;

    if (result.data && result.data.config && typeof mSettings !== 'undefined') {
      var _cloud = result.data.config;
      Object.keys(mSettings).forEach(function (k) { delete mSettings[k]; });
      Object.assign(mSettings, _cloud);
      try { localStorage.setItem('mise_settings', JSON.stringify(mSettings)); } catch (e) {}
      if (typeof loadSettings === 'function') loadSettings();
    }

    // Cross-pull dish/menu library from Veriqo (settings)
    var veriqoResult = await supabaseClient
      .from('settings')
      .select('config')
      .eq('id', userId)
      .single();

    if (!veriqoResult.error && veriqoResult.data && veriqoResult.data.config) {
      if (typeof mSettings !== 'undefined') {
        _mergeSuiteData(mSettings, veriqoResult.data.config, 'carte');
        try { localStorage.setItem('mise_settings', JSON.stringify(mSettings)); } catch (e) {}
        var sr = await supabaseClient.from('mise_settings').upsert({
          id: userId,
          config: mSettings,
          updated_at: new Date().toISOString()
        });
        if (sr.error) console.error('[Carte sync] settings upsert after cross-pull failed:', sr.error.message);
        else console.log('[Carte sync] ✓ cross-pull merged and saved');
      }
    } else {
      console.log('[Carte sync] no Veriqo settings to cross-pull (code:', veriqoResult.error && veriqoResult.error.code, ')');
    }
  }

  async function _mirrorJobsToVeriqo(dateStr, recordsArray) {
    var jobs = (recordsArray || []).filter(function(r){ return r && r.type === 'job'; });
    jobs = jobs.filter(function(r){ return r.sourceApp !== 'veriqo'; });
    if (!jobs.length) return;
    var result = await supabaseClient
      .from('haccp_records')
      .select('records')
      .eq('user_id', _userId)
      .eq('date', dateStr)
      .single();
    var hRecords = (!result.error && result.data && Array.isArray(result.data.records)) ? result.data.records : [];
    jobs.forEach(function(job){
      var mirrorId = 'mise_' + job.id;
      if (!hRecords.some(function(r){ return r.id === mirrorId; })) {
        hRecords.push(Object.assign({}, job, { id: mirrorId, sourceApp: 'carte' }));
      }
    });
    var wr = await supabaseClient.from('haccp_records').upsert({
      user_id: _userId,
      date: dateStr,
      records: hRecords
    }, { onConflict: 'user_id,date' });
    if (wr.error) console.error('[Carte] mirror jobs→Veriqo failed:', wr.error.message);
  }

  async function _mirrorSettingsToVeriqo(settingsObj) {
    var result = await supabaseClient
      .from('settings')
      .select('config')
      .eq('id', _userId)
      .single();
    var config = (!result.error && result.data && result.data.config) ? result.data.config : {};
    _mergeSuiteData(config, settingsObj, 'veriqo');
    var wr = await supabaseClient.from('settings').upsert({
      id: _userId,
      config: config,
      updated_at: new Date().toISOString()
    });
    if (wr.error) console.error('[Carte sync] mirror settings→Veriqo failed:', wr.error.message);
    else console.log('[Carte sync] ✓ mirrored settings→Veriqo');
  }

  // Merges suite data between app-specific settings shapes.
  function _mergeSuiteData(target, source, targetApp) {
    if (!source) return;
    if (targetApp === 'carte') {
      _mergeClients(target, source.savedCustomers, 'savedClients');
      _mergeCredentials(target, source.credentials, 'credentials', 'carte');
      _mergeDishes(target, source.savedDishes);
      _mergeMenusIntoCarte(target, source);
    } else {
      _mergeClients(target, source.savedClients, 'savedCustomers');
      _mergeCredentials(target, source.credentials, 'credentials', 'veriqo');
      _mergeDishes(target, source.savedDishes);
      _mergeMenusIntoVeriqo(target, source);
    }
  }

  function _mergeDishes(target, sourceList) {
    if (sourceList && sourceList.length) {
      if (!target.savedDishes) target.savedDishes = [];
      sourceList.forEach(function (d) {
        var name = d.dish || d.name || '';
        if (!name) return;
        var exists = target.savedDishes.some(function (e) {
          return (e.dish || e.name || '').toLowerCase() === name.toLowerCase();
        });
        if (!exists) target.savedDishes.push(Object.assign({}, d, { dish: name, allergens: _normaliseAllergens(d.allergens) }));
      });
    }
  }

  function _mergeMenusIntoCarte(target, source) {
    if (!source.savedMenus || !source.savedMenus.length) return;
    if (!target.savedMenus) target.savedMenus = [];
    if (!target.savedDishes) target.savedDishes = [];
    source.savedMenus.forEach(function(m){
      if (!m.name) return;
      var exists = target.savedMenus.some(function(e){ return e.name && e.name.toLowerCase() === m.name.toLowerCase(); });
      if (exists) return;
      var dishIds = [];
      (m.dishes || []).forEach(function(d){
        var name = d.dish || d.name || '';
        if (!name) return;
        var found = target.savedDishes.find(function(td){ return (td.dish || '').toLowerCase() === name.toLowerCase(); });
        if (!found) {
          found = { id: 'shared_' + Date.now() + '_' + Math.random().toString(36).slice(2), dish: name, category: d.category || '', allergens: _normaliseAllergens(d.allergens) };
          target.savedDishes.push(found);
        }
        dishIds.push(found.id);
      });
      target.savedMenus.push({ id: m.id || ('shared_menu_' + Date.now()), name: m.name, dishIds: dishIds });
    });
  }

  function _mergeMenusIntoVeriqo(target, source) {
    if (!source.savedMenus || !source.savedMenus.length) return;
    if (!target.savedMenus) target.savedMenus = [];
    var dishMap = {};
    (source.savedDishes || []).forEach(function(d){ dishMap[d.id] = d; });
    source.savedMenus.forEach(function(m){
      if (!m.name) return;
      var exists = target.savedMenus.some(function(e){ return e.name && e.name.toLowerCase() === m.name.toLowerCase(); });
      if (exists) return;
      var dishes = (m.dishIds || []).map(function(id){ return dishMap[id]; }).filter(Boolean).map(function(d){
        return { dish: d.dish || d.name || '', category: d.category || '', allergens: _normaliseAllergens(d.allergens) };
      });
      target.savedMenus.push({ id: m.id || ('shared_menu_' + Date.now()), name: m.name, dishes: dishes });
    });
  }

  function _mergeClients(target, sourceList, targetKey) {
    if (!sourceList || !sourceList.length) return;
    if (!target[targetKey]) target[targetKey] = [];
    sourceList.forEach(function(c){
      var name = c.name || c.client || '';
      if (!name) return;
      var exists = target[targetKey].some(function(e){ return (e.name || '').toLowerCase() === name.toLowerCase(); });
      if (!exists) target[targetKey].push({
        id: c.id || ('shared_client_' + Date.now() + '_' + Math.random().toString(36).slice(2)),
        name: name,
        address: c.address || c.location || '',
        phone: c.phone || '',
        email: c.email || '',
        diet: c.diet || c.preferences || ''
      });
    });
  }

  function _mergeCredentials(target, sourceList, targetKey, targetApp) {
    if (!sourceList || !sourceList.length) return;
    if (!target[targetKey]) target[targetKey] = [];
    sourceList.forEach(function(c){
      var name = c.name || c.credType || '';
      var expiry = c.expiry || '';
      if (!name) return;
      var exists = target[targetKey].some(function(e){ return (e.name || e.credType || '') === name && (e.expiry || '') === expiry; });
      var merged = Object.assign({}, c, { id: c.id || ('shared_cred_' + Date.now() + '_' + Math.random().toString(36).slice(2)) });
      if (targetApp === 'veriqo') merged.credType = merged.credType || name;
      else merged.name = merged.name || name;
      if (!exists) target[targetKey].push(merged);
    });
  }

  function _normaliseAllergens(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (!value) return [];
    return String(value).split(',').map(function(a){ return a.trim(); }).filter(Boolean);
  }

  function _refreshAppViews() {
    if (typeof loadSettings === 'function') loadSettings();
    if (typeof loadToday === 'function') loadToday();
    if (typeof populateAllSelects === 'function') populateAllSelects();
    if (typeof renderDishLibrary === 'function') renderDishLibrary();
    if (typeof renderMenuDishSelect === 'function') renderMenuDishSelect();
    if (typeof renderSavedMenus === 'function') renderSavedMenus();
    if (typeof renderCalendar === 'function') renderCalendar();
    if (typeof updateDashboard === 'function') updateDashboard();
    if (typeof renderJobsHistory === 'function') renderJobsHistory();
  }

  // Deletes a menu/dish from Veriqo's settings so cross-pull doesn't resurrect it.
  async function deleteSuiteMenu(menuId) {
    if (!_userId) return;
    var result = await supabaseClient.from('settings').select('config').eq('id', _userId).single();
    if (result.error || !result.data || !result.data.config) return;
    var config = result.data.config;
    if (!config.savedMenus) return;
    var before = config.savedMenus.length;
    config.savedMenus = config.savedMenus.filter(function(m) { return m.id !== menuId; });
    if (config.savedMenus.length === before) return;
    await supabaseClient.from('settings').upsert({ id: _userId, config: config, updated_at: new Date().toISOString() });
  }

  async function deleteSuiteDish(dishId) {
    if (!_userId) return;
    var result = await supabaseClient.from('settings').select('config').eq('id', _userId).single();
    if (result.error || !result.data || !result.data.config) return;
    var config = result.data.config;
    if (!config.savedDishes) return;
    var before = config.savedDishes.length;
    config.savedDishes = config.savedDishes.filter(function(d) { return d.id !== dishId; });
    if (config.savedDishes.length === before) return;
    await supabaseClient.from('settings').upsert({ id: _userId, config: config, updated_at: new Date().toISOString() });
  }

  return { loadAll, saveDay, saveSettings, deleteSuiteMenu, deleteSuiteDish };

})();
