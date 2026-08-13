'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('preview toolbar can shrink within a narrow main grid column', () => {
  const css = fs.readFileSync('public/style.css', 'utf8');

  assert.match(css, /#main\s*\{[^}]*min-width:\s*0/s);
  assert.match(css, /\.preview-head\s*\{[^}]*min-width:\s*0/s);
  assert.match(css, /\.preview-actions\s*\{[^}]*flex:\s*0\s+1\s+auto[^}]*min-width:\s*0/s);
  assert.match(css, /@container\s*\(max-width:\s*420px\)\s*\{\s*\.preview-actions\s*\{[^}]*overflow-x:\s*auto/s);
});
