// tests/onclick-handlers.test.js — run with: node --test tests/
//
// Regression guard against the exact bug class that motivated this pass:
// app.html referenced 16+ AI-costing/intake/template functions via
// onclick=/onchange= that were never implemented anywhere. This statically
// extracts every inline event-handler call in app.html and checks it
// resolves against the functions actually defined in app.html's own inline
// <script> blocks plus every local js/modules/*.js and js/core/*.js file
// app.html loads via <script src>.
//
// This is a REGRESSION GUARD, not proof of correctness: it's a regex-based
// static scan, not a real JS parser. It can miss handlers built entirely
// from string interpolation inside dynamically-generated HTML (those are
// checked on a best-effort basis only), and it can't verify a resolved
// function is actually *correct* — only that the name exists somewhere in
// the loaded script set.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP_HTML_PATH = path.join(ROOT, 'app.html');

const HANDLER_ATTRS = ['onclick', 'onchange', 'oninput', 'onsubmit', 'onmouseover', 'onmouseout'];

// Identifiers that are legitimate JS/DOM globals or keywords, not "our" functions.
const IGNORE_IDENTIFIERS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof',
  'confirm', 'alert', 'prompt', 'parseInt', 'parseFloat', 'String', 'Number',
  'Boolean', 'Array', 'Object', 'isNaN', 'Date', 'Math', 'JSON', 'RegExp',
  'encodeURIComponent', 'decodeURIComponent', 'setTimeout', 'setInterval'
]);

function extractScriptSrcs(html) {
  const re = /<script\s+src="([^"]+)"/g;
  const srcs = [];
  let m;
  while ((m = re.exec(html))) {
    const src = m[1].split('?')[0];
    // Only local, same-repo files (skip absolute/external URLs).
    if (!/^https?:\/\//.test(src)) srcs.push(src);
  }
  return srcs;
}

function extractInlineScripts(html) {
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  const blocks = [];
  let m;
  while ((m = re.exec(html))) blocks.push(m[1]);
  return blocks;
}

function extractDefinedNames(source) {
  const names = new Set();
  let m;

  const fnDecl = /function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  while ((m = fnDecl.exec(source))) names.add(m[1]);

  const winAssign = /window\.([A-Za-z_$][A-Za-z0-9_$]*)\s*=/g;
  while ((m = winAssign.exec(source))) names.add(m[1]);

  const varFnAssign = /(?:var|let|const)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?(?:function|\()/g;
  while ((m = varFnAssign.exec(source))) names.add(m[1]);

  return names;
}

function extractHandlerCalls(handlerBody) {
  const calls = [];
  // Matches a bare identifier immediately followed by "(" that is NOT
  // preceded by "." (so object.method() calls are excluded).
  const re = /(?<![.\w$])([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  let m;
  while ((m = re.exec(handlerBody))) {
    // Single-character matches are essentially always false positives from
    // prose text inside a string-literal argument (e.g. a tooltip message
    // containing "...0°C (±1°C)..." — "C (" spuriously looks like a call).
    if (m[1].length > 1 && !IGNORE_IDENTIFIERS.has(m[1])) calls.push(m[1]);
  }
  return calls;
}

function extractHandlerAttributeValues(html) {
  const values = [];
  for (const attr of HANDLER_ATTRS) {
    const re = new RegExp(attr + '\\s*=\\s*"([^"]*)"', 'g');
    let m;
    while ((m = re.exec(html))) values.push({ attr, value: m[1] });
  }
  return values;
}

test('every inline event-handler call in app.html resolves to a defined function', () => {
  const html = fs.readFileSync(APP_HTML_PATH, 'utf8');

  const definedNames = new Set();
  for (const block of extractInlineScripts(html)) {
    for (const n of extractDefinedNames(block)) definedNames.add(n);
  }
  for (const src of extractScriptSrcs(html)) {
    const filePath = path.join(ROOT, src);
    if (!fs.existsSync(filePath)) continue; // external/CDN or missing — not this test's concern
    const source = fs.readFileSync(filePath, 'utf8');
    for (const n of extractDefinedNames(source)) definedNames.add(n);
  }

  assert.ok(definedNames.size > 50, 'sanity check: expected to find many defined functions across the loaded scripts, found ' + definedNames.size);

  const missing = [];
  for (const { attr, value } of extractHandlerAttributeValues(html)) {
    for (const fnName of extractHandlerCalls(value)) {
      if (!definedNames.has(fnName)) {
        missing.push(attr + '="' + value + '" — missing: ' + fnName);
      }
    }
  }

  const unique = [...new Set(missing)];
  assert.deepEqual(unique, [], unique.length + ' handler(s) reference undefined function(s):\n' + unique.join('\n'));
});
