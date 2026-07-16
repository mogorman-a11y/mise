// js/core/pull-result.js — shared decision rule for applying a Supabase
// select result to a local cache.
//
// Distinguishes three cases that were previously conflated (only `res.data`
// was ever checked, never `res.error`):
//   1. success with rows   → replace cache with the rows
//   2. success with []     → clear cache (a genuinely-empty result is real
//                             data, not "nothing happened")
//   3. error                → keep whatever is already cached; an error must
//                             never be treated as "no data" and silently
//                             wipe a good local cache
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.Veriqo = root.Veriqo || {};
    var api = factory();
    root.Veriqo.decidePullOutcome = api.decidePullOutcome;
    root.Veriqo.mergeUnsyncedRecords = api.mergeUnsyncedRecords;
  }
})(typeof window !== 'undefined' ? window : this, function () {
  // res: {data, error} — the shape returned by a Supabase client call.
  // Returns {keep:true, error} to leave the cache untouched, or
  // {keep:false, data:[]} with the (possibly empty) array to apply.
  function decidePullOutcome(res) {
    if (res && res.error) return { keep: true, error: res.error };
    return { keep: false, data: (res && res.data) || [] };
  }

  // Merges a cloud-sourced record set with records that are locally saved
  // but not yet confirmed on the server (e.g. sitting in an offline retry
  // queue). Without this, a successful pull that replaces the cache wholesale
  // would silently discard a record the server genuinely doesn't have yet —
  // that's not staleness, it's data the pull just hasn't caught up to.
  // Unsynced wins over cloud for the same id; unsynced-only records are
  // appended. Both inputs and the result use plain objects with `id` and
  // `createdAt` fields; result is sorted by createdAt descending.
  function mergeUnsyncedRecords(cloudRecords, unsyncedRecords) {
    var byId = {};
    (cloudRecords || []).forEach(function (r) { byId[r.id] = r; });
    (unsyncedRecords || []).forEach(function (r) { byId[r.id] = r; });
    return Object.keys(byId).map(function (id) { return byId[id]; })
      .sort(function (a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
  }

  return { decidePullOutcome: decidePullOutcome, mergeUnsyncedRecords: mergeUnsyncedRecords };
});
