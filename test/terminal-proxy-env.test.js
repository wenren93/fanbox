'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseSystemProxy } = require('../electron/wechat/env');

test('macOS system proxy is converted into CLI proxy environment variables', () => {
  const env = parseSystemProxy(`
<dictionary> {
  HTTPEnable : 1
  HTTPPort : 7897
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7897
  HTTPSProxy : 127.0.0.1
}
`);

  assert.deepEqual(env, {
    http_proxy: 'http://127.0.0.1:7897',
    https_proxy: 'http://127.0.0.1:7897',
    HTTP_PROXY: 'http://127.0.0.1:7897',
    HTTPS_PROXY: 'http://127.0.0.1:7897',
    all_proxy: 'http://127.0.0.1:7897',
    ALL_PROXY: 'http://127.0.0.1:7897',
    no_proxy: 'localhost,127.0.0.1,::1',
    NO_PROXY: 'localhost,127.0.0.1,::1',
  });
});

test('embedded terminals use the restored user environment', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  assert.match(main, /const \{ fullEnv \} = require\('\.\/wechat\/env'\)/);
  assert.match(main, /ipcMain\.handle\('pty:spawn',[\s\S]*?await fullEnv\(\)[\s\S]*?pty\.spawn/);
});
