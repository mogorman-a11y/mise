// carte-subscription.js v5 — Carte paywall and subscription status
// ──────────────────────────────────────────────────────────────────
// Access rules:
//   'trial'  + trial_ends_at in future          → full access
//   'active' + plan in ['carte', 'suite']       → full access
//   'active' + plan in [null, 'veriqo']         → paywall (Veriqo-only subscriber)
//   'trial'  + trial_ends_at has passed         → paywall
//   'cancelled' or 'past_due'                   → paywall
//
// App switcher (Veriqo pill) visibility:
//   trial OR plan = 'suite'  → full branded pill
//   plan = 'carte'           → muted "Try Veriqo →" discovery link
//   other active             → hidden

window.Mise = window.Mise || {};
window.Mise.carteSubscription = (function () {

  var _userId = null;

  // ── Post-checkout redirect handling ────────────────────────────────────────
  // localStorage fallback survives an auth redirect eating the ?checkout=success param.
  var _pendingSuccess = false;
  (function () {
    var params = new URLSearchParams(window.location.search);
    if (params.get('checkout') === 'success') {
      _pendingSuccess = true;
      localStorage.setItem('carte_checkout_success', '1');
      window.history.replaceState({}, '', '/mise');
    } else if (localStorage.getItem('carte_checkout_success')) {
      _pendingSuccess = true;
    }
  })();

  // ── check ──────────────────────────────────────────────────────────────────
  async function check(userId) {
    _userId = userId;
    try {
      var result = await supabaseClient
        .from('profiles')
        .select('subscription_status, subscription_plan, trial_ends_at, business_name, chef_name, stripe_customer_id, logo, onboarded')
        .eq('id', userId)
        .single();

      if (result.error) {
        console.warn('[Carte] Could not read profile:', result.error.message);
        return; // fail open
      }

      var profile  = result.data;
      var status   = profile.subscription_status;
      var plan     = profile.subscription_plan || null;
      var trialEnd = profile.trial_ends_at ? new Date(profile.trial_ends_at) : null;
      var inTrial  = status === 'trial' && trialEnd && trialEnd > new Date();

      window.Mise.profile = profile;
      if (typeof renderCarteSubscriptionCard === 'function') renderCarteSubscriptionCard();

      // Carte access: active with carte/suite plan, or in trial
      var hasAccess = inTrial || (status === 'active' && (plan === 'carte' || plan === 'suite'));

      if (hasAccess) {
        hidePaywall();
        _updateSwitcher(plan, inTrial);
        _injectTrialBanner(status, trialEnd);
        if (!profile.onboarded) {
          setTimeout(_showWelcomeModal, 500);
        }
        if (_pendingSuccess && status === 'active') {
          _pendingSuccess = false;
          localStorage.removeItem('carte_checkout_success');
          setTimeout(function () {
            if (typeof toast === 'function') toast('🎉 Subscription activated — you\'re all set!');
          }, 600);
        }
      } else {
        showPaywall(trialEnd, plan);
      }

    } catch (err) {
      console.warn('[Carte] Subscription check error:', err.message);
    }
  }

  // ── _updateSwitcher ────────────────────────────────────────────────────────
  function _updateSwitcher(plan, inTrial) {
    var btn = document.getElementById('veriqo-switcher-btn');
    if (!btn) return;
    if (inTrial || plan === 'suite') {
      btn.style.cssText = 'display:flex;align-items:center;gap:6px;padding:7px 11px;background:rgba(255,255,255,0.11);border:1px solid rgba(255,255,255,0.18);border-radius:10px;cursor:pointer;flex-shrink:0';
      btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 512 512" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="miseSwitchShield" x1="10%" y1="0%" x2="90%" y2="100%"><stop offset="0%" stop-color="#52D05C"/><stop offset="100%" stop-color="#1EA040"/></linearGradient></defs><rect width="512" height="512" rx="112" fill="#1B3A5C"/><path d="M250 82 Q118 112 118 112 L118 295 Q118 388 250 438 Q382 388 382 295 L382 112 Z" fill="url(#miseSwitchShield)"/><polyline points="163,295 228,368 366,212" stroke="white" stroke-width="46" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>'
        + '<span style="font-size:13px;font-weight:600;color:#F5F0E8;font-family:inherit;letter-spacing:-0.2px">Veriqo</span>';
    } else if (plan === 'carte') {
      btn.style.cssText = 'display:flex;align-items:center;gap:4px;padding:5px 10px;background:none;border:1px solid rgba(255,255,255,0.15);border-radius:10px;cursor:pointer;flex-shrink:0';
      btn.innerHTML = '<span style="font-size:12px;color:rgba(245,240,232,0.4);font-family:inherit">Try Veriqo →</span>';
    } else {
      btn.style.display = 'none';
    }
  }

  // ── showPaywall ────────────────────────────────────────────────────────────
  function showPaywall(trialEnd, plan) {
    if (document.getElementById('carte-paywall')) return;

    var expiredMsg = '';
    if (trialEnd) {
      var daysAgo = Math.floor((Date.now() - trialEnd.getTime()) / (1000 * 60 * 60 * 24));
      if (daysAgo >= 0) {
        expiredMsg = daysAgo === 0
          ? 'Your free trial ended today.'
          : 'Your free trial ended ' + daysAgo + ' day' + (daysAgo > 1 ? 's' : '') + ' ago.';
      }
    }

    // If user already has Veriqo, show "add Carte to your suite" messaging
    var isVeriqoSubscriber = (plan === null || plan === 'veriqo');
    var hadTrial = !!trialEnd;

    var headline, subline;
    if (isVeriqoSubscriber && !hadTrial) {
      headline = 'Add Carte to your suite';
      subline  = 'You already have Veriqo. Add Carte to manage clients, bookings, menus, and jobs — all synced with your Veriqo account.';
    } else if (isVeriqoSubscriber && hadTrial) {
      headline = 'Upgrade to the full suite';
      subline  = 'You have Veriqo for food safety compliance. Add Carte to manage your private chef business — clients, bookings, menus, and jobs — all in one account.';
    } else {
      headline = 'Organise your private chef business';
      subline  = 'Carte gives you everything you need to run your bookings — clients, calendar, menus, job confirmations, and transport logs — all in one place.';
    }

    var pricingHTML;
    if (isVeriqoSubscriber) {
      // Suite upgrade is the primary option
      pricingHTML = ''
        + '<div style="margin-bottom:12px">'
        +   '<div style="font-size:11px;font-weight:700;color:#C8A96E;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Upgrade to Suite</div>'
        +   '<div style="display:flex;gap:10px">'
        +     '<button onclick="Mise.carteSubscription.startCheckout(\'suite\',\'monthly\')" '
        +       'style="flex:1;padding:14px 10px;background:#2E4030;border:2px solid #2E4030;border-radius:12px;cursor:pointer;font-family:inherit;text-align:center">'
        +       '<div style="font-size:22px;font-weight:700;color:#F5F0E8">£20</div>'
        +       '<div style="font-size:12px;color:rgba(245,240,232,0.7);margin-top:2px">per month</div>'
        +       '<div style="font-size:11px;color:rgba(245,240,232,0.5);margin-top:4px">Both apps</div>'
        +     '</button>'
        +     '<button onclick="Mise.carteSubscription.startCheckout(\'suite\',\'annual\')" '
        +       'style="flex:1;padding:14px 10px;background:#C8A96E;border:2px solid #C8A96E;border-radius:12px;cursor:pointer;font-family:inherit;text-align:center;position:relative">'
        +       '<div style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:#3A7D44;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;white-space:nowrap">2 MONTHS FREE</div>'
        +       '<div style="font-size:22px;font-weight:700;color:#1C2B1E">£200</div>'
        +       '<div style="font-size:12px;color:rgba(28,43,30,0.7);margin-top:2px">per year</div>'
        +       '<div style="font-size:11px;color:rgba(28,43,30,0.5);margin-top:4px">£16.67/month</div>'
        +     '</button>'
        +   '</div>'
        + '</div>'
        + '<div style="text-align:center;margin-bottom:16px"><span style="font-size:12px;color:#A09890">or</span></div>'
        + '<div style="display:flex;gap:10px;margin-bottom:20px">'
        +   '<div style="flex:1;text-align:center">'
        +     '<div style="font-size:12px;font-weight:600;color:#F5F0E8;margin-bottom:4px">Carte only</div>'
        +     '<button onclick="Mise.carteSubscription.startCheckout(\'carte\',\'monthly\')" style="width:100%;padding:10px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:10px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;color:#F5F0E8">£12/month</button>'
        +   '</div>'
        +   '<div style="flex:1;text-align:center">'
        +     '<div style="font-size:12px;font-weight:600;color:#F5F0E8;margin-bottom:4px">&nbsp;</div>'
        +     '<button onclick="Mise.carteSubscription.startCheckout(\'carte\',\'annual\')" style="width:100%;padding:10px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:10px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;color:#F5F0E8">£120/year</button>'
        +   '</div>'
        + '</div>';
    } else {
      // Standard Carte pricing + suite nudge
      pricingHTML = ''
        + '<div style="display:flex;gap:10px;margin-bottom:16px">'
        +   '<button onclick="Mise.carteSubscription.startCheckout(\'carte\',\'monthly\')" '
        +     'style="flex:1;padding:14px 10px;background:rgba(255,255,255,0.08);border:2px solid rgba(255,255,255,0.18);border-radius:12px;cursor:pointer;font-family:inherit;text-align:center">'
        +     '<div style="font-size:22px;font-weight:700;color:#F5F0E8">£12</div>'
        +     '<div style="font-size:12px;color:rgba(245,240,232,0.6);margin-top:2px">per month</div>'
        +     '<div style="font-size:11px;color:rgba(245,240,232,0.4);margin-top:4px">Cancel any time</div>'
        +   '</button>'
        +   '<button onclick="Mise.carteSubscription.startCheckout(\'carte\',\'annual\')" '
        +     'style="flex:1;padding:14px 10px;background:#C8A96E;border:2px solid #C8A96E;border-radius:12px;cursor:pointer;font-family:inherit;text-align:center;position:relative">'
        +     '<div style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:#3A7D44;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;white-space:nowrap">2 MONTHS FREE</div>'
        +     '<div style="font-size:22px;font-weight:700;color:#1C2B1E">£120</div>'
        +     '<div style="font-size:12px;color:rgba(28,43,30,0.7);margin-top:2px">per year</div>'
        +     '<div style="font-size:11px;color:rgba(28,43,30,0.5);margin-top:4px">£10/month billed annually</div>'
        +   '</button>'
        + '</div>'
        + '<div style="background:rgba(200,169,110,0.15);border:1px solid rgba(200,169,110,0.3);border-radius:10px;padding:12px 14px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;gap:10px">'
        +   '<div style="font-size:13px;color:#C8A96E"><strong>Both apps</strong> — Carte + Veriqo suite</div>'
        +   '<button onclick="Mise.carteSubscription.startCheckout(\'suite\',\'monthly\')" style="flex-shrink:0;padding:7px 14px;background:#C8A96E;color:#1C2B1E;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap">£20/mo →</button>'
        + '</div>';
    }

    var html = '<div id="carte-paywall" style="position:fixed;inset:0;background:#1C2B1E;z-index:9998;overflow-y:auto;-webkit-overflow-scrolling:touch">'
      + '<div style="max-width:390px;margin:0 auto;padding:48px 20px 60px">'

      // Logo
      + '<div style="display:flex;align-items:center;gap:14px;margin-bottom:32px">'
      +   '<svg width="48" height="48" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;border-radius:12px">'
      +     '<rect width="60" height="60" rx="14" fill="#1C2B1E"/>'
      +     '<path d="M44.1,15.9 A20,20 0 1,0 44.1,44.1 L39.2,39.2 A13,13 0 1,0 39.2,20.8 Z" fill="#C8A96E"/>'
      +   '</svg>'
      +   '<div>'
      +     '<div style="font-size:26px;font-weight:700;color:#F5F0E8;letter-spacing:-0.5px">Carte</div>'
      +     '<div style="font-size:13px;color:#C8A96E;margin-top:1px;font-weight:600">Private chef. Perfectly organised.</div>'
      +   '</div>'
      + '</div>'

      + (expiredMsg
        ? '<div style="background:rgba(254,249,236,0.1);border:1px solid rgba(253,230,138,0.3);border-radius:10px;padding:12px 14px;margin-bottom:20px;font-size:14px;color:#fde68a">' + expiredMsg + '</div>'
        : '')

      + '<div style="font-size:24px;font-weight:700;color:#F5F0E8;letter-spacing:-0.3px;margin-bottom:10px;line-height:1.3">' + headline + '</div>'
      + '<div style="font-size:15px;color:rgba(245,240,232,0.7);line-height:1.6;margin-bottom:24px">' + subline + '</div>'

      + '<div style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:14px;padding:16px 18px;margin-bottom:24px">'
      + _featureRow('👥', 'Client & contact management')
      + _featureRow('📅', 'Calendar, bookings & unavailable dates')
      + _featureRow('🍽️', 'Dish library & saved menus')
      + _featureRow('📋', 'Job sheets with menus and guest counts')
      + _featureRow('🚗', 'Transport temperature log')
      + _featureRow('☁️', 'Synced across all your devices')
      + '</div>'

      + pricingHTML

      + '<div style="text-align:center;margin-bottom:14px">'
      +   '<span style="font-size:12px;color:#6B6560">Have a promo code? Enter it at checkout.</span>'
      + '</div>'

      + '<div style="text-align:center;margin-top:20px">'
      +   '<button onclick="Mise.auth.logout()" style="background:none;border:none;color:rgba(245,240,232,0.3);font-size:12px;cursor:pointer;font-family:inherit">Sign out</button>'
      + '</div>'

      + '</div></div>';

    document.body.insertAdjacentHTML('beforeend', html);
  }

  // ── hidePaywall ────────────────────────────────────────────────────────────
  function hidePaywall() {
    var el = document.getElementById('carte-paywall');
    if (el) el.remove();
  }

  // ── startCheckout ──────────────────────────────────────────────────────────
  // Active subscribers are routed to _upgradeSubscription() to avoid double-billing.
  async function startCheckout(app, period) {
    app    = app    || 'carte';
    period = period || 'monthly';

    // Active subscribers: swap price on existing subscription instead of new checkout
    var profile = window.Mise && window.Mise.profile;
    if (profile && profile.subscription_status === 'active') {
      return _upgradeSubscription(app, period);
    }

    try {
      var sessionResult = await supabaseClient.auth.getSession();
      var token = sessionResult.data.session && sessionResult.data.session.access_token;
      if (!token) throw new Error('Not signed in');

      var res = await fetch(
        'https://yixrwyfodipfcbhjcszp.supabase.co/functions/v1/create-checkout',
        {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': 'Bearer ' + token,
            'apikey':        SUPABASE_ANON,
          },
          body: JSON.stringify({ app: app, period: period }),
        }
      );

      var data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || data.message || 'Could not create checkout session');

      window.location.href = data.url;

    } catch (err) {
      console.error('[Carte] Checkout error:', err);
      if (typeof toast === 'function') toast('Could not start checkout — please try again', false);
    }
  }

  // ── _upgradeSubscription ───────────────────────────────────────────────────
  // Called instead of startCheckout when the user already has an active subscription.
  // Swaps the price on the existing Stripe subscription — no second subscription created.
  async function _upgradeSubscription(app, period) {
    try {
      var sessionResult = await supabaseClient.auth.getSession();
      var token = sessionResult.data.session && sessionResult.data.session.access_token;
      if (!token) throw new Error('Not signed in');

      var res = await fetch(
        'https://yixrwyfodipfcbhjcszp.supabase.co/functions/v1/upgrade-subscription',
        {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': 'Bearer ' + token,
            'apikey':        SUPABASE_ANON,
          },
          body: JSON.stringify({ app: app, period: period }),
        }
      );

      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upgrade failed');

      // Update local profile so UI reflects the new plan immediately
      if (window.Mise.profile) window.Mise.profile.subscription_plan = app;
      if (typeof renderCarteSubscriptionCard === 'function') renderCarteSubscriptionCard();
      hidePaywall();
      _updateSwitcher(app, false);

      var planName = app === 'suite' ? 'Suite'
                   : app.charAt(0).toUpperCase() + app.slice(1);
      if (typeof toast === 'function') toast('Plan upgraded to ' + planName + ' — you\'re all set!');

    } catch (err) {
      console.error('[Carte] Upgrade error:', err);
      if (typeof toast === 'function') toast('Could not upgrade plan — please try again', false);
    }
  }

  // ── _injectTrialBanner ─────────────────────────────────────────────────────
  function _injectTrialBanner(status, trialEnd) {
    if (status !== 'trial' || !trialEnd) return;
    var daysLeft = Math.ceil((trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysLeft > 5) return;

    var header = document.querySelector('.mise-header');
    if (!header || document.getElementById('carte-trial-banner')) return;

    var banner = document.createElement('div');
    banner.id = 'carte-trial-banner';
    banner.style.cssText = 'background:rgba(200,169,110,0.15);border-bottom:1px solid rgba(200,169,110,0.3);padding:7px 16px;font-size:12px;color:#C8A96E;display:flex;align-items:center;justify-content:space-between;max-width:430px;margin:0 auto;width:100%';
    banner.innerHTML = '<span>' + (daysLeft <= 0 ? 'Trial expired' : daysLeft + ' day' + (daysLeft > 1 ? 's' : '') + ' left in trial') + '</span>'
      + '<button onclick="Mise.carteSubscription.startCheckout(\'carte\',\'monthly\')" style="background:#C8A96E;color:#1C2B1E;border:none;border-radius:5px;padding:3px 10px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">Subscribe</button>';

    header.insertAdjacentElement('afterend', banner);
  }

  // ── _showWelcomeModal ──────────────────────────────────────────────────────
  function _showWelcomeModal() {
    if (document.getElementById('carte-welcome')) return;

    var html = '<div id="carte-welcome" style="position:fixed;inset:0;background:rgba(28,43,30,0.65);z-index:9900;display:flex;align-items:center;justify-content:center;padding:20px;-webkit-overflow-scrolling:touch">'
      + '<div style="background:#F5F0E8;border-radius:20px;max-width:360px;width:100%;padding:32px 24px 28px;box-shadow:0 8px 40px rgba(0,0,0,0.25)">'

      + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">'
      +   '<svg width="40" height="40" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;border-radius:10px">'
      +     '<rect width="60" height="60" rx="14" fill="#1C2B1E"/>'
      +     '<path d="M44.1,15.9 A20,20 0 1,0 44.1,44.1 L39.2,39.2 A13,13 0 1,0 39.2,20.8 Z" fill="#C8A96E"/>'
      +   '</svg>'
      +   '<div>'
      +     '<div style="font-size:20px;font-weight:700;color:#1C2B1E;letter-spacing:-0.3px">Welcome to Carte</div>'
      +     '<div style="font-size:12px;color:#C8A96E;margin-top:1px;font-weight:600">A few things to know before you start</div>'
      +   '</div>'
      + '</div>'

      + '<div style="display:flex;flex-direction:column;gap:14px;margin-bottom:24px">'

      + '<div style="display:flex;gap:12px;align-items:flex-start">'
      +   '<span style="font-size:20px;line-height:1;flex-shrink:0;margin-top:1px">👥</span>'
      +   '<div>'
      +     '<div style="font-size:14px;font-weight:600;color:#1C2B1E;margin-bottom:2px">Start with your clients</div>'
      +     '<div style="font-size:13px;color:#5A544E;line-height:1.5">Add your regular clients first — their details auto-fill into jobs and transport logs, saving you time.</div>'
      +   '</div>'
      + '</div>'

      + '<div style="display:flex;gap:12px;align-items:flex-start">'
      +   '<span style="font-size:20px;line-height:1;flex-shrink:0;margin-top:1px">🍽️</span>'
      +   '<div>'
      +     '<div style="font-size:14px;font-weight:600;color:#1C2B1E;margin-bottom:2px">Build your dish library</div>'
      +     '<div style="font-size:13px;color:#5A544E;line-height:1.5">Add your dishes once, then build saved menus to attach to any booking in seconds.</div>'
      +   '</div>'
      + '</div>'

      + '<div style="display:flex;gap:12px;align-items:flex-start">'
      +   '<span style="font-size:20px;line-height:1;flex-shrink:0;margin-top:1px">⚙️</span>'
      +   '<div>'
      +     '<div style="font-size:14px;font-weight:600;color:#1C2B1E;margin-bottom:2px">Set up your profile in Settings</div>'
      +     '<div style="font-size:13px;color:#5A544E;line-height:1.5">Tap the gold ⚙️ icon in the top-right corner to add your business name, staff, and logo.</div>'
      +   '</div>'
      + '</div>'

      + '</div>'

      + '<button onclick="Mise.carteSubscription._dismissWelcomeModal()" '
      +   'style="width:100%;padding:14px;background:#1C2B1E;color:#F5F0E8;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit">Got it, let\'s start →</button>'

      + '</div></div>';

    document.body.insertAdjacentHTML('beforeend', html);
  }

  // ── _dismissWelcomeModal ───────────────────────────────────────────────────
  async function _dismissWelcomeModal() {
    var el = document.getElementById('carte-welcome');
    if (el) el.remove();
    if (!_userId) return;
    try {
      await supabaseClient.from('profiles').update({ onboarded: true }).eq('id', _userId);
    } catch (e) {}
  }

  // ── _featureRow (internal) ─────────────────────────────────────────────────
  function _featureRow(icon, text) {
    return '<div style="display:flex;align-items:center;gap:12px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.06)">'
      + '<span style="font-size:18px;width:24px;text-align:center;flex-shrink:0">' + icon + '</span>'
      + '<span style="font-size:14px;color:rgba(245,240,232,0.85)">' + text + '</span>'
      + '</div>';
  }

  return { check, showPaywall, hidePaywall, startCheckout, _dismissWelcomeModal };

})();
