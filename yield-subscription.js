// yield-subscription.js — Subscription management for Yield (Finance App)
// Mise Labs suite · App 3 of 3 · v4
// Pattern mirrors carte-subscription.js (v5)

window.Mise = window.Mise || {};

(function () {
  'use strict';

  var yieldSub = {

    check: async function (userId) {
      try {
        var result = await supabaseClient
          .from('profiles')
          .select('subscription_status, subscription_plan, trial_ends_at, current_period_end, business_name, chef_name, logo, stripe_customer_id')
          .eq('id', userId)
          .single();

        if (result.error) {
          console.warn('[Yield] Could not read profile:', result.error.message);
          return;
        }

        var profile = result.data;
        window.Mise.profile = profile;

        var status = profile.subscription_status;
        var plan = profile.subscription_plan;
        var now = new Date();
        var trialEnd = profile.trial_ends_at ? new Date(profile.trial_ends_at) : null;

        var onTrial = status === 'trial' && trialEnd && trialEnd > now;
        var hasSuite = status === 'active' && (plan === 'suite' || plan === 'suite-all');
        var hasYield = status === 'active' && plan === 'yield';
        var hasAccess = onTrial || hasSuite || hasYield;

        _updateSwitcher(onTrial, hasSuite);
        renderYieldSubscriptionCard();

        if (!hasAccess) {
          _showPaywall(status, plan, trialEnd);
        } else {
          _hidePaywall();
          if (localStorage.getItem('yield_checkout_success')) {
            localStorage.removeItem('yield_checkout_success');
            if (typeof showToast === 'function') showToast('Subscription active — welcome to Yield!');
          }
        }
      } catch (err) {
        console.warn('[Yield] Subscription check error:', err.message);
      }
    },

    renderCard: function () { renderYieldSubscriptionCard(); }
  };

  function _showPaywall(status, plan, trialEnd) {
    var el = document.getElementById('yield-paywall');
    if (!el) {
      el = document.createElement('div');
      el.id = 'yield-paywall';
      document.body.appendChild(el);
    }

    var isExpired = status === 'trial' && (!trialEnd || trialEnd <= new Date());
    var isOtherApp = status === 'active' && (plan === 'veriqo' || plan === 'carte');

    var headline = isExpired ? 'Your trial has ended' : isOtherApp ? 'Add Yield to your suite' : 'Know your yield.';
    var sub = isOtherApp
      ? 'You’re on the ' + (plan.charAt(0).toUpperCase() + plan.slice(1)) + ' plan. Upgrade to Suite to unlock Yield.'
      : 'Track every pound from quote to payment. Menu costing, invoicing, and P&L — all in one place.';

    el.innerHTML = '<div style="position:fixed;inset:0;background:#0E0E0D;z-index:200;display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto">'
      + '<div style="max-width:420px;width:100%;text-align:center">'
      + '<div style="width:56px;height:56px;margin:0 auto 20px;background:#1E1A11;border:1px solid #C9A84C40;border-radius:14px;display:flex;align-items:center;justify-content:center">'
      + _yLogo(32) + '</div>'
      + '<div style="font-family:\'Instrument Serif\',serif;font-size:28px;color:#F0EDE6;margin-bottom:8px">' + _esc(headline) + '</div>'
      + '<div style="font-size:14px;color:#7A7870;margin-bottom:28px;line-height:1.6">' + _esc(sub) + '</div>'
      + '<div style="display:flex;flex-direction:column;gap:10px">'
      + '<button onclick="window.Mise.yieldSubscription._startCheckout(\'suite-all\',\'monthly\')" style="background:#1E1A11;border:1px solid #C9A84C;border-radius:8px;color:#C9A84C;font-family:\'Instrument Sans\',sans-serif;font-size:15px;font-weight:600;padding:16px 20px;cursor:pointer;width:100%;line-height:1.4">'
      + 'Suite — Veriqo + Carte + Yield<br><span style="font-size:12px;font-weight:400;opacity:0.8">£28/mo · or £280/yr (save £56)</span></button>'
      + '<button onclick="window.Mise.yieldSubscription._startCheckout(\'yield\',\'monthly\')" style="background:#181817;border:1px solid #3A3A37;border-radius:8px;color:#F0EDE6;font-family:\'Instrument Sans\',sans-serif;font-size:14px;padding:14px 20px;cursor:pointer;width:100%">'
      + 'Yield only — £12/mo</button>'
      + '</div></div></div>';
  }

  function _hidePaywall() {
    var el = document.getElementById('yield-paywall');
    if (el) el.remove();
  }

  function _updateSwitcher(onTrial, hasSuite) {
    var vPill = document.getElementById('yield-veriqo-pill');
    var cPill = document.getElementById('yield-carte-pill');
    if (vPill) vPill.style.display = (onTrial || hasSuite) ? 'flex' : 'none';
    if (cPill) cPill.style.display = (onTrial || hasSuite) ? 'flex' : 'none';
  }

  function renderYieldSubscriptionCard() {
    var el = document.getElementById('yield-subscription-card');
    if (!el) return;
    var profile = window.Mise && window.Mise.profile;
    if (!profile) { el.innerHTML = '<div style="color:#7A7870;font-size:13px">Loading…</div>'; return; }

    var status = profile.subscription_status;
    var plan = profile.subscription_plan;
    var trialEnd = profile.trial_ends_at ? new Date(profile.trial_ends_at) : null;
    var now = new Date();
    var onTrial = status === 'trial' && trialEnd && trialEnd > now;
    var daysLeft = trialEnd ? Math.max(0, Math.ceil((trialEnd - now) / 86400000)) : 0;

    var html = '';
    if (onTrial) {
      html = '<div style="background:#1E1A11;border:1px solid #C9A84C40;border-radius:8px;padding:16px">'
        + '<div style="font-size:11px;font-weight:600;letter-spacing:0.07em;text-transform:uppercase;color:#7A7870;margin-bottom:8px">Subscription</div>'
        + '<div style="font-family:\'Instrument Serif\',serif;font-size:20px;color:#C9A84C;margin-bottom:4px">Free trial</div>'
        + '<div style="font-size:13px;color:#7A7870;margin-bottom:14px">' + daysLeft + ' day' + (daysLeft !== 1 ? 's' : '') + ' remaining</div>'
        + '<button onclick="window.Mise.yieldSubscription._startCheckout(\'suite-all\',\'monthly\')" style="background:#C9A84C;border:none;border-radius:6px;color:#0E0E0D;font-family:\'Instrument Sans\',sans-serif;font-size:13px;font-weight:600;padding:10px;cursor:pointer;width:100%;margin-bottom:8px">Upgrade to Suite — £28/mo</button>'
        + '<button onclick="window.Mise.yieldSubscription._startCheckout(\'yield\',\'monthly\')" style="background:transparent;border:1px solid #3A3A37;border-radius:6px;color:#F0EDE6;font-family:\'Instrument Sans\',sans-serif;font-size:13px;padding:10px;cursor:pointer;width:100%">Yield only — £12/mo</button>'
        + '</div>';
    } else if (status === 'active') {
      var planLabel = plan === 'suite' ? 'Suite (all apps)' : plan === 'yield' ? 'Yield' : (plan || 'Active');
      var renewDate = profile.current_period_end ? new Date(profile.current_period_end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
      html = '<div style="background:#181817;border:1px solid #2E2E2B;border-radius:8px;padding:16px">'
        + '<div style="font-size:11px;font-weight:600;letter-spacing:0.07em;text-transform:uppercase;color:#7A7870;margin-bottom:8px">Subscription</div>'
        + '<div style="font-family:\'Instrument Serif\',serif;font-size:20px;color:#4CAF7A;margin-bottom:4px">Active — ' + _esc(planLabel) + '</div>'
        + (renewDate ? '<div style="font-size:13px;color:#7A7870;margin-bottom:14px">Renews ' + renewDate + '</div>' : '<div style="margin-bottom:14px"></div>')
        + '<button onclick="openYieldPortal()" style="background:transparent;border:1px solid #3A3A37;border-radius:6px;color:#F0EDE6;font-family:\'Instrument Sans\',sans-serif;font-size:13px;padding:10px 16px;cursor:pointer;width:100%">Manage billing →</button>'
        + '</div>';
    } else {
      html = '<div style="background:#1F110E;border:1px solid #D45F4A;border-radius:8px;padding:16px">'
        + '<div style="font-size:11px;font-weight:600;letter-spacing:0.07em;text-transform:uppercase;color:#7A7870;margin-bottom:8px">Subscription</div>'
        + '<div style="font-family:\'Instrument Serif\',serif;font-size:20px;color:#D45F4A;margin-bottom:14px">Trial ended</div>'
        + '<button onclick="window.Mise.yieldSubscription._startCheckout(\'suite-all\',\'monthly\')" style="background:#C9A84C;border:none;border-radius:6px;color:#0E0E0D;font-family:\'Instrument Sans\',sans-serif;font-size:13px;font-weight:600;padding:10px;cursor:pointer;width:100%">Subscribe to continue</button>'
        + '</div>';
    }
    el.innerHTML = html;
  }

  async function _startCheckout(app, period) {
    var profile = window.Mise && window.Mise.profile;
    if (!profile) return;
    if (profile.subscription_status === 'active') { await _upgradeSubscription(app, period); return; }
    try {
      if (typeof showToast === 'function') showToast('Opening checkout…');
      var sess = await supabaseClient.auth.getSession();
      var token = sess.data.session.access_token;
      var res = await fetch('https://yixrwyfodipfcbhjcszp.supabase.co/functions/v1/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ app: app, period: period })
      });
      var json = await res.json();
      if (json.url) { localStorage.setItem('yield_checkout_success', '1'); window.location.href = json.url; }
    } catch (e) { if (typeof showToast === 'function') showToast('Checkout failed. Please try again.'); }
  }

  async function _upgradeSubscription(app, period) {
    try {
      if (typeof showToast === 'function') showToast('Upgrading plan…');
      var sess = await supabaseClient.auth.getSession();
      var token = sess.data.session.access_token;
      var res = await fetch('https://yixrwyfodipfcbhjcszp.supabase.co/functions/v1/upgrade-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ app: app, period: period })
      });
      var json = await res.json();
      if (json.success) {
        if (window.Mise.profile) window.Mise.profile.subscription_plan = app;
        _hidePaywall();
        if (typeof showToast === 'function') showToast('Plan upgraded!');
        renderYieldSubscriptionCard();
      }
    } catch (e) { if (typeof showToast === 'function') showToast('Upgrade failed. Please try again.'); }
  }

  function _yLogo(size) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 32 32" fill="none">'
      + '<path d="M6 5L16 17" stroke="#C9A84C" stroke-width="3" stroke-linecap="round"/>'
      + '<path d="M26 5L16 17" stroke="#C9A84C" stroke-width="3" stroke-linecap="round"/>'
      + '<path d="M16 17L16 28" stroke="#C9A84C" stroke-width="3" stroke-linecap="round"/>'
      + '</svg>';
  }

  function _esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  window.Mise.yieldSubscription = yieldSub;
  window.Mise.yieldSubscription._startCheckout = _startCheckout;
  window.Mise.yieldSubscription._upgradeSubscription = _upgradeSubscription;
  window.renderYieldSubscriptionCard = renderYieldSubscriptionCard;
}());
