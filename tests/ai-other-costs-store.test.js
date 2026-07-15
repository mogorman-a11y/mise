// tests/ai-other-costs-store.test.js — run with: node --test tests/
//
// Covers the bug found in PR #3 review round 4: switching between two AI
// jobs (or reloading one after reconciliation) must show each job's own
// "other direct costs" value, never a blank field or a value left over
// from a different job.
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

test('getStoredOtherCosts: returns empty string for a job with no stored value', () => {
  const storage = mockStorage();
  assert.equal(getStoredOtherCosts('job-1', storage), '');
});

test('setStoredOtherCosts + getStoredOtherCosts round-trip for a single job', () => {
  const storage = mockStorage();
  setStoredOtherCosts('job-1', '25.50', storage);
  assert.equal(getStoredOtherCosts('job-1', storage), '25.50');
});

test('two jobs with different other-cost values never leak into each other', () => {
  const storage = mockStorage();
  setStoredOtherCosts('job-a', '10.00', storage);
  setStoredOtherCosts('job-b', '99.99', storage);
  assert.equal(getStoredOtherCosts('job-a', storage), '10.00');
  assert.equal(getStoredOtherCosts('job-b', storage), '99.99');
  // A third, never-touched job must not pick up either value.
  assert.equal(getStoredOtherCosts('job-c', storage), '');
});

test('setStoredOtherCosts with an empty value clears that job\'s entry instead of storing ""', () => {
  const storage = mockStorage();
  setStoredOtherCosts('job-1', '25.50', storage);
  setStoredOtherCosts('job-1', '', storage);
  assert.equal(getStoredOtherCosts('job-1', storage), '');
  // Confirm the key was actually deleted, not just set to an empty string
  // (matters for keeping the stored map from growing unboundedly).
  const map = JSON.parse(storage.getItem('vq_ai_other_costs'));
  assert.equal('job-1' in map, false);
});

test('malformed existing storage value is treated as empty and self-heals on next write', () => {
  const storage = mockStorage();
  storage.setItem('vq_ai_other_costs', 'not valid json{{{');
  assert.equal(getStoredOtherCosts('job-1', storage), '');
  // A write after corruption must actually persist, not just avoid throwing —
  // otherwise one bad value would permanently block this key.
  setStoredOtherCosts('job-1', '5.00', storage);
  assert.equal(getStoredOtherCosts('job-1', storage), '5.00');
});
