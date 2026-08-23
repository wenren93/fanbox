'use strict';

// 批量 v2 UI（issue 23 · docs/16 §4.4）前端行为断言：沿用 skillsView 测试方式——
// 对 public/app.js 的源码切片做正则断言。行选择模式（勾选行 → 按列 接入/取消接入/卸载）
// + 表头图标整列批量（弹「影响 N 个」确认）；两级卸载统一走 batch 端点。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function source() {
  return fs.readFileSync('public/app.js', 'utf8');
}

function skillsViewSource() {
  const js = source();
  const start = js.indexOf('const skillsView = {');
  const end = js.indexOf('// 把 skill 注入当前终端', start);
  assert.notEqual(start, -1, 'skillsView should exist');
  assert.notEqual(end, -1, 'skillsView source boundary should exist');
  return { js, view: js.slice(start, end) };
}

function styles() {
  return fs.readFileSync('public/style.css', 'utf8');
}

test('Selection mode state lives on skillsView and resets with the view', () => {
  const { view } = skillsViewSource();
  assert.match(view, /batchMode: false, batchSel: new Set\(\),/);
  assert.match(view, /this\.batchMode = false; this\.batchSel\.clear\(\);/);
  assert.match(view, /toggleBatchMode\(\) \{\s*if \(this\.busy \|\| this\.refreshing\) return;\s*this\.batchMode = !this\.batchMode;\s*this\.batchSel\.clear\(\);\s*this\.open\.clear\(\); \/\/ 批量模式下行点击只做勾选，抽屉收起\s*this\.render\(\);/);
  assert.match(view, /id="sk-batch-mode" title="行选择模式：勾选行后按列执行接入\/取消接入\/卸载"/);
  assert.match(view, /\$\{this\.batchMode \? '退出批量' : '批量'\}/);
});

test('Matrix rows become checkable in selection mode and clicks only toggle selection', () => {
  const { view } = skillsViewSource();
  assert.match(view, /const sel = this\.batchMode && this\.batchSel\.has\(it\.name\);/);
  assert.match(view, /\$\{this\.batchMode\s*\?\s*`<label class="sk-cb"><input type="checkbox" \$\{sel \? 'checked' : ''\} aria-label="选择 \$\{escapeHtml\(it\.name\)\}"><\/label>`\s*:\s*`<span class="sk-dot /);
  assert.match(view, /if \(this\.batchMode && it\.agents && container\) \{ e\.stopPropagation\(\); this\.toggleBatchSel\(it\.name\); return; \}/);
  assert.match(view, /toggleBatchSel\(name\) \{\s*if \(this\.busy \|\| this\.refreshing\) return;\s*if \(this\.batchSel\.has\(name\)\) this\.batchSel\.delete\(name\); else this\.batchSel\.add\(name\);\s*this\.render\(\);/);
  assert.match(view, /pruneBatchSel\(\) \{\s*const names = new Set\(this\.matrixRows\(\)\.map\(\(x\) => x\.name\)\);\s*this\.batchSel = new Set\(\[\.\.\.this\.batchSel\]\.filter\(\(n\) => names\.has\(n\)\)\);/);
});

test('Selection bar carries the count, per-column link/unlink pairs and uninstall', () => {
  const { view } = skillsViewSource();
  assert.match(view, /if \(this\.batchMode\) h \+= this\.batchBarHtml\(\);/);
  assert.match(view, /<div class="sk-batch-count"><span>已选<\/span><b>\$\{n\}<\/b><em>个原件<\/em><\/div>/);
  assert.match(view, /<button data-batch-col="\$\{c\.id\}" data-batch-on="1"[^>]*title="把选中原件全部接入 \$\{escapeHtml\(c\.label\)\}（\$\{escapeHtml\(c\.mech\)\}）"><span class="sym \$\{c\.id\}">\$\{c\.sym\}<\/span>接入<\/button>/);
  assert.match(view, /<button data-batch-col="\$\{c\.id\}" data-batch-on="0"[^>]*title="取消选中原件的 \$\{escapeHtml\(c\.label\)\} 接入">/);
  assert.match(view, /<button data-batch-act="uninstall" class="danger"[^>]*title="取消全部接入；自管原件进系统废纸篓，外部\/仓库家族原件只取消接入">卸载<\/button>/);
});

test('Row-scoped batches post names + agent + on + scope rows to the batch endpoint', () => {
  const { view } = skillsViewSource();
  assert.match(view, /async batchLink\(names, agent, on, scope\) \{/);
  assert.match(view, /await this\.postBatch\(\{ names, agent, on, scope \},\s*\(r\) => \{/);
  assert.match(view, /async postBatch\(payload, handle\) \{[\s\S]{0,300}await handle\(await apiPost\('\/api\/skills\/batch', payload\)\);/);
  assert.match(view, /this\.reportBatch\(`\$\{scope === 'column' \? '整列' : '批量'\}\$\{on \? '接入' : '取消接入'\} \$\{col\.label\}`,\s*r\);/);
  assert.match(view, /batchBar\.querySelectorAll\('\[data-batch-col\]'\)\.forEach\(\(btn\) => \{\s*btn\.onclick = \(e\) => \{\s*e\.stopPropagation\(\);\s*this\.batchLink\(\[\.\.\.this\.batchSel\], btn\.dataset\.batchCol, btn\.dataset\.batchOn === '1', 'rows'\);/);
});

test('Header icons run whole-column batches behind an affected-count confirmation', () => {
  const { js, view } = skillsViewSource();
  assert.match(view, /<button class="sym \$\{c\.id\} sk-colhead" data-col-head="\$\{c\.id\}" title="整列批量 · \$\{escapeHtml\(c\.label\)\}：\$\{escapeHtml\(c\.mech\)\}"/);
  assert.match(view, /async columnHeadClick\(agent\) \{/);
  assert.match(view, /const lit = rows\.filter\(\(x\) => \(\(x\.agents \|\| \{\}\)\[agent\] \|\| \{\}\)\.on\);\s*const unlit = rows\.filter\(\(x\) => !\(\(x\.agents \|\| \{\}\)\[agent\] \|\| \{\}\)\.on\);/);
  assert.match(view, /const choice = await skillColumnBatchDialog\(col, lit\.length, unlit\.length\);/);
  assert.match(view, /await this\.batchLink\(\(choice === 'on' \? unlit : lit\)\.map\(\(x\) => x\.name\), agent, choice === 'on', 'column'\);/);
  assert.match(js, /function skillColumnBatchDialog\(col, litCount, unlitCount\) \{/);
  assert.match(js, /<div class="input-title" id="sk-colbatch-title">整列批量 · \$\{escapeHtml\(col\.label\)\}<\/div>/);
  assert.match(js, />全部取消接入（影响 \$\{litCount\} 个）<\/button>/);
  assert.match(js, />全部接入（影响 \$\{unlitCount\} 个）<\/button>/);
});

test('Batch uninstall confirms with counts and the external carve-out spelled out', () => {
  const { view } = skillsViewSource();
  assert.match(view, /async batchUninstallSelected\(\) \{/);
  assert.match(view, /const externals = names\.filter\(\(n\) => \{ const it = this\.rowByName\(n\); return it && it\.origin !== 'store'; \}\)\.length;/);
  assert.match(view, /`卸载选中的 \$\{names\.length\} 个原件？自管原件移入系统废纸篓可恢复\$\{externals \? `；其中 \$\{externals\} 个外部\/仓库家族原件只取消接入` : ''\}。`/);
  assert.match(view, /if \(!\(await confirmDialog\(msg\)\)\) return;\s*await this\.runUninstall\(names\);/);
});

test('Batch results summarize per status, surface the Codex restart cost and route occupied conflicts', () => {
  const { view } = skillsViewSource();
  assert.match(view, /reportBatch\(label, r\) \{/);
  assert.match(view, /if \(s\.success\) parts\.push\(`\$\{s\.success\} 成功`\);\s*if \(s\.noop\) parts\.push\(`\$\{s\.noop\} 无变化`\);\s*if \(s\.unlinked\) parts\.push\(`\$\{s\.unlinked\} 仅取消接入`\);\s*if \(s\.failed\) parts\.push\(`\$\{s\.failed\} 失败`\);/);
  assert.match(view, /if \(\(r\.restartRequired \|\| \[\]\)\.includes\('codex'\)\) msg \+= '；重启 Codex 后生效';/);
  assert.match(view, /const first = \(r\.results \|\| \[\]\)\.find\(\(x\) => x\.status === 'failed' && x\.conflict && x\.conflict\.kind === 'occupied'\);/);
  assert.match(view, /async routeBatchConflict\(result, agentHint\) \{[\s\S]{0,300}skillOccupiedDialog\(it, agent, result\.conflict\.path\)/);
  assert.match(view, /const agent = agentHint \|\| result\.agent \|\| 'workbuddy';/);
});

test('Selection-mode styles cover checkboxes, header buttons and non-interactive icons', () => {
  const css = styles();
  assert.match(css, /\.sk-cb input \{[^}]*accent-color: var\(--accent\);[^}]*cursor: pointer; \}/);
  assert.match(css, /\.sk-row\.picking \.sk-mtx \.sk-ic \{ pointer-events: none; \}/);
  assert.match(css, /\.sk-colhead \{[^}]*cursor: pointer;[^}]*border-radius: 6px; \}/);
  assert.match(css, /\.sk-colhead:hover \{[^}]*background: var\(--bg-3\); \}/);
});
