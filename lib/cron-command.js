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
  const hookFlag = (name) => typeof options[name] === 'function' ? String(options[name]() || '') : '';
  if (task.agent === 'codex') {
    const help = task.full && (options.codexHelp === undefined ? await loadCodexHelp() : options.codexHelp);
    const flag = task.full ? codexFullAutoFlagFromHelp(help) : '';
    return `codex${flag ? ` ${flag}` : ''}${hookFlag('codexHooksFlag')} ${prompt}`;
  }
  return task.full
    ? `claude --dangerously-skip-permissions${hookFlag('claudeHooksFlag')} ${prompt}`
    : `claude --permission-mode acceptEdits${hookFlag('claudeHooksFlag')} ${prompt}`;
}

module.exports = { buildCronCommand, codexFullAutoFlagFromHelp };
