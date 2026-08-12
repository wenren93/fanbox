'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source() {
  return fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
}

function styles() {
  return fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
}

test('Persistent local-runtime copy does not claim Discover never sends data outbound', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const i18n = fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n-dict.js'), 'utf8');
  assert.doesNotMatch(html, /本地运行 · 数据不出本机/);
  assert.match(html, /本地运行 · 出网由你触发/);
  assert.match(i18n, /'本地运行 · 出网由你触发': 'Runs locally · outbound access is user-triggered'/);
});

test('Skills perspective keeps Installed and Discover as separate top-level tabs', () => {
  const js = source();
  assert.match(js, /已安装/);
  assert.match(js, /发现/);
  assert.match(js, /activeTab|activeTab\s*:/);
  assert.match(js, /discovery/);
});

test('Discovery search is explicit and guards Chinese composition', () => {
  const js = source();
  assert.match(js, /compositionstart/);
  assert.match(js, /compositionend/);
  assert.match(js, /key\s*===\s*['"]Enter['"]/);
  assert.match(js, /\/api\/skills\/discovery\/search/);
  assert.match(js, /搜索词[\s\S]{0,180}skills\.sh/);
});

test('Discovery results expose unchecked state, source link and inspection action', () => {
  const js = source();
  assert.match(js, /尚未检查/);
  assert.match(js, /打开来源/);
  assert.match(js, /检查并安装/);
  assert.match(js, /\/api\/skills\/discovery\/inspect/);
  assert.match(js, /installationPrerequisite/);
});

test('Discovery inspection progress belongs only to the selected result', () => {
  const js = source();
  assert.match(js, /inspectingEntryId/);
  assert.match(js, /entry\.id\s*===\s*d\.inspectingEntryId/);
  assert.match(js, /正在固定来源并检查内容/);
  assert.doesNotMatch(js, /\$\{d\.inspecting\s*\?\s*'检查中…'/);
});

test('Discovery install actions use the themed primary button style', () => {
  const css = styles();
  assert.match(css, /\.sk-disc-actions\s+button\.primary[^{]*\{[^}]*border-radius:\s*7px[^}]*padding:\s*5px 11px[^}]*background:\s*var\(--accent\)/s);
  assert.match(css, /\.sk-disc-confirm-actions\s+button\.primary[^{]*\{[^}]*border-radius:\s*7px[^}]*padding:\s*5px 11px[^}]*background:\s*var\(--accent\)/s);
});

test('Discovery actions use accessible icon buttons instead of visible text labels', () => {
  const js = source();
  assert.match(js, /class="ghost-btn sk-disc-icon-btn"[^>]*aria-label="打开来源"[^>]*title="打开来源"[^>]*>\$\{ic\('link'/);
  assert.match(js, /class="primary sk-disc-icon-btn"[^>]*aria-label="\$\{escapeHtml\(inspectLabel\)\}"/);
  assert.match(js, /data-disc-act="install"[^>]*aria-label="\$\{escapeHtml\(installLabel\)\}"/);
  assert.match(js, /sk-disc-spinner/);
});

test('Installation confirmation supports four controlled targets and enhanced acknowledgement', () => {
  const js = source();
  for (const target of ['claude', 'codex', 'agents', 'workbuddy']) assert.match(js, new RegExp(target));
  assert.match(js, /acknowledge/);
  assert.match(js, /\/api\/skills\/discovery\/install/);
  assert.match(js, /完整文件|文件清单/);
  assert.match(js, /binaryResources\)\s*\?\s*i\.binaryResources\s*:\s*\(Array\.isArray\(i\.binaries\)/);
});

test('Discovery presents cached and failed states without treating them as empty results', () => {
  const js = source();
  assert.match(js, /cached|缓存/);
  assert.match(js, /外部搜索失败|搜索失败/);
  assert.match(js, /没有找到/);
  assert.match(js, /cachedQuery/);
});
