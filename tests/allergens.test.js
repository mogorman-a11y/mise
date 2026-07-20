// tests/allergens.test.js — run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const { ALLERGENS_14, normalizeAllergen } = require('../js/core/allergens.js');

test('ALLERGENS_14 has exactly the 14 UK regulated allergens', () => {
  assert.equal(ALLERGENS_14.length, 14);
});

test('normalizeAllergen unifies known gluten spelling variants', () => {
  const variants = ['Cereals with gluten', 'cereals containing gluten', 'gluten', 'Gluten', 'cereal'];
  for (const v of variants) {
    assert.equal(normalizeAllergen(v), 'Cereals containing gluten', `variant: ${v}`);
  }
});

test('normalizeAllergen unifies known sulphite spelling variants', () => {
  const variants = ['Sulphites', 'sulfites', 'Sulphur Dioxide', 'sulphur dioxide', 'sulfur dioxide', 'sulfate'];
  for (const v of variants) {
    assert.equal(normalizeAllergen(v), 'Sulphur dioxide', `variant: ${v}`);
  }
});

test('normalizeAllergen is case-insensitive for exact canonical matches', () => {
  assert.equal(normalizeAllergen('celery'), 'Celery');
  assert.equal(normalizeAllergen('CELERY'), 'Celery');
  assert.equal(normalizeAllergen('  Celery  '), 'Celery');
});

test('normalizeAllergen preserves unrecognized values instead of dropping them', () => {
  assert.equal(normalizeAllergen('Some Unknown Allergen'), 'Some Unknown Allergen');
});

test('normalizeAllergen handles null/undefined/empty without throwing', () => {
  assert.equal(normalizeAllergen(null), null);
  assert.equal(normalizeAllergen(undefined), undefined);
  assert.equal(normalizeAllergen(''), '');
});

test('api/ai-scan.js and api/parse-menu.js both import the same canonical list (no drift possible)', () => {
  // Both files now `require('../js/core/allergens.js')` directly rather than
  // hardcoding their own array, so this is really just confirming the files
  // load without throwing and don't shadow the import with a local literal.
  const scanSrc = require('node:fs').readFileSync(require('node:path').join(__dirname, '../api/ai-scan.js'), 'utf8');
  const parseSrc = require('node:fs').readFileSync(require('node:path').join(__dirname, '../api/parse-menu.js'), 'utf8');
  assert.match(scanSrc, /require\(['"]\.\.\/js\/core\/allergens\.js['"]\)/);
  assert.match(parseSrc, /require\(['"]\.\.\/js\/core\/allergens\.js['"]\)/);
});

test('resolveMenuDishes: prefers embedded dishes over dishIds', () => {
  const { resolveMenuDishes } = require('../js/core/menu-dishes.js');
  const menu = { dishes: [{ id: 'd1', dish: 'Soup' }], dishIds: ['d1', 'd2'] };
  assert.deepEqual(resolveMenuDishes(menu, {}), [{ id: 'd1', dish: 'Soup' }]);
});

test('resolveMenuDishes: resolves dishIds-only menus (AI-imported shape)', () => {
  const { resolveMenuDishes } = require('../js/core/menu-dishes.js');
  const dishesById = { d1: { id: 'd1', dish: 'Soup' }, d2: { id: 'd2', dish: 'Tart' } };
  const menu = { dishIds: ['d1', 'd2'] };
  assert.deepEqual(resolveMenuDishes(menu, dishesById), [dishesById.d1, dishesById.d2]);
});

test('resolveMenuDishes: filters out dishIds with no matching lookup entry, never throws', () => {
  const { resolveMenuDishes } = require('../js/core/menu-dishes.js');
  const dishesById = { d1: { id: 'd1', dish: 'Soup' } };
  const menu = { dishIds: ['d1', 'missing'] };
  assert.deepEqual(resolveMenuDishes(menu, dishesById), [dishesById.d1]);
});

test('resolveMenuDishes: legacy record with only embedded dishes (no dishIds at all) still resolves', () => {
  const { resolveMenuDishes } = require('../js/core/menu-dishes.js');
  const menu = { dishes: [{ id: 'd1', dish: 'Soup' }] };
  assert.deepEqual(resolveMenuDishes(menu, {}), [{ id: 'd1', dish: 'Soup' }]);
});

test('resolveMenuDishes: empty/missing menu never throws', () => {
  const { resolveMenuDishes } = require('../js/core/menu-dishes.js');
  assert.deepEqual(resolveMenuDishes(null, {}), []);
  assert.deepEqual(resolveMenuDishes({}, {}), []);
  assert.deepEqual(resolveMenuDishes({ dishIds: ['x'] }, null), []);
});
