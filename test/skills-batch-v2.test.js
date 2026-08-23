'use strict';

// /api/skills/batch v2（issue 23 · docs/16 §3）集成测试：{names[], agent, on, scope} 行选择
// 与整列批量（scope 只区分来源，机械相同）；{names[], action:'uninstall'} 两级卸载——
// 自管原件 = 先取消全部接入再进系统废纸篓，外部/仓库原件只取消接入、绝不删内容。
// 每对象独立结果，失败不影响其余对象。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const REPO_SKILLS = path.join(REPO, '.agents', 'skills');

// 仓库家族原件在检出工作树里未必存在：就地补一个临时原件，测试结束只清掉自己创建的部分。
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
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'fanbox-skills-batch-home-'));
  const port = await freePortPair();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: REPO,
    // 卸载走 trashImportedSkill：测试里把「废纸篓」指到隔离目录，断言可恢复性
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

function statuses(body) {
  return body.results.map(({ name, status }) => ({ name, status }));
}

test('rows scope links and unlinks a column for every selected name independently', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const store = path.join(home, '.agents', 'skills');
    const claudeSkills = path.join(home, '.claude', 'skills');
    for (const name of ['alpha', 'beta', 'gamma']) await createSkill(path.join(store, name));

    const on = await post('/api/skills/batch', { names: ['alpha', 'beta', 'gamma'], agent: 'claude', on: true, scope: 'rows' });
    assert.equal(on.status, 200);
    assert.equal(on.body.ok, true);
    assert.equal(on.body.action, 'link');
    assert.equal(on.body.scope, 'rows');
    assert.equal(on.body.agent, 'claude');
    assert.equal(on.body.on, true);
    assert.deepEqual(statuses(on.body), [
      { name: 'alpha', status: 'success' },
      { name: 'beta', status: 'success' },
      { name: 'gamma', status: 'success' },
    ]);
    assert.deepEqual(on.body.summary, { success: 3, noop: 0, unlinked: 0, failed: 0, total: 3 });
    for (const name of ['alpha', 'beta', 'gamma']) {
      const linkPath = path.join(claudeSkills, name);
      assert.equal((await fs.lstat(linkPath)).isSymbolicLink(), true, `${name} must be linked`);
      assert.equal(await fs.readlink(linkPath), path.join('..', '..', '.agents', 'skills', name));
    }
    let rows = await refreshRows(post);
    for (const name of ['alpha', 'beta', 'gamma']) assert.equal(rows.get(name).agents.claude.on, true);

    // 已是目标状态 → noop；重复名去重后只执行一次
    const again = await post('/api/skills/batch', { names: ['alpha', 'alpha', 'beta'], agent: 'claude', on: true, scope: 'rows' });
    assert.equal(again.body.ok, true);
    assert.deepEqual(statuses(again.body), [{ name: 'alpha', status: 'noop' }, { name: 'beta', status: 'noop' }]);
    assert.equal(again.body.summary.total, 2);

    const off = await post('/api/skills/batch', { names: ['alpha', 'gamma'], agent: 'claude', on: false, scope: 'rows' });
    assert.equal(off.body.ok, true);
    assert.deepEqual(statuses(off.body), [{ name: 'alpha', status: 'success' }, { name: 'gamma', status: 'success' }]);
    await assert.rejects(() => fs.lstat(path.join(claudeSkills, 'alpha')), { code: 'ENOENT' });
    await assert.rejects(() => fs.lstat(path.join(claudeSkills, 'gamma')), { code: 'ENOENT' });
    assert.equal((await fs.lstat(path.join(claudeSkills, 'beta'))).isSymbolicLink(), true, 'beta must stay linked');
    rows = await refreshRows(post);
    assert.equal(rows.get('alpha').agents.claude.on, false);
    assert.equal(rows.get('beta').agents.claude.on, true);
  });
});

test('column scope shares the machinery and echoes the provenance', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const store = path.join(home, '.agents', 'skills');
    const wbRoot = path.join(home, '.workbuddy', 'skills');
    for (const name of ['alpha', 'beta']) await createSkill(path.join(store, name));

    // 整列取消接入 Codex：config.toml 落 enabled=false 选择器，响应带重启代价
    const off = await post('/api/skills/batch', { names: ['alpha', 'beta'], agent: 'codex', on: false, scope: 'column' });
    assert.equal(off.status, 200);
    assert.equal(off.body.ok, true);
    assert.equal(off.body.scope, 'column');
    assert.deepEqual(statuses(off.body), [{ name: 'alpha', status: 'success' }, { name: 'beta', status: 'success' }]);
    assert.deepEqual(off.body.restartRequired, ['codex']);
    const config = await fs.readFile(path.join(home, '.codex', 'config.toml'), 'utf8');
    for (const name of ['alpha', 'beta']) {
      assert.match(config, new RegExp(`path = "[^"]*${name}/SKILL\\.md"\\s*\\nenabled = false`));
    }
    let rows = await refreshRows(post);
    assert.equal(rows.get('alpha').agents.codex.on, false);
    assert.equal(rows.get('beta').agents.codex.on, false);

    // 整列接入 WorkBuddy：拷入 skills/
    const wb = await post('/api/skills/batch', { names: ['alpha', 'beta'], agent: 'workbuddy', on: true, scope: 'column' });
    assert.equal(wb.body.ok, true);
    assert.deepEqual(statuses(wb.body), [{ name: 'alpha', status: 'success' }, { name: 'beta', status: 'success' }]);
    for (const name of ['alpha', 'beta']) {
      assert.ok(await fs.stat(path.join(wbRoot, name, 'SKILL.md')), `${name} copy must exist`);
    }
    rows = await refreshRows(post);
    assert.equal(rows.get('alpha').agents.workbuddy.on, true);

    // 整列取消接入 WorkBuddy：拷贝移入同级 skills_disabled
    const wbOff = await post('/api/skills/batch', { names: ['alpha'], agent: 'workbuddy', on: false, scope: 'column' });
    assert.equal(wbOff.body.ok, true);
    await assert.rejects(() => fs.lstat(path.join(wbRoot, 'alpha')), { code: 'ENOENT' });
    assert.ok(await fs.stat(path.join(home, '.workbuddy', 'skills_disabled', 'alpha', 'SKILL.md')));
  });
});

test('zcode batch toggles config switches and reports restarts only when something changed', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const store = path.join(home, '.agents', 'skills');
    await createSkill(path.join(store, 'alpha'));
    await createSkill(path.join(store, 'beta'));

    // ZCode 缺省即启用：初始 on 全是 noop，批量不带重启代价
    const on0 = await post('/api/skills/batch', { names: ['alpha', 'beta'], agent: 'zcode', on: true, scope: 'rows' });
    assert.equal(on0.body.ok, true);
    assert.deepEqual(statuses(on0.body), [{ name: 'alpha', status: 'noop' }, { name: 'beta', status: 'noop' }]);
    assert.deepEqual(on0.body.restartRequired, []);

    const off = await post('/api/skills/batch', { names: ['alpha', 'beta'], agent: 'zcode', on: false, scope: 'rows' });
    assert.equal(off.body.ok, true);
    assert.deepEqual(statuses(off.body), [{ name: 'alpha', status: 'success' }, { name: 'beta', status: 'success' }]);
    const cfg = JSON.parse(await fs.readFile(path.join(home, '.zcode', 'cli', 'config.json'), 'utf8'));
    assert.deepEqual(cfg.skills[path.join(store, 'alpha')], { enable: false });
    assert.deepEqual(cfg.skills[path.join(store, 'beta')], { enable: false });

    const on = await post('/api/skills/batch', { names: ['alpha'], agent: 'zcode', on: true, scope: 'rows' });
    assert.equal(on.body.ok, true);
    assert.deepEqual(statuses(on.body), [{ name: 'alpha', status: 'success' }]);
    const cfg2 = JSON.parse(await fs.readFile(path.join(home, '.zcode', 'cli', 'config.json'), 'utf8'));
    assert.deepEqual(cfg2.skills[path.join(store, 'alpha')], { enable: true });
  });
});

test('one occupied row fails alone with a structured conflict while the rest succeed', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const store = path.join(home, '.agents', 'skills');
    const claudeSkills = path.join(home, '.claude', 'skills');
    await createSkill(path.join(store, 'alpha'));
    await createSkill(path.join(store, 'gamma'));
    // gamma 的 Claude 目标位被一份真实目录占住
    await createSkill(path.join(claudeSkills, 'gamma'), 'gamma', 'a real directory got here first');

    const response = await post('/api/skills/batch', { names: ['alpha', 'gamma'], agent: 'claude', on: true, scope: 'rows' });
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.deepEqual(statuses(response.body), [{ name: 'alpha', status: 'success' }, { name: 'gamma', status: 'failed' }]);
    assert.deepEqual(response.body.results[1].conflict, { kind: 'occupied', path: path.join(claudeSkills, 'gamma') });
    assert.equal(response.body.summary.failed, 1);
    // 成功者照常落链；占用实体原样保留
    assert.equal((await fs.lstat(path.join(claudeSkills, 'alpha'))).isSymbolicLink(), true);
    assert.match(await fs.readFile(path.join(claudeSkills, 'gamma', 'SKILL.md'), 'utf8'), /got here first/);
  });
});

test('uninstall of a store original cancels every column first and trashes the original', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const store = path.join(home, '.agents', 'skills');
    const claudeSkills = path.join(home, '.claude', 'skills');
    const wbRoot = path.join(home, '.workbuddy', 'skills');
    const alphaDir = path.join(store, 'alpha');
    await createSkill(alphaDir);
    await createSkill(path.join(store, 'keeper'));

    // 四列全亮后再卸载
    for (const agent of ['claude', 'workbuddy']) {
      const r = await post('/api/skills/link', { name: 'alpha', agent, on: true });
      assert.equal(r.body.ok, true, JSON.stringify(r.body));
    }
    for (const agent of ['codex', 'zcode']) {
      const r = await post('/api/skills/link', { name: 'alpha', agent, on: false });
      assert.equal(r.body.ok, true, JSON.stringify(r.body));
    }

    const response = await post('/api/skills/batch', { names: ['alpha'], action: 'uninstall' });
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.action, 'uninstall');
    assert.deepEqual(statuses(response.body), [{ name: 'alpha', status: 'success' }]);
    // 全部接入已取消：链删、拷贝挪走、配置翻禁用
    await assert.rejects(() => fs.lstat(path.join(claudeSkills, 'alpha')), { code: 'ENOENT' });
    await assert.rejects(() => fs.lstat(path.join(wbRoot, 'alpha')), { code: 'ENOENT' });
    assert.ok(await fs.stat(path.join(home, '.workbuddy', 'skills_disabled', 'alpha', 'SKILL.md')), 'copy parked in skills_disabled');
    const codexConfig = await fs.readFile(path.join(home, '.codex', 'config.toml'), 'utf8');
    assert.match(codexConfig, /alpha\/SKILL\.md"\s*\nenabled = false/);
    const zcodeConfig = JSON.parse(await fs.readFile(path.join(home, '.zcode', 'cli', 'config.json'), 'utf8'));
    assert.deepEqual(zcodeConfig.skills[alphaDir], { enable: false });
    // 原件进了系统废纸篓（测试指到隔离目录），可恢复
    await assert.rejects(() => fs.stat(alphaDir), { code: 'ENOENT' });
    const trashed = await fs.readdir(path.join(home, '.fanbox-test-trash'));
    const entry = trashed.find((n) => n.startsWith('alpha-'));
    assert.ok(entry, `alpha must be in the test trash: ${trashed}`);
    assert.match(await fs.readFile(path.join(home, '.fanbox-test-trash', entry, 'SKILL.md'), 'utf8'), /Test fixture for alpha/);
    // 行从扫描里消失；邻居不动
    const rows = await refreshRows(post);
    assert.equal(rows.has('alpha'), false);
    assert.ok(rows.has('keeper'));
  });
});

test('uninstall of an external original only unlinks and never touches external content', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const store = path.join(home, '.agents', 'skills');
    const claudeSkills = path.join(home, '.claude', 'skills');
    // 外部原件：外部工具自管目录 + 原件仓放链
    const externalDir = path.join(home, '.local', 'share', 'ego', 'ego-skill');
    await createSkill(externalDir, 'ego-skill', 'managed by an external tool');
    await fs.mkdir(store, { recursive: true });
    await fs.symlink(externalDir, path.join(store, 'ego-skill'));

    const lit = await post('/api/skills/link', { name: 'ego-skill', agent: 'claude', on: true });
    assert.equal(lit.body.ok, true, JSON.stringify(lit.body));
    let rows = await refreshRows(post);
    assert.equal(rows.get('ego-skill').origin, 'external');
    assert.equal(rows.get('ego-skill').agents.claude.on, true);

    const response = await post('/api/skills/batch', { names: ['ego-skill'], action: 'uninstall' });
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.deepEqual(statuses(response.body), [{ name: 'ego-skill', status: 'unlinked' }]);
    assert.match(response.body.results[0].note, /外部原件只取消接入/);
    assert.equal(response.body.summary.unlinked, 1);
    // 接入取消、外部内容原样、废纸篓为空
    await assert.rejects(() => fs.lstat(path.join(claudeSkills, 'ego-skill')), { code: 'ENOENT' });
    assert.match(await fs.readFile(path.join(externalDir, 'SKILL.md'), 'utf8'), /managed by an external tool/);
    assert.deepEqual(await fs.readdir(path.join(home, '.fanbox-test-trash')).catch(() => []), []);
    // 行还在（纯库存形态），来源身份不变
    rows = await refreshRows(post);
    assert.equal(rows.get('ego-skill').origin, 'external');
    assert.equal(rows.get('ego-skill').agents.claude.on, false);
  });
});

test('uninstall of a repo original only unlinks; git stays the source of truth', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const store = path.join(home, '.agents', 'skills');
    const claudeSkills = path.join(home, '.claude', 'skills');
    const wbRoot = path.join(home, '.workbuddy', 'skills');
    await withRepoFixture('batch-v2-repo-fixture', async (repoDir) => {
      await fs.mkdir(store, { recursive: true });
      await fs.symlink(repoDir, path.join(store, 'batch-v2-repo-fixture'));
      for (const agent of ['claude', 'workbuddy']) {
        const r = await post('/api/skills/link', { name: 'batch-v2-repo-fixture', agent, on: true });
        assert.equal(r.body.ok, true, JSON.stringify(r.body));
      }
      let rows = await refreshRows(post);
      assert.equal(rows.get('batch-v2-repo-fixture').origin, 'repo');

      const response = await post('/api/skills/batch', { names: ['batch-v2-repo-fixture'], action: 'uninstall' });
      assert.equal(response.body.ok, true);
      assert.deepEqual(statuses(response.body), [{ name: 'batch-v2-repo-fixture', status: 'unlinked' }]);
      assert.match(response.body.results[0].note, /仓库家族原件由 git 管理/);
      // 链与拷贝取消，仓库内容与原件仓转指链原样，废纸篓为空
      await assert.rejects(() => fs.lstat(path.join(claudeSkills, 'batch-v2-repo-fixture')), { code: 'ENOENT' });
      await assert.rejects(() => fs.lstat(path.join(wbRoot, 'batch-v2-repo-fixture')), { code: 'ENOENT' });
      assert.match(await fs.readFile(path.join(repoDir, 'SKILL.md'), 'utf8'), /repo family fixture/);
      assert.equal((await fs.lstat(path.join(store, 'batch-v2-repo-fixture'))).isSymbolicLink(), true);
      assert.deepEqual(await fs.readdir(path.join(home, '.fanbox-test-trash')).catch(() => []), []);
      rows = await refreshRows(post);
      assert.equal(rows.get('batch-v2-repo-fixture').origin, 'repo');
      assert.equal(rows.get('batch-v2-repo-fixture').agents.claude.on, false);
    });
  });
});

test('uninstall keeps going when one name fails, and rejects unknown or non-matrix names', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const store = path.join(home, '.agents', 'skills');
    await createSkill(path.join(store, 'alpha'));
    await createSkill(path.join(store, 'gamma'));
    // gamma 的 WorkBuddy 活动位被一条外部软链占住：refresh 视为已接入（拷贝在），
    // 但取消接入只接受真实目录拷贝 → occupied 冲突 → 卸载必须停在动原件之前
    const foreignDir = path.join(home, '.local', 'share', 'foreign-copy');
    await createSkill(foreignDir, 'gamma', 'a foreign symlink got here first');
    await fs.mkdir(path.join(home, '.workbuddy', 'skills'), { recursive: true });
    await fs.symlink(foreignDir, path.join(home, '.workbuddy', 'skills', 'gamma'));
    const rows0 = await refreshRows(post);
    assert.equal(rows0.get('gamma').agents.workbuddy.on, true);

    const response = await post('/api/skills/batch', { names: ['alpha', 'nope', 'gamma'], action: 'uninstall' });
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.deepEqual(statuses(response.body), [
      { name: 'alpha', status: 'success' },
      { name: 'nope', status: 'failed' },
      { name: 'gamma', status: 'failed' },
    ]);
    assert.match(response.body.results[1].error, /清单/);
    assert.deepEqual(response.body.results[2].conflict, { kind: 'occupied', path: path.join(home, '.workbuddy', 'skills', 'gamma') });
    // gamma 的占用软链原样，原件没进废纸篓（只有 alpha 进了）
    assert.equal(await fs.readlink(path.join(home, '.workbuddy', 'skills', 'gamma')), foreignDir);
    assert.ok(await fs.stat(path.join(store, 'gamma', 'SKILL.md')), 'gamma original must survive a failed uninstall');
    const trashed = await fs.readdir(path.join(home, '.fanbox-test-trash'));
    assert.equal(trashed.filter((n) => n.startsWith('alpha-')).length, 1);
    assert.equal(trashed.filter((n) => n.startsWith('gamma-')).length, 0);

    // 项目级与插件行不在列模型里，不可批量
    const project = path.join(home, 'work', 'demo-project');
    await createSkill(path.join(project, '.claude', 'skills', 'proj-skill'));
    const proj = await post('/api/skills/batch', { names: ['proj-skill'], agent: 'claude', on: true, scope: 'rows' });
    assert.equal(proj.status, 200);
    assert.deepEqual(statuses(proj.body), [{ name: 'proj-skill', status: 'failed' }]);
  });
});

test('invalid request shapes reject the whole request without side effects', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const store = path.join(home, '.agents', 'skills');
    await createSkill(path.join(store, 'alpha'));

    for (const bad of [
      {},
      { names: [] },
      { names: 'alpha' },
      { names: ['a/b'] },
      { names: ['../escape'] },
      { names: ['.hidden'] },
      { names: [42] },
      { names: ['alpha'], agent: 'terminal', on: true, scope: 'rows' },
      { names: ['alpha'], agent: 'claude', on: 'yes', scope: 'rows' },
      { names: ['alpha'], agent: 'claude', scope: 'rows' },
      { names: ['alpha'], agent: 'claude', on: true },
      { names: ['alpha'], agent: 'claude', on: true, scope: 'everything' },
      { names: ['alpha'], action: 'remove' },
      { names: ['alpha'], action: 'uninstall', agent: 'claude' },
      { names: ['alpha'], action: 'uninstall', on: true },
      { names: ['alpha'], action: 'uninstall', scope: 'rows' },
    ]) {
      const response = await post('/api/skills/batch', bad);
      assert.equal(response.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
      assert.equal(response.body.ok, false);
      assert.equal(response.body.status, 'invalid_request');
      assert.ok(response.body.error.length > 0);
    }
    assert.equal(await fs.readdir(path.join(home, '.claude')).catch(() => null), null,
      'no claude dir may be created by rejected requests');
    assert.ok(await fs.stat(path.join(store, 'alpha', 'SKILL.md')), 'original must stay untouched');
  });
});
