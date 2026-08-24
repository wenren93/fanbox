'use strict';

// /api/skills/migrate/* 三端点集成测试（issue 28 · docs/16 §7–§9）。
// 隔离 HOME 下构造漂移 / 死环 / 死链场景全流程跑通：
// scan 漂移矩阵（最新 mtime 默认胜出）、snapshot 前后可见性 diff、
// execute 按 Phase 0–5 执行（原件仓只增 / Claude 拆链 / Codex 清理 /
// ZCode 删双链+按迁移前可见性批量写 enable / 验收报告）。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const REPO_SKILLS = path.join(REPO, '.agents', 'skills');

// 所有 fixture 统一前缀，避免与并行测试文件 / 本机真实 skill 互删。
const P = 'mig-t-';

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

async function withServer(t, { env = {}, fn }) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'fanbox-skills-migrate-home-'));
  const port = await freePortPair();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: REPO,
    env: {
      ...process.env, HOME: home, FANBOX_PORT: String(port), FANBOX_NO_OPEN: '1',
      NODE_ENV: 'test', FANBOX_TEST_SKILL_TRASH: path.join(home, '.fanbox-test-trash'),
      ...env,
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

// 迁移会向检出的仓库家族目录写入胜出版内容（git 提交留给用户）。测试只允许自己
// 前缀的 fixture 落进去：先清掉历史崩溃残留的 mig-t-* 目录，记录进入前的目录清单，
// 结束后删掉自己前缀的新增项并清理空目录。不碰其它测试文件的同仓 fixture。
async function withRepoGuard(fn) {
  await fs.mkdir(REPO_SKILLS, { recursive: true });
  for (const name of await fs.readdir(REPO_SKILLS)) {
    if (name.startsWith(P)) await fs.rm(path.join(REPO_SKILLS, name), { recursive: true, force: true }).catch(() => {});
  }
  const before = new Set(await fs.readdir(REPO_SKILLS));
  try {
    return await fn();
  } finally {
    for (const name of await fs.readdir(REPO_SKILLS)) {
      if (!before.has(name) && name.startsWith(P)) {
        await fs.rm(path.join(REPO_SKILLS, name), { recursive: true, force: true }).catch(() => {});
      }
    }
    await fs.rmdir(REPO_SKILLS).catch(() => {});
    await fs.rmdir(path.dirname(REPO_SKILLS)).catch(() => {});
  }
}

async function createSkill(dir, description = `fixture ${path.basename(dir)}`, body = 'body\n') {
  const name = path.basename(dir);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n${body}`, 'utf8');
  return dir;
}

// 用显式 mtime 驱动「最新 mtime 胜出」的默认裁决
async function touchSkill(dir, ms) {
  await fs.utimes(path.join(dir, 'SKILL.md'), ms / 1000, ms / 1000);
}

async function readText(file) {
  return fs.readFile(file, 'utf8');
}

test('migrate/scan 输出四仓 + cc-switch 备份的漂移矩阵、默认胜出与逐行 ops', async (t) => {
  await withRepoGuard(async () => {
    await withServer(t, { fn: async ({ home, post }) => {
    const store = path.join(home, '.agents', 'skills');
    const wb = path.join(home, '.workbuddy', 'skills');
    const codex = path.join(home, '.codex', 'skills');
    const ccswitch = path.join(home, '.cc-switch', 'skill-backups');
    const outside = path.join(home, '.local', 'share', 'ego', 'ego-skill');

    // 三份漂移：store 最旧、wb 最新、cc-switch 备份最旧
    await createSkill(path.join(store, `${P}alpha`), 'store version');
    await touchSkill(path.join(store, `${P}alpha`), 2000);
    await createSkill(path.join(wb, `${P}alpha`), 'workbuddy version');
    await touchSkill(path.join(wb, `${P}alpha`), 5000);
    await createSkill(path.join(ccswitch, `${P}alpha`), 'backup version');
    await touchSkill(path.join(ccswitch, `${P}alpha`), 1000);

    // 内容全等的多副本：identical 且无需 ops
    await createSkill(path.join(store, `${P}same`), 'identical everywhere');
    await createSkill(path.join(wb, `${P}same`), 'identical everywhere');

    // 单一来源
    await createSkill(path.join(wb, `${P}wbonly`), 'workbuddy exclusive');
    await createSkill(path.join(codex, `${P}cxreal`), 'codex real dir');
    await createSkill(path.join(ccswitch, `${P}oldbackup`), 'backup only');
    await fs.mkdir(path.join(codex, '.system'), { recursive: true });

    // 死环：一条与仓库家族同名（应换指仓库），一条孤儿（只能删除）
    await fs.mkdir(path.join(REPO_SKILLS, `${P}fam`), { recursive: true });
    await createSkill(path.join(REPO_SKILLS, `${P}fam`), 'repo family');
    await fs.symlink(path.join(store, `${P}fam`), path.join(store, `${P}fam`)); // 自引用死环
    await fs.symlink(path.join(store, `${P}orphan`), path.join(store, `${P}orphan`));

    // 断链（目标不存在）且无任何活内容
    await fs.symlink(path.join(home, '.cc-switch', 'skills', `${P}gone`), path.join(codex, `${P}cxdead`));

    // 外部链：识别标注、绝不进 ops
    await createSkill(outside, 'external skill');
    await fs.symlink(outside, path.join(store, `${P}ext`));

    // zcode 手写链（终态要删）
    await fs.mkdir(path.join(home, '.zcode', 'skills'), { recursive: true });
    await fs.symlink(path.join('..', '..', '.agents', 'skills', `${P}alpha`), path.join(home, '.zcode', 'skills', `${P}zlinked`));

    // claude 整目录链 → store（不产生独立候选）
    await fs.mkdir(path.join(home, '.claude'), { recursive: true });
    await fs.symlink(path.join('..', '.agents', 'skills'), path.join(home, '.claude', 'skills'));

    const res = await post('/api/skills/migrate/scan');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    const rows = new Map(res.body.names.map((r) => [r.name, r]));
    const opsOf = (name) => (rows.get(name)?.ops || []).map((o) => o.action);

    // 漂移行：候选齐全、最新 mtime 默认胜出
    const alpha = rows.get(`${P}alpha`);
    assert.ok(alpha, 'alpha row missing');
    assert.deepEqual(alpha.candidates.map((c) => c.source).sort(), ['ccswitch', 'store', 'workbuddy']);
    assert.equal(alpha.winner.source, 'workbuddy');
    assert.equal(alpha.identical, false);
    assert.ok(opsOf(`${P}alpha`).includes('refresh-store'), `alpha ops: ${opsOf(`${P}alpha`)}`);

    assert.equal(rows.get(`${P}same`).identical, true);
    assert.deepEqual(opsOf(`${P}same`), []);

    // 单一来源行：收编进原件仓；codex 真实目录还要在阶段 3 清走
    assert.equal(rows.get(`${P}wbonly`).winner.source, 'workbuddy');
    assert.ok(opsOf(`${P}wbonly`).includes('adopt-store'));
    assert.equal(rows.get(`${P}cxreal`).winner.source, 'codex');
    assert.deepEqual(opsOf(`${P}cxreal`).sort(), ['adopt-store', 'trash-codex-real']);
    assert.equal(rows.get(`${P}oldbackup`).winner.source, 'ccswitch');
    assert.ok(opsOf(`${P}oldbackup`).includes('adopt-store'));

    // 死环两态：有仓库家族 → 换指；孤儿 → 删除
    assert.deepEqual(opsOf(`${P}fam`), ['link-repo']);
    assert.deepEqual(opsOf(`${P}orphan`), ['remove-dead-link']);

    // 断链进 codex 清理 ops；外部链零 ops
    assert.deepEqual(opsOf(`${P}cxdead`), ['unlink-codex-link']);
    assert.deepEqual(opsOf(`${P}ext`), []);

    // facts：整目录链 / 外部链 / 死环 / zcode 双链都被点名
    const facts = res.body.facts;
    assert.equal(await fs.realpath(facts.claudeWholeDirLink), await fs.realpath(path.join(store)));
    assert.ok(facts.storeDeadLoops.includes(`${P}fam`));
    assert.ok(facts.storeDeadLoops.includes(`${P}orphan`));
    assert.ok(facts.storeExternalLinks.includes(`${P}ext`));
    assert.ok(facts.repoFamilies.includes(`${P}fam`));
    assert.ok(facts.zcodeLinks.includes(`${P}zlinked`));
    assert.deepEqual(facts.codexBrokenLinks, [`${P}cxdead`]);

    // 只读端点：扫描不改盘
    assert.equal((await fs.lstat(path.join(store, `${P}fam`))).isSymbolicLink(), true);
    assert.equal((await fs.lstat(path.join(home, '.claude', 'skills'))).isSymbolicLink(), true);
    }});
  });
});

test('migrate 识别 cc-switch 包装备份里的真实 Skill 名称与 skill/ 内容', async (t) => {
  await withServer(t, { fn: async ({ home, post }) => {
    const backupName = `20260817_171301_${P}wrapped`;
    const backupRoot = path.join(home, '.cc-switch', 'skill-backups', backupName);
    const skillRoot = path.join(backupRoot, 'skill');
    await createSkill(skillRoot, 'cc-switch wrapped backup');
    await fs.writeFile(path.join(backupRoot, 'meta.json'), JSON.stringify({
      skill: { name: `${P}wrapped`, directory: `${P}wrapped` },
      backupCreatedAt: 1786986781,
      sourcePath: path.join(home, '.agents', 'skills', `${P}wrapped`),
    }, null, 2));

    const scan = await post('/api/skills/migrate/scan');
    assert.equal(scan.status, 200);
    const row = scan.body.names.find((item) => item.name === `${P}wrapped`);
    assert.ok(row, 'wrapper meta skill.name should become the matrix row name');
    assert.equal(scan.body.names.some((item) => item.name === backupName), false, 'timestamp wrapper is not a Skill row');
    assert.equal(row.winner.source, 'ccswitch');
    assert.equal(row.winner.dir, skillRoot);

    const exec = await post('/api/skills/migrate/execute', { plan: { winners: { [`${P}wrapped`]: 'ccswitch' } } });
    assert.equal(exec.status, 200);
    assert.equal(exec.body.ok, true, JSON.stringify(exec.body));
    assert.match(await readText(path.join(home, '.agents', 'skills', `${P}wrapped`, 'SKILL.md')), /cc-switch wrapped backup/);
  }});
});

test('migrate/snapshot 前后快照与结构化 diff（Claude/WB 不变式、Codex/ZCode 只许新增）', async (t) => {
  await withServer(t, { fn: async ({ home, post }) => {
    const store = path.join(home, '.agents', 'skills');
    const wb = path.join(home, '.workbuddy', 'skills');
    await createSkill(path.join(store, `${P}alpha`));
    await createSkill(path.join(wb, `${P}alphacopy`), 'wb copy');

    // claude 已是拆链后的形态：逐条相对链决定可见性
    await fs.mkdir(path.join(home, '.claude', 'skills'), { recursive: true });
    await fs.symlink(path.join('..', '..', '.agents', 'skills', `${P}alpha`), path.join(home, '.claude', 'skills', `${P}alpha`));

    // Codex 用 config.toml 禁用一个条目：禁用者不算可见
    await fs.mkdir(path.join(home, '.codex'), { recursive: true });
    await createSkill(path.join(store, `${P}muted`));
    await fs.writeFile(path.join(home, '.codex', 'config.toml'),
      `[[skills.config]]\npath = ${JSON.stringify(path.join(store, `${P}muted`, 'SKILL.md'))}\nenabled = false\n`, 'utf8');

    const before = await post('/api/skills/migrate/snapshot', { phase: 'before' });
    assert.equal(before.status, 200);
    assert.equal(before.body.ok, true);
    assert.deepEqual(before.body.snapshot.agents.workbuddy.visible.sort(), [`${P}alphacopy`]);
    assert.deepEqual(before.body.snapshot.agents.claude.visible, [`${P}alpha`]);
    assert.equal(before.body.snapshot.agents.claude.mode, 'directory');
    assert.deepEqual(before.body.snapshot.agents.codex.visible.sort(), [`${P}alpha`]);
    assert.equal(await readText(path.join(home, '.fanbox', 'migration', 'snapshot-before.json')),
      JSON.stringify(before.body.snapshot, null, 2) + '\n');

    // 迁移期世界继续转：新增原件（Codex/ZCode 允许）、WB 拷贝被删（不允许消失）
    await createSkill(path.join(store, `${P}newguy`));
    await fs.rm(path.join(wb, `${P}alphacopy`), { recursive: true, force: true });

    const after = await post('/api/skills/migrate/snapshot', { phase: 'after' });
    assert.equal(after.body.ok, true);
    const diff = after.body.diff;
    assert.deepEqual(diff.agents.claude, { added: [], removed: [] });
    assert.deepEqual(diff.agents.codex.added, [`${P}newguy`]);
    assert.deepEqual(diff.agents.zcode.added, [`${P}newguy`]);
    assert.deepEqual(diff.agents.workbuddy.removed, [`${P}alphacopy`]);
    assert.equal(diff.passed, false);
    assert.ok(diff.violations.some((v) => /workbuddy/i.test(v)), `violations: ${diff.violations}`);
    assert.ok(await fs.stat(path.join(home, '.fanbox', 'migration', 'snapshot-after.json')));

    // 没有 before 就拍 after：结构化报错，不落盘
    await fs.rm(path.join(home, '.fanbox', 'migration', 'snapshot-before.json'));
    const orphan = await post('/api/skills/migrate/snapshot', { phase: 'after' });
    assert.equal(orphan.body.ok, false);
    assert.match(orphan.body.error, /before/);
  }});
});

test('migrate/snapshot 校验 phase 参数', async (t) => {
  await withServer(t, { fn: async ({ post }) => {
    const bad = await post('/api/skills/migrate/snapshot', { phase: 'middle' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.status, 'invalid_request');
    const missing = await post('/api/skills/migrate/snapshot', {});
    assert.equal(missing.status, 400);
  }});
});

test('migrate/execute 全流程：拆链 / 收编 / 清理 / ZCode 批量写 enable / 验收报告', async (t) => {
  await withRepoGuard(async () => {
    await withServer(t, { fn: async ({ home, post }) => {
      const homeRoot = (...p) => path.join(home, ...p);
      const store = homeRoot('.agents', 'skills');
      const repoFam = path.join(REPO_SKILLS, `${P}fam`);

      // 仓库家族：旧内容（将被 WB 更新版覆盖写入）
      await fs.mkdir(repoFam, { recursive: true });
      await createSkill(repoFam, 'repo v1');
      await touchSkill(repoFam, 1000);

      // store：漂移的 teach（旧）、自引用死环 fam、外部链 ext
      await createSkill(path.join(store, `${P}teach`), 'store v1');
      await touchSkill(path.join(store, `${P}teach`), 2000);
      await fs.symlink(path.join(store, `${P}fam`), path.join(store, `${P}fam`));
      const extTarget = homeRoot('.local', 'share', 'ego', 'ego-skill');
      await createSkill(extTarget, 'external skill');
      await fs.symlink(extTarget, path.join(store, `${P}ext`));

      // claude 整目录链 + settings.json 残留
      await fs.mkdir(homeRoot('.claude'), { recursive: true });
      await fs.symlink(path.join('..', '.agents', 'skills'), homeRoot('.claude', 'skills'));
      await fs.writeFile(homeRoot('.claude', 'settings.json'),
        JSON.stringify({ model: 'keep-me', skillOverrides: { [`${P}teach`]: 'off', [`${P}ext`]: 'off' } }, null, 2) + '\n', 'utf8');

      // codex：一个真实目录（本名单唯一来源）、一条死链、必须存活的 .system；
      // Finder 产生的 .DS_Store 也必须清走，终态严格只留 .system。
      await createSkill(homeRoot('.codex', 'skills', `${P}cx`), 'codex real v1');
      await fs.symlink(path.join(home, '.cc-switch', 'skills', `${P}dead`), homeRoot('.codex', 'skills', `${P}deadlink`));
      await fs.mkdir(homeRoot('.codex', 'skills', '.system'), { recursive: true });
      await fs.writeFile(homeRoot('.codex', 'skills', '.DS_Store'), 'finder metadata');

      // workbuddy：teach 最新版（矩阵刷新 store 用）、独有件、fam 的最新版（写仓库用）
      await createSkill(path.join(homeRoot('.workbuddy', 'skills'), `${P}teach`), 'workbuddy v2');
      await touchSkill(homeRoot('.workbuddy', 'skills', `${P}teach`), 5000);
      await createSkill(path.join(homeRoot('.workbuddy', 'skills'), `${P}wbonly`), 'wb exclusive');
      await createSkill(path.join(homeRoot('.workbuddy', 'skills'), `${P}fam`), 'workbuddy fam v2');
      await touchSkill(homeRoot('.workbuddy', 'skills', `${P}fam`), 6000);

      // zcode：手写双读链 + 无关段落要保留的 config.json
      await fs.mkdir(homeRoot('.zcode', 'skills'), { recursive: true });
      await fs.symlink(path.join('..', '..', '.agents', 'skills', `${P}teach`), homeRoot('.zcode', 'skills', `${P}teach`));
      await fs.mkdir(homeRoot('.zcode', 'cli'), { recursive: true });
      await fs.writeFile(homeRoot('.zcode', 'cli', 'config.json'),
        JSON.stringify({ plugins: { enabledPlugins: { foo: true } } }, null, 2) + '\n', 'utf8');

      // 先拍迁移前快照（execute 的 Phase 0 也应重拍，这里验证端点独立可用）
      const beforeSnap = await post('/api/skills/migrate/snapshot', { phase: 'before' });
      assert.equal(beforeSnap.body.ok, true);
      const beforeVisible = Object.fromEntries(
        Object.entries(beforeSnap.body.snapshot.agents).map(([a, v]) => [a, [...v.visible].sort()]),
      );

      const exec = await post('/api/skills/migrate/execute', { plan: { winners: {} } });
      assert.equal(exec.status, 200);
      assert.equal(exec.body.ok, true,
        `execute failed: ${JSON.stringify((exec.body.phases || []).filter((p) => p.status === 'failed')) || exec.body.error}`);
      const titles = exec.body.phases.map((p) => p.phase);
      assert.deepEqual(titles, [0, 1, 2, 3, 4, 5]);

      // —— 原件仓只增 + 仓库写入（git 提交留给用户）
      assert.match(await readText(path.join(store, `${P}teach`, 'SKILL.md')), /workbuddy v2/, 'store teach refreshed to matrix winner');
      assert.ok(await fs.stat(path.join(store, `${P}wbonly`, 'SKILL.md')), 'wb exclusive adopted');
      assert.ok(await fs.stat(path.join(store, `${P}cx`, 'SKILL.md')), 'codex real dir adopted into store');
      const famLink = path.join(store, `${P}fam`);
      assert.equal((await fs.lstat(famLink)).isSymbolicLink(), true, 'dead loop replaced by repo link');
      assert.equal(await fs.realpath(famLink), await fs.realpath(repoFam));
      assert.match(await readText(path.join(repoFam, 'SKILL.md')), /workbuddy fam v2/, 'winner content written into repo');
      assert.equal(await fs.realpath(path.join(store, `${P}ext`)), await fs.realpath(extTarget), 'external link untouched');

      // —— Claude 拆整目录链：真实目录 + 迁移前可见集合的逐条相对链
      const claudeRoot = homeRoot('.claude', 'skills');
      assert.equal((await fs.lstat(claudeRoot)).isDirectory() && !(await fs.lstat(claudeRoot)).isSymbolicLink(), true);
      for (const name of beforeVisible.claude) {
        assert.equal(await fs.readlink(path.join(claudeRoot, name)),
          path.join('..', '..', '.agents', 'skills', name), `claude relink for ${name}`);
      }
      await assert.rejects(() => fs.lstat(path.join(claudeRoot, `${P}fam`)), { code: 'ENOENT' }, 'not previously visible → no new claude link');
      const settings = JSON.parse(await readText(homeRoot('.claude', 'settings.json')));
      assert.equal(settings.model, 'keep-me');
      assert.equal(settings.skillOverrides, undefined, 'skillOverrides residue cleaned');

      // —— Codex 清理：只留 .system；config.toml 不动（本场景本就没有）
      assert.deepEqual((await fs.readdir(homeRoot('.codex', 'skills'))).sort(), ['.system']);
      await assert.rejects(() => fs.stat(homeRoot('.codex', 'config.toml')), { code: 'ENOENT' });

      // trash 可恢复：store 旧 teach、仓库旧 fam、codex 真实目录都进了测试废纸篓
      const trashDir = homeRoot('.fanbox-test-trash');
      const trashed = await fs.readdir(trashDir);
      assert.equal(trashed.length, 4, `expected 4 recoverable items in trash, got ${trashed.length}`);

      // —— ZCode：双链已删；enable 按迁移前可见性批量写入；无关段落保留
      assert.deepEqual(await fs.readdir(homeRoot('.zcode', 'skills')), []);
      const zcfg = JSON.parse(await readText(homeRoot('.zcode', 'cli', 'config.json')));
      assert.deepEqual(zcfg.plugins, { enabledPlugins: { foo: true } });
      const zskills = zcfg.skills || {};
      assert.equal(zskills[path.resolve(path.join(store, `${P}teach`))].enable, true, 'pre-visible → enable true');
      assert.equal(zskills[path.resolve(path.join(store, `${P}ext`))].enable, true, 'pre-visible via dual-read → enable true');
      assert.equal(zskills[path.resolve(path.join(store, `${P}wbonly`))].enable, false, 'newly adopted → enable false');
      assert.equal(zskills[path.resolve(path.join(store, `${P}cx`))].enable, false);
      assert.equal(zskills[path.resolve(path.join(store, `${P}fam`))].enable, false);

      // —— 验收：manifest + 前后快照 + 结构化 diff + 通过的验收标准
      const migDir = homeRoot('.fanbox', 'migration');
      assert.ok(await fs.stat(path.join(migDir, 'snapshot-before.json')));
      assert.ok(await fs.stat(path.join(migDir, 'snapshot-after.json')));
      const manifests = (await fs.readdir(migDir)).filter((n) => n.startsWith('manifest-'));
      assert.equal(manifests.length, 1);
      const manifest = JSON.parse(await readText(path.join(migDir, manifests[0])));
      assert.deepEqual(manifest.plan, { winners: {} });
      assert.ok(manifest.phases.some((p) => p.trashed && p.trashed.length >= 3), 'trash destinations recorded in manifest');
      const diff = exec.body.diff;
      assert.deepEqual(diff.agents.claude, { added: [], removed: [] }, 'claude visibility strictly unchanged');
      assert.deepEqual(diff.agents.workbuddy, { added: [], removed: [] }, 'workbuddy visibility strictly unchanged');
      assert.deepEqual(diff.agents.codex.removed, [], 'codex must not lose visibility');
      assert.deepEqual(diff.agents.zcode.removed, [], 'zcode must not lose visibility');
      assert.equal(exec.body.criteria.visibilityInvariant, true);
      assert.equal(exec.body.criteria.codexTerminal, true);
      assert.equal(exec.body.criteria.zcodeTerminal, true);
      assert.equal(exec.body.criteria.claudeTerminal, true);
      assert.equal(exec.body.criteria.storeHealthy, true);
      assert.equal(exec.body.criteria.externalsUntouched, true);
      assert.equal(exec.body.passedAllCriteria, true);
      assert.ok(exec.body.reminders.some((r) => /git|提交/.test(r)), 'report reminds about git commit');

      // —— 幂等重跑：状态稳定，全部阶段仍成功
      const rerun = await post('/api/skills/migrate/execute', { plan: { winners: {} } });
      assert.equal(rerun.body.ok, true, `rerun failed: ${JSON.stringify(rerun.body.phases?.filter((p) => p.status === 'failed'))}`);
      assert.equal((await fs.readdir(homeRoot('.codex', 'skills'))).sort().join(','), '.system');
      assert.equal(await fs.readlink(path.join(claudeRoot, `${P}teach`)), path.join('..', '..', '.agents', 'skills', `${P}teach`));
    }});
  });
});

test('migrate/execute 尊重改判锁定：非最新 mtime 的候选也能胜出', async (t) => {
  await withRepoGuard(async () => {
    await withServer(t, { fn: async ({ home, post }) => {
      const store = path.join(home, '.agents', 'skills');
      const wb = path.join(home, '.workbuddy', 'skills');
      await createSkill(path.join(store, `${P}pick`), 'store newer');
      await touchSkill(path.join(store, `${P}pick`), 9000);
      await createSkill(path.join(wb, `${P}pick`), 'workbuddy older but chosen');
      await touchSkill(path.join(wb, `${P}pick`), 1000);

      const scan = await post('/api/skills/migrate/scan');
      assert.equal(scan.body.names.find((r) => r.name === `${P}pick`).winner.source, 'store');

      const exec = await post('/api/skills/migrate/execute', { plan: { winners: { [`${P}pick`]: 'workbuddy' } } });
      assert.equal(exec.body.ok, true, `execute failed: ${JSON.stringify(exec.body.phases?.find((p) => p.status === 'failed') || '')}`);
      assert.match(await readText(path.join(store, `${P}pick`, 'SKILL.md')), /workbuddy older but chosen/);
      // 被替换的旧原件可从废纸篓恢复
      const trashDir = path.join(home, '.fanbox-test-trash');
      const trashed = await fs.readdir(trashDir);
      assert.equal(trashed.length, 1);
      assert.match(await readText(path.join(trashDir, trashed[0], 'SKILL.md')), /store newer/);
    }});
  });
});

test('migrate/execute 拒绝无效改判并保持零副作用', async (t) => {
  await withServer(t, { fn: async ({ home, post }) => {
    const store = path.join(home, '.agents', 'skills');
    await createSkill(path.join(store, `${P}solo`), 'solo');

    for (const badPlan of [
      { winners: { [`${P}ghost`]: 'workbuddy' } },          // 行不在矩阵里
      { winners: { [`${P}solo`]: 'moon' } },                // 来源未知
      { winners: { [`${P}solo`]: 'repo' } },                // 该行没有 repo 候选
    ]) {
      const res = await post('/api/skills/migrate/execute', { plan: badPlan });
      assert.equal(res.body.ok, false, `expected rejection for ${JSON.stringify(badPlan)}`);
      assert.ok(res.body.error, 'structured error returned');
    }
    // 形状无效 → 400
    assert.equal((await post('/api/skills/migrate/execute', {})).status, 400);
    assert.equal((await post('/api/skills/migrate/execute', { plan: { winners: 'x' } })).status, 400);
    // 零副作用
    assert.match(await readText(path.join(store, `${P}solo`, 'SKILL.md')), /solo/);
    const migDir = path.join(home, '.fanbox', 'migration');
    assert.equal(await fs.readdir(migDir).then(() => 'found', (e) => e.code), 'ENOENT', 'rejected plans leave no manifest');
  }});
});

test('migrate/execute 阶段失败按日志逆序回滚本阶段，不留半成品', async (t) => {
  await withServer(t, { env: { FANBOX_TEST_MIGRATE_FAIL: 'adopt' }, fn: async ({ home, post }) => {
    const store = path.join(home, '.agents', 'skills');
    const wb = path.join(home, '.workbuddy', 'skills');
    await createSkill(path.join(wb, `${P}u1`), 'unique one');
    await createSkill(path.join(wb, `${P}u2`), 'unique two');

    const exec = await post('/api/skills/migrate/execute', { plan: { winners: {} } });
    assert.equal(exec.body.ok, false);
    const failed = exec.body.phases.find((p) => p.phase === 1);
    assert.equal(failed.status, 'failed');
    assert.match(failed.error, /测试注入/);
    assert.equal(exec.body.phases.find((p) => p.phase === 2).status, 'skipped', 'later phases must not run');

    // 回滚干净：收编被撤销、第二行从未动过、无临时目录残留
    await assert.rejects(() => fs.lstat(path.join(store, `${P}u1`)), { code: 'ENOENT' });
    await assert.rejects(() => fs.lstat(path.join(store, `${P}u2`)), { code: 'ENOENT' });
    const leftovers = (await fs.readdir(store)).filter((n) => n.startsWith('.fanbox-'));
    assert.deepEqual(leftovers, []);
    // manifest 已持久化，含失败记录
    const migDir = path.join(home, '.fanbox', 'migration');
    const manifests = (await fs.readdir(migDir)).filter((n) => n.startsWith('manifest-'));
    assert.equal(manifests.length, 1);
    const manifest = JSON.parse(await readText(path.join(migDir, manifests[0])));
    assert.equal(manifest.phases.find((p) => p.phase === 1).status, 'failed');
  }});
});
