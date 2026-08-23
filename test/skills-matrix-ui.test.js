'use strict';

// 矩阵 UI 主体（issue 22 · 规格 docs/16 §4）前端行为断言：
// 沿用既有 skillsView 测试方式——对 public/app.js 的源码切片做正则断言。
// 一行 = 一个原件（refresh v2）；四列图标点选调 /api/skills/link 并 busy→toast；
// agent 页签带计数替代 source 筛选；纯库存混排 + 「只看未接入」chip；
// 项目级与插件进底部折叠区保持原形态；占用冲突引导收编/覆盖流程入口。

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

test('Installed page consumes the refresh v2 row model instead of the legacy scan shape', () => {
  const { view } = skillsViewSource();
  assert.match(view, /\/\/ v2（行 = 原件，docs\/16 §2）以 \{v:2\} 协商启用/);
  assert.match(view, /fetchScan\(\) \{ return apiPost\('\/api\/skills\/refresh', \{ cwd: state\.cwd, v: 2 \}\); \},/);
  assert.doesNotMatch(view, /apiPost\('\/api\/skills\/refresh',\s*\{\s*cwd:\s*state\.cwd\s*\}\)/);
  assert.match(view, /matrixRows\(\) \{\s*return \(this\.data\.items \|\| \[\]\)\.filter\(\(x\) => x\.agents && x\.origin !== 'project' && x\.origin !== 'plugin'\);\s*\},/);
  assert.match(view, /extraRows\(\) \{\s*return \(this\.data\.items \|\| \[\]\)\.filter\(\(x\) => x\.origin === 'project' \|\| x\.origin === 'plugin'\);\s*\},/);
});

test('Matrix columns declare the four agents and hide mechanism differences in tooltips', () => {
  const js = source();
  assert.match(js, /const SKILL_MATRIX_COLUMNS = \[\s*\{ id: 'claude', sym: '✳', label: 'Claude', mech: '相对软链 ~\/\.claude\/skills\/<name> → ~\/\.agents\/skills\/<name>' \},\s*\{ id: 'codex', sym: '◇', label: 'Codex', mech: 'config\.toml 启停，重启 Codex 后生效' \},\s*\{ id: 'workbuddy', sym: '⌂', label: 'WorkBuddy', mech: '拷贝入 ~\/\.workbuddy\/skills，取消接入移入同级 skills_disabled' \},\s*\{ id: 'zcode', sym: '▲', label: 'ZCode', mech: 'config\.json 按原件路径的 enable 开关' \},\s*\];/);
});

test('Rows render origin badge, four icons, hits, health and mtime', () => {
  const { js, view } = skillsViewSource();
  assert.match(view, /matrixRowHtml\(it\) \{/);
  assert.match(js, /const SKILL_ORIGIN_BADGES = \{\s*repo: \{ text: '仓库', title: '[^']*git 管理[^']*' \},\s*external: \{ text: '外部', title: '[^']*卸载只取消接入、不删内容' \},\s*\};/);
  assert.match(view, /originBadge\(it\) \{[\s\S]{0,300}SKILL_ORIGIN_BADGES\[it\.origin\]/);
  assert.match(view, /<div class="sk-mtx">\$\{SKILL_MATRIX_COLUMNS\.map\(\(c\) => this\.linkIconHtml\(it, c\)\)\.join\(''\)\}<\/div>/);
  assert.match(view, /<div class="sk-hits \$\{it\.hits \? '' : 'zero'\}">\$\{it\.hits \|\| '· 0 ·'\}<\/div>/);
  assert.match(view, /<div class="sk-health \$\{shown \? shown\.level : ''\}"/);
  assert.match(view, /<div class="sk-last">\$\{this\.ago\(it\.mtime\)\}<\/div>/);
  assert.match(view, /class="sk-row \$\{stock \? 'stock' : ''\} \$\{this\.open\.has\(it\.dir\) \? 'expanded' : ''\}"/);
  assert.match(view, /<i class="sk-offtag">未接入<\/i>/);
});

test('Icon clicks call the single link endpoint with busy state and cost toasts', () => {
  const { view } = skillsViewSource();
  assert.match(view, /async toggleLink\(it, agent\) \{/);
  assert.match(view, /apiPost\('\/api\/skills\/link',\s*\{\s*name: it\.name, agent, on \}\)/);
  assert.match(view, /this\.linkBusy\.add\(key\); this\.render\(\);/);
  assert.match(view, /finally \{\s*this\.linkBusy\.delete\(key\);\s*await this\.reload\(\);/);
  assert.match(view, /r\.restartRequired === 'codex' \|\| \(Array\.isArray\(r\.restartRequired\) && r\.restartRequired\.includes\('codex'\)\)\) msg \+= '；重启 Codex 后生效';/);
  assert.match(view, /if \(icon && it\.agents\) \{ e\.stopPropagation\(\); this\.toggleLink\(it, icon\.dataset\.linkAgent\); return; \}/);
});

test('Occupied conflicts guide to the annex and overwrite entries without touching content', () => {
  const { js, view } = skillsViewSource();
  assert.match(js, /\/\/ 接入目标位被同名实体占用（POST \/api\/skills\/link 的结构化冲突）：FanBox 不静默覆盖，/);
  assert.match(js, /function skillOccupiedDialog\(item, agent, conflictPath\) \{/);
  assert.match(view, /r\.conflict && r\.conflict\.kind === 'occupied'/);
  assert.match(js, /目标位已被同名实体占用/);
  assert.match(js, /<b>收编<\/b>——把现有内容提升为原件后再接入/);
  assert.match(js, /<b>覆盖接管<\/b>——确认后完整替换，旧内容移入系统废纸篓可恢复/);
  assert.match(js, /data-act="reveal">在文件区显示<\/button>/);
  assert.match(js, /ov\.querySelector\('\[data-act=cancel\]'\)\.focus\(\)/);
});

test('Agent tabs carry counts and replace the legacy source filters', () => {
  const { view } = skillsViewSource();
  assert.match(view, /<button class="sk-atab \$\{this\.agent === 'all' \? 'on' : ''\}" data-agent-tab="all">全部 <i>\$\{counts\.total \|\| 0\}<\/i><\/button>/);
  assert.match(view, /data-agent-tab="\$\{c\.id\}"[^>]*><span class="sym \$\{c\.id\}">\$\{c\.sym\}<\/span>\$\{c\.label\} <i>\$\{counts\[c\.id\] \|\| 0\}<\/i><\/button>/);
  assert.match(view, /id="sk-stock-chip" title="四列全灰的纯库存原件，切换显示\/隐藏">只看未接入 <i>\$\{counts\.stock \|\| 0\}<\/i><\/button>/);
  assert.match(view, /isStock\(x\) \{\s*const a = x\.agents \|\| \{\};\s*return !a\.claude\.on && !a\.codex\.on && !a\.workbuddy\.on && !a\.zcode\.on;\s*\},/);
  assert.match(view, /if \(this\.stockOnly\) arr = arr\.filter\(\(x\) => this\.isStock\(x\)\);/);
  assert.doesNotMatch(view, /data-f="claude"|data-f="codex"|data-f="workbuddy"|data-f="project"|data-f="plugin"/);
});

test('Duplicate-name and health stay as secondary filters; search covers health messages', () => {
  const { view } = skillsViewSource();
  assert.match(view, /\['dup', '重名', dupCount\],/);
  assert.match(view, /\['bad', '仅看健康提示', o\.issues \|\| 0\]\]/);
  assert.match(view, /dupNames\(\) \{[\s\S]{0,400}seen\.set\(key, \(seen\.get\(key\) \|\| 0\) \+ 1\);[\s\S]{0,200}filter\(\(\[, n\]\) => n > 1\)/);
  assert.match(view, /\[x\.name, x\.skillName, x\.desc, x\.dir, \.\.\.\(x\.health \|\| \[\]\)\.map\(\(h\) => h\.msg\)\]\.filter\(Boolean\)\.join\('\\n'\)/);
  assert.match(view, /search\.oncompositionstart/);
  assert.match(view, /search\.oncompositionend/);
  assert.match(view, /search\.oninput/);
});

test('Project and plugin skills live in a bottom collapse keeping their legacy form', () => {
  const { view } = skillsViewSource();
  assert.match(view, /<details class="sk-others" \$\{this\.othersOpen \? 'open' : ''\}>/);
  assert.match(view, /项目级（\$\{proj\}）与插件（\$\{plug\}）— 不参与全局矩阵，保持原列表形态/);
  assert.match(view, /extraRowHtml\(it\) \{/);
  assert.match(view, /\$\{this\.srcTag\(it\)\}/);
  assert.match(view, /data-act="toggle" title="/);
  assert.match(view, /apiPost\('\/api\/skills\/toggle',\s*\{\s*dir: it\.dir, enable: it\.disabled, cwd: state\.cwd \}\)/);
  assert.match(view, /data-act="annex" \$\{this\.busy \? 'disabled' : ''\} title="把这份内容提升为原件仓中的原件（收编）">收编为原件<\/button>/);
  assert.match(view, /apiPost\('\/api\/skills\/annex',\s*\{\s*dir: it\.dir, cwd: state\.cwd \}\)/);
});

test('Row drawer exposes origin, per-column mechanism details, WB refresh, reveal and uninstall', () => {
  const { view } = skillsViewSource();
  assert.match(view, /rowDrawerHtml\(it\) \{/);
  assert.match(view, /<dt>原件路径<\/dt><dd class="mono">\$\{escapeHtml\(tilde\(it\.dir\)\)\}<\/dd>/);
  assert.match(view, /<dt>来源<\/dt><dd>\$\{escapeHtml\(originText\)\}<\/dd>/);
  assert.match(view, /<dl class="sk-link-matrix">\$\{detailRows\}<\/dl>/);
  assert.match(view, /config\.toml 无禁用条目 = 默认启用（Codex 原生扫描原件仓）/);
  assert.match(view, /data-act="refresh-wb"/);
  assert.match(view, /async refreshWorkBuddyCopy\(it\) \{[\s\S]{0,600}for \(const on of \[false, true\]\) \{\s*const r = await apiPost\('\/api\/skills\/link',\s*\{\s*name: it\.name, agent: 'workbuddy', on \}\);/);
  assert.match(view, /data-act="reveal" \$\{this\.busy \? 'disabled' : ''\}>在文件区显示<\/button>/);
  assert.match(view, /it\.origin === 'store'\s*\?\s*`<button data-act="uninstall" class="danger" \$\{this\.busy \? 'disabled' : ''\}>卸载原件（trash）<\/button>`\s*:\s*`<button data-act="unlink-all" \$\{this\.busy \? 'disabled' : ''\}>取消全部接入<\/button>`\}/);
  assert.match(view, /apiPost\('\/api\/skills\/trash',\s*\{\s*dir: it\.dir, cwd: state\.cwd \}\)/);
});

test('Uninstall keeps two-level semantics: store originals trash, external ones only unlink', () => {
  const { view } = skillsViewSource();
  assert.match(view, /async uninstallRow\(it\) \{\s*if \(this\.busy \|\| this\.refreshing\) return;\s*if \(it\.origin !== 'store'\) \{ await this\.unlinkAll\(it\); return; \}/);
  assert.match(view, /async unlinkAll\(it\) \{[\s\S]{0,700}apiPost\('\/api\/skills\/link',\s*\{\s*name: it\.name, agent: c\.id, on: false \}\)/);
  assert.match(view, /已取消 \$\{it\.name\} 的全部接入（原件不动）/);
  assert.match(view, /卸载「\$\{it\.name\}」？先取消全部接入，再把原件移到系统废纸篓，可恢复。/);
});

test('Broken links surface as a row-level warning with a reveal entry point', () => {
  const { js, view } = skillsViewSource();
  assert.match(view, /const bad = health\.find\(\(x\) => x\.level === 'error'\);/);
  assert.match(view, /<div class="sk-row-alert">⚠ \$\{escapeHtml\(bad\.msg\)\}/);
  assert.match(view, /a\.kind === 'broken-link' \|\| a\.kind === 'dead-loop'\) && a\.agent !== 'store'\)/);
  assert.match(view, /data-act="reveal-anomaly" data-path="\$\{escapeHtml\(anomaly\.path\)\}">查看<\/button>/);
  assert.match(js, /const SKILL_HEALTH_SHORT = \{[\s\S]*?'broken-link': '断链',[\s\S]*?'wb-drift': 'WB拷贝落后',[\s\S]*?\};/);
});

test('Stats read the v2 overview: stock count, health issues, anomalies and Claude column budget', () => {
  const { view } = skillsViewSource();
  assert.match(view, /<div class="sk-stat"><div class="sk-num">\$\{counts\.total \|\| 0\}<\/div><div class="sk-lbl">原件<\/div>/);
  assert.match(view, /<div class="sk-stat dust"><div class="sk-num">\$\{counts\.stock \|\| 0\}<\/div><div class="sk-lbl">未接入<\/div>/);
  assert.match(view, /<div class="sk-stat \$\{o\.issues \? 'alert' : ''\}">[\s\S]{0,200}健康提示/);
  assert.match(view, /<div class="sk-stat \$\{o\.anomalies \? 'alert' : ''\}">[\s\S]{0,200}扫描异常/);
  assert.match(view, /Claude 常驻预算（Claude 列亮着的行 \+ 插件）/);
  assert.match(view, /const over = \(o\.budgetChars \|\| 0\) > \(o\.budgetLimit \|\| 0\);/);
  assert.match(view, /toast\(`已刷新：\$\{c\.total \|\| 0\} 个原件，其中 \$\{c\.stock \|\| 0\} 个未接入`\);/);
});

test('Copy-based import and v1 batch bar retire with the matrix model', () => {
  const js = source();
  assert.doesNotMatch(js, /skillImportTargetDialog|skillImportConflictDialog|skillImportAmbiguityDialog/);
  const { view } = skillsViewSource();
  assert.doesNotMatch(view, /data-act="import"|导入到…/);
  assert.doesNotMatch(view, /data-batch-action=|#sk-batch-toggle|批量管理/);
});

test('Matrix styles cover unified lit/grey icons, agent tabs, stock fade and the collapse area', () => {
  const css = styles();
  assert.match(css, /\.sk-ic\.lit\.claude\s*\{[^}]*border-color:\s*#d97757;\s*color:\s*#d97757;\s*\}/s);
  assert.match(css, /\.sk-ic\.lit\.zcode\s*\{[^}]*#9d7bea/s);
  assert.match(css, /\.sk-ic\.busy\s*\{[^}]*animation:\s*skIcPulse/s);
  assert.match(css, /\.sk-row\.stock\s*\{\s*opacity:\s*0\.62;\s*\}/);
  assert.match(css, /\.sk-atab\.on\s*\{\s*border-color:\s*var\(--accent\);\s*background:\s*var\(--accent-soft\);/);
  assert.match(css, /\.sk-others\s*\{\s*margin-top:\s*26px;\s*\}/);
  assert.match(css, /\.sk-orow\s*\{[^}]*grid-template-columns:\s*24px minmax\(0, 1fr\) 118px/s);
  assert.match(css, /\.sk-link-matrix\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*112px minmax\(0, 1fr\);/);
});
