// tests/ai-other-costs-store.test.js — run with: node --test tests/
//
// Covers two bugs found in PR #3 review: (1) round 4 — switching between two
// AI jobs (or reloading one after reconciliation) must show each job's own
// "other direct costs" value, never a blank field or a value left over from
// a different job; (2) round 5 — this is financial data, so entries must
// also be scoped by authenticated user, not just job id, so switching
// accounts on the same device can never surface one account's draft value
// against another account's job.
const test = require('node:test');
const assert = require('node:assert/strict');
const { getStoredOtherCosts, setStoredOtherCosts } = require('../js/core/ai-other-costs-store.js');

// Minimal localStorage-shaped mock, injectable via the storage param.
function mockStorage() {
  var data = {};
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem: function (k, v) { data[k] = String(v); }
  };
}

const UID_A = 'user-aaa';
const UID_B = 'user-bbb';

test('getStoredOtherCosts: returns empty string for a job with no stored value', () => {
  const storage = mockStorage();
  assert.equal(getStoredOtherCosts('job-1', UID_A, storage), '');
});

test('setStoredOtherCosts + getStoredOtherCosts round-trip for a single job', () => {
  const storage = mockStorage();
  setStoredOtherCosts('job-1', UID_A, '25.50', storage);
  assert.equal(getStoredOtherCosts('job-1', UID_A, storage), '25.50');
});

test('two jobs with different other-cost values never leak into each other (same user)', () => {
  const storage = mockStorage();
  setStoredOtherCosts('job-a', UID_A, '10.00', storage);
  setStoredOtherCosts('job-b', UID_A, '99.99', storage);
  assert.equal(getStoredOtherCosts('job-a', UID_A, storage), '10.00');
  assert.equal(getStoredOtherCosts('job-b', UID_A, storage), '99.99');
  // A third, never-touched job must not pick up either value.
  assert.equal(getStoredOtherCosts('job-c', UID_A, storage), '');
});

test('the same job id under two different accounts never leaks between them', () => {
  const storage = mockStorage();
  setStoredOtherCosts('job-1', UID_A, '10.00', storage);
  setStoredOtherCosts('job-1', UID_B, '250.00', storage);
  assert.equal(getStoredOtherCosts('job-1', UID_A, storage), '10.00');
  assert.equal(getStoredOtherCosts('job-1', UID_B, storage), '250.00');
});

test('without a uid, get and set are no-ops rather than falling back to a shared bucket', () => {
  const storage = mockStorage();
  setStoredOtherCosts('job-1', UID_A, '10.00', storage);
  setStoredOtherCosts('job-1', null, '999.99', storage); // must not overwrite user A's value
  assert.equal(getStoredOtherCosts('job-1', UID_A, storage), '10.00');
  assert.equal(getStoredOtherCosts('job-1', null, storage), '');
});

test('setStoredOtherCosts with an empty value clears that job\'s entry instead of storing ""', () => {
  const storage = mockStorage();
  setStoredOtherCosts('job-1', UID_A, '25.50', storage);
  setStoredOtherCosts('job-1', UID_A, '', storage);
  assert.equal(getStoredOtherCosts('job-1', UID_A, storage), '');
  // Confirm the key was actually deleted, not just set to an empty string
  // (matters for keeping the stored map from growing unboundedly).
  const map = JSON.parse(storage.getItem('vq_ai_other_costs'));
  assert.equal('job-1' in (map[UID_A] || {}), false);
});

test('clearing a user\'s only entry removes the user\'s bucket entirely', () => {
  const storage = mockStorage();
  setStoredOtherCosts('job-1', UID_A, '25.50', storage);
  setStoredOtherCosts('job-1', UID_A, '', storage);
  const map = JSON.parse(storage.getItem('vq_ai_other_costs'));
  assert.equal(UID_A in map, false);
});

test('malformed existing storage value is treated as empty and self-heals on next write', () => {
  const storage = mockStorage();
  storage.setItem('vq_ai_other_costs', 'not valid json{{{');
  assert.equal(getStoredOtherCosts('job-1', UID_A, storage), '');
  // A write after corruption must actually persist, not just avoid throwing —
  // otherwise one bad value would permanently block this key.
  setStoredOtherCosts('job-1', UID_A, '5.00', storage);
  assert.equal(getStoredOtherCosts('job-1', UID_A, storage), '5.00');
});
