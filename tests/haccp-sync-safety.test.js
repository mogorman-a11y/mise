const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const haccpSource = fs.readFileSync(path.join(ROOT, 'js/modules/haccp.js'), 'utf8');
const syncSource = fs.readFileSync(path.join(ROOT, 'sync.js'), 'utf8');

function sourceFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'missing function ' + name);
  let depth = 0;
  let bodyStarted = false;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') { depth++; bodyStarted = true; }
    if (source[i] === '}') depth--;
    if (bodyStarted && depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unterminated function ' + name);
}

function storage(seed) {
  const data = new Map(Object.entries(seed));
  return {
    get length() { return data.size; },
    key(i) { return Array.from(data.keys())[i] ?? null; },
    getItem(k) { return data.has(k) ? data.get(k) : null; },
    setItem(k, v) { data.set(k, String(v)); },
    removeItem(k) { data.delete(k); },
  };
}

test('HACCP day discovery ignores shift and settings keys', () => {
  const localStorage = storage({
    'haccp_2026-10-29': '[]',
    'haccp_shift_open_2026-10-29': '1',
    'haccp_settings': '{}',
  });
  const context = { localStorage };
  vm.createContext(context);
  vm.runInContext(sourceFunction(haccpSource, '_haccpIsDayKey') + '\n' + sourceFunction(haccpSource, 'getAllDays'), context);
  assert.deepEqual(Array.from(context.getAllDays()), ['2026-10-29']);
});

test('HACCP record reader rejects non-array values without crashing', () => {
  const context = { localStorage: storage({
    'haccp_shift_open_2026-10-29': '1',
    'haccp_2026-10-29': '{}',
  }) };
  vm.createContext(context);
  vm.runInContext(sourceFunction(haccpSource, '_haccpGetDayRecords'), context);
  assert.deepEqual(Array.from(context._haccpGetDayRecords('shift_open_2026-10-29')), []);
  assert.deepEqual(Array.from(context._haccpGetDayRecords('2026-10-29')), []);
});

test('cloud pull cleanup only targets date-shaped HACCP keys', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(sourceFunction(syncSource, '_isHaccpDayStorageKey'), context);
  assert.equal(context._isHaccpDayStorageKey('haccp_2026-10-29'), true);
  assert.equal(context._isHaccpDayStorageKey('haccp_shift_open_2026-10-29'), false);
  assert.equal(context._isHaccpDayStorageKey('haccp_settings'), false);
});

test('day saves recover an auth-initialisation race and use an immutable snapshot', () => {
  assert.match(syncSource, /await supabaseClient\.auth\.getSession\(\)/);
  assert.match(syncSource, /recordsSnapshot = Array\.isArray\(recordsArray\) \? recordsArray\.slice\(\) : \[\]/);
  assert.match(syncSource, /_safeRefreshAppViews\('day save'\)/);
});
