'use strict';

const PLAIN_SHELLS = new Set([
  'zsh', 'bash', 'fish', 'sh', 'dash', 'tcsh', 'nu',
  'pwsh', 'powershell.exe', 'cmd.exe',
]);

function isTerminalTaskRunning(terminal) {
  const processName = String(terminal && terminal.process || '')
    .split(/[\\/]/).pop()
    .replace(/^-/, '')
    .toLowerCase();
  return !!processName && !PLAIN_SHELLS.has(processName);
}

function activeTerminalCount(terminals) {
  let count = 0;
  for (const terminal of terminals.values()) {
    if (isTerminalTaskRunning(terminal)) count++;
  }
  return count;
}

module.exports = { activeTerminalCount, isTerminalTaskRunning };
