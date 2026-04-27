// sync.js — cloud sync (Supabase mirrors localStorage)
// ───────────────────────────────────────────────────────
// Strategy: localStorage is always the live source of truth.
// Supabase is the cloud backup that persists across devices/browsers.
//
// On sign-in:  pull from Supabase → write into localStorage → app reads normally
// On save:     app writes to localStorage as before → also push to Supabase
//
// Dish/menu library is shared across the suite: on login this module also
// pulls from mise_settings (Carte) and merges savedDishes + savedMenus so
// both apps always have the combined library without the user entering data twice.

window.Mise = window.Mise || {};
window.Mise.sync = (function () {

  var _userId = null;

  // ── loadAll ────────────────────────────────────────────────────────────────
  async function loadAll(userId) {
    _userId = userId;

    try {
      await Promise.all([
        _pullRecords(userId),
        _pullSettings(userId)
      ]);
    } catch (err) {
      console.warn('[Veriqo] loadAll error — using local data:', err.message);
    }
  }

  // ── saveDay ────────────────────────────────────────────────────────────────
  async function saveDay(dateStr, recordsArray) {
    if (!_userId) return;

    try {
      await supabaseClient.from('haccp_records').upsert({
        user_id: _userId,
        date: dateStr,
        records: recordsArray
      }, { onConflict: 'user_id,date' });
      await _mirrorJobsToCarte(dateStr, recordsArray);
    } catch (err) {
      console.warn('[Veriqo] saveDay error:', err.message);
    }
  }

  // ── saveSettings ───────────────────────────────────────────────────────────
  async function saveSettings(settingsObj) {
    if (!_userId) return;

    try {
      await supabaseClient.from('settings').upsert({
        id: _userId,
        config: settingsObj,
        updated_at: new Date().toISOString()
      });
      await _mirrorSettingsToCarte(settingsObj);
    } catch (err) {
      console.warn('[Veriqo] saveSettings error:', err.message);
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
      var jobs = (row.records || []).filter(function(r){ return r && r.type === 'job'; }).map(function(r){
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
      Object.assign(settings, result.data.config);
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
      }
    }
  }

  async function _mirrorJobsToCarte(dateStr, recordsArray) {
    var jobs = (recordsArray || []).filter(function(r){ return r && r.type === 'job'; });
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
    await supabaseClient.from('mise_records').upsert({
      user_id: _userId,
      date: dateStr,
      records: mRecords
    }, { onConflict: 'user_id,date' });
  }

  async function _mirrorSettingsToCarte(settingsObj) {
    var result = await supabaseClient
      .from('mise_settings')
      .select('config')
      .eq('id', _userId)
      .single();
    var config = (!result.error && result.data && result.data.config) ? result.data.config : {};
    _mergeSuiteData(config, settingsObj, 'carte');
    await supabaseClient.from('mise_settings').upsert({
      id: _userId,
      config: config,
      updated_at: new Date().toISOString()
    });
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

  return { loadAll, saveDay, saveSettings };

})();
