// tests/api-contract.test.js — run with: node --test tests/
//
// Exercises the request-validation paths of the AI Costing endpoints that
// are safe to test offline (no live Supabase/OpenAI call is reached): CORS
// preflight and the "no Authorization header" 401. Deeper business-logic
// paths (400s for malformed payloads, successful estimate/reconcile flows)
// require a live Supabase project (verifyUser calls SUPABASE_URL) and are
// covered by the manual verification checklist against the Vercel preview
// instead — see the PR description.
const test = require('node:test');
const assert = require('node:assert/strict');
const veriqoEstimate = require('../api/veriqo-estimate.js');
const veriqoJob = require('../api/veriqo-job.js');

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

test('veriqo-estimate: OPTIONS preflight returns 200 without touching auth/AI', async () => {
  var res = mockRes();
  await veriqoEstimate({ method: 'OPTIONS', headers: {} }, res);
  assert.equal(res.statusCode, 200);
});

test('veriqo-estimate: missing Authorization header returns 401 before any AI/DB call', async () => {
  var res = mockRes();
  await veriqoEstimate({ method: 'POST', headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.match(res.body.error, /unauthorized/i);
});

test('veriqo-estimate: non-POST/OPTIONS method is rejected', async () => {
  var res = mockRes();
  await veriqoEstimate({ method: 'GET', headers: { authorization: 'Bearer x' } }, res);
  assert.equal(res.statusCode, 405);
});

test('veriqo-job: OPTIONS preflight returns 200 without touching auth/DB', async () => {
  var res = mockRes();
  await veriqoJob({ method: 'OPTIONS', headers: {} }, res);
  assert.equal(res.statusCode, 200);
});

test('veriqo-job: missing Authorization header returns 401 for every HTTP method', async () => {
  for (const method of ['GET', 'PATCH', 'POST']) {
    var res = mockRes();
    await veriqoJob({ method: method, headers: {}, body: {}, query: {} }, res);
    assert.equal(res.statusCode, 401, method + ' should require auth');
  }
});
