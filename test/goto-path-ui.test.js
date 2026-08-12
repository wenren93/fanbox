'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('Shift+Cmd+G opens path jump and routes folders and files correctly', () => {
  const js = fs.readFileSync('public/app.js', 'utf8');

  assert.match(js, /const gotoPath\s*=\s*\{/);
  assert.match(js, /e\.shiftKey\s*&&\s*\(e\.key\s*===\s*['"]g['"]\s*\|\|\s*e\.key\s*===\s*['"]G['"]\)/);
  assert.match(js, /\/api\/path-info\?path=/);
  assert.match(js, /if\s*\(info\.isDir\)\s*\{[\s\S]{0,160}navigate\(info\.path\)/);
  assert.match(js, /navigate\(info\.parent\)[\s\S]{0,300}openPreview\(entry\)/);
  assert.match(js, /goto-error/);
});
