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

test('import uses a controlled target id, refreshes in place, and maps success feedback', () => {
  const { view } = skillsViewSource();
  assert.match(view, /!Array\.isArray\(it\.importTargets\)[\s\S]*目标列表尚未就绪；请刷新或重启 FanBox 后重试/);
  assert.match(view, /!it\.importTargets\.length[\s\S]*没有可导入的目标 Agent/);
  assert.match(view, /apiPost\('\/api\/skills\/import',\s*\{\s*sourceDir:\s*it\.dir,\s*targetAgent,\s*cwd:\s*state\.cwd\s*\}\)/);
  assert.match(view, /r\s*&&\s*r\.status\s*===\s*'created'/);
  assert.match(view, /已导入到 \$\{r\.targetLabel\}；新会话可发现/);
  assert.match(view, /finally\s*\{\s*this\.busy\s*=\s*false;\s*await this\.reload\(\)/);
});
