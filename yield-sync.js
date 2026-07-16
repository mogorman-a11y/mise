// yield-sync.js — Supabase sync module for Yield (Finance App)
// Mise Labs suite · App 3 of 3 · v16
// Phase 3: jobs read from shared jobs table; syncTabStatusToCarte/syncQuoteToCarte/
// removeQuoteFromCarte write to jobs table instead of mise_records bridge.
// v13: costing saves that fail or land before yieldSync is ready are now
// actually queued (IDB costing queue) and drained on reconnect/init, instead
// of a "will retry later" message with nothing behind it.
// v14: queue entries now carry an immutable userScope (never replayed under
// whichever account happens to be signed in at flush time); enqueue/flush
// serialised through one lock; init() returns the drain promise so a pull
// right after init can await it instead of racing an in-flight flush.
// v15: a queue persist failure (IndexedDB unavailable/full/corrupted) now
// propagates instead of being swallowed, so saveCosting only reports
// queued:true after confirmed storage; every costing save now verifies the
// live Supabase session instead of trusting the module-level _uid, which
// could otherwise go stale without a full logout+reload.
// v16: added isReadyFor(uid) — isReady() only proves the module was
// initialized for *some* account, not that it's still the live one after an
// in-place session change. Callers acting on behalf of a specific uid
// should check isReadyFor(uid) and re-init when it's false.

window.Mise = window.Mise || {};

(function () {
  'use strict';

  var _sb = null;
  var _uid = null;

  function _err(msg) {
    if (window.Mise && typeof window.Mise.onSyncError === 'function') window.Mise.onSyncError(msg);
  }

  function _ls(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } }
  function _lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
  function _lsArr(key) { return _ls(key) || []; }

  // ── Costing offline queue ──────────────────────────────────────────────────
  // Backs the "will retry later" message on failed costing saves with a real
  // retry: failed/not-ready writes land in the IDB costing queue (idb-queue.js)
  // and get drained on reconnect/init, instead of the message being aspirational.
  //
  // Every entry carries an immutable userScope (the uid it was queued under)
  // — never inferred at flush time from whichever account happens to be
  // signed in then. Without this, a costing queued before init(), after a
  // session expiry, or under a different account could be replayed into the
  // next authenticated account's data. Entries with no userScope (can only
  // be pre-round-6 test data — never shipped) are treated as unattributable
  // and dropped rather than replayed under a guess.
  //
  // Enqueue and flush are both serialised through the same _queueLock promise
  // chain so they can never race each other's read-modify-write of the IDB
  // queue (e.g. a flush reading the queue while an enqueue's write is still
  // in flight).
  var _queueLock = Promise.resolve();

  // Resolves the real authenticated uid directly from the live Supabase
  // session — never trusts the module-level _uid, which can go stale
  // without a full logout+reload (a session replaced in place, test-account
  // switching, or future account-switch functionality). Called before every
  // financial write, not just when not-ready, so a save can never proceed
  // or queue under a uid the current session doesn't actually match. Falls
  // back to the page-level `supabaseClient` global (supabase.js loads
  // before this file) when _sb hasn't been set via init() yet.
  function _resolveAuthedUserId() {
    var client = _sb || (typeof supabaseClient !== 'undefined' ? supabaseClient : null);
    if (!client || !client.auth) return Promise.resolve(null);
    return client.auth.getSession().then(function (res) {
      return (res.data && res.data.session && res.data.session.user && res.data.session.user.id) || null;
    }).catch(function () { return null; });
  }

  // userScope is required — callers must resolve a real uid before calling
  // this (see _resolveAuthedUserId). Returns a promise that reflects the
  // REAL outcome of the persist (rejects if idbQueue.setCosting() failed —
  // e.g. IndexedDB unavailable/full/corrupted) — callers must not report
  // "queued" until this resolves. _queueLock itself is kept always-resolved
  // (via the trailing .catch below) purely for serialisation ordering, so
  // one failed attempt can't permanently wedge future enqueue/flush calls.
  function _queueFailedWrite(table, payload, userScope) {
    var attempt = _queueLock.then(function () {
      if (!userScope) throw new Error('cannot queue a costing without a known user');
      if (!window.Mise || !window.Mise.idbQueue) throw new Error('offline queue unavailable');
      return window.Mise.idbQueue.getCosting().then(function (q) {
        // Dedupe by table+userScope+id — a later save of the same costing by
        // the same account replaces the earlier queued one. Drop any
        // unscoped legacy entry encountered along the way (see comment above).
        var filtered = q.filter(function (e) {
          if (!e.userScope) return false;
          return !(e.table === table && e.userScope === userScope && e.payload && payload && e.payload.id === payload.id);
        });
        filtered.push({ userScope: userScope, table: table, payload: payload, queuedAt: new Date().toISOString() });
        return window.Mise.idbQueue.setCosting(filtered);
      }).then(function () { _showCostingQueueBanner(userScope); });
    });
    _queueLock = attempt.catch(function () {});
    return attempt;
  }

  // scopeHint: the uid whose queue state should drive the banner. Passed
  // explicitly by _queueFailedWrite (the uid it just wrote under) because
  // that may be a freshly-verified uid that differs from the module-level
  // _uid (e.g. a session change without a fresh init()) — falling back to
  // stale _uid here would risk not showing the banner for the account that
  // actually has something queued.
  function _showCostingQueueBanner(scopeHint) {
    if (!window.Mise || !window.Mise.idbQueue) return;
    var scope = scopeHint || _uid;
    window.Mise.idbQueue.getCosting().then(function (q) {
      var relevant = scope ? q.filter(function (e) { return e.userScope === scope; }) : [];
      var existing = document.getElementById('vq-yield-sync-banner');
      if (!relevant.length) { if (existing) existing.remove(); return; }
      if (existing) return;
      var banner = document.createElement('div');
      banner.id = 'vq-yield-sync-banner';
      banner.style.cssText = 'position:fixed;bottom:70px;left:0;right:0;z-index:9001;background:#b45309;color:#fff;font-size:13px;font-weight:600;text-align:center;padding:10px 16px;line-height:1.4;display:flex;align-items:center;justify-content:center;gap:10px;';
      banner.innerHTML = '⚠ Finance data not fully synced — will retry when online'
        + '<button onclick="window.Mise.yieldSync.flushCostingQueue()" style="background:rgba(255,255,255,0.25);border:none;color:#fff;font-size:12px;font-weight:700;padding:4px 10px;border-radius:6px;cursor:pointer;font-family:inherit;">Retry now</button>';
      document.body.appendChild(banner);
    }).catch(function () {});
  }

  // Serialised through _queueLock (see above) so it can't race a concurrent
  // enqueue. Only replays entries whose userScope matches the currently
  // authenticated user — an entry queued under a different (e.g. previously
  // signed-in) account is left in the queue untouched, never flushed under
  // the wrong owner and never discarded just because it isn't "ours" right
  // now. Ownership on replay is taken from the entry itself, not from _uid.
  function _flushCostingQueue() {
    _queueLock = _queueLock.then(function () {
      if (!_sb || !_uid || !window.Mise || !window.Mise.idbQueue) return;
      return window.Mise.idbQueue.getCosting().then(async function (q) {
        if (!q.length) return;
        var remaining = [];
        for (var i = 0; i < q.length; i++) {
          var entry = q[i];
          if (!entry.userScope) continue; // unattributable legacy entry — drop, never replay under a guess
          if (entry.userScope !== _uid) { remaining.push(entry); continue; } // not this account's entry — leave queued
          try {
            var payload = Object.assign({}, entry.payload, { user_id: entry.userScope });
            var res = await _sb.from(entry.table).upsert(payload, { onConflict: 'id' });
            if (res.error) throw new Error(res.error.message);
          } catch (e) {
            remaining.push(entry);
          }
        }
        await window.Mise.idbQueue.setCosting(remaining);
        var banner = document.getElementById('vq-yield-sync-banner');
        if (!remaining.some(function (e) { return e.userScope === _uid; }) && banner) banner.remove();
        _showCostingQueueBanner();
      });
    }).catch(function () {});
    return _queueLock;
  }

  // Local costings not yet confirmed on the server, scoped to the current
  // user — a successful pull must not silently drop these from the cache
  // just because the server doesn't have them yet (see _pullCostings below).
  function _queuedCostingRecords() {
    if (!window.Mise || !window.Mise.idbQueue || !_uid) return Promise.resolve([]);
    return window.Mise.idbQueue.getCosting().then(function (q) {
      return q.filter(function (e) { return e.table === 'costings' && e.userScope === _uid; })
        .map(function (e) { return e.payload && e.payload.costing_data; })
        .filter(Boolean);
    }).catch(function () { return []; });
  }

  var yieldSync = {

    // Returns the drain promise so callers can await it — becoming ready is
    // itself a reconnect event for anything queued while not ready (e.g. an
    // AI Costing save that landed before yieldSync had ever been initialized
    // this session). Callers that don't await this still get correct
    // behaviour (the queue drains whenever it finishes), but anything that
    // reads yield_costings right after init() (e.g. an immediate pull) must
    // await it to avoid racing a still-in-flight flush.
    init: function (supabaseClient, userId) {
      _sb = supabaseClient;
      _uid = userId;
      return _flushCostingQueue();
    },

    getUserId: function () { return _uid; },

    pull: async function () {
      if (!_sb || !_uid) return;
      await Promise.allSettled([
        _pullInvoices(),
        _pullPayments(),
        _pullClients(),
        _pullJobs(),
        _pullMenusAndDishes(),
        _pullQuotes(),
        _pullCostings()
      ]);
    },

    saveInvoice: async function (invoice) {
      if (!_sb || !_uid) {
        _err('saveInvoice: not ready (_sb=' + !!_sb + ' _uid=' + !!_uid + ')');
        return { error: 'not ready' };
      }
      var payload = Object.assign({}, invoice, { user_id: _uid });
      var res = await _sb.from('invoices').upsert(payload, { onConflict: 'id' }).select().single();
      if (res.error) {
        console.error('[Yield] saveInvoice failed:', res.error.message, payload);
        _err('Invoice save failed: ' + res.error.message);
      } else if (res.data) {
        var invoices = _lsArr('yield_invoices');
        var idx = invoices.findIndex(function (i) { return i.id === res.data.id; });
        if (idx >= 0) invoices[idx] = res.data; else invoices.unshift(res.data);
        _lsSet('yield_invoices', invoices);
      } else {
        console.error('[Yield] saveInvoice: upsert returned no data — RLS or schema issue', payload);
        _err('Invoice save failed: check table schema / RLS');
      }
      return res;
    },

    deleteInvoice: async function (id) {
      if (!_sb || !_uid) return;
      var res = await _sb.from('invoices').delete().eq('id', id).eq('user_id', _uid);
      if (!res.error) {
        _lsSet('yield_invoices', _lsArr('yield_invoices').filter(function (i) { return i.id !== id; }));
      }
      return res;
    },

    savePayment: async function (payment) {
      if (!_sb || !_uid) return { error: 'not ready' };
      var payload = Object.assign({}, payment, { user_id: _uid });
      var res = await _sb.from('payments').insert(payload).select().single();
      if (res.error) {
        console.error('[Yield] savePayment failed:', res.error.message, payload);
        _err('Payment save failed: ' + res.error.message);
      }
      if (!res.error && res.data) {
        var payments = _lsArr('yield_payments');
        payments.unshift(res.data);
        _lsSet('yield_payments', payments);
        await _recalcInvoicePaidTotal(payment.invoice_id);
      }
      return res;
    },

    saveQuote: async function (quote) {
      // Update localStorage immediately (source of truth for UI)
      var quotes = _lsArr('yield_quotes');
      var idx = quotes.findIndex(function (q) { return q.id === quote.id; });
      if (idx >= 0) quotes[idx] = quote; else quotes.unshift(quote);
      _lsSet('yield_quotes', quotes);
      // Upsert to Supabase — powers the /pay client portal
      if (!_sb || !_uid) {
        console.warn('[Yield] saveQuote skipped — not ready (_sb=' + !!_sb + ', _uid=' + !!_uid + ')');
        return;
      }
      try {
        var res = await _sb.from('quotes').upsert({
          id: String(quote.id),
          user_id: _uid,
          client_name: quote.client_name || null,
          event_date: quote.event_date || null,
          status: quote.status || 'draft',
          quote_data: quote,
          created_at: quote.created_at || new Date().toISOString()
        }, { onConflict: 'id' });
        if (res.error) {
          console.error('[Yield] saveQuote error:', res.error.message, res.error);
          _err('Quote save failed: ' + res.error.message);
        } else {
          console.log('[Yield] ✓ quote saved to Supabase:', quote.id, 'status:', quote.status);
        }
      } catch (e) {
        console.error('[Yield] saveQuote exception:', e.message);
        _err('Quote save error — check console');
      }
    },

    deleteQuote: function (id) {
      _lsSet('yield_quotes', _lsArr('yield_quotes').filter(function (q) { return q.id !== id; }));
      if (_sb && _uid) _sb.from('quotes').delete().eq('id', String(id)).eq('user_id', _uid);
    },

    // Always writes the local cache first — the local save must never be
    // skipped just because the cloud sync can't happen yet. Returns explicit
    // booleans, never to be inferred from the presence/absence of `error`:
    //   { synced: true,  queued: false, error: null }                    — confirmed cloud write
    //   { synced: false, queued: true,  error }                          — genuinely queued for retry
    //   { synced: false, queued: false, error, queueError? }             — could not sync AND could not queue
    //
    // Verifies the live Supabase session before every call rather than
    // trusting the module-level _uid, which can go stale without a full
    // logout+reload (a session replaced in place, test-account switching,
    // or future account-switch functionality) — a save can never proceed
    // or queue under a uid the current session doesn't actually match.
    saveCosting: function (costing) {
      var costings = _lsArr('yield_costings');
      var idx = costings.findIndex(function (c) { return c.id === costing.id; });
      if (idx >= 0) costings[idx] = costing; else costings.unshift(costing);
      _lsSet('yield_costings', costings);

      return _resolveAuthedUserId().then(function (uid) {
        if (!uid) return { synced: false, queued: false, error: 'not signed in' };
        var payload = {
          id: costing.id,
          user_id: uid,
          costing_data: costing,
          created_at: costing.createdAt || new Date().toISOString()
        };

        if (_sb && uid === _uid) {
          return _sb.from('costings').upsert(payload, { onConflict: 'id' }).then(function (res) {
            if (res.error) {
              return _queueFailedWrite('costings', payload, uid)
                .then(function () { return { synced: false, queued: true, error: res.error }; })
                .catch(function (queueError) { return { synced: false, queued: false, error: res.error, queueError: queueError }; });
            }
            return { synced: true, queued: false, error: null };
          }).catch(function (e) {
            return _queueFailedWrite('costings', payload, uid)
              .then(function () { return { synced: false, queued: true, error: e }; })
              .catch(function (queueError) { return { synced: false, queued: false, error: e, queueError: queueError }; });
          });
        }

        // Not ready, or the live session no longer matches the initialized
        // _uid — queue under the freshly-verified uid, never the stale one.
        return _queueFailedWrite('costings', payload, uid)
          .then(function () { return { synced: false, queued: true, error: 'sync not ready — queued for retry' }; })
          .catch(function (queueError) { return { synced: false, queued: false, error: 'sync not ready', queueError: queueError }; });
      });
    },

    deleteCosting: function (id) {
      _lsSet('yield_costings', _lsArr('yield_costings').filter(function (c) { return c.id !== id; }));
      if (_sb && _uid) {
        _sb.from('costings').delete().eq('id', id).eq('user_id', _uid);
      }
    },

    syncTabStatusToCarte: async function (jobKey, depositPaid, balancePaid) {
      if (!_sb || !_uid || !jobKey) return;
      try {
        var ex = await _sb.from('jobs').select('metadata').eq('id', String(jobKey)).eq('user_id', _uid).single();
        var meta = Object.assign({}, (ex.data && ex.data.metadata) || {}, {
          tabDepositPaid: !!depositPaid,
          tabBalancePaid: !!balancePaid,
          tabClosed: !!(depositPaid && balancePaid)
        });
        await _sb.from('jobs').update({ metadata: meta, updated_at: new Date().toISOString() })
          .eq('id', String(jobKey)).eq('user_id', _uid);
      } catch (e) {}
    },

    pullProfile: async function () {
      if (!_sb || !_uid) return null;
      var res = await _sb.from('profiles').select('business_name, chef_name, logo, stripe_account_id, stripe_account_status').eq('id', _uid).single();
      if (res.data) _lsSet('yield_profile', res.data);
      return res.data || null;
    },

    pullSettings: async function () {
      if (!_sb || !_uid) return;
      var res = await _sb.from('profiles').select('yield_settings').eq('id', _uid).single();
      if (res.data && res.data.yield_settings && Object.keys(res.data.yield_settings).length > 0) {
        var local = _ls('yield_settings') || {};
        // Remote wins: overwrite local with cloud copy so data survives hard reset
        _lsSet('yield_settings', Object.assign({}, local, res.data.yield_settings));
      }
    },

    saveYieldSettings: function (settings) {
      if (!_sb || !_uid) return;
      _sb.from('profiles').update({ yield_settings: settings }).eq('id', _uid);
    },

    saveProfile: async function (data) {
      if (!_sb || !_uid) return { error: 'not ready' };
      var payload = {};
      if (data.business_name !== undefined) payload.business_name = data.business_name;
      if (data.chef_name !== undefined) payload.chef_name = data.chef_name;
      if (data.logo !== undefined) payload.logo = data.logo;
      var res = await _sb.from('profiles').update(payload).eq('id', _uid);
      if (!res.error) {
        var cached = _ls('yield_profile') || {};
        _lsSet('yield_profile', Object.assign({}, cached, payload));
      }
      return res;
    },

    syncQuoteToCarte: async function (quote) {
      if (!_sb || !_uid || !quote.event_date) return;
      try {
        await _sb.from('jobs').upsert({
          id: String(quote.id),
          user_id: _uid,
          title: quote.client_name ? 'Event — ' + quote.client_name : 'Event',
          job_date: quote.event_date,
          headcount: parseInt(quote.covers) || null,
          notes: quote.notes || null,
          status: 'confirmed',
          source: 'yield',
          metadata: {
            client_name: quote.client_name || '',
            status: quote.status || 'quoted',
            price_per_head: parseFloat(quote.price_per_head) || null,
            tabDepositPaid: quote.depositPaid || false,
            tabBalancePaid: quote.balancePaid || false,
            tabClosed: !!(quote.depositPaid && quote.balancePaid)
          },
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
        // Immediately refresh Menus + HACCP local state so the job appears without reload
        if (window.Mise && window.Mise.sync && window.Mise.sync.refreshSharedJobs) {
          window.Mise.sync.refreshSharedJobs();
        }
      } catch (e) { console.warn('[Yield] syncQuoteToCarte failed:', e.message); }
    },

    removeQuoteFromCarte: async function (quoteId) {
      if (!_sb || !_uid || !quoteId) return;
      try {
        await _sb.from('jobs').delete().eq('id', String(quoteId)).eq('user_id', _uid);
        if (window.Mise && window.Mise.sync && window.Mise.sync.refreshSharedJobs) {
          window.Mise.sync.refreshSharedJobs();
        }
      } catch (e) { console.warn('[Yield] removeQuoteFromCarte failed:', e.message); }
    },

    getSharedMenus: function () { return _lsArr('yield_menus'); },
    getSharedDishes: function () { return _lsArr('yield_dishes'); },
    isReady: function () { return !!(_sb && _uid); },
    // isReady() only proves *some* account was initialized — not that it's
    // still the live one. A caller that's about to act on behalf of a
    // specific (freshly-resolved) uid must use this instead: it's only true
    // when the module is initialized AND initialized for that exact uid, so
    // an in-place session change (no full logout+reload) is correctly
    // treated as "not ready for this user" until init() runs again.
    isReadyFor: function (uid) { return !!(_sb && _uid && uid && _uid === uid); },
    flushCostingQueue: _flushCostingQueue
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('online', function () { _flushCostingQueue(); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') _flushCostingQueue();
    });
  }

  // Applies a Supabase select result to a localStorage cache using the
  // shared decision rule in js/core/pull-result.js (unit-tested separately —
  // see tests/sync-merge-logic.test.js). Returns true if the cache was updated.
  function _applyPullResult(key, res, transform) {
    var outcome = window.Veriqo.decidePullOutcome(res);
    if (outcome.keep) {
      console.error('[Yield] pull ' + key + ' failed:', outcome.error.message);
      _err('Could not refresh ' + key.replace('yield_', '') + ' — showing last saved data');
      return false;
    }
    _lsSet(key, transform ? transform(outcome.data) : outcome.data);
    return true;
  }

  // Not routed through _applyPullResult: an unqualified replace would discard
  // any costing that's locally saved but still sitting in the offline retry
  // queue (e.g. saved while offline, or before yieldSync was ready) — the
  // server genuinely doesn't have it yet, but that doesn't make it stale.
  // The queued version wins over whatever the server returns for the same id.
  async function _pullCostings() {
    var res = await _sb.from('costings').select('costing_data').eq('user_id', _uid).order('created_at', { ascending: false });
    var outcome = window.Veriqo.decidePullOutcome(res);
    if (outcome.keep) {
      console.error('[Yield] pull yield_costings failed:', outcome.error.message);
      _err('Could not refresh costings — showing last saved data');
      return;
    }
    var cloud = outcome.data.map(function (r) { return r.costing_data; });
    var queued = await _queuedCostingRecords();
    _lsSet('yield_costings', window.Veriqo.mergeUnsyncedRecords(cloud, queued));
  }

  async function _pullQuotes() {
    var res = await _sb.from('quotes').select('quote_data').eq('user_id', _uid).order('created_at', { ascending: false });
    _applyPullResult('yield_quotes', res, function (data) { return data.map(function (r) { return r.quote_data; }); });
  }

  async function _pullInvoices() {
    var res = await _sb.from('invoices').select('*').eq('user_id', _uid).order('created_at', { ascending: false });
    _applyPullResult('yield_invoices', res);
  }

  async function _pullPayments() {
    var res = await _sb.from('payments').select('*').eq('user_id', _uid).order('paid_at', { ascending: false });
    _applyPullResult('yield_payments', res);
  }

  async function _pullClients() {
    var res = await _sb.from('clients').select('*').eq('user_id', _uid).order('name');
    _applyPullResult('yield_clients', res);
  }

  async function _pullJobs() {
    var res = await _sb.from('jobs').select('*').eq('user_id', _uid).order('job_date', { ascending: false });
    _applyPullResult('yield_jobs', res, function (data) {
      return data.map(function (j) {
        var meta = j.metadata || {};
        return {
          _source: j.source || 'shared',
          id: j.id,
          type: 'job',
          eventDate: j.job_date,
          client: meta.client_name || '',
          eventTime: j.start_time || '',
          covers: j.headcount ? String(j.headcount) : '',
          jobType: j.title || '',
          location: j.location || '',
          notes: j.notes || '',
          menus: meta.menus || [],
          status: j.status || 'confirmed',
          tabDepositPaid: meta.tabDepositPaid || false,
          tabBalancePaid: meta.tabBalancePaid || false,
          tabClosed: meta.tabClosed || false,
          _dateKey: j.job_date
        };
      });
    });
  }

  async function _pullMenusAndDishes() {
    var results = await Promise.all([
      _sb.from('menus').select('*').eq('user_id', _uid).order('name'),
      _sb.from('menu_dishes').select('*').eq('user_id', _uid).order('sort_order'),
      _sb.from('dishes').select('*').eq('user_id', _uid).order('name')
    ]);
    var menusRes = results[0], menuDishesRes = results[1], dishesRes = results[2];

    // menus and menu_dishes are coupled (menus needs menu_dishes to build a
    // correct `dishes` field) but dishes is independent — each collection's
    // clear/keep decision must not be coupled to the others' success/failure.
    if (menusRes.error) {
      console.error('[Yield] pull menus failed:', menusRes.error.message);
      _err('Could not refresh menus — showing last saved data');
    } else if (menuDishesRes.error) {
      console.error('[Yield] pull menu_dishes failed:', menuDishesRes.error.message);
      _err('Could not refresh menu dishes — showing last saved data');
    } else {
      var menus = menusRes.data || [];
      var menuDishes = menuDishesRes.data || [];
      var dishesById = {};
      (dishesRes.data || []).forEach(function (d) { dishesById[String(d.id)] = d; });
      var menusWithDishes = menus.map(function (m) {
        var joinedDishes = menuDishes.filter(function (md) { return md.menu_id === m.id; });
        var resolvedDishes = joinedDishes.length ? joinedDishes : window.Veriqo.resolveMenuDishes(m, dishesById);
        return Object.assign({}, m, { dishes: resolvedDishes });
      });
      _lsSet('yield_menus', menusWithDishes);
    }

    _applyPullResult('yield_dishes', dishesRes);
  }

  async function _recalcInvoicePaidTotal(invoiceId) {
    if (!invoiceId) return;
    var pRes = await _sb.from('payments').select('amount').eq('invoice_id', invoiceId).eq('user_id', _uid);
    var paidTotal = (pRes.data || []).reduce(function (s, p) { return s + parseFloat(p.amount || 0); }, 0);

    var invoice = _lsArr('yield_invoices').find(function (i) { return i.id === invoiceId; });
    if (!invoice) {
      var iRes = await _sb.from('invoices').select('*').eq('id', invoiceId).eq('user_id', _uid).single();
      invoice = iRes.data;
    }
    if (!invoice) return;

    var isOverdue = invoice.due_date && new Date(invoice.due_date) < new Date() && paidTotal < parseFloat(invoice.total);
    var newStatus = paidTotal >= parseFloat(invoice.total) ? 'paid' : (isOverdue ? 'overdue' : invoice.status);
    if (newStatus === 'paid' || newStatus === 'overdue') {
      await _sb.from('invoices').update({ paid_total: paidTotal, status: newStatus }).eq('id', invoiceId).eq('user_id', _uid);
    } else {
      await _sb.from('invoices').update({ paid_total: paidTotal }).eq('id', invoiceId).eq('user_id', _uid);
    }

    var invoices = _lsArr('yield_invoices');
    var idx = invoices.findIndex(function (i) { return i.id === invoiceId; });
    if (idx >= 0) { invoices[idx].paid_total = paidTotal; invoices[idx].status = newStatus; }
    _lsSet('yield_invoices', invoices);
  }

  window.Mise.yieldSync = yieldSync;
}());
