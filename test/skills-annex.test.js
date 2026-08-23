'use strict';

// /api/skills/annex 收编端点（issue 24 · 规格 docs/14 全量）集成测试。
// 隔离 HOME 下覆盖：四 Agent 目录真实目录残留收编（该列可见性不变、不留双份）、
// 项目级收编（项目目录不动）、与安装共用风险检查（链接 / 特殊文件 / 未知可执行二进制
// 被拒 + 权限规范化 + 脚本增强确认）、同名冲突两阶段协议（指纹 → 显式覆盖 → trash
// 可恢复 + 来源记录失效）、各阶段失败回滚无半成品、并发经写队列串行。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO = path.join(__dirname, '..');

async function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

async function freePortPair() {
  for (let i = 0; i < 50; i++) {
    const port = 20000 + Math.floor(Math.random() * 20000);
    if (await canListen(port) && await canListen(port + 1)) return port;
  }
  throw new Error('could not find two adjacent free ports');
}

async function waitForServer(port, child, getLogs) {
  const deadline = Date.now() + 5000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early (${child.exitCode})\n${getLogs()}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/roots`);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${lastError ? lastError.message : 'server did not start'}\n${getLogs()}`);
}

async function stopChild(child) {
  // 注意：被信号终止的子进程 exitCode 保持 null（signalCode='SIGTERM'），
  // 只看 exitCode 会对已死进程二次挂起在永不触发的 'exit' 上
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await exited;
}

async function withServer(t, fn, extraEnv = {}) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'fanbox-skills-annex-home-'));
  const port = await freePortPair();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: REPO,
    // 「废纸篓」指到隔离目录：断言旧原件 / 被替换来源实体可恢复
    env: {
      ...process.env, HOME: home, FANBOX_PORT: String(port), FANBOX_NO_OPEN: '1',
      NODE_ENV: 'test', FANBOX_TEST_SKILL_TRASH: path.join(home, '.fanbox-test-trash'), ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (data) => { logs += data; });
  child.stderr.on('data', (data) => { logs += data; });
  t.after(async () => {
    await stopChild(child);
    await fs.rm(home, { recursive: true, force: true });
  });
  await waitForServer(port, child, () => logs);

  async function post(url, body) {
    const response = await fetch(`http://127.0.0.1:${port}${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: `http://localhost:${port}` },
      body: JSON.stringify(body ?? {}),
    });
    return { status: response.status, body: await response.json() };
  }

  return fn({ home, port, post });
}

async function createSkill(dir, name = path.basename(dir), description = `Test fixture for ${name}`) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\nbody\n`, 'utf8');
}

async function trashEntries(home) {
  const dir = path.join(home, '.fanbox-test-trash');
  try { return await fs.readdir(dir); } catch { return []; }
}

async function refreshRows(post) {
  const response = await post('/api/skills/refresh', { v: 2 });
  assert.equal(response.status, 200);
  return response.body;
}

function anomalyOf(scan, agent, name) {
  return (scan.anomalies || []).find((a) => a.agent === agent && a.name === name && a.kind === 'real-dir');
}

test('claude real-dir residue annexes into the store and the column keeps visibility without duplicates', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const store = path.join(home, '.agents', 'skills');
    const claudeSkills = path.join(home, '.claude', 'skills');
    const stray = path.join(claudeSkills, 'stray');
    await createSkill(stray, 'stray', 'a leftover real directory in the claude root');
    await fs.mkdir(path.join(stray, 'scripts'), { recursive: true });
    await fs.writeFile(path.join(stray, 'scripts', 'run.sh'), '#!/bin/sh\necho hi\n', 'utf8');

    const annexed = await post('/api/skills/annex', { agent: 'claude', name: 'stray' });
    assert.equal(annexed.status, 200);
    assert.equal(annexed.body.ok, true, `annex failed: ${annexed.body.error}`);
    assert.equal(annexed.body.status, 'annexed');

    // 原件入仓、内容完整复制
    const storeEntry = path.join(store, 'stray');
    assert.match(await fs.readFile(path.join(storeEntry, 'SKILL.md'), 'utf8'), /leftover real directory/);
    assert.match(await fs.readFile(path.join(storeEntry, 'scripts', 'run.sh'), 'utf8'), /echo hi/);
    // Claude 列改为相对链接入，与 skills.sh 风格同构
    assert.equal((await fs.lstat(stray)).isSymbolicLink(), true, 'the real directory must become a relative symlink');
    assert.equal(await fs.readlink(stray), path.join('..', '..', '.agents', 'skills', 'stray'));

    // 该列可见性不变（收编前后都亮），且扫描不再报这个残留
    let scan = await refreshRows(post);
    const row = scan.items.find((it) => it.name === 'stray');
    assert.ok(row, 'annexed skill must appear as a store row');
    assert.equal(row.origin, 'store');
    assert.equal(row.agents.claude.on, true);
    assert.equal(anomalyOf(scan, 'claude', 'stray'), undefined, 'the residue must leave the anomaly list');

    // 不留双份、无临时半成品；被替换掉的真实目录进废纸篓可恢复
    assert.equal((await fs.readdir(claudeSkills)).filter((n) => n.startsWith('.fanbox-')).length, 0);
    assert.equal((await fs.readdir(store)).filter((n) => n.startsWith('.fanbox-')).length, 0);
    const trashed = await trashEntries(home);
    assert.equal(trashed.length, 1, 'the replaced real directory must be recoverable');
    assert.match(await fs.readFile(path.join(home, '.fanbox-test-trash', trashed[0], 'SKILL.md'), 'utf8'),
      /leftover real directory/);
  });
});

test('codex and zcode residues are removed for native scanning while preserved-disabled stays invisible', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const store = path.join(home, '.agents', 'skills');
    const codexSkills = path.join(home, '.codex', 'skills');
    const zcodeSkills = path.join(home, '.zcode', 'skills');
    const codexConfig = path.join(home, '.codex', 'config.toml');
    const zcodeConfig = path.join(home, '.zcode', 'cli', 'config.json');

    // Codex：启用态残留 → 删实体即可，配置不动
    await createSkill(path.join(codexSkills, 'enabled-residue'));
    const a = await post('/api/skills/annex', { agent: 'codex', name: 'enabled-residue' });
    assert.equal(a.body.ok, true, `codex annex failed: ${a.body.error}`);
    await assert.rejects(() => fs.lstat(path.join(codexSkills, 'enabled-residue')), { code: 'ENOENT' },
      'codex residues must be deleted so the store is the only source');
    let scan = await refreshRows(post);
    assert.equal(scan.items.find((it) => it.name === 'enabled-residue').agents.codex.on, true);
    assert.equal(await fs.readFile(codexConfig, 'utf8').catch(() => ''), '');

    // ZCode：启用态残留 → 删实体即可
    await createSkill(path.join(zcodeSkills, 'zc-residue'));
    const z = await post('/api/skills/annex', { agent: 'zcode', name: 'zc-residue' });
    assert.equal(z.body.ok, true, `zcode annex failed: ${z.body.error}`);
    await assert.rejects(() => fs.lstat(path.join(zcodeSkills, 'zc-residue')), { code: 'ENOENT' });
    scan = await refreshRows(post);
    assert.equal(scan.items.find((it) => it.name === 'zc-residue').agents.zcode.on, true);

    // Codex：禁用态残留 → 可见性保持不变（原件仓条目写同样的 enabled=false）
    await createSkill(path.join(codexSkills, 'muted-residue'));
    await fs.mkdir(path.join(home, '.codex'), { recursive: true });
    await fs.writeFile(codexConfig,
      `model = "gpt-test"\n\n[[skills.config]]\npath = ${JSON.stringify(path.join(codexSkills, 'muted-residue', 'SKILL.md'))}\nenabled = false\n`, 'utf8');
    const m = await post('/api/skills/annex', { agent: 'codex', name: 'muted-residue' });
    assert.equal(m.body.ok, true, `codex muted annex failed: ${m.body.error}`);
    assert.equal(m.body.restartRequired, 'codex');
    assert.match(String(m.body.note), /重启 Codex/);
    const text = await fs.readFile(codexConfig, 'utf8');
    assert.match(text, /model = "gpt-test"/, 'existing config must survive');
    const block = text.split('[[skills.config]]').find((part) => part.includes(path.join(store, 'muted-residue')));
    assert.match(block, /enabled\s*=\s*false/, 'the store entry must inherit the mute so visibility stays unchanged');
    scan = await refreshRows(post);
    assert.equal(scan.items.find((it) => it.name === 'muted-residue').agents.codex.on, false,
      'a disabled residue must stay disabled after annexing');

    // ZCode：禁用态残留 → config.json enable:false 按原件路径保持
    await createSkill(path.join(zcodeSkills, 'zc-muted'));
    await fs.mkdir(path.join(home, '.zcode', 'cli'), { recursive: true });
    await fs.writeFile(zcodeConfig, JSON.stringify({
      plugins: { enabledPlugins: {} },
      skills: { [path.join(zcodeSkills, 'zc-muted')]: { enable: false } },
    }), 'utf8');
    const zm = await post('/api/skills/annex', { agent: 'zcode', name: 'zc-muted' });
    assert.equal(zm.body.ok, true, `zcode muted annex failed: ${zm.body.error}`);
    const cfg = JSON.parse(await fs.readFile(zcodeConfig, 'utf8'));
    assert.deepEqual(cfg.skills[path.join(store, 'zc-muted')], { enable: false });
    assert.deepEqual(cfg.plugins, { enabledPlugins: {} }, 'unrelated config sections must survive');
    scan = await refreshRows(post);
    assert.equal(scan.items.find((it) => it.name === 'zc-muted').agents.zcode.on, false);

    // 被删实体可从废纸篓恢复
    const trashed = await trashEntries(home);
    assert.ok(trashed.length >= 4, 'each replaced residue must be recoverable from the trash');
    assert.match(await fs.readFile(path.join(home, '.fanbox-test-trash', trashed[0], 'SKILL.md'), 'utf8'), /Test fixture|residue/);
  });
});

test('workbuddy residues keep their copy in place as the column link', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const wbSkills = path.join(home, '.workbuddy', 'skills');
    const copy = path.join(wbSkills, 'wb-only');
    await createSkill(copy, 'wb-only', 'a workbuddy-only local skill');
    await fs.writeFile(path.join(copy, 'notes.txt'), 'local notes\n', 'utf8');

    const r = await post('/api/skills/annex', { agent: 'workbuddy', name: 'wb-only' });
    assert.equal(r.body.ok, true, `wb annex failed: ${r.body.error}`);

    // 原件入仓；WB 原目录保留为拷贝接入（不移动、不删除）
    assert.match(await fs.readFile(path.join(home, '.agents', 'skills', 'wb-only', 'notes.txt'), 'utf8'), /local notes/);
    assert.equal((await fs.lstat(copy)).isDirectory(), true, 'the workbuddy copy must stay as the column access');
    assert.equal(await fs.readFile(path.join(copy, 'SKILL.md'), 'utf8'),
      await fs.readFile(path.join(home, '.agents', 'skills', 'wb-only', 'SKILL.md'), 'utf8'));
    const scan = await refreshRows(post);
    const row = scan.items.find((it) => it.name === 'wb-only');
    assert.equal(row.agents.workbuddy.on, true);
    assert.equal(anomalyOf(scan, 'workbuddy', 'wb-only'), undefined);
  });
});

test('project-level skills annex into the store while the project directory stays untouched', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const project = path.join(home, 'work', 'demo-project');
    const projSkill = path.join(project, '.claude', 'skills', 'proj-skill');
    await createSkill(projSkill, 'proj-skill', 'validated inside the project');
    await fs.writeFile(path.join(projSkill, 'extra.txt'), 'keep me\n', 'utf8');
    const before = await fs.stat(path.join(projSkill, 'SKILL.md'));
    const beforeBody = await fs.readFile(path.join(projSkill, 'SKILL.md'), 'utf8');

    // 基线行数（隔离 HOME 里通常为 0，但不写死）
    const baseScan = await refreshRows(post);
    const baselineTotal = baseScan.counts.total;

    // 先刷新一次把项目级行扫进清单（带 projectRoot）
    let scan = await post('/api/skills/refresh', { v: 2, cwd: project });
    const item = scan.body.items.find((it) => it.origin === 'project' && it.name === 'proj-skill');
    assert.ok(item && item.projectRoot === project, 'project rows must carry their project root');

    const r = await post('/api/skills/annex', { project, name: 'proj-skill' });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true, `project annex failed: ${r.body.error}`);
    assert.equal(r.body.status, 'annexed');
    assert.equal(r.body.source.agent, undefined, 'project sources carry no agent column');

    // 原件入仓；项目目录原样不动（内容与修改时间都不变）
    const storeEntry = path.join(home, '.agents', 'skills', 'proj-skill');
    assert.match(await fs.readFile(path.join(storeEntry, 'extra.txt'), 'utf8'), /keep me/);
    const after = await fs.stat(path.join(projSkill, 'SKILL.md'));
    assert.equal(after.mtimeMs, before.mtimeMs, 'project files must not be touched');
    assert.equal(await fs.readFile(path.join(projSkill, 'SKILL.md'), 'utf8'), beforeBody);

    // 项目级收编后项目目录不动；新原件按模型默认对 Codex/ZCode 原生可见，
    // Claude/WorkBuddy 无接入保持灰——可见性来源与安装一致（docs/16 §2）
    scan = await post('/api/skills/refresh', { v: 2, cwd: project }).then((r) => r.body);
    const row = scan.items.find((it) => it.agents && it.name === 'proj-skill');
    assert.ok(row, 'the annexed skill must join the matrix as a stock row');
    assert.deepEqual([row.agents.claude.on, row.agents.codex.on, row.agents.workbuddy.on, row.agents.zcode.on],
      [false, true, false, true]);
    assert.equal(scan.counts.total, baselineTotal + 1);
    assert.ok(scan.items.some((it) => it.origin === 'project' && it.dir === projSkill),
      'the project-level copy must remain where it is');
    assert.deepEqual(await trashEntries(home), []);
  });
});

test('risk checks shared with install reject links, special files and unknown executables, and normalize modes', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const claudeSkills = path.join(home, '.claude', 'skills');
    const outside = path.join(home, 'outside-target');

    // 软链接被拒并给出问题相对路径
    await createSkill(path.join(claudeSkills, 'with-link'));
    await createSkill(outside, 'outside');
    await fs.writeFile(path.join(claudeSkills, 'with-link', 'install.sh'), '#!/bin/sh\necho hi\n', 'utf8');
    await fs.chmod(path.join(claudeSkills, 'with-link', 'install.sh'), 0o755);
    await fs.symlink(outside, path.join(claudeSkills, 'with-link', 'jump'));
    const linkR = await post('/api/skills/annex', { agent: 'claude', name: 'with-link' });
    assert.equal(linkR.body.ok, false);
    assert.equal(linkR.body.status, 'unsafe_content');
    assert.equal(linkR.body.problemPath, 'jump');
    assert.match(linkR.body.error, /软链接|链接/);
    assert.equal((await fs.lstat(path.join(claudeSkills, 'with-link'))).isDirectory(), true, 'source must survive rejection');

    // 特殊文件（FIFO）被拒
    await fs.unlink(path.join(claudeSkills, 'with-link', 'jump'));
    await new Promise((resolve, reject) => {
      const { execFile } = require('node:child_process');
      execFile('mkfifo', [path.join(claudeSkills, 'with-link', 'pipe')], (err) => err ? reject(err) : resolve());
    });
    const fifoR = await post('/api/skills/annex', { agent: 'claude', name: 'with-link' });
    assert.equal(fifoR.body.ok, false);
    assert.equal(fifoR.body.status, 'unsafe_content');
    assert.equal(fifoR.body.problemPath, 'pipe');

    // 未知可执行二进制被拒；普通脚本触发增强确认
    await fs.unlink(path.join(claudeSkills, 'with-link', 'pipe'));
    await fs.writeFile(path.join(claudeSkills, 'with-link', 'tool'),
      Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x00, 0xff, 0xfe, 0x00]));
    await fs.chmod(path.join(claudeSkills, 'with-link', 'tool'), 0o755);
    const binR = await post('/api/skills/annex', { agent: 'claude', name: 'with-link' });
    assert.equal(binR.body.ok, false);
    assert.equal(binR.body.status, 'unsafe_content');
    assert.equal(binR.body.problemPath, 'tool');
    assert.match(binR.body.error, /未知可执行二进制/);

    await fs.unlink(path.join(claudeSkills, 'with-link', 'tool'));

    // 预检：脚本明示 + 增强确认标记；执行后权限规范化生效
    const preview = await post('/api/skills/annex', { agent: 'claude', name: 'with-link', preview: true });
    assert.equal(preview.body.ok, true, `preview failed: ${preview.body.error}`);
    assert.equal(preview.body.status, 'ready');
    assert.equal(preview.body.targetExists, false);
    assert.deepEqual(preview.body.scripts, ['install.sh']);
    assert.equal(preview.body.enhancedConfirmation, true);
    assert.equal(preview.body.source.skillName, 'with-link');

    const done = await post('/api/skills/annex', { agent: 'claude', name: 'with-link' });
    assert.equal(done.body.ok, true, `annex after risk fixes failed: ${done.body.error}`);
    const entry = path.join(home, '.agents', 'skills', 'with-link');
    assert.equal((await fs.stat(entry)).mode & 0o777, 0o755, 'directories normalize to 0755');
    assert.equal((await fs.stat(path.join(entry, 'SKILL.md'))).mode & 0o777, 0o644, 'plain files normalize to 0644');
    assert.equal((await fs.stat(path.join(entry, 'install.sh'))).mode & 0o777, 0o755, 'executable scripts keep 0755');
    assert.equal((await fs.readlink(path.join(claudeSkills, 'with-link'))),
      path.join('..', '..', '.agents', 'skills', 'with-link'));
  });
});

test('name conflicts run the two-phase protocol with overwrite confirmation, trash recovery and record invalidation', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const store = path.join(home, '.agents', 'skills');
    const claudeSkills = path.join(home, '.claude', 'skills');
    const sourcesFile = path.join(home, '.fanbox', 'skill-sources.json');

    await createSkill(path.join(store, 'alpha'), 'alpha', 'the original that got here first');
    await fs.mkdir(path.join(home, '.fanbox'), { recursive: true });
    await fs.writeFile(sourcesFile, JSON.stringify({ version: 1, installations: {
      [path.join(store, 'alpha')]: { repository: 'github.com/example/alpha', skillPath: 'alpha', commit: 'a'.repeat(40), contentHash: 'f'.repeat(64), name: 'alpha', installedAt: 1 },
    } }), 'utf8');
    await createSkill(path.join(claudeSkills, 'alpha'), 'alpha', 'a newer local take on alpha');
    await fs.writeFile(path.join(claudeSkills, 'alpha', 'local-only.txt'), 'mine\n', 'utf8');

    // 预检带回差异概要与两枚指纹
    const preview = await post('/api/skills/annex', { agent: 'claude', name: 'alpha', preview: true });
    assert.equal(preview.body.ok, true, `conflict preview failed: ${preview.body.error}`);
    assert.equal(preview.body.status, 'ready');
    assert.equal(preview.body.targetExists, true);
    assert.match(preview.body.sourceFingerprint, /^[a-f0-9]{64}$/, 'source fingerprint missing');
    assert.match(preview.body.conflictFingerprint, /^[a-f0-9]{64}$/, 'conflict fingerprint missing');
    assert.ok(preview.body.diff, 'diff summary missing');
    assert.ok(preview.body.diff.added.includes('local-only.txt'), 'local-only.txt should show up as added');
    assert.ok(preview.body.diff.changed.includes('SKILL.md'));
    assert.deepEqual(preview.body.diff.removed, []);
    assert.ok(preview.body.target.mtime > 0);
    assert.match(preview.body.target.path, /.*\.agents\/skills\/alpha$/);

    // 第一阶段：不带覆盖意图 → 结构化冲突，字节零变化
    const first = await post('/api/skills/annex', { agent: 'claude', name: 'alpha' });
    assert.equal(first.body.ok, false);
    assert.equal(first.body.status, 'content_conflict');
    assert.equal(first.body.conflictFingerprint, preview.body.conflictFingerprint);
    assert.equal(first.body.sourceFingerprint, preview.body.sourceFingerprint);
    assert.match(await fs.readFile(path.join(store, 'alpha', 'SKILL.md'), 'utf8'), /got here first/);
    assert.equal((await fs.lstat(path.join(claudeSkills, 'alpha'))).isDirectory(), true);
    assert.deepEqual(Object.keys(JSON.parse(await fs.readFile(sourcesFile, 'utf8')).installations),
      [path.join(store, 'alpha')], 'no record change before overwrite confirmation');

    // 指纹对不上 → 并发变化
    const stale = await post('/api/skills/annex', { agent: 'claude', name: 'alpha', overwrite: true,
      sourceFingerprint: preview.body.sourceFingerprint, conflictFingerprint: 'e'.repeat(64) });
    assert.equal(stale.body.ok, false);
    assert.equal(stale.body.status, 'concurrent_changed');

    // 第二阶段：显式覆盖 → 完整替换、旧原件进废纸篓、来源记录失效
    const over = await post('/api/skills/annex', { agent: 'claude', name: 'alpha', overwrite: true,
      sourceFingerprint: preview.body.sourceFingerprint, conflictFingerprint: preview.body.conflictFingerprint });
    assert.equal(over.body.ok, true, `overwrite failed: ${over.body.error}`);
    assert.equal(over.body.status, 'overwritten');
    assert.match(await fs.readFile(path.join(store, 'alpha', 'SKILL.md'), 'utf8'), /newer local take/);
    assert.match(await fs.readFile(path.join(store, 'alpha', 'local-only.txt'), 'utf8'), /mine/,
      'overwrite must replace wholesale with the annexed content');
    assert.equal(await fs.readlink(path.join(claudeSkills, 'alpha')), path.join('..', '..', '.agents', 'skills', 'alpha'));
    assert.deepEqual(Object.keys(JSON.parse(await fs.readFile(sourcesFile, 'utf8')).installations), [],
      'the overwritten original must lose its source record');
    const trashedBodies = await Promise.all((await trashEntries(home)).map(async (entry) => {
      const st = await fs.stat(path.join(home, '.fanbox-test-trash', entry));
      assert.ok(st.isDirectory(), 'trash slots must hold the replaced directories');
      return fs.readFile(path.join(home, '.fanbox-test-trash', entry, 'SKILL.md'), 'utf8');
    }));
    assert.equal(trashedBodies.length, 2, 'old original + replaced real directory must both be recoverable');
    assert.ok(trashedBodies.some((body) => /got here first/.test(body)), 'the old original must be in the trash');
    assert.ok(trashedBodies.some((body) => /newer local take/.test(body)), 'the replaced source must be in the trash');

    // 内容一致时不再换位：来源列照常改正规接入
    await createSkill(path.join(claudeSkills, 'twin'), 'twin', 'same content twin');
    await fs.mkdir(path.join(store, 'twin'), { recursive: true });
    await fs.copyFile(path.join(claudeSkills, 'twin', 'SKILL.md'), path.join(store, 'twin', 'SKILL.md'));
    const twin = await post('/api/skills/annex', { agent: 'claude', name: 'twin' });
    assert.equal(twin.body.ok, true, `identical annex failed: ${twin.body.error}`);
    assert.equal(twin.body.status, 'identical');
    assert.equal(await fs.readlink(path.join(claudeSkills, 'twin')), path.join('..', '..', '.agents', 'skills', 'twin'));
    assert.equal(await trashEntries(home).then((a) => a.length), 3,
      'only the replaced source directory is new in the trash — store content untouched');
  });
});

test('failures at each stage roll back without damaging the source or the existing original', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const store = path.join(home, '.agents', 'skills');
    const claudeSkills = path.join(home, '.claude', 'skills');
    await createSkill(path.join(store, 'one'), 'one', 'existing original one');

    // 各阶段注入都走「先预检拿指纹、再带覆盖意图执行」的完整路径
    async function attempt(failStage) {
      const ctx = await restartWithEnv(t, home, { FANBOX_TEST_SKILL_ANNEX_FAIL: failStage });
      try {
        const preview = await ctx.post('/api/skills/annex', { agent: 'claude', name: 'one', preview: true });
        assert.equal(preview.body.ok, true, `preview (${failStage}) failed: ${preview.body.error}`);
        return await ctx.post('/api/skills/annex', { agent: 'claude', name: 'one', overwrite: true,
          sourceFingerprint: preview.body.sourceFingerprint, conflictFingerprint: preview.body.conflictFingerprint });
      } finally {
        await ctx.close();
      }
    }

    // 阶段一：临时副本构建失败 → 无任何写入
    await createSkill(path.join(claudeSkills, 'one'), 'one', 'first source');
    const stageR = await attempt('stage');
    assert.equal(stageR.body.ok, false);
    assert.match(stageR.body.error || '', /测试注入|失败|failed/i);
    assert.match(await fs.readFile(path.join(store, 'one', 'SKILL.md'), 'utf8'), /existing original one/);
    assert.equal((await fs.readdir(store)).filter((n) => n.startsWith('.fanbox-')).length, 0, 'no staging leftovers');

    // 阶段二：换位失败 → 旧原件与来源都原样
    const swapR = await attempt('swap');
    assert.equal(swapR.body.ok, false);
    assert.match(await fs.readFile(path.join(store, 'one', 'SKILL.md'), 'utf8'), /existing original one/);
    assert.equal((await fs.lstat(path.join(claudeSkills, 'one'))).isDirectory(), true, 'source must stay a real directory');
    assert.equal((await fs.readdir(store)).filter((n) => n.startsWith('.fanbox-')).length, 0);

    // 阶段三：来源列替换失败 → 新原件撤下、旧原件还原、真实目录还原
    const convertR = await attempt('convert');
    assert.equal(convertR.body.ok, false);
    assert.match(await fs.readFile(path.join(store, 'one', 'SKILL.md'), 'utf8'), /existing original one/,
      'the old original must be back in place');
    assert.equal((await fs.lstat(path.join(claudeSkills, 'one'))).isDirectory(), true,
      'the source must be back as a real directory');
    assert.equal((await fs.readdir(store)).filter((n) => n.startsWith('.fanbox-')).length, 0, 'no half-written originals');
    assert.equal((await fs.readdir(claudeSkills)).filter((n) => n.startsWith('.fanbox-')).length, 0);

    // 回滚后系统回到一致状态：残留仍在清单里，可再次收编成功
    const scan = await refreshRows(post);
    assert.ok(anomalyOf(scan, 'claude', 'one'), 'the residue must be reported again after rollback');
    const freshPreview = await post('/api/skills/annex', { agent: 'claude', name: 'one', preview: true });
    assert.equal(freshPreview.body.ok, true);
    const retry = await post('/api/skills/annex', { agent: 'claude', name: 'one', overwrite: true,
      sourceFingerprint: freshPreview.body.sourceFingerprint, conflictFingerprint: freshPreview.body.conflictFingerprint });
    assert.equal(retry.body.ok, true, `retry after rollback failed: ${retry.body.error}`);
    assert.match(await fs.readFile(path.join(store, 'one', 'SKILL.md'), 'utf8'), /first source/);
  });
});

// 失败注入要换进程环境：用同一份隔离 HOME 重启服务，断言跨阶段状态。
async function restartWithEnv(t, home, extraEnv) {
  const port = await freePortPair();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: REPO,
    env: { ...process.env, HOME: home, FANBOX_PORT: String(port), FANBOX_NO_OPEN: '1', NODE_ENV: 'test',
      FANBOX_TEST_SKILL_TRASH: path.join(home, '.fanbox-test-trash'), ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (d) => { logs += d; });
  child.stderr.on('data', (d) => { logs += d; });
  t.after(async () => { await stopChild(child); });
  await waitForServer(port, child, () => logs);
  const close = async () => stopChild(child);
  async function post(url, body) {
    const response = await fetch(`http://127.0.0.1:${port}${url}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `http://localhost:${port}` },
      body: JSON.stringify(body ?? {}),
    });
    return { status: response.status, body: await response.json() };
  }
  return { post, close };
}

test('sources outside the scanned list are refused without side effects', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const store = path.join(home, '.agents', 'skills');
    const claudeSkills = path.join(home, '.claude', 'skills');
    await createSkill(path.join(claudeSkills, 'ghost'));

    // 形状无效 → 400 invalid_request
    for (const bad of [
      {},
      { name: 'ghost' },
      { agent: 'claude' },
      { agent: 'terminal', name: 'ghost' },
      { agent: 'claude', name: '../escape' },
      { agent: 'claude', name: 'a/b' },
      { agent: 'claude', name: '' },
      { agent: 'claude', name: 'ghost', project: home },
      { agent: 'claude', name: 'ghost', overwrite: 'yes' },
      { agent: 'claude', name: 'ghost', overwrite: true },
      { agent: 'claude', name: 'ghost', conflictFingerprint: 'zz' },
      { project: '', name: 'x' },
      { project: home, name: 'ghost', overwrite: true },
    ]) {
      const response = await post('/api/skills/annex', bad);
      assert.equal(response.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
      assert.equal(response.body.ok, false);
      assert.equal(response.body.status, 'invalid_request');
    }

    // 名字不在最新扫描清单里（残留清单也没有）→ 结构化拒绝
    const unknown = await post('/api/skills/annex', { agent: 'claude', name: 'never-scanned' });
    assert.equal(unknown.body.ok, false);
    assert.equal(unknown.body.status, 'invalid_source');
    await assert.rejects(() => fs.lstat(path.join(store, 'never-scanned')), { code: 'ENOENT' });

    // 扫描后已消失的来源 → 拒绝
    const scan = await refreshRows(post);
    assert.ok(anomalyOf(scan, 'claude', 'ghost'), 'fixture sanity: ghost must be scanned');
    await fs.rm(path.join(claudeSkills, 'ghost'), { recursive: true, force: true });
    const gone = await post('/api/skills/annex', { agent: 'claude', name: 'ghost' });
    assert.equal(gone.body.ok, false);
    assert.equal(gone.body.status, 'invalid_source');

    // 残留项（缺有效 SKILL.md）不可收编
    await fs.mkdir(path.join(claudeSkills, 'hollow'), { recursive: true });
    const hollowScan = await refreshRows(post);
    assert.equal(hollowScan.items.find((it) => it.name === 'hollow' && it.residue), undefined);
    const hollowAnomaly = (hollowScan.anomalies || []).find((a) => a.agent === 'claude' && a.name === 'hollow');
    assert.ok(hollowAnomaly, 'a SKILL.md-less directory still shows up as a real-dir anomaly');
    const hollow = await post('/api/skills/annex', { agent: 'claude', name: 'hollow' });
    assert.equal(hollow.body.ok, false);
    assert.equal(hollow.body.status, 'not_a_skill');
    await assert.rejects(() => fs.lstat(path.join(store, 'hollow')), { code: 'ENOENT' });

    // 外部软链不是收编对象（外部原件由其所有者管理）
    await createSkill(path.join(claudeSkills, 'aliased'));
    await createSkill(path.join(store, 'aliased'), 'aliased', 'already an original');
    const aliased = await post('/api/skills/annex', { agent: 'claude', name: 'aliased' });
    assert.equal(aliased.body.ok, false);
    assert.equal(aliased.body.status, 'content_conflict', 'a co-existing store entry goes through the conflict protocol');

    // 项目级：root 对不上扫描清单 → 拒绝；插件来源明确拒之门外
    const project = path.join(home, 'work', 'demo-project');
    await createSkill(path.join(project, '.claude', 'skills', 'proj-skill'));
    await post('/api/skills/refresh', { v: 2, cwd: project });
    const wrongRoot = await post('/api/skills/annex', { project: path.join(home, 'elsewhere'), name: 'proj-skill' });
    assert.equal(wrongRoot.body.ok, false);
    assert.equal(wrongRoot.body.status, 'invalid_source');
    const pluginRoot = path.join(home, 'plugin-install');
    await createSkill(path.join(pluginRoot, 'skills', 'plug-skill'));
    await fs.mkdir(path.join(home, '.claude', 'plugins'), { recursive: true });
    await fs.writeFile(path.join(home, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({ plugins: { 'fixture@local': [{ installPath: pluginRoot }] } }), 'utf8');
    await post('/api/skills/refresh', { v: 2, cwd: project });
    const plugin = await post('/api/skills/annex', { project: pluginRoot, name: 'plug-skill' });
    assert.equal(plugin.body.ok, false);
    assert.equal(plugin.body.status, 'invalid_source');
    await assert.rejects(() => fs.lstat(path.join(store, 'plug-skill')), { code: 'ENOENT' });
  });
});

test('concurrent annex and link writes serialize through the queue without half-written state', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const store = path.join(home, '.agents', 'skills');
    const claudeSkills = path.join(home, '.claude', 'skills');
    const wbSkills = path.join(home, '.workbuddy', 'skills');
    // 三份 Claude 残留 + 一份无行的 WorkBuddy 拷贝 + 两个既有原件行
    for (const name of ['p1', 'p2', 'p3']) {
      await createSkill(path.join(claudeSkills, name), name, `${name} residue`);
      await createSkill(path.join(wbSkills, name), name, `${name} wb twin`);
    }
    await createSkill(path.join(wbSkills, 'q1'), 'q1', 'wb only copy');
    await createSkill(path.join(store, 'base1'));
    await createSkill(path.join(store, 'base2'));

    // 混合并发：四路收编 + 两路对既有原件的启停，全部进同一写队列。
    // 注意模型语义：claude 收建先建行后，同名 WB 拷贝就只是「列接入」而非残留——
    // 所以 WB 列并发对象用独立的 q1。
    const requests = [
      ...['p1', 'p2', 'p3'].map((name) => ({ url: '/api/skills/annex', body: { agent: 'claude', name } })),
      { url: '/api/skills/annex', body: { agent: 'workbuddy', name: 'q1' } },
      { url: '/api/skills/link', body: { name: 'base1', agent: 'codex', on: false } },
      { url: '/api/skills/link', body: { name: 'base2', agent: 'zcode', on: false } },
    ];
    const results = await Promise.all(requests.map((r) => post(r.url, r.body)));
    results.forEach((r, i) => {
      assert.equal(r.status, 200, `request ${i} errored`);
      assert.equal(r.body.ok, true, `request ${i} (${JSON.stringify(requests[i])}) failed: ${r.body.error}`);
    });

    const scan = await refreshRows(post);
    for (const name of ['p1', 'p2', 'p3']) {
      const row = scan.items.find((it) => it.name === name);
      assert.ok(row, `${name} must have been annexed`);
      assert.equal(row.agents.claude.on, true, `${name} claude column must be lit by the annex conversion`);
      assert.equal(row.agents.workbuddy.on, true, `${name} wb copy must count as linked`);
      assert.equal(row.agents.codex.on, true);
      assert.equal(row.agents.zcode.on, true);
      assert.equal((await fs.lstat(path.join(claudeSkills, name))).isSymbolicLink(), true);
      assert.ok(await fs.stat(path.join(wbSkills, name, 'SKILL.md')));
    }
    const q1 = scan.items.find((it) => it.name === 'q1');
    assert.ok(q1, 'q1 must have been annexed from the wb copy');
    assert.equal(q1.agents.workbuddy.on, true);
    assert.equal(q1.agents.claude.on, false);
    assert.equal(scan.items.find((it) => it.name === 'base1').agents.codex.on, false);
    assert.equal(scan.items.find((it) => it.name === 'base2').agents.zcode.on, false);
    assert.equal((await fs.readdir(store)).filter((n) => n.startsWith('.fanbox-')).length, 0, 'no staging leftovers');
    assert.equal((await fs.readdir(claudeSkills)).filter((n) => n.startsWith('.fanbox-')).length, 0);
    assert.equal(anomalyOf(scan, 'claude', 'p1'), undefined);
    assert.equal(anomalyOf(scan, 'workbuddy', 'q1'), undefined);
  });
});
