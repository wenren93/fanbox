'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

async function freePortPair() {
  for (let i = 0; i < 50; i++) {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const available = await Promise.all([port, port + 1].map((p) => new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.listen(p, '127.0.0.1', () => server.close(() => resolve(true)));
    })));
    if (available.every(Boolean)) return port;
  }
  throw new Error('could not find two adjacent ports');
}

test('path-info resolves folders, files, tilde, file URLs, and cwd-relative paths', async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'fanbox-goto-home-'));
  const cwd = path.join(home, 'Work Bench');
  const file = path.join(cwd, 'hello world.md');
  const moduleFile = path.join(cwd, 'main.mts');
  await fs.mkdir(cwd, { recursive: true });
  await fs.writeFile(file, '# hello', 'utf8');
  await fs.writeFile(moduleFile, 'export const ready = true;', 'utf8');
  const port = await freePortPair();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, HOME: home, FANBOX_PORT: String(port), FANBOX_NO_OPEN: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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
    try { if ((await fetch(`http://127.0.0.1:${port}/api/roots`)).ok) break; } catch { /* wait */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const info = async (input, base = cwd) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/path-info?path=${encodeURIComponent(input)}&cwd=${encodeURIComponent(base)}`);
    assert.equal(response.status, 200);
    return response.json();
  };

  const folder = await info('~/Work Bench');
  assert.deepEqual({ ok: folder.ok, path: folder.path, isDir: folder.isDir }, { ok: true, path: cwd, isDir: true });
  const relative = await info('hello world.md');
  assert.deepEqual({ ok: relative.ok, path: relative.path, parent: relative.parent, kind: relative.kind }, { ok: true, path: file, parent: cwd, kind: 'text' });
  const moduleInfo = await info('main.mts');
  assert.deepEqual({ ok: moduleInfo.ok, path: moduleInfo.path, parent: moduleInfo.parent, kind: moduleInfo.kind }, { ok: true, path: moduleFile, parent: cwd, kind: 'text' });
  const url = await info(`file://${file}`);
  assert.equal(url.path, file);
  const escaped = await info('hello\\ world.md');
  assert.equal(escaped.path, file);
  const missing = await info('missing.txt');
  assert.deepEqual(missing, { ok: false, error: '找不到这个路径' });
});
