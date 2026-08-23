'use strict';

// /api/skills/link 单一接入端点（docs/16 §3 + ADR 0005）集成测试。
// 隔离 HOME 下覆盖四列 × on/off × occupied 冲突 × 无效 name × 并发队列：
// Claude = 逐 skill 相对链 ../../.agents/skills/<name>；Codex = config.toml
// [[skills.config]] canonical SKILL.md 路径选择器（重启生效）；ZCode =
// config.json 按原件绝对路径 enable 开关；WorkBuddy = 拷入 skills / 移入 skills_disabled。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const REPO_SKILLS = path.join(REPO, '.agents', 'skills');

// 仓库家族原件在检出工作树里未必存在（机器本地的 .agents/skills 不入库）：
// 就地补一个临时原件，测试结束只清掉自己创建的部分。名字各文件错开避免并发互删。
async function withRepoFixture(name, fn) {
  const dir = path.join(REPO_SKILLS, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: repo family fixture\n---\nbody\n`, 'utf8');
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rmdir(REPO_SKILLS).catch(() => {});
    await fs.rmdir(path.dirname(REPO_SKILLS)).catch(() => {});
  }
}

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
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await exited;
}

async function withServer(t, fn) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'fanbox-skills-link-home-'));
  const port = await freePortPair();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: REPO,
    // 停用位旧拷贝走 trashImportedSkill：测试里把「废纸篓」指到隔离目录，断言可恢复性
    env: {
      ...process.env, HOME: home, FANBOX_PORT: String(port), FANBOX_NO_OPEN: '1',
      NODE_ENV: 'test', FANBOX_TEST_SKILL_TRASH: path.join(home, '.fanbox-test-trash'),
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

async function refreshRows(post) {
  const response = await post('/api/skills/refresh', { v: 2 });
  assert.equal(response.status, 200);
  return new Map(response.body.items.filter((it) => it.agents).map((it) => [it.name, it]));
}

test('claude column links and unlinks via relative symlinks into the store', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const store = path.join(home, '.agents', 'skills');
    const claudeSkills = path.join(home, '.claude', 'skills');
    await createSkill(path.join(store, 'alpha'));

    // 接入：建相对链，与 skills.sh / zcode 手写链同构
    const on = await post('/api/skills/link', { name: 'alpha', agent: 'claude', on: true });
    assert.equal(on.status, 200);
    assert.equal(on.body.ok, true);
    assert.equal(on.body.agent, 'claude');
    assert.equal(on.body.name, 'alpha');
    assert.equal(on.body.on, true);
    const linkPath = path.join(claudeSkills, 'alpha');
    const lst = await fs.lstat(linkPath);
    assert.equal(lst.isSymbolicLink(), true);
    assert.equal(await fs.readlink(linkPath), path.join('..', '..', '.agents', 'skills', 'alpha'),
      'link must be relative, pointing at the store entry');
    assert.equal(await fs.realpath(linkPath), await fs.realpath(path.join(store, 'alpha')));
    let rows = await refreshRows(post);
    assert.equal(rows.get('alpha').agents.claude.on, true);

    // 已是目标状态：noop 且不重建
    const again = await post('/api/skills/link', { name: 'alpha', agent: 'claude', on: true });
    assert.equal(again.body.ok, true);
    assert.equal(again.body.noop, true);
    assert.equal((await fs.lstat(linkPath)).isSymbolicLink(), true);

    // 取消接入：删链
    const off = await post('/api/skills/link', { name: 'alpha', agent: 'claude', on: false });
    assert.equal(off.status, 200);
    assert.equal(off.body.ok, true);
    await assert.rejects(() => fs.lstat(linkPath), { code: 'ENOENT' }, 'unlink must remove the link');
    rows = await refreshRows(post);
    assert.equal(rows.get('alpha').agents.claude.on, false);

    // 链本就不在：取消接入为 noop
    const offAgain = await post('/api/skills/link', { name: 'alpha', agent: 'claude', on: false });
    assert.equal(offAgain.body.ok, true);
    assert.equal(offAgain.body.noop, true);

    // 指错仓内条目的旧链：换指重建 / 删链都不误伤别的行
    await createSkill(path.join(store, 'second'));
    const mislinkPath = path.join(claudeSkills, 'second');
    await fs.symlink(path.join('..', '..', '.agents', 'skills', 'alpha'), mislinkPath);
    const relink = await post('/api/skills/link', { name: 'second', agent: 'claude', on: true });
    assert.equal(relink.body.ok, true, `mislink relink failed: ${relink.body.error}`);
    assert.equal(await fs.readlink(mislinkPath), path.join('..', '..', '.agents', 'skills', 'second'));
    assert.ok(await fs.stat(path.join(store, 'alpha', 'SKILL.md')),
      'the wrongly-pointed original must stay untouched');
    const misOff = await post('/api/skills/link', { name: 'second', agent: 'claude', on: false });
    assert.equal(misOff.body.ok, true, `mislink unlink failed: ${misOff.body.error}`);
    await assert.rejects(() => fs.lstat(mislinkPath), { code: 'ENOENT' });

    // repo 家族原件：链接仍指向原件仓条目，而非仓库深处的真实目录
    await withRepoFixture('link-repo-fixture', async (repoDir) => {
      await fs.symlink(repoDir, path.join(store, 'link-repo-fixture'));
      const repoOn = await post('/api/skills/link', { name: 'link-repo-fixture', agent: 'claude', on: true });
      assert.equal(repoOn.body.ok, true);
      assert.equal(await fs.readlink(path.join(claudeSkills, 'link-repo-fixture')),
        path.join('..', '..', '.agents', 'skills', 'link-repo-fixture'));
      rows = await refreshRows(post);
      assert.equal(rows.get('link-repo-fixture').agents.claude.on, true);
    });
  });
});

test('claude link refuses occupied targets without side effects', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const store = path.join(home, '.agents', 'skills');
    const claudeSkills = path.join(home, '.claude', 'skills');
    await createSkill(path.join(store, 'alpha'));
    await createSkill(path.join(claudeSkills, 'alpha'), 'alpha', 'a real directory got here first');

    const response = await post('/api/skills/link', { name: 'alpha', agent: 'claude', on: true });
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, false);
    assert.deepEqual(response.body.conflict, { kind: 'occupied', path: path.join(claudeSkills, 'alpha') });
    // 无副作用：真实目录原样保留
    const sm = await fs.readFile(path.join(claudeSkills, 'alpha', 'SKILL.md'), 'utf8');
    assert.match(sm, /a real directory got here first/);

    // 外部软链同样算占用，不能被静默替换
    await fs.symlink(path.join('..', '..', '.local', 'share', 'ego', 'ego-skill'), path.join(claudeSkills, 'beta'));
    await createSkill(path.join(store, 'beta'));
    const foreign = await post('/api/skills/link', { name: 'beta', agent: 'claude', on: true });
    assert.equal(foreign.body.ok, false);
    assert.equal(foreign.body.conflict.kind, 'occupied');
    assert.equal(await fs.readlink(path.join(claudeSkills, 'beta')),
      path.join('..', '..', '.local', 'share', 'ego', 'ego-skill'), 'foreign link must stay untouched');

    // 取消接入也不能吞掉占用实体
    const offOccupied = await post('/api/skills/link', { name: 'alpha', agent: 'claude', on: false });
    assert.equal(offOccupied.body.ok, false);
    assert.equal(offOccupied.body.conflict.kind, 'occupied');
    assert.ok(await fs.stat(path.join(claudeSkills, 'alpha', 'SKILL.md')), 'real dir must survive unlink request');
  });
});

test('codex column toggles through config.toml entries and reports the restart cost', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const store = path.join(home, '.agents', 'skills');
    const codexConfig = path.join(home, '.codex', 'config.toml');
    await createSkill(path.join(store, 'alpha'));
    await createSkill(path.join(store, 'beta'));
    await fs.mkdir(path.join(home, '.codex'), { recursive: true });
    await fs.writeFile(codexConfig, 'model = "gpt-test"\n\n[[skills.config]]\npath = '
      + JSON.stringify(path.join(store, 'beta', 'SKILL.md')) + '\nenabled = false\n', 'utf8');

    // 缺省即接入：on 是 noop，不动配置文件
    const before = await fs.readFile(codexConfig, 'utf8');
    const on = await post('/api/skills/link', { name: 'alpha', agent: 'codex', on: true });
    assert.equal(on.status, 200);
    assert.equal(on.body.ok, true);
    assert.equal(on.body.agent, 'codex');
    assert.equal(on.body.noop, true);
    assert.match(String(on.body.note), /重启 Codex/);
    assert.equal(await fs.readFile(codexConfig, 'utf8'), before);

    // 取消接入：追加 enabled=false 的 canonical SKILL.md 条目
    const off = await post('/api/skills/link', { name: 'alpha', agent: 'codex', on: false });
    assert.equal(off.body.ok, true);
    let text = await fs.readFile(codexConfig, 'utf8');
    assert.match(text, /\[\[skills\.config\]\]\s*\npath\s*=\s*"[^"]*alpha\/SKILL\.md"\s*\nenabled\s*=\s*false/);
    assert.match(text, /model = "gpt-test"/, 'existing config must be preserved');
    let rows = await refreshRows(post);
    assert.equal(rows.get('alpha').agents.codex.on, false);
    assert.equal(rows.get('beta').agents.codex.on, false);

    // 再接入：条目翻回 enabled=true
    const onAgain = await post('/api/skills/link', { name: 'alpha', agent: 'codex', on: true });
    assert.equal(onAgain.body.ok, true);
    assert.equal(onAgain.body.noop, undefined);
    text = await fs.readFile(codexConfig, 'utf8');
    assert.doesNotMatch(text, new RegExp(`"${path.join(store, 'alpha', 'SKILL.md').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*\\nenabled\\s*=\\s*false`));
    const block = text.split('[[skills.config]]').find((part) => part.includes(path.join(store, 'alpha', 'SKILL.md')));
    assert.match(block, /enabled\s*=\s*true/);
    rows = await refreshRows(post);
    assert.equal(rows.get('alpha').agents.codex.on, true);

    // 配置文件不存在时取消接入也能建出配置
    await fs.rm(path.join(home, '.codex'), { recursive: true, force: true });
    const offFresh = await post('/api/skills/link', { name: 'beta', agent: 'codex', on: false });
    assert.equal(offFresh.body.ok, true);
    text = await fs.readFile(codexConfig, 'utf8');
    assert.match(text, new RegExp(`"${path.join(store, 'beta', 'SKILL.md').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*\\nenabled\\s*=\\s*false`));
  });
});

test('zcode column toggles the enable switch keyed by the absolute original path', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const store = path.join(home, '.agents', 'skills');
    const zcodeConfig = path.join(home, '.zcode', 'cli', 'config.json');
    await createSkill(path.join(store, 'alpha'));
    await fs.mkdir(path.join(home, '.zcode', 'cli'), { recursive: true });
    await fs.writeFile(zcodeConfig, JSON.stringify({ plugins: { enabledPlugins: {} } }), 'utf8');

    // 缺省即启用：on 为 noop
    const beforeText = await fs.readFile(zcodeConfig, 'utf8');
    const on = await post('/api/skills/link', { name: 'alpha', agent: 'zcode', on: true });
    assert.equal(on.body.ok, true);
    assert.equal(on.body.noop, true);
    assert.equal(await fs.readFile(zcodeConfig, 'utf8'), beforeText);

    // 取消接入：enable:false，其余段落保留
    const off = await post('/api/skills/link', { name: 'alpha', agent: 'zcode', on: false });
    assert.equal(off.body.ok, true);
    let cfg = JSON.parse(await fs.readFile(zcodeConfig, 'utf8'));
    assert.deepEqual(cfg.skills[path.join(store, 'alpha')], { enable: false });
    assert.deepEqual(cfg.plugins, { enabledPlugins: {} });
    let rows = await refreshRows(post);
    assert.equal(rows.get('alpha').agents.zcode.on, false);

    // 再接入：enable 翻回 true
    const onAgain = await post('/api/skills/link', { name: 'alpha', agent: 'zcode', on: true });
    assert.equal(onAgain.body.ok, true);
    cfg = JSON.parse(await fs.readFile(zcodeConfig, 'utf8'));
    assert.deepEqual(cfg.skills[path.join(store, 'alpha')], { enable: true });
    rows = await refreshRows(post);
    assert.equal(rows.get('alpha').agents.zcode.on, true);

    // 配置不存在时也能落盘
    await fs.rm(path.join(home, '.zcode'), { recursive: true, force: true });
    const offFresh = await post('/api/skills/link', { name: 'alpha', agent: 'zcode', on: false });
    assert.equal(offFresh.body.ok, true);
    cfg = JSON.parse(await fs.readFile(zcodeConfig, 'utf8'));
    assert.deepEqual(cfg.skills[path.join(store, 'alpha')], { enable: false });
  });
});

test('workbuddy column copies in on link and moves to skills_disabled on unlink', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const store = path.join(home, '.agents', 'skills');
    const wbRoot = path.join(home, '.workbuddy', 'skills');
    const wbDisabled = path.join(home, '.workbuddy', 'skills_disabled');
    await createSkill(path.join(store, 'alpha'));
    await fs.writeFile(path.join(store, 'alpha', 'extra.txt'), 'payload\n', 'utf8');

    // 接入 = 拷入 skills/
    const on = await post('/api/skills/link', { name: 'alpha', agent: 'workbuddy', on: true });
    assert.equal(on.status, 200);
    assert.equal(on.body.ok, true);
    assert.equal(on.body.agent, 'workbuddy');
    assert.equal(await fs.readFile(path.join(wbRoot, 'alpha', 'extra.txt'), 'utf8'), 'payload\n');
    let rows = await refreshRows(post);
    assert.equal(rows.get('alpha').agents.workbuddy.on, true);
    assert.equal(rows.get('alpha').agents.workbuddy.drift, undefined);

    // 已有内容一致的拷贝：noop
    const again = await post('/api/skills/link', { name: 'alpha', agent: 'workbuddy', on: true });
    assert.equal(again.body.ok, true);
    assert.equal(again.body.noop, true);

    // 取消接入 = 移入同级 skills_disabled/
    const off = await post('/api/skills/link', { name: 'alpha', agent: 'workbuddy', on: false });
    assert.equal(off.body.ok, true);
    await assert.rejects(() => fs.lstat(path.join(wbRoot, 'alpha')), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(wbDisabled, 'alpha', 'SKILL.md'), 'utf8'),
      await fs.readFile(path.join(store, 'alpha', 'SKILL.md'), 'utf8'));
    rows = await refreshRows(post);
    assert.equal(rows.get('alpha').agents.workbuddy.on, false);

    // 再次接入 = 从原件重新拷入
    await fs.writeFile(path.join(store, 'alpha', 'SKILL.md'),
      '---\nname: alpha\ndescription: updated original\n---\nnew body\n', 'utf8');
    const on2 = await post('/api/skills/link', { name: 'alpha', agent: 'workbuddy', on: true });
    assert.equal(on2.body.ok, true);
    assert.equal(await fs.readFile(path.join(wbRoot, 'alpha', 'SKILL.md'), 'utf8'),
      '---\nname: alpha\ndescription: updated original\n---\nnew body\n');

    // 原件更新后拷贝落后 → 刷新由健康检查引导；再次取消照常把新拷贝挪进停用位
    const off2 = await post('/api/skills/link', { name: 'alpha', agent: 'workbuddy', on: false });
    assert.equal(off2.body.ok, true);
    await assert.rejects(() => fs.lstat(path.join(wbRoot, 'alpha')), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(wbDisabled, 'alpha', 'SKILL.md'), 'utf8'),
      '---\nname: alpha\ndescription: updated original\n---\nnew body\n',
      'the fresh copy must replace the stale parked one in skills_disabled');

    // 拷贝本就不在：取消接入为 noop
    const off3 = await post('/api/skills/link', { name: 'alpha', agent: 'workbuddy', on: false });
    assert.equal(off3.body.ok, true);
    assert.equal(off3.body.noop, true);
  });
});

test('workbuddy link reports occupied conflicts without touching either side', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const store = path.join(home, '.agents', 'skills');
    const wbRoot = path.join(home, '.workbuddy', 'skills');
    const wbDisabled = path.join(home, '.workbuddy', 'skills_disabled');
    await createSkill(path.join(store, 'alpha'), 'alpha', 'original copy');
    // 目标被一份内容不同的同名真实目录占用 → 冲突且双方都原样
    await createSkill(path.join(wbRoot, 'alpha'), 'alpha', 'an older diverged copy');

    const on = await post('/api/skills/link', { name: 'alpha', agent: 'workbuddy', on: true });
    assert.equal(on.status, 200);
    assert.equal(on.body.ok, false);
    assert.deepEqual(on.body.conflict, { kind: 'occupied', path: path.join(wbRoot, 'alpha') });
    assert.match(await fs.readFile(path.join(wbRoot, 'alpha', 'SKILL.md'), 'utf8'), /diverged copy/);
    assert.match(await fs.readFile(path.join(store, 'alpha', 'SKILL.md'), 'utf8'), /original copy/);

    // 停用位被上一轮循环的旧拷贝占着：旧拷贝先进废纸篓（可恢复），活动拷贝照常挪入
    await fs.mkdir(wbDisabled, { recursive: true });
    await createSkill(path.join(wbDisabled, 'alpha'), 'alpha', 'stale disabled leftover');
    const off = await post('/api/skills/link', { name: 'alpha', agent: 'workbuddy', on: false });
    assert.equal(off.body.ok, true);
    await assert.rejects(() => fs.lstat(path.join(wbRoot, 'alpha')), { code: 'ENOENT' }, 'active copy must move out');
    assert.match(await fs.readFile(path.join(wbDisabled, 'alpha', 'SKILL.md'), 'utf8'), /diverged copy/,
      'the slot now holds the copy that was active');
    const trashed = await fs.readdir(path.join(home, '.fanbox-test-trash'));
    assert.equal(trashed.length, 1);
    assert.match(await fs.readFile(path.join(home, '.fanbox-test-trash', trashed[0], 'SKILL.md'), 'utf8'),
      /stale disabled leftover/, 'the stale parked copy must be recoverable from the trash');
  });
});

test('link validates the request shape and rejects names outside the scanned list', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const store = path.join(home, '.agents', 'skills');
    await createSkill(path.join(store, 'alpha'));

    // 形状无效 → 400 invalid_request
    for (const bad of [
      { name: '../escape', agent: 'claude', on: true },
      { name: '', agent: 'claude', on: true },
      { name: 'a/b', agent: 'claude', on: true },
      { name: 'alpha', agent: 'terminal', on: true },
      { name: 'alpha', agent: 'claude', on: 'yes' },
      { name: 'alpha', agent: 'claude' },
      { agent: 'claude', on: true },
    ]) {
      const response = await post('/api/skills/link', bad);
      assert.equal(response.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
      assert.equal(response.body.ok, false);
      assert.equal(response.body.status, 'invalid_request');
    }
    assert.equal(await fs.readdir(path.join(home, '.claude')).catch(() => null), null,
      'no claude dir may be created by rejected requests');

    // 名字合法但不在扫描清单里 → 结构化失败
    const unknown = await post('/api/skills/link', { name: 'nope', agent: 'claude', on: true });
    assert.equal(unknown.status, 200);
    assert.equal(unknown.body.ok, false);
    assert.match(unknown.body.error, /清单/);

    // 项目级/插件行不在列模型里，不可接入
    const project = path.join(home, 'work', 'demo-project');
    await createSkill(path.join(project, '.claude', 'skills', 'proj-skill'));
    const projLink = await post('/api/skills/link', { name: 'proj-skill', agent: 'claude', on: true });
    assert.equal(projLink.body.ok, false);
  });
});

test('concurrent link writes serialize through the queue without half-written state', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const store = path.join(home, '.agents', 'skills');
    const wbRoot = path.join(home, '.workbuddy', 'skills');
    const claudeSkills = path.join(home, '.claude', 'skills');
    for (const name of ['alpha', 'beta', 'gamma']) await createSkill(path.join(store, name));

    const requests = [];
    for (const name of ['alpha', 'beta', 'gamma']) {
      requests.push({ name, agent: 'claude', on: true });
      requests.push({ name, agent: 'codex', on: false });
      requests.push({ name, agent: 'zcode', on: false });
      requests.push({ name, agent: 'workbuddy', on: true });
    }
    const results = await Promise.all(requests.map((body) => post('/api/skills/link', body)));
    for (let i = 0; i < results.length; i++) {
      assert.equal(results[i].status, 200, `request ${i} failed`);
      assert.equal(results[i].body.ok, true, `request ${JSON.stringify(requests[i])} failed: ${results[i].body.error}`);
    }

    // 终态逐一核对：三行四列全亮/全按请求落盘
    const rows = await refreshRows(post);
    for (const name of ['alpha', 'beta', 'gamma']) {
      assert.equal(rows.get(name).agents.claude.on, true);
      assert.equal(rows.get(name).agents.codex.on, false);
      assert.equal(rows.get(name).agents.zcode.on, false);
      assert.equal(rows.get(name).agents.workbuddy.on, true);
      assert.equal((await fs.lstat(path.join(claudeSkills, name))).isSymbolicLink(), true);
      assert.ok(await fs.stat(path.join(wbRoot, name, 'SKILL.md')));
    }
    // 无半成品：wb 根下不留临时拷贝目录
    const leftovers = (await fs.readdir(wbRoot)).filter((n) => n.startsWith('.fanbox-'));
    assert.deepEqual(leftovers, []);
  });
});
