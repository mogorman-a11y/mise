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

    saveCosting: function (costing) {
      var costings = _lsArr('yield_costings');
      var idx = costings.findIndex(function (c) { return c.id === costing.id; });
      if (idx >= 0) costings[idx] = costing; else costings.unshift(costing);
      _lsSet('yield_costings', costings);
      if (_sb && _uid) {
        _sb.from('costings').upsert({
          id: costing.id,
          user_id: _uid,
          costing_data: costing,
          created_at: costing.createdAt || new Date().toISOString()
        }, { onConflict: 'id' });
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
          title: 'Event',
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
      } catch (e) {}
    },

    removeQuoteFromCarte: async function (quoteId) {
      if (!_sb || !_uid || !quoteId) return;
      try {
        await _sb.from('jobs').delete().eq('id', String(quoteId)).eq('user_id', _uid);
      } catch (e) {}
    },

    getSharedMenus: function () { return _lsArr('yield_menus'); },
    getSharedDishes: function () { return _lsArr('yield_dishes'); },
    isReady: function () { return !!(_sb && _uid); }
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
