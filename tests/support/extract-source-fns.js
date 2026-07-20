// tests/support/extract-source-fns.js
//
// Pulls one or more top-level function declarations verbatim out of a real
// app source file (haccp.js, menus.js, ...) so tests can run the actual
// shipped logic in a vm context instead of reimplementing it — those files
// are plain scripts (no module.exports, designed to run as <script> tags),
// so this is the only way to exercise them under `node --test` without a
// full browser/DOM harness. Relies on this codebase's consistent style:
// top-level function declarations start at column 0, and their closing
// brace also sits alone on a line at column 0 (never indented) — verified
// against the specific functions this repo's tests extract; if a future
// edit reformats a targeted function, extraction throws immediately rather
// than silently grabbing the wrong span.
const fs = require('node:fs');

function extractOne(src, name, filePath) {
  // Single-line body: `function foo() { ...; }` entirely on one line.
  const oneLine = new RegExp('^function ' + name + '\\([^\\n]*\\{[^\\n]*\\}\\n', 'm');
  const oneLineMatch = src.match(oneLine);
  if (oneLineMatch) return oneLineMatch[0];

  // Multi-line body: closing brace alone on its own line at column 0.
  const multiLine = new RegExp('^function ' + name + '\\([^\\n]*\\{[\\s\\S]*?\\n\\}\\n', 'm');
  const multiLineMatch = src.match(multiLine);
  if (multiLineMatch) return multiLineMatch[0];

  throw new Error(
    'extractFunctions: could not find top-level function "' + name + '" in ' + filePath +
    ' — it may have been renamed, removed, or reformatted (closing brace no longer alone at column 0).'
  );
}

function extractFunctions(filePath, names) {
  const src = fs.readFileSync(filePath, 'utf8');
  return names.map((name) => extractOne(src, name, filePath)).join('\n');
}

module.exports = { extractFunctions };
