'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { activeTerminalCount, isTerminalTaskRunning } = require('../electron/terminal-activity');

test('裸 shell 和未知进程不算正在运行的终端任务', () => {
  for (const processName of ['', 'zsh', '-zsh', '/bin/bash', 'fish', 'pwsh', 'cmd.exe']) {
    assert.equal(isTerminalTaskRunning({ process: processName }), false, processName);
  }
});

test('shell 前台运行的命令算正在运行的终端任务', () => {
  for (const processName of ['claude', 'codex', 'node', 'npm', 'vim']) {
    assert.equal(isTerminalTaskRunning({ process: processName }), true, processName);
  }
});

test('只统计正在运行任务的终端，不统计空闲标签', () => {
  const terminals = new Map([
    ['idle', { process: 'zsh' }],
    ['agent', { process: 'codex' }],
    ['server', { process: 'node' }],
  ]);
  assert.equal(activeTerminalCount(terminals), 2);
});
