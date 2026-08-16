'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('终端快捷键支持切换、新建和关闭当前终端', () => {
  const html = fs.readFileSync('public/index.html', 'utf8');
  const js = fs.readFileSync('public/app.js', 'utf8');

  assert.match(html, /id="btn-terminal"[^>]*⌘T/);
  assert.match(html, /id="term-newtab"[^>]*⌘⇧N/);
  assert.match(js, /ev\.metaKey/);
  assert.match(js, /key !== 't' && key !== 'n' && key !== 'w' && key !== 'j'/);
  assert.match(js, /key === 'n' && !ev\.shiftKey/);
  assert.match(js, /term\.toggle\(\)/);
  assert.match(js, /const hadSessions = term\.sessions\.length > 0/);
  assert.match(js, /term\.open\(\)/);
  assert.match(js, /if \(hadSessions\) term\.newTab\(\)/);
  assert.match(js, /key === 'w' && ev\.shiftKey/);
  assert.match(js, /term\.closeTab\(term\.active\)/);
});

test('Skills 透视快捷键 ⌘⇧J', () => {
  const html = fs.readFileSync('public/index.html', 'utf8');
  const js = fs.readFileSync('public/app.js', 'utf8');

  assert.match(html, /id="skills-entry"[^>]*⌘⇧J/);
  assert.match(js, /key === 'j' && !ev\.shiftKey/);
  assert.match(js, /key === 'j' && ev\.shiftKey/);
  assert.match(js, /skillsView\.show\(\)/);
});
