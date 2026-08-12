'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function skillsViewSource() {
  const source = fs.readFileSync('public/app.js', 'utf8');
  const start = source.indexOf('const skillsView = {');
  const end = source.indexOf('// 把 skill 注入当前终端', start);
  assert.notEqual(start, -1, 'skillsView should exist');
  assert.notEqual(end, -1, 'skillsView source boundary should exist');
  return source.slice(start, end);
}

test('Skills batch UI keeps explicit selection, progress, and result state', () => {
  const js = skillsViewSource();

  assert.match(js, /batchMode:\s*false,\s*selected:\s*new Set\(\),\s*busy:\s*false,[^\n]*batchResult:\s*null/);
  assert.match(js, /async runBatch\(action\)/);
  assert.match(js, /apiPost\('\/api\/skills\/batch',\s*\{\s*action,\s*dirs,\s*cwd:\s*state\.cwd\s*\}\)/);
  assert.match(js, /this\.selected\s*=\s*new Set\(failures\.map\(\(x\)\s*=>\s*x\.dir\)\)/);
  assert.match(js, /this\.busy\s*=\s*true[\s\S]{0,3000}finally\s*\{\s*this\.busy\s*=\s*false/);
  assert.match(js, /data-batch-action="enable"/);
  assert.match(js, /data-batch-action="disable"/);
  assert.match(js, /data-batch-action="uninstall"/);
  assert.match(js, /移到系统废纸篓，可恢复/);
});

test('Skills batch controls are connected to visible-row selection and actions', () => {
  const js = skillsViewSource();

  assert.match(js, /const batchToggle\s*=\s*area\.querySelector\(['"]#sk-batch-toggle['"]\)[\s\S]{0,160}batchToggle\.onclick/);
  assert.match(js, /const selectAll\s*=\s*area\.querySelector\(['"]#sk-select-all['"]\)[\s\S]{0,240}selectAll\.onchange/);
  assert.match(js, /selectAll\.indeterminate\s*=\s*selectAll\.dataset\.partial\s*===\s*['"]true['"]/);
  assert.match(js, /querySelectorAll\(['"]\[data-batch-action\]['"]\)/);
  assert.match(js, /this\.rows\(\)/);
  assert.match(js, /this\.runBatch\([^)]*dataset\.batchAction/);
});

test('Skills view exposes WorkBuddy as an independent filter and source tag', () => {
  const js = skillsViewSource();

  assert.match(js, /workbuddy:\s*['"] workbuddy['"]/);
  assert.match(js, /\[['"]workbuddy['"],\s*['"]WorkBuddy['"],\s*cnt\(\(x\)\s*=>\s*x\.source\s*===\s*['"]workbuddy['"]\)\]/);
  const order = ['Claude', 'Codex', 'WorkBuddy', '项目', '插件'].map((label) => js.indexOf(`'${label}'`));
  assert.ok(order.every((position) => position >= 0));
  assert.deepEqual(order, order.slice().sort((a, b) => a - b));
});

test('Skills view groups project skills while distinguishing their agent', () => {
  const js = skillsViewSource();

  assert.match(js, /x\.source\s*===\s*['"]project['"]/);
  assert.match(js, /it\.source\s*===\s*['"]project['"]\s*&&\s*it\.projectAgent/);
  assert.match(js, /project-\$\{it\.projectAgent\}/);
  assert.match(js, /x\.projectAgent,\s*x\.projectName/);
});

test('Skills search filters useful installation fields and clears batch selection', () => {
  const js = skillsViewSource();

  assert.match(js, /sort:\s*['"]hits['"],\s*query:\s*['"]/);
  assert.match(js, /\[x\.name,\s*x\.desc,\s*x\.label,\s*x\.projectAgent,\s*x\.projectName,\s*x\.dir,\s*\.\.\.\(x\.issues\s*\|\|\s*\[\]\)\]/);
  assert.match(js, /id="sk-search"/);
  assert.match(js, /this\.query\s*=\s*value;\s*this\.selected\.clear\(\);\s*this\.batchResult\s*=\s*null/);
  assert.match(js, /search\.oncompositionend/);
  assert.match(js, /search\.oninput/);
});

test('Skills view can refresh scans without leaving the current view state', () => {
  const js = skillsViewSource();

  assert.match(js, /refreshing:\s*false/);
  assert.match(js, /async refreshScan\(\)/);
  assert.match(js, /apiPost\('\/api\/skills\/refresh',\s*\{\s*cwd:\s*state\.cwd\s*\}\)/);
  assert.match(js, /id="sk-refresh"/);
  assert.match(js, /refreshing\s*\?\s*'刷新中…'\s*:\s*'刷新'/);
  assert.match(js, /const refresh\s*=\s*area\.querySelector\(['"]#sk-refresh['"]\)[\s\S]{0,180}refresh\.onclick\s*=\s*\(\)\s*=>\s*this\.refreshScan\(\)/);
  assert.match(js, /this\.selected\s*=\s*new Set\(\[\.\.\.this\.selected\]\.filter\(\(dir\)\s*=>\s*dirs\.has\(dir\)\)\)/);
  assert.match(js, /this\.open\s*=\s*new Set\(\[\.\.\.this\.open\]\.filter\(\(dir\)\s*=>\s*dirs\.has\(dir\)\)\)/);
});

test('Skills view explains official toggle behavior and Codex restart requirement', () => {
  const js = skillsViewSource();

  assert.match(js, /restartRequired[^\n]*includes\(['"]codex['"]\)/);
  assert.match(js, /重启 Codex 后生效/);
  assert.match(js, /Claude Settings/);
  assert.match(js, /Codex config\.toml/);
  assert.match(js, /同名 Claude 安装项/);
  assert.match(js, /插件管理/);
  assert.match(js, /invocationMode\s*===\s*['"]manual['"]/);
  assert.match(js, /仅手动/);
  assert.match(js, /WorkBuddy[\s\S]{0,180}skills_disabled/);
});
