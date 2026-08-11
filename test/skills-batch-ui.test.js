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

  assert.match(js, /batchMode:\s*false,\s*selected:\s*new Set\(\),\s*busy:\s*false,\s*batchResult:\s*null/);
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
  const order = ['Claude 全局', 'Codex', 'WorkBuddy', '项目', '插件'].map((label) => js.indexOf(`'${label}'`));
  assert.ok(order.every((position) => position >= 0));
  assert.deepEqual(order, order.slice().sort((a, b) => a - b));
});

test('Skills search filters useful installation fields and clears batch selection', () => {
  const js = skillsViewSource();

  assert.match(js, /sort:\s*['"]hits['"],\s*query:\s*['"]/);
  assert.match(js, /\[x\.name,\s*x\.desc,\s*x\.label,\s*x\.dir,\s*\.\.\.\(x\.issues\s*\|\|\s*\[\]\)\]/);
  assert.match(js, /id="sk-search"/);
  assert.match(js, /this\.query\s*=\s*value;\s*this\.selected\.clear\(\);\s*this\.batchResult\s*=\s*null/);
  assert.match(js, /search\.oncompositionend/);
  assert.match(js, /search\.oninput/);
});
