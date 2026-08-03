// js/core/subscription.js v4 — Veriqo unified subscription layer
// Plans: null (trial), starter (HACCP), pro
// Replaces: subscription.js v9, carte-subscription.js, yield-subscription.js

window.Mise = window.Mise || {};
window.Mise.subscription = (function () {

  var _state = null; // { status, plan, starter_module, trial_ends_at, in_trial }

  // ── hasAccess ─────────────────────────────────────────────
  // Single source of truth for "is this subscription_status in good standing".
  // 'trial' is the legacy in-app trial value (superseded by in_trial below,
  // which also checks trial_ends_at); 'active'/'trialing' come from Stripe —
  // trialing must be entitled or every Stripe-trial user is locked out the
  // moment the webhook starts reporting real subscription state.
  var _ENTITLED_STATUSES = { active: 1, trialing: 1, trial: 1 };
  function hasAccess(status) {
    return !!_ENTITLED_STATUSES[status];
  }

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

    // If trial has expired but DB still says 'trial', flip it to 'expired'
    if (status === 'trial' && trialEnd && trialEnd <= new Date()) {
      try {
        var { data: { user } } = await supabaseClient.auth.getUser();
        if (user) {
          await supabaseClient.from('profiles').update({ subscription_status: 'expired' }).eq('id', user.id);
          _state.status = 'expired';
        }
      } catch(e) { console.warn('[Subscription] failed to flip expired status', e); }
    }

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
  // haccp / menus / costing require pro or active trial. Starter is HACCP-only.
  function canAccess(moduleName) {
    if (moduleName === 'dashboard' || moduleName === 'settings') return true;
    if (!_state) return true; // pre-auth — allow (auth will gate if needed)
    // Role-based access for venue team members
    var _p = window.Mise && window.Mise.profile;
    if (_p && _p.venue_id && _p.role) {
      if (_p.role === 'admin') return true;           // admins get full access
      if (_p.role === 'staff') return moduleName === 'haccp'; // staff: HACCP only
    }
    if (_state.in_trial) return true;
    if (hasAccess(_state.status) && _state.plan === 'pro') return true;
    if (hasAccess(_state.status) && _state.plan === 'starter') {
      return moduleName === 'haccp';
    }
    return false; // expired, past_due, unpaid, cancelled/canceled
  }

  // ── startCheckout ─────────────────────────────────────────
  // plan: 'pro' | 'starter'
  // period: 'monthly' | 'annual'
  // starterModule kept for legacy compatibility. Starter is sold as HACCP-only.
  async function startCheckout(plan, period, starterModule) {
    var btn = document.activeElement;
    try {
      var res = await supabaseClient.auth.getSession();
      var token = res.data.session && res.data.session.access_token;
      if (!token) { if (typeof toast === 'function') toast('Please sign in first', false); return; }
      if (btn && btn.tagName === 'BUTTON') { btn.disabled = true; btn.textContent = 'Loading…'; }
      var payload = { plan: plan || 'pro', period: period || 'monthly' };
      if (plan === 'starter') payload.starter_module = starterModule || 'haccp';
      var r = await fetch('https://yixrwyfodipfcbhjcszp.supabase.co/functions/v1/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'apikey': SUPABASE_ANON },
        body: JSON.stringify(payload)
      });
      var data = await r.json();
      if (!r.ok || !data.url) throw new Error(data.error || 'Checkout unavailable');
      vqTrack('checkout_started', { plan: plan || 'pro', period: period || 'monthly' });
      window.location.href = data.url;
    } catch(err) {
      if (btn && btn.tagName === 'BUTTON') { btn.disabled = false; btn.textContent = btn._origText || 'Subscribe'; }
      if (typeof toast === 'function') toast('Could not start checkout — please try again', false);
      console.error('[Subscription] startCheckout:', err);
    }
  }

  // ── trial banner ──────────────────────────────────────────
  function _injectTrialBanner(status, trialEnd, inTrial) {
    var existing = document.getElementById('vq-trial-banner');
    if (existing) existing.remove();

    if (!inTrial) return;

    if (!trialEnd) return; // unlimited trial — no expiry, no banner
    var daysLeft = Math.ceil((trialEnd - new Date()) / (1000 * 60 * 60 * 24));
    if (daysLeft > 7) return; // only show banner in last 7 days

    var banner = document.createElement('div');
    banner.id = 'vq-trial-banner';
    banner.className = 'trial-banner';
    banner.innerHTML = '<span>' + daysLeft + ' day' + (daysLeft !== 1 ? 's' : '') + ' left on your free trial</span>'
      + '<button onclick="if(typeof showModule===\'function\'){showModule(\'settings\');if(typeof showSettingsTab===\'function\')showSettingsTab(\'subscription\')}" style="background:none;border:none;color:inherit;font:inherit;font-weight:700;cursor:pointer;text-decoration:underline;padding:0">Upgrade to Pro</button>';

    var app = document.querySelector('.vq-app') || document.querySelector('.app') || document.body;
    app.insertAdjacentElement('afterbegin', banner);
  }

  return { check, current, canAccess, startCheckout, hasAccess };

})();
