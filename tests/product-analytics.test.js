const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { extractFunctions } = require('./support/extract-source-fns');
const file = path.join(__dirname, '../js/modules/haccp.js');
function harness() {
  const events = [];
  const context = { records: [], _demoMode: false, _haccpActiveJob: null,
    _haccpEditingCustomer: false, _editingAllergenIdx: null, _haccpSavedDay: '', _haccpSavedRecords: [],
    window: { vqTrack: (event, props) => events.push({event, props}) },
    localStorage: { setItem() {} }, todayStr: () => '2026-11-08', console,
    confirm: () => true, renderSection_PC() {}, renderAllergenGuests() {}, updateHaccpDashboard() {} };
  vm.createContext(context);
  vm.runInContext(extractFunctions(file, ['_haccpTrackMutation', '_pushRecord', 'saveHaccpToday', 'deleteHaccpAllergen']), context);
  return { context, events };
}
test('one addition stays one event across repeated saves; payload excludes record contents', () => {
  const { context: c, events } = harness();
  c._pushRecord({ type: 'fridge', status: 'ok', by: 'Private name', notes: 'Private notes' });
  c.saveHaccpToday(); c.saveHaccpToday();
  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'record_added');
  assert.equal(events[0].props.tracking_version, 2);
  assert.equal(JSON.stringify(events).includes('Private'), false);
});
test('editing a customer and deleting the final allergen do not count as additions', () => {
  const { context: c, events } = harness();
  c._haccpEditingCustomer = true;
  c._pushRecord({type: 'job', status: 'ok'});
  assert.equal(events[0].event, 'record_edited');
  assert.equal(c._haccpEditingCustomer, false);
  c.records = [{type: 'allergen', status: 'warn'}];
  c.deleteHaccpAllergen(0);
  assert.equal(c.records.length, 0);
  assert.deepEqual(events.map(e => e.event), ['record_edited', 'record_deleted']);
});
test('cancelled and invalid deletions emit nothing', () => {
  const { context: c, events } = harness();
  c.records = [{type: 'allergen'}]; c.confirm = () => false;
  c.deleteHaccpAllergen(0); c.deleteHaccpAllergen(9);
  assert.equal(c.records.length, 1); assert.equal(events.length, 0);
});
test('demo mutations emit nothing and tracking failures never block recording', () => {
  const { context: c, events } = harness();
  c._demoMode = true; c._pushRecord({type: 'fridge'}); c.saveHaccpToday();
  assert.equal(events.length, 0);
  c._demoMode = false; c.window.vqTrack = () => { throw new Error('blocked'); };
  assert.doesNotThrow(() => c._pushRecord({type: 'cooking'}));
  assert.equal(c.records.length, 2);
  delete c.window.vqTrack;
  assert.doesNotThrow(() => c._pushRecord({type: 'cooking'}));
});
