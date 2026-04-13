// subscription.js — paywall and subscription status
// ───────────────────────────────────────────────────
// Reads the user's profile to decide whether to show the app or the paywall.
//
// Access rules:
//   'trial'     + trial_ends_at in future  → full access
//   'trial'     + trial_ends_at has passed → paywall
//   'active'                               → full access
//   'cancelled' or 'past_due'              → paywall
//
// PDF export is ALWAYS available regardless of status.
// Users keep access to records they've already created.
//
// Exposes via window.Mise.subscription:
//   check(userId)    — run after sign-in to gate app access
//   startCheckout()  — called by "Subscribe now" button on the paywall

window.Mise = window.Mise || {};
window.Mise.subscription = (function () {

  // ── check ──────────────────────────────────────────────────────────────────
  async function check(userId) {
    // TODO (Step 4): fetch subscription status from profiles table
    // const { data: profile, error } = await supabaseClient
    //   .from('profiles')
    //   .select('subscription_status, trial_ends_at, business_name, chef_name')
    //   .eq('id', userId)
    //   .single();

    // if (error) { console.warn('[Mise] Could not read profile:', error.message); return; }

    // const status   = profile?.subscription_status;
    // const trialEnd = profile?.trial_ends_at ? new Date(profile.trial_ends_at) : null;
    // const inTrial  = status === 'trial' && trialEnd && trialEnd > new Date();

    // if (status === 'active' || inTrial) {
    //   hidePaywall();
    // } else {
    //   showPaywall(trialEnd); // pass trialEnd so paywall can say "trial ended X days ago"
    // }

    // TODO (Step 4): store profile data for use in PDF export (Step 6)
    // window.Mise.profile = profile;
  }

  // ── showPaywall ────────────────────────────────────────────────────────────
  function showPaywall(trialEnd) {
    // TODO (Step 4): inject the paywall overlay
    // The paywall HTML will be injected here. It must:
    //   - Cover the main app content
    //   - Show the business description and £12/month price
    //   - Have a "Subscribe now" button that calls startCheckout()
    //   - Leave the PDF export button accessible (add a special class to skip)
  }

  // ── hidePaywall ────────────────────────────────────────────────────────────
  function hidePaywall() {
    // TODO (Step 4): remove paywall overlay if present
    // const el = document.getElementById('mise-paywall');
    // if (el) el.remove();
  }

  // ── startCheckout ──────────────────────────────────────────────────────────
  // Called when user clicks "Subscribe now" on the paywall screen.
  async function startCheckout() {
    // TODO (Step 5): POST to /api/create-checkout and redirect to Stripe
    // try {
    //   const { data: { user } } = await supabaseClient.auth.getUser();
    //   const res = await fetch('/api/create-checkout', {
    //     method: 'POST',
    //     headers: { 'Content-Type': 'application/json' },
    //     body: JSON.stringify({ userId: user.id })
    //   });
    //   const { url, error } = await res.json();
    //   if (error) throw new Error(error);
    //   window.location.href = url;
    // } catch (err) {
    //   console.error('[Mise] Checkout error:', err);
    //   toast('Could not start checkout — please try again', false);
    // }
  }

  return { check, showPaywall, hidePaywall, startCheckout };

})();
