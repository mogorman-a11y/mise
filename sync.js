// sync.js — cloud sync (replaces localStorage with Supabase)
// ───────────────────────────────────────────────────────────
// In Step 3 the app's saveToday() and loadToday() functions will be
// supplemented with Supabase calls. Until then this file is a no-op
// and the app continues to use localStorage as normal.
//
// Falls back to localStorage automatically if the user is offline.
//
// Exposes via window.Mise.sync:
//   loadAll(userId)        — load today's records + settings from Supabase
//   saveRecord(record)     — insert one record into haccp_records
//   saveSettings(config)   — upsert settings object into settings table
//   loadSettings(userId)   — fetch settings from settings table

window.Mise = window.Mise || {};
window.Mise.sync = (function () {

  let _userId = null;

  // ── loadAll ────────────────────────────────────────────────────────────────
  // Called after sign-in. Hydrates the app's in-memory state from Supabase.
  async function loadAll(userId) {
    _userId = userId;

    // TODO (Step 3): load today's records
    // const today = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'
    // const { data: rows } = await supabaseClient
    //   .from('haccp_records')
    //   .select('data, status')
    //   .eq('user_id', userId)
    //   .gte('recorded_at', today + 'T00:00:00Z')
    //   .order('recorded_at', { ascending: true });
    // records = rows ? rows.map(r => r.data) : [];

    // TODO (Step 3): load settings
    // await loadSettings(userId);
  }

  // ── saveRecord ─────────────────────────────────────────────────────────────
  // Called alongside the existing saveToday() so a copy is sent to Supabase.
  async function saveRecord(record) {
    if (!_userId) return; // not signed in — localStorage handles it

    // TODO (Step 3): insert into haccp_records
    // const { error } = await supabaseClient.from('haccp_records').insert({
    //   user_id: _userId,
    //   record_type: record.type,
    //   recorded_at: new Date().toISOString(),
    //   data: record,
    //   status: record.status
    // });
    // if (error) console.warn('[Mise] Sync error:', error.message);
  }

  // ── saveSettings ───────────────────────────────────────────────────────────
  async function saveSettings(settingsObj) {
    if (!_userId) return;

    // TODO (Step 3): upsert into settings table
    // await supabaseClient.from('settings').upsert({
    //   id: _userId,
    //   config: settingsObj,
    //   updated_at: new Date().toISOString()
    // });
  }

  // ── loadSettings ───────────────────────────────────────────────────────────
  async function loadSettings(userId) {
    // TODO (Step 3): fetch config and merge into app's settings object
    // const { data } = await supabaseClient
    //   .from('settings')
    //   .select('config')
    //   .eq('id', userId)
    //   .single();
    // if (data?.config) Object.assign(settings, data.config);
  }

  return { loadAll, saveRecord, saveSettings, loadSettings };

})();
