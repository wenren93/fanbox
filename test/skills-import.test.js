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

async function withServer(t, fn) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'fanbox-import-home-'));
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
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM');
      await exited;
    }
    await fs.rm(home, { recursive: true, force: true });
  });
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early\n${logs}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/roots`);
      if (response.ok) break;
    } catch { /* wait */ }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  async function post(url, body) {
    const response = await fetch(`http://127.0.0.1:${port}${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: `http://localhost:${port}` },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }
  return fn({ home, post });
}

async function createComplexSkill(dir, name) {
  await fs.mkdir(path.join(dir, 'references', 'empty'), { recursive: true });
  await fs.mkdir(path.join(dir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: Import fixture\n---\n`, 'utf8');
  await fs.writeFile(path.join(dir, 'references', 'data.bin'), Buffer.from([0, 1, 2, 255]));
  await fs.writeFile(path.join(dir, 'agents', 'openai.yaml'), 'interface:\n  display_name: Fixture\n', 'utf8');
  await fs.writeFile(path.join(dir, 'run.sh'), '#!/bin/sh\necho imported\n', { mode: 0o755 });
}

test('POST /api/skills/import creates independent complete installations for four controlled targets', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const project = path.join(home, 'work', 'fixture-project');
    const roots = {
      claude: path.join(home, '.claude', 'skills'),
      codex: path.join(home, '.codex', 'skills'),
      agents: path.join(home, '.agents', 'skills'),
      workbuddy: path.join(home, '.workbuddy', 'skills'),
    };

    for (const targetAgent of Object.keys(roots)) {
      await t.test(targetAgent, async () => {
        const name = `import-to-${targetAgent}`;
        const source = path.join(project, '.claude', 'skills', name);
        await createComplexSkill(source, name);
        const beforeSource = await fs.readFile(path.join(source, 'SKILL.md'));

        const response = await post('/api/skills/import', { sourceDir: source, targetAgent, cwd: project });
        assert.equal(response.status, 200);
        assert.equal(response.body.ok, true);
        assert.equal(response.body.status, 'created');
        assert.equal(response.body.targetAgent, targetAgent);

        const target = path.join(roots[targetAgent], name);
        assert.deepEqual(await fs.readFile(path.join(target, 'SKILL.md')), beforeSource);
        assert.deepEqual(await fs.readFile(path.join(target, 'references', 'data.bin')), Buffer.from([0, 1, 2, 255]));
        assert.equal(await fs.readFile(path.join(target, 'agents', 'openai.yaml'), 'utf8'), 'interface:\n  display_name: Fixture\n');
        assert.equal((await fs.stat(path.join(target, 'run.sh'))).mode & 0o111, 0o111);
        assert.equal((await fs.stat(path.join(target, 'references', 'empty'))).isDirectory(), true);
        assert.equal((await fs.lstat(target)).isSymbolicLink(), false);
        assert.deepEqual(await fs.readFile(path.join(source, 'SKILL.md')), beforeSource);
        assert.deepEqual((await fs.readdir(roots[targetAgent])).filter((entry) => entry.startsWith('.fanbox-import-')), []);

        const refreshed = await post('/api/skills/refresh', { cwd: project });
        assert.equal(refreshed.body.items.some((item) => item.dir === target), true);
      });
    }
  });
});

test('skill import rejects untrusted source and target input without filesystem side effects', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const source = path.join(home, '.claude', 'skills', 'known-source');
    const unknown = path.join(home, 'private', 'not-scanned');
    const residue = path.join(home, '.claude', 'skills', 'residue');
    await createComplexSkill(source, 'known-source');
    await createComplexSkill(unknown, 'not-scanned');
    await fs.mkdir(residue, { recursive: true });

    const badTarget = await post('/api/skills/import', { sourceDir: source, targetAgent: '../../tmp' });
    assert.equal(badTarget.status, 400);
    assert.equal(badTarget.body.status, 'invalid_request');

    const arbitraryPath = await post('/api/skills/import', { sourceDir: source, targetAgent: '/tmp/custom-target' });
    assert.equal(arbitraryPath.status, 400);

    const unknownSource = await post('/api/skills/import', { sourceDir: unknown, targetAgent: 'codex' });
    assert.equal(unknownSource.body.status, 'invalid_source');
    await assert.rejects(fs.stat(path.join(home, '.codex', 'skills', 'not-scanned')), { code: 'ENOENT' });

    const residueSource = await post('/api/skills/import', { sourceDir: residue, targetAgent: 'codex' });
    assert.equal(residueSource.body.status, 'invalid_source');
    await assert.rejects(fs.stat(path.join(home, '.codex', 'skills', 'residue')), { code: 'ENOENT' });

    const self = await post('/api/skills/import', { sourceDir: source, targetAgent: 'claude' });
    assert.equal(self.body.status, 'self_import');
    assert.equal((await fs.stat(source)).isDirectory(), true);
  });
});

test('existing target is not modified by phase-one import', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const source = path.join(home, '.claude', 'skills', 'conflicted');
    const target = path.join(home, '.codex', 'skills', 'conflicted');
    await createComplexSkill(source, 'source-version');
    await createComplexSkill(target, 'target-version');
    await fs.writeFile(path.join(target, 'target-only.txt'), 'keep me', 'utf8');

    const response = await post('/api/skills/import', { sourceDir: source, targetAgent: 'codex' });
    assert.equal(response.body.status, 'target_exists');
    assert.match(await fs.readFile(path.join(target, 'SKILL.md'), 'utf8'), /target-version/);
    assert.equal(await fs.readFile(path.join(target, 'target-only.txt'), 'utf8'), 'keep me');
    assert.deepEqual((await fs.readdir(path.dirname(target))).filter((entry) => entry.startsWith('.fanbox-import-')), []);
  });
});
