'use strict';

// v1 扫描形状的存量行为（硬切换后保留的部分，issue 27 · 规格 docs/16 §3）：
// 不带 v 的 /api/skills/refresh 继续回答旧扫描形状（项目级三根、跨根去重、
// 物理停用位识别）；启停与导入相关断言随硬切换退役（见 test/skills-hard-switch.test.js）。

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

test('v1 scan shape keeps serving legacy consumers', async (t) => {
  await withServer(t, async ({ home, post }) => {
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
