'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

async function waitForServer(port) {
  const deadline = Date.now() + 5000;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/roots`);
      if (res.ok) return;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw lastErr || new Error('server did not start');
}

async function withServer(t, fn) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'fanbox-home-'));
  const port = 4600 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, HOME: home, FANBOX_PORT: String(port), FANBOX_NO_OPEN: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (d) => { logs += d.toString(); });
  child.stderr.on('data', (d) => { logs += d.toString(); });
  t.after(async () => {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    await fs.rm(home, { recursive: true, force: true });
  });
  child.on('exit', (code) => {
    if (code && code !== 143) logs += `\nserver exited with ${code}`;
  });
  await waitForServer(port);
  const json = async (url, opts) => {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, opts);
    assert.equal(res.status, 200, logs);
    return res.json();
  };
  return fn({ home, json });
}

test('quick roots combine defaults and custom folders, dedupe, and hide removed defaults', async (t) => {
  await withServer(t, async ({ home, json }) => {
    const customDir = path.join(home, 'Work Bench');
    await fs.mkdir(customDir, { recursive: true });

    let roots = await json('/api/roots');
    assert.ok(roots.roots.some((r) => r.path === home && r.custom === false), 'default root should be marked non-custom');

    await json('/api/roots/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: `http://localhost:${roots.port || 4567}` },
      body: JSON.stringify({ path: customDir }),
    });
    await json('/api/roots/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: `http://localhost:${roots.port || 4567}` },
      body: JSON.stringify({ path: customDir, name: 'Duplicate' }),
    });

    roots = await json('/api/roots');
    const customMatches = roots.roots.filter((r) => r.path === customDir);
    assert.equal(customMatches.length, 1, 'custom root should not duplicate');
    assert.deepEqual(
      { name: customMatches[0].name, custom: customMatches[0].custom },
      { name: 'Work Bench', custom: true },
    );

    await fs.rm(customDir, { recursive: true, force: true });
    roots = await json('/api/roots');
    assert.equal(roots.roots.some((r) => r.path === customDir), false, 'missing custom roots should be hidden');

    await fs.mkdir(customDir, { recursive: true });
    await json('/api/roots/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: `http://localhost:${roots.port || 4567}` },
      body: JSON.stringify({ path: customDir }),
    });
    roots = await json('/api/roots');
    assert.equal(roots.roots.some((r) => r.path === customDir), false, 'removed custom root should disappear');

    const defaultPath = home;
    await json('/api/roots/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: `http://localhost:${roots.port || 4567}` },
      body: JSON.stringify({ path: defaultPath }),
    });
    roots = await json('/api/roots');
    assert.equal(roots.roots.some((r) => r.path === defaultPath), false, 'removed default root should be hidden');
  });
});
