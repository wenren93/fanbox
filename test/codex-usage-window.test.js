'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('Codex primary window uses dynamic label from windowMinutes instead of hardcoded 5h', () => {
  const js = fs.readFileSync('public/app.js', 'utf8');

  // The render function should NOT have hardcoded "5h 窗口" for Codex primary
  // Instead it should derive the label from c.primary.windowMinutes
  // Find the Codex section in the render function
  const codexSection = js.match(/if \(d\.codex\) \{[\s\S]*?if \(d\.claude\)/);
  assert.ok(codexSection, 'Should find Codex section in usagePanel.render');

  // Should NOT contain hardcoded "5h 窗口" for primary
  assert.doesNotMatch(codexSection[0], /this\.bar\('5h 窗口',\s*c\.primary/);

  // Should reference windowMinutes for dynamic labeling
  assert.match(codexSection[0], /windowMinutes/);
});

test('Codex primary window shows reset time (expiration) like secondary does', () => {
  const js = fs.readFileSync('public/app.js', 'utf8');

  // Find the Codex section
  const codexSection = js.match(/if \(d\.codex\) \{[\s\S]*?if \(d\.claude\)/);
  assert.ok(codexSection, 'Should find Codex section in usagePanel.render');

  // The primary bar call should include fmtReset for resetsAt (expiration time)
  // Match the full primary bar call including nested parens (fmtReset() inside bar())
  const primaryBarMatch = codexSection[0].match(/c\.primary\) h \+= this\.bar\(.*?resetsAt\)\);/s);
  assert.ok(primaryBarMatch, 'Should find primary bar call with resetsAt');

  // Primary should call fmtReset to show expiration time
  assert.match(primaryBarMatch[0], /fmtReset/);
});

test('i18n-dict has translation for 1week window label', () => {
  const i18n = fs.readFileSync('public/i18n-dict.js', 'utf8');

  // Should have a translation for the 1week window label
  assert.match(i18n, /1week|1周/);
});
