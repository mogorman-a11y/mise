// auth.js — authentication (login, signup, logout, session)
// ──────────────────────────────────────────────────────────
// Uses Supabase Auth. supabaseClient must be initialised (supabase.js) first.
//
// NOTE: By default Supabase requires email confirmation on signup.
// For development, disable this in:
//   Supabase dashboard → Authentication → Providers → Email → "Confirm email" toggle

window.Mise = window.Mise || {};
window.Mise.auth = (function () {

  // Track which tab is active on the auth screen
  let _currentTab = 'signin';

  // ── Auth overlay HTML ──────────────────────────────────────────────────────
  function _buildAuthHTML() {
    return '<div id="mise-auth" style="position:fixed;inset:0;background:#f5f4f0;z-index:9999;overflow-y:auto;-webkit-overflow-scrolling:touch">'
      + '<div style="max-width:390px;margin:0 auto;padding:48px 20px 40px">'

      // Logo
      + '<div style="display:flex;align-items:center;gap:14px;margin-bottom:36px">'
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

      // Tab toggle
      + '<div style="display:flex;background:#e8e8e4;border-radius:10px;padding:3px;margin-bottom:20px">'
      +   '<button id="auth-tab-signin" onclick="Mise.auth._tab(\'signin\')" style="flex:1;padding:9px;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;background:#fff;color:#1a1a18;box-shadow:0 1px 3px rgba(0,0,0,0.12);font-family:inherit;transition:all 0.15s">Sign in</button>'
      +   '<button id="auth-tab-signup" onclick="Mise.auth._tab(\'signup\')" style="flex:1;padding:9px;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;background:transparent;color:#888;font-family:inherit;transition:all 0.15s">Create account</button>'
      + '</div>'

      // Form card
      + '<div style="background:#fff;border-radius:16px;border:1px solid #e5e4de;padding:20px 18px">'

      // Sign-up only fields (hidden initially)
      +   '<div id="auth-signup-fields" style="display:none">'
      +     '<input id="auth-business" type="text" placeholder="Business name" autocomplete="organization" '
      +       'style="width:100%;padding:12px;border:1px solid #e5e4de;border-radius:8px;font-size:15px;margin-bottom:10px;outline:none;font-family:inherit;background:#fff">'
      +     '<input id="auth-chefname" type="text" placeholder="Your name" autocomplete="name" '
      +       'style="width:100%;padding:12px;border:1px solid #e5e4de;border-radius:8px;font-size:15px;margin-bottom:10px;outline:none;font-family:inherit;background:#fff">'
      +   '</div>'

      // Email + password
      +   '<input id="auth-email" type="email" placeholder="Email address" autocomplete="email" '
      +     'style="width:100%;padding:12px;border:1px solid #e5e4de;border-radius:8px;font-size:15px;margin-bottom:10px;outline:none;font-family:inherit;background:#fff">'
      +   '<input id="auth-password" type="password" placeholder="Password" autocomplete="current-password" '
      +     'style="width:100%;padding:12px;border:1px solid #e5e4de;border-radius:8px;font-size:15px;outline:none;font-family:inherit;background:#fff">'

      // Error/info message
      +   '<div id="auth-msg" style="display:none;border-radius:8px;padding:10px 12px;font-size:13px;margin-top:10px"></div>'

      // Submit
      +   '<button id="auth-submit" onclick="Mise.auth._submit()" '
      +     'style="width:100%;padding:14px;background:#3B6D11;color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:600;cursor:pointer;font-family:inherit;margin-top:14px">Sign in</button>'

      // Forgot password (sign-in only)
      +   '<div id="auth-forgot-row" style="text-align:center;margin-top:11px">'
      +     '<button onclick="Mise.auth._forgot()" style="background:none;border:none;color:#888;font-size:13px;cursor:pointer;font-family:inherit">Forgot password?</button>'
      +   '</div>'

      // Trial note (sign-up only)
      +   '<div id="auth-trial-note" style="display:none;text-align:center;margin-top:11px;font-size:12px;color:#888">14-day free trial &middot; No card required</div>'

      + '</div>'

      // Divider
      + '<div style="display:flex;align-items:center;gap:10px;margin:16px 0">'
      +   '<div style="flex:1;height:1px;background:#e5e4de"></div>'
      +   '<span style="font-size:12px;color:#aaa">or</span>'
      +   '<div style="flex:1;height:1px;background:#e5e4de"></div>'
      + '</div>'

      // Google button
      + '<button onclick="Mise.auth._google()" '
      +   'style="width:100%;padding:13px;background:#fff;border:1px solid #e5e4de;border-radius:10px;font-size:15px;font-weight:500;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;font-family:inherit">'
      +   '<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">'
      +     '<path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908C17.218 14.375 17.64 11.925 17.64 9.2z"/>'
      +     '<path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>'
      +     '<path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>'
      +     '<path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"/>'
      +   '</svg>'
      +   'Continue with Google'
      + '</button>'

      + '</div></div>';
  }

  // ── init ───────────────────────────────────────────────────────────────────
  // Called once on page load. Shows auth screen immediately, then checks for
  // an existing session to avoid making the user log in every visit.
  async function init() {
    showAuthScreen(); // show immediately — removes itself if session found

    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (session) {
        await onSignedIn(session.user);
        return;
      }
    } catch (e) {
      console.warn('[Mise] getSession error:', e);
    }

    // No session — auth screen stays. Listen for OAuth redirect callbacks.
    supabaseClient.auth.onAuthStateChange(async (_event, session) => {
      if (session) { await onSignedIn(session.user); }
    });
  }

  // ── _tab ───────────────────────────────────────────────────────────────────
  // Switches the auth form between "Sign in" and "Create account" views.
  function _tab(tab) {
    _currentTab = tab;
    const isSignup = tab === 'signup';

    document.getElementById('auth-signup-fields').style.display = isSignup ? 'block' : 'none';
    document.getElementById('auth-forgot-row').style.display    = isSignup ? 'none'  : 'block';
    document.getElementById('auth-trial-note').style.display    = isSignup ? 'block' : 'none';
    document.getElementById('auth-submit').textContent          = isSignup ? 'Create account' : 'Sign in';

    // Active tab styling
    var active   = document.getElementById('auth-tab-' + tab);
    var inactive = document.getElementById('auth-tab-' + (isSignup ? 'signin' : 'signup'));
    active.style.background  = '#fff';
    active.style.color       = '#1a1a18';
    active.style.boxShadow   = '0 1px 3px rgba(0,0,0,0.12)';
    inactive.style.background = 'transparent';
    inactive.style.color      = '#888';
    inactive.style.boxShadow  = 'none';

    _clearMsg();
  }

  // ── _submit ────────────────────────────────────────────────────────────────
  // Handles the main form button — routes to login() or signup().
  async function _submit() {
    var email    = (document.getElementById('auth-email').value    || '').trim();
    var password =  document.getElementById('auth-password').value || '';
    var btn      =  document.getElementById('auth-submit');

    if (!email || !password) { _setMsg('Please enter your email and password.', 'error'); return; }

    btn.textContent = _currentTab === 'signin' ? 'Signing in…' : 'Creating account…';
    btn.disabled = true;
    _clearMsg();

    try {
      if (_currentTab === 'signin') {
        await login(email, password);
      } else {
        var business = (document.getElementById('auth-business').value || '').trim();
        var chefname = (document.getElementById('auth-chefname').value || '').trim();
        await signup(email, password, business, chefname);
      }
    } catch (err) {
      _setMsg(_friendlyError(err.message), 'error');
      btn.textContent = _currentTab === 'signin' ? 'Sign in' : 'Create account';
      btn.disabled = false;
    }
  }

  // ── _forgot ────────────────────────────────────────────────────────────────
  async function _forgot() {
    var email = (document.getElementById('auth-email').value || '').trim();
    if (!email) { _setMsg('Enter your email address first.', 'error'); return; }
    try {
      await resetPassword(email);
      _setMsg('Reset link sent — check your inbox.', 'ok');
    } catch (err) {
      _setMsg(_friendlyError(err.message), 'error');
    }
  }

  // ── _google ────────────────────────────────────────────────────────────────
  async function _google() {
    try {
      await loginGoogle();
    } catch (err) {
      _setMsg(_friendlyError(err.message), 'error');
    }
  }

  // ── login ──────────────────────────────────────────────────────────────────
  async function login(email, password) {
    var result = await supabaseClient.auth.signInWithPassword({ email: email, password: password });
    if (result.error) throw result.error;
    await onSignedIn(result.data.user);
  }

  // ── signup ─────────────────────────────────────────────────────────────────
  async function signup(email, password, businessName, chefName) {
    var result = await supabaseClient.auth.signUp({ email: email, password: password });
    if (result.error) throw result.error;

    if (result.data.user && result.data.session) {
      // Email confirmation is disabled — signed in immediately
      await createProfile(result.data.user, businessName, chefName);
      await onSignedIn(result.data.user);
    } else {
      // Email confirmation is enabled — tell user to check their inbox
      _setMsg('Account created! Check your email to confirm, then sign in.', 'ok');
      var btn = document.getElementById('auth-submit');
      if (btn) { btn.textContent = 'Create account'; btn.disabled = false; }
    }
  }

  // ── loginGoogle ────────────────────────────────────────────────────────────
  async function loginGoogle() {
    var result = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    });
    if (result.error) throw result.error;
    // Page redirects away — onAuthStateChange handles the return visit
  }

  // ── logout ─────────────────────────────────────────────────────────────────
  async function logout() {
    await supabaseClient.auth.signOut();
    // Clear in-memory app state
    if (typeof records !== 'undefined') records.length = 0;
    // Remove the account card from settings
    var el = document.getElementById('mise-account-card');
    if (el) el.remove();
    // Show the auth screen
    showAuthScreen();
  }

  // ── resetPassword ──────────────────────────────────────────────────────────
  async function resetPassword(email) {
    var result = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/?reset=true'
    });
    if (result.error) throw result.error;
  }

  // ── internal: onSignedIn ───────────────────────────────────────────────────
  async function onSignedIn(user) {
    hideAuthScreen();
    _injectAccountCard(user);

    // Pull records + settings from Supabase, hydrate localStorage, then re-render
    if (window.Mise && window.Mise.sync) {
      await Mise.sync.loadAll(user.id);
    }

    // Check subscription — shows paywall if trial expired or cancelled
    if (window.Mise && window.Mise.subscription) {
      await Mise.subscription.check(user.id);
    }

    // Re-render app with synced data
    if (typeof loadSettings       === 'function') loadSettings();
    if (typeof populateAllSelects === 'function') populateAllSelects();
    if (typeof renderChecklists   === 'function') renderChecklists();
    if (typeof renderAllSections  === 'function') renderAllSections();
    if (typeof updateDashboard    === 'function') updateDashboard();
    // Populate profile card in Settings with saved name/logo
    if (typeof loadProfileUI      === 'function') loadProfileUI();
  }

  // ── internal: showAuthScreen ───────────────────────────────────────────────
  function showAuthScreen() {
    if (document.getElementById('mise-auth')) return; // already visible
    document.body.insertAdjacentHTML('beforeend', _buildAuthHTML());
  }

  // ── internal: hideAuthScreen ───────────────────────────────────────────────
  function hideAuthScreen() {
    var el = document.getElementById('mise-auth');
    if (el) el.remove();
  }

  // ── internal: _injectAccountCard ──────────────────────────────────────────
  // Adds an "Account" card at the top of the Settings tab showing the user's
  // email and a Sign out button. Removed on logout.
  function _injectAccountCard(user) {
    if (document.getElementById('mise-account-card')) return;
    var settingsTab = document.getElementById('tab-settings');
    if (!settingsTab) return;

    var card = document.createElement('div');
    card.id = 'mise-account-card';
    card.className = 'card';
    card.style.marginBottom = '16px';
    card.innerHTML = '<div class="card-title">Account</div>'
      + '<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0">'
      +   '<div>'
      +     '<div style="font-size:14px;font-weight:600;color:#1a1a18">' + _esc(user.email) + '</div>'
      +     '<div style="font-size:12px;color:#888;margin-top:2px">Signed in</div>'
      +   '</div>'
      +   '<button onclick="Mise.auth.logout()" style="padding:8px 14px;background:#f0f0ec;border:1px solid #e5e4de;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;color:#1a1a18;font-family:inherit">Sign out</button>'
      + '</div>';

    settingsTab.insertBefore(card, settingsTab.firstChild);
  }

  // ── internal: createProfile ────────────────────────────────────────────────
  async function createProfile(user, businessName, chefName) {
    // Extended trial for beta feedback period — change to 14 days when launching paid
    var trialEnds = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    var result = await supabaseClient.from('profiles').insert({
      id: user.id,
      business_name: businessName || '',
      chef_name: chefName || '',
      subscription_status: 'trial',
      trial_ends_at: trialEnds
    });
    if (result.error) console.warn('[Mise] createProfile error:', result.error.message);
  }

  // ── internal: message helpers ──────────────────────────────────────────────
  function _setMsg(msg, type) {
    var el = document.getElementById('auth-msg');
    if (!el) return;
    el.textContent = msg;
    if (type === 'ok') {
      el.style.cssText = 'display:block;background:#f0fdf4;border:1px solid #bbf7d0;color:#15803d;border-radius:8px;padding:10px 12px;font-size:13px;margin-top:10px';
    } else {
      el.style.cssText = 'display:block;background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;border-radius:8px;padding:10px 12px;font-size:13px;margin-top:10px';
    }
  }

  function _clearMsg() {
    var el = document.getElementById('auth-msg');
    if (el) el.style.display = 'none';
  }

  function _friendlyError(msg) {
    if (!msg) return 'Something went wrong — please try again.';
    if (msg.includes('Invalid login credentials'))   return 'Incorrect email or password.';
    if (msg.includes('Email not confirmed'))         return 'Please confirm your email address first.';
    if (msg.includes('User already registered'))     return 'An account with this email already exists — try signing in.';
    if (msg.includes('Password should be'))         return 'Password must be at least 6 characters.';
    if (msg.includes('Unable to validate email'))    return 'Please enter a valid email address.';
    return msg;
  }

  function _esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // Expose internal tab/form handlers so onclick attributes in injected HTML can call them
  return { init, login, signup, loginGoogle, logout, resetPassword, _tab, _submit, _forgot, _google };

})();
