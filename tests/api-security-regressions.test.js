// tests/api-security-regressions.test.js — run with: node --test tests/
//
// Regression guards for the two release-blocking findings in the
// 2026-07-22 security audit (VERIQO_AUDIT_2026-07-22.md), VQ-001 and VQ-002.
// Like tests/api-contract.test.js, this only exercises request-validation
// paths that are safe to run offline (no live Supabase/Stripe/Resend call
// is reached) — deeper flows need a live project and are covered manually.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const magicLink = require('../api/magic-link.js');
const stripeConnect = require('../api/stripe-connect.js');

function mockRes() {
  var res = {
    statusCode: null,
    headers: {},
    body: null,
    setHeader: function (k, v) { res.headers[k] = v; },
    status: function (code) { res.statusCode = code; return res; },
    json: function (payload) { res.body = payload; return res; },
    end: function () { return res; }
  };
  return res;
}

// ── VQ-001: magic-link open redirect ───────────────────────────────────────

test('magic-link _safeRedirect: same-origin absolute URL is preserved', () => {
  const out = magicLink._safeRedirect('https://getveriqo.co.uk/app?stripe=connected');
  assert.equal(out, 'https://getveriqo.co.uk/app?stripe=connected');
});

test('magic-link _safeRedirect: relative path resolves against the real origin', () => {
  const out = magicLink._safeRedirect('/yield?stripe=refresh');
  assert.equal(out, 'https://getveriqo.co.uk/yield?stripe=refresh');
});

test('magic-link _safeRedirect: malicious cross-origin destination is rejected', () => {
  assert.equal(magicLink._safeRedirect('https://attacker.example/harvest'), null);
});

test('magic-link _safeRedirect: protocol-relative host swap is rejected', () => {
  assert.equal(magicLink._safeRedirect('//attacker.example/harvest'), null);
});

test('magic-link _safeRedirect: non-http(s) scheme is rejected', () => {
  assert.equal(magicLink._safeRedirect('javascript:alert(document.cookie)'), null);
});

test('magic-link _safeRedirect: same host over plain http is rejected (origin must match exactly)', () => {
  assert.equal(magicLink._safeRedirect('http://getveriqo.co.uk/app'), null);
});

test('magic-link _safeRedirect: empty/missing input returns null', () => {
  assert.equal(magicLink._safeRedirect(''), null);
  assert.equal(magicLink._safeRedirect(undefined), null);
});

test('magic-link: OPTIONS preflight returns 204 without touching Supabase/Resend', async () => {
  var res = mockRes();
  await magicLink({ method: 'OPTIONS', headers: {} }, res);
  assert.equal(res.statusCode, 204);
});

test('magic-link: non-POST/OPTIONS method is rejected', async () => {
  var res = mockRes();
  await magicLink({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 405);
});

test('magic-link: missing email returns 400 before any network call', async () => {
  var res = mockRes();
  await magicLink({ method: 'POST', headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 400);
});

test('magic-link: invalid type returns 400 before any network call', async () => {
  var res = mockRes();
  await magicLink({ method: 'POST', headers: {}, body: { email: 'a@b.com', type: 'not-a-real-type' } }, res);
  assert.equal(res.statusCode, 400);
});

test('magic-link: CORS is scoped to the real origin, not a wildcard (regression guard for VQ-001)', async () => {
  var res = mockRes();
  await magicLink({ method: 'OPTIONS', headers: {} }, res);
  assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://getveriqo.co.uk');
});

// ── VQ-002: Stripe Connect IDOR ─────────────────────────────────────────────

test('stripe-connect: OPTIONS preflight returns 200 without touching Stripe/Supabase', async () => {
  var res = mockRes();
  await stripeConnect({ method: 'OPTIONS', headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 200);
});

test('stripe-connect: GET is rejected for chef actions now that they require POST', async () => {
  for (const action of ['onboard', 'refresh', 'dashboard']) {
    var res = mockRes();
    await stripeConnect({ method: 'GET', headers: {}, query: { action, uid: 'someone-elses-uuid' } }, res);
    assert.equal(res.statusCode, 405, action + ' should reject GET');
  }
});

test('stripe-connect: missing Authorization header returns 401 for every chef action, before any Stripe/Supabase call', async () => {
  for (const action of ['onboard', 'refresh', 'dashboard']) {
    var res = mockRes();
    await stripeConnect({ method: 'POST', headers: {}, query: { action, uid: 'someone-elses-uuid' }, body: {} }, res);
    assert.equal(res.statusCode, 401, action + ' should require auth');
  }
});

test('stripe-connect: unknown action returns 400', async () => {
  var res = mockRes();
  await stripeConnect({ method: 'POST', headers: {}, query: { action: 'not-a-real-action' }, body: {} }, res);
  assert.equal(res.statusCode, 400);
});

test('stripe-connect: checkout (client-facing) still works unauthenticated but requires quoteId', async () => {
  var res = mockRes();
  await stripeConnect({ method: 'POST', headers: {}, query: { action: 'checkout' }, body: {} }, res);
  assert.equal(res.statusCode, 400);
});

test('stripe-connect: chef actions never read uid from the query string (regression guard for VQ-002 IDOR)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../api/stripe-connect.js'), 'utf8');
  // The vulnerable code read `req.query?.uid` (or `req.query.uid`) and passed
  // it straight to handleOnboard/handleRefresh/handleDashboard. Guard against
  // that pattern reappearing anywhere in the file.
  assert.doesNotMatch(src, /req\.query\??\.uid/);
});
