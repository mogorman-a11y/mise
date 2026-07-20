// tests/prep-course-sort.test.js — run with: node --test tests/
//
// Phase 0 regression protection: prep-list generation must keep working from
// existing `dish.prep_tasks` / `dish_category` regardless of whether the
// costing rebuild is present. _courseIndex() has a legacy fallback — items
// saved before `dish_category` existed on the item itself resolve course via
// mSettings.savedDishes lookup by dish_id — that fallback must not regress.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { extractFunctions } = require('./support/extract-source-fns.js');

const PREP_JS = path.join(__dirname, '../js/modules/prep.js');
const SOURCE = extractFunctions(PREP_JS, ['_courseIndex', '_sortByCourse']);

function makeContext(mSettings) {
  const context = vm.createContext({
    _COURSE_ORDER: ['Canapé', 'Starter', 'Fish course', 'Main', 'Side', 'Sauce', 'Pre-dessert', 'Dessert', 'Cheese', 'Petit four', 'Bread', 'Other'],
    mSettings: mSettings,
  });
  vm.runInContext(SOURCE, context);
  return context;
}

test('_courseIndex: uses dish_category directly when present on the item', () => {
  const ctx = makeContext(undefined);
  assert.equal(ctx._courseIndex({ dish_category: 'Main' }), 3);
  assert.equal(ctx._courseIndex({ dish_category: 'Dessert' }), 7);
});

test('_courseIndex: legacy item with no dish_category falls back to mSettings.savedDishes by dish_id', () => {
  const ctx = makeContext({ savedDishes: [{ id: 'd1', category: 'Starter' }] });
  assert.equal(ctx._courseIndex({ dish_id: 'd1' }), 1);
});

test('_courseIndex: unknown/missing category sorts last (999), never throws', () => {
  const ctx = makeContext({ savedDishes: [] });
  assert.equal(ctx._courseIndex({ dish_id: 'no-such-dish' }), 999);
  assert.equal(ctx._courseIndex({}), 999);
});

test('_courseIndex: dish_id lookup coerces types (string vs number id)', () => {
  const ctx = makeContext({ savedDishes: [{ id: 42, category: 'Side' }] });
  assert.equal(ctx._courseIndex({ dish_id: '42' }), 4);
});

test('_sortByCourse: orders items by course, then alphabetically by dish within a course', () => {
  const ctx = makeContext(undefined);
  const items = [
    { dish_category: 'Dessert', dish_name: 'Tart' },
    { dish_category: 'Starter', dish_name: 'Soup' },
    { dish_category: 'Starter', dish_name: 'Bruschetta' },
  ];
  const sorted = ctx._sortByCourse(items);
  assert.deepEqual(sorted.map((i) => i.dish_name), ['Bruschetta', 'Soup', 'Tart']);
});
