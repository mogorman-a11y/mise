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

function syncHarness(state, localStorage = {}) {
  const status = {};
  Object.defineProperties(localStorage, {
    getItem: { value(key) { return this[key] ?? null; }, configurable: true },
    setItem: { value(key, value) { this[key] = String(value); }, configurable: true },
    removeItem: { value(key) { delete this[key]; }, configurable: true }
  });
  const client = {
    auth: { async getSession() { return { data: { session: { user: { id: state.user } } } }; } },
    from(table) {
      const filters = {};
      return {
        select() { return this; },
        eq(key, value) { filters[key] = value; return this; },
        async maybeSingle() {
          return { data: state.rows.has(filters.date) ? { records: state.rows.get(filters.date) } : null };
        },
        async single() { return { data: null }; },
        async order() {
          return { data: table === 'haccp_records'
            ? Array.from(state.rows, ([date, records]) => ({ date, records })) : [] };
        }
      };
    },
    async rpc(name, args) {
      assert.equal(name, 'haccp_compare_and_save_day');
      assert.equal(args.p_user_id, state.user);
      if (state.offline) return { error: new Error('Offline') };
      if (state.beforeWrite) await state.beforeWrite(args);
      const current = state.rows.get(args.p_date);
      if (JSON.stringify(current ?? null) !== JSON.stringify(args.p_expected)) return { data: false };
      state.rows.set(args.p_date, JSON.parse(JSON.stringify(args.p_records)));
      if (state.lostAck) return { error: new Error('Response lost') };
      return { data: true };
    }
  };
  const context = {
    localStorage, supabaseClient: client,
    window: { addEventListener() {} },
    document: {
      getElementById(id) { return id === 'haccp-sync-status' ? status : null; },
      addEventListener() {}, dispatchEvent() {}
    },
    CustomEvent: class {},
    console: { log() {}, warn() {}, error(err) { assert.fail(err); } }
  };
  vm.runInNewContext(syncSource, context);
  return { sync: context.window.Mise.sync, localStorage, status };
}

test('offline checks survive a later-day reload and sync once after reconnect', async () => {
  const day = '2026-11-25';
  const check = { syncId: 'phone-a', type: 'opening' };
  const state = { user: 'swanspool', rows: new Map(), offline: true };
  const phone = syncHarness(state);
  phone.sync.setHaccpUser(state.user);
  assert.equal(phone.sync.saveHaccpChanges(day, [], [check]), true);
  await phone.sync.loadAll(state.user);
  assert.equal(phone.sync.hasPendingHaccp(), true);
  assert.match(phone.status.textContent, /waiting to sync/);
  assert.deepEqual(JSON.parse(phone.localStorage['haccp_' + day]), [check]);
  assert.equal(state.rows.has(day), false);

  const restarted = syncHarness(state, phone.localStorage);
  state.offline = false;
  await restarted.sync.loadAll(state.user);
  assert.equal(restarted.sync.hasPendingHaccp(), false);
  assert.deepEqual(state.rows.get(day), [check]);
  assert.match(restarted.status.textContent, /records synced/);

  const laptop = syncHarness(state);
  await laptop.sync.loadAll(state.user);
  assert.deepEqual(JSON.parse(laptop.localStorage['haccp_' + day]), [check]);
});

test('a concurrent update and a lost acknowledgement preserve both checks without duplicates', async () => {
  const day = '2026-11-25';
  const phoneCheck = { syncId: 'phone-a', type: 'fridge' };
  const laptopCheck = { syncId: 'laptop-a', type: 'opening' };
  const state = { user: 'swanspool', rows: new Map(), lostAck: true };
  state.beforeWrite = () => {
    state.rows.set(day, [laptopCheck]);
    state.beforeWrite = null;
  };
  const phone = syncHarness(state);
  phone.sync.setHaccpUser(state.user);
  phone.sync.saveHaccpChanges(day, [], [phoneCheck]);
  await phone.sync.loadAll(state.user);
  assert.deepEqual(state.rows.get(day), [laptopCheck, phoneCheck]);
  assert.equal(phone.sync.hasPendingHaccp(), false);
});

test('a removed check does not delete another device’s additions, and the outbox stays account-scoped', async () => {
  const day = '2026-11-25';
  const old = { type: 'allergen', dish: 'Soup' };
  const otherCheck = { syncId: 'laptop-a', type: 'opening' };
  const state = { user: 'swanspool', rows: new Map([[day, [otherCheck, { dish: 'Soup', type: 'allergen' }]]]), offline: true };
  const phone = syncHarness(state);
  phone.sync.setHaccpUser('swanspool');
  phone.sync.saveHaccpChanges(day, [old], []);
  await phone.sync.loadAll('swanspool');
  assert.equal(phone.sync.hasPendingHaccp(), true);
  state.user = 'another-user';
  state.offline = false;
  await phone.sync.loadAll('another-user');
  assert.equal(state.rows.get(day).length, 2);
  state.user = 'swanspool';
  await phone.sync.loadAll('swanspool');
  assert.deepEqual(state.rows.get(day), [otherCheck]);
});
