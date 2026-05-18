// js/modules/dashboard.js v1 — Veriqo Dashboard
// Cross-module KPI cards, locked module widgets, nudges.
// Called by showModule('dashboard') after first navigation.

window.modules = window.modules || {};
window.modules.dashboard = (function () {

  var _container = null;
  var _inited    = false;

  // ── Public init ───────────────────────────────────────────
  function init(container) {
    _container = container;
    _inited    = true;
    render();
    // Re-render when sync data arrives
    document.addEventListener('vq:sync-complete', render);
  }

  // ── Render ────────────────────────────────────────────────
  function render() {
    if (!_container) return;

    var cachedProfile = {};
    try { cachedProfile = JSON.parse(localStorage.getItem('veriqo_profile') || '{}'); } catch(e) {}
    var profile  = (window.Mise && window.Mise.profile)  || cachedProfile;
    var sub      = (window.Mise && window.Mise.subscription) ? window.Mise.subscription.current() : null;
    var canHaccp    = !sub || (typeof window.canAccess === 'function' ? window.canAccess('haccp')    : true);
    var canMenus    = !sub || (typeof window.canAccess === 'function' ? window.canAccess('menus')    : true);
    var canCosting  = !sub || (typeof window.canAccess === 'function' ? window.canAccess('costing')  : true);

    var name = profile.chef_name || cachedProfile.chef_name || profile.business_name || cachedProfile.business_name || '';

    _container.innerHTML =
      '<div class="dashboard-wrap">' +
        _greeting(name) +
        _haccpCard(canHaccp) +
        _menusCard(canMenus) +
        _costingCard(canCosting) +
      '</div>';
  }

  // ── Greeting ──────────────────────────────────────────────
  function _greeting(name) {
    var hour = new Date().getHours();
    var greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    return '<div class="db-greeting">' + greet + (name ? ', ' + name.split(' ')[0] : '') + '</div>';
  }

  // ── HACCP KPI card ────────────────────────────────────────
  function _haccpCard(canAccess) {
    if (!canAccess) return _lockedCard('haccp', vqIcon('shield-check', 20), 'HACCP', 'Digital food safety logs, temp checks & allergen compliance.', 'Industry avg: 2 temp breaches/week');
    var records = _getHaccpRecords();
    var todayCount = records.today;
    var totalDays  = records.totalDays;
    var overdueCount = records.overdue;
    var statusClass = overdueCount > 0 ? 'warn' : 'ok';
    var statusText  = overdueCount > 0 ? overdueCount + ' overdue' : 'All clear';
    return _kpiCard('haccp', vqIcon('shield-check', 20), 'HACCP',
      '<div class="db-kpi-row">' +
        '<div class="db-kpi"><span class="db-kpi-num">' + todayCount + '</span><span class="db-kpi-label">Logs today</span></div>' +
        '<div class="db-kpi"><span class="db-kpi-num">' + totalDays + '</span><span class="db-kpi-label">Days on record</span></div>' +
        '<div class="db-kpi db-kpi-' + statusClass + '"><span class="db-kpi-num">' + statusText + '</span><span class="db-kpi-label">Checks</span></div>' +
      '</div>'
    );
  }

  // ── Menus KPI card ────────────────────────────────────────
  function _menusCard(canAccess) {
    if (!canAccess) return _lockedCard('menus', vqIcon('clipboard-list', 20), 'Menus', 'Dish specs, allergen tracking and professional menu builder.', 'Industry avg: 24 dishes per chef');
    var data = _getMenusData();
    return _kpiCard('menus', vqIcon('clipboard-list', 20), 'Menus',
      '<div class="db-kpi-row">' +
        '<div class="db-kpi"><span class="db-kpi-num">' + data.dishes + '</span><span class="db-kpi-label">Dishes</span></div>' +
        '<div class="db-kpi"><span class="db-kpi-num">' + data.menus + '</span><span class="db-kpi-label">Saved menus</span></div>' +
        (data.allergenAlerts > 0 ? '<div class="db-kpi db-kpi-warn"><span class="db-kpi-num">' + data.allergenAlerts + '</span><span class="db-kpi-label">Allergen alerts</span></div>' : '') +
      '</div>'
    );
  }

  // ── Costing KPI card ──────────────────────────────────────
  function _costingCard(canAccess) {
    if (!canAccess) return _lockedCard('costing', vqIcon('coins', 20), 'Costing', 'Food cost calculator, GP% tracking, quotes and invoices.', 'Industry avg GP: 68%');
    var data = _getCostingData();
    var gpClass = data.gp >= 65 ? 'ok' : data.gp >= 50 ? 'warn' : 'fail';
    return _kpiCard('costing', vqIcon('coins', 20), 'Costing',
      '<div class="db-kpi-row">' +
        '<div class="db-kpi db-kpi-' + gpClass + '"><span class="db-kpi-num">' + (data.gp > 0 ? data.gp + '%' : '—') + '</span><span class="db-kpi-label">Avg GP</span></div>' +
        '<div class="db-kpi"><span class="db-kpi-num">' + data.openQuotes + '</span><span class="db-kpi-label">Open quotes</span></div>' +
      '</div>'
    );
  }

  // ── Card builders ─────────────────────────────────────────
  function _kpiCard(module, icon, label, content) {
    return '<div class="db-card" onclick="showModule(\'' + module + '\')">' +
      '<div class="db-card-header"><span class="db-card-icon">' + icon + '</span><span class="db-card-label">' + label + '</span><span class="db-card-arrow">›</span></div>' +
      content +
    '</div>';
  }

  function _lockedCard(module, icon, label, value, benchmark) {
    return '<div class="db-card db-card-locked">' +
      '<div class="db-card-header"><span class="db-card-icon">' + icon + '</span><span class="db-card-label">' + label + '</span><span class="db-lock-badge">🔒</span></div>' +
      '<div class="db-locked-value">' + value + '</div>' +
      '<div class="db-benchmark">' + benchmark + '</div>' +
      '<button class="db-upgrade-btn" onclick="showModule(\'' + module + '\')">Unlock ' + label + ' →</button>' +
    '</div>';
  }

  // ── Data readers (from localStorage) ─────────────────────
  function _getHaccpRecords() {
    try {
      var today = new Date().toISOString().slice(0, 10);
      var records = JSON.parse(localStorage.getItem('haccp_' + today) || '[]');
      var totalDays = 0;
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('haccp_') === 0 && k !== 'haccp_settings' && k !== 'haccp_suppliers' && k !== 'haccp_credentials') totalDays++;
      }
      return { today: records.length, overdue: 0, totalDays: totalDays };
    } catch(e) { return { today: 0, overdue: 0, totalDays: 0 }; }
  }

  function _getMenusData() {
    try {
      var s = JSON.parse(localStorage.getItem('haccp_settings') || '{}');
      var dishes = (s.savedDishes || []).length;
      var menus  = (s.savedMenus  || []).length;
      return { dishes: dishes, menus: menus, allergenAlerts: 0 };
    } catch(e) { return { dishes: 0, menus: 0, allergenAlerts: 0 }; }
  }

  function _getCostingData() {
    try {
      var costings   = JSON.parse(localStorage.getItem('yield_costings') || '[]');
      var quotes     = JSON.parse(localStorage.getItem('yield_quotes')   || '[]');
      var openQuotes = quotes.filter(function(q) { return q.status === 'draft' || q.status === 'sent'; }).length;
      var gps = costings.map(function(c) { return parseFloat(c.gp_percent) || 0; }).filter(function(n) { return n > 0; });
      var avgGp = gps.length ? Math.round(gps.reduce(function(a, b) { return a + b; }, 0) / gps.length) : 0;
      return { gp: avgGp, openQuotes: openQuotes };
    } catch(e) { return { gp: 0, openQuotes: 0 }; }
  }

  return { init: init, render: render };

})();
