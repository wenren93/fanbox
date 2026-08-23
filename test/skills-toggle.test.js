'use strict';

// /api/skills/toggle 与 v1 扫描形状的存量行为（硬切换删除归 issue 27，此前保持绿）。
// v1 批量形状（{dirs[], action}）已由 batch v2（{names[], ...}，test/skills-batch-v2.test.js）取代。

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

test('v1 scan shape keeps serving toggle-era consumers', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const root = path.join(home, '.workbuddy', 'skills');
    const globalAlsoSeenAsProject = path.join(home, '.claude', 'skills', 'same-path-skill');
    const project = path.join(home, 'work', 'multi-agent-project');
    const projectClaudeSkill = path.join(project, '.claude', 'skills', 'project-claude-skill');
    const projectCodexSkill = path.join(project, '.codex', 'skills', 'project-codex-skill');
    const projectWorkBuddySkill = path.join(project, '.workbuddy', 'skills', 'project-workbuddy-skill');
    await createSkill(globalAlsoSeenAsProject);
    await createSkill(projectClaudeSkill);
    await createSkill(projectCodexSkill);
    await createSkill(projectWorkBuddySkill);

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
  });
});

test('WorkBuddy toggle moves an installation between sibling skills roots', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const activeDir = path.join(home, '.workbuddy', 'skills', 'move-me');
    const disabledDir = path.join(home, '.workbuddy', 'skills_disabled', 'move-me');
    await createSkill(activeDir);

    await post('/api/skills/refresh', {});
    const disabled = await post('/api/skills/toggle', { dir: activeDir, enable: false });
    assert.deepEqual(disabled.body, { ok: true, dir: disabledDir });
    await assert.rejects(fs.stat(activeDir), { code: 'ENOENT' });
    assert.equal(await fs.stat(disabledDir).then((st) => st.isDirectory()), true);

    const scan = await post('/api/skills/refresh', {});
    const item = scan.body.items.find((candidate) => candidate.dir === disabledDir);
    assert.ok(item);
    assert.equal(item.disabled, true);
    assert.equal(item.toggleStrategy, 'directory');

    const enabled = await post('/api/skills/toggle', { dir: disabledDir, enable: true });
    assert.deepEqual(enabled.body, { ok: true, dir: activeDir });
    assert.equal(await fs.stat(activeDir).then((st) => st.isDirectory()), true);
    await assert.rejects(fs.stat(disabledDir), { code: 'ENOENT' });
  });
});

test('WorkBuddy toggle refuses a sibling-root name conflict without moving either installation', async (t) => {
  await withServer(t, async ({ home, post }) => {
    const activeDir = path.join(home, '.workbuddy', 'skills', 'same-name');
    const disabledDir = path.join(home, '.workbuddy', 'skills_disabled', 'same-name');
    await createSkill(activeDir, 'active-version');
    await createSkill(disabledDir, 'disabled-version');

    await post('/api/skills/refresh', {});
    const response = await post('/api/skills/toggle', { dir: activeDir, enable: false });
    assert.equal(response.body.ok, false);
    assert.match(response.body.error, /目标位置已有同名目录/);
    assert.equal(await fs.stat(activeDir).then((st) => st.isDirectory()), true);
    assert.equal(await fs.stat(disabledDir).then((st) => st.isDirectory()), true);
  });
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
