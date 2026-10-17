'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// cron 实现在后端子进程（server-child.js），微信 bridge 在主进程读 global.__fanboxCron，
// 两边靠 cron:call / cron:reply 消息配对。两侧文件都无法在测试里直接 require
// （一个会拉起 HTTP 服务、一个依赖 electron），按仓库静态测试惯例做契约断言：
// 协议收发与失败善后必须两侧成对出现，避免再出现拆进程时漏掉半座桥的回归。

const childJs = fs.readFileSync('electron/server-child.js', 'utf8');
const mainJs = fs.readFileSync('electron/main.js', 'utf8');
const bridgeJs = fs.readFileSync('electron/wechat/bridge.js', 'utf8');

test('子进程侧：cron:call 分支、cron:reply 回包与错误折叠成对', () => {
  assert.match(childJs, /if \(m\.type !== 'cron:call'\) return;/);
  assert.match(childJs, /cron\.action\(\.\.\.\(m\.args \|\| \[\]\)\)/);
  assert.match(childJs, /cron\.list\(\.\.\.\(m\.args \|\| \[\]\)\)/);
  assert.match(childJs, /type: 'cron:reply', id: m\.id/);
  // 任何异常都要回包折进 result.error，主进程的 waiter 才不会悬死
  assert.match(childJs, /result: \{ ok: false, error: String\(e && e\.message \|\| e\) \}/);
});

test('主进程侧：__fanboxCron 代理、回包分发与退出善后成对', () => {
  assert.match(mainJs, /global\.__fanboxCron = \{/);
  assert.match(mainJs, /callBackendCron\('list', args\)/);
  assert.match(mainJs, /callBackendCron\('action', args\)/);
  assert.match(mainJs, /m\.type === 'cron:reply'/);
  // 子进程不在（未 fork / 刚退出）时立即失败，不挂起 bridge 的 Promise
  assert.match(mainJs, /ok: false, error: '后端进程未就绪'/);
  // 子进程退出时清空在途 waiter
  assert.match(mainJs, /ok: false, error: '后端进程重启中'/);
  assert.match(mainJs, /cronWaiters\.clear\(\)/);
});

test('bridge 侧仍从 global.__fanboxCron 取能力，缺能力时提示重启', () => {
  assert.match(bridgeJs, /global\.__fanboxCron/);
  assert.match(bridgeJs, /当前 FanBox 进程没有定时任务能力/);
});

test('定时任务协议教全 list 标记，并声明无需权限注入', () => {
  assert.match(bridgeJs, /<cron action="list"><\/cron>/);
  assert.match(bridgeJs, /不依赖任何 token 或权限注入/);
  assert.match(bridgeJs, /不要凭记忆作答/);
  // list 回执要带任务名与启用状态，只报数量答不了「查看已有定时任务」
  assert.match(bridgeJs, /个定时任务：\$\{brief\}/);
  assert.match(bridgeJs, /当前没有定时任务/);
});
