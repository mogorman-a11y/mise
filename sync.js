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
        _mergeLibrary(settings, carteResult.data.config);
        try { localStorage.setItem('haccp_settings', JSON.stringify(settings)); } catch (e) {}
      }
    }
  }

  // ── _mergeLibrary ──────────────────────────────────────────────────────────
  // Merges savedDishes and savedMenus from another app's config into target,
  // deduplicating by name (case-insensitive) so own entries always win.
  function _mergeLibrary(target, source) {
    if (source.savedDishes && source.savedDishes.length) {
      if (!target.savedDishes) target.savedDishes = [];
      source.savedDishes.forEach(function (d) {
        var exists = target.savedDishes.some(function (e) {
          return e.dish.toLowerCase() === d.dish.toLowerCase();
        });
        if (!exists) target.savedDishes.push(d);
      });
    }
    if (source.savedMenus && source.savedMenus.length) {
      if (!target.savedMenus) target.savedMenus = [];
      source.savedMenus.forEach(function (m) {
        var exists = target.savedMenus.some(function (e) {
          return e.name.toLowerCase() === m.name.toLowerCase();
        });
        if (!exists) target.savedMenus.push(m);
      });
    }
  }

  return { loadAll, saveDay, saveSettings };

})();
