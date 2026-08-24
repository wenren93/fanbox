'use strict';

// 一次性迁移向导（issue 29 · docs/16 §8–§9）前端行为断言。
// seam = Skills 页公开用户流程 + migrate 三端点契约；不检查私有 DOM 实现细节。

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

test('Skills exposes a one-time migration wizard tab with an explicit five-step journey', () => {
  const { view } = skillsViewSource();
  assert.match(view, /data-sk-tab="migration"/);
  assert.match(view, /扫描现状/);
  assert.match(view, /漂移改判/);
  assert.match(view, /确认执行/);
  assert.match(view, /批量迁移/);
  assert.match(view, /验收报告/);
  assert.match(view, /if \(this\.activeTab === 'migration'\) \{ this\.renderMigration\(\); return; \}/);
});

test('Scan renders every drift row and permits winner changes only before the plan is locked', () => {
  const { view } = skillsViewSource();
  assert.match(view, /apiPost\('\/api\/skills\/migrate\/scan'\)/);
  assert.match(view, /migrationRowHtml\(row\)/);
  assert.match(view, /const candidates = row\.candidates \|\| \[\];[\s\S]{0,500}candidates\.map/);
  assert.match(view, /data-mig-winner="\$\{escapeHtml\(row\.name\)\}"/);
  assert.match(view, /this\.migration\.winners\[name\] = source/);
  assert.match(view, /lockMigrationPlan\(\)/);
  assert.match(view, /m\.locked = true/);
  assert.match(view, /disabled[^\n]*m\.locked|m\.locked[^\n]*disabled/);
});

test('Execution requires the no-running-session acknowledgement and posts the locked plan', () => {
  const { view } = skillsViewSource();
  assert.match(view, /没有正在运行的 Claude 或 Codex 会话/);
  assert.match(view, /id="sk-mig-session-ack"/);
  assert.match(view, /m\.sessionConfirmed/);
  assert.match(view, /apiPost\('\/api\/skills\/migrate\/execute', \{ plan: \{ winners: \{ \.\.\.m\.winners \} \} \}\)/);
  assert.match(view, /m\.step = 'running'/);
});

test('Report presents phases, visibility diff and every docs §9 acceptance item', () => {
  const { view } = skillsViewSource();
  assert.match(view, /migrationReportHtml\(report\)/);
  assert.match(view, /report\.phases/);
  assert.match(view, /report\.diff/);
  for (const label of [
    '可见性不变式', '原件仓健康', '外部不动', 'Codex 终态',
    'ZCode 终态', 'Claude 终态', '可回滚', '提醒项',
  ]) assert.match(view, new RegExp(label));
  assert.match(view, /report\.manifestPath/);
  assert.match(view, /c\.recoverable && Boolean\(report\.manifestPath\)/);
  assert.match(view, /review 并提交仓库改动/);
});

test('A failed or interrupted migration keeps its manifest and locked plan available for retry', () => {
  const { view } = skillsViewSource();
  assert.match(view, /m\.manifestPath = r\.manifestPath \|\| m\.manifestPath/);
  assert.match(view, /retryMigration\(\)/);
  assert.match(view, /data-mig-act="retry"/);
  assert.match(view, /按同一锁定方案重试/);
  assert.match(view, /data-mig-act="rescan"/);
});

test('Migration wizard styles cover the drift matrix, progress, report and responsive layout', () => {
  const css = fs.readFileSync('public/style.css', 'utf8');
  assert.match(css, /\.sk-mig-steps\s*\{/);
  assert.match(css, /\.sk-mig-matrix\s*\{/);
  assert.match(css, /\.sk-mig-phase(?:,|\s*\{)/);
  assert.match(css, /\.sk-mig-criterion(?:,|\s*\{)/);
  assert.match(css, /@media[^\{]*\([^\)]*max-width[^\)]*\)[\s\S]*?\.sk-mig/s);
});
