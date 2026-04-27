// mise-sync.js — cloud sync for Carte (mirrors localStorage ↔ Supabase)
// ──────────────────────────────────────────────────────────────────────
// Strategy: localStorage is always the live source of truth.
// Supabase is the cloud backup that persists across devices/browsers.
//
// On sign-in:  pull from Supabase → write into localStorage → app reads normally
// On save:     app writes to localStorage as before → also push to Supabase
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

  // ── loadAll ────────────────────────────────────────────────────────────────
  // Called by auth.js after sign-in. Pulls the user's data from Supabase and
  // writes it into localStorage so the rest of the app works unchanged.
  async function loadAll(userId) {
    _userId = userId;

    try {
      await Promise.all([
        _pullRecords(userId),
        _pullSettings(userId)
      ]);
    } catch (err) {
      console.warn('[Mise] loadAll error — using local data:', err.message);
    }
  }

  // ── saveDay ────────────────────────────────────────────────────────────────
  // Called alongside saveDayRecords(). Upserts the full day's records as a
  // single JSON blob. One row per user per day keeps queries simple.
  async function saveDay(dateStr, recordsArray) {
    if (!_userId) return;

    try {
      await supabaseClient.from('mise_records').upsert({
        user_id: _userId,
        date: dateStr,
        records: recordsArray
      }, { onConflict: 'user_id,date' });
    } catch (err) {
      console.warn('[Mise] saveDay error:', err.message);
    }
  }

  // ── saveSettings ───────────────────────────────────────────────────────────
  // Called alongside saveSettings(). Upserts config to Supabase.
  async function saveSettings(settingsObj) {
    if (!_userId) return;

    try {
      await supabaseClient.from('mise_settings').upsert({
        id: _userId,
        config: settingsObj,
        updated_at: new Date().toISOString()
      });
    } catch (err) {
      console.warn('[Mise] saveSettings error:', err.message);
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
      Object.assign(mSettings, result.data.config);
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
        _mergeLibrary(mSettings, veriqoResult.data.config);
        try { localStorage.setItem('mise_settings', JSON.stringify(mSettings)); } catch (e) {}
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
