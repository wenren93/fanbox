'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('编辑式主题的列表序号与文件图标保持独立间距', () => {
  const css = fs.readFileSync('public/style.css', 'utf8');

  assert.match(css, /\[data-theme="editorial"\] \.list\s*\{[^}]*--list-icon-col:\s*42px/s);
  assert.match(css, /\.row:not\(\.list-head\) \.icon::before\s*\{[^}]*width:\s*12px[^}]*text-align:\s*right/s);
  assert.match(css, /\[data-theme="editorial"\] \.list \.row \.icon\s*\{[^}]*justify-content:\s*flex-end/s);
  assert.match(css, /#file-area\.fa-tight \.list \.row\s*\{[^}]*var\(--list-icon-col\)/s);
});
