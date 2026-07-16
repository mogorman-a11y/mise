// js/core/ai-other-costs-store.js — job-id-keyed local store for the AI
// Estimate screen's "other direct costs" field.
//
// The AI job record (api/veriqo-job.js's shape) has no column for this —
// persisting it server-side would need a schema + API change. Kept here
// instead so switching between jobs (or reloading one after reconciliation)
// always shows the correct value for the job actually on screen, never a
// blank field or a value left over from a *different* job.
//
// Entries are also scoped by authenticated user id, not just job id: this is
// financial data, so it must not survive to a different account on the same
// device. logout() also removes this key outright (see auth.js's
// _PRIVATE_KEYS) — the per-user scoping is a second, independent guard for
// the case where two accounts are used in the same session without an
// intervening logout. Without a uid, reads/writes are no-ops rather than
// falling back to a shared, unscoped bucket.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.Veriqo = root.Veriqo || {};
    var api = factory();
    root.Veriqo.getStoredOtherCosts = api.getStoredOtherCosts;
    root.Veriqo.setStoredOtherCosts = api.setStoredOtherCosts;
  }
})(typeof window !== 'undefined' ? window : this, function () {
  var KEY = 'vq_ai_other_costs';

  function _storage(explicit) {
    if (explicit) return explicit;
    return typeof localStorage !== 'undefined' ? localStorage : null;
  }

  // Never throws — a corrupted stored value is treated as an empty map so a
  // single bad write can't permanently block all future reads/writes to
  // this key.
  function _readMap(s) {
    try { return JSON.parse(s.getItem(KEY) || '{}'); } catch (e) { return {}; }
  }

  // storage param is injectable for testing (any object with getItem/setItem);
  // defaults to the real localStorage in a browser.
  function getStoredOtherCosts(jobId, uid, storage) {
    if (!uid) return '';
    var s = _storage(storage);
    if (!s) return '';
    var userMap = _readMap(s)[uid];
    return (userMap && userMap[jobId]) || '';
  }

  function setStoredOtherCosts(jobId, uid, poundsStr, storage) {
    if (!uid) return;
    var s = _storage(storage);
    if (!s) return;
    var map = _readMap(s);
    var userMap = map[uid] || {};
    if (poundsStr) userMap[jobId] = poundsStr; else delete userMap[jobId];
    if (Object.keys(userMap).length) map[uid] = userMap; else delete map[uid];
    try { s.setItem(KEY, JSON.stringify(map)); } catch (e) {}
  }

  return { getStoredOtherCosts: getStoredOtherCosts, setStoredOtherCosts: setStoredOtherCosts, KEY: KEY };
});
