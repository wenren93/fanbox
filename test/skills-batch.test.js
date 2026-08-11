'use strict';

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
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'fanbox-skills-home-'));
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
    return { status: response.status, body: await response.json() };
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

function statuses(body) {
  return body.results.map(({ dir, status }) => ({ dir, status }));
}

test('POST /api/skills/batch manages scanned installations independently', async (t) => {
  await withServer(t, async ({ home, request, post }) => {
    const root = path.join(home, '.codex', 'skills');
    const active = path.join(root, 'active-skill');
    const activeSecond = path.join(root, 'second-active-skill');
    const alreadyDisabled = path.join(root, '_disabled', 'disabled-skill');
    const enableTarget = path.join(root, '_disabled', 'enable-target');
    const residue = path.join(root, 'residue-skill');
    const unknown = path.join(root, 'unknown-skill');
    const globalAlsoSeenAsProject = path.join(home, '.claude', 'skills', 'same-path-skill');
    const workbuddySkill = path.join(home, '.workbuddy', 'skills', 'workbuddy-skill');
    await createSkill(active);
    await createSkill(activeSecond);
    await createSkill(alreadyDisabled);
    await createSkill(enableTarget);
    await createSkill(globalAlsoSeenAsProject);
    await createSkill(workbuddySkill);
    await fs.mkdir(residue, { recursive: true });

    await t.test('scans WorkBuddy as its own skill source', async () => {
      const response = await post('/api/skills/refresh', {});
      assert.equal(response.status, 200);
      assert.equal(response.body.roots.workbuddy, path.join(home, '.workbuddy', 'skills'));
      const item = response.body.items.find((candidate) => candidate.dir === workbuddySkill);
      assert.ok(item);
      assert.equal(item.source, 'workbuddy');
      assert.equal(item.label, '~/.workbuddy');
    });

    await t.test('deduplicates one installation discovered through multiple scan roots', async () => {
      const response = await post('/api/skills/refresh', { cwd: home });
      assert.equal(response.status, 200);
      const matches = response.body.items.filter((item) => item.dir === globalAlsoSeenAsProject);
      assert.equal(matches.length, 1);
      assert.equal(matches[0].source, 'claude');
    });

    await t.test('invalid request shapes reject the whole request without side effects', async () => {
      for (const action of ['', 'remove', undefined]) {
        const payload = { dirs: [active] };
        if (action !== undefined) payload.action = action;
        const response = await post('/api/skills/batch', payload);
        assert.equal(response.status, 400);
        assert.equal(response.body.ok, false);
        assert.equal(typeof response.body.error, 'string');
        assert.ok(response.body.error.length > 0);
      }
      for (const payload of [
        { action: 'disable', dirs: [] },
        { action: 'disable', dirs: 'not-an-array' },
        { action: 'disable', dirs: [active], cwd: 42 },
      ]) {
        const response = await post('/api/skills/batch', payload);
        assert.equal(response.status, 400);
        assert.equal(response.body.ok, false);
        assert.equal(typeof response.body.error, 'string');
      }
      assert.equal(await fs.stat(active).then((st) => st.isDirectory()), true);
    });

    await t.test('deduplicates dirs, skips residue, and continues after an item fails', async () => {
      const refreshed = await post('/api/skills/refresh', {});
      assert.equal(refreshed.status, 200);
      const response = await post('/api/skills/batch', {
        action: 'disable',
        dirs: [active, `${active}${path.sep}..${path.sep}active-skill`, activeSecond, residue, unknown],
      });

      assert.equal(response.status, 200);
      assert.equal(response.body.ok, true);
      assert.equal(response.body.action, 'disable');
      assert.deepEqual(statuses(response.body), [
        { dir: active, status: 'success' },
        { dir: activeSecond, status: 'success' },
        { dir: residue, status: 'skipped' },
        { dir: unknown, status: 'failed' },
      ]);
      assert.equal(typeof response.body.results[2].error, 'string');
      assert.equal(typeof response.body.results[3].error, 'string');
      assert.deepEqual(response.body.summary, {
        success: 2,
        noop: 0,
        skipped: 1,
        failed: 1,
        total: 4,
      });
      await assert.rejects(fs.stat(active), { code: 'ENOENT' });
      assert.equal(await fs.stat(path.join(root, '_disabled', 'active-skill')).then((st) => st.isDirectory()), true);
      assert.equal(await fs.stat(path.join(root, '_disabled', 'second-active-skill')).then((st) => st.isDirectory()), true);
    });

    await t.test('enables a disabled installation', async () => {
      const response = await post('/api/skills/batch', {
        action: 'enable',
        dirs: [enableTarget],
      });

      assert.equal(response.status, 200);
      assert.deepEqual(statuses(response.body), [{ dir: enableTarget, status: 'success' }]);
      assert.deepEqual(response.body.summary, {
        success: 1,
        noop: 0,
        skipped: 0,
        failed: 0,
        total: 1,
      });
      await assert.rejects(fs.stat(enableTarget), { code: 'ENOENT' });
      assert.equal(await fs.stat(path.join(root, 'enable-target')).then((st) => st.isDirectory()), true);
    });

    await t.test('reports already-target-state operations as noop', async () => {
      const activeTarget = path.join(root, '_disabled', 'active-skill');
      const response = await post('/api/skills/batch', {
        action: 'disable',
        dirs: [activeTarget, alreadyDisabled],
      });

      assert.equal(response.status, 200);
      assert.deepEqual(statuses(response.body), [
        { dir: activeTarget, status: 'noop' },
        { dir: alreadyDisabled, status: 'noop' },
      ]);
      assert.deepEqual(response.body.summary, {
        success: 0,
        noop: 2,
        skipped: 0,
        failed: 0,
        total: 2,
      });
    });

    await t.test('uses cwd to include a project installation missing from the prior scan', async () => {
      const project = path.join(home, 'work', 'demo-project');
      const projectSkill = path.join(project, '.claude', 'skills', 'project-skill');
      await createSkill(projectSkill);

      // Establish a cache that predates the project skill. The batch request must honor cwd itself.
      const cached = await request('/api/skills');
      assert.equal(cached.status, 200);
      assert.equal(cached.body.items.some((item) => item.dir === projectSkill), false);

      const response = await post('/api/skills/batch', {
        action: 'disable',
        dirs: [projectSkill],
        cwd: project,
      });
      assert.equal(response.status, 200);
      assert.deepEqual(statuses(response.body), [{ dir: projectSkill, status: 'success' }]);
      assert.deepEqual(response.body.summary, {
        success: 1,
        noop: 0,
        skipped: 0,
        failed: 0,
        total: 1,
      });
      await assert.rejects(fs.stat(projectSkill), { code: 'ENOENT' });
      assert.equal(
        await fs.stat(path.join(project, '.claude', 'skills', '_disabled', 'project-skill')).then((st) => st.isDirectory()),
        true,
      );
    });

    await t.test('accepts uninstall without touching the trash when the installation is unknown', async () => {
      const missing = path.join(root, 'never-scanned');
      const response = await post('/api/skills/batch', { action: 'uninstall', dirs: [missing] });

      assert.equal(response.status, 200);
      assert.equal(response.body.ok, true);
      assert.equal(response.body.action, 'uninstall');
      assert.deepEqual(statuses(response.body), [{ dir: missing, status: 'failed' }]);
      assert.deepEqual(response.body.summary, {
        success: 0,
        noop: 0,
        skipped: 0,
        failed: 1,
        total: 1,
      });
    });
  });
});

test('batch uninstall is wired through the guarded skill trash operation', async () => {
  const source = await fs.readFile(path.join(REPO, 'server.js'), 'utf8');
  const start = source.indexOf('async function skillBatch(parsed)');
  const end = source.indexOf('// ---------- 内置 skill', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const batchSource = source.slice(start, end);

  assert.match(source, /\/api\/skills\/batch/);
  assert.match(batchSource, /parsed\.action\s*!==\s*'uninstall'/);
  assert.match(batchSource, /skillTrashItem\(item\)/);
});
