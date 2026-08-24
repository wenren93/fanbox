'use strict';

// refresh v2（行 = 原件）集成测试：docs/16 §1–§2。
// 隔离 HOME 下构造四种 origin（store / repo / external / project+plugin）
// 与各异常（real-dir / external-link / broken-link / dead-loop / WB 漂移 / 外部修改），
// 断言 POST /api/skills/refresh {v:2} 的扫描结果；旧 v1 形状与本票共存不动。

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
// 缺失时就地补一个临时原件，结束只清掉自己创建的部分，不动机器已有的内容。
async function ensureRepoFixture(name) {
  const dir = path.join(REPO_SKILLS, name);
  let existed = false;
  try { await fs.stat(path.join(dir, 'SKILL.md')); existed = true; } catch { /* 需要现造 */ }
  if (!existed) {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: repo family fixture\n---\nbody\n`, 'utf8');
  }
  return {
    dir,
    async cleanup() {
      if (existed) return;
      await fs.rm(dir, { recursive: true, force: true });
      await fs.rmdir(REPO_SKILLS).catch(() => {});
      await fs.rmdir(path.dirname(REPO_SKILLS)).catch(() => {});
    },
  };
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
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'fanbox-skills-v2-home-'));
  const port = await freePortPair();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: REPO,
    env: { ...process.env, HOME: home, FANBOX_PORT: String(port), FANBOX_NO_OPEN: '1' },
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

function anomalyKey(a) {
  return `${a.agent}:${a.name}:${a.kind}`;
}

test('refresh v2 scans rows from the original store with four-column access values', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const store = path.join(home, '.agents', 'skills');
    const claudeSkills = path.join(home, '.claude', 'skills');
    const wbSkills = path.join(home, '.workbuddy', 'skills');
    const externalRoot = path.join(home, '.local', 'share', 'ego-tools');

    // 四种 origin 的行：store 真实目录 / repo 家族相对链 / 外部链 / 纯库存
    const repoFixture = await ensureRepoFixture('wayfinder');
    t.after(() => repoFixture.cleanup());
    await createSkill(path.join(store, 'alpha'));
    await createSkill(path.join(store, 'plain'));
    // repo 家族：原件留仓库，原件仓放链（绝对链；相对链风格由 Claude 列的 fixture 覆盖）
    await fs.symlink(repoFixture.dir, path.join(store, 'wayfinder'));
    await createSkill(path.join(externalRoot, 'ext-skill'));
    await fs.symlink(path.join('..', '..', '.local', 'share', 'ego-tools', 'ext-skill'), path.join(store, 'ext-skill'));

    // Claude 列：alpha 有效相对链
    await fs.mkdir(claudeSkills, { recursive: true });
    await fs.symlink(path.join('..', '..', '.agents', 'skills', 'alpha'), path.join(claudeSkills, 'alpha'));

    // Codex 列：config.toml 只禁 alpha
    await fs.mkdir(path.join(home, '.codex'), { recursive: true });
    await fs.writeFile(path.join(home, '.codex', 'config.toml'),
      `model = "gpt-test"\n\n[[skills.config]]\npath = ${JSON.stringify(path.join(store, 'alpha', 'SKILL.md'))}\nenabled = false\n`, 'utf8');

    // ZCode 列：config.json 按原件绝对路径 enable 开关，只禁 wayfinder
    await fs.mkdir(path.join(home, '.zcode', 'cli'), { recursive: true });
    await fs.writeFile(path.join(home, '.zcode', 'cli', 'config.json'), JSON.stringify({
      plugins: { enabledPlugins: {} },
      skills: { [path.join(store, 'wayfinder')]: { enable: false } },
    }), 'utf8');

    // WorkBuddy 列：alpha 有一份相同内容的拷贝
    await createSkill(path.join(wbSkills, 'alpha'));

    // 外部修改：来源记录指纹与实际不符
    await fs.mkdir(path.join(home, '.fanbox'), { recursive: true });
    await fs.writeFile(path.join(home, '.fanbox', 'skill-sources.json'), JSON.stringify({
      version: 1,
      installations: {
        [path.join(store, 'alpha')]: {
          repository: 'https://github.com/example/example',
          skillPath: 'alpha',
          commit: 'a'.repeat(40),
          contentHash: '0'.repeat(64),
          name: 'alpha',
          targetAgent: 'agents',
          installedAt: 1,
        },
      },
    }), 'utf8');

    const response = await post('/api/skills/refresh', { v: 2 });
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.v, 2);

    const byName = new Map(response.body.items.map((item) => [item.name, item]));
    const alpha = byName.get('alpha');
    assert.ok(alpha, 'alpha row missing');
    assert.equal(alpha.origin, 'store');
    assert.equal(alpha.dir, await fs.realpath(path.join(store, 'alpha')));
    assert.equal(alpha.agents.claude.on, true);
    assert.equal(alpha.agents.codex.on, false);
    assert.equal(alpha.agents.codex.via, 'config');
    assert.equal(alpha.agents.zcode.on, true);
    assert.equal(alpha.agents.workbuddy.on, true);
    assert.equal(alpha.agents.workbuddy.drift, undefined, 'identical copy must not drift');
    assert.ok(alpha.health.some((h) => h.code === 'externally-modified' && h.level && h.msg),
      'externally-modified health code missing');

    const wayfinder = byName.get('wayfinder');
    assert.ok(wayfinder, 'wayfinder row missing');
    assert.equal(wayfinder.origin, 'repo');
    assert.equal(wayfinder.dir, path.join(REPO_SKILLS, 'wayfinder'));
    assert.equal(wayfinder.agents.claude.on, false);
    assert.equal(wayfinder.agents.codex.on, true, 'codex defaults to enabled without a config entry');
    assert.equal(wayfinder.agents.zcode.on, false);

    const ext = byName.get('ext-skill');
    assert.ok(ext, 'ext-skill row missing');
    assert.equal(ext.origin, 'external');
    assert.equal(ext.dir, await fs.realpath(path.join(externalRoot, 'ext-skill')));

    const plain = byName.get('plain');
    assert.ok(plain, 'plain row missing');
    assert.equal(plain.agents.codex.on, true);
    assert.equal(plain.agents.zcode.on, true);
    assert.equal(plain.agents.claude.on, false);
    assert.equal(plain.agents.workbuddy.on, false);

    assert.deepEqual(response.body.counts, {
      total: 4,
      claude: 1,
      codex: 3,
      workbuddy: 1,
      zcode: 3,
      stock: 0,
    });
  });
});

test('refresh v2 reports store and agent-column anomalies with stable kinds and actions', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const store = path.join(home, '.agents', 'skills');
    const claudeSkills = path.join(home, '.claude', 'skills');
    const wbSkills = path.join(home, '.workbuddy', 'skills');
    const externalRoot = path.join(home, '.local', 'share', 'ego-tools');

    await createSkill(path.join(store, 'alpha'));
    await createSkill(path.join(externalRoot, 'ext-skill'));
    await fs.symlink(path.join(store, 'never-there'), path.join(store, 'dead'));       // 原件仓断链
    await fs.symlink(path.join(store, 'loop'), path.join(store, 'loop'));              // 原件仓自引用死环
    await fs.symlink(path.join('..', '..', '.local', 'share', 'ego-tools', 'ext-skill'), path.join(store, 'ext-skill'));

    await fs.mkdir(claudeSkills, { recursive: true });
    await fs.symlink(path.join('..', '..', '.agents', 'skills', 'alpha'), path.join(claudeSkills, 'alpha')); // 有效接入
    await createSkill(path.join(claudeSkills, 'stray'));                               // 真实目录 → 收编
    await fs.symlink(path.join('..', '..', '.agents', 'skills', 'gone'), path.join(claudeSkills, 'gone'));   // 断链
    await fs.symlink(path.join('..', '..', '.local', 'share', 'ego-tools', 'ext-skill'), path.join(claudeSkills, 'direct')); // 绕开原件仓的外部链
    await fs.symlink(path.join(claudeSkills, 'ouroboros'), path.join(claudeSkills, 'ouroboros')); // agent 目录自引用死环

    // 行级断链警告：仓里有 beta 行，claude 目录里留着一条早已失效的旧链
    await createSkill(path.join(store, 'beta'));
    await fs.symlink(path.join('..', '..', '.agents', 'skills', 'moved-away'), path.join(claudeSkills, 'beta'));

    await createSkill(path.join(wbSkills, 'wb-only'));                                 // 无行的 WB 拷贝 → 收编/迁移

    const response = await post('/api/skills/refresh', { v: 2 });
    assert.equal(response.status, 200);
    const anomalies = response.body.anomalies;
    const kinds = new Map(anomalies.map((a) => [anomalyKey(a), a]));
    assert.deepEqual([...kinds.keys()].sort(), [
      'claude:beta:broken-link',
      'claude:direct:external-link',
      'claude:gone:broken-link',
      'claude:ouroboros:dead-loop',
      'claude:stray:real-dir',
      'store:dead:broken-link',
      'store:loop:dead-loop',
      'workbuddy:wb-only:real-dir',
    ]);
    for (const a of anomalies) {
      assert.ok(a.path && path.isAbsolute(a.path), 'anomaly path must be absolute');
      assert.ok(['annex', 'clean', 'migrate'].includes(a.action), `unexpected action ${a.action}`);
    }
    assert.equal(kinds.get('claude:stray:real-dir').action, 'annex');
    assert.equal(kinds.get('claude:gone:broken-link').action, 'clean');
    assert.equal(kinds.get('store:loop:dead-loop').action, 'migrate');

    // 断链落在与行同名的 agent 条目上时，行级健康同步挂出警告（docs/16 §4.6）
    const byName = new Map(response.body.items.map((item) => [item.name, item]));
    assert.equal(byName.has('gone'), false);
    assert.equal(byName.has('dead'), false);
    const beta = byName.get('beta');
    assert.ok(beta, 'beta row missing');
    assert.ok(beta.health.some((h) => h.code === 'broken-link' && h.level === 'error'));
    assert.equal(beta.agents.claude.on, false, 'a broken claude link must not light the column');
  });
});

test('refresh v2 flags WorkBuddy copy drift once the original moves ahead', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const store = path.join(home, '.agents', 'skills');
    const wbSkills = path.join(home, '.workbuddy', 'skills');
    const alphaDir = path.join(store, 'alpha');
    await createSkill(alphaDir);
    await createSkill(path.join(wbSkills, 'alpha'));

    let response = await post('/api/skills/refresh', { v: 2 });
    let alpha = response.body.items.find((item) => item.name === 'alpha');
    assert.equal(alpha.agents.workbuddy.on, true);
    assert.equal(alpha.agents.workbuddy.drift, undefined);

    await fs.writeFile(path.join(alphaDir, 'SKILL.md'),
      '---\nname: alpha\ndescription: updated original\n---\nnew body\n', 'utf8');
    response = await post('/api/skills/refresh', { v: 2 });
    alpha = response.body.items.find((item) => item.name === 'alpha');
    assert.equal(alpha.agents.workbuddy.drift, true);
    assert.ok(alpha.health.some((h) => h.code === 'wb-drift'), 'wb-drift health code missing');

    // 拷贝反而更新（WB 抢先编辑）不算「落后」，留给迁移向导的漂移矩阵裁决
    await fs.writeFile(path.join(alphaDir, 'SKILL.md'),
      '---\nname: alpha\ndescription: original again\n---\noriginal body\n', 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fs.writeFile(path.join(wbSkills, 'alpha', 'SKILL.md'),
      '---\nname: alpha\ndescription: copy edited ahead\n---\ncopy body\n', 'utf8');
    response = await post('/api/skills/refresh', { v: 2 });
    alpha = response.body.items.find((item) => item.name === 'alpha');
    assert.equal(alpha.agents.workbuddy.drift, undefined, 'copy ahead of original must not be flagged as drift');
  });
});

test('refresh v2 maps description health checks to stable codes', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const store = path.join(home, '.agents', 'skills');
    await createSkill(path.join(store, 'wordy'), 'wordy', 'x'.repeat(2000));
    await fs.mkdir(path.join(store, 'mum'), { recursive: true });
    await fs.writeFile(path.join(store, 'mum', 'SKILL.md'), '---\nname: mum\n---\nbody\n', 'utf8');

    const response = await post('/api/skills/refresh', { v: 2 });
    const codes = new Map(response.body.items.map((item) => [item.name, item.health.map((h) => h.code)]));
    assert.ok(codes.get('wordy').includes('desc-over-cut'));
    assert.ok(codes.get('mum').includes('desc-missing'));
  });
});

test('refresh v2 keeps project and plugin skills in the legacy scan form under origin badges', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const project = path.join(home, 'work', 'demo-project');
    const projectSkill = path.join(project, '.claude', 'skills', 'proj-skill');
    await createSkill(projectSkill);

    const pluginRoot = path.join(home, 'plugin-install');
    const pluginSkill = path.join(pluginRoot, 'skills', 'plugin-skill');
    await createSkill(pluginSkill);
    await fs.mkdir(path.join(home, '.claude', 'plugins'), { recursive: true });
    await fs.writeFile(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({
      plugins: { 'fixture@local': [{ installPath: pluginRoot }] },
    }), 'utf8');

    const response = await post('/api/skills/refresh', { v: 2, cwd: project });
    const proj = response.body.items.find((item) => item.dir === projectSkill);
    assert.ok(proj, 'project item missing');
    assert.equal(proj.origin, 'project');
    assert.equal(proj.projectAgent, 'claude');
    assert.equal(proj.label, 'Claude · demo-project');
    assert.equal(proj.agents, undefined, 'project rows stay out of the column model');

    const plugin = response.body.items.find((item) => item.dir === pluginSkill);
    assert.ok(plugin, 'plugin item missing');
    assert.equal(plugin.origin, 'plugin');
    assert.equal(plugin.agents, undefined);

    // 项目级/插件不计入矩阵计数
    assert.equal(response.body.counts.total, 0);
    assert.equal(response.body.counts.stock, 0);
  });
});

test('refresh v2 treats a whole-directory claude link to the store as all-rows-on with a migrate anomaly', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const store = path.join(home, '.agents', 'skills');
    await createSkill(path.join(store, 'alpha'));
    await createSkill(path.join(store, 'beta'));
    // 迁移前旧形态：~/.claude/skills 整目录软链指向原件仓
    await fs.mkdir(path.join(home, '.claude'), { recursive: true });
    await fs.symlink(store, path.join(home, '.claude', 'skills'));

    const response = await post('/api/skills/refresh', { v: 2 });
    const rows = response.body.items.filter((item) => item.agents);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.agents.claude.on === true));
    assert.equal(response.body.counts.claude, 2);
    const rootLink = response.body.anomalies.find((a) => a.agent === 'claude' && a.path === path.join(home, '.claude', 'skills'));
    assert.ok(rootLink, 'whole-dir link must be reported for migration');
    assert.equal(rootLink.kind, 'external-link');
    assert.equal(rootLink.action, 'migrate');
  });
});

test('refresh keeps answering the v1 shape for old callers', async (t) => {
  await withServer(t, async ({ home, post }) => {
    await createSkill(path.join(home, '.agents', 'skills', 'alpha'));

    const legacy = await post('/api/skills/refresh', {});
    assert.equal(legacy.status, 200);
    assert.equal(legacy.body.v, undefined);
    assert.equal(legacy.body.counts, undefined);
    assert.ok(legacy.body.items.every((item) => 'source' in item));
  });
});
