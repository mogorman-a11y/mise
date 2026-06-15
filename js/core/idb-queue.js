// js/core/idb-queue.js v1
// IndexedDB-backed sync queue — replaces localStorage for vq_sync_queue.
// IndexedDB is not subject to iOS Safari storage eviction, so queued HACCP
// records survive low-storage conditions that would wipe localStorage.

window.Mise = window.Mise || {};
window.Mise.idbQueue = (function () {

  var DB_NAME    = 'veriqo-sync';
  var DB_VERSION = 1;
  var STORE      = 'queue';
  var _db        = null;

  function _open() {
    if (_db) return Promise.resolve(_db);
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        e.target.result.createObjectStore(STORE);
      };
      req.onsuccess = function (e) {
        _db = e.target.result;
        resolve(_db);
      };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }

  function get() {
    return _open().then(function (db) {
      return new Promise(function (resolve) {
        var tx  = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).get('queue');
        req.onsuccess = function () { resolve(Array.isArray(req.result) ? req.result : []); };
        req.onerror   = function () { resolve([]); };
      });
    }).catch(function () { return []; });
  }

  function set(arr) {
    return _open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx  = db.transaction(STORE, 'readwrite');
        var req = tx.objectStore(STORE).put(arr, 'queue');
        req.onsuccess = function () { resolve(); };
        req.onerror   = function (e) { reject(e.target.error); };
      });
    }).catch(function () {});
  }

  // On first run, migrate any items still in localStorage queue into IDB.
  function migrate() {
    try {
      var ls = JSON.parse(localStorage.getItem('vq_sync_queue') || '[]');
      if (!ls.length) return Promise.resolve();
      return get().then(function (existing) {
        var merged = existing.slice();
        ls.forEach(function (entry) {
          var dup = merged.some(function (e) {
            return e.dateStr === entry.dateStr && e.module === entry.module;
          });
          if (!dup) merged.push(entry);
        });
        return set(merged);
      }).then(function () {
        localStorage.removeItem('vq_sync_queue');
        console.log('[idbQueue] migrated', ls.length, 'item(s) from localStorage');
      });
    } catch (e) { return Promise.resolve(); }
  }

  // Separate queue key for costing/yield writes (quotes, invoices, payments, costings)
  function getCosting() {
    return _open().then(function (db) {
      return new Promise(function (resolve) {
        var tx  = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).get('costing-queue');
        req.onsuccess = function () { resolve(Array.isArray(req.result) ? req.result : []); };
        req.onerror   = function () { resolve([]); };
      });
    }).catch(function () { return []; });
  }

  function setCosting(arr) {
    return _open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx  = db.transaction(STORE, 'readwrite');
        var req = tx.objectStore(STORE).put(arr, 'costing-queue');
        req.onsuccess = function () { resolve(); };
        req.onerror   = function (e) { reject(e.target.error); };
      });
    }).catch(function () {});
  }

  return { get, set, migrate, getCosting, setCosting };

})();
