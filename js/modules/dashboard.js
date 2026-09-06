// js/modules/dashboard.js v8 — Veriqo Dashboard (event-led)
//
// Private chefs don't work every day, so this dashboard is booking-led, not
// a generic daily HACCP dashboard:
//   1. If there's an upcoming booking  → that booking + its preparation
//      progress are the headline.
//   2. Business actions that need attention (draft quotes, overdue invoices,
//      jobs missing details) come next.
//   3. HACCP / Menus / Costing are secondary module summaries at the bottom.
//      HACCP is only given prominence when a service is today or tomorrow.
//   4. No upcoming booking → a business overview + a single "Create job" CTA.
//   5. Brand-new account → a helpful empty state, no unexplained zeros.
//
// All data is read from what the app already stores (jobs in mise_* /
// yield_jobs, quotes/invoices/payments in yield_*, HACCP records in
// haccp_<date>, dish/menu counts in mise_settings). Nothing is invented.
// Called by showModule('dashboard').

window.modules = window.modules || {};
window.modules.dashboard = (function () {

  var _container = null;
  var _inited    = false;

  var _pulledAt = 0;

  // ── Public init ───────────────────────────────────────────
  function init(container) {
    _container = container;
    if (!_inited) {
      _inited = true;
      document.addEventListener('vq:sync-complete', render);
    }
    render();
    _refreshCosting();
  }

  // Best-effort: pull the latest Costing data (quotes / invoices / payments)
  // when the dashboard opens, so the finance figures and the "nothing
  // outstanding" all-clear aren't driven by a stale cache. Throttled, guarded,
  // silent on failure; a successful pull fires vq:sync-complete which re-renders.
  function _currentUid() {
    var p = (window.Mise && window.Mise.profile) || {};
    return p.id || null;
  }
  function _refreshCosting() {
    try {
      var ys = window.Mise && window.Mise.yieldSync;
      if (!ys || typeof ys.pull !== 'function') return;
      // Only pull when sync is confirmed ready for THIS account (isReady() alone
      // can stay true for a previous user after an in-place session change).
      var uid = _currentUid();
      var readyForMe = typeof ys.isReadyFor === 'function'
        ? (uid && ys.isReadyFor(uid))
        : (typeof ys.isReady === 'function' && ys.isReady());
      if (!readyForMe) return;
      if (Date.now() - _pulledAt < 30000) return;
      _pulledAt = Date.now();
      Promise.resolve(ys.pull()).then(function () { render(); }).catch(function () {});
    } catch (e) {}
  }

  function _costingFresh() {
    try {
      var ys = window.Mise && window.Mise.yieldSync;
      if (!ys) return false;
      var uid = _currentUid();
      if (typeof ys.isReadyFor === 'function' && uid) return !!ys.isReadyFor(uid);
      return !!(typeof ys.isReady === 'function' && ys.isReady());
    } catch (e) { return false; }
  }

  // ── Small utilities ──────────────────────────────────────
  function _esc(s) {
    return s == null ? '' : String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function _lsJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || fallback); }
    catch (e) { try { return JSON.parse(fallback); } catch (_) { return null; } }
  }
  function _todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function _daysUntil(ds) {
    if (!ds) return Infinity;
    var a = new Date(_todayStr() + 'T00:00:00'), b = new Date(String(ds).slice(0, 10) + 'T00:00:00');
    return Math.round((b - a) / 86400000);
  }
  function _daysAgo(iso) {
    if (!iso) return Infinity;
    return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  }
  function _plural(n, one, many) { return n === 1 ? one : (many || one + 's'); }
  function _money(n) {
    n = Number(n) || 0;
    var frac = Math.round(n * 100) % 100 !== 0;
    return '£' + n.toLocaleString('en-GB', { minimumFractionDigits: frac ? 2 : 0, maximumFractionDigits: 2 });
  }
  function _ico(name, size) {
    return (typeof vqIcon === 'function') ? vqIcon(name, size || 16) : '';
  }
  function _chev() {
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block"><polyline points="9 18 15 12 9 6"/></svg>';
  }
  // Sanitise an id before it goes into an inline onclick string. Real job /
  // quote ids are always [A-Za-z0-9_-]; this is belt-and-braces so a stray
  // quote can never break out of the handler attribute.
  function _hid(x) { return String(x == null ? '' : x).replace(/[^\w-]/g, ''); }

  // ── Job field accessors (jobs come from a few shapes) ────
  function _jDate(j)     { return (j.eventDate || j.job_date || j._dateKey || j.date || '').slice(0, 10); }
  function _jClient(j)   { return j.client || j.client_name || ''; }
  function _jType(j)     { return j.jobType || j.job_type || j.event_type || ''; }
  function _jTime(j)     { return j.eventTime || j.event_time || j.time_of_service || ''; }
  function _jLocation(j) { return j.location || j.venue || j.address || ''; }
  function _jCovers(j)   {
    var c = j.covers || j.guest_count || j.pax;
    return c ? String(c) : '';
  }

  function _allJobs() {
    var out = [], seen = {};
    function add(j) {
      if (!j || j.id == null) return;
      if (j.type && j.type !== 'job') return;
      var id = String(j.id);
      if (seen[id]) return;
      seen[id] = true;
      out.push(j);
    }
    try { if (typeof getAllJobs === 'function') getAllJobs().forEach(add); } catch (e) {}
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf('mise_') !== 0 || k === 'mise_settings') continue;
        var recs = _lsJSON(k, '[]') || [];
        for (var r = 0; r < recs.length; r++) if (recs[r] && recs[r].type === 'job') add(recs[r]);
      }
    } catch (e) {}
    try { (_lsJSON('yield_jobs', '[]') || []).forEach(add); } catch (e) {}
    return out;
  }

  function _menuSettings() {
    var a = (window.mSettings && (window.mSettings.savedDishes || window.mSettings.savedMenus)) ? window.mSettings : null;
    if (a) return a;
    var m = _lsJSON('mise_settings', '{}') || {};
    if ((m.savedDishes || m.savedMenus || m.savedClients)) return m;
    return _lsJSON('haccp_settings', '{}') || m;
  }

  // ── Context: everything the render needs, read once ──────
  function _buildContext() {
    var today = _todayStr();
    var jobs = _allJobs();
    var upcoming = jobs
      .filter(function (j) { var d = _jDate(j); return d && d >= today; })
      .sort(function (a, b) {
        var da = _jDate(a), db = _jDate(b);
        if (da !== db) return da < db ? -1 : 1;
        return (_jTime(a) || '').localeCompare(_jTime(b) || '');
      });

    var mset = _menuSettings();
    var ctx = {
      today: today,
      jobs: jobs,
      upcoming: upcoming,
      nextJob: upcoming[0] || null,
      quotes:   _lsJSON('yield_quotes', '[]')   || [],
      invoices: _lsJSON('yield_invoices', '[]') || [],
      payments: _lsJSON('yield_payments', '[]') || [],
      costings: _lsJSON('yield_costings', '[]') || [],
      haccpToday: _lsJSON('haccp_' + today, '[]') || [],
      dishes: (mset.savedDishes || []).length,
      menus:  (mset.savedMenus || []).length,
      clients: (mset.savedClients || []),
      mset: mset
    };
    ctx.hasAnyData = !!(
      jobs.length || ctx.quotes.length || ctx.invoices.length || ctx.payments.length ||
      ctx.costings.length || ctx.haccpToday.length || ctx.dishes || ctx.menus || ctx.clients.length
    );
    return ctx;
  }

  // ── HACCP core-check readiness for a given day ───────────
  var _HACCP_CORE = [
    { label: 'Opening checks', types: ['opening'], tiles: ['opening'] },
    { label: 'Fridge / freezer temperatures', types: ['fridge', 'freezer'], tiles: ['fridge'] },
    { label: 'Cooking / reheating temperatures', types: ['cooking', 'reheating'], tiles: ['cooking', 'reheating'] },
    { label: 'Cleaning', types: ['cleaning'], tiles: ['cleaning'] },
    { label: 'Closing checks', types: ['closing'], tiles: ['closing'] }
  ];
  // The list of checks that count towards "readiness". Defaults to the five
  // above, but honours the chef's HACCP tile settings (haccp_settings.
  // enabledTiles) so cold / prep-only / client-kitchen work isn't marked
  // incomplete for a check it never needs. Cooking is also dropped when the
  // booking has no cooked menu attached.
  function _applicableHaccpChecks(job) {
    var enabled = null;
    try {
      var hs = _lsJSON('haccp_settings', '{}') || {};
      if (hs.enabledTiles && typeof hs.enabledTiles === 'object') enabled = hs.enabledTiles;
    } catch (e) {}
    var hasCookedMenu = job && (job.menus || []).some(function (m) { return (m.dishes || []).length; });
    var list = _HACCP_CORE.filter(function (c) {
      if (enabled) {
        var anyOn = c.tiles.some(function (t) { return enabled[t] !== false; });
        if (!anyOn) return false;
      }
      if (c.tiles.indexOf('cooking') !== -1 && job && !hasCookedMenu) return false;
      return true;
    });
    return list.length ? list : _HACCP_CORE.slice();
  }
  function _haccpProgress(records, checks) {
    checks = checks || _HACCP_CORE;
    var done = 0;
    checks.forEach(function (c) {
      if ((records || []).some(function (r) { return c.types.indexOf(r.type) !== -1; })) done++;
    });
    return { done: done, total: checks.length };
  }

  // ── Greeting ────────────────────────────────────────────
  function _greeting(ctx) {
    var cached = _lsJSON('veriqo_profile', '{}') || {};
    var profile = (window.Mise && window.Mise.profile) || cached;
    var name = profile.chef_name || cached.chef_name || profile.business_name || cached.business_name || '';
    var hour = new Date().getHours();
    var greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    var sub;
    if (ctx.nextJob) {
      var du = _daysUntil(_jDate(ctx.nextJob));
      sub = du <= 0 ? 'You have a service today.'
          : du === 1 ? 'Your next service is tomorrow.'
          : 'Your next service is in ' + du + ' days.';
    } else if (ctx.hasAnyData) {
      sub = 'No upcoming bookings — here’s where your business stands.';
    } else {
      sub = 'Let’s set up your first booking.';
    }
    return '<h1 class="dbx-greeting">' + greet + (name ? ', ' + _esc(String(name).split(' ')[0]) : '') +
      '<small>' + _esc(sub) + '</small></h1>';
  }

  // ── Derived booking status (no explicit status field exists) ──
  function _bookingStatus(job, ctx) {
    var jq = ctx.quotes.filter(function (q) { return String(q.job_id) === String(job.id); });
    var ji = ctx.invoices.filter(function (inv) { return String(inv.job_id) === String(job.id); });
    var isToday = _jDate(job) === ctx.today;
    var accepted = jq.some(function (q) { return q.status === 'accepted'; });
    var depositPaid = job.tabDepositPaid || ji.some(function (inv) { return inv.type === 'deposit' && inv.status === 'paid'; });
    // "Confirmed" is only ever asserted from hard evidence (accepted quote or a
    // paid deposit). With nothing else known, the app only knows a booking was
    // added — it must not imply the client has confirmed.
    if (isToday) return { label: 'Service day', pill: 'info', icon: 'clock' };
    if (accepted || depositPaid) return { label: 'Confirmed', pill: 'ok', icon: 'check-circle' };
    if (jq.some(function (q) { return q.status === 'sent'; })) return { label: 'Quote sent', pill: 'neutral', icon: 'file-text' };
    if (jq.some(function (q) { return q.status === 'draft'; })) return { label: 'Quote in draft', pill: 'neutral', icon: 'file-text' };
    return { label: 'Planning', pill: 'neutral', icon: 'calendar' };
  }

  // ── Preparation progress rows for the next booking ───────
  function _prepRows(job, ctx) {
    var rows = [];
    var jid = _hid(job.id);
    var isToday = _jDate(job) === ctx.today;
    var near = _daysUntil(_jDate(job)) <= 1;

    // Menu
    var menus = job.menus || [];
    var dishCount = menus.reduce(function (s, m) { return s + ((m.dishes || []).length); }, 0);
    rows.push({
      label: 'Menu',
      state: dishCount > 0 ? 'done' : 'pending',
      status: dishCount > 0
        ? dishCount + ' ' + _plural(dishCount, 'dish', 'dishes') + ' across ' + menus.length + ' ' + _plural(menus.length, 'menu')
        : 'No menu attached yet',
      onclick: "vqDashViewJob('" + jid + "')"
    });

    // Client details / intake  (true intake-form completion is not stored — this is a proxy)
    var client = ctx.clients.filter(function (c) {
      return c.name && c.name.trim().toLowerCase() === (_jClient(job) || '').trim().toLowerCase();
    })[0];
    var hasContact = !!(job.email || job.phone || (client && (client.email || client.phone)));
    rows.push({
      label: 'Client details',
      state: hasContact ? 'done' : 'pending',
      status: hasContact ? 'Contact details on file' : 'No contact details — send an intake form',
      onclick: 'vqDashIntake()'
    });

    // Allergen information — a heuristic overlap check, not a clinical
    // determination. Both sides are run through the app's shared allergen
    // normaliser so known spelling variants line up; unrecognised free text
    // ("tree nuts", individual nut names) can still slip past, so the wording
    // stays "potential".
    var guests = job.guests || [];
    var gWith = guests.filter(function (g) { return g.allergens && g.allergens.length; });
    var norm = (window.Veriqo && typeof window.Veriqo.normalizeAllergen === 'function')
      ? window.Veriqo.normalizeAllergen
      : function (a) { return String(a || '').trim().toLowerCase(); };
    var dishAll = {};
    menus.forEach(function (m) {
      (m.dishes || []).forEach(function (d) {
        (d.allergens || []).forEach(function (a) { dishAll[norm(a)] = true; });
      });
    });
    var conflict = gWith.some(function (g) {
      return g.allergens.some(function (a) { return dishAll[norm(a)]; });
    });
    rows.push({
      label: 'Allergen information',
      state: conflict ? 'warn' : (guests.length ? 'done' : 'pending'),
      status: conflict
        ? 'Potential conflict — check guest allergens against the menu'
        : (guests.length
            ? guests.length + ' ' + _plural(guests.length, 'guest') + ' · ' + gWith.length + ' with allergens'
            : 'No guest allergen information collected'),
      onclick: "vqDashViewJob('" + jid + "')"
    });

    // Prep & Pack list
    var pp = (typeof prepPackStatus === 'function')
      ? prepPackStatus(job.prepAndPack)
      : { status: job.prepAndPack ? 'in_progress' : 'not_generated', checkedCount: 0, totalCount: 0 };
    rows.push({
      label: 'Prep & pack list',
      state: pp.status === 'ready' ? 'done' : 'pending',
      status: pp.status === 'ready' ? 'Packed and ready'
        : pp.status === 'in_progress' ? (pp.checkedCount + '/' + pp.totalCount + ' items packed')
        : 'List not started',
      onclick: "vqDashPrepPack('" + jid + "')"
    });

    // Quote / payment
    var jq = ctx.quotes.filter(function (q) { return String(q.job_id) === jid; });
    var ji = ctx.invoices.filter(function (inv) { return String(inv.job_id) === jid; });
    var paidFull = (ji.length && ji.every(function (inv) { return inv.status === 'paid'; })) || (job.tabDepositPaid && job.tabBalancePaid);
    var overdue = ji.some(function (inv) { return inv.status !== 'paid' && inv.due_date && inv.due_date < ctx.today; });
    var accepted = jq.some(function (q) { return q.status === 'accepted'; });
    var depositPaid = job.tabDepositPaid || ji.some(function (inv) { return inv.type === 'deposit' && inv.status === 'paid'; });
    var qpState, qpStatus, qpScreen = 'quotes', qpFilter = '';
    if (paidFull) { qpState = 'done'; qpStatus = 'Paid in full'; qpScreen = 'invoices'; qpFilter = 'paid'; }
    else if (overdue) { qpState = 'warn'; qpStatus = 'Invoice overdue'; qpScreen = 'invoices'; qpFilter = 'overdue'; }
    else if (depositPaid) { qpState = 'pending'; qpStatus = 'Deposit paid · balance outstanding'; qpScreen = 'invoices'; qpFilter = 'outstanding'; }
    else if (accepted) { qpState = 'pending'; qpStatus = 'Quote accepted · invoice to send'; qpScreen = 'invoices'; qpFilter = ''; }
    else if (jq.some(function (q) { return q.status === 'sent'; })) { qpState = 'pending'; qpStatus = 'Quote sent · awaiting client response'; qpScreen = 'quotes'; qpFilter = 'active'; }
    else if (jq.some(function (q) { return q.status === 'draft'; })) { qpState = 'warn'; qpStatus = 'Draft quote — not sent yet'; qpScreen = 'quotes'; qpFilter = 'active'; }
    else { qpState = 'pending'; qpStatus = 'No quote raised yet'; qpScreen = 'quotes'; qpFilter = ''; }
    rows.push({
      label: 'Quote & payment',
      state: qpState,
      status: qpStatus,
      onclick: "vqDashCosting('" + qpScreen + "','" + qpFilter + "')"
    });

    // HACCP readiness — surfaced from the day before, but it is only an
    // actionable, counted task ON the service date. For a future service it is
    // an 'info' row: shown for context, excluded from the readiness meter, the
    // outstanding-task count and next-action selection.
    if (near) {
      var checks = _applicableHaccpChecks(job);
      var hp = _haccpProgress(ctx.haccpToday, checks);
      if (isToday) {
        rows.push({
          label: 'HACCP readiness',
          state: hp.done === hp.total ? 'done' : 'pending',
          status: hp.done + ' of ' + hp.total + ' applicable ' + _plural(hp.total, 'check') + ' logged today',
          onclick: 'vqDashHaccp()'
        });
      } else {
        rows.push({
          label: 'HACCP readiness',
          state: 'info',
          status: 'Log your checks on the day of service',
          onclick: 'vqDashHaccp()'
        });
      }
    }

    return rows;
  }

  function _nextActionFor(rows, job, ctx) {
    var verb = {
      'Menu': 'Add a menu',
      'Client details': 'Send an intake form',
      'Allergen information': 'Review the allergen conflict',
      'Prep & pack list': 'Finish the prep & pack list',
      'Quote & payment': 'Sort the quote & payment',
      'HACCP readiness': 'Log today’s HACCP checks'
    };
    var near = _daysUntil(_jDate(job)) <= 1;
    // A warning (allergen conflict, overdue invoice, unsent draft) always wins.
    var warn = rows.filter(function (r) { return r.state === 'warn'; })[0];
    // Otherwise the first outstanding step — but sending an intake form is not a
    // meaningful "next action" once the service is today or tomorrow.
    var pending = rows.filter(function (r) {
      return r.state === 'pending' && !(near && r.label === 'Client details');
    })[0];
    var pick = warn || pending;
    if (pick) {
      var text = verb[pick.label] || 'Continue preparing';
      // The allergen row is only a "conflict" when state === 'warn'; when it is
      // merely 'pending' (no guest allergen info yet) say so accurately.
      if (pick.label === 'Allergen information' && pick.state === 'pending') text = 'Collect guest allergen details';
      return { text: text, onclick: pick.onclick };
    }
    return { text: 'Open booking', onclick: "vqDashViewJob('" + _hid(job.id) + "')" };
  }

  // ── Attention items (business actions) ──────────────────
  function _attentionItems(ctx) {
    var items = [];
    var today = ctx.today;

    var draftQ = ctx.quotes.filter(function (q) { return q.status === 'draft'; });
    if (draftQ.length) items.push({
      level: 'warn', icon: 'file-text',
      title: draftQ.length + ' draft ' + _plural(draftQ.length, 'quote') + ' not sent',
      sub: 'Finish and send them to secure the work',
      onclick: "vqDashCosting('quotes','active')",
      aria: 'Open quotes filtered to active'
    });

    var staleQ = ctx.quotes.filter(function (q) { return q.status === 'sent' && _daysAgo(q.created_at) >= 5; });
    if (staleQ.length) items.push({
      level: 'info', icon: 'clock',
      title: staleQ.length + ' ' + _plural(staleQ.length, 'quote') + ' awaiting a reply',
      sub: 'Sent 5+ days ago — a follow-up may help',
      onclick: "vqDashCosting('quotes','active')",
      aria: 'Open quotes filtered to active'
    });

    var overdueInv = ctx.invoices.filter(function (inv) { return inv.status !== 'paid' && inv.due_date && inv.due_date < today; });
    if (overdueInv.length) {
      var oAmt = overdueInv.reduce(function (s, inv) { return s + (parseFloat(inv.total || 0) - parseFloat(inv.paid_total || 0)); }, 0);
      items.push({
        level: 'urgent', icon: 'banknote',
        title: overdueInv.length + ' overdue ' + _plural(overdueInv.length, 'invoice'),
        sub: _money(oAmt) + ' outstanding',
        onclick: "vqDashCosting('invoices','overdue')",
        aria: 'Open invoices filtered to overdue'
      });
    }

    var openInv = ctx.invoices.filter(function (inv) { return inv.status !== 'paid' && !(inv.due_date && inv.due_date < today); });
    if (openInv.length) {
      var uAmt = openInv.reduce(function (s, inv) { return s + (parseFloat(inv.total || 0) - parseFloat(inv.paid_total || 0)); }, 0);
      items.push({
        level: 'info', icon: 'clock',
        title: openInv.length + ' ' + _plural(openInv.length, 'invoice') + ' awaiting payment',
        sub: _money(uAmt) + ' due',
        onclick: "vqDashCosting('invoices','outstanding')",
        aria: 'Open invoices filtered to outstanding'
      });
    }

    // Other upcoming jobs (not the headline booking, which the prep card covers)
    // that are missing something needed to prepare them.
    var nextId = ctx.nextJob ? String(ctx.nextJob.id) : null;
    var missing = ctx.upcoming.filter(function (j) {
      if (String(j.id) === nextId) return false;
      return !_jCovers(j) || !_jLocation(j) || !_jTime(j) || !(j.menus && j.menus.length);
    });
    if (missing.length) items.push({
      level: 'warn', icon: 'alert-triangle',
      title: missing.length + ' upcoming ' + _plural(missing.length, 'job') + ' missing key details',
      sub: 'Add covers, location, timing or a menu',
      onclick: 'vqDashJobs()',
      aria: 'Open the jobs list'
    });

    return items;
  }

  // ── Performance (used on the no-booking overview) ───────
  function _performance(ctx) {
    var now = new Date();
    var m = now.getMonth(), y = now.getFullYear();
    var lm = new Date(y, m - 1, 1);
    function inMonth(iso, mm, yy) {
      if (!iso) return false;
      var d = new Date(iso);
      return d.getMonth() === mm && d.getFullYear() === yy;
    }
    var revThis = ctx.payments.filter(function (p) { return inMonth(p.paid_at, m, y); })
      .reduce(function (s, p) { return s + parseFloat(p.amount || 0); }, 0);
    var revLast = ctx.payments.filter(function (p) { return inMonth(p.paid_at, lm.getMonth(), lm.getFullYear()); })
      .reduce(function (s, p) { return s + parseFloat(p.amount || 0); }, 0);
    var monthKey = _todayStr().slice(0, 7);
    var jobsThisMonth = ctx.jobs.filter(function (j) { return _jDate(j).slice(0, 7) === monthKey; }).length;
    var openQuotes = ctx.quotes.filter(function (q) { return q.status === 'draft' || q.status === 'sent'; }).length;
    return {
      revThis: revThis, revLast: revLast,
      jobsThisMonth: jobsThisMonth,
      openQuotes: openQuotes,
      hasData: !!(ctx.payments.length || ctx.jobs.length || ctx.quotes.length)
    };
  }

  // ═══════════════════════════════ RENDER FRAGMENTS ═══════

  function _bookingCard(ctx) {
    var job = ctx.nextJob;
    var date = _jDate(job);
    var du = _daysUntil(date);
    var dObj = new Date(date + 'T12:00:00');
    var when = du <= 0 ? 'Today' : du === 1 ? 'Tomorrow' : (du < 7 ? 'In ' + du + ' days' : dObj.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }));
    var absLine = dObj.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + (_jTime(job) ? ' · ' + _esc(_jTime(job)) : '');
    var st = _bookingStatus(job, ctx);
    var rows = _prepRows(job, ctx);
    var next = _nextActionFor(rows, job, ctx);

    var facts = [];
    facts.push('<li>' + _ico('users', 16) + '<span><b>Guests</b>' + (_jCovers(job) ? _esc(_jCovers(job)) + ' covers' : 'Not set') + '</span></li>');
    facts.push('<li>' + _ico('clock', 16) + '<span><b>Arrival / service</b>' + (_jTime(job) ? _esc(_jTime(job)) : 'Not set') + '</span></li>');
    facts.push('<li><span><b>Location</b>' + (_jLocation(job) ? _esc(_jLocation(job)) : 'Not set') + '</span></li>');
    if (_jType(job)) facts.push('<li>' + _ico('book-open', 16) + '<span><b>Type</b>' + _esc(_jType(job)) + '</span></li>');
    facts.push('<li>' + _ico(st.icon, 16) + '<span><b>Status</b><span class="dbx-pill dbx-pill-' + st.pill + '">' + _ico(st.icon, 13) + _esc(st.label) + '</span></span></li>');

    return '' +
      '<section class="dbx-section" aria-label="Next booking">' +
        '<div class="dbx-section-head"><span class="dbx-section-title">Next booking</span>' +
          '<button type="button" class="dbx-section-link" onclick="vqDashJobs()">All bookings</button></div>' +
        '<div class="dbx-booking">' +
          '<div class="dbx-booking-top">' +
            '<span class="dbx-booking-when">' + _esc(when) + '<span>' + _esc(absLine) + '</span></span>' +
          '</div>' +
          '<div class="dbx-booking-body">' +
            '<div class="dbx-booking-client">' + _esc(_jClient(job) || 'Unnamed client') + '</div>' +
            '<ul class="dbx-facts">' + facts.join('') + '</ul>' +
            '<div class="dbx-btn-row">' +
              '<button type="button" class="dbx-btn dbx-btn-primary" onclick="' + next.onclick + '">' + _ico('check-circle', 16) + _esc(next.text) + '</button>' +
              '<button type="button" class="dbx-btn dbx-btn-secondary" onclick="vqDashViewJob(\'' + _hid(job.id) + '\')">Open booking</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</section>';
  }

  function _prepRowHTML(r) {
    var icoClass = r.state === 'done' ? 'dbx-prep-ico-done' : r.state === 'warn' ? 'dbx-prep-ico-warn' : 'dbx-prep-ico-pending';
    var icoName = r.state === 'done' ? 'check-circle' : r.state === 'warn' ? 'alert-triangle' : 'clock';
    var main =
      '<span class="dbx-prep-ico ' + icoClass + '">' + _ico(icoName, 16) + '</span>' +
      '<span class="dbx-prep-main">' +
        '<span class="dbx-prep-label">' + _esc(r.label) + '</span>' +
        '<span class="dbx-prep-status' + (r.state === 'warn' ? ' is-warn' : '') + '">' + _esc(r.status) + '</span>' +
      '</span>';
    // 'info' rows are contextual only — not actionable, not a button.
    if (r.state === 'info') {
      return '<li class="dbx-prep-static">' + main + '</li>';
    }
    return '<li><button type="button" class="dbx-prep-item" onclick="' + r.onclick + '" aria-label="' + _esc(r.label + ': ' + r.status) + '">' +
      main + '<span class="dbx-prep-chevron">' + _chev() + '</span></button></li>';
  }

  function _prepSection(ctx) {
    var job = ctx.nextJob;
    var rows = _prepRows(job, ctx);
    var order = { warn: 0, pending: 1, info: 2, done: 3 };
    rows.sort(function (a, b) { return order[a.state] - order[b.state]; });

    // Readiness counts only gradable tasks — 'info' rows (e.g. a future
    // service's HACCP row) are excluded from the meter and the "N ready" total.
    var gradable = rows.filter(function (r) { return r.state !== 'info'; });
    var done = gradable.filter(function (r) { return r.state === 'done'; }).length;
    var total = gradable.length;
    var pct = total ? Math.round(done / total * 100) : 0;

    var doneRows = rows.filter(function (r) { return r.state === 'done'; });
    var collapseDone = doneRows.length >= 2;
    var visibleRows = collapseDone ? rows.filter(function (r) { return r.state !== 'done'; }) : rows;

    var mainList = '<ul class="dbx-prep-list">' + visibleRows.map(_prepRowHTML).join('') + '</ul>';
    var doneList = collapseDone
      ? '<details class="dbx-prep-done"><summary>' + doneRows.length + ' ready — show</summary>' +
          '<ul class="dbx-prep-list">' + doneRows.map(_prepRowHTML).join('') + '</ul></details>'
      : '';

    return '' +
      '<section class="dbx-section" aria-label="Preparation progress">' +
        '<div class="dbx-section-head"><span class="dbx-section-title">Preparation progress</span></div>' +
        '<div class="dbx-card">' +
          '<div class="dbx-meter" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100" aria-label="Booking preparation ' + pct + ' percent complete">' +
            '<div class="dbx-meter-fill" style="width:' + pct + '%"></div>' +
          '</div>' +
          '<div class="dbx-meter-caption">' + done + ' of ' + total + ' ready</div>' +
          mainList + doneList +
        '</div>' +
      '</section>';
  }

  function _attentionSection(ctx) {
    var items = _attentionItems(ctx);
    var fresh = _costingFresh();
    var body;
    if (!items.length) {
      body = '<div class="dbx-clear">' + _ico('check-circle', 18) +
        (fresh
          ? '<span>Nothing outstanding — no unsent quotes, overdue invoices or bookings missing details.</span>'
          : '<span>Nothing outstanding in your saved data. Open Costing to sync the latest quotes and invoices.</span>') +
        '</div>';
    } else {
      body = '<ul class="dbx-attn-list">' + items.map(function (it) {
        var cls = it.level === 'urgent' ? ' is-urgent' : it.level === 'info' ? ' is-info' : '';
        return '<li><button type="button" class="dbx-attn-item' + cls + '" onclick="' + it.onclick + '" aria-label="' + _esc((it.aria || it.title)) + '">' +
          _ico(it.icon, 18) +
          '<span class="dbx-attn-main">' +
            '<span class="dbx-attn-title">' + _esc(it.title) + '</span>' +
            '<span class="dbx-attn-sub">' + _esc(it.sub) + '</span>' +
          '</span>' +
          '<span class="dbx-attn-chevron">' + _chev() + '</span>' +
        '</button></li>';
      }).join('') + '</ul>';
    }
    return '' +
      '<section class="dbx-section" aria-label="Needs attention">' +
        '<div class="dbx-section-head"><span class="dbx-section-title">Needs attention</span></div>' +
        body +
      '</section>';
  }

  function _performanceSection(ctx) {
    var p = _performance(ctx);
    // Private-chef income is irregular and seasonal, so this is shown as a plain
    // factual comparison, not a trend / performance percentage.
    var deltaHtml = (p.revLast > 0)
      ? '<div class="dbx-stat-delta">' + _money(p.revLast) + ' last month</div>'
      : '';
    var staleNote = _costingFresh() ? '' :
      '<div class="dbx-meter-caption" style="margin-top:8px">Figures update when you next open Costing.</div>';
    var revBody = p.hasData
      ? '<div class="dbx-stats">' +
          '<div class="dbx-stat"><div class="dbx-stat-num">' + _money(p.revThis) + '</div><div class="dbx-stat-label">Payments received this month</div>' + deltaHtml + '</div>' +
          '<div class="dbx-stat"><div class="dbx-stat-num">' + p.jobsThisMonth + '</div><div class="dbx-stat-label">' + _plural(p.jobsThisMonth, 'Job', 'Jobs') + ' this month</div></div>' +
          '<div class="dbx-stat"><div class="dbx-stat-num">' + p.openQuotes + '</div><div class="dbx-stat-label">Open ' + _plural(p.openQuotes, 'quote') + '</div></div>' +
        '</div>' + staleNote
      : '<div class="dbx-clear">' + _ico('trending-up', 18) + '<span>No completed jobs or payments yet — your activity summary appears here once you’ve run a booking.</span></div>';
    return '' +
      '<section class="dbx-section" aria-label="Recent activity">' +
        '<div class="dbx-section-head"><span class="dbx-section-title">Recent activity</span></div>' +
        revBody +
      '</section>';
  }

  function _noBookingPrimary(ctx) {
    return '' +
      '<section class="dbx-section" aria-label="No upcoming bookings">' +
        '<div class="dbx-card">' +
          '<div class="dbx-empty">' +
            '<div class="dbx-empty-ico">' + _ico('calendar', 24) + '</div>' +
            '<div class="dbx-empty-title">No upcoming bookings</div>' +
            '<p class="dbx-empty-body">When you have a confirmed date, this space shows the client, guest count, preparation progress and what to do next. In the meantime, keep quotes and invoices moving below.</p>' +
            '<div class="dbx-btn-row" style="justify-content:center">' +
              '<button type="button" class="dbx-btn dbx-btn-primary" onclick="vqDashNewJob()">' + _ico('plus', 16) + 'Create a job</button>' +
              '<button type="button" class="dbx-btn dbx-btn-secondary" onclick="vqDashIntake()">Send a client intake form</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</section>';
  }

  function _newUser(ctx) {
    return '<div class="dbx">' +
      _greeting(ctx) +
      '<section class="dbx-section">' +
        '<div class="dbx-card">' +
          '<div class="dbx-empty">' +
            '<div class="dbx-empty-ico">' + _ico('calendar', 24) + '</div>' +
            '<div class="dbx-empty-title">Welcome to Veriqo</div>' +
            '<p class="dbx-empty-body">Veriqo keeps a private chef’s bookings, menus, allergen records, quotes and food-safety logs in one place. Start by creating your first job — everything else builds around it.</p>' +
            '<div class="dbx-btn-row" style="justify-content:center">' +
              '<button type="button" class="dbx-btn dbx-btn-primary" onclick="vqDashNewJob()">' + _ico('plus', 16) + 'Create your first job</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</section>' +
      _modulesSection(ctx, false) +
      '</div>';
  }

  // ── Secondary module summaries ─────────────────────────
  function _moduleAccess(name) {
    var sub = (window.Mise && window.Mise.subscription) ? window.Mise.subscription.current() : null;
    return !sub || (typeof window.canAccess === 'function' ? window.canAccess(name) : true);
  }

  function _haccpTotals() {
    var days = 0;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('haccp_') === 0 &&
            k !== 'haccp_settings' && k !== 'haccp_suppliers' && k !== 'haccp_credentials') days++;
      }
    } catch (e) {}
    return days;
  }

  function _modCard(name, iconName, title, factsHtml, opts) {
    opts = opts || {};
    if (!_moduleAccess(name)) {
      return '<button type="button" class="dbx-mod dbx-mod-locked" onclick="vqDashGo(\'' + name + '\')" aria-label="' + _esc(title) + ' — not on your current plan. Open to see upgrade options.">' +
        '<span class="dbx-mod-head">' + _ico(iconName, 18) + '<span class="dbx-mod-name">' + _esc(title) + '</span><span class="dbx-mod-chevron">' + _chev() + '</span></span>' +
        '<span class="dbx-mod-locknote">Not included on your current plan.</span>' +
        '<span class="dbx-mod-unlock">Unlock ' + _esc(title) + ' →</span>' +
      '</button>';
    }
    return '<button type="button" class="dbx-mod" onclick="vqDashGo(\'' + name + '\')" aria-label="Open ' + _esc(title) + '">' +
      '<span class="dbx-mod-head">' + _ico(iconName, 18) + '<span class="dbx-mod-name">' + _esc(title) + '</span>' +
        (opts.badge ? '<span class="dbx-pill dbx-pill-' + opts.badgePill + '">' + _esc(opts.badge) + '</span>' : '') +
        '<span class="dbx-mod-chevron">' + _chev() + '</span></span>' +
      '<span class="dbx-mod-facts">' + factsHtml + '</span>' +
    '</button>';
  }

  function _modulesSection(ctx, allowContextOrder) {
    var du = ctx.nextJob ? _daysUntil(_jDate(ctx.nextJob)) : Infinity;
    var near = allowContextOrder && du <= 1;         // prominence / ordering (today or tomorrow)
    var serviceToday = allowContextOrder && du <= 0; // "checks logged today" phrasing

    var SETUP = 'Not set up yet — open to get started';

    var totalDays = _haccpTotals();
    var haccpFacts;
    if (serviceToday) {
      var hp = _haccpProgress(ctx.haccpToday, _applicableHaccpChecks(ctx.nextJob));
      haccpFacts = '<strong>' + hp.done + ' of ' + hp.total + '</strong> applicable ' + _plural(hp.total, 'check') + ' logged today';
    } else if (totalDays === 0 && ctx.haccpToday.length === 0) {
      haccpFacts = SETUP;
    } else {
      haccpFacts = '<strong>' + totalDays + '</strong> ' + _plural(totalDays, 'day') + ' on record · <strong>' + ctx.haccpToday.length + '</strong> ' + _plural(ctx.haccpToday.length, 'log') + ' today';
    }
    var haccpCard = _modCard('haccp', 'shield-check', 'HACCP', haccpFacts,
      near ? { badge: du <= 0 ? 'Service today' : 'Service tomorrow', badgePill: 'info' } : null);

    var menusCard = _modCard('menus', 'clipboard-list', 'Menus',
      (ctx.dishes === 0 && ctx.menus === 0)
        ? SETUP
        : '<strong>' + ctx.dishes + '</strong> ' + _plural(ctx.dishes, 'dish', 'dishes') + ' · <strong>' + ctx.menus + '</strong> saved ' + _plural(ctx.menus, 'menu'));

    var gps = ctx.costings.map(function (c) { return parseFloat(c.gp_percent) || 0; }).filter(function (n) { return n > 0; });
    var avgGp = gps.length ? Math.round(gps.reduce(function (a, b) { return a + b; }, 0) / gps.length) : 0;
    var openQ = ctx.quotes.filter(function (q) { return q.status === 'draft' || q.status === 'sent'; }).length;
    var costingFacts;
    if (!ctx.costings.length && !ctx.quotes.length && !ctx.invoices.length) {
      costingFacts = SETUP;
    } else {
      costingFacts = (avgGp > 0 ? 'Avg GP <strong>' + avgGp + '%</strong> · ' : '') +
        '<strong>' + openQ + '</strong> open ' + _plural(openQ, 'quote') +
        (avgGp === 0 ? ' · add costings to track GP' : '');
    }
    var costingCard = _modCard('costing', 'coins', 'Costing', costingFacts);

    var cards = near ? [haccpCard, menusCard, costingCard] : [menusCard, costingCard, haccpCard];

    return '' +
      '<section class="dbx-section" aria-label="Module summaries">' +
        '<div class="dbx-section-head"><span class="dbx-section-title">Your modules</span></div>' +
        '<div class="dbx-modules">' + cards.join('') + '</div>' +
      '</section>';
  }

  // ── Render ────────────────────────────────────────────────
  function render() {
    if (!_container) return;
    var ctx;
    try { ctx = _buildContext(); }
    catch (e) {
      console.warn('[dashboard] context build failed', e);
      _container.innerHTML = '<div class="dbx"><div class="dbx-card">Dashboard could not load. Pull to refresh or reopen the app.</div></div>';
      return;
    }

    if (!ctx.hasAnyData) { _container.innerHTML = _newUser(ctx); return; }

    var html = '<div class="dbx">' + _greeting(ctx);

    if (ctx.nextJob) {
      html += _bookingCard(ctx);
      html += '<div class="dbx-split">' + _prepSection(ctx) + _attentionSection(ctx) + '</div>';
    } else {
      html += _noBookingPrimary(ctx);
      html += '<div class="dbx-split">' + _attentionSection(ctx) + _performanceSection(ctx) + '</div>';
    }

    html += _modulesSection(ctx, true);
    html += '</div>';
    _container.innerHTML = html;
  }

  return { init: init, render: render };

})();

// ── Navigation helpers (referenced by the dashboard's own buttons) ─────────
// Kept on window so they resolve for inline handlers and so deep-links can
// wait for a lazily-initialised module to mount before switching screen.
(function () {
  function _defer(fn) { setTimeout(fn, 60); }

  window.vqDashGo = function (module) {
    if (typeof showModule === 'function') showModule(module);
  };
  window.vqDashHaccp = function () { window.vqDashGo('haccp'); };
  window.vqDashJobs = function () {
    window.vqDashGo('menus');
    _defer(function () { if (typeof showTab === 'function') showTab('jobs'); });
  };
  window.vqDashNewJob = function () {
    window.vqDashGo('menus');
    _defer(function () {
      if (typeof startNewJob === 'function') startNewJob();
      else if (typeof showTab === 'function') showTab('jobs');
    });
  };
  window.vqDashViewJob = function (id) {
    window.vqDashGo('menus');
    _defer(function () {
      if (typeof calViewJob === 'function') calViewJob(id);
      else if (typeof showTab === 'function') showTab('jobs');
    });
  };
  window.vqDashPrepPack = function (id) {
    if (typeof openPrepAndPackForJob === 'function') openPrepAndPackForJob(id);
    else window.vqDashViewJob(id);
  };
  window.vqDashIntake = function () {
    if (typeof openIntakeFormModal === 'function') openIntakeFormModal();
    else window.vqDashJobs();
  };
  window.vqDashCosting = function (screen, filter) {
    window.vqDashGo('costing');
    _defer(function () {
      // If Costing isn't accessible on this plan, showModule rendered the
      // upgrade tease and the inner screens don't exist — stop here.
      if (!document.getElementById('screen-' + (screen || 'dashboard'))) return;
      if (typeof showScreen === 'function') showScreen(screen || 'dashboard');
      _defer(function () {
        if (filter && screen === 'invoices' && typeof filterInvoices === 'function') filterInvoices(filter);
        if (filter && screen === 'quotes' && typeof filterQuotes === 'function') filterQuotes(filter);
      });
    });
  };
})();
