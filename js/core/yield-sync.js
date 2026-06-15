// yield-sync.js — Supabase sync module for Yield (Finance App)
// Mise Labs suite · App 3 of 3 · v11
// Phase 3: jobs read from shared jobs table; syncTabStatusToCarte/syncQuoteToCarte/
// removeQuoteFromCarte write to jobs table instead of mise_records bridge.

window.Mise = window.Mise || {};

(function () {
  'use strict';

  var _sb = null;
  var _uid = null;

  function _err(msg) {
    if (window.Mise && typeof window.Mise.onSyncError === 'function') window.Mise.onSyncError(msg);
  }

  // ── Costing offline queue ──────────────────────────────────────────────────
  // Serialise all queue writes through a promise chain to prevent race conditions
  // when multiple saves fail concurrently (each read-modify-write must be atomic).
  var _queueLock = Promise.resolve();

  function _queueFailedWrite(table, payload) {
    _queueLock = _queueLock.then(async function () {
      if (!window.Mise || !window.Mise.idbQueue) return;
      var q = await window.Mise.idbQueue.getCosting();
      // Deduplicate by table+id — latest write always replaces earlier one
      var filtered = q.filter(function(e) {
        return !(e.table === table && e.payload && payload && e.payload.id === payload.id);
      });
      filtered.push({ table: table, payload: payload, queuedAt: new Date().toISOString() });
      await window.Mise.idbQueue.setCosting(filtered);
      _showCostingQueueBanner();
      console.warn('[Yield] queued failed write:', table, (payload && payload.id) || '');
    }).catch(function () {});
    return _queueLock;
  }

  function _showCostingQueueBanner() {
    if (!window.Mise || !window.Mise.idbQueue) return;
    window.Mise.idbQueue.getCosting().then(function(q) {
      var existing = document.getElementById('vq-yield-sync-banner');
      if (!q.length) { if (existing) existing.remove(); return; }
      if (existing) return;
      var banner = document.createElement('div');
      banner.id = 'vq-yield-sync-banner';
      banner.style.cssText = 'position:fixed;bottom:70px;left:0;right:0;z-index:9001;background:#b45309;color:#fff;font-size:13px;font-weight:600;text-align:center;padding:10px 16px;line-height:1.4;display:flex;align-items:center;justify-content:center;gap:10px;';
      banner.innerHTML = '⚠ Finance data not fully synced — will retry when online'
        + '<button onclick="window.Mise.yieldSync.flushCostingQueue()" style="background:rgba(255,255,255,0.25);border:none;color:#fff;font-size:12px;font-weight:700;padding:4px 10px;border-radius:6px;cursor:pointer;font-family:inherit;">Retry now</button>';
      document.body.appendChild(banner);
      if (typeof toast === 'function') toast('Saved locally — will sync when back online', 'warn');
    }).catch(function() {});
  }

  function _ls(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } }
  function _lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
  function _lsArr(key) { return _ls(key) || []; }

  var yieldSync = {

    init: function (supabaseClient, userId) {
      _sb = supabaseClient;
      _uid = userId;
    },

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
      var payload = Object.assign({}, invoice, { user_id: _uid || invoice.user_id });
      if (!_sb || !_uid) {
        _err('saveInvoice: not ready');
        await _queueFailedWrite('invoices', payload);
        return { error: 'not ready' };
      }
      try {
        var res = await _sb.from('invoices').upsert(payload, { onConflict: 'id' }).select().single();
        if (res.error) {
          console.error('[Yield] saveInvoice failed:', res.error.message);
          _err('Invoice save failed: ' + res.error.message);
          await _queueFailedWrite('invoices', payload);
        } else if (res.data) {
          var invoices = _lsArr('yield_invoices');
          var idx = invoices.findIndex(function (i) { return i.id === res.data.id; });
          if (idx >= 0) invoices[idx] = res.data; else invoices.unshift(res.data);
          _lsSet('yield_invoices', invoices);
        }
        return res;
      } catch(e) {
        console.error('[Yield] saveInvoice exception:', e.message);
        await _queueFailedWrite('invoices', payload);
        return { error: e.message };
      }
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
      var payload = Object.assign({}, payment, { user_id: _uid || payment.user_id });
      if (!_sb || !_uid) {
        await _queueFailedWrite('payments', payload);
        return { error: 'not ready' };
      }
      try {
        // Use upsert so retried payments don't duplicate (payments have a stable id)
        var res = await _sb.from('payments').upsert(payload, { onConflict: 'id' }).select().single();
        if (res.error) {
          console.error('[Yield] savePayment failed:', res.error.message);
          _err('Payment save failed: ' + res.error.message);
          await _queueFailedWrite('payments', payload);
        } else if (res.data) {
          var payments = _lsArr('yield_payments');
          var pi = payments.findIndex(function(p) { return p.id === res.data.id; });
          if (pi >= 0) payments[pi] = res.data; else payments.unshift(res.data);
          _lsSet('yield_payments', payments);
          await _recalcInvoicePaidTotal(payment.invoice_id);
        }
        return res;
      } catch(e) {
        console.error('[Yield] savePayment exception:', e.message);
        await _queueFailedWrite('payments', payload);
        return { error: e.message };
      }
    },

    saveQuote: async function (quote) {
      // Update localStorage immediately (source of truth for UI)
      var quotes = _lsArr('yield_quotes');
      var idx = quotes.findIndex(function (q) { return q.id === quote.id; });
      if (idx >= 0) quotes[idx] = quote; else quotes.unshift(quote);
      _lsSet('yield_quotes', quotes);
      // Build payload before the ready-check so we can queue it if not ready
      var qPayload = {
        id: String(quote.id),
        user_id: _uid || quote.user_id || null,
        client_name: quote.client_name || null,
        event_date: quote.event_date || null,
        status: quote.status || 'draft',
        quote_data: quote,
        created_at: quote.created_at || new Date().toISOString()
      };
      // Upsert to Supabase — powers the /pay client portal
      if (!_sb || !_uid) {
        console.warn('[Yield] saveQuote queued — not ready (_sb=' + !!_sb + ', _uid=' + !!_uid + ')');
        await _queueFailedWrite('quotes', qPayload);
        return;
      }
      try {
        var res = await _sb.from('quotes').upsert(qPayload, { onConflict: 'id' });
        if (res.error) {
          console.error('[Yield] saveQuote error:', res.error.message);
          _err('Quote save failed: ' + res.error.message);
          await _queueFailedWrite('quotes', qPayload);
        } else {
          console.log('[Yield] ✓ quote saved to Supabase:', quote.id, 'status:', quote.status);
        }
      } catch (e) {
        console.error('[Yield] saveQuote exception:', e.message);
        await _queueFailedWrite('quotes', qPayload);
      }
    },

    deleteQuote: function (id) {
      _lsSet('yield_quotes', _lsArr('yield_quotes').filter(function (q) { return q.id !== id; }));
      if (_sb && _uid) _sb.from('quotes').delete().eq('id', String(id)).eq('user_id', _uid);
    },

    saveCosting: async function (costing) {
      var costings = _lsArr('yield_costings');
      var idx = costings.findIndex(function (c) { return c.id === costing.id; });
      if (idx >= 0) costings[idx] = costing; else costings.unshift(costing);
      _lsSet('yield_costings', costings);
      var cPayload = {
        id: costing.id,
        user_id: _uid,
        costing_data: costing,
        created_at: costing.createdAt || new Date().toISOString()
      };
      if (!_sb || !_uid) { await _queueFailedWrite('costings', cPayload); return; }
      try {
        var res = await _sb.from('costings').upsert(cPayload, { onConflict: 'id' });
        if (res.error) {
          console.error('[Yield] saveCosting failed:', res.error.message);
          await _queueFailedWrite('costings', cPayload);
        }
      } catch(e) {
        console.error('[Yield] saveCosting exception:', e.message);
        await _queueFailedWrite('costings', cPayload);
      }
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
      var res = await _sb.from('profiles').select('id, business_name, chef_name, logo, stripe_account_id, stripe_account_status').eq('id', _uid).single();
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

    flushCostingQueue: async function () {
      if (!_sb || !_uid || !window.Mise || !window.Mise.idbQueue) return;
      var q = await window.Mise.idbQueue.getCosting();
      if (!q.length) return;
      console.log('[Yield] flushing costing queue —', q.length, 'item(s)');
      var remaining = [];
      for (var i = 0; i < q.length; i++) {
        var entry = q[i];
        try {
          var payload = Object.assign({}, entry.payload, { user_id: _uid });
          var res = await _sb.from(entry.table).upsert(payload, { onConflict: 'id' });
          if (res.error) throw new Error(res.error.message);
          console.log('[Yield] ✓ queue flush:', entry.table, (entry.payload && entry.payload.id) || '');
        } catch(e) {
          console.warn('[Yield] queue flush failed:', entry.table, e.message);
          remaining.push(entry);
        }
      }
      await window.Mise.idbQueue.setCosting(remaining);
      var banner = document.getElementById('vq-yield-sync-banner');
      if (!remaining.length && banner) banner.remove();
      _showCostingQueueBanner();
    }
  };

  async function _pullCostings() {
    var res = await _sb.from('costings').select('costing_data').eq('user_id', _uid).order('created_at', { ascending: false });
    if (res.data && res.data.length > 0) {
      _lsSet('yield_costings', res.data.map(function (r) { return r.costing_data; }));
    }
  }

  async function _pullQuotes() {
    var res = await _sb.from('quotes').select('quote_data').eq('user_id', _uid).order('created_at', { ascending: false });
    if (res.data && res.data.length > 0) {
      _lsSet('yield_quotes', res.data.map(function (r) { return r.quote_data; }));
    }
  }

  async function _pullInvoices() {
    var res = await _sb.from('invoices').select('*').eq('user_id', _uid).order('created_at', { ascending: false });
    if (res.data) _lsSet('yield_invoices', res.data);
  }

  async function _pullPayments() {
    var res = await _sb.from('payments').select('*').eq('user_id', _uid).order('paid_at', { ascending: false });
    if (res.data) _lsSet('yield_payments', res.data);
  }

  async function _pullClients() {
    var res = await _sb.from('clients').select('*').eq('user_id', _uid).order('name');
    if (res.data) _lsSet('yield_clients', res.data);
  }

  async function _pullJobs() {
    var res = await _sb.from('jobs').select('*').eq('user_id', _uid).order('job_date', { ascending: false });
    var jobs = (res.data || []).map(function (j) {
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
    _lsSet('yield_jobs', jobs);
  }

  async function _pullMenusAndDishes() {
    var results = await Promise.all([
      _sb.from('menus').select('*').eq('user_id', _uid).order('name'),
      _sb.from('menu_dishes').select('*').eq('user_id', _uid).order('sort_order'),
      _sb.from('dishes').select('*').eq('user_id', _uid).order('name')
    ]);
    var menus = results[0].data || [];
    var menuDishes = results[1].data || [];
    var dishes = results[2].data || [];

    var menusWithDishes = menus.map(function (m) {
      return Object.assign({}, m, { dishes: menuDishes.filter(function (md) { return md.menu_id === m.id; }) });
    });

    _lsSet('yield_menus', menusWithDishes);
    _lsSet('yield_dishes', dishes);
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
