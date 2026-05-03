// subscription.js — Veriqo paywall and subscription status
// ───────────────────────────────────────────────────────────
// Access rules:
//   'trial'  + trial_ends_at in future            → full access
//   'active' + plan in [null, 'veriqo', 'suite']  → full access
//   'active' + plan = 'carte'                     → paywall (Carte subscriber)
//   'trial'  + trial_ends_at has passed           → paywall
//   'cancelled' or 'past_due'                     → paywall
//
// App switcher (Carte pill) visibility:
//   trial OR plan = 'suite'  → show
//   plan = 'veriqo' or null  → hide (Veriqo-only subscriber)
//
// PDF export is ALWAYS available even behind the paywall.

window.Mise = window.Mise || {};
window.Mise.subscription = (function () {

  var _userId = null;

  // ── Post-checkout redirect handling ────────────────────────────────────────
  var _pendingSuccess = false;
  (function () {
    var params = new URLSearchParams(window.location.search);
    if (params.get('checkout') === 'success') {
      _pendingSuccess = true;
      window.history.replaceState({}, '', '/');
    }
  })();

  // ── check ──────────────────────────────────────────────────────────────────
  async function check(userId) {
    _userId = userId;
    window._pushUserId = userId;
    try {
      var result = await supabaseClient
        .from('profiles')
        .select('subscription_status, subscription_plan, trial_ends_at, business_name, chef_name, stripe_customer_id, logo, onboarded')
        .eq('id', userId)
        .single();

      if (result.error && result.error.code === 'PGRST116') {
        var trialEnds = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
        await supabaseClient.from('profiles').insert({
          id: userId,
          business_name: '',
          chef_name: '',
          subscription_status: 'trial',
          trial_ends_at: trialEnds
        });
        result = await supabaseClient
          .from('profiles')
          .select('subscription_status, subscription_plan, trial_ends_at, business_name, chef_name, stripe_customer_id, logo')
          .eq('id', userId)
          .single();
      }

      if (result.error) {
        console.warn('[Veriqo] Could not read profile:', result.error.message);
        return;
      }

      var profile  = result.data;
      var status   = profile.subscription_status;
      var plan     = profile.subscription_plan || null; // null = legacy/trial
      var trialEnd = profile.trial_ends_at ? new Date(profile.trial_ends_at) : null;
      var inTrial  = status === 'trial' && trialEnd && trialEnd > new Date();

      window.Mise.profile = profile;

      // Veriqo access: active with veriqo/suite/null plan, or in trial
      var hasAccess = inTrial || (status === 'active' && (plan === null || plan === 'veriqo' || plan === 'suite'));

      if (hasAccess) {
        hidePaywall();
        _updateSwitcher(plan, inTrial);
        _injectTrialBanner(status, trialEnd);
        if (!profile.onboarded) {
          setTimeout(_showWelcomeModal, 500);
        }
        if (_pendingSuccess) {
          _pendingSuccess = false;
          setTimeout(function () {
            if (typeof toast === 'function') toast('🎉 Subscription activated — you\'re all set!');
          }, 600);
        }
      } else {
        showPaywall(trialEnd, plan);
      }

    } catch (err) {
      console.warn('[Veriqo] Subscription check error:', err.message);
    }
  }

  // ── _updateSwitcher ────────────────────────────────────────────────────────
  // Show the Carte pill only during trial or on the suite plan.
  function _updateSwitcher(plan, inTrial) {
    var btn = document.getElementById('carte-switcher-btn');
    if (!btn) return;
    btn.style.display = (inTrial || plan === 'suite') ? '' : 'none';
  }

  // ── showPaywall ────────────────────────────────────────────────────────────
  function showPaywall(trialEnd, plan) {
    if (document.getElementById('mise-paywall')) return;

    var expiredMsg = '';
    if (trialEnd) {
      var daysAgo = Math.floor((Date.now() - trialEnd.getTime()) / (1000 * 60 * 60 * 24));
      if (daysAgo >= 0) {
        expiredMsg = daysAgo === 0
          ? 'Your free trial ended today.'
          : 'Your free trial ended ' + daysAgo + ' day' + (daysAgo > 1 ? 's' : '') + ' ago.';
      }
    }

    // If user already has Carte, show "add Veriqo to your suite" messaging
    var isCarteSubscriber = plan === 'carte';

    var headline, subline;
    if (isCarteSubscriber) {
      headline = 'Add Veriqo to your suite';
      subline  = 'You already have Carte. Add Veriqo to get complete food safety compliance alongside your business management — all in one account.';
    } else {
      headline = 'Keep your kitchen compliant';
      subline  = 'Veriqo gives you a complete digital HACCP system — temperature logs, checklists, cleaning records, allergen tracking, and PDF reports ready for inspection.';
    }

    var pricingHTML;
    if (isCarteSubscriber) {
      // Suite upgrade is the primary option; Veriqo-only is secondary
      pricingHTML = ''
        + '<div style="margin-bottom:12px">'
        +   '<div style="font-size:11px;font-weight:700;color:#2D7A3A;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Upgrade to Suite</div>'
        +   '<div style="display:flex;gap:10px">'
        +     '<button onclick="Mise.subscription.startCheckout(\'suite\',\'monthly\')" '
        +       'style="flex:1;padding:14px 10px;background:#fff;border:2px solid #e5e4de;border-radius:12px;cursor:pointer;font-family:inherit;text-align:center">'
        +       '<div style="font-size:22px;font-weight:700;color:#1a1a18">£20</div>'
        +       '<div style="font-size:12px;color:#888;margin-top:2px">per month</div>'
        +       '<div style="font-size:11px;color:#aaa;margin-top:4px">Both apps</div>'
        +     '</button>'
        +     '<button onclick="Mise.subscription.startCheckout(\'suite\',\'annual\')" '
        +       'style="flex:1;padding:14px 10px;background:#2D7A3A;border:2px solid #2D7A3A;border-radius:12px;cursor:pointer;font-family:inherit;text-align:center;position:relative">'
        +       '<div style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:#52D05C;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;white-space:nowrap">2 MONTHS FREE</div>'
        +       '<div style="font-size:22px;font-weight:700;color:#fff">£200</div>'
        +       '<div style="font-size:12px;color:rgba(255,255,255,0.8);margin-top:2px">per year</div>'
        +       '<div style="font-size:11px;color:rgba(255,255,255,0.6);margin-top:4px">£16.67/month</div>'
        +     '</button>'
        +   '</div>'
        + '</div>'
        + '<div style="text-align:center;margin-bottom:16px"><span style="font-size:12px;color:#aaa">or</span></div>'
        + '<div style="display:flex;gap:10px;margin-bottom:20px">'
        +   '<div style="flex:1;font-size:12px;color:#888;text-align:center">'
        +     '<div style="font-weight:600;color:#1a1a18;margin-bottom:4px">Veriqo only</div>'
        +     '<button onclick="Mise.subscription.startCheckout(\'veriqo\',\'monthly\')" style="width:100%;padding:10px;background:#fff;border:1px solid #e5e4de;border-radius:10px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;color:#1a1a18">£12/month</button>'
        +   '</div>'
        +   '<div style="flex:1;font-size:12px;color:#888;text-align:center">'
        +     '<div style="font-weight:600;color:#1a1a18;margin-bottom:4px">&nbsp;</div>'
        +     '<button onclick="Mise.subscription.startCheckout(\'veriqo\',\'annual\')" style="width:100%;padding:10px;background:#fff;border:1px solid #e5e4de;border-radius:10px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;color:#1a1a18">£120/year</button>'
        +   '</div>'
        + '</div>';
    } else {
      // Standard Veriqo pricing + a smaller suite nudge
      pricingHTML = ''
        + '<div style="display:flex;gap:10px;margin-bottom:16px">'
        +   '<button onclick="Mise.subscription.startCheckout(\'veriqo\',\'monthly\')" '
        +     'style="flex:1;padding:14px 10px;background:#fff;border:2px solid #e5e4de;border-radius:12px;cursor:pointer;font-family:inherit;text-align:center">'
        +     '<div style="font-size:22px;font-weight:700;color:#1a1a18">£12</div>'
        +     '<div style="font-size:12px;color:#888;margin-top:2px">per month</div>'
        +     '<div style="font-size:11px;color:#aaa;margin-top:4px">Cancel any time</div>'
        +   '</button>'
        +   '<button onclick="Mise.subscription.startCheckout(\'veriqo\',\'annual\')" '
        +     'style="flex:1;padding:14px 10px;background:#2D7A3A;border:2px solid #2D7A3A;border-radius:12px;cursor:pointer;font-family:inherit;text-align:center;position:relative">'
        +     '<div style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:#52D05C;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;white-space:nowrap">2 MONTHS FREE</div>'
        +     '<div style="font-size:22px;font-weight:700;color:#fff">£120</div>'
        +     '<div style="font-size:12px;color:rgba(255,255,255,0.8);margin-top:2px">per year</div>'
        +     '<div style="font-size:11px;color:rgba(255,255,255,0.6);margin-top:4px">£10/month billed annually</div>'
        +   '</button>'
        + '</div>'
        + '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 14px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;gap:10px">'
        +   '<div style="font-size:13px;color:#15803d"><strong>Both apps</strong> — Veriqo + Carte suite</div>'
        +   '<button onclick="Mise.subscription.startCheckout(\'suite\',\'monthly\')" style="flex-shrink:0;padding:7px 14px;background:#2D7A3A;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap">£20/mo →</button>'
        + '</div>';
    }

    var html = '<div id="mise-paywall" style="position:fixed;inset:0;background:#f5f4f0;z-index:9998;overflow-y:auto;-webkit-overflow-scrolling:touch">'
      + '<div style="max-width:390px;margin:0 auto;padding:48px 20px 60px">'

      + '<div style="display:flex;align-items:center;gap:14px;margin-bottom:32px">'
      +   '<svg width="48" height="48" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;border-radius:12px">'
      +     '<defs>'
      +       '<linearGradient id="sbg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#1B3A5C"/><stop offset="100%" stop-color="#1B5C72"/></linearGradient>'
      +       '<linearGradient id="ssg" x1="10%" y1="0%" x2="90%" y2="100%"><stop offset="0%" stop-color="#52D05C"/><stop offset="100%" stop-color="#1EA040"/></linearGradient>'
      +     '</defs>'
      +     '<rect width="512" height="512" rx="112" fill="url(#sbg)"/>'
      +     '<path d="M278 82 Q146 112 146 112 L146 295 Q146 388 278 438 Q410 388 410 295 L410 112 Z" fill="#1B5C72"/>'
      +     '<path d="M250 82 Q118 112 118 112 L118 295 Q118 388 250 438 Q382 388 382 295 L382 112 Z" fill="url(#ssg)"/>'
      +     '<polyline points="163,295 228,368 366,212" stroke="white" stroke-width="46" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'
      +   '</svg>'
      +   '<div>'
      +     '<div style="font-size:26px;font-weight:700;color:#1a1a18;letter-spacing:-0.5px">Veriqo</div>'
      +     '<div style="font-size:13px;color:#2D7A3A;margin-top:1px;font-weight:600">Food Safety. Inspection Ready.</div>'
      +   '</div>'
      + '</div>'

      + (expiredMsg
        ? '<div style="background:#fef9ec;border:1px solid #fde68a;border-radius:10px;padding:12px 14px;margin-bottom:20px;font-size:14px;color:#92400e">' + expiredMsg + '</div>'
        : '')

      + '<div style="font-size:24px;font-weight:700;color:#1a1a18;letter-spacing:-0.3px;margin-bottom:10px;line-height:1.3">' + headline + '</div>'
      + '<div style="font-size:15px;color:#555;line-height:1.6;margin-bottom:24px">' + subline + '</div>'

      + '<div style="background:#fff;border:1px solid #e5e4de;border-radius:14px;padding:16px 18px;margin-bottom:24px">'
      + _featureRow('🌡️', 'Temperature & fridge logs')
      + _featureRow('✅', 'Opening, closing & cross-contamination checks')
      + _featureRow('🚚', 'Delivery, cleaning & pest control records')
      + _featureRow('⚠️', 'Allergen tracking for all 14 major allergens')
      + _featureRow('📄', 'PDF exports for every daily log')
      + _featureRow('☁️', 'Synced across all your devices')
      + '</div>'

      + pricingHTML

      + '<div style="text-align:center;margin-bottom:14px">'
      +   '<span style="font-size:12px;color:#aaa">Have a promo code? Enter it at checkout.</span>'
      + '</div>'

      + '<div style="text-align:center">'
      +   '<button onclick="Mise.subscription._showRecordsOnly()" '
      +     'style="background:none;border:none;color:#888;font-size:13px;cursor:pointer;font-family:inherit;text-decoration:underline">Just export my existing records</button>'
      + '</div>'

      + '<div style="text-align:center;margin-top:20px">'
      +   '<button onclick="Mise.auth.logout()" style="background:none;border:none;color:#bbb;font-size:12px;cursor:pointer;font-family:inherit">Sign out</button>'
      + '</div>'

      + '</div></div>';

    document.body.insertAdjacentHTML('beforeend', html);
  }

  // ── hidePaywall ────────────────────────────────────────────────────────────
  function hidePaywall() {
    var el = document.getElementById('mise-paywall');
    if (el) el.remove();
  }

  // ── startCheckout ──────────────────────────────────────────────────────────
  // startCheckout(app, period) — app: 'veriqo'|'carte'|'suite', period: 'monthly'|'annual'
  // Legacy single-arg calls startCheckout('monthly'/'annual') still work.
  async function startCheckout(app, period) {
    if (app === 'monthly' || app === 'annual') { period = app; app = 'veriqo'; }
    app    = app    || 'veriqo';
    period = period || 'monthly';

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
      console.error('[Veriqo] Checkout error:', err);
      if (typeof toast === 'function') toast('Could not start checkout — please try again', false);
    }
  }

  // ── _showRecordsOnly ───────────────────────────────────────────────────────
  function _showRecordsOnly() {
    hidePaywall();
    if (typeof showTab === 'function') showTab('records');
  }

  // ── _injectTrialBanner ─────────────────────────────────────────────────────
  function _injectTrialBanner(status, trialEnd) {
    if (status !== 'trial' || !trialEnd) return;
    var daysLeft = Math.ceil((trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysLeft > 5) return;

    var header = document.querySelector('.header');
    if (!header || document.getElementById('trial-banner')) return;

    var banner = document.createElement('div');
    banner.id = 'trial-banner';
    banner.style.cssText = 'background:#fef9ec;border-bottom:1px solid #fde68a;padding:7px 16px;font-size:12px;color:#92400e;display:flex;align-items:center;justify-content:space-between;max-width:430px;margin:0 auto;width:100%';
    banner.innerHTML = '<span>' + (daysLeft <= 0 ? 'Trial expired' : daysLeft + ' day' + (daysLeft > 1 ? 's' : '') + ' left in trial') + '</span>'
      + '<button onclick="Mise.subscription.startCheckout(\'veriqo\',\'monthly\')" style="background:#2D7A3A;color:#fff;border:none;border-radius:5px;padding:3px 10px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">Subscribe</button>';

    header.insertAdjacentElement('afterend', banner);
  }

  // ── _showWelcomeModal ──────────────────────────────────────────────────────
  function _showWelcomeModal() {
    if (document.getElementById('mise-welcome')) return;

    var html = '<div id="mise-welcome" style="position:fixed;inset:0;background:rgba(26,26,24,0.55);z-index:9900;display:flex;align-items:center;justify-content:center;padding:20px;-webkit-overflow-scrolling:touch">'
      + '<div style="background:#f5f4f0;border-radius:20px;max-width:360px;width:100%;padding:32px 24px 28px;box-shadow:0 8px 40px rgba(0,0,0,0.18)">'

      + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">'
      +   '<svg width="40" height="40" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;border-radius:10px">'
      +     '<defs>'
      +       '<linearGradient id="wbg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#1B3A5C"/><stop offset="100%" stop-color="#1B5C72"/></linearGradient>'
      +       '<linearGradient id="wsg" x1="10%" y1="0%" x2="90%" y2="100%"><stop offset="0%" stop-color="#52D05C"/><stop offset="100%" stop-color="#1EA040"/></linearGradient>'
      +     '</defs>'
      +     '<rect width="512" height="512" rx="112" fill="url(#wbg)"/>'
      +     '<path d="M278 82 Q146 112 146 112 L146 295 Q146 388 278 438 Q410 388 410 295 L410 112 Z" fill="#1B5C72"/>'
      +     '<path d="M250 82 Q118 112 118 112 L118 295 Q118 388 250 438 Q382 388 382 295 L382 112 Z" fill="url(#wsg)"/>'
      +     '<polyline points="163,295 228,368 366,212" stroke="white" stroke-width="46" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'
      +   '</svg>'
      +   '<div>'
      +     '<div style="font-size:20px;font-weight:700;color:#1a1a18;letter-spacing:-0.3px">Welcome to Veriqo</div>'
      +     '<div style="font-size:12px;color:#2D7A3A;margin-top:1px;font-weight:600">A few things to know before you start</div>'
      +   '</div>'
      + '</div>'

      + '<div style="display:flex;flex-direction:column;gap:14px;margin-bottom:24px">'

      + '<div style="display:flex;gap:12px;align-items:flex-start">'
      +   '<span style="font-size:20px;line-height:1;flex-shrink:0;margin-top:1px">🗒️</span>'
      +   '<div>'
      +     '<div style="font-size:14px;font-weight:600;color:#1a1a18;margin-bottom:2px">Log only what happened</div>'
      +     '<div style="font-size:13px;color:#666;line-height:1.5">You don\'t need to fill every section every day — just record what\'s relevant to today\'s service.</div>'
      +   '</div>'
      + '</div>'

      + '<div style="display:flex;gap:12px;align-items:flex-start">'
      +   '<span style="font-size:20px;line-height:1;flex-shrink:0;margin-top:1px">⏭️</span>'
      +   '<div>'
      +     '<div style="font-size:14px;font-weight:600;color:#1a1a18;margin-bottom:2px">Skip sections you don\'t use</div>'
      +     '<div style="font-size:13px;color:#666;line-height:1.5">If cooling, allergens or pest control aren\'t relevant, leave them blank — it won\'t affect your other records.</div>'
      +   '</div>'
      + '</div>'

      + '<div style="display:flex;gap:12px;align-items:flex-start">'
      +   '<span style="font-size:20px;line-height:1;flex-shrink:0;margin-top:1px">⚙️</span>'
      +   '<div>'
      +     '<div style="font-size:14px;font-weight:600;color:#1a1a18;margin-bottom:2px">Customise everything in Settings</div>'
      +     '<div style="font-size:13px;color:#666;line-height:1.5">Tap the ⚙️ icon in the top-right corner to add your staff names, fridge units and suppliers before you start.</div>'
      +   '</div>'
      + '</div>'

      + '</div>'

      + '<button onclick="Mise.subscription._dismissWelcomeModal()" '
      +   'style="width:100%;padding:14px;background:#2D7A3A;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit">Got it, let\'s start →</button>'

      + '</div></div>';

    document.body.insertAdjacentHTML('beforeend', html);
  }

  // ── _dismissWelcomeModal ───────────────────────────────────────────────────
  async function _dismissWelcomeModal() {
    var el = document.getElementById('mise-welcome');
    if (el) el.remove();
    if (!_userId) return;
    try {
      await supabaseClient.from('profiles').update({ onboarded: true }).eq('id', _userId);
    } catch (e) {}
  }

  // ── _featureRow (internal) ─────────────────────────────────────────────────
  function _featureRow(icon, text) {
    return '<div style="display:flex;align-items:center;gap:12px;padding:7px 0;border-bottom:1px solid #f0f0ec">'
      + '<span style="font-size:18px;width:24px;text-align:center;flex-shrink:0">' + icon + '</span>'
      + '<span style="font-size:14px;color:#1a1a18">' + text + '</span>'
      + '</div>';
  }

  return { check, showPaywall, hidePaywall, startCheckout, _showRecordsOnly, _dismissWelcomeModal };

})();
