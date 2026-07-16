// tests/sync-merge-logic.test.js — run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const { decidePullOutcome, mergeUnsyncedRecords } = require('../js/core/pull-result.js');

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

// Covers PR #3 round-5 finding: a successful costings pull was replacing the
// cache wholesale, discarding any costing saved locally but still sitting in
// the offline retry queue — the server doesn't have it yet, but that's not
// the same as it being stale.
test('mergeUnsyncedRecords: unsynced record not present in cloud is kept, not dropped', () => {
  const cloud = [{ id: 'a', createdAt: '2026-01-01T00:00:00Z' }];
  const unsynced = [{ id: 'b', createdAt: '2026-01-02T00:00:00Z' }];
  const merged = mergeUnsyncedRecords(cloud, unsynced);
  assert.deepEqual(merged.map(r => r.id).sort(), ['a', 'b']);
});

test('mergeUnsyncedRecords: unsynced version wins over the cloud version of the same id', () => {
  const cloud = [{ id: 'a', createdAt: '2026-01-01T00:00:00Z', value: 'stale-cloud-copy' }];
  const unsynced = [{ id: 'a', createdAt: '2026-01-03T00:00:00Z', value: 'newer-local-copy' }];
  const merged = mergeUnsyncedRecords(cloud, unsynced);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].value, 'newer-local-copy');
});

test('mergeUnsyncedRecords: no unsynced records leaves cloud data untouched', () => {
  const cloud = [{ id: 'a', createdAt: '2026-01-01T00:00:00Z' }, { id: 'b', createdAt: '2026-01-02T00:00:00Z' }];
  const merged = mergeUnsyncedRecords(cloud, []);
  assert.deepEqual(merged.map(r => r.id), ['b', 'a']); // sorted newest first
});

test('mergeUnsyncedRecords: result is sorted by createdAt descending regardless of input order', () => {
  const cloud = [{ id: 'old', createdAt: '2025-01-01T00:00:00Z' }];
  const unsynced = [{ id: 'new', createdAt: '2026-06-01T00:00:00Z' }];
  const merged = mergeUnsyncedRecords(cloud, unsynced);
  assert.deepEqual(merged.map(r => r.id), ['new', 'old']);
});
