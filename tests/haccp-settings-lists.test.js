const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const haccpSource = fs.readFileSync(path.join(ROOT, 'js/modules/haccp.js'), 'utf8');
const syncSource = fs.readFileSync(path.join(ROOT, 'sync.js'), 'utf8');
const appHtml = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');

function sourceFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'expected function ' + name + ' to exist');
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('Unterminated function ' + name);
}

function makeContext(initialSettings, inputValue) {
  const input = { value: inputValue };
  const context = {
    settings: initialSettings,
    DEFAULTS: { staff: ['Chef', 'Sous chef', 'Kitchen assistant'] },
    document: { getElementById: id => id === 'add-staff' ? input : null },
    saveHaccpSettings() {},
    renderSettingsList() {},
    populateHaccpSelects() {},
    _haccpToast() {}
  };
  vm.createContext(context);
  vm.runInContext(sourceFunction(haccpSource, '_haccpSettingsList'), context);
  vm.runInContext(sourceFunction(haccpSource, 'addItem'), context);
  return { context, input };
}

test('adding a staff name repairs a missing legacy staff list', () => {
  const { context, input } = makeContext({ thresholds: {} }, 'Alice');
  context.addItem('staff', 'add-staff', 'settings-staff-list');
  assert.deepEqual(Array.from(context.settings.staff), ['Chef', 'Sous chef', 'Kitchen assistant', 'Alice']);
  assert.equal(input.value, '');
});

test('adding a staff name preserves an existing cloud staff list', () => {
  const { context } = makeContext({ staff: ['Michael'] }, 'Alice');
  context.addItem('staff', 'add-staff', 'settings-staff-list');
  assert.deepEqual(Array.from(context.settings.staff), ['Michael', 'Alice']);
});

test('cloud HACCP settings are rehydrated after a partial row is applied', () => {
  const pullStart = syncSource.indexOf('async function _pullHaccpSettings');
  const pullEnd = syncSource.indexOf('async function _pullMiseSettings', pullStart);
  const pullSource = syncSource.slice(pullStart, pullEnd);
  const storeAt = pullSource.indexOf("localStorage.setItem('haccp_settings'");
  const hydrateAt = pullSource.indexOf("loadHaccpSettings()");
  assert.ok(storeAt >= 0, 'cloud settings should be stored locally');
  assert.ok(hydrateAt > storeAt, 'normal defaults should be restored after the cloud row is stored');
});

test('main Settings links to the single HACCP staff editor', () => {
  assert.doesNotMatch(appHtml, /id="vq-haccp-staff-list"/);
  assert.match(appHtml, /Manage HACCP staff names/);
  assert.match(appHtml, /haccpTab\('settings'\)/);
});
