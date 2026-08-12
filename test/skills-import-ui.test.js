'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '..', 'public', 'app.js');

function skillsViewSource() {
  const source = fs.readFileSync(APP, 'utf8');
  const start = source.indexOf('const skillsView = {');
  const end = source.indexOf('// 把 skill 注入当前终端', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return { source, view: source.slice(start, end) };
}

test('valid Skill details expose a single-target import action while residue details do not', () => {
  const { view } = skillsViewSource();
  assert.match(view, /\$\{it\.residue \? '' : `<button data-act="import"/);
  assert.match(view, /data-act="import"[^>]*>导入到…<\/button>/);
  assert.match(view, /skillImportTargetDialog\(it, this\.data\.roots \|\| \{\}\)/);
});

test('import target dialog shows controlled roots and excludes the source installation location', () => {
  const { source } = skillsViewSource();
  assert.match(source, /claude:\s*'Claude',\s*codex:\s*'Codex',\s*agents:\s*'Agents 共享目录',\s*workbuddy:\s*'WorkBuddy'/);
  assert.match(source, /\(item\.importTargets \|\| \[\]\)\.includes\(id\)/);
  assert.match(source, /role="radiogroup"/);
  assert.match(source, /name="skill-import-target"/);
  assert.match(source, /独立副本，不会与来源同步/);
});

test('import uses controlled ids, maps stable statuses, and refreshes in place', () => {
  const { view } = skillsViewSource();
  assert.match(view, /!Array\.isArray\(it\.importTargets\)[\s\S]*目标列表尚未就绪；请刷新或重启 FanBox 后重试/);
  assert.match(view, /!it\.importTargets\.length[\s\S]*没有可导入的目标 Agent/);
  assert.match(view, /apiPost\('\/api\/skills\/import',\s*\{\s*sourceDir:\s*it\.dir,\s*targetAgent,\s*cwd:\s*state\.cwd\s*\}\)/);
  assert.match(view, /r\s*&&\s*\(r\.status\s*===\s*'created'\s*\|\|\s*r\.status\s*===\s*'overwritten'\)/);
  assert.match(view, /已导入到 \$\{r\.targetLabel\}；新会话可发现/);
  assert.match(view, /r\s*&&\s*r\.status\s*===\s*'identical'/);
  assert.match(view, /r\s*&&\s*r\.status\s*===\s*'name_ambiguity'/);
  assert.match(view, /r\s*&&\s*r\.status\s*===\s*'concurrent_changed'/);
  assert.match(view, /r\s*&&\s*r\.status\s*===\s*'source_changed'/);
  assert.match(view, /r\s*&&\s*r\.status\s*===\s*'unsafe_content'/);
  assert.match(view, /finally\s*\{\s*this\.busy\s*=\s*false;\s*await this\.reload\(\)/);
});

test('only structured conflicts offer an explicit two-phase overwrite with cancel focused', () => {
  const { source, view } = skillsViewSource();
  assert.match(view, /r\s*&&\s*r\.status\s*===\s*'content_conflict'[\s\S]*skillImportConflictDialog\(it, r\)/);
  assert.match(view, /overwrite:\s*true,\s*sourceFingerprint:\s*r\.sourceFingerprint,\s*conflictFingerprint:\s*r\.conflictFingerprint/);
  assert.match(source, /完整替换目标，不会合并文件。原目标将移入系统废纸篓，可恢复/);
  assert.match(source, /data-act="cancel">取消<\/button><button[^>]*data-act="overwrite">覆盖/);
  assert.match(source, /skillImportConflictDialog[\s\S]*querySelector\('\[data-act=cancel\]'\)\.focus\(\)/);
  assert.doesNotMatch(source.slice(source.indexOf('function skillImportConflictDialog'), source.indexOf('function skillImportAmbiguityDialog')), /ev\.key === 'Enter'/);
});

test('name ambiguity offers reveal without force continue', () => {
  const { source, view } = skillsViewSource();
  const start = source.indexOf('function skillImportAmbiguityDialog');
  const end = source.indexOf('// ---------- 截图直通车', start);
  const dialog = source.slice(start, end);
  assert.match(dialog, /在文件区显示/);
  assert.doesNotMatch(dialog, /覆盖|强制|overwrite/);
  assert.match(view, /r\.conflict\s*&&\s*r\.conflict\.dir\)\s*await navigate\(dirOf\(r\.conflict\.dir\)\)/);
});
