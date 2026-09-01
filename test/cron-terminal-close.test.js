'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('定时任务结束后关闭对应终端标签，普通终端退出仍保留', () => {
  const main = fs.readFileSync('electron/main.js', 'utf8');
  const app = fs.readFileSync('public/app.js', 'utf8');

  assert.match(main, /if \(opts\.closeWhenDone\) autoCloseTerminals\.add\(r\.id\);\s*const s = agentSend/);
  assert.match(main, /const autoClose = autoCloseTerminals\.delete\(id\);/);
  assert.match(main, /webContents\.send\('pty:exit', \{ id, exitCode, autoClose \}\)/);
  assert.match(app, /onExit\(\(\{ id, autoClose \}\) =>/);
  assert.match(app, /if \(autoClose\) \{ term\.closeTab\(id\); return; \}/);
  assert.match(app, /s\.dead = true; s\.status = 'dead'/);
});
