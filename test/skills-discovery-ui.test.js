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
  const css = styles();
  assert.match(js, /compositionstart/);
  assert.match(js, /compositionend/);
  assert.match(js, /key\s*===\s*['"]Enter['"]/);
  assert.match(js, /\/api\/skills\/discovery\/search/);
  assert.match(js, /class="primary sk-disc-search-btn"[^>]*aria-label="搜索"[^>]*title="搜索"/);
  assert.match(js, /:\s*ic\('search',\s*'currentColor',\s*17\)/);
  assert.match(css, /\.sk-disc-search-btn\s*\{[^}]*width:\s*39px[^}]*height:\s*39px/s);
  assert.doesNotMatch(js, /class="sk-disc-privacy"/);
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

test('Installation confirmation supports multi-select Agents and pure stock without risk acknowledgement gate', () => {
  const js = source();
  for (const target of ['claude', 'codex', 'zcode', 'workbuddy']) assert.match(js, new RegExp(target));
  assert.match(js, /defaultTargetAgents:\s*\['claude',\s*'codex',\s*'zcode',\s*'workbuddy'\]/);
  assert.match(js, /type="checkbox" name="discovery-target"/);
  assert.match(js, /agents[,}]/);
  assert.doesNotMatch(js, /type="radio" name="discovery-target"/);
  assert.doesNotMatch(js, /targetAgent:\s*target/);
  assert.match(js, /不选则仅存入原件仓/);
  assert.doesNotMatch(js, /sk-disc-ack|name="acknowledge"|acknowledge,/);
  assert.doesNotMatch(js, /请先展开并确认风险明细/);
  assert.match(js, /\/api\/skills\/discovery\/install/);
  assert.match(js, /完整文件|文件清单/);
  assert.match(js, /binaryResources\)\s*\?\s*i\.binaryResources\s*:\s*\(Array\.isArray\(i\.binaries\)/);
});

test('Discovery success switches to Installed and expands the new original row', () => {
  const js = source();
  assert.match(js, /this\.activeTab\s*=\s*'installed'/);
  assert.match(js, /this\.open\.add\(targetDir\)/);
  assert.match(js, /await this\.reload\(\)/);
});

test('Discovery detail prioritizes the install decision and moves technical data into a drawer', () => {
  const js = source();
  const css = styles();
  assert.match(js, /class="sk-disc-inspection sk-disc-decision"/);
  assert.match(js, /class="sk-disc-decision-summary"/);
  assert.match(js, /data-disc-act="open-details"[^>]*aria-expanded="false"/);
  assert.match(js, /class="sk-disc-tech-drawer"[^>]*aria-hidden="true"/);
  assert.match(js, /data-disc-act="close-details"/);
  assert.match(js, /setDetailsOpen/);
  assert.match(css, /\.sk-disc-tech-drawer\s*\{[^}]*position:absolute[^}]*transform:translateX\(105%\)/s);
  assert.match(css, /\.sk-disc-tech-drawer\.open\s*\{[^}]*transform:none/s);
});

test('Discovery presents cached and failed states without treating them as empty results', () => {
  const js = source();
  assert.match(js, /cached|缓存/);
  assert.match(js, /外部搜索失败|搜索失败/);
  assert.match(js, /没有找到/);
  assert.match(js, /cachedQuery/);
});
