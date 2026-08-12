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

async function withServer(t, fn, extraEnv = {}) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'fanbox-import-home-'));
  const port = await freePortPair();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: REPO,
    env: { ...process.env, HOME: home, FANBOX_PORT: String(port), FANBOX_NO_OPEN: '1', NODE_ENV: 'test', ...extraEnv },
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

test('content conflict returns a fingerprint without modifying source or target', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const source = path.join(home, '.claude', 'skills', 'conflicted');
    const target = path.join(home, '.codex', 'skills', 'conflicted');
    await createComplexSkill(source, 'source-version');
    await createComplexSkill(target, 'target-version');
    await fs.writeFile(path.join(target, 'target-only.txt'), 'keep me', 'utf8');

    const response = await post('/api/skills/import', { sourceDir: source, targetAgent: 'codex' });
    assert.equal(response.body.status, 'content_conflict');
    assert.match(response.body.conflictFingerprint, /^[a-f0-9]{64}$/);
    assert.match(await fs.readFile(path.join(target, 'SKILL.md'), 'utf8'), /target-version/);
    assert.equal(await fs.readFile(path.join(target, 'target-only.txt'), 'utf8'), 'keep me');
    assert.deepEqual((await fs.readdir(path.dirname(target))).filter((entry) => entry.startsWith('.fanbox-import-')), []);
  });
});

test('identical content is a no-op while executable permission differences are conflicts', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const source = path.join(home, '.claude', 'skills', 'identical');
    const target = path.join(home, '.codex', 'skills', 'identical');
    await createComplexSkill(source, 'identical');
    await fs.cp(source, target, { recursive: true, preserveTimestamps: false });
    const before = await fs.stat(target);

    const same = await post('/api/skills/import', { sourceDir: source, targetAgent: 'codex' });
    assert.equal(same.body.status, 'identical');
    assert.equal((await fs.stat(target)).mtimeMs, before.mtimeMs);

    await fs.chmod(path.join(target, 'run.sh'), 0o644);
    const changed = await post('/api/skills/import', { sourceDir: source, targetAgent: 'codex' });
    assert.equal(changed.body.status, 'content_conflict');
  });
});

test('same Skill name in a different target directory is an unforceable ambiguity', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const source = path.join(home, '.claude', 'skills', 'incoming-dir');
    const conflict = path.join(home, '.codex', 'skills', 'existing-dir');
    await createComplexSkill(source, 'shared-skill-name');
    await createComplexSkill(conflict, 'shared-skill-name');

    const response = await post('/api/skills/import', { sourceDir: source, targetAgent: 'codex' });
    assert.equal(response.body.status, 'name_ambiguity');
    assert.equal(response.body.conflict.dir, conflict);
    await assert.rejects(fs.stat(path.join(home, '.codex', 'skills', 'incoming-dir')), { code: 'ENOENT' });
  });
});

test('WorkBuddy disabled installations participate in name ambiguity checks', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const source = path.join(home, '.claude', 'skills', 'incoming-workbuddy');
    const conflict = path.join(home, '.workbuddy', 'skills_disabled', 'disabled-folder');
    await createComplexSkill(source, 'disabled-shared-name');
    await createComplexSkill(conflict, 'disabled-shared-name');
    const response = await post('/api/skills/import', { sourceDir: source, targetAgent: 'workbuddy' });
    assert.equal(response.body.status, 'name_ambiguity');
    assert.equal(response.body.conflict.dir, conflict);
    assert.equal(response.body.conflict.disabled, true);
  });
});

test('overwrite fully replaces the target and moves the old installation to recoverable trash', async (t) => {
  const trash = await fs.mkdtemp(path.join(os.tmpdir(), 'fanbox-import-trash-'));
  t.after(() => fs.rm(trash, { recursive: true, force: true }));
  await withServer(t, async ({ home, post }) => {
    const source = path.join(home, '.claude', 'skills', 'replace-me');
    const target = path.join(home, '.codex', 'skills', 'replace-me');
    await createComplexSkill(source, 'replace-me');
    await createComplexSkill(target, 'replace-me');
    await fs.writeFile(path.join(source, 'source-only.txt'), 'new', 'utf8');
    await fs.writeFile(path.join(target, 'target-only.txt'), 'old', 'utf8');

    const conflict = await post('/api/skills/import', { sourceDir: source, targetAgent: 'codex' });
    const overwritten = await post('/api/skills/import', {
      sourceDir: source, targetAgent: 'codex', overwrite: true,
      sourceFingerprint: conflict.body.sourceFingerprint,
      conflictFingerprint: conflict.body.conflictFingerprint,
    });
    assert.equal(overwritten.body.status, 'overwritten');
    assert.equal(await fs.readFile(path.join(target, 'source-only.txt'), 'utf8'), 'new');
    await assert.rejects(fs.stat(path.join(target, 'target-only.txt')), { code: 'ENOENT' });
    const trashed = await fs.readdir(trash);
    assert.equal(trashed.length, 1);
    assert.equal(await fs.readFile(path.join(trash, trashed[0], 'target-only.txt'), 'utf8'), 'old');
    assert.equal((await fs.stat(source)).isDirectory(), true);
  }, { FANBOX_TEST_SKILL_TRASH: trash });
});

test('stale overwrite fingerprints never replace a target changed after confirmation', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const source = path.join(home, '.claude', 'skills', 'raced');
    const target = path.join(home, '.codex', 'skills', 'raced');
    await createComplexSkill(source, 'raced');
    await createComplexSkill(target, 'raced');
    await fs.writeFile(path.join(target, 'old.txt'), 'confirmed old content', 'utf8');
    const conflict = await post('/api/skills/import', { sourceDir: source, targetAgent: 'codex' });
    await fs.writeFile(path.join(target, 'external.txt'), 'latest writer wins', 'utf8');

    const response = await post('/api/skills/import', {
      sourceDir: source, targetAgent: 'codex', overwrite: true,
      sourceFingerprint: conflict.body.sourceFingerprint,
      conflictFingerprint: conflict.body.conflictFingerprint,
    });
    assert.equal(response.body.status, 'concurrent_changed');
    assert.equal(await fs.readFile(path.join(target, 'external.txt'), 'utf8'), 'latest writer wins');
  });
});

test('source changes after conflict confirmation require a fresh review', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const source = path.join(home, '.claude', 'skills', 'source-raced');
    const target = path.join(home, '.codex', 'skills', 'source-raced');
    await createComplexSkill(source, 'source-raced');
    await createComplexSkill(target, 'source-raced');
    await fs.writeFile(path.join(target, 'old.txt'), 'keep target', 'utf8');
    const conflict = await post('/api/skills/import', { sourceDir: source, targetAgent: 'codex' });
    await fs.writeFile(path.join(source, 'new-after-confirmation.txt'), 'new source', 'utf8');

    const response = await post('/api/skills/import', {
      sourceDir: source, targetAgent: 'codex', overwrite: true,
      sourceFingerprint: conflict.body.sourceFingerprint,
      conflictFingerprint: conflict.body.conflictFingerprint,
    });
    assert.equal(response.body.status, 'source_changed');
    assert.equal(await fs.readFile(path.join(target, 'old.txt'), 'utf8'), 'keep target');
  });
});

test('unsafe links, loops and special files are rejected before target writes', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const socketServers = [];
    t.after(async () => { await Promise.all(socketServers.map((server) => new Promise((resolve) => server.close(resolve)))); });
    const fixtures = [];
    const external = path.join(home, 'private.txt');
    await fs.writeFile(external, 'private', 'utf8');

    const outside = path.join(home, '.claude', 'skills', 'outside-link');
    await createComplexSkill(outside, 'outside-link');
    await fs.symlink(external, path.join(outside, 'leak.txt'));
    fixtures.push([outside, 'leak.txt']);

    const loop = path.join(home, '.claude', 'skills', 'loop-link');
    await createComplexSkill(loop, 'loop-link');
    await fs.symlink('.', path.join(loop, 'again'));
    fixtures.push([loop, 'again']);

    if (process.platform !== 'win32') {
      const fifo = path.join(home, '.claude', 'skills', 'fifo-skill');
      await createComplexSkill(fifo, 'fifo-skill');
      await new Promise((resolve, reject) => require('node:child_process').execFile('mkfifo', [path.join(fifo, 'pipe')], (e) => e ? reject(e) : resolve()));
      fixtures.push([fifo, 'pipe']);

      const socketSkill = path.join(home, '.claude', 'skills', 's');
      await createComplexSkill(socketSkill, 'socket-skill');
      const socketPath = path.join(socketSkill, 's');
      const socketServer = require('node:net').createServer();
      await new Promise((resolve, reject) => socketServer.once('error', reject).listen(socketPath, resolve));
      assert.equal((await fs.lstat(socketPath)).isSocket(), true);
      assert.equal((await fs.readdir(socketSkill)).includes('s'), true);
      socketServers.push(socketServer);
      fixtures.push([socketSkill, 's']);
    }

    for (const [source, problemPath] of fixtures) {
      const response = await post('/api/skills/import', { sourceDir: source, targetAgent: 'codex' });
      assert.equal(response.body.status, 'unsafe_content');
      assert.equal(response.body.problemPath, problemPath, JSON.stringify(response.body));
      await assert.rejects(fs.stat(path.join(home, '.codex', 'skills', path.basename(source))), { code: 'ENOENT' });
    }
  });
});

test('successful import reports when existing Agent configuration keeps the target disabled', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const source = path.join(home, '.claude', 'skills', 'configured-off');
    const target = path.join(home, '.codex', 'skills', 'configured-off');
    await createComplexSkill(source, 'configured-off');
    await fs.mkdir(path.join(home, '.codex'), { recursive: true });
    await fs.writeFile(path.join(home, '.codex', 'config.toml'), `[[skills.config]]\npath = ${JSON.stringify(path.join(target, 'SKILL.md'))}\nenabled = false\n`, 'utf8');
    const response = await post('/api/skills/import', { sourceDir: source, targetAgent: 'codex' });
    assert.equal(response.body.status, 'created');
    assert.equal(response.body.targetDisabled, true);
  });
});

test('trash failure rolls overwrite back and leaves no visible scratch installation', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const source = path.join(home, '.claude', 'skills', 'rollback');
    const target = path.join(home, '.codex', 'skills', 'rollback');
    await createComplexSkill(source, 'rollback');
    await createComplexSkill(target, 'rollback');
    await fs.writeFile(path.join(target, 'old.txt'), 'must survive', 'utf8');
    const conflict = await post('/api/skills/import', { sourceDir: source, targetAgent: 'codex' });
    const response = await post('/api/skills/import', {
      sourceDir: source, targetAgent: 'codex', overwrite: true,
      sourceFingerprint: conflict.body.sourceFingerprint,
      conflictFingerprint: conflict.body.conflictFingerprint,
    });
    assert.equal(response.body.status, 'failed');
    assert.equal(await fs.readFile(path.join(target, 'old.txt'), 'utf8'), 'must survive');
    const entries = await fs.readdir(path.dirname(target));
    assert.deepEqual(entries.filter((entry) => entry.startsWith('.fanbox-import-') || entry.startsWith('.fanbox-rollback-')), []);
  }, { FANBOX_TEST_SKILL_IMPORT_FAIL: 'trash' });
});

test('disabled and plugin installations remain valid import sources without changing agent configuration', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const disabledSource = path.join(home, '.workbuddy', 'skills_disabled', 'disabled-source');
    const pluginRoot = path.join(home, 'plugin-fixture');
    const pluginSource = path.join(pluginRoot, 'skills', 'plugin-source');
    const claudeSettings = path.join(home, '.claude', 'settings.json');
    const codexConfig = path.join(home, '.codex', 'config.toml');
    const installedPlugins = path.join(home, '.claude', 'plugins', 'installed_plugins.json');
    await createComplexSkill(disabledSource, 'disabled-source');
    await createComplexSkill(pluginSource, 'plugin-source');
    await fs.mkdir(path.dirname(claudeSettings), { recursive: true });
    await fs.mkdir(path.dirname(codexConfig), { recursive: true });
    await fs.mkdir(path.dirname(installedPlugins), { recursive: true });
    await fs.writeFile(claudeSettings, JSON.stringify({ skillOverrides: { 'disabled-source': 'off' } }, null, 2) + '\n');
    await fs.writeFile(codexConfig, '[skills]\n', 'utf8');
    await fs.writeFile(installedPlugins, JSON.stringify({ plugins: { 'fixture@example': [{ installPath: pluginRoot }] } }), 'utf8');
    const settingsBefore = await fs.readFile(claudeSettings);
    const configBefore = await fs.readFile(codexConfig);

    const disabled = await post('/api/skills/import', { sourceDir: disabledSource, targetAgent: 'codex' });
    assert.equal(disabled.body.status, 'created');
    assert.equal(await fs.readFile(path.join(home, '.codex', 'skills', 'disabled-source', 'run.sh'), 'utf8'), '#!/bin/sh\necho imported\n');
    assert.equal((await fs.stat(disabledSource)).isDirectory(), true);

    const plugin = await post('/api/skills/import', { sourceDir: pluginSource, targetAgent: 'workbuddy' });
    assert.equal(plugin.body.status, 'created');
    assert.equal(await fs.readFile(path.join(home, '.workbuddy', 'skills', 'plugin-source', 'SKILL.md'), 'utf8'), await fs.readFile(path.join(pluginSource, 'SKILL.md'), 'utf8'));

    assert.deepEqual(await fs.readFile(claudeSettings), settingsBefore);
    assert.deepEqual(await fs.readFile(codexConfig), configBefore);
  });
});

test('top-level and safe internal symlinks become independent imported content', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const realSource = path.join(home, 'real-skill-source');
    const sourceLink = path.join(home, '.claude', 'skills', 'linked-source');
    await createComplexSkill(realSource, 'linked-source');
    await fs.writeFile(path.join(realSource, 'shared.txt'), 'independent content', 'utf8');
    await fs.symlink('shared.txt', path.join(realSource, 'linked-file.txt'));
    await fs.symlink('references', path.join(realSource, 'linked-references'));
    await fs.mkdir(path.dirname(sourceLink), { recursive: true });
    await fs.symlink(realSource, sourceLink);

    const response = await post('/api/skills/import', { sourceDir: sourceLink, targetAgent: 'codex' });
    assert.equal(response.body.status, 'created');
    const target = path.join(home, '.codex', 'skills', 'linked-source');
    assert.equal((await fs.lstat(target)).isSymbolicLink(), false);
    assert.equal((await fs.lstat(path.join(target, 'linked-file.txt'))).isSymbolicLink(), false);
    assert.equal((await fs.lstat(path.join(target, 'linked-references'))).isSymbolicLink(), false);
    assert.equal(await fs.readFile(path.join(target, 'linked-file.txt'), 'utf8'), 'independent content');
    assert.deepEqual(await fs.readFile(path.join(target, 'linked-references', 'data.bin')), Buffer.from([0, 1, 2, 255]));

    await fs.writeFile(path.join(realSource, 'shared.txt'), 'source changed', 'utf8');
    assert.equal(await fs.readFile(path.join(target, 'linked-file.txt'), 'utf8'), 'independent content');
  });
});

test('a source removed after scanning cannot be imported and leaves no target or temporary item', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const source = path.join(home, '.claude', 'skills', 'vanished-source');
    const targetRoot = path.join(home, '.codex', 'skills');
    await createComplexSkill(source, 'vanished-source');
    const scanned = await post('/api/skills/refresh', {});
    assert.equal(scanned.body.items.some((item) => item.dir === source), true);
    await fs.rm(source, { recursive: true });

    const response = await post('/api/skills/import', { sourceDir: source, targetAgent: 'codex' });
    assert.equal(response.body.status, 'invalid_source');
    await assert.rejects(fs.stat(path.join(targetRoot, 'vanished-source')), { code: 'ENOENT' });
    const entries = await fs.readdir(targetRoot).catch(() => []);
    assert.deepEqual(entries.filter((entry) => entry.startsWith('.fanbox-import-')), []);
  });
});

test('concurrent imports share the Skills write queue and produce one deterministic installation', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const source = path.join(home, '.claude', 'skills', 'queued-import');
    await createComplexSkill(source, 'queued-import');
    const [first, second] = await Promise.all([
      post('/api/skills/import', { sourceDir: source, targetAgent: 'codex' }),
      post('/api/skills/import', { sourceDir: source, targetAgent: 'codex' }),
    ]);
    assert.deepEqual([first.body.status, second.body.status].sort(), ['created', 'identical']);
    assert.equal(await fs.readFile(path.join(home, '.codex', 'skills', 'queued-import', 'SKILL.md'), 'utf8'), await fs.readFile(path.join(source, 'SKILL.md'), 'utf8'));
    const entries = await fs.readdir(path.join(home, '.codex', 'skills'));
    assert.deepEqual(entries.filter((entry) => entry.startsWith('.fanbox-import-') || entry.startsWith('.fanbox-rollback-')), []);
  });
});
