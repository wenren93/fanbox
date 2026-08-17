'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// 测试 .env 和 .example 等文本文件能被正确识别为 text kind
// 这些文件本质上是纯文本，应该可以在预览面板中查看和编辑
test('.env and .example files are classified as text kind', () => {
  const src = fs.readFileSync('server.js', 'utf8');

  // .example 扩展名应加入 TEXT_EXT 集合
  assert.match(src, /TEXT_EXT\s*=\s*new\s*Set\(\[[\s\S]*?['"]example['"]/,
    'TEXT_EXT should include "example" extension');
});

test('.env dotfile is matched by kindOf regex for text classification', () => {
  const src = fs.readFileSync('server.js', 'utf8');

  // 提取 kindOf 函数中的正则行
  const kindOfLine = src.match(/if \(TEXT_EXT\.has\(e\) \|\| .+\.test\(name\)\) return 'text';/);
  assert.ok(kindOfLine, 'kindOf should have a TEXT_EXT or regex fallback for text');

  // 正则必须包含 .env 模式，因为 ext('.env') 返回 ''（点在位置 0），
  // TEXT_EXT.has('') 为 false，只能靠正则兜底
  assert.match(kindOfLine[0], /\.env/,
    'kindOf regex should match .env dotfile pattern');
});

test('.env.local and .env.production are also classified as text', () => {
  const src = fs.readFileSync('server.js', 'utf8');

  // 提取 kindOf 中的正则
  const regexMatch = src.match(/\/\^(\(dockerfile[^/]+)\)\$\/i/);
  assert.ok(regexMatch, 'kindOf regex should be extractable');

  // .env 后面带 .local / .production 等变体也应该匹配
  // 正则需要支持 .env(\..+)? 模式
  assert.match(regexMatch[0], /env.*\.\+/,
    'kindOf regex should support .env.* variants like .env.local');
});
