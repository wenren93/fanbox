'use strict';

// 硬切换删除清单（issue 27 · 规格 docs/16 §3「硬切换」）：
// /api/skills/toggle 与拷贝式 /api/skills/import 退役（404）；v1 扫描形状不再携带
// toggleStrategy / importTargets；skills_disabled 保留（WorkBuddy 列机制）；
// 历史 skills/_disabled 只读识别——内容原样不动，按真实目录引导收编。

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
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await exited;
}

async function withServer(t, fn) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'fanbox-hard-switch-home-'));
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

  async function request(url, options) {
    const response = await fetch(`http://127.0.0.1:${port}${url}`, options);
    return { status: response.status, body: await response.text() };
  }

  async function post(url, body) {
    return request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: `http://localhost:${port}` },
      body: JSON.stringify(body),
    });
  }

  return fn({ home, request, post });
}

async function createSkill(dir, name = path.basename(dir)) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: Test fixture for ${name}\n---\n`, 'utf8');
}

test('retired toggle-era endpoints answer 404', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const skillDir = path.join(home, '.claude', 'skills', 'gone-feature');
    await createSkill(skillDir);
    await post('/api/skills/refresh', {});

    const toggle = await post('/api/skills/toggle', { dir: skillDir, enable: false });
    assert.equal(toggle.status, 404);
    // 端点退役后不得留下半执行的副作用
    await assert.doesNotReject(fs.stat(skillDir));

    const imp = await post('/api/skills/import', { sourceDir: skillDir, targetAgent: 'codex' });
    assert.equal(imp.status, 404);
    await assert.rejects(fs.stat(path.join(home, '.codex', 'skills', 'gone-feature')), { code: 'ENOENT' });
  });
});

test('v1 scan shape sheds toggle-era fields and keeps directory-parked disabled recognition', async (t) => {
  await withServer(t, async ({ home, post }) => {
    await createSkill(path.join(home, '.agents', 'skills', 'plain-one'));
    await createSkill(path.join(home, '.workbuddy', 'skills_disabled', 'parked-one'));

    const scan = await post('/api/skills/refresh', {});
    assert.equal(scan.status, 200);
    const body = JSON.parse(scan.body);
    for (const item of body.items) {
      assert.equal('toggleStrategy' in item, false, 'toggleStrategy must be gone from the v1 shape');
      assert.equal('toggleScope' in item, false);
      assert.equal('toggleSupported' in item, false);
      assert.equal('importTargets' in item, false);
      assert.ok('source' in item && 'dir' in item, 'basic listing fields must survive');
    }
    const parked = body.items.find((item) => item.dir === path.join(home, '.workbuddy', 'skills_disabled', 'parked-one'));
    assert.ok(parked, 'skills_disabled 拷贝仍要被只读识别');
    assert.equal(parked.disabled, true);
  });
});

test('legacy skills/_disabled stays read-only recognized and guides annex in v2', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const legacyDir = path.join(home, '.claude', 'skills', '_disabled', 'legacy-skill');
    await createSkill(legacyDir);

    const v2 = await post('/api/skills/refresh', { v: 2 });
    const body = JSON.parse(v2.body);
    const anomaly = (body.anomalies || []).find((a) => a.path === legacyDir);
    assert.ok(anomaly, '_disabled 下的历史目录要按残留报出');
    assert.equal(anomaly.kind, 'real-dir');
    assert.equal(anomaly.action, 'annex');

    // 只读识别：扫描不得移动或改写历史内容
    await assert.doesNotReject(fs.stat(path.join(legacyDir, 'SKILL.md')));

    const v1Body = JSON.parse((await post('/api/skills/refresh', {})).body);
    const item = v1Body.items.find((it) => it.dir === legacyDir);
    assert.ok(item, 'v1 扫描仍识别 _disabled 历史项');
    assert.equal(item.disabled, true);
  });
});

test('WorkBuddy skills_disabled mechanism keeps working through the link endpoint', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const storeDir = path.join(home, '.agents', 'skills', 'wb-mech');
    const activeDir = path.join(home, '.workbuddy', 'skills', 'wb-mech');
    const parkedDir = path.join(home, '.workbuddy', 'skills_disabled', 'wb-mech');
    await createSkill(storeDir);

    const on = JSON.parse((await post('/api/skills/link', { name: 'wb-mech', agent: 'workbuddy', on: true })).body);
    assert.equal(on.ok, true);
    assert.equal(await fs.stat(path.join(activeDir, 'SKILL.md')).then((st) => st.isFile()), true);

    const off = JSON.parse((await post('/api/skills/link', { name: 'wb-mech', agent: 'workbuddy', on: false })).body);
    assert.equal(off.ok, true);
    await assert.doesNotReject(fs.stat(path.join(parkedDir, 'SKILL.md')));
    await assert.rejects(fs.stat(activeDir), { code: 'ENOENT' }, 'active copy should have moved to skills_disabled');

    const v2Body = JSON.parse((await post('/api/skills/refresh', { v: 2 })).body);
    const row = v2Body.items.find((it) => it.name === 'wb-mech' && it.agents);
    assert.ok(row);
    assert.equal(row.agents.workbuddy.on, false);
  });
});
