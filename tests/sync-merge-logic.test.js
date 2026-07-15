// tests/sync-merge-logic.test.js — run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const { decidePullOutcome } = require('../js/core/pull-result.js');

test('decidePullOutcome: success with rows replaces the cache', () => {
  const outcome = decidePullOutcome({ data: [{ id: 1 }, { id: 2 }], error: null });
  assert.equal(outcome.keep, false);
  assert.deepEqual(outcome.data, [{ id: 1 }, { id: 2 }]);
});

test('decidePullOutcome: success with an empty array clears the cache (not a no-op)', () => {
  const outcome = decidePullOutcome({ data: [], error: null });
  assert.equal(outcome.keep, false);
  assert.deepEqual(outcome.data, []);
});

test('decidePullOutcome: a network/DB error preserves the existing cache', () => {
  const err = new Error('network error');
  const outcome = decidePullOutcome({ data: null, error: err });
  assert.equal(outcome.keep, true);
  assert.equal(outcome.error, err);
});

test('decidePullOutcome: error present AND data present — error wins (Supabase can return both)', () => {
  const err = new Error('partial failure');
  const outcome = decidePullOutcome({ data: [{ id: 1 }], error: err });
  assert.equal(outcome.keep, true, 'must not apply data when error is also present');
});

test('decidePullOutcome: null/undefined data on success is treated as empty, not preserved', () => {
  const outcome = decidePullOutcome({ data: null, error: null });
  assert.equal(outcome.keep, false);
  assert.deepEqual(outcome.data, []);
});
