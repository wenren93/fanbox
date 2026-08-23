'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileP = promisify(execFile);
const REPO = path.join(__dirname, '..');

async function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer().unref();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

async function freePortPair() {
  for (let i = 0; i < 50; i++) {
    const port = 21000 + Math.floor(Math.random() * 18000);
    if (await canListen(port) && await canListen(port + 1)) return port;
  }
  throw new Error('no free port pair');
}

async function startServer(t, extraEnv = {}) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'fanbox-discovery-home-'));
  const port = await freePortPair();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: REPO,
    env: { ...process.env, HOME: home, FANBOX_PORT: String(port), FANBOX_NO_OPEN: '1', NODE_ENV: 'test', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (d) => { logs += d; });
  child.stderr.on('data', (d) => { logs += d; });
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM'); await exited;
    }
    await fs.rm(home, { recursive: true, force: true });
  });
  for (let i = 0; i < 125; i++) {
    if (child.exitCode !== null) throw new Error(`server exited\n${logs}`);
    try { if ((await fetch(`http://127.0.0.1:${port}/api/roots`)).ok) break; } catch { /* wait */ }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  const request = async (url, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${url}`, body === undefined ? undefined : {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `http://localhost:${port}` }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  return { home, request };
}

async function fakeUpstream(t, responder) {
  const port = await freePortPair();
  const requests = [];
  const server = http.createServer(async (req, res) => {
    requests.push(new URL(req.url, `http://127.0.0.1:${port}`));
    await responder(req, res, requests.length);
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { origin: `http://127.0.0.1:${port}`, requests };
}

test('Discovery search submits bounded query, preserves order, caps results, and reuses ten-minute success', async (t) => {
  const upstream = await fakeUpstream(t, (_req, res) => {
    const skills = Array.from({ length: 25 }, (_, i) => ({ id: `owner/repo/skill-${i}`, skillId: `skill-${i}`, name: `skill-${i}`, source: `owner/repo`, installs: 25 - i }));
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ query: '中文', skills }));
  });
  const { request } = await startServer(t, { FANBOX_SKILLS_SEARCH_URL: `${upstream.origin}/api/search` });
  assert.equal((await request('/api/skills/discovery/search', { query: '   ' })).body.status, 'empty_query');
  const first = await request('/api/skills/discovery/search', { query: ' 中文 ' });
  assert.equal(first.body.ok, true);
  assert.equal(first.body.results.length, 20);
  assert.equal(first.body.results[0].name, 'skill-0');
  assert.deepEqual([...upstream.requests[0].searchParams.entries()], [['q', '中文'], ['limit', '20']]);
  const second = await request('/api/skills/discovery/search', { query: '中文' });
  assert.equal(second.body.reused, true);
  assert.equal(upstream.requests.length, 1);
});

test('Discovery rejects malformed upstream data and falls back only to a recent display-only cache', async (t) => {
  let mode = 'ok';
  const upstream = await fakeUpstream(t, (_req, res) => {
    if (mode === 'ok') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ skills: [{ id: 'owner/repo/fixture', skillId: 'fixture', name: 'fixture', source: 'owner/repo', installs: 7 }] }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"skills":[{"name":9}]}');
    }
  });
  const { request } = await startServer(t, { FANBOX_SKILLS_SEARCH_URL: `${upstream.origin}/api/search`, FANBOX_DISCOVERY_CACHE_MAX_AGE_MS: '86400000' });
  assert.equal((await request('/api/skills/discovery/search', { query: 'fixture' })).body.ok, true);
  mode = 'bad';
  const fallback = await request('/api/skills/discovery/search', { query: 'different' });
  assert.equal(fallback.body.ok, false);
  assert.equal(fallback.body.cached, true);
  assert.equal(fallback.body.installable, false);
  assert.equal(fallback.body.results[0].name, 'fixture');
  assert.equal(fallback.body.cachedQuery, 'fixture');
});

test('Discovery discards an expired cache instead of presenting stale entries', async (t) => {
  const upstream = await fakeUpstream(t, (_req, res) => {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'offline' }));
  });
  const { request, home } = await startServer(t, { FANBOX_SKILLS_SEARCH_URL: `${upstream.origin}/api/search` });
  const cacheFile = path.join(home, '.fanbox', 'skill-discovery-cache.json');
  await fs.mkdir(path.dirname(cacheFile), { recursive: true });
  await fs.writeFile(cacheFile, JSON.stringify({
    version: 1,
    at: Date.now() - 24 * 60 * 60 * 1000 - 1,
    query: 'old-query',
    results: [{ id: 'owner/repo/old', skillId: 'old', name: 'old', repository: 'owner/repo', installs: 1 }],
  }));
  const response = await request('/api/skills/discovery/search', { query: 'new-query' });
  assert.equal(response.body.ok, false);
  assert.equal(response.body.cached, false);
  assert.deepEqual(response.body.results, []);
  await assert.rejects(fs.stat(cacheFile), { code: 'ENOENT' });
});

test('Discovery distinguishes rate limiting from a legitimate empty result', async (t) => {
  let limited = false;
  const upstream = await fakeUpstream(t, (_req, res) => {
    if (limited) { res.writeHead(429, { 'Content-Type': 'application/json' }); res.end('{}'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ skills: [] }));
  });
  const { request, home } = await startServer(t, { FANBOX_SKILLS_SEARCH_URL: `${upstream.origin}/api/search` });
  const empty = await request('/api/skills/discovery/search', { query: 'nothing' });
  assert.equal(empty.body.ok, true);
  assert.equal(empty.body.status, 'empty');
  await fs.rm(path.join(home, '.fanbox', 'skill-discovery-cache.json'), { force: true });
  limited = true;
  const rateLimited = await request('/api/skills/discovery/search', { query: 'another-query' });
  assert.equal(rateLimited.body.ok, false);
  assert.equal(rateLimited.body.status, 'rate_limited');
  assert.notEqual(rateLimited.body.status, 'empty');
});

test('Discovery rejects response aliases outside the narrow skills.sh schema', async (t) => {
  const upstream = await fakeUpstream(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ results: [{ id: 'owner/repo/fixture', name: 'fixture', repository: 'owner/repo', downloads: 7 }] }));
  });
  const { request } = await startServer(t, { FANBOX_SKILLS_SEARCH_URL: `${upstream.origin}/api/search` });
  const response = await request('/api/skills/discovery/search', { query: 'fixture' });
  assert.equal(response.body.ok, false);
  assert.equal(response.body.cached, false);
  assert.match(response.body.error, /响应格式/);
});

async function makeFixtureRepository(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fanbox-discovery-repo-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const skillDir = path.join(dir, 'skills', 'fixture-skill');
  await fs.mkdir(path.join(skillDir, 'references', 'empty'), { recursive: true });
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), [
    '---',
    'name: fixture-skill',
    'description: >-',
    '  Fixed fixture with a folded',
    '  YAML description',
    'license: MIT',
    'allowed-tools: [Read, Bash]',
    'metadata:',
    '  dependencies:',
    '    - local-runtime >= 1',
    '---',
    '',
  ].join('\n'), 'utf8');
  await fs.writeFile(path.join(skillDir, 'references', 'note.txt'), 'hello', 'utf8');
  await fs.writeFile(path.join(skillDir, 'references', 'package.json'), '{}\n', 'utf8');
  await fs.writeFile(path.join(skillDir, 'references', 'asset.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]));
  await fs.writeFile(path.join(skillDir, 'run.sh'), '#!/bin/sh\necho fixture\n', { mode: 0o755 });
  await execFileP('git', ['init', '-q'], { cwd: dir });
  await execFileP('git', ['add', '.'], { cwd: dir });
  await execFileP('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=Fixture', 'commit', '-qm', 'fixture'], { cwd: dir });
  const sha = (await execFileP('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim();
  const archive = path.join(dir, 'fixture.tar.gz');
  await execFileP('git', ['archive', '--format=tar.gz', `--prefix=repo-${sha}/`, '-o', archive, sha], { cwd: dir });
  return { dir, sha, archive };
}

async function makeRepositoryArchive(t, name, populate) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fanbox-discovery-limits-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const skillDir = path.join(dir, name);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), `---\nname: ${name}\ndescription: limits fixture\nlicense: MIT\n---\n`);
  await populate(skillDir);
  await execFileP('git', ['init', '-q'], { cwd: dir });
  await execFileP('git', ['add', '.'], { cwd: dir });
  await execFileP('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=Fixture', 'commit', '-qm', 'fixture'], { cwd: dir });
  const sha = (await execFileP('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim();
  const archive = path.join(dir, 'fixture.tar.gz');
  await execFileP('git', ['archive', '--format=tar.gz', `--prefix=repo-${sha}/`, '-o', archive, sha], { cwd: dir });
  return { dir, sha, archive, name };
}

function tarField(header, offset, length, value) {
  const encoded = `${Number(value).toString(8).padStart(length - 1, '0')}\0`;
  header.write(encoded.slice(-length), offset, length, 'ascii');
}

function makeTar(entries) {
  const blocks = [];
  for (const entry of entries) {
    const content = Buffer.from(entry.content || '');
    const header = Buffer.alloc(512);
    header.write(entry.name, 0, 100, 'utf8');
    tarField(header, 100, 8, entry.mode ?? 0o644);
    tarField(header, 108, 8, 0);
    tarField(header, 116, 8, 0);
    tarField(header, 124, 12, content.length);
    tarField(header, 136, 12, Math.floor(Date.now() / 1000));
    header.fill(0x20, 148, 156);
    header.write(entry.type || '0', 156, 1, 'ascii');
    if (entry.linkname) header.write(entry.linkname, 157, 100, 'utf8');
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
    blocks.push(header, content, Buffer.alloc((512 - (content.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocks));
}

test('Inspection pins a full SHA, reports deterministic risks, then installs to every controlled target with source identity', async (t) => {
  if (process.platform !== 'darwin') return t.skip('external installation is macOS-only');
  const fixture = await makeFixtureRepository(t);
  const { request, home } = await startServer(t, {
    FANBOX_TEST_DISCOVERY_GIT_REPO: fixture.dir,
    FANBOX_TEST_DISCOVERY_ARCHIVE: fixture.archive,
  });
  const entry = { id: 'owner/repo/fixture-skill', name: 'fixture-skill', skillId: 'fixture-skill', source: 'owner/repo', installs: 1 };
  for (const targetAgent of ['claude', 'codex', 'agents', 'workbuddy']) {
    const inspected = await request('/api/skills/discovery/inspect', { entry });
    assert.equal(inspected.body.ok, true, JSON.stringify(inspected.body));
    assert.match(inspected.body.inspection.commit, /^[a-f0-9]{40}$/);
    assert.equal(inspected.body.inspection.name, 'fixture-skill');
    assert.equal(inspected.body.inspection.description, 'Fixed fixture with a folded YAML description');
    assert.equal(inspected.body.inspection.enhancedConfirmation, true);
    assert.ok(inspected.body.inspection.files.some((f) => f.path === 'run.sh'));
    assert.deepEqual(inspected.body.inspection.binaries, ['references/asset.bin']);
    assert.deepEqual(inspected.body.inspection.dependencies, ['references/package.json', 'local-runtime >= 1']);
    const installed = await request('/api/skills/discovery/install', { inspectionId: inspected.body.inspection.id, targetAgent });
    assert.equal(installed.body.ok, true, JSON.stringify(installed.body));
    const root = { claude: '.claude', codex: '.codex', agents: '.agents', workbuddy: '.workbuddy' }[targetAgent];
    const target = path.join(home, root, 'skills', 'fixture-skill');
    assert.equal(await fs.readFile(path.join(target, 'references', 'note.txt'), 'utf8'), 'hello');
    assert.deepEqual(await fs.readFile(path.join(target, 'references', 'asset.bin')), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]));
    assert.equal((await fs.stat(path.join(target, 'run.sh'))).mode & 0o777, 0o755);
    assert.equal((await fs.stat(path.join(target, 'SKILL.md'))).mode & 0o777, 0o644);
  }
  const records = JSON.parse(await fs.readFile(path.join(home, '.fanbox', 'skill-sources.json'), 'utf8'));
  const installations = records.installations || records;
  assert.equal(Object.keys(installations).length, 4);
  for (const record of Object.values(installations)) {
    assert.equal(record.repository, 'github.com/owner/repo');
    assert.equal(record.skillPath, 'skills/fixture-skill');
    assert.equal(record.commit, fixture.sha);
    assert.match(record.contentHash, /^[a-f0-9]{64}$/);
  }
  const reinspected = await request('/api/skills/discovery/inspect', { entry });
  assert.equal(reinspected.body.inspection.actionLabel, '重新安装');
  const identical = await request('/api/skills/discovery/install', {
    inspectionId: reinspected.body.inspection.id, targetAgent: 'codex', acknowledge: true,
  });
  assert.equal(identical.body.status, 'identical');
});

test('Inspection blocks unsupported source and invalid controlled target input', async (t) => {
  const { request } = await startServer(t);
  const unsupported = await request('/api/skills/discovery/inspect', { entry: { id: 'elsewhere/x', name: 'x', skillId: 'x', source: 'https://example.com/x', installs: 1 } });
  assert.equal(unsupported.body.ok, false);
  assert.equal(unsupported.body.status, 'unsupported_source');
  const invalidTarget = await request('/api/skills/discovery/install', { inspectionId: 'not-a-token', targetAgent: '/tmp/custom' });
  assert.equal(invalidTarget.status, 400);
});

test('Discovery settings expose missing installation prerequisites without disabling search', async (t) => {
  const upstream = await fakeUpstream(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ skills: [{ id: 'owner/repo/fixture', name: 'fixture', source: 'owner/repo', installs: 1 }] }));
  });
  const { request } = await startServer(t, {
    PATH: '/fanbox-test-path-without-git',
    FANBOX_SKILLS_SEARCH_URL: `${upstream.origin}/api/search`,
  });
  const settings = await request('/api/skills/discovery/settings');
  assert.equal(settings.body.ok, true);
  assert.equal(settings.body.installationPrerequisite.ok, false);
  // 预检按平台短路：非 macOS 先报不支持平台，缺 Git 只在 macOS 上才轮得到
  assert.equal(settings.body.installationPrerequisite.status,
    process.platform === 'darwin' ? 'missing_git' : 'unsupported_platform');
  const searched = await request('/api/skills/discovery/search', { query: 'fixture' });
  assert.equal(searched.body.ok, true);
  assert.equal(searched.body.results.length, 1);
  assert.equal((await request('/api/skills/discovery/settings', { defaultTargetAgent: 'workbuddy' })).body.ok, true);
  const remembered = await request('/api/skills/discovery/settings');
  assert.equal(remembered.body.defaultTargetAgent, 'workbuddy');
});

test('Archive inspection rejects links and leaves controlled targets untouched', async (t) => {
  if (process.platform !== 'darwin') return t.skip('external installation is macOS-only');
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'fanbox-discovery-unsafe-'));
  t.after(() => fs.rm(repo, { recursive: true, force: true }));
  const skillDir = path.join(repo, 'unsafe-skill');
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: unsafe-skill\ndescription: unsafe fixture\nlicense: MIT\n---\n');
  await fs.symlink('/etc/passwd', path.join(skillDir, 'leak'));
  await execFileP('git', ['init', '-q'], { cwd: repo });
  await execFileP('git', ['add', '.'], { cwd: repo });
  await execFileP('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=Fixture', 'commit', '-qm', 'fixture'], { cwd: repo });
  const sha = (await execFileP('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();
  const archive = path.join(repo, 'unsafe.tar.gz');
  await execFileP('git', ['archive', '--format=tar.gz', `--prefix=repo-${sha}/`, '-o', archive, sha], { cwd: repo });
  const { request, home } = await startServer(t, { FANBOX_TEST_DISCOVERY_GIT_REPO: repo, FANBOX_TEST_DISCOVERY_ARCHIVE: archive });
  const inspected = await request('/api/skills/discovery/inspect', { entry: { id: 'owner/repo/unsafe-skill', name: 'unsafe-skill', skillId: 'unsafe-skill', source: 'owner/repo', installs: 1 } });
  assert.equal(inspected.body.ok, false);
  assert.match(inspected.body.status, /blocked|unsafe/);
  await assert.rejects(fs.stat(path.join(home, '.codex', 'skills', 'unsafe-skill')), { code: 'ENOENT' });
});

test('Archive inspection blocks unsafe names, hard links, special files, and special permission bits', async (t) => {
  if (process.platform !== 'darwin') return t.skip('external installation is macOS-only');
  const repository = await makeRepositoryArchive(t, 'archive-safety-skill', async () => {});
  const cases = [
    { label: 'absolute path', entry: { name: '/tmp/fanbox-escape', content: 'x' }, error: /不安全路径/ },
    { label: 'parent traversal', entry: { name: 'repo/../fanbox-escape', content: 'x' }, error: /不安全路径/ },
    { label: 'hard link', entry: { name: 'repo/hard', type: '1', linkname: 'repo/source' }, error: /硬链接/ },
    { label: 'character device', entry: { name: 'repo/device', type: '3' }, error: /设备|特殊文件/ },
    { label: 'FIFO', entry: { name: 'repo/pipe', type: '6' }, error: /FIFO|特殊文件/ },
    { label: 'SUID mode', entry: { name: 'repo/suid', mode: 0o4755, content: '#!/bin/sh\n' }, error: /特殊权限/ },
  ];
  for (const unsafe of cases) {
    await t.test(unsafe.label, async (t) => {
      const archiveDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fanbox-discovery-raw-tar-'));
      t.after(() => fs.rm(archiveDir, { recursive: true, force: true }));
      const archive = path.join(archiveDir, 'unsafe.tar.gz');
      await fs.writeFile(archive, makeTar([unsafe.entry]));
      const { request, home } = await startServer(t, {
        FANBOX_TEST_DISCOVERY_GIT_REPO: repository.dir,
        FANBOX_TEST_DISCOVERY_ARCHIVE: archive,
      });
      const inspected = await request('/api/skills/discovery/inspect', {
        entry: { id: 'owner/repo/archive-safety-skill', name: 'archive-safety-skill', skillId: 'archive-safety-skill', source: 'owner/repo', installs: 1 },
      });
      assert.equal(inspected.body.ok, false, JSON.stringify(inspected.body));
      assert.equal(inspected.body.status, 'unsafe_content');
      assert.match(inspected.body.error, unsafe.error);
      await assert.rejects(fs.stat(path.join(home, '.codex', 'skills', 'archive-safety-skill')), { code: 'ENOENT' });
    });
  }
});

test('Archive inspection rejects a compressed stream above 10 MiB before extraction', async (t) => {
  if (process.platform !== 'darwin') return t.skip('external installation is macOS-only');
  const repository = await makeRepositoryArchive(t, 'compressed-limit-skill', async () => {});
  const archiveDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fanbox-discovery-compressed-limit-'));
  t.after(() => fs.rm(archiveDir, { recursive: true, force: true }));
  const archive = path.join(archiveDir, 'oversized.tar.gz');
  await fs.writeFile(archive, crypto.randomBytes(10 * 1024 * 1024 + 1));
  const { request, home } = await startServer(t, {
    FANBOX_TEST_DISCOVERY_GIT_REPO: repository.dir,
    FANBOX_TEST_DISCOVERY_ARCHIVE: archive,
  });
  const inspected = await request('/api/skills/discovery/inspect', {
    entry: { id: 'owner/repo/compressed-limit-skill', name: 'compressed-limit-skill', skillId: 'compressed-limit-skill', source: 'owner/repo', installs: 1 },
  });
  assert.equal(inspected.body.ok, false);
  assert.equal(inspected.body.status, 'unsafe_content');
  assert.match(inspected.body.error, /归档超过 10 MiB/);
  await assert.rejects(fs.stat(path.join(home, '.codex', 'skills', 'compressed-limit-skill')), { code: 'ENOENT' });
});

test('Archive inspection enforces per-file, expanded-size, and file-count limits', async (t) => {
  if (process.platform !== 'darwin') return t.skip('external installation is macOS-only');
  const cases = [
    await makeRepositoryArchive(t, 'large-file-skill', async (skillDir) => {
      await fs.writeFile(path.join(skillDir, 'too-large.txt'), Buffer.alloc(10 * 1024 * 1024 + 1, 0x61));
    }),
    await makeRepositoryArchive(t, 'expanded-skill', async (skillDir) => {
      for (let i = 0; i < 3; i++) await fs.writeFile(path.join(skillDir, `large-${i}.txt`), Buffer.alloc(9 * 1024 * 1024, 0x61 + i));
    }),
    await makeRepositoryArchive(t, 'many-files-skill', async (skillDir) => {
      const files = path.join(skillDir, 'files');
      await fs.mkdir(files);
      await Promise.all(Array.from({ length: 1000 }, (_, i) => fs.writeFile(path.join(files, `f-${i}.txt`), 'x')));
    }),
  ];
  const expected = [/单个文件超过 10 MiB/, /解包内容超过 25 MiB/, /解包文件数超过 1,000 个/];
  for (let index = 0; index < cases.length; index++) {
    const fixture = cases[index];
    const { request, home } = await startServer(t, {
      FANBOX_TEST_DISCOVERY_GIT_REPO: fixture.dir,
      FANBOX_TEST_DISCOVERY_ARCHIVE: fixture.archive,
    });
    const inspected = await request('/api/skills/discovery/inspect', {
      entry: { id: `owner/repo/${fixture.name}`, name: fixture.name, skillId: fixture.name, source: 'owner/repo', installs: 1 },
    });
    assert.equal(inspected.body.ok, false, JSON.stringify(inspected.body));
    assert.equal(inspected.body.status, 'unsafe_content');
    assert.match(inspected.body.error, expected[index]);
    await assert.rejects(fs.stat(path.join(home, '.codex', 'skills', fixture.name)), { code: 'ENOENT' });
  }
});

test('Inspection validates the entire executable file as UTF-8 before treating it as a script', async (t) => {
  if (process.platform !== 'darwin') return t.skip('external installation is macOS-only');
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'fanbox-discovery-late-binary-'));
  t.after(() => fs.rm(repo, { recursive: true, force: true }));
  const skillDir = path.join(repo, 'late-binary-skill');
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: late-binary-skill\ndescription: late binary fixture\nlicense: MIT\n---\n');
  const executable = path.join(skillDir, 'looks-like-text.sh');
  await fs.writeFile(executable, Buffer.concat([Buffer.from('#!/bin/sh\n#' + 'a'.repeat(9000)), Buffer.from([0xff, 0xfe])]));
  await fs.chmod(executable, 0o755);
  await execFileP('git', ['init', '-q'], { cwd: repo });
  await execFileP('git', ['add', '.'], { cwd: repo });
  await execFileP('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=Fixture', 'commit', '-qm', 'fixture'], { cwd: repo });
  const sha = (await execFileP('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();
  const archive = path.join(repo, 'late-binary.tar.gz');
  await execFileP('git', ['archive', '--format=tar.gz', `--prefix=repo-${sha}/`, '-o', archive, sha], { cwd: repo });
  const { request, home } = await startServer(t, {
    FANBOX_TEST_DISCOVERY_GIT_REPO: repo,
    FANBOX_TEST_DISCOVERY_ARCHIVE: archive,
  });
  const inspected = await request('/api/skills/discovery/inspect', {
    entry: { id: 'owner/repo/late-binary-skill', name: 'late-binary-skill', skillId: 'late-binary-skill', source: 'owner/repo', installs: 1 },
  });
  assert.equal(inspected.body.ok, false);
  assert.equal(inspected.body.status, 'unsafe_content');
  assert.match(inspected.body.error, /未知可执行二进制/);
  await assert.rejects(fs.stat(path.join(home, '.codex', 'skills', 'late-binary-skill')), { code: 'ENOENT' });
});

test('Inspection rejects a SKILL.md that is not valid UTF-8', async (t) => {
  if (process.platform !== 'darwin') return t.skip('external installation is macOS-only');
  const fixture = await makeRepositoryArchive(t, 'invalid-utf8-skill', async (skillDir) => {
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), Buffer.from([
      ...Buffer.from('---\nname: invalid-utf8-skill\ndescription: invalid '),
      0xff,
      ...Buffer.from('\n---\n'),
    ]));
  });
  const { request, home } = await startServer(t, {
    FANBOX_TEST_DISCOVERY_GIT_REPO: fixture.dir,
    FANBOX_TEST_DISCOVERY_ARCHIVE: fixture.archive,
  });
  const inspected = await request('/api/skills/discovery/inspect', {
    entry: {
      id: 'owner/repo/invalid-utf8-skill', name: 'invalid-utf8-skill',
      skillId: 'invalid-utf8-skill', source: 'owner/repo', installs: 1,
    },
  });
  assert.equal(inspected.body.ok, false);
  assert.equal(inspected.body.status, 'no_matching_candidate');
  await assert.rejects(fs.stat(path.join(home, '.codex', 'skills', 'invalid-utf8-skill')), { code: 'ENOENT' });
});

test('Unknown existing target requires explicit replacement and uninstall removes its source record', async (t) => {
  if (process.platform !== 'darwin') return t.skip('external installation is macOS-only');
  const fixture = await makeFixtureRepository(t);
  const trash = await fs.mkdtemp(path.join(os.tmpdir(), 'fanbox-discovery-trash-'));
  t.after(() => fs.rm(trash, { recursive: true, force: true }));
  const { request, home } = await startServer(t, {
    FANBOX_TEST_DISCOVERY_GIT_REPO: fixture.dir,
    FANBOX_TEST_DISCOVERY_ARCHIVE: fixture.archive,
    FANBOX_TEST_SKILL_TRASH: trash,
  });
  const target = path.join(home, '.codex', 'skills', 'fixture-skill');
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, 'SKILL.md'), '---\nname: fixture-skill\ndescription: local fixture\n---\n');
  const entry = { id: 'owner/repo/fixture-skill', name: 'fixture-skill', skillId: 'fixture-skill', source: 'owner/repo', installs: 1 };
  const inspected = await request('/api/skills/discovery/inspect', { entry });
  assert.equal(inspected.body.ok, true);
  const first = await request('/api/skills/discovery/install', { inspectionId: inspected.body.inspection.id, targetAgent: 'codex', acknowledge: true });
  assert.equal(first.body.status, 'unknown_conflict');
  const replaced = await request('/api/skills/discovery/install', {
    inspectionId: inspected.body.inspection.id, targetAgent: 'codex', acknowledge: true,
    overwrite: true,
    expectedTargetHash: first.body.expectedTargetHash || first.body.targetHash,
    conflictFingerprint: first.body.conflictFingerprint,
  });
  assert.equal(replaced.body.ok, true, JSON.stringify(replaced.body));
  const removed = await request('/api/skills/trash', { dir: target });
  assert.equal(removed.body.ok, true);
  const records = JSON.parse(await fs.readFile(path.join(home, '.fanbox', 'skill-sources.json'), 'utf8'));
  assert.equal(Object.keys(records.installations || records).length, 0);
});

test('Uninstall restores the installation when removing its source record fails', async (t) => {
  if (process.platform !== 'darwin') return t.skip('external installation is macOS-only');
  const fixture = await makeFixtureRepository(t);
  const trash = await fs.mkdtemp(path.join(os.tmpdir(), 'fanbox-discovery-uninstall-rollback-trash-'));
  t.after(() => fs.rm(trash, { recursive: true, force: true }));
  const { request, home } = await startServer(t, {
    FANBOX_TEST_DISCOVERY_GIT_REPO: fixture.dir,
    FANBOX_TEST_DISCOVERY_ARCHIVE: fixture.archive,
    FANBOX_TEST_SKILL_TRASH: trash,
    FANBOX_TEST_DISCOVERY_RECORD_FAIL: 'remove',
  });
  const entry = { id: 'owner/repo/fixture-skill', name: 'fixture-skill', skillId: 'fixture-skill', source: 'owner/repo', installs: 1 };
  const inspected = await request('/api/skills/discovery/inspect', { entry });
  assert.equal((await request('/api/skills/discovery/install', {
    inspectionId: inspected.body.inspection.id, targetAgent: 'codex', acknowledge: true,
  })).body.ok, true);
  const target = path.join(home, '.codex', 'skills', 'fixture-skill');
  const removed = await request('/api/skills/trash', { dir: target });
  assert.equal(removed.body.ok, false);
  assert.equal(await fs.readFile(path.join(target, 'references', 'note.txt'), 'utf8'), 'hello');
  assert.deepEqual(await fs.readdir(trash), []);
  const records = JSON.parse(await fs.readFile(path.join(home, '.fanbox', 'skill-sources.json'), 'utf8'));
  assert.ok(records.installations[path.resolve(target)]);
  const rootEntries = await fs.readdir(path.dirname(target));
  assert.deepEqual(rootEntries.filter((name) => name.startsWith('.fanbox-uninstall-')), []);
});

test('A source-record write failure leaves no visible new installation or phantom record', async (t) => {
  if (process.platform !== 'darwin') return t.skip('external installation is macOS-only');
  const fixture = await makeFixtureRepository(t);
  const { request, home } = await startServer(t, {
    FANBOX_TEST_DISCOVERY_GIT_REPO: fixture.dir,
    FANBOX_TEST_DISCOVERY_ARCHIVE: fixture.archive,
    FANBOX_TEST_DISCOVERY_RECORD_FAIL: 'install',
  });
  const entry = { id: 'owner/repo/fixture-skill', name: 'fixture-skill', skillId: 'fixture-skill', source: 'owner/repo', installs: 1 };
  const inspected = await request('/api/skills/discovery/inspect', { entry });
  const result = await request('/api/skills/discovery/install', {
    inspectionId: inspected.body.inspection.id, targetAgent: 'codex', acknowledge: true,
  });
  assert.equal(result.body.status, 'install_failed');
  const target = path.join(home, '.codex', 'skills', 'fixture-skill');
  await assert.rejects(fs.stat(target), { code: 'ENOENT' });
  const records = JSON.parse(await fs.readFile(path.join(home, '.fanbox', 'skill-sources.json'), 'utf8'));
  assert.deepEqual(records.installations, {});
  const rootEntries = await fs.readdir(path.dirname(target));
  assert.deepEqual(rootEntries.filter((name) => name.startsWith('.fanbox-discovery-')), []);
});

test('Trash failure during an update restores old files and old source metadata', async (t) => {
  if (process.platform !== 'darwin') return t.skip('external installation is macOS-only');
  const fixture = await makeFixtureRepository(t);
  const { request, home } = await startServer(t, {
    FANBOX_TEST_DISCOVERY_GIT_REPO: fixture.dir,
    FANBOX_TEST_DISCOVERY_ARCHIVE: fixture.archive,
    FANBOX_TEST_SKILL_IMPORT_FAIL: 'trash',
  });
  const entry = { id: 'owner/repo/fixture-skill', name: 'fixture-skill', skillId: 'fixture-skill', source: 'owner/repo', installs: 1 };
  const first = await request('/api/skills/discovery/inspect', { entry });
  assert.equal((await request('/api/skills/discovery/install', {
    inspectionId: first.body.inspection.id, targetAgent: 'codex', acknowledge: true,
  })).body.ok, true);
  const target = path.join(home, '.codex', 'skills', 'fixture-skill');
  const recordsBefore = await fs.readFile(path.join(home, '.fanbox', 'skill-sources.json'));
  await fs.writeFile(path.join(target, 'local-note.txt'), 'must survive rollback', 'utf8');
  const inspected = await request('/api/skills/discovery/inspect', { entry });
  const conflict = await request('/api/skills/discovery/install', {
    inspectionId: inspected.body.inspection.id, targetAgent: 'codex', acknowledge: true,
  });
  const failed = await request('/api/skills/discovery/install', {
    inspectionId: inspected.body.inspection.id, targetAgent: 'codex', acknowledge: true,
    overwrite: true, expectedTargetHash: conflict.body.expectedTargetHash,
  });
  assert.equal(failed.body.status, 'install_failed');
  assert.equal(await fs.readFile(path.join(target, 'local-note.txt'), 'utf8'), 'must survive rollback');
  assert.deepEqual(await fs.readFile(path.join(home, '.fanbox', 'skill-sources.json')), recordsBefore);
  const rootEntries = await fs.readdir(path.dirname(target));
  assert.deepEqual(rootEntries.filter((name) => name.startsWith('.fanbox-discovery-')), []);
});

test('Same-source reinstall detects local edits and requires a fresh explicit overwrite fingerprint', async (t) => {
  if (process.platform !== 'darwin') return t.skip('external installation is macOS-only');
  const fixture = await makeFixtureRepository(t);
  const trash = await fs.mkdtemp(path.join(os.tmpdir(), 'fanbox-discovery-update-trash-'));
  t.after(() => fs.rm(trash, { recursive: true, force: true }));
  const { request, home } = await startServer(t, {
    FANBOX_TEST_DISCOVERY_GIT_REPO: fixture.dir,
    FANBOX_TEST_DISCOVERY_ARCHIVE: fixture.archive,
    FANBOX_TEST_SKILL_TRASH: trash,
  });
  const entry = { id: 'owner/repo/fixture-skill', name: 'fixture-skill', skillId: 'fixture-skill', source: 'owner/repo', installs: 1 };
  const firstInspection = await request('/api/skills/discovery/inspect', { entry });
  assert.equal((await request('/api/skills/discovery/install', {
    inspectionId: firstInspection.body.inspection.id, targetAgent: 'codex', acknowledge: true,
  })).body.ok, true);
  const target = path.join(home, '.codex', 'skills', 'fixture-skill');
  await fs.writeFile(path.join(target, 'local-note.txt'), 'keep recoverable', 'utf8');
  const secondInspection = await request('/api/skills/discovery/inspect', { entry });
  const conflict = await request('/api/skills/discovery/install', {
    inspectionId: secondInspection.body.inspection.id, targetAgent: 'codex', acknowledge: true,
  });
  assert.equal(conflict.body.status, 'local_modified');
  assert.match(conflict.body.expectedTargetHash, /^[a-f0-9]{64}$/);
  const stale = '0'.repeat(64);
  assert.equal((await request('/api/skills/discovery/install', {
    inspectionId: secondInspection.body.inspection.id, targetAgent: 'codex', acknowledge: true,
    overwrite: true, expectedTargetHash: stale,
  })).body.status, 'concurrent_changed');
  const updated = await request('/api/skills/discovery/install', {
    inspectionId: secondInspection.body.inspection.id, targetAgent: 'codex', acknowledge: true,
    overwrite: true, expectedTargetHash: conflict.body.expectedTargetHash,
  });
  assert.equal(updated.body.ok, true, JSON.stringify(updated.body));
  await assert.rejects(fs.stat(path.join(target, 'local-note.txt')), { code: 'ENOENT' });
  const trashed = await fs.readdir(trash);
  assert.equal(trashed.length, 1);
  assert.equal(await fs.readFile(path.join(trash, trashed[0], 'local-note.txt'), 'utf8'), 'keep recoverable');
});

test('Same Skill name in another target directory is blocked without guessing identity', async (t) => {
  if (process.platform !== 'darwin') return t.skip('external installation is macOS-only');
  const fixture = await makeFixtureRepository(t);
  const { request, home } = await startServer(t, { FANBOX_TEST_DISCOVERY_GIT_REPO: fixture.dir, FANBOX_TEST_DISCOVERY_ARCHIVE: fixture.archive });
  const existing = path.join(home, '.codex', 'skills', 'different-folder');
  await fs.mkdir(existing, { recursive: true });
  await fs.writeFile(path.join(existing, 'SKILL.md'), '---\nname: fixture-skill\ndescription: existing\n---\n');
  const inspected = await request('/api/skills/discovery/inspect', { entry: { id: 'owner/repo/fixture-skill', name: 'fixture-skill', skillId: 'fixture-skill', source: 'owner/repo', installs: 1 } });
  const result = await request('/api/skills/discovery/install', { inspectionId: inspected.body.inspection.id, targetAgent: 'codex', acknowledge: true });
  assert.equal(result.body.status, 'different_source_conflict');
  assert.equal(result.body.conflict.dir, existing);
  await assert.rejects(fs.stat(path.join(home, '.codex', 'skills', 'fixture-skill')), { code: 'ENOENT' });
});

test('Matching Skill with a mismatched frontmatter name is blocked instead of disappearing as no candidate', async (t) => {
  if (process.platform !== 'darwin') return t.skip('external installation is macOS-only');
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'fanbox-discovery-mismatch-'));
  t.after(() => fs.rm(repo, { recursive: true, force: true }));
  const skillDir = path.join(repo, 'fixture-skill');
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: another-name\ndescription: mismatch\n---\n');
  await execFileP('git', ['init', '-q'], { cwd: repo });
  await execFileP('git', ['add', '.'], { cwd: repo });
  await execFileP('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=Fixture', 'commit', '-qm', 'fixture'], { cwd: repo });
  const sha = (await execFileP('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();
  const archive = path.join(repo, 'fixture.tar.gz');
  await execFileP('git', ['archive', '--format=tar.gz', `--prefix=repo-${sha}/`, '-o', archive, sha], { cwd: repo });
  const { request } = await startServer(t, { FANBOX_TEST_DISCOVERY_GIT_REPO: repo, FANBOX_TEST_DISCOVERY_ARCHIVE: archive });
  const inspected = await request('/api/skills/discovery/inspect', { entry: { id: 'owner/repo/fixture-skill', name: 'fixture-skill', skillId: 'fixture-skill', source: 'owner/repo', installs: 1 } });
  assert.equal(inspected.body.ok, false);
  assert.equal(inspected.body.status, 'name_mismatch');
  assert.match(inspected.body.error, /不一致/);
});

test('Concurrent installs are serialized and expose one complete installation', async (t) => {
  if (process.platform !== 'darwin') return t.skip('external installation is macOS-only');
  const fixture = await makeFixtureRepository(t);
  const { request, home } = await startServer(t, {
    FANBOX_TEST_DISCOVERY_GIT_REPO: fixture.dir,
    FANBOX_TEST_DISCOVERY_ARCHIVE: fixture.archive,
  });
  const entry = { id: 'owner/repo/fixture-skill', name: 'fixture-skill', skillId: 'fixture-skill', source: 'owner/repo', installs: 1 };
  const [first, second] = await Promise.all([
    request('/api/skills/discovery/inspect', { entry }),
    request('/api/skills/discovery/inspect', { entry }),
  ]);
  const results = await Promise.all([
    request('/api/skills/discovery/install', { inspectionId: first.body.inspection.id, targetAgent: 'codex', acknowledge: true }),
    request('/api/skills/discovery/install', { inspectionId: second.body.inspection.id, targetAgent: 'codex', acknowledge: true }),
  ]);
  assert.deepEqual(results.map((result) => result.body.status).sort(), ['identical', 'installed']);
  const target = path.join(home, '.codex', 'skills', 'fixture-skill');
  assert.equal(await fs.readFile(path.join(target, 'references', 'note.txt'), 'utf8'), 'hello');
  const rootEntries = await fs.readdir(path.dirname(target));
  assert.deepEqual(rootEntries.filter((name) => name.startsWith('.fanbox-discovery-')), []);
});
