'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('sidebar exposes browser-style back and forward navigation controls', () => {
  const html = fs.readFileSync('public/index.html', 'utf8');
  const js = fs.readFileSync('public/app.js', 'utf8');

  assert.match(html, /id="nav-back"/);
  assert.match(html, /id="nav-forward"/);
  assert.match(js, /forwardHistory/);
  assert.match(js, /function goForward\(/);
  assert.match(js, /function syncNavHistoryButtons\(/);
  assert.match(js, /#nav-back/);
  assert.match(js, /#nav-forward/);
});
