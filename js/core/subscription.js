// js/core/subscription.js v1 — Veriqo unified subscription layer
// Plans: null (trial), starter, pro
// Replaces: subscription.js v9, carte-subscription.js, yield-subscription.js

window.Mise = window.Mise || {};
window.Mise.subscription = (function () {

  var _state = null; // { status, plan, starter_module, trial_ends_at, in_trial }

  // ── check ─────────────────────────────────────────────────
  async function check(profile) {
    var status       = profile.subscription_status || 'trial';
    var plan         = profile.subscription_plan   || null;
    var starterMod   = profile.starter_module      || null;
    var trialEnd     = profile.trial_ends_at ? new Date(profile.trial_ends_at) : null;
    // null trial_ends_at on a trial account = unlimited trial (no expiry set)
    var inTrial      = status === 'trial' && (!trialEnd || trialEnd > new Date());

    // Normalise legacy plan names to new 2-tier scheme
    if (plan === 'veriqo' || plan === 'suite' || plan === 'suite-all' || plan === 'carte' || plan === 'yield') {
      plan = 'pro';
    }

    _state = { status, plan, starter_module: starterMod, trial_ends_at: trialEnd, in_trial: inTrial };

    // Inject trial banner if needed
    _injectTrialBanner(status, trialEnd, inTrial);

    return _state;
  }

  // ── current ───────────────────────────────────────────────
  function current() {
    return _state;
  }

  // ── canAccess ─────────────────────────────────────────────
  // Dashboard and Settings are always accessible.
  // haccp / menus / costing require pro, matching starter_module, or active trial.
  function canAccess(moduleName) {
    if (moduleName === 'dashboard' || moduleName === 'settings') return true;
    if (!_state) return true; // pre-auth — allow (auth will gate if needed)
    if (_state.in_trial) return true;
    if (_state.plan === 'pro' && _state.status === 'active') return true;
    if (_state.plan === 'starter' && _state.status === 'active') {
      return _state.starter_module === moduleName;
    }
    return false; // expired, past_due, cancelled
  }

  // ── trial banner ──────────────────────────────────────────
  function _injectTrialBanner(status, trialEnd, inTrial) {
    var existing = document.getElementById('vq-trial-banner');
    if (existing) existing.remove();

    if (!inTrial) return;

    var daysLeft = trialEnd ? Math.ceil((trialEnd - new Date()) / (1000 * 60 * 60 * 24)) : 0;
    if (daysLeft > 7) return; // only show banner in last 7 days

    var banner = document.createElement('div');
    banner.id = 'vq-trial-banner';
    banner.className = 'trial-banner';
    banner.innerHTML = '<span>⏳ ' + daysLeft + ' day' + (daysLeft !== 1 ? 's' : '') + ' left on your free trial</span>'
      + '<a href="/upgrade">Upgrade to Pro →</a>';

    var app = document.querySelector('.vq-app') || document.querySelector('.app') || document.body;
    app.insertAdjacentElement('afterbegin', banner);
  }

  return { check, current, canAccess };

})();
