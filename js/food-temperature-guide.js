// js/food-temperature-guide.js
// Client-side filter/search for the reference table on
// /food-temperature-guide-uk. Progressive enhancement only: the full table
// is rendered in HTML and remains complete and readable with JS disabled.
//
// PRIVACY: no network calls, no analytics, no storage. Search terms never
// leave the browser. Do not add any of those.
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Veriqo = root.Veriqo || {};
    root.Veriqo.foodTempGuide = api;
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { api._initDom(document); });
    } else {
      api._initDom(document);
    }
  }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  // row:    { category: 'cooking', text: 'full row text', keywords: 'extra terms' }
  // filter: { category: 'all' | 'cooking' | ..., query: 'probe poultry' }
  // Returns true when the row should be visible.
  function rowMatches(row, filter) {
    row = row || {};
    filter = filter || {};
    var cat = String(filter.category || 'all').trim().toLowerCase();
    if (cat && cat !== 'all' && String(row.category || '').trim().toLowerCase() !== cat) {
      return false;
    }
    var q = String(filter.query || '').trim().toLowerCase();
    if (!q) return true;
    var haystack = (String(row.text || '') + ' ' + String(row.keywords || '')).toLowerCase();
    return q.split(/\s+/).every(function (term) {
      return term === '' || haystack.indexOf(term) !== -1;
    });
  }

  function filterRows(rows, filter) {
    return (rows || []).filter(function (r) { return rowMatches(r, filter); });
  }

  function _initDom(doc) {
    var table = doc.getElementById('ftg-table');
    if (!table) return;

    var rows = Array.prototype.slice.call(table.querySelectorAll('tbody tr'));
    var buttons = Array.prototype.slice.call(doc.querySelectorAll('[data-ftg-cat]'));
    var search = doc.getElementById('ftg-search');
    var status = doc.getElementById('ftg-status');
    var bar = doc.getElementById('ftg-filter-bar');
    var emptyMsg = doc.getElementById('ftg-empty');

    if (bar) bar.hidden = false; // revealed only when JS is available

    var state = { category: 'all', query: '' };

    function apply() {
      var shown = 0;
      rows.forEach(function (tr) {
        var ok = rowMatches({
          category: tr.getAttribute('data-category'),
          text: tr.textContent,
          keywords: tr.getAttribute('data-keywords')
        }, state);
        tr.hidden = !ok;
        if (ok) shown++;
      });
      if (status) {
        status.textContent = shown === rows.length
          ? 'Showing all ' + rows.length + ' entries'
          : 'Showing ' + shown + ' of ' + rows.length + ' entries';
      }
      if (emptyMsg) emptyMsg.hidden = shown !== 0;
    }

    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.category = btn.getAttribute('data-ftg-cat') || 'all';
        buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
        apply();
      });
    });

    if (search) {
      search.addEventListener('input', function () {
        state.query = search.value;
        apply();
      });
    }

    apply();
  }

  return { rowMatches: rowMatches, filterRows: filterRows, _initDom: _initDom };
});
