// subscription.js — paywall and subscription status
// ───────────────────────────────────────────────────
// Access rules:
//   'trial'     + trial_ends_at in future  → full access
//   'trial'     + trial_ends_at has passed → paywall
//   'active'                               → full access
//   'cancelled' or 'past_due'              → paywall
//
// PDF export is ALWAYS available even behind the paywall.

window.Mise = window.Mise || {};
window.Mise.subscription = (function () {

  // ── check ──────────────────────────────────────────────────────────────────
  // Called by auth.js after sync. Fetches the user's profile and gates access.
  async function check(userId) {
    try {
      var result = await supabaseClient
        .from('profiles')
        .select('subscription_status, trial_ends_at, business_name, chef_name, stripe_customer_id')
        .eq('id', userId)
        .single();

      // PGRST116 = row not found — profile not created yet (e.g. Google OAuth first login)
      if (result.error && result.error.code === 'PGRST116') {
        // Create a default profile with a 14-day trial
        // Extended trial for beta feedback period — change to 14 days when launching paid
        var trialEnds = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
        await supabaseClient.from('profiles').insert({
          id: userId,
          business_name: '',
          chef_name: '',
          subscription_status: 'trial',
          trial_ends_at: trialEnds
        });
        result = await supabaseClient
          .from('profiles')
          .select('subscription_status, trial_ends_at, business_name, chef_name, stripe_customer_id')
          .eq('id', userId)
          .single();
      }

      if (result.error) {
        console.warn('[Mise] Could not read profile:', result.error.message);
        return; // fail open — let the user in if we can't check
      }

      var profile  = result.data;
      var status   = profile.subscription_status;
      var trialEnd = profile.trial_ends_at ? new Date(profile.trial_ends_at) : null;
      var inTrial  = status === 'trial' && trialEnd && trialEnd > new Date();

      // Store profile globally for use in PDF export (Step 6)
      window.Mise.profile = profile;

      if (status === 'active' || inTrial) {
        hidePaywall();
        _injectTrialBanner(status, trialEnd);
      } else {
        showPaywall(trialEnd);
      }

    } catch (err) {
      console.warn('[Mise] Subscription check error:', err.message);
      // Fail open — don't lock out users if Supabase is unreachable
    }
  }

  // ── showPaywall ────────────────────────────────────────────────────────────
  function showPaywall(trialEnd) {
    if (document.getElementById('mise-paywall')) return;

    var expiredMsg = '';
    if (trialEnd) {
      var daysAgo = Math.floor((Date.now() - trialEnd.getTime()) / (1000 * 60 * 60 * 24));
      expiredMsg = daysAgo === 0
        ? 'Your free trial ended today.'
        : 'Your free trial ended ' + daysAgo + ' day' + (daysAgo > 1 ? 's' : '') + ' ago.';
    }

    var html = '<div id="mise-paywall" style="position:fixed;inset:0;background:#f5f4f0;z-index:9998;overflow-y:auto;-webkit-overflow-scrolling:touch">'
      + '<div style="max-width:390px;margin:0 auto;padding:48px 20px 60px">'

      // Logo
      + '<div style="display:flex;align-items:center;gap:14px;margin-bottom:32px">'
      +   '<svg width="48" height="48" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;border-radius:12px">'
      +     '<rect width="100" height="100" rx="18" fill="#1a1a18"/>'
      +     '<path d="M22 76 L22 28 L50 56 L78 28 L78 76" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>'
      +     '<line x1="22" y1="76" x2="78" y2="76" stroke="#fff" stroke-width="9" stroke-linecap="round"/>'
      +   '</svg>'
      +   '<div>'
      +     '<div style="font-size:26px;font-weight:700;color:#1a1a18;letter-spacing:-0.5px">Mise</div>'
      +     '<div style="font-size:13px;color:#888;margin-top:1px">HACCP Food Safety</div>'
      +   '</div>'
      + '</div>'

      // Expired notice
      + (expiredMsg
        ? '<div style="background:#fef9ec;border:1px solid #fde68a;border-radius:10px;padding:12px 14px;margin-bottom:20px;font-size:14px;color:#92400e">' + expiredMsg + '</div>'
        : '')

      // Headline
      + '<div style="font-size:24px;font-weight:700;color:#1a1a18;letter-spacing:-0.3px;margin-bottom:10px;line-height:1.3">Keep your kitchen compliant</div>'
      + '<div style="font-size:15px;color:#555;line-height:1.6;margin-bottom:24px">Mise gives you a complete digital HACCP system — temperature logs, checklists, cleaning records, allergen tracking, and PDF reports ready for inspection.</div>'

      // Feature list
      + '<div style="background:#fff;border:1px solid #e5e4de;border-radius:14px;padding:16px 18px;margin-bottom:24px">'
      + _featureRow('🌡️', 'Temperature & fridge logs')
      + _featureRow('✅', 'Opening, closing & cross-contamination checks')
      + _featureRow('🚚', 'Delivery, cleaning & pest control records')
      + _featureRow('⚠️', 'Allergen tracking for all 14 major allergens')
      + _featureRow('📄', 'PDF exports for every daily log')
      + _featureRow('☁️', 'Synced across all your devices')
      + '</div>'

      // Price
      + '<div style="text-align:center;margin-bottom:20px">'
      +   '<span style="font-size:36px;font-weight:700;color:#1a1a18">£12</span>'
      +   '<span style="font-size:16px;color:#888;margin-left:4px">/ month</span>'
      +   '<div style="font-size:12px;color:#aaa;margin-top:4px">Cancel any time</div>'
      + '</div>'

      // Subscribe button
      + '<button onclick="Mise.subscription.startCheckout()" id="paywall-subscribe-btn" '
      +   'style="width:100%;padding:16px;background:#3B6D11;color:#fff;border:none;border-radius:12px;font-size:17px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:12px">Subscribe now</button>'

      // Export records link — always available
      + '<div style="text-align:center">'
      +   '<button onclick="Mise.subscription._showRecordsOnly()" '
      +     'style="background:none;border:none;color:#888;font-size:13px;cursor:pointer;font-family:inherit;text-decoration:underline">Just export my existing records</button>'
      + '</div>'

      // Sign out
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
  // Wired up fully in Step 5. Shows a holding message until then.
  async function startCheckout() {
    var btn = document.getElementById('paywall-subscribe-btn');
    if (btn) { btn.textContent = 'Setting up checkout…'; btn.disabled = true; }

    try {
      var userResult = await supabaseClient.auth.getUser();
      var userId = userResult.data.user.id;

      var res = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userId })
      });
      var data = await res.json();
      if (data.error) throw new Error(data.error);
      window.location.href = data.url;

    } catch (err) {
      console.error('[Mise] Checkout error:', err);
      if (btn) { btn.textContent = 'Subscribe now'; btn.disabled = false; }
      // toast() is defined in index.html
      if (typeof toast === 'function') toast('Checkout not available yet — coming soon', false);
    }
  }

  // ── _showRecordsOnly ───────────────────────────────────────────────────────
  // Hides the paywall and shows only the Records tab (for PDF exports).
  // Users can always get their data out even if their trial has ended.
  function _showRecordsOnly() {
    hidePaywall();
    if (typeof showTab === 'function') showTab('records');
  }

  // ── _injectTrialBanner ─────────────────────────────────────────────────────
  // Shows a subtle "X days left in trial" banner in the app header
  // when the user is in trial and has 5 or fewer days remaining.
  function _injectTrialBanner(status, trialEnd) {
    if (status !== 'trial' || !trialEnd) return;
    var daysLeft = Math.ceil((trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysLeft > 5) return; // only show when getting close

    var header = document.querySelector('.header');
    if (!header || document.getElementById('trial-banner')) return;

    var banner = document.createElement('div');
    banner.id = 'trial-banner';
    banner.style.cssText = 'background:#fef9ec;border-bottom:1px solid #fde68a;padding:7px 16px;font-size:12px;color:#92400e;display:flex;align-items:center;justify-content:space-between;max-width:430px;margin:0 auto;width:100%';
    banner.innerHTML = '<span>' + (daysLeft <= 0 ? 'Trial expired' : daysLeft + ' day' + (daysLeft > 1 ? 's' : '') + ' left in trial') + '</span>'
      + '<button onclick="Mise.subscription.startCheckout()" style="background:#3B6D11;color:#fff;border:none;border-radius:5px;padding:3px 10px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">Subscribe</button>';

    // Insert after the sticky header
    header.insertAdjacentElement('afterend', banner);
  }

  // ── _featureRow (internal) ─────────────────────────────────────────────────
  function _featureRow(icon, text) {
    return '<div style="display:flex;align-items:center;gap:12px;padding:7px 0;border-bottom:1px solid #f0f0ec">'
      + '<span style="font-size:18px;width:24px;text-align:center;flex-shrink:0">' + icon + '</span>'
      + '<span style="font-size:14px;color:#1a1a18">' + text + '</span>'
      + '</div>';
  }

  return { check, showPaywall, hidePaywall, startCheckout, _showRecordsOnly };

})();
