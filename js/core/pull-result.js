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
    root.Veriqo.decidePullOutcome = factory().decidePullOutcome;
  }
})(typeof window !== 'undefined' ? window : this, function () {
  // res: {data, error} — the shape returned by a Supabase client call.
  // Returns {keep:true, error} to leave the cache untouched, or
  // {keep:false, data:[]} with the (possibly empty) array to apply.
  function decidePullOutcome(res) {
    if (res && res.error) return { keep: true, error: res.error };
    return { keep: false, data: (res && res.data) || [] };
  }

  return { decidePullOutcome: decidePullOutcome };
});
