'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('终端快捷键分别支持 Command+T 切换和 Command+N 新建', () => {
  const html = fs.readFileSync('public/index.html', 'utf8');
  const js = fs.readFileSync('public/app.js', 'utf8');

  assert.match(html, /id="btn-terminal"[^>]*⌘T/);
  assert.match(html, /id="term-newtab"[^>]*⌘N/);
  assert.match(js, /ev\.metaKey/);
  assert.match(js, /key !== 't' && key !== 'n'/);
  assert.match(js, /term\.toggle\(\)/);
  assert.match(js, /const hadSessions = term\.sessions\.length > 0/);
  assert.match(js, /term\.open\(\)/);
  assert.match(js, /if \(hadSessions\) term\.newTab\(\)/);
});
