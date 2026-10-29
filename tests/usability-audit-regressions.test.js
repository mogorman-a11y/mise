const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const haccp = fs.readFileSync(path.join(root, 'js/modules/haccp.js'), 'utf8');
const menus = fs.readFileSync(path.join(root, 'js/modules/menus.js'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'js/modules/dashboard.js'), 'utf8');

test('probe result is calculated and a failed reading requires corrective action', () => {
  assert.doesNotMatch(html, /id="probe-result"/);
  assert.match(html, /id="probe-action"/);
  assert.match(haccp, /Math\.abs\(reading\)<=1/);
  assert.match(haccp, /Select the corrective action taken/);
});

test('cooling uses a non-destructive start and complete workflow', () => {
  assert.match(html, /onclick="startCoolingRecord\(\)"/);
  assert.match(html, /onclick="completeCoolingRecord\(\)"/);
  assert.match(haccp, /haccp_cooling_pending/);
  assert.match(haccp, /_pushRecord\(\{type:'cooling'/);
});

test('one active logger controls HACCP actor fields without changing staff subjects', () => {
  assert.match(html, /id="haccp-active-logger"/);
  assert.match(haccp, /veriqo_active_haccp_logger_v2/);
  assert.doesNotMatch(haccp.match(/var _HACCP_ACTOR_SELECTS=\[[^;]+/)[0], /illness-staff/);
});

test('install dismissal is shared across HACCP and Menus', () => {
  assert.doesNotMatch(menus, /carte_install_dismissed/);
  assert.match(menus, /veriqo_install_dismissed/);
});

test('dashboard describes automatic sync without asking the user to open Costing', () => {
  assert.doesNotMatch(dashboard, /Open Costing to sync/);
  assert.match(dashboard, /sync automatically/);
});

test('costing links an existing booking and keeps assumptions collapsible', () => {
  assert.match(html, /id="costing-job-select"/);
  assert.match(html, /<summary[^>]*>Cost assumptions<\/summary>/);
});
