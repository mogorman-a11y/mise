// sync.js — cloud sync (Supabase mirrors localStorage)
// ───────────────────────────────────────────────────────
// Strategy: Supabase is the source of truth for multi-device sync.
// localStorage is a write-through cache — cloud data fully replaces it on pull.
//
// On sign-in:  pull from Supabase → REPLACE localStorage → app reads normally
// On save:     push to Supabase → update localStorage
// On tab focus: re-pull from Supabase so open tabs stay current
//
// Dish/menu library is shared across the suite: on login this module also
// pulls from mise_settings (Carte) and merges savedDishes + savedMenus so
// both apps always have the combined library without the user entering data twice.

window.Mise = window.Mise || {};
window.Mise.sync = (function () {

  var _userId = null;
  var _visibilityBound = false;

  // ── loadAll ────────────────────────────────────────────────────────────────
  async function loadAll(userId) {
    _userId = userId;
    console.log('[Veriqo sync] loadAll — userId:', userId);

    try {
      await Promise.all([
        _pullRecords(userId),
        _pullSettings(userId)
      ]);
      _refreshAppViews();
      console.log('[Veriqo sync] ✓ full sync complete');
    } catch (err) {
      console.error('[Veriqo sync] loadAll error:', err.message || err);
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
  async function saveDay(dateStr, recordsArray) {
    if (!_userId) { console.warn('[Veriqo sync] saveDay skipped — not signed in'); return; }

    try {
      var r = await supabaseClient.from('haccp_records').upsert({
        user_id: _userId,
        date: dateStr,
        records: recordsArray
      }, { onConflict: 'user_id,date' });
      if (r.error) throw r.error;
      console.log('[Veriqo sync] ✓ day saved:', dateStr);
      _mirrorJobsToCarte(dateStr, recordsArray).catch(function (e) {
        console.error('[Veriqo sync] mirror jobs→Carte failed:', e.message || e);
      });
      _refreshAppViews();
    } catch (err) {
      console.error('[Veriqo sync] saveDay failed:', err.message || err);
      if (typeof toast === 'function') toast('Sync error — data saved locally only', 'err');
    }
  }

  // ── saveSettings ───────────────────────────────────────────────────────────
  async function saveSettings(settingsObj) {
    if (!_userId) { console.warn('[Veriqo sync] saveSettings skipped — not signed in'); return; }

    try {
      var r = await supabaseClient.from('settings').upsert({
        id: _userId,
        config: settingsObj,
        updated_at: new Date().toISOString()
      });
      if (r.error) throw r.error;
      console.log('[Veriqo sync] ✓ settings saved');
      _mirrorSettingsToCarte(settingsObj).catch(function (e) {
        console.error('[Veriqo sync] mirror settings→Carte failed:', e.message || e);
      });
      _refreshAppViews();
    } catch (err) {
      console.error('[Veriqo sync] saveSettings failed:', err.message || err);
      if (typeof toast === 'function') toast('Sync error — settings saved locally only', 'err');
    }
  }

  // ── _pullRecords ───────────────────────────────────────────────────────────
  async function _pullRecords(userId) {
    var result = await supabaseClient
      .from('haccp_records')
      .select('date, records')
      .eq('user_id', userId)
      .order('date', { ascending: false });

    if (result.error) throw result.error;
    if (!result.data) return;

    Object.keys(localStorage)
      .filter(function (k) {
        return k.startsWith('haccp_') && k !== 'haccp_settings' && k !== 'haccp_credentials' && k !== 'haccp_suppliers';
      })
      .forEach(function (k) { localStorage.removeItem(k); });

    result.data.forEach(function (row) {
      try {
        localStorage.setItem('haccp_' + row.date, JSON.stringify(row.records));
      } catch (e) {}
    });

    var today = new Date().toISOString().slice(0, 10);
    var todayRow = result.data.find(function (r) { return r.date === today; });
    if (typeof records !== 'undefined') {
      records.length = 0;
      if (todayRow) todayRow.records.forEach(function (r) { records.push(r); });
    }

    await _pullCarteJobs(userId);
  }

  async function _pullCarteJobs(userId) {
    var result = await supabaseClient
      .from('mise_records')
      .select('date, records')
      .eq('user_id', userId)
      .order('date', { ascending: false });
    if (result.error || !result.data) return;
    result.data.forEach(function(row){
      var jobs = (row.records || []).filter(function(r){ return r && r.type === 'job' && r.sourceApp !== 'veriqo'; }).map(function(r){
        return Object.assign({}, r, { id: String(r.id).indexOf('mise_') === 0 ? r.id : 'mise_' + r.id, sourceApp: 'carte' });
      });
      if (!jobs.length) return;
      var key = 'haccp_' + row.date;
      var existing = [];
      try { existing = JSON.parse(localStorage.getItem(key) || '[]'); } catch(e) { existing = []; }
      jobs.forEach(function(job){
        if (!existing.some(function(r){ return r.id === job.id; })) existing.push(job);
      });
      try { localStorage.setItem(key, JSON.stringify(existing)); } catch(e) {}
      if (row.date === new Date().toISOString().slice(0, 10) && typeof records !== 'undefined') {
        records.length = 0;
        existing.forEach(function(r){ records.push(r); });
      }
    });
  }

  // ── _pullSettings ──────────────────────────────────────────────────────────
  // Fetches own settings then cross-pulls the dish/menu library from Carte
  // (mise_settings) so the suite shares one library across both apps.
  async function _pullSettings(userId) {
    // Own settings
    var result = await supabaseClient
      .from('settings')
      .select('config')
      .eq('id', userId)
      .single();

    if (result.error && result.error.code !== 'PGRST116') throw result.error;

    if (result.data && result.data.config && typeof settings !== 'undefined') {
      var _cloud = result.data.config;
      Object.keys(settings).forEach(function (k) { delete settings[k]; });
      Object.assign(settings, _cloud);
      try { localStorage.setItem('haccp_settings', JSON.stringify(settings)); } catch (e) {}
      if (typeof loadSettings === 'function') loadSettings();
    }

    // Cross-pull dish/menu library from Carte (mise_settings)
    var carteResult = await supabaseClient
      .from('mise_settings')
      .select('config')
      .eq('id', userId)
      .single();

    if (!carteResult.error && carteResult.data && carteResult.data.config) {
      if (typeof settings !== 'undefined') {
        _mergeSuiteData(settings, carteResult.data.config, 'veriqo');
        try { localStorage.setItem('haccp_settings', JSON.stringify(settings)); } catch (e) {}
        if (settings.credentials) {
          try { localStorage.setItem('haccp_credentials', JSON.stringify(settings.credentials)); } catch (e) {}
        }
        var sr = await supabaseClient.from('settings').upsert({
          id: userId,
          config: settings,
          updated_at: new Date().toISOString()
        });
        if (sr.error) console.error('[Veriqo sync] settings upsert after cross-pull failed:', sr.error.message);
        else console.log('[Veriqo sync] ✓ cross-pull merged and saved');
        _mirrorSettingsToCarte(settings).catch(function (e) {
          console.error('[Veriqo sync] mirror→Carte (on load) failed:', e.message || e);
        });
      }
    }
  }

  async function _mirrorJobsToCarte(dateStr, recordsArray) {
    var jobs = (recordsArray || []).filter(function(r){ return r && r.type === 'job'; });
    jobs = jobs.filter(function(r){ return r.sourceApp !== 'carte'; });
    if (!jobs.length) return;
    var result = await supabaseClient
      .from('mise_records')
      .select('records')
      .eq('user_id', _userId)
      .eq('date', dateStr)
      .single();
    var mRecords = (!result.error && result.data && Array.isArray(result.data.records)) ? result.data.records : [];
    jobs.forEach(function(job){
      var mirrorId = 'veriqo_' + job.id;
      if (!mRecords.some(function(r){ return r.id === mirrorId; })) {
        mRecords.push(Object.assign({}, job, { id: mirrorId, sourceApp: 'veriqo' }));
      }
    });
    var wr = await supabaseClient.from('mise_records').upsert({
      user_id: _userId,
      date: dateStr,
      records: mRecords
    }, { onConflict: 'user_id,date' });
    if (wr.error) console.error('[Veriqo] mirror jobs→Carte failed:', wr.error.message);
  }

  async function _mirrorSettingsToCarte(settingsObj) {
    var result = await supabaseClient
      .from('mise_settings')
      .select('config')
      .eq('id', _userId)
      .single();
    var config = (!result.error && result.data && result.data.config) ? result.data.config : {};
    _mergeSuiteData(config, settingsObj, 'carte');
    var wr = await supabaseClient.from('mise_settings').upsert({
      id: _userId,
      config: config,
      updated_at: new Date().toISOString()
    });
    if (wr.error) console.error('[Veriqo sync] mirror settings→Carte failed:', wr.error.message);
    else console.log('[Veriqo sync] ✓ mirrored settings→Carte');
  }

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
    if (typeof renderMenuLibrary === 'function') renderMenuLibrary();
    if (typeof renderDishLibrary === 'function') renderDishLibrary();
    if (typeof renderSavedMenus === 'function') renderSavedMenus();
    if (typeof renderCalendar === 'function') renderCalendar();
    if (typeof updateDashboard === 'function') updateDashboard();
    if (typeof renderAllSections === 'function') renderAllSections();
  }

  return { loadAll, saveDay, saveSettings };

})();
