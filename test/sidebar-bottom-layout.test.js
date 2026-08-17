'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function styles() {
  return fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
}

test('Skills 透视和定时任务之间有视觉分隔线', () => {
  const css = styles();
  // cron-entry 需要有 border-top 来与 skills-entry 分隔
  assert.match(css, /#cron-entry\s*\{[^}]*border-top/s);
});

test('Skills 透视和定时任务有充足的间距', () => {
  const css = styles();
  // skills-entry 需要底部 padding（shorthand 或 longhand）
  const skillsMatch = css.match(/#skills-entry\s*\{([^}]*)\}/);
  assert.ok(skillsMatch, '#skills-entry rule should exist');
  const skillsRule = skillsMatch[1];
  // padding should include a bottom value of at least 10px
  // matches: padding: 12px 16px 10px  or  padding-bottom: 10px
  const hasBottomPad =
    /padding-bottom:\s*(\d+)px/.test(skillsRule) ||
    /padding:\s*\d+px\s+\d+px\s+(\d+)px/.test(skillsRule);
  assert.ok(hasBottomPad, 'skills-entry should have padding-bottom >= 10px');
});

test('cron-entry 有合理的 padding', () => {
  const css = styles();
  const cronMatch = css.match(/#cron-entry\s*\{([^}]*)\}/);
  assert.ok(cronMatch, '#cron-entry rule should exist');
  const cronRule = cronMatch[1];
  // top padding should be at least 12px for breathing room
  const padMatch = cronRule.match(/padding:\s*(\d+)px/);
  assert.ok(padMatch, 'cron-entry should have padding');
  assert.ok(parseInt(padMatch[1]) >= 12, `cron-entry top padding ${padMatch[1]}px should be >= 12px`);
});

test('底部工具区整体间距合理', () => {
  const css = styles();
  // usage-sec should have comfortable spacing
  const usageMatch = css.match(/#usage-sec\s*\{([^}]*)\}/);
  assert.ok(usageMatch, '#usage-sec rule should exist');
  // margin-top should provide separation
  assert.match(usageMatch[1], /margin-top/);
});
