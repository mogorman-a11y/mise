// tests/privacy-hardening.test.js — run with: node --test tests/
//
// Regression guards for the 2026-08-31 privacy-hardening pass:
//   1. GA4 + PostHog must not load / initialise before analytics consent
//   2. Client-intake form carries a point-of-collection privacy notice
//   3. haccp-photos storage bucket is private, not public-read
//   4. Logout clears private cached data but keeps device prefs + consent
//   5. Account deletion includes tenant-scoped storage cleanup and does not
//      falsely report success when file deletion fails
//   6. The inaccurate in-app "except Supabase" privacy line is gone
//
// These are static/behavioural guards over the shipped source, deliberately
// checking mechanisms and not exact prose so ordinary copy edits stay safe.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const APP = read('app.html');
const AUTH = read('auth.js');
const INTAKE = read('client-intake.html');
const DELETE_FN = read('supabase/functions/delete-account/index.ts');

// ─────────────────────────────────────────────────────────────────────────────
// 1. Analytics consent
// ─────────────────────────────────────────────────────────────────────────────

test('app.html does NOT eagerly load gtag.js (no consent-free GA <script src>)', () => {
  assert.ok(
    !/<script[^>]+src="https:\/\/www\.googletagmanager\.com\/gtag\/js/.test(APP),
    'gtag.js must only be injected by loadGA() after consent, never via a static <script src>'
  );
});

test('app.html does NOT initialise PostHog at page load (posthog.init only inside loadPostHog)', () => {
  const inits = [...APP.matchAll(/posthog\.init\(/g)];
  assert.equal(inits.length, 1, 'exactly one posthog.init call expected');
  assert.match(
    APP,
    /function loadPostHog\s*\(\)\s*\{[\s\S]*?posthog\.init\(/,
    'posthog.init must be inside loadPostHog()'
  );
});

test('app.html: analytics only boot when consent is already granted', () => {
  assert.match(APP, /var c = readConsent\(\);\s*\n\s*if \(c && c\.analytics\) enableAnalytics\(\);/);
  // The IIFE must not call enableAnalytics unconditionally at the top level.
  assert.ok(!/\n\s*enableAnalytics\(\);\s*\n\}\)\(\);/.test(APP), 'no unconditional enableAnalytics() before the IIFE closes');
});

test('app.html: versioned consent key + central vqAnalytics helper are present', () => {
  assert.ok(APP.includes("'veriqo_cookie_consent_v1'"));
  assert.ok(APP.includes('window.vqAnalytics ='));
  assert.ok(APP.includes('window.vqTrack = function'));
});

test('app.html: consent banner exists, is hidden by default, offers both choices without preselection', () => {
  assert.match(APP, /id="vq-consent-banner"[^>]*\bhidden\b/);
  assert.ok(APP.includes('window.vqAnalytics.setConsent(false)'), 'Necessary only button');
  assert.ok(APP.includes('window.vqAnalytics.setConsent(true)'), 'Allow analytics button');
  assert.ok(/Necessary only<\/button>/.test(APP));
  assert.ok(/Allow analytics<\/button>/.test(APP));
  // no checked/selected default on the choice controls
  assert.ok(!/vq-consent-banner[\s\S]{0,600}checked/.test(APP));
});

test('app.html: Settings exposes cookie/analytics preferences + Privacy/Terms links', () => {
  assert.ok(APP.includes('window.vqOpenConsent()'));
  assert.ok(APP.includes('id="vq-consent-settings-status"'));
  assert.ok(/href="\/privacy"/.test(APP), 'Privacy Policy link');
  assert.ok(/href="\/terms"/.test(APP), 'Terms of Service link');
});

test('app.html: auth.js version bumped for the logout/analytics change', () => {
  assert.match(APP, /auth\.js\?v=39/);
});

// Behavioural: run the real consent IIFE from app.html in a sandbox.
function loadConsentSandbox() {
  const m = APP.match(/<!-- VQ-CONSENT-START -->([\s\S]*?)<!-- VQ-CONSENT-END -->/);
  assert.ok(m, 'consent block markers present');
  const code = m[1].replace(/<\/?script>/g, '');

  const store = {};
  const localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const appended = [];
  const doc = {
    readyState: 'complete',
    cookie: '',
    createElement: (tag) => ({ tagName: tag, async: false, type: '', _src: '', set src(v) { this._src = v; }, get src() { return this._src; } }),
    getElementsByTagName: () => [{ parentNode: { insertBefore() {} } }],
    addEventListener() {},
    dispatchEvent() {},
  };
  doc.head = { appendChild: (n) => appended.push(n) };
  doc.documentElement = doc.head;

  // Pre-seeded fake posthog whose __loaded flag makes the loader snippet a
  // no-op (it must not overwrite an already-loaded instance), so the test
  // exercises our consent code, not PostHog's real bootstrap.
  const posthog = {
    __loaded: true,
    _init: false, _captures: 0, _optedOut: false, _reset: 0,
    init() { this._init = true; },
    identify() {},
    capture() { this._captures++; },
    opt_out_capturing() { this._optedOut = true; },
    reset() { this._reset++; },
  };

  // The browser head runs with `window` === the global, so bare `document`,
  // `localStorage`, `location`, `posthog` and `window.*` all resolve to the
  // same object. Mirror that: the sandbox global IS the window.
  const win = {
    document: doc,
    localStorage,
    location: { hostname: 'getveriqo.co.uk' },
    console,
    posthog,
    CustomEvent: function (type, opts) { this.type = type; this.detail = opts && opts.detail; },
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(code, win);
  return { ctx: win, store, appended, doc };
}

test('consent (behaviour): fresh browser → analytics disabled, no decision, nothing loaded', () => {
  const { ctx, appended } = loadConsentSandbox();
  assert.equal(ctx.window.vqAnalytics.enabled(), false);
  assert.equal(ctx.window.vqAnalytics.hasDecision(), false);
  assert.equal(appended.length, 0, 'no GA script injected');
  assert.equal(ctx.window.posthog._init, false, 'posthog.init not called');
});

test('consent (behaviour): "Necessary only" keeps both providers disabled', () => {
  const { ctx, appended, store } = loadConsentSandbox();
  ctx.window.vqAnalytics.setConsent(false);
  assert.equal(ctx.window.vqAnalytics.enabled(), false);
  assert.equal(ctx.window.vqAnalytics.hasDecision(), true);
  assert.equal(appended.length, 0);
  assert.equal(ctx.window['ga-disable-G-HJBTHP12Y8'], true);
  const saved = JSON.parse(store['veriqo_cookie_consent_v1']);
  assert.equal(saved.analytics, false);
  assert.ok(saved.updated_at, 'timestamped');
});

test('consent (behaviour): "Allow analytics" loads GA + inits PostHog', () => {
  const { ctx, appended } = loadConsentSandbox();
  ctx.window.vqAnalytics.setConsent(true);
  assert.equal(ctx.window.vqAnalytics.enabled(), true);
  assert.ok(appended.some((n) => String(n.src).includes('googletagmanager.com/gtag/js?id=G-HJBTHP12Y8')));
  assert.equal(ctx.window.posthog._init, true);
});

test('consent (behaviour): switching back to Necessary only stops capture + opts out', () => {
  const { ctx } = loadConsentSandbox();
  ctx.window.vqAnalytics.setConsent(true);
  ctx.window.vqAnalytics.setConsent(false);
  assert.equal(ctx.window.vqAnalytics.enabled(), false);
  assert.equal(ctx.window.posthog._optedOut, true);
  assert.ok(ctx.window.posthog._reset >= 1);
  const before = ctx.window.posthog._captures;
  ctx.window.vqTrack('should_not_fire', {});
  assert.equal(ctx.window.posthog._captures, before, 'capture is a no-op once consent is withdrawn');
});

test('consent (behaviour): vqTrack / vqAnalytics.capture never throw when providers absent', () => {
  const { ctx } = loadConsentSandbox();
  delete ctx.window.posthog;
  assert.doesNotThrow(() => ctx.window.vqTrack('evt', { a: 1 }));
  assert.doesNotThrow(() => ctx.window.vqAnalytics.capture('evt'));
  assert.doesNotThrow(() => ctx.window.vqAnalytics.identify('u', {}));
  assert.doesNotThrow(() => ctx.window.vqAnalytics.reset());
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Client-intake privacy notice
// ─────────────────────────────────────────────────────────────────────────────

test('client-intake: point-of-collection privacy notice is present and complete', () => {
  assert.match(INTAKE, /How your information is used/i);
  // chef/business is the controller — they "decide" / "determine" the purpose
  assert.match(INTAKE, /who sent you this form is collecting these details/i);
  assert.match(INTAKE, /They decide how your information is used/i);
  // Veriqo is only the software provider
  assert.match(INTAKE, /Veriqo provides the software used to collect and store this form/i);
  // allergy / dietary data is called out
  assert.match(INTAKE, /allergy or dietary information/i);
  // "only what is relevant"
  assert.match(INTAKE, /only what is relevant|only what[’']s relevant/i);
  // direct questions to the chef/business
  assert.match(INTAKE, /should normally go to .*the chef or business/is);
  // link to the future policy route
  assert.match(INTAKE, /href="\/privacy"/);
  // it names the controller dynamically
  assert.ok(INTAKE.includes("querySelectorAll('.pn-biz')"));
});

test('client-intake: notice is transparency only — no fake consent checkbox gating submit', () => {
  assert.ok(!/id="fi-consent"/.test(INTAKE));
  assert.ok(!/type="checkbox"[^>]*required/i.test(INTAKE));
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. HACCP photo storage is private
// ─────────────────────────────────────────────────────────────────────────────

test('a migration makes the haccp-photos bucket private with a tenant-scoped read policy', () => {
  const dir = path.join(ROOT, 'supabase/migrations');
  const files = fs.readdirSync(dir).filter((f) => /haccp_photos_private\.sql$/.test(f));
  assert.equal(files.length, 1, 'expected one *_haccp_photos_private.sql migration');
  const sql = fs.readFileSync(path.join(dir, files[0]), 'utf8');

  assert.match(sql, /update\s+storage\.buckets\s+set\s+public\s*=\s*false\s+where\s+id\s*=\s*'haccp-photos'/is);
  assert.match(sql, /drop policy if exists "public can read photos" on storage\.objects/i);
  // new SELECT policy is authenticated + owner-folder scoped
  assert.match(sql, /create policy[\s\S]*for select[\s\S]*to authenticated[\s\S]*bucket_id = 'haccp-photos'[\s\S]*storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/i);
  // must NOT reinstate an unscoped public read
  assert.ok(!/for select\s+using\s*\(\s*bucket_id = 'haccp-photos'\s*\)\s*;/i.test(sql), 'no blanket public SELECT re-created');
});

test('original bucket migration is left intact (history not rewritten)', () => {
  const orig = read('supabase/migrations/20260519090844_create_haccp_photos_bucket.sql');
  assert.match(orig, /'haccp-photos', 'haccp-photos', true/); // untouched
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Logout clears private data, keeps device prefs + consent
// ─────────────────────────────────────────────────────────────────────────────

test('auth.js: private-key list covers positioning + legacy sync queue; consent key is NOT cleared', () => {
  assert.match(AUTH, /_PRIVATE_KEY_PREFIXES\s*=\s*\[\s*'haccp_',\s*'mise_',\s*'yield_'\s*\]/);
  for (const k of ['vq_positioning', 'vq_sync_queue', 'veriqo_profile', 'vq_ai_other_costs']) {
    assert.ok(AUTH.includes(`'${k}'`), `expected ${k} in the private-key list`);
  }
  // device prefs / consent must never appear in a removal list
  for (const keep of ['vq_theme', 'vq_accent', 'veriqo_cookie_consent_v1', 'veriqo_install_dismissed']) {
    assert.ok(!new RegExp(`_PRIVATE_KEYS[\\s\\S]*'${keep}'`).test(AUTH), `${keep} must not be in _PRIVATE_KEYS`);
  }
});

test('auth.js: logout empties IndexedDB queues and does not throw on IDB failure', () => {
  assert.match(AUTH, /idbQueue\.set\(\[\]\)/);
  assert.match(AUTH, /idbQueue\.setCosting\(\[\]\)/);
  assert.match(AUTH, /indexedDB\.deleteDatabase\('veriqo-sync'\)/);
  // every idb call is wrapped so a failure can't abort sign-out
  assert.match(AUTH, /try \{ if \(window\.indexedDB && indexedDB\.deleteDatabase\) indexedDB\.deleteDatabase\('veriqo-sync'\); \} catch\(e\) \{\}/);
});

test('auth.js: analytics reset/identify routed through window.vqAnalytics', () => {
  assert.match(AUTH, /window\.vqAnalytics && window\.vqAnalytics\.reset/);
  assert.match(AUTH, /window\.vqAnalytics && window\.vqAnalytics\.identify/);
});

test('app.html: Settings "Sign out" delegates to the single Mise.auth.logout path', () => {
  assert.match(APP, /window\.vqSignOut = async function\(\) \{[\s\S]{0,600}window\.Mise\.auth\.logout\(\)/);
});

// Behavioural: exercise the real _clearPrivateLocalData() from auth.js.
test('logout (behaviour): private data wiped, device prefs + consent kept', async () => {
  // Pull the private-key lists + the function together (the lists are
  // module-level vars the function closes over).
  const m = AUTH.match(/var _PRIVATE_KEY_PREFIXES = \[[\s\S]*?async function _clearPrivateLocalData\(\) \{[\s\S]*?\n  \}\n/);
  assert.ok(m, '_clearPrivateLocalData() + key lists extracted');

  const store = {
    'haccp_2026-01-01': '{}',
    'haccp_settings': '{}',
    'mise_settings': '{}',
    'yield_clients': '[]',
    'yield_quotes': '[]',
    'vq_positioning': '{}',
    'vq_sync_queue': '[]',
    'veriqo_profile': '{}',
    'vq_ai_other_costs': '{}',
    'freelancer_name': 'Sam',
    'sb-yixrwyfodipfcbhjcszp-auth-token': 'tok',
    // must survive:
    'vq_theme': 'dark',
    'vq_accent': 'blue',
    'vq_last_module': 'haccp',
    'veriqo_install_dismissed': '1',
    'veriqo_cookie_consent_v1': '{"analytics":false,"updated_at":"x"}',
  };
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  Object.keys(store).forEach((k) => { localStorage[k] = store[k]; }); // make Object.keys(localStorage) see entries

  let idbDeleted = null;
  const ctx = {
    window: { Mise: { idbQueue: { set: async () => {}, setCosting: async () => {} } }, indexedDB: { deleteDatabase: (n) => { idbDeleted = n; } } },
    indexedDB: { deleteDatabase: (n) => { idbDeleted = n; } },
    localStorage,
    console,
  };
  ctx.window.indexedDB = ctx.indexedDB;
  vm.createContext(ctx);
  vm.runInContext(m[0] + '\nglobalThis.__run = _clearPrivateLocalData;', ctx);
  await ctx.__run();

  for (const gone of ['haccp_2026-01-01', 'haccp_settings', 'mise_settings', 'yield_clients', 'yield_quotes',
                      'vq_positioning', 'vq_sync_queue', 'veriqo_profile', 'vq_ai_other_costs', 'freelancer_name',
                      'sb-yixrwyfodipfcbhjcszp-auth-token']) {
    assert.equal(store[gone], undefined, `${gone} should be cleared on logout`);
  }
  for (const kept of ['vq_theme', 'vq_accent', 'vq_last_module', 'veriqo_install_dismissed', 'veriqo_cookie_consent_v1']) {
    assert.ok(store[kept] !== undefined, `${kept} must be preserved on logout`);
  }
  assert.equal(idbDeleted, 'veriqo-sync');
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Account deletion — storage cleanup, tenant-scoped, honest failure
// ─────────────────────────────────────────────────────────────────────────────

test('delete-account: storage cleanup is part of the deletion path', () => {
  assert.match(DELETE_FN, /deleteUserStorageObjects/);
  assert.match(DELETE_FN, /storage\.listBuckets\(\)/);
  assert.match(DELETE_FN, /\.storage\.from\(bucket\.id\)\.remove\(chunk\)/);
});

test('delete-account: storage walk is rooted at the caller uid (no cross-tenant reach)', () => {
  assert.match(DELETE_FN, /await walk\(uid\)/);
  assert.match(DELETE_FN, /\(storage\.foldername|list\(prefix/); // scoped listing
  assert.ok(!/\.remove\(\['\*'\]\)|emptyBucket\(/.test(DELETE_FN), 'never bulk-empties a bucket');
});

test('delete-account: failed file cleanup returns an error, not a false success', () => {
  assert.match(DELETE_FN, /storage\.errors\.length > 0/);
  assert.match(DELETE_FN, /code: 'storage_cleanup_failed'/);
  assert.match(DELETE_FN, /\}, 500\);/);
  // the failure branch must come BEFORE the table-delete loop
  const idxFail = DELETE_FN.indexOf('storage_cleanup_failed');
  const idxTables = DELETE_FN.indexOf('const tables:');
  assert.ok(idxFail > -1 && idxTables > -1 && idxFail < idxTables, 'storage check precedes DB deletion');
});

test('delete-account: does not leak bucket names / paths to the caller', () => {
  // errors are logged server-side; the JSON body is a generic support message
  assert.match(DELETE_FN, /console\.error\(`delete-account: storage cleanup failed/);
  assert.ok(!/return json\(\{[^}]*storage\.errors/s.test(DELETE_FN));
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. In-app privacy summary corrected
// ─────────────────────────────────────────────────────────────────────────────

test('app.html: the inaccurate "except Supabase" / "EU servers" claims are gone', () => {
  assert.ok(!/except Supabase/.test(APP), '"share it with third parties except Supabase" must be removed');
  assert.ok(!/Supabase, EU servers/.test(APP), '"Supabase, EU servers" claim must be removed');
});

test('app.html: privacy summary now points to the Privacy Policy for the provider list', () => {
  assert.match(APP, /trusted service providers to run Veriqo/i);
  // the corrected sentence names the provider categories and links out
  assert.match(APP, /cloud hosting and database, payments, email, optional analytics[\s\S]{0,120}href="\/privacy"/);
});
