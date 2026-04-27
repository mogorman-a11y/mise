// mise-sync.js — cloud sync for Mise (mirrors localStorage ↔ Supabase)
// ──────────────────────────────────────────────────────────────────────
// Strategy: localStorage is always the live source of truth.
// Supabase is the cloud backup that persists across devices/browsers.
//
// On sign-in:  pull from Supabase → write into localStorage → app reads normally
// On save:     app writes to localStorage as before → also push to Supabase
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
  // Fetches settings from Supabase and merges into the app's mSettings object.
  async function _pullSettings(userId) {
    var result = await supabaseClient
      .from('mise_settings')
      .select('config')
      .eq('id', userId)
      .single();

    // PGRST116 = row not found — first login, no settings yet, that's fine
    if (result.error && result.error.code !== 'PGRST116') throw result.error;
    if (!result.data || !result.data.config) return;

    // Merge cloud settings into the app's mSettings object
    if (typeof mSettings !== 'undefined') {
      Object.assign(mSettings, result.data.config);
      try {
        localStorage.setItem('mise_settings', JSON.stringify(mSettings));
      } catch (e) {}
      if (typeof loadSettings === 'function') loadSettings();
    }
  }

  return { loadAll, saveDay, saveSettings };

})();
