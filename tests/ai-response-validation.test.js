// tests/ai-response-validation.test.js — run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const { priceForTargetGP, gpForPrice } = require('../js/core/gp-math.js');
const { isValidJobShape, sanitizePostJobActuals } = require('../js/core/ai-job-shape.js');

test('priceForTargetGP: matches the standard markup formula (cost / (1 - gp))', () => {
  // £100 cost at 75% GP should quote to £400 (cost is 25% of price)
  assert.equal(priceForTargetGP(10000, 75), 40000);
  // £100 cost at 65% GP -> price = 100/0.35 = ~£285.71
  assert.equal(priceForTargetGP(10000, 65), Math.round(10000 / 0.35));
});

test('priceForTargetGP: returns null for impossible (>=100%) targets instead of Infinity/NaN', () => {
  assert.equal(priceForTargetGP(10000, 100), null);
  assert.equal(priceForTargetGP(10000, 150), null);
});

test('priceForTargetGP: zero cost returns zero price, not NaN', () => {
  assert.equal(priceForTargetGP(0, 65), 0);
});

test('gpForPrice: inverse of priceForTargetGP round-trips within rounding tolerance', () => {
  const cost = 10000;
  const price = priceForTargetGP(cost, 65);
  const gp = gpForPrice(cost, price);
  assert.ok(Math.abs(gp - 65) <= 1, 'expected close to 65%, got ' + gp);
});

test('gpForPrice: zero or missing price returns 0, not NaN/Infinity', () => {
  assert.equal(gpForPrice(10000, 0), 0);
  assert.equal(gpForPrice(10000, null), 0);
  assert.equal(gpForPrice(10000, undefined), 0);
});

test('isValidJobShape: accepts a well-formed job response', () => {
  assert.equal(isValidJobShape({
    id: 'abc-123',
    post_job_actuals: [{ ingredient_name: 'Chicken', estimated_portion_cost_pence: 500 }]
  }), true);
});

test('isValidJobShape: rejects missing/malformed fields instead of letting them crash the renderer', () => {
  assert.equal(isValidJobShape(null), false);
  assert.equal(isValidJobShape(undefined), false);
  assert.equal(isValidJobShape({}), false);
  assert.equal(isValidJobShape({ id: 'abc' }), false); // missing post_job_actuals
  assert.equal(isValidJobShape({ id: 123, post_job_actuals: [] }), false); // id not a string
  assert.equal(isValidJobShape({ id: 'abc', post_job_actuals: 'not-an-array' }), false);
  assert.equal(isValidJobShape({ id: 'abc', post_job_actuals: [{ /* no ingredient_name */ }] }), false);
});

test('sanitizePostJobActuals: coerces malformed cost fields to 0 instead of poisoning totals with NaN', () => {
  const result = sanitizePostJobActuals([
    { ingredient_name: 'Good', estimated_portion_cost_pence: 500 },
    { ingredient_name: 'Bad string', estimated_portion_cost_pence: 'not-a-number' },
    { ingredient_name: 'Missing field' },
    { ingredient_name: 'Null', estimated_portion_cost_pence: null },
  ]);
  assert.deepEqual(result.map(r => r.estimated_portion_cost_pence), [500, 0, 0, 0]);
  const total = result.reduce((s, x) => s + x.estimated_portion_cost_pence, 0);
  assert.equal(total, 500);
  assert.ok(!Number.isNaN(total));
});

test('sanitizePostJobActuals: non-array input returns empty array, never throws', () => {
  assert.deepEqual(sanitizePostJobActuals(null), []);
  assert.deepEqual(sanitizePostJobActuals(undefined), []);
  assert.deepEqual(sanitizePostJobActuals('not-an-array'), []);
});
