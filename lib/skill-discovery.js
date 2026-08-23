'use strict';

// External Skill discovery and installation.  This module deliberately has no
// product/UI dependencies: the skills.sh provider, fixed-source inspection and
// controlled filesystem mutation are kept behind one service boundary.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { TextDecoder } = require('util');
const yaml = require('js-yaml');

const SEARCH_REUSE_MS = 10 * 60 * 1000;
const SEARCH_CACHE_MS = 24 * 60 * 60 * 1000;
const INSPECTION_MS = 30 * 60 * 1000;
const MAX_ARCHIVE = 10 * 1024 * 1024;
const MAX_EXPANDED = 25 * 1024 * 1024;
const MAX_FILE = 10 * 1024 * 1024;
const MAX_FILES = 1000;
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SCRIPT_EXT = new Set(['sh', 'bash', 'zsh', 'fish', 'js', 'mjs', 'cjs', 'ts', 'py', 'rb', 'pl', 'php', 'lua', 'command']);
const HIGH_PERMISSION_TOOLS = /(?:bash|shell|terminal|exec|write|edit|delete|computer|browser|network|fetch|curl|sudo)/i;

function safeError(error, fallback) {
  return error && typeof error.message === 'string' ? error.message.slice(0, 500) : fallback;
}

function atomicJSON(file, value) {
  return (async () => {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(5).toString('hex')}`;
    try {
      const handle = await fsp.open(tmp, 'w', 0o600);
      try { await handle.writeFile(JSON.stringify(value, null, 2)); await handle.sync(); } finally { await handle.close(); }
      await fsp.rename(tmp, file);
    } catch (error) { await fsp.rm(tmp, { force: true }).catch(() => {}); throw error; }
  })();
}

async function readJSON(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return fallback; }
}

function run(bin, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    let stdoutSize = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeout || 30000);
    child.stdout.on('data', (chunk) => {
      stdoutSize += chunk.length;
      if (stdoutSize <= (options.maxOutput || 2 * 1024 * 1024)) stdout.push(chunk);
      else child.kill('SIGKILL');
    });
    child.stderr.on('data', (chunk) => { if (stderr.reduce((n, b) => n + b.length, 0) < 128 * 1024) stderr.push(chunk); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      const out = Buffer.concat(stdout).toString('utf8');
      const err = Buffer.concat(stderr).toString('utf8').trim();
      if (code === 0) resolve(out);
      else reject(new Error(err || `${path.basename(bin)} 失败${signal ? ` (${signal})` : ''}`));
    });
  });
}

function normalizeQuery(input) {
  if (typeof input !== 'string') return '';
  return input.trim().replace(/\s+/g, ' ').slice(0, 120);
}

function normalizeSearchPayload(payload) {
  const raw = payload && !Array.isArray(payload) ? payload.skills : null;
  if (!Array.isArray(raw)) throw new Error('skills.sh 响应格式已变化');
  return raw.slice(0, 20).map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('skills.sh 返回了无效条目');
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const skillId = typeof item.skillId === 'string' ? item.skillId.trim() : '';
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const repository = typeof item.source === 'string' ? item.source.trim() : '';
    const installs = item.installs;
    if ((!id && !name) || !repository || !Number.isFinite(Number(installs)) || Number(installs) < 0) {
      throw new Error('skills.sh 返回条目缺少必需字段');
    }
    return {
      id: id || `${repository}#${name}`,
      skillId: skillId || name || id.split('/').filter(Boolean).pop(),
      name: name || skillId || id.split('/').filter(Boolean).pop(),
      repository,
      installs: Math.floor(Number(installs)),
      sourceUrl: repository.startsWith('http') ? repository : `https://github.com/${repository.replace(/^github\.com\//, '')}`,
      unchecked: true,
      upstreamIndex: index,
    };
  });
}

function parseGitHubSource(entry) {
  const source = String(entry && (entry.repository || entry.source || entry.sourceUrl) || '').trim();
  let value = source.replace(/^git\+/, '').replace(/\.git$/, '');
  let owner;
  let repo;
  let hintedPath = '';
  try {
    if (/^https?:\/\//i.test(value)) {
      const url = new URL(value);
      if (url.hostname.toLowerCase() !== 'github.com') return null;
      const parts = url.pathname.split('/').filter(Boolean);
      [owner, repo] = parts;
      if (parts[2] === 'tree' && parts.length > 4) hintedPath = parts.slice(4).join('/');
    } else {
      const parts = value.replace(/^github\.com\//i, '').split('/').filter(Boolean);
      [owner, repo] = parts;
      if (parts.length > 2) hintedPath = parts.slice(2).join('/');
    }
  } catch { return null; }
  if (!owner || !repo || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) return null;
  const canonical = `github.com/${owner.toLowerCase()}/${repo.toLowerCase()}`;
  return { owner, repo, canonical, hintedPath, url: `https://github.com/${owner}/${repo}`, gitUrl: `https://github.com/${owner}/${repo}.git` };
}

async function fetchJSON(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'FanBox-Skill-Discovery' }, signal: controller.signal });
    if (response.status === 429) { const error = new Error('skills.sh 请求过于频繁，请稍后重试'); error.code = 'rate_limited'; throw error; }
    if (!response.ok) throw new Error(`skills.sh 请求失败（HTTP ${response.status}）`);
    const text = await response.text();
    if (text.length > 2 * 1024 * 1024) throw new Error('skills.sh 响应过大');
    try { return JSON.parse(text); } catch { throw new Error('skills.sh 响应格式已变化'); }
  } finally { clearTimeout(timer); }
}

async function download(url, destination) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let handle;
  try {
    const response = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'FanBox-Skill-Installer' }, signal: controller.signal });
    if (!response.ok) throw new Error(response.status === 404 ? 'GitHub 仓库不可访问；私有仓库和认证暂不支持' : `GitHub codeload 下载失败（HTTP ${response.status}）`);
    if (Number(response.headers.get('content-length')) > MAX_ARCHIVE) throw new Error('归档超过 10 MiB 限制');
    handle = await fsp.open(destination, 'wx', 0o600);
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_ARCHIVE) { controller.abort(); throw new Error('归档超过 10 MiB 限制'); }
      await handle.write(chunk);
    }
    await handle.sync();
  } finally { clearTimeout(timer); if (handle) await handle.close().catch(() => {}); }
}

function safeArchiveName(name) {
  if (!name || name.includes('\0') || name.startsWith('/') || name.startsWith('\\')) return false;
  const normalized = name.replace(/\\/g, '/');
  return !normalized.split('/').some((part) => part === '..');
}

async function directoryStats(root) {
  let files = 0;
  let total = 0;
  const inodes = new Set();
  const visit = async (dir) => {
    for (const ent of await fsp.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, ent.name);
      const st = await fsp.lstat(file);
      const rel = path.relative(root, file).split(path.sep).join('/');
      if (!safeArchiveName(rel)) throw new Error(`归档含不安全路径：${rel}`);
      if (st.isSymbolicLink()) throw new Error(`归档含软链接：${rel}`);
      if (st.mode & 0o7000) throw new Error(`归档含特殊权限位：${rel}`);
      if (st.isDirectory()) { await visit(file); continue; }
      if (!st.isFile()) throw new Error(`归档含特殊文件：${rel}`);
      const inode = `${st.dev}:${st.ino}`;
      if (inodes.has(inode)) throw new Error(`归档含硬链接：${rel}`);
      inodes.add(inode);
      files++;
      total += st.size;
      if (st.size > MAX_FILE) throw new Error(`单个文件超过 10 MiB：${rel}`);
      if (files > MAX_FILES) throw new Error('解包文件数超过 1,000 个');
      if (total > MAX_EXPANDED) throw new Error('解包内容超过 25 MiB');
    }
  };
  await visit(root);
  return { files, total };
}

async function extractArchive(archive, extractRoot, tarBin) {
  const names = (await run(tarBin, ['-tf', archive], { timeout: 15000, maxOutput: 4 * 1024 * 1024 })).split(/\r?\n/).filter(Boolean);
  if (names.length > MAX_FILES + 100) throw new Error('归档条目数超过 1,000 个');
  for (const name of names) if (!safeArchiveName(name)) throw new Error(`归档含不安全路径：${name}`);
  const verbose = await run(tarBin, ['-tvf', archive], { timeout: 15000, maxOutput: 6 * 1024 * 1024 });
  for (const line of verbose.split(/\r?\n/).filter(Boolean)) {
    const type = line[0];
    if (type === 'l') throw new Error('归档含软链接');
    if (type === 'h') throw new Error('归档含硬链接');
    if (!['-', 'd'].includes(type)) throw new Error('归档含设备、FIFO 或其他特殊文件');
    const mode = line.slice(0, 10);
    if (/[sStT]/.test(mode)) throw new Error('归档含特殊权限位');
  }
  await fsp.mkdir(extractRoot, { recursive: true, mode: 0o700 });
  const extractionArgs = [
    '-xf', archive, '-C', extractRoot,
    '--no-same-owner', '--no-same-permissions', '--no-acls', '--no-xattrs', '--no-fflags', '--no-mac-metadata',
  ];
  let child = null;
  let monitorBusy = false;
  let monitorError = null;
  const extraction = new Promise((resolve, reject) => {
    child = spawn(tarBin, extractionArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
    const errors = [];
    const timer = setTimeout(() => { monitorError = new Error('解包超时'); child.kill('SIGKILL'); }, 30000);
    child.stderr.on('data', (chunk) => { if (errors.reduce((n, b) => n + b.length, 0) < 128 * 1024) errors.push(chunk); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (monitorError) reject(monitorError);
      else if (code === 0) resolve();
      else reject(new Error(Buffer.concat(errors).toString('utf8').trim() || '系统 tar 解包失败'));
    });
  });
  const monitor = setInterval(async () => {
    if (monitorBusy || monitorError) return;
    monitorBusy = true;
    try { await directoryStats(extractRoot); }
    catch (error) { monitorError = error; if (child) child.kill('SIGKILL'); }
    finally { monitorBusy = false; }
  }, 25);
  try { await extraction; } finally { clearInterval(monitor); }
  if (monitorError) throw monitorError;
  return directoryStats(extractRoot);
}

function parseFrontmatter(text) {
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  try {
    const parsed = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [String(key).toLowerCase(), value]));
  } catch { return null; }
}

function plainStrings(value) {
  if (typeof value === 'string') return [value.trim()].filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(plainStrings);
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, nested]) => {
    const values = plainStrings(nested);
    return values.length ? values.map((item) => `${key}: ${item}`) : [key];
  });
  return value === null || value === undefined ? [] : [String(value)];
}

async function isTextFile(file) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const stream = fs.createReadStream(file, { highWaterMark: 64 * 1024 });
  try {
    for await (const chunk of stream) {
      if (chunk.includes(0)) return false;
      decoder.decode(chunk, { stream: true });
    }
    decoder.decode();
    return true;
  } catch {
    return false;
  } finally {
    stream.destroy();
  }
}

async function inspectSkillTree(skillDir, repoRoot, frontmatter) {
  const files = [];
  const scripts = [];
  const binaries = [];
  let totalSize = 0;
  const visit = async (dir) => {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => Buffer.from(a.name).compare(Buffer.from(b.name)));
    for (const ent of entries) {
      const file = path.join(dir, ent.name);
      const st = await fsp.lstat(file);
      const rel = path.relative(skillDir, file).split(path.sep).join('/');
      if (st.isDirectory()) { files.push({ path: `${rel}/`, kind: 'directory', size: 0, executable: false }); await visit(file); continue; }
      const executable = !!(st.mode & 0o111);
      const text = await isTextFile(file);
      const extension = path.extname(ent.name).slice(1).toLowerCase();
      const script = text && (executable || SCRIPT_EXT.has(extension) || ent.name === 'Makefile');
      if (executable && !script) throw new Error(`未知可执行二进制被阻止：${rel}`);
      if (script) scripts.push(rel);
      if (!text) binaries.push(rel);
      totalSize += st.size;
      files.push({ path: rel, kind: text ? (script ? 'script' : 'text') : 'binary', size: st.size, executable });
    }
  };
  await visit(skillDir);
  const toolsRaw = frontmatter['allowed-tools'] || frontmatter.allowedtools || '';
  const tools = plainStrings(toolsRaw).flatMap((item) => item.split(/[ ,]+/)).filter(Boolean);
  const manifestNames = new Set(['package.json', 'requirements.txt', 'pyproject.toml', 'gemfile', 'go.mod', 'cargo.toml']);
  const dependencies = files
    .filter((file) => file.kind !== 'directory' && manifestNames.has(path.posix.basename(file.path).toLowerCase()))
    .map((file) => file.path);
  dependencies.push(...plainStrings(frontmatter.compatibility));
  if (frontmatter.metadata && typeof frontmatter.metadata === 'object') {
    for (const key of ['dependencies', 'dependency', 'requires', 'requirements']) {
      dependencies.push(...plainStrings(frontmatter.metadata[key]));
    }
  }
  const uniqueDependencies = [...new Set(dependencies)];
  let license = plainStrings(frontmatter.license)[0] || '';
  if (!license) {
    const localLicense = files.find((f) => /^(?:license|copying)(?:\.[^/]*)?$/i.test(f.path));
    if (localLicense) license = `见 ${localLicense.path}`;
  }
  if (!license && skillDir === repoRoot) {
    const rootNames = await fsp.readdir(repoRoot).catch(() => []);
    const rootLicense = rootNames.find((n) => /^(?:license|copying)(?:\..*)?$/i.test(n));
    if (rootLicense) license = `仓库 ${rootLicense}`;
  }
  const highPermissionTools = tools.filter((tool) => HIGH_PERMISSION_TOOLS.test(tool));
  const risks = [];
  if (!license) risks.push({ code: 'unknown_license', message: '许可证未知' });
  if (scripts.length) risks.push({ code: 'scripts', message: `包含 ${scripts.length} 个脚本或可执行文件` });
  if (highPermissionTools.length) risks.push({ code: 'high_permission_tools', message: `声明高权限工具：${highPermissionTools.join(', ')}` });
  return { files, fileCount: files.filter((f) => f.kind !== 'directory').length, totalSize, scripts, binaries, tools, highPermissionTools, dependencies: uniqueDependencies, license: license || '许可证未知', risks, enhancedConfirmation: risks.length > 0 };
}

async function normalizeTree(root) {
  if (process.platform === 'darwin') {
    // Clear metadata on the whole staged tree before applying the allowlisted
    // modes. These commands are fixed macOS system tools and never originate
    // from external Skill content.
    await run('/usr/bin/chflags', ['-R', '0', root], { timeout: 15000 });
    await run('/bin/chmod', ['-RN', root], { timeout: 15000 });
    await run('/usr/bin/xattr', ['-cr', root], { timeout: 15000 });
  }
  const visit = async (dir) => {
    await fsp.chmod(dir, 0o755);
    for (const ent of await fsp.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, ent.name);
      if (ent.isDirectory()) await visit(file);
      else {
        const st = await fsp.lstat(file);
        await fsp.chmod(file, st.mode & 0o111 ? 0o755 : 0o644);
      }
    }
  };
  await visit(root);
}

// 收编与安装共用的本机目录风险检查（docs/14）：先过结构安全（不安全路径 / 软硬链接 /
// 特殊权限位 / 特殊文件 / 数量体积上限，与归档解包走同一个 directoryStats 判定），
// 再过内容检查（未知可执行二进制拒绝、脚本清单、增强确认标记，与安装确认页同一套
// inspectSkillTree 语义）。消息与安装保持逐字一致。
async function auditLocalSkillDir(skillDir) {
  const stats = await directoryStats(skillDir);
  const info = await inspectSkillTree(skillDir, skillDir, {});
  return {
    fileCount: stats.files,
    totalSize: stats.total,
    scripts: info.scripts,
    binaries: info.binaries,
    risks: info.risks,
    enhancedConfirmation: info.enhancedConfirmation,
  };
}

async function copyTree(source, dest) {
  await fsp.mkdir(dest, { recursive: true, mode: 0o755 });
  for (const ent of await fsp.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) await copyTree(from, to);
    else if (ent.isFile()) await fsp.copyFile(from, to);
    else throw new Error('检查后的内容出现了不支持的文件类型');
  }
}

function createSkillDiscovery(options) {
  const {
    home, configDir, platform, targets, queueWrite, trash, fingerprint,
    refreshSkills, readConfig, updateConfig,
  } = options;
  const supportedAgents = Array.isArray(options.supportedAgents)
    ? [...options.supportedAgents]
    : Object.keys(targets || {});
  const agentLabels = { claude: 'Claude', codex: 'Codex', zcode: 'ZCode', workbuddy: 'WorkBuddy' };
  const targetOptions = supportedAgents.map((id) => ({ id, label: agentLabels[id] || id }));
  const storeRoot = path.resolve(options.storeRoot || path.join(home, '.agents', 'skills'));
  const applyConnections = options.applyConnections || (async () => ({ ok: true, previous: {}, results: [] }));
  const restoreConnections = options.restoreConnections || (async () => ({ ok: true }));
  const cacheFile = path.join(configDir, 'skill-discovery-cache.json');
  const recordsFile = path.join(configDir, 'skill-sources.json');
  const inspections = new Map();
  let recordsChain = Promise.resolve();

  async function recordKey(dir) {
    let current = path.resolve(dir);
    const suffix = [];
    while (true) {
      try { return path.join(await fsp.realpath(current), ...suffix.reverse()); }
      catch (error) {
        if (error.code !== 'ENOENT') return path.resolve(dir);
        const parent = path.dirname(current);
        if (parent === current) return path.resolve(dir);
        suffix.push(path.basename(current));
        current = parent;
      }
    }
  }

  async function recordKeyCandidates(dir) {
    const lexical = path.resolve(dir);
    const canonical = await recordKey(dir);
    const keys = [canonical, lexical];
    const canonicalHome = await recordKey(home);
    const relativeToHome = path.relative(canonicalHome, canonical);
    if (relativeToHome === '' || (!relativeToHome.startsWith('..') && !path.isAbsolute(relativeToHome))) {
      keys.push(path.join(path.resolve(home), relativeToHome));
    }
    return [...new Set(keys)];
  }

  async function loadRecords() {
    const value = await readJSON(recordsFile, null);
    if (value && value.installations && typeof value.installations === 'object' && !Array.isArray(value.installations)) return value;
    return { version: 1, installations: {} };
  }
  function saveRecords(records, testStage = '') {
    const task = recordsChain.then(() => {
      if (process.env.NODE_ENV === 'test' && process.env.FANBOX_TEST_DISCOVERY_RECORD_FAIL === testStage) {
        throw new Error(`测试注入：来源记录 ${testStage} 失败`);
      }
      return atomicJSON(recordsFile, records);
    });
    recordsChain = task.catch(() => {});
    return task;
  }

  async function annotateInstalledSources(results) {
    const sourceRecords = Object.values((await loadRecords()).installations);
    return results.map((entry) => {
      const parsed = parseGitHubSource(entry);
      if (!parsed) return entry;
      const sameSource = sourceRecords.some((record) => record && record.repository === parsed.canonical
        && record.discoveryEntryId && record.discoveryEntryId === entry.id);
      return sameSource ? { ...entry, actionLabel: '重新安装 / 更新' } : entry;
    });
  }

  async function search(body) {
    const query = normalizeQuery(body && (body.query ?? body.q));
    if (!query) return { ok: true, status: 'empty_query', query: '', results: [], reused: false, cached: false, installable: false };
    const now = Date.now();
    let cached = await readJSON(cacheFile, null);
    if (cached && now - Number(cached.at) >= SEARCH_CACHE_MS) { await fsp.rm(cacheFile, { force: true }).catch(() => {}); cached = null; }
    if (cached && cached.query === query && now - Number(cached.at) < SEARCH_REUSE_MS) {
      return { ok: true, status: cached.results.length ? 'reused' : 'empty', query, results: await annotateInstalledSources(cached.results), reused: true, cached: false, installable: true, cacheAgeMs: now - cached.at };
    }
    try {
      const base = process.env.FANBOX_SKILLS_SEARCH_URL || 'https://skills.sh/api/search';
      const url = new URL(base);
      url.searchParams.set('q', query);
      url.searchParams.set('limit', '20');
      const results = normalizeSearchPayload(await fetchJSON(url, 10000));
      const record = { version: 1, at: now, query, results };
      await atomicJSON(cacheFile, record);
      return { ok: true, status: results.length ? 'fresh' : 'empty', query, results: await annotateInstalledSources(results), reused: false, cached: false, installable: true };
    } catch (error) {
      if (cached) {
        return { ok: false, status: 'cached', query, cachedQuery: cached.query, results: await annotateInstalledSources(cached.results), reused: false, cached: true, installable: false, cacheAgeMs: now - cached.at, error: safeError(error, '外部搜索失败') };
      }
      return { ok: false, status: error.code || 'failed', query, results: [], reused: false, cached: false, installable: false, error: safeError(error, '外部搜索失败') };
    }
  }

  async function prerequisites() {
    if (platform !== 'darwin') return { ok: false, status: 'unsupported_platform', error: '首版仅支持在 macOS 安装；仍可搜索和打开来源' };
    try { await fsp.access('/usr/bin/tar', fs.constants.X_OK); } catch { return { ok: false, status: 'missing_tar', error: '缺少可用的 macOS 系统 tar' }; }
    try { await run(process.env.FANBOX_TEST_DISCOVERY_GIT_REPO ? '/usr/bin/git' : 'git', ['--version'], { timeout: 5000 }); }
    catch { return { ok: false, status: 'missing_git', error: '缺少可用的 Git 命令' }; }
    return { ok: true };
  }

  async function inspect(body) {
    const entry = body && body.entry && typeof body.entry === 'object' ? body.entry : body || {};
    const parsedSource = parseGitHubSource(entry);
    if (!parsedSource) return { ok: false, status: 'unsupported_source', error: '首版只支持公开 GitHub 仓库', sourceUrl: entry.sourceUrl || entry.repository || '' };
    const prereq = await prerequisites();
    if (!prereq.ok) return prereq;
    const expectedName = String(entry.skillId || entry.skill || entry.name || entry.id || '').split('/').filter(Boolean).pop();
    let tempRoot = null;
    try {
      tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'fanbox-skill-discovery-'));
      const gitTarget = process.env.FANBOX_TEST_DISCOVERY_GIT_REPO || parsedSource.gitUrl;
      let gitOut;
      try {
        gitOut = await run('git', ['ls-remote', gitTarget, 'HEAD'], {
          timeout: 20000,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
        });
      } catch {
        throw new Error('GitHub 仓库不可公开访问；私有仓库和认证暂不支持');
      }
      const commit = gitOut.trim().split(/\s+/)[0];
      if (!/^[a-f0-9]{40}$/i.test(commit)) throw new Error('Git 未返回完整的 40 位 commit SHA');
      const archive = path.join(tempRoot, 'repository.tar.gz');
      if (process.env.FANBOX_TEST_DISCOVERY_ARCHIVE) {
        const st = await fsp.stat(process.env.FANBOX_TEST_DISCOVERY_ARCHIVE);
        if (!st.isFile() || st.size > MAX_ARCHIVE) throw new Error('归档超过 10 MiB 限制');
        await fsp.copyFile(process.env.FANBOX_TEST_DISCOVERY_ARCHIVE, archive);
      } else {
        await download(`https://codeload.github.com/${parsedSource.owner}/${parsedSource.repo}/tar.gz/${commit}`, archive);
      }
      const extracted = path.join(tempRoot, 'extracted');
      await extractArchive(archive, extracted, '/usr/bin/tar');
      const candidates = [];
      const walk = async (dir) => {
        for (const ent of await fsp.readdir(dir, { withFileTypes: true })) {
          const file = path.join(dir, ent.name);
          if (ent.isDirectory()) await walk(file);
          else if (ent.isFile() && ent.name === 'SKILL.md') candidates.push(file);
        }
      };
      await walk(extracted);
      const parsedCandidates = [];
      for (const file of candidates) {
        let text;
        try {
          const content = await fsp.readFile(file);
          text = new TextDecoder('utf-8', { fatal: true }).decode(content);
        } catch { continue; }
        const fm = parseFrontmatter(text);
        const name = fm && fm.name;
        parsedCandidates.push({ file, fm, name });
      }
      let matching = parsedCandidates;
      if (parsedSource.hintedPath) {
        const hint = parsedSource.hintedPath.replace(/^skills\//, '').split('/').filter(Boolean).pop();
        matching = parsedCandidates.filter((c) => c.name === hint || c.name === expectedName || path.basename(path.dirname(c.file)) === hint);
      } else if (expectedName) matching = parsedCandidates.filter((c) => c.name === expectedName || path.basename(path.dirname(c.file)) === expectedName);
      if (matching.length !== 1) {
        const status = matching.length > 1 ? 'multiple_candidates' : candidates.length ? 'no_matching_candidate' : 'no_candidate';
        throw Object.assign(new Error(matching.length ? '固定归档中有多个匹配的 Skill 目录，无法确定性选择' : '固定归档中没有唯一匹配且命名有效的 Skill 目录'), { status });
      }
      const chosen = matching[0];
      if (!chosen.fm || !chosen.name) throw Object.assign(new Error('匹配的 SKILL.md 缺少有效 frontmatter name'), { status: 'invalid_candidate' });
      if (chosen.name.length > 64 || !SKILL_NAME.test(chosen.name)) throw Object.assign(new Error('Skill frontmatter name 不符合 1–64 位小写字母、数字和单连字符规则'), { status: 'invalid_name' });
      if (path.basename(path.dirname(chosen.file)) !== chosen.name) throw Object.assign(new Error('Skill frontmatter name 与目录名不一致'), { status: 'name_mismatch' });
      const skillDir = path.dirname(chosen.file);
      const topEntries = await fsp.readdir(extracted, { withFileTypes: true });
      const repoRoot = topEntries.length === 1 && topEntries[0].isDirectory() ? path.join(extracted, topEntries[0].name) : extracted;
      const details = await inspectSkillTree(skillDir, repoRoot, chosen.fm);
      const contentHash = await fingerprint(skillDir);
      const skillPath = path.relative(repoRoot, skillDir).split(path.sep).join('/');
      const id = crypto.randomBytes(24).toString('hex');
      const inspection = {
        id, createdAt: Date.now(), commit: commit.toLowerCase(), shortCommit: commit.slice(0, 12),
        discoveryEntryId: typeof entry.id === 'string' ? entry.id : '',
        name: chosen.name, description: plainStrings(chosen.fm.description)[0] || '', author: parsedSource.owner,
        repository: parsedSource.canonical, sourceUrl: `${parsedSource.url}/tree/${commit}/${skillPath}`,
        skillPath, contentHash, ...details,
        riskCheck: details.enhancedConfirmation ? '需要确认' : '检查通过',
        targets: targetOptions,
      };
      const sourceRecords = await loadRecords();
      const sameSource = Object.values(sourceRecords.installations).filter((record) => record
        && record.repository === inspection.repository && record.skillPath === inspection.skillPath);
      if (sameSource.length) {
        inspection.update = sameSource.some((record) => record.commit !== inspection.commit);
        inspection.actionLabel = inspection.update ? '更新' : '重新安装';
        if (inspection.update) {
          const snapshot = await refreshSkills().catch(() => ({ items: [] }));
          const row = (snapshot.items || []).find((item) => item.agents
            && (item.skillName || item.name) === inspection.name);
          inspection.affectedConnections = row
            ? supportedAgents.filter((agent) => row.agents[agent] && row.agents[agent].on).length
            : new Set(sameSource.flatMap((record) => Array.isArray(record.agents) ? record.agents : [])).size;
        }
      }
      inspections.set(id, { inspection, tempRoot, skillDir });
      tempRoot = null;
      for (const [oldId, saved] of inspections) if (Date.now() - saved.inspection.createdAt > INSPECTION_MS) {
        inspections.delete(oldId); fsp.rm(saved.tempRoot, { recursive: true, force: true }).catch(() => {});
      }
      return { ok: true, status: 'ready', inspection };
    } catch (error) {
      const status = error.status || (/软链接|硬链接|特殊文件|权限|超过|可执行|不安全路径/.test(error.message || '') ? 'unsafe_content' : 'inspection_failed');
      return { ok: false, status, error: safeError(error, '检查失败'), sourceUrl: parsedSource.url };
    } finally { if (tempRoot) await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {}); }
  }

  async function parseInstall(body) {
    if (!body || typeof body !== 'object') return { ok: false, error: '请求格式错误' };
    if (typeof body.inspectionId !== 'string' || !/^[a-f0-9]{48}$/.test(body.inspectionId)) return { ok: false, error: '检查凭据无效' };
    let requested = body.agents;
    if (requested === undefined) {
      const config = await readConfig();
      requested = Array.isArray(config.defaultSkillTargetAgents)
        ? config.defaultSkillTargetAgents
        : (supportedAgents.includes(config.defaultSkillTargetAgent) ? [config.defaultSkillTargetAgent] : supportedAgents);
    }
    if (!Array.isArray(requested) || requested.some((agent) => !supportedAgents.includes(agent))) {
      return { ok: false, error: 'agents 必须是受支持 Agent 的数组' };
    }
    if (body.acknowledge !== undefined && typeof body.acknowledge !== 'boolean') return { ok: false, error: 'acknowledge 必须是布尔值' };
    if (body.overwrite !== undefined && typeof body.overwrite !== 'boolean') return { ok: false, error: 'overwrite 必须是布尔值' };
    const expectedTargetHash = body.expectedTargetHash ?? body.conflictFingerprint;
    if (expectedTargetHash !== undefined && !/^[a-f0-9]{64}$/.test(String(expectedTargetHash))) return { ok: false, error: '目标指纹格式错误' };
    return {
      ok: true,
      inspectionId: body.inspectionId,
      agents: supportedAgents.filter((agent) => requested.includes(agent)),
      acknowledge: body.acknowledge === true,
      overwrite: body.overwrite === true,
      expectedTargetHash: expectedTargetHash || null,
    };
  }

  async function install(body) {
    const parsed = await parseInstall(body);
    if (!parsed.ok) return { ok: false, status: 'invalid_request', error: parsed.error };
    const saved = inspections.get(parsed.inspectionId);
    if (!saved || Date.now() - saved.inspection.createdAt > INSPECTION_MS) return { ok: false, status: 'inspection_expired', error: '检查结果已过期，请重新检查固定来源' };
    const inspection = saved.inspection;
    if (inspection.enhancedConfirmation && !parsed.acknowledge) {
      return { ok: false, status: 'risk_acknowledgement_required', error: '请先展开并确认风险明细' };
    }
    const targetDir = path.join(storeRoot, inspection.name);
    return queueWrite(async () => {
      let stage = null;
      let rollback = null;
      let oldRecords = null;
      let installedVisible = false;
      let connections = null;
      let targetHash = null;
      let unchanged = false;
      try {
        if (await fingerprint(saved.skillDir) !== inspection.contentHash) return { ok: false, status: 'source_changed', error: '检查后的固定内容已变化，请重新检查' };
        const records = await loadRecords();
        const targetKeys = await recordKeyCandidates(targetDir);
        const targetKey = targetKeys[0];
        const currentRecord = targetKeys.map((key) => records.installations[key]).find(Boolean) || null;
        const snapshot = await refreshSkills();
        const nameConflict = (snapshot.items || []).find((item) => {
          if (item.residue || !item.agents || path.resolve(item.dir) === targetKey) return false;
          return (item.skillName || item.name) === inspection.name;
        });
        if (nameConflict) {
          return {
            ok: false, status: 'different_source_conflict',
            error: '已有同名原件；FanBox 不会凭名称推断来源或创建重复项',
            conflict: { targetDir: nameConflict.dir, dir: nameConflict.dir, disabled: !!nameConflict.disabled },
          };
        }
        try { targetHash = await fingerprint(targetDir); } catch (error) { if (error.code !== 'ENOENT') { try { await fsp.lstat(targetDir); throw error; } catch (nested) { if (nested.code !== 'ENOENT') throw nested; } } }
        const identity = `${inspection.repository}#${inspection.skillPath}`;
        if (targetHash && currentRecord) {
          const existingIdentity = `${currentRecord.repository}#${currentRecord.skillPath}`;
          if (existingIdentity !== identity) return { ok: false, status: 'different_source_conflict', error: '同名原件来自不同来源，不能按名称覆盖', conflict: { targetDir, record: currentRecord } };
          if (currentRecord.contentHash !== targetHash && !parsed.overwrite) return { ok: false, status: 'local_modified', error: '本机原件内容已修改，需要明确确认覆盖', targetHash, expectedTargetHash: targetHash, conflictFingerprint: targetHash };
          if (currentRecord.contentHash !== targetHash && parsed.expectedTargetHash !== targetHash) return { ok: false, status: 'concurrent_changed', error: '目标内容在确认后发生变化' };
          unchanged = currentRecord.commit === inspection.commit && targetHash === inspection.contentHash;
        } else if (targetHash && !currentRecord) {
          if (!parsed.overwrite) return { ok: false, status: 'unknown_conflict', error: '同名原件没有 FanBox 来源记录，需要明确确认接管', targetHash, expectedTargetHash: targetHash, conflictFingerprint: targetHash, targetDir };
          if (parsed.expectedTargetHash !== targetHash) return { ok: false, status: 'concurrent_changed', error: '目标内容在确认后发生变化' };
        } else if (!targetHash && currentRecord) {
          return { ok: false, status: 'concurrent_changed', error: '来源记录对应的目标已不存在，请刷新后重试' };
        } else if (parsed.overwrite) return { ok: false, status: 'concurrent_changed', error: '待覆盖的目标已不存在' };

        oldRecords = JSON.parse(JSON.stringify(records));
        if (!unchanged) {
          await fsp.mkdir(storeRoot, { recursive: true, mode: 0o755 });
          stage = await fsp.mkdtemp(path.join(storeRoot, '.fanbox-discovery-stage-'));
          await copyTree(saved.skillDir, stage);
          await normalizeTree(stage);
          const stagedHash = await fingerprint(stage);
          if (stagedHash !== inspection.contentHash) throw new Error('规范化后的内容指纹与检查结果不一致');
          // Last target check at the mutation boundary.
          let latestHash = null;
          try { latestHash = await fingerprint(targetDir); } catch { /* absent */ }
          if (latestHash !== targetHash) return { ok: false, status: 'concurrent_changed', error: '目标在最终写入前发生变化' };
          if (targetHash) {
            rollback = await fsp.mkdtemp(path.join(storeRoot, '.fanbox-discovery-rollback-'));
            await fsp.rmdir(rollback);
            await fsp.rename(targetDir, rollback);
          }
          await fsp.rename(stage, targetDir); stage = null; installedVisible = true;
        }
        connections = await applyConnections(inspection.name, parsed.agents, {
          refreshWorkBuddy: Boolean(targetHash && !unchanged),
        });
        if (!connections.ok) {
          throw Object.assign(new Error(connections.error || '建立 Agent 接入失败'), {
            status: connections.status || 'connection_failed',
            conflict: connections.conflict,
            agent: connections.agent,
          });
        }
        const record = {
          repository: inspection.repository, skillPath: inspection.skillPath, commit: inspection.commit,
          contentHash: inspection.contentHash, name: inspection.name, agents: parsed.agents,
          installedAt: Date.now(), sourceUrl: inspection.sourceUrl, discoveryEntryId: inspection.discoveryEntryId,
        };
        for (const key of targetKeys) delete records.installations[key];
        records.installations[targetKey] = record;
        await saveRecords(records, 'install');
        if (rollback) {
          const result = await trash(rollback);
          if (!result.ok) throw new Error(result.error || '旧安装项移入废纸篓失败');
          rollback = null;
        }
        inspections.delete(parsed.inspectionId);
        await fsp.rm(saved.tempRoot, { recursive: true, force: true }).catch(() => {});
        const refreshed = await refreshSkills().catch(() => ({ items: [] }));
        const item = (refreshed.items || []).find((it) => path.resolve(it.dir) === targetKey);
        const visibleTargetDir = item ? item.dir : targetKey;
        const restartRequired = connections.results.some((result) => result.restartRequired === 'codex') ? ['codex'] : [];
        return {
          ok: true, status: unchanged ? 'identical' : targetHash ? 'updated' : 'installed', agents: parsed.agents,
          targetDir: visibleTargetDir, item: item || null, installation: record,
          restartRequired,
          message: !parsed.agents.length
            ? '原件已安装为纯库存，当前未接入任何 Agent；Codex 禁用配置需重启后生效'
            : restartRequired.includes('codex')
              ? '原件已安装并完成所选接入；Codex 配置变更需重启后生效'
              : '原件已安装并完成所选接入；新 Agent 会话可发现',
        };
      } catch (error) {
        const rollbackErrors = [];
        if (connections && connections.ok) {
          const restored = await restoreConnections(inspection.name, connections.previous, connections);
          if (!restored.ok) rollbackErrors.push(`Agent 接入：${restored.error || '恢复失败'}`);
        }
        if (oldRecords) await saveRecords(oldRecords, 'rollback').catch((rollbackError) => { rollbackErrors.push(`来源记录：${safeError(rollbackError, '未知错误')}`); });
        if (rollback) {
          let failed = null;
          try {
            await fsp.lstat(targetDir);
            failed = `${targetDir}.fanbox-failed-${crypto.randomBytes(4).toString('hex')}`;
            await fsp.rename(targetDir, failed);
          } catch (moveError) {
            if (moveError.code !== 'ENOENT') rollbackErrors.push(`移开失败的新内容：${safeError(moveError, '未知错误')}`);
          }
          try {
            await fsp.rename(rollback, targetDir);
            rollback = null;
            if (failed) await fsp.rm(failed, { recursive: true, force: true });
          } catch (restoreError) {
            rollbackErrors.push(`恢复旧安装项：${safeError(restoreError, '未知错误')}`);
          }
        } else if (installedVisible && oldRecords
          && !(await recordKeyCandidates(targetDir)).some((key) => oldRecords.installations[key])) {
          await fsp.rm(targetDir, { recursive: true, force: true }).catch((removeError) => { rollbackErrors.push(`移除失败安装项：${safeError(removeError, '未知错误')}`); });
        }
        return {
          ok: false,
          status: rollbackErrors.length ? 'rollback_failed' : error.status || 'install_failed',
          error: rollbackErrors.length
            ? `安装失败，且回滚未完整完成：${rollbackErrors.join('；')}`
            : safeError(error, '安装失败'),
          agent: error.agent,
          conflict: error.conflict,
          targetDir,
        };
      } finally {
        if (stage) await fsp.rm(stage, { recursive: true, force: true }).catch(() => {});
        if (rollback) { try { await fsp.rename(rollback, targetDir); } catch { /* retain recoverable rollback */ } }
      }
    });
  }

  async function settings(body) {
    if (body === undefined) {
      const config = await readConfig();
      const configured = Array.isArray(config.defaultSkillTargetAgents)
        ? config.defaultSkillTargetAgents
        : (supportedAgents.includes(config.defaultSkillTargetAgent) ? [config.defaultSkillTargetAgent] : supportedAgents);
      const value = supportedAgents.filter((agent) => configured.includes(agent));
      return {
        ok: true,
        defaultTargetAgents: value,
        targets: targetOptions,
        installationPrerequisite: await prerequisites(),
      };
    }
    const requested = body && body.defaultTargetAgents;
    if (!Array.isArray(requested) || requested.some((agent) => !supportedAgents.includes(agent))) {
      return { ok: false, status: 'invalid_request', error: '默认接入对象必须是受支持 Agent 的数组' };
    }
    const value = supportedAgents.filter((agent) => requested.includes(agent));
    await updateConfig((config) => {
      config.defaultSkillTargetAgents = value;
      delete config.defaultSkillTargetAgent;
    });
    return { ok: true, defaultTargetAgents: value };
  }

  async function sourceRecord(dir) {
    const records = await loadRecords();
    for (const key of await recordKeyCandidates(dir)) {
      if (records.installations[key]) return records.installations[key];
    }
    return null;
  }

  async function removeSourceRecord(dir) {
    const records = await loadRecords();
    let removed = null;
    for (const key of await recordKeyCandidates(dir)) {
      if (!removed && records.installations[key]) removed = records.installations[key];
      delete records.installations[key];
    }
    if (!removed) return null;
    await saveRecords(records, 'remove');
    return removed;
  }

  async function restoreSourceRecord(dir, record) {
    if (!record) return false;
    const records = await loadRecords();
    records.installations[await recordKey(dir)] = record;
    await saveRecords(records, 'restore');
    return true;
  }

  async function records() { return loadRecords(); }

  return { search, inspect, install, settings, prerequisites, sourceRecord, removeSourceRecord, restoreSourceRecord, records };
}

module.exports = { createSkillDiscovery, normalizeSearchPayload, parseGitHubSource, auditLocalSkillDir, normalizeTree };
