#!/usr/bin/env node

// 通过 FanBox 微信 ClawBot / iLink 发送文本消息。
// 默认使用当前 macOS FanBox 账号，并发送给绑定账号本人。

const fs = require('fs');
const os = require('os');
const path = require('path');
const ilink = require('../electron/wechat/ilink');

function usage() {
  console.error(`用法：
  node scripts/send-wechat-message.js [选项] <消息>

选项：
  --to <用户ID>             指定收件人；默认发送给当前绑定账号
  --account <文件路径>      指定 account.json 路径
  --context-token <token>   指定微信会话上下文（通常可省略）
  --stdin                   从标准输入读取消息
  --dry-run                 只探活和校验，不发送
  -h, --help                显示帮助

示例：
  node scripts/send-wechat-message.js "该喝水了"
  node scripts/send-wechat-message.js --to '<微信用户ID>' "你好"
  echo "任务已完成" | node scripts/send-wechat-message.js --stdin
`);
}

function parseArgs(argv) {
  const args = { messageParts: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') args.help = true;
    else if (arg === '--stdin') args.stdin = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--to') args.to = argv[++i];
    else if (arg === '--account') args.accountPath = argv[++i];
    else if (arg === '--context-token') args.contextToken = argv[++i] || '';
    else if (arg.startsWith('--')) throw new Error(`未知选项：${arg}`);
    else args.messageParts.push(arg);
  }
  return args;
}

function accountCandidates() {
  const home = os.homedir();
  const candidates = [
    process.env.FANBOX_WECHAT_ACCOUNT,
    path.join(home, 'Library/Application Support/FanBox/wechat/account.json'),
    path.join(home, '.config/FanBox/wechat/account.json'),
    path.join(home, '.fanbox/wechat/account.json'),
    process.env.APPDATA && path.join(process.env.APPDATA, 'FanBox/wechat/account.json'),
  ];
  return candidates.filter(Boolean);
}

function findAccount(accountPath) {
  const candidates = accountPath ? [accountPath] : accountCandidates();
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const account = ilink.readJson(candidate, null);
    if (account && account.token && account.userId && account.baseUrl) {
      return { account, accountPath: candidate };
    }
  }
  throw new Error(accountPath
    ? `账号文件无效或不存在：${accountPath}`
    : '找不到有效的微信账号。请先在 FanBox 中登录微信 ClawBot。');
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data.trim()));
    process.stdin.on('error', reject);
  });
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) { usage(); return 0; }

  const { account, accountPath } = findAccount(args.accountPath);
  const message = args.stdin
    ? await readStdin()
    : args.messageParts.join(' ').trim();
  if (!message) throw new Error('消息不能为空。');

  const probe = await ilink.ping(account);
  if (probe.status === 401 || probe.status === 403 || probe.json?.errcode === -14 || probe.json?.ret === -14) {
    throw new Error('微信 ClawBot 凭证已过期，请在 FanBox 中重新登录。');
  }
  if (!probe.ok) throw new Error(`微信通道不可达（HTTP ${probe.status}）。`);

  const toUserId = args.to || account.userId;
  console.log(JSON.stringify({ ok: true, dryRun: !!args.dryRun, accountPath, toUserId, message }));
  if (args.dryRun) return 0;

  const result = await ilink.sendText(account, toUserId, message, args.contextToken || '');
  if (!result.ok || result.json?.errcode || (result.json?.ret != null && result.json.ret !== 0)) {
    throw new Error(`发送失败（HTTP ${result.status}）：${JSON.stringify(result.json || {})}`);
  }
  console.log(JSON.stringify({ ok: true, sent: true, toUserId, message }));
  return 0;
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(`错误：${error.message || error}`);
    process.exitCode = 1;
  });
}

module.exports = { accountCandidates, findAccount, parseArgs };
