const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const appHtml = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');
const haccpSource = fs.readFileSync(path.join(ROOT, 'js/modules/haccp.js'), 'utf8');

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

test('delivery form has one temperature input per applicable storage type', () => {
  assert.doesNotMatch(appHtml, /id="del-temp"/);
  assert.match(appHtml, /id="del-chilled-temp"/);
  assert.match(appHtml, /id="del-frozen-temp"/);
});

test('overall condition has a distinct packaging purpose', () => {
  assert.match(appHtml, />Packaging and overall condition</);
  assert.match(appHtml, /id="del-chilled-cond"><option>Not included<\/option>/);
  assert.match(appHtml, /id="del-frozen-cond"><option>Not included<\/option>/);
});

test('new delivery records no longer save the legacy generic temperature', () => {
  const logDelivery = sourceFunction(haccpSource, 'logDelivery');
  assert.doesNotMatch(logDelivery, /del-temp/);
  assert.doesNotMatch(logDelivery, /\btemp\s*:/);
  assert.match(logDelivery, /chilledTemp:chilledTemp/);
  assert.match(logDelivery, /frozenTemp:frozenTemp/);
});

test('legacy delivery temperatures remain readable in existing records and exports', () => {
  assert.match(haccpSource, /r\.type==='delivery'.*r\.temp/s);
});
