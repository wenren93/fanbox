'use strict';

// 收编前端（issue 24 · 规格 docs/14 §入口与确认页）行为断言：
// 沿用既有 skillsView 测试方式——对 public/app.js 的源码切片做正则断言。
// 覆盖：anomalies 卡片处置入口、行内列冲突引导收编、项目级行详情「收编为原件」
// （插件/残留不给按钮）、两阶段预检→确认→执行流、确认页默认聚焦取消 +
// 脚本增强确认勾选、状态化失败提示。

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

test('Anomaly cards expose per-anomaly annex and reveal entries above the matrix', () => {
  const { view } = skillsViewSource();
  // 卡片区渲染：real-dir + action=annex 的残留给「收编为原件」，其余给「查看」
  assert.match(view, /anomaliesHtml\(\) \{/);
  assert.match(view, /a\.kind === 'real-dir' && a\.action === 'annex'/);
  assert.match(view, /data-act="annex-anomaly" data-agent="\$\{escapeHtml\(a\.agent\)\}" data-name="\$\{escapeHtml\(a\.name\)\}"/);
  assert.match(view, /data-act="reveal-anomaly" data-path="\$\{escapeHtml\(a\.path\)\}"/);
  // 插入点：工具行之后、表头之前
  assert.match(view, /\$\{this\.anomaliesHtml\(\)\}\s*\n?\s*<div class="sk-thead">/);
  // 点击在 dir 解析前处理：异常卡片不在任何 .sk-row 容器里
  assert.match(view, /if \(act && act\.dataset\.act === 'annex-anomaly'\) \{\s*e\.stopPropagation\(\);\s*await this\.annexAnomaly\(\{ agent: act\.dataset\.agent, name: act\.dataset\.name \}\); return; \}/);
});

test('Annex flow previews first, confirms with default-focus-cancel, then executes the two-phase payload', () => {
  const { view } = skillsViewSource();
  assert.match(view, /async runAnnex\(body\) \{/);
  assert.match(view, /apiPost\('\/api\/skills\/annex',\s*\{\s*\.\.\.body,\s*preview: true\s*\}\)/);
  assert.match(view, /skillAnnexConfirmDialog\(preview\)/);
  // 两阶段协议：目标在位时带双指纹显式覆盖重试
  assert.match(view, /payload\.overwrite = true;/);
  assert.match(view, /payload\.sourceFingerprint = preview\.sourceFingerprint;/);
  assert.match(view, /payload\.conflictFingerprint = preview\.conflictFingerprint;/);
  // 状态化结果：成功区分三种终态，Codex 重启代价随 toast 呈现
  assert.match(view, /已收编为原件：\$\{r\.name\}/);
  assert.match(view, /旧原件在系统废纸篓可恢复/);
  assert.match(view, /内容与在位原件一致/);
  assert.match(view, /r\.restartRequired === 'codex' \|\| \(Array\.isArray\(r\.restartRequired\) && r\.restartRequired\.includes\('codex'\)\)\) msg \+= '；重启 Codex 后生效';/);
});

test('Annex failures map to stable status-specific toasts including unsafe problem paths', () => {
  const { view } = skillsViewSource();
  assert.match(view, /reportAnnexFailure\(r\) \{/);
  assert.match(view, /status === 'unsafe_content'/);
  assert.match(view, /r\.problemPath/);
  assert.match(view, /status === 'concurrent_changed'/);
  assert.match(view, /status === 'not_a_skill'/);
  assert.match(view, /status === 'invalid_source'/);
});

test('Project rows annex via projectRoot while plugin and residue rows get no button', () => {
  const { view } = skillsViewSource();
  // 项目级行详情按钮只在非插件、非残留下渲染
  assert.match(view, /\$\{it\.origin !== 'plugin' && !it\.residue \? `<button data-act="annex" \$\{this\.busy \? 'disabled' : ''\} title="把这份内容提升为原件仓中的原件（收编）">收编为原件<\/button>` : ''\}/);
  // annexItem 走新契约：project + name，插件明确拒绝
  assert.match(view, /async annexItem\(it\) \{/);
  assert.match(view, /插件 Skill 由插件管理，不提供收编/);
  assert.match(view, /project: it\.projectRoot \|\| state\.cwd, name: it\.name/);
  assert.doesNotMatch(view, /apiPost\('\/api\/skills\/annex',\s*\{\s*dir: it\.dir, cwd: state\.cwd \}\)/);
});

test('Occupied-conflict dialog offers live annex guidance when the occupier is an annexable residue', () => {
  const { js, view } = skillsViewSource();
  // 对话框扩展：返回三态 cancel/reveal/annex；默认聚焦取消
  assert.match(js, /function skillOccupiedDialog\(item, agent, conflictPath, canAnnex\) \{/);
  assert.match(js, /ov\.querySelector\('\[data-act=cancel\]'\)\.focus\(\)/);
  assert.match(js, /\$\{canAnnex \? '<button class="primary" data-act="annex">收编并接入<\/button>' : ''\}/);
  // 占用冲突时按路径找 real-dir 残留决定是否给收编出口；覆盖接管仍留给后续票
  assert.match(view, /const canAnnex = \(this\.data\.anomalies \|\| \[\]\)\.some\(\(a\) => a\.kind === 'real-dir' && a\.path === r\.conflict\.path\);/);
  assert.match(view, /choice === 'annex'\) await this\.annexAnomalyFromPath\(r\.conflict\.path\)/);
});

test('Confirm dialog renders scripts with enhanced-confirmation ack and defaults focus to cancel', () => {
  const js = source();
  assert.match(js, /function skillAnnexConfirmDialog\(preview\) \{/);
  assert.match(js, /<div class="input-title" id="sk-annex-title">/);
  assert.match(js, /sk-annex-scripts/);
  assert.match(js, /包含 \$\{scripts\.length\} 个脚本/);
  // 增强确认：勾选后才能开始；默认聚焦取消
  assert.match(js, /id="sk-annex-ack"/);
  assert.match(js, /我已了解脚本内容，确认收编/);
  assert.match(js, /ack\.onchange = \(\) => \{ submit\.disabled = !ack\.checked; \};/);
  assert.match(js, /ov\.querySelector\('\[data-act=cancel\]'\)\.focus\(\);\s*\n\s*\}\);/m);
  // 冲突差异概要
  assert.match(js, /sk-annex-diff/);
  assert.match(js, /preview\.diff\.added\.length/);
});

test('Anomaly cards and confirm-dialog styles ship with the matrix styles', () => {
  const css = styles();
  assert.match(css, /\.sk-anoms\s*\{/);
  assert.match(css, /\.sk-anom\s*\{/);
  assert.match(css, /\.sk-anom-kind\s*\{/);
  assert.match(css, /\.sk-anom-act/);
  assert.match(css, /\.sk-annex-diff\s*\{/);
  assert.match(css, /\.sk-annex-scripts\s*\{/);
  assert.match(css, /\.sk-annex-ack\s*\{/);
});
