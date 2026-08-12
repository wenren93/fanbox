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
    const root = path.join(home, '.workbuddy', 'skills');
    const active = path.join(root, 'active-skill');
    const activeSecond = path.join(root, 'second-active-skill');
    const alreadyDisabled = path.join(root, '_disabled', 'disabled-skill');
    const enableTarget = path.join(root, '_disabled', 'enable-target');
    const residue = path.join(root, 'residue-skill');
    const unknown = path.join(root, 'unknown-skill');
    const globalAlsoSeenAsProject = path.join(home, '.claude', 'skills', 'same-path-skill');
    const workbuddySkill = path.join(home, '.workbuddy', 'skills', 'workbuddy-skill');
    const project = path.join(home, 'work', 'multi-agent-project');
    const projectClaudeSkill = path.join(project, '.claude', 'skills', 'project-claude-skill');
    const projectCodexSkill = path.join(project, '.codex', 'skills', 'project-codex-skill');
    const projectWorkBuddySkill = path.join(project, '.workbuddy', 'skills', 'project-workbuddy-skill');
    await createSkill(active);
    await createSkill(activeSecond);
    await createSkill(alreadyDisabled);
    await createSkill(enableTarget);
    await createSkill(globalAlsoSeenAsProject);
    await createSkill(workbuddySkill);
    await createSkill(projectClaudeSkill);
    await createSkill(projectCodexSkill);
    await createSkill(projectWorkBuddySkill);
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

    await t.test('scans and distinguishes all three project skill roots', async () => {
      const response = await post('/api/skills/refresh', { cwd: project });
      assert.equal(response.status, 200);
      const expected = [
        [projectClaudeSkill, 'claude', 'Claude · multi-agent-project'],
        [projectCodexSkill, 'codex', 'Codex · multi-agent-project'],
        [projectWorkBuddySkill, 'workbuddy', 'WorkBuddy · multi-agent-project'],
      ];
      for (const [dir, projectAgent, label] of expected) {
        const item = response.body.items.find((candidate) => candidate.dir === dir);
        assert.ok(item, `missing project skill ${dir}`);
        assert.equal(item.source, 'project');
        assert.equal(item.projectAgent, projectAgent);
        assert.equal(item.projectName, 'multi-agent-project');
        assert.equal(item.label, label);
      }
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
      const projectSkill = path.join(project, '.workbuddy', 'skills', 'project-skill');
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
        await fs.stat(path.join(project, '.workbuddy', 'skills', '_disabled', 'project-skill')).then((st) => st.isDirectory()),
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

test('Codex skill toggle uses config.toml and keeps the installation in place', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const skillDir = path.join(home, '.codex', 'skills', 'config-managed');
    const skillFile = path.join(skillDir, 'SKILL.md');
    const configFile = path.join(home, '.codex', 'config.toml');
    const unrelatedSkill = path.join(home, '.codex', 'skills', 'unrelated', 'SKILL.md');
    await createSkill(skillDir);
    await fs.mkdir(path.dirname(configFile), { recursive: true });
    await fs.writeFile(configFile, `model = "gpt-test"\n\n[[skills.config]]\npath = ${JSON.stringify(unrelatedSkill)} # keep entry\nenabled = false\n\n[projects."/tmp/example"]\ntrust_level = "trusted"\n`, 'utf8');

    await post('/api/skills/refresh', {});
    const disabled = await post('/api/skills/toggle', { dir: skillDir, enable: false });
    assert.equal(disabled.status, 200);
    assert.equal(disabled.body.ok, true);
    assert.equal(disabled.body.dir, skillDir);
    assert.equal(await fs.stat(skillDir).then((st) => st.isDirectory()), true);

    const afterDisable = await fs.readFile(configFile, 'utf8');
    assert.match(afterDisable, /model = "gpt-test"/);
    assert.match(afterDisable, new RegExp(`path = ${escapeRegExp(JSON.stringify(unrelatedSkill))} # keep entry\\nenabled = false`));
    assert.match(afterDisable, /\[projects\."\/tmp\/example"\]\ntrust_level = "trusted"/);
    assert.match(afterDisable, new RegExp(`path = ${escapeRegExp(JSON.stringify(skillFile))}\\nenabled = false`));
    const codexBackups = await fs.readdir(path.join(home, '.fanbox', 'backups'));
    assert.equal(codexBackups.some((name) => name.startsWith('codex-config.toml-')), true);

    const scan = await post('/api/skills/refresh', {});
    assert.equal(scan.body.items.find((item) => item.dir === skillDir).disabled, true);

    const enabled = await post('/api/skills/toggle', { dir: skillDir, enable: true });
    assert.equal(enabled.body.ok, true);
    assert.equal(enabled.body.dir, skillDir);
    const afterEnable = await fs.readFile(configFile, 'utf8');
    assert.match(afterEnable, /model = "gpt-test"/);
    assert.match(afterEnable, new RegExp(`path = ${escapeRegExp(JSON.stringify(unrelatedSkill))} # keep entry\\nenabled = false`));
    assert.match(afterEnable, /\[projects\."\/tmp\/example"\]\ntrust_level = "trusted"/);
    assert.match(afterEnable, new RegExp(`path = ${escapeRegExp(JSON.stringify(skillFile))}\\nenabled = true`));
  });
});

test('Claude skill toggle uses skillOverrides and keeps settings and installation in place', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const skillDir = path.join(home, '.claude', 'skills', 'folder-name');
    const settingsFile = path.join(home, '.claude', 'settings.json');
    await createSkill(skillDir, 'frontmatter-name');
    await fs.writeFile(settingsFile, JSON.stringify({ theme: 'dark', skillOverrides: { untouched: 'name-only' } }, null, 2), 'utf8');
    await fs.chmod(settingsFile, 0o600);

    await post('/api/skills/refresh', {});
    const disabled = await post('/api/skills/toggle', { dir: skillDir, enable: false });
    assert.equal(disabled.status, 200);
    assert.equal(disabled.body.ok, true);
    assert.equal(disabled.body.dir, skillDir);
    assert.equal(await fs.stat(skillDir).then((st) => st.isDirectory()), true);

    const afterDisable = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
    assert.deepEqual(afterDisable, {
      theme: 'dark',
      skillOverrides: { untouched: 'name-only', 'frontmatter-name': 'off' },
    });
    assert.equal((await fs.stat(settingsFile)).mode & 0o777, 0o600);
    const claudeBackups = await fs.readdir(path.join(home, '.fanbox', 'backups'));
    assert.equal(claudeBackups.some((name) => name.startsWith('claude-settings.json-')), true);
    const scan = await post('/api/skills/refresh', {});
    const scanned = scan.body.items.find((item) => item.dir === skillDir);
    assert.equal(scanned.skillName, 'frontmatter-name');
    assert.equal(scanned.disabled, true);

    const enabled = await post('/api/skills/toggle', { dir: skillDir, enable: true });
    assert.equal(enabled.body.ok, true);
    assert.equal(enabled.body.dir, skillDir);
    const afterEnable = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
    assert.deepEqual(afterEnable, { theme: 'dark', skillOverrides: { untouched: 'name-only' } });
  });
});

test('mixed Claude and Codex batch disable uses official settings and reports Codex restart', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const claudeDir = path.join(home, '.claude', 'skills', 'claude-batch');
    const codexDir = path.join(home, '.codex', 'skills', 'codex-batch');
    await createSkill(claudeDir);
    await createSkill(codexDir);

    const response = await post('/api/skills/batch', { action: 'disable', dirs: [claudeDir, codexDir] });
    assert.equal(response.status, 200);
    assert.deepEqual(statuses(response.body), [
      { dir: claudeDir, status: 'success' },
      { dir: codexDir, status: 'success' },
    ]);
    assert.deepEqual(response.body.restartRequired, ['codex']);
    assert.equal(await fs.stat(claudeDir).then((st) => st.isDirectory()), true);
    assert.equal(await fs.stat(codexDir).then((st) => st.isDirectory()), true);
    assert.equal(JSON.parse(await fs.readFile(path.join(home, '.claude', 'settings.json'), 'utf8')).skillOverrides['claude-batch'], 'off');
    assert.match(await fs.readFile(path.join(home, '.codex', 'config.toml'), 'utf8'), /enabled = false/);
  });
});

test('Claude name-based override is reflected on every ordinary installation with that skill name', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const globalDir = path.join(home, '.claude', 'skills', 'global-folder');
    const project = path.join(home, 'work', 'same-name-project');
    const projectDir = path.join(project, '.claude', 'skills', 'project-folder');
    await createSkill(globalDir, 'shared-name');
    await createSkill(projectDir, 'shared-name');

    await post('/api/skills/refresh', { cwd: project });
    const disabled = await post('/api/skills/toggle', { dir: globalDir, enable: false });
    assert.equal(disabled.body.ok, true);
    assert.equal(disabled.body.affected, 2);

    const scan = await post('/api/skills/refresh', { cwd: project });
    const matches = scan.body.items.filter((item) => item.skillName === 'shared-name' && (item.source === 'claude' || item.projectAgent === 'claude'));
    assert.equal(matches.length, 2);
    assert.equal(matches.every((item) => item.disabled && item.toggleScope === 'claude-name'), true);
  });
});

test('Claude plugin skills reject per-skill enable and disable', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const pluginRoot = path.join(home, 'plugin-install');
    const pluginSkill = path.join(pluginRoot, 'skills', 'plugin-skill');
    await createSkill(pluginSkill);
    await fs.mkdir(path.join(home, '.claude', 'plugins'), { recursive: true });
    await fs.writeFile(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({
      plugins: { 'fixture@local': [{ installPath: pluginRoot }] },
    }), 'utf8');

    const scan = await post('/api/skills/refresh', {});
    assert.equal(scan.body.items.find((item) => item.dir === pluginSkill).toggleSupported, false);
    const response = await post('/api/skills/toggle', { dir: pluginSkill, enable: false });
    assert.equal(response.body.ok, false);
    assert.match(response.body.error, /插件管理/);
    assert.equal(await fs.stat(pluginSkill).then((st) => st.isDirectory()), true);
  });
});

test('restoring a legacy disabled Claude skill preserves a non-off invocation override', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const disabledDir = path.join(home, '.claude', 'skills', '_disabled', 'manual-skill');
    const settingsFile = path.join(home, '.claude', 'settings.json');
    await createSkill(disabledDir);
    await fs.writeFile(settingsFile, JSON.stringify({ skillOverrides: { 'manual-skill': 'user-invocable-only' } }), 'utf8');

    await post('/api/skills/refresh', {});
    const response = await post('/api/skills/toggle', { dir: disabledDir, enable: true });
    assert.equal(response.body.ok, true);
    assert.equal(JSON.parse(await fs.readFile(settingsFile, 'utf8')).skillOverrides['manual-skill'], 'user-invocable-only');
  });
});

test('Claude disable then enable restores the prior manual invocation override', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const skillDir = path.join(home, '.claude', 'skills', 'manual-roundtrip');
    const settingsFile = path.join(home, '.claude', 'settings.json');
    await createSkill(skillDir);
    await fs.writeFile(settingsFile, JSON.stringify({ skillOverrides: { 'manual-roundtrip': 'user-invocable-only' } }), 'utf8');

    await post('/api/skills/refresh', {});
    assert.equal((await post('/api/skills/toggle', { dir: skillDir, enable: false })).body.ok, true);
    assert.equal(JSON.parse(await fs.readFile(settingsFile, 'utf8')).skillOverrides['manual-roundtrip'], 'off');
    assert.equal((await post('/api/skills/toggle', { dir: skillDir, enable: true })).body.ok, true);
    assert.equal(JSON.parse(await fs.readFile(settingsFile, 'utf8')).skillOverrides['manual-roundtrip'], 'user-invocable-only');
  });
});

test('scan distinguishes manual invocation policy from disabled installations', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const claudeDir = path.join(home, '.claude', 'skills', 'claude-manual');
    const codexDir = path.join(home, '.codex', 'skills', 'codex-manual');
    await createSkill(claudeDir);
    await createSkill(codexDir);
    await fs.mkdir(path.join(codexDir, 'agents'), { recursive: true });
    await fs.writeFile(path.join(codexDir, 'agents', 'openai.yaml'), 'policy:\n  allow_implicit_invocation: false\n', 'utf8');
    await fs.mkdir(path.join(home, '.claude'), { recursive: true });
    await fs.writeFile(path.join(home, '.claude', 'settings.json'), JSON.stringify({
      skillOverrides: { 'claude-manual': 'user-invocable-only' },
    }), 'utf8');

    const scan = await post('/api/skills/refresh', {});
    const claude = scan.body.items.find((item) => item.dir === claudeDir);
    const codex = scan.body.items.find((item) => item.dir === codexDir);
    assert.equal(claude.disabled, false);
    assert.equal(claude.invocationMode, 'manual');
    assert.equal(codex.disabled, false);
    assert.equal(codex.invocationMode, 'manual');
  });
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
