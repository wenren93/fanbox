'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('quick launch offers Codex desktop app separately from Codex CLI', () => {
  const js = fs.readFileSync('public/app.js', 'utf8');
  const i18n = fs.readFileSync('public/i18n-dict.js', 'utf8');

  assert.match(js, /id: 'codex'.*cmd: 'codex'.*bin: 'codex'/);
  assert.match(js, /id: 'codex-app'.*label: 'Codex 桌面应用'.*cmd: 'open -a Codex'.*app: 'Codex'.*icon: 'codex'/);
  assert.match(js, /agentIconHtml\(a\.icon \|\| a\.id\)/);
  assert.deepEqual([...js.matchAll(/id: 'codex-app'/g)].length, 1);
  assert.ok(js.indexOf("id: 'codex-app'") > js.indexOf("id: 'qoder'"), 'Codex desktop app should be the final built-in launcher');
  assert.match(i18n, /'Codex 桌面应用': 'Codex desktop app'/);
});
