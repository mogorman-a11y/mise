// tests/job-packet-allergen-conflict.test.js — run with: node --test tests/
//
// Phase 0 regression protection (see Architecture Decisions.md: "Recipe
// costing is additive to dishes...") for the shipped chain the costing
// rebuild must not disturb:
//   dishIds -> menu -> job-menu snapshot -> active HACCP job -> allergen-conflict detection
//
// Loads the real functions out of js/modules/haccp.js (see
// tests/support/extract-source-fns.js for why) into a vm context with a
// minimal localStorage + document/DOM-renderer stubs, so this exercises the
// actual shipped logic, not a reimplementation of it.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { extractFunctions } = require('./support/extract-source-fns.js');

const HACCP_JS = path.join(__dirname, '../js/modules/haccp.js');

const SOURCE = extractFunctions(HACCP_JS, [
  'esc',
  'todayStr',
  '_checkJobConflictsOnLoad',
  '_findJobForToday',
  '_getJobGuestsForConflict',
  '_getJobDishAllergenMap',
  '_checkImmediateConflict',
  '_checkCookingConflict',
  '_pushRecord',
]);

// Objects/arrays *constructed by code running inside the vm context* (e.g.
// `var map = {}` inside an extracted function) are instances of that
// context's own Object/Array intrinsics, not this file's — deepStrictEqual
// considers them structurally-equal-but-not-reference-equal and fails purely
// on realm, never on content. A JSON round-trip normalizes back to this
// realm's plain objects for comparison; every value compared here is
// JSON-safe (strings/arrays/plain objects), so nothing is lost.
function toPlain(x) { return JSON.parse(JSON.stringify(x)); }

function makeLocalStorage(initial) {
  const store = Object.assign({}, initial);
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    key: (i) => Object.keys(store)[i] || null,
    get length() { return Object.keys(store).length; },
  };
}

// Builds a fresh vm context loading the real haccp.js functions above.
// `localStorageContents` seeds mise_* keys the way sync.js/menus.js would.
function makeContext(localStorageContents) {
  const menuDishes = require('../js/core/menu-dishes.js');
  const allergens = require('../js/core/allergens.js');
  const calls = { conflictLines: null, renderActiveJobBannerCalls: 0, toasts: [] };

  const context = vm.createContext({
    records: [],
    settings: { allergenGuests: [] },
    _haccpActiveJob: null,
    localStorage: makeLocalStorage(localStorageContents),
    window: {
      Veriqo: {
        resolveMenuDishes: menuDishes.resolveMenuDishes,
        normalizeAllergen: allergens.normalizeAllergen,
      },
    },
    // Rendering side-effects are stubbed (not extracted) — this suite tests
    // conflict *detection*, not DOM rendering. _renderAllergenConflictBanners
    // doubles as the assertion point: what conflict lines did detection produce.
    _renderActiveJobBanner: function () { calls.renderActiveJobBannerCalls++; },
    _renderAllergenConflictBanners: function (lines) { calls.conflictLines = lines; },
    renderAllergenGuests: function () {},
    toast: function (msg) { calls.toasts.push(msg); },
    _calls: calls,
  });
  vm.runInContext(SOURCE, context);
  return context;
}

test('_findJobForToday: finds a job packet whose eventDate is today among mise_* keys', () => {
  const today = new Date().toISOString().slice(0, 10);
  const ctx = makeContext({
    mise_2026: JSON.stringify([{ type: 'job', eventDate: today, id: 'job-1', client: 'Smith Wedding', guests: [] }]),
  });
  ctx._findJobForToday();
  assert.equal(ctx._haccpActiveJob.id, 'job-1');
  assert.equal(ctx._calls.renderActiveJobBannerCalls, 1);
});

test('_findJobForToday: no job matches today — active job stays null', () => {
  const ctx = makeContext({
    mise_2026: JSON.stringify([{ type: 'job', eventDate: '2020-01-01', id: 'job-old' }]),
  });
  ctx._findJobForToday();
  assert.equal(ctx._haccpActiveJob, null);
});

test('_findJobForToday: never reads mise_settings as a job list (explicit skip)', () => {
  const today = new Date().toISOString().slice(0, 10);
  const ctx = makeContext({
    // Shaped like a job record but stored under the settings key — must be ignored.
    mise_settings: JSON.stringify([{ type: 'job', eventDate: today, id: 'should-not-load' }]),
  });
  ctx._findJobForToday();
  assert.equal(ctx._haccpActiveJob, null);
});

test('_getJobGuestsForConflict: returns active job guests when a job is loaded, not global guests', () => {
  const ctx = makeContext({});
  ctx.settings.allergenGuests = [{ id: 'g-global', name: 'Global Guest', allergens: ['Celery'] }];
  ctx._haccpActiveJob = { id: 'job-1', guests: [{ id: 'g-job', name: 'Job Guest', allergens: ['Peanuts'] }] };
  const guests = ctx._getJobGuestsForConflict();
  assert.deepEqual(guests, [{ id: 'g-job', name: 'Job Guest', allergens: ['Peanuts'] }]);
});

test('_getJobGuestsForConflict: falls back to global settings.allergenGuests when no job is active', () => {
  const ctx = makeContext({});
  ctx.settings.allergenGuests = [{ id: 'g-global', name: 'Global Guest', allergens: ['Celery'] }];
  ctx._haccpActiveJob = null;
  const guests = ctx._getJobGuestsForConflict();
  assert.deepEqual(guests, [{ id: 'g-global', name: 'Global Guest', allergens: ['Celery'] }]);
});

// This is the invariant the costing rebuild's ADR calls out explicitly:
// "job-menu snapshots retain their current allergen data." _getJobDishAllergenMap
// resolves each job menu via resolveMenuDishes(m, null) — note the `null` — so
// it ONLY ever sees a menu's *embedded* `dishes`, never dishIds. A job-menu
// snapshot that only carries dishIds (no pre-expanded dishes) silently
// produces an empty allergen map, i.e. allergen-conflict detection goes dark
// for that job with no error. Costing work must not introduce a job-menu path
// that skips embedding dishes.
test('_getJobDishAllergenMap: reads allergens from a job menu that embeds dishes', () => {
  const ctx = makeContext({});
  ctx._haccpActiveJob = {
    id: 'job-1',
    menus: [{ dishes: [{ dish: 'Peanut Satay', allergens: ['Peanuts'] }] }],
  };
  const map = ctx._getJobDishAllergenMap();
  assert.deepEqual(toPlain(map), { Peanuts: ['Peanut Satay'] });
});

test('_getJobDishAllergenMap: a job menu with ONLY dishIds (no embedded dishes) resolves to an empty map', () => {
  const ctx = makeContext({});
  ctx._haccpActiveJob = {
    id: 'job-1',
    menus: [{ dishIds: ['d1'] }], // no embedded `dishes` — dishesById is unreachable here (null passed)
  };
  const map = ctx._getJobDishAllergenMap();
  assert.deepEqual(toPlain(map), {}, 'dishIds-only job menus must not silently pass conflict detection — they must be embedded at attach time');
});

test('_getJobDishAllergenMap: normalizes allergen spelling variants (Menus/AI import vs HACCP guest checkboxes)', () => {
  const ctx = makeContext({});
  ctx._haccpActiveJob = {
    id: 'job-1',
    menus: [{ dishes: [{ dish: 'Pasta', allergens: ['Cereals with gluten'] }] }],
  };
  const map = ctx._getJobDishAllergenMap();
  assert.deepEqual(toPlain(map), { 'Cereals containing gluten': ['Pasta'] });
});

test('_checkJobConflictsOnLoad: no guests on the active job -> renders empty banner, no crash', () => {
  const ctx = makeContext({});
  ctx._haccpActiveJob = { id: 'job-1', guests: [] };
  ctx._checkJobConflictsOnLoad();
  assert.deepEqual(toPlain(ctx._calls.conflictLines), []);
});

test('_checkJobConflictsOnLoad: flags a guest whose allergen was logged today against a named dish', () => {
  const ctx = makeContext({});
  ctx._haccpActiveJob = { id: 'job-1', guests: [{ name: 'Jane', allergens: ['Peanuts'] }] };
  ctx.records = [{ type: 'allergen', dish: 'Satay Skewers', allergens: ['Peanuts'] }];
  ctx._checkJobConflictsOnLoad();
  assert.equal(ctx._calls.conflictLines.length, 1);
  assert.match(ctx._calls.conflictLines[0], /Jane/);
  assert.match(ctx._calls.conflictLines[0], /Satay Skewers/);
});

test('_checkJobConflictsOnLoad: guest with no matching allergen produces no conflict', () => {
  const ctx = makeContext({});
  ctx._haccpActiveJob = { id: 'job-1', guests: [{ name: 'Jane', allergens: ['Celery'] }] };
  ctx.records = [{ type: 'allergen', dish: 'Satay Skewers', allergens: ['Peanuts'] }];
  ctx._checkJobConflictsOnLoad();
  assert.deepEqual(toPlain(ctx._calls.conflictLines), []);
});

test('_checkImmediateConflict: fires a toast and returns true when a present allergen matches a guest', () => {
  const ctx = makeContext({});
  ctx._haccpActiveJob = { id: 'job-1', guests: [{ name: 'Jane', allergens: ['Peanuts'] }] };
  const fired = ctx._checkImmediateConflict('Satay Skewers', ['Peanuts']);
  assert.equal(fired, true);
  assert.equal(ctx._calls.toasts.length, 1);
});

test('_checkImmediateConflict: no allergens present -> no-op, does not throw', () => {
  const ctx = makeContext({});
  ctx._haccpActiveJob = { id: 'job-1', guests: [{ name: 'Jane', allergens: ['Peanuts'] }] };
  const fired = ctx._checkImmediateConflict('Plain Rice', []);
  assert.equal(fired, undefined);
  assert.equal(ctx._calls.toasts.length, 0);
});

test('_pushRecord: stamps jobId onto the record when a job is active', () => {
  const ctx = makeContext({});
  ctx._haccpActiveJob = { id: 'job-1' };
  const rec = { type: 'fridge', temp: 4 };
  ctx._pushRecord(rec);
  assert.equal(ctx.records[0].jobId, 'job-1');
});

test('_pushRecord: leaves the record without a jobId when no job is active', () => {
  const ctx = makeContext({});
  ctx._haccpActiveJob = null;
  const rec = { type: 'fridge', temp: 4 };
  ctx._pushRecord(rec);
  assert.equal('jobId' in ctx.records[0], false);
});
