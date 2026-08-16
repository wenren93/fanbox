'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

test('notarize.js 存在且可加载', () => {
  const notarizePath = path.join(__dirname, '..', 'build', 'notarize.js');
  assert.ok(fs.existsSync(notarizePath), 'build/notarize.js 应存在');
  const mod = require(notarizePath);
  assert.equal(typeof mod.default, 'function', '应导出 default 函数');
});

test('package.json 包含 afterSign 配置', () => {
  const pkg = require(path.join(__dirname, '..', 'package.json'));
  assert.equal(
    pkg.build.mac.afterSign,
    'build/notarize.js',
    'mac.afterSign 应指向 build/notarize.js'
  );
});

test('package.json 包含 notarize 配置', () => {
  const pkg = require(path.join(__dirname, '..', 'package.json'));
  assert.equal(pkg.build.mac.notarize, true, 'mac.notarize 应为 true');
});

test('package.json 包含 dist:local 脚本用于跳过公证', () => {
  const pkg = require(path.join(__dirname, '..', 'package.json'));
  assert.ok(
    pkg.scripts['dist:local'].includes('SKIP_NOTARIZE=true'),
    'dist:local 脚本应包含 SKIP_NOTARIZE=true'
  );
});

test('entitlements.mac.plist 包含必要的 hardened runtime 权限', () => {
  const entitlementsPath = path.join(__dirname, '..', 'build', 'entitlements.mac.plist');
  const content = fs.readFileSync(entitlementsPath, 'utf-8');
  assert.ok(content.includes('com.apple.security.cs.allow-jit'), '应包含 allow-jit');
  assert.ok(
    content.includes('com.apple.security.cs.allow-unsigned-executable-memory'),
    '应包含 allow-unsigned-executable-memory'
  );
  assert.ok(
    content.includes('com.apple.security.cs.disable-library-validation'),
    '应包含 disable-library-validation（node-pty 需要）'
  );
});
