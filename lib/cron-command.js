'use strict';

const { execFile } = require('node:child_process');

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function codexFullAutoFlagFromHelp(help) {
  const text = String(help || '');
  if (text.includes('--dangerously-bypass-approvals-and-sandbox')) {
    return '--dangerously-bypass-approvals-and-sandbox';
  }
  if (text.includes('--full-auto')) return '--full-auto';
  return '';
}

let codexHelpPromise = null;
function loadCodexHelp() {
  if (!codexHelpPromise) {
    // GUI 启动的 Electron 没有用户 shell 的 PATH；登录 shell 能找到实际 codex 版本。
    codexHelpPromise = new Promise((resolve) => {
      execFile('/bin/zsh', ['-lc', 'codex --help'], { timeout: 8000 }, (err, stdout, stderr) => {
        resolve(err ? String(stdout || stderr || '') : String(stdout || ''));
      });
    });
  }
  return codexHelpPromise;
}

async function buildCronCommand(task, options = {}) {
  if (task.agent === 'shell') return String(task.prompt || '');
  const prompt = shellQuote(task.prompt || '');
  if (task.agent === 'codex') {
    if (!task.full) return `codex ${prompt}`;
    const help = options.codexHelp === undefined ? await loadCodexHelp() : options.codexHelp;
    const flag = codexFullAutoFlagFromHelp(help);
    return `codex${flag ? ` ${flag}` : ''} ${prompt}`;
  }
  return task.full
    ? `claude --dangerously-skip-permissions ${prompt}`
    : `claude --permission-mode acceptEdits ${prompt}`;
}

module.exports = { buildCronCommand, codexFullAutoFlagFromHelp };
