'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCronCommand,
  codexFullAutoFlagFromHelp,
} = require('../lib/cron-command');

test('Codex 全自动参数适配新版 CLI，不再硬编码已移除的 --full-auto', async () => {
  const help = `
    --sandbox <SANDBOX_MODE>
    --approve-for-me
    --dangerously-bypass-approvals-and-sandbox
  `;

  assert.equal(
    codexFullAutoFlagFromHelp(help),
    '--dangerously-bypass-approvals-and-sandbox',
  );
  assert.equal(
    await buildCronCommand(
      { agent: 'codex', full: true, prompt: '通过微信 ClawBot 发消息提醒我喝水' },
      { codexHelp: help },
    ),
    "codex --dangerously-bypass-approvals-and-sandbox '通过微信 ClawBot 发消息提醒我喝水'",
  );
});

test('Codex 全自动参数兼容仍支持 --full-auto 的旧版 CLI', () => {
  assert.equal(codexFullAutoFlagFromHelp('Options: --full-auto'), '--full-auto');
});

test('Codex 参数能力未知时裸启动，避免 unexpected argument', async () => {
  assert.equal(
    await buildCronCommand(
      { agent: 'codex', full: true, prompt: '检查状态' },
      { codexHelp: 'Usage: codex [PROMPT]' },
    ),
    "codex '检查状态'",
  );
});
