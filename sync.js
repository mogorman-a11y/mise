// sync.js — cloud sync (Supabase mirrors localStorage)
// ───────────────────────────────────────────────────────
// Strategy: localStorage is always the live source of truth.
// Supabase is the cloud backup that persists across devices/browsers.
//
// On sign-in:  pull from Supabase → write into localStorage → app reads normally
// On save:     app writes to localStorage as before → also push to Supabase
//
// This means the app is 100% functional offline. Supabase calls are fire-and-
// forget — if they fail (e.g. offline), the record is still in localStorage
// and will be pushed next time loadAll() runs.

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
  // Called alongside the existing saveToday(). Upserts the full day's records
  // as a single JSON blob. One row per user per day keeps queries simple.
  async function saveDay(dateStr, recordsArray) {
    if (!_userId) return;

    try {
      await supabaseClient.from('haccp_records').upsert({
        user_id: _userId,
        date: dateStr,
        records: recordsArray
      }, { onConflict: 'user_id,date' });
    } catch (err) {
      console.warn('[Mise] saveDay error:', err.message);
    }
  }

  // ── saveSettings ───────────────────────────────────────────────────────────
  // Called alongside the existing saveSettings(). Upserts config to Supabase.
  async function saveSettings(settingsObj) {
    if (!_userId) return;

    try {
      await supabaseClient.from('settings').upsert({
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
      .from('haccp_records')
      .select('date, records')
      .eq('user_id', userId)
      .order('date', { ascending: false });

    if (result.error) throw result.error;
    if (!result.data) return;

    result.data.forEach(function (row) {
      // Write each day into localStorage — app reads it with getDayRecords()
      try {
        localStorage.setItem('haccp_' + row.date, JSON.stringify(row.records));
      } catch (e) {}
    });

    // Also update the in-memory records array for today
    var today = new Date().toISOString().slice(0, 10);
    var todayRow = result.data.find(function (r) { return r.date === today; });
    if (typeof records !== 'undefined') {
      records.length = 0;
      if (todayRow) todayRow.records.forEach(function (r) { records.push(r); });
    }
  }

  // ── _pullSettings ──────────────────────────────────────────────────────────
  // Fetches settings from Supabase and merges into the app's settings object.
  async function _pullSettings(userId) {
    var result = await supabaseClient
      .from('settings')
      .select('config')
      .eq('id', userId)
      .single();

    // PGRST116 = row not found — first login, no settings yet, that's fine
    if (result.error && result.error.code !== 'PGRST116') throw result.error;
    if (!result.data || !result.data.config) return;

    // Merge cloud settings into the app's settings object
    if (typeof settings !== 'undefined') {
      Object.assign(settings, result.data.config);
      // Write back to localStorage too
      try {
        localStorage.setItem('haccp_settings', JSON.stringify(settings));
      } catch (e) {}
      // Re-run the app's own settings post-processing
      if (typeof loadSettings === 'function') loadSettings();
    }
  }

  return { loadAll, saveDay, saveSettings };

})();
