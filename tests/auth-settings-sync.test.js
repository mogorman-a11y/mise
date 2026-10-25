const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');
const auth = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
const sync = fs.readFileSync(path.join(ROOT, 'sync.js'), 'utf8');

test('main Settings sign-out delegates to the complete shared logout path', () => {
  assert.match(app, /window\.Mise\.auth\.logout\(\)/);
  assert.match(app, /auth\.js\?v=39/);
  assert.match(auth, /'veriqo_profile'/);
  assert.match(auth, /'vq_positioning'/);
  assert.match(auth, /getRegistrations\(\)/);
  assert.match(auth, /caches\.delete/);
});

test('settings saves validate the session and enter the existing retry queue', () => {
  assert.match(sync, /supabaseClient\.auth\.getSession\(\)/);
  assert.match(sync, /_enqueueEntityRetry\('settings', 'save'/);
  assert.match(sync, /settings:\s*\{\s*save:/);
  assert.match(sync, /Session expired — sign in again\. Settings are saved on this device\./);
  assert.match(sync, /await _drainRetryQueue\(\)/);
});

test('a view refresh failure cannot be reported as a failed settings write', () => {
  assert.match(sync, /_safeRefreshAppViews\('settings save'\)/);
  assert.match(sync, /function _safeRefreshAppViews\(context\)/);
  assert.match(sync, /view refresh failed after/);
});
