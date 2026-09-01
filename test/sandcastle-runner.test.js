'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const packageJson = require('../package.json');

test('Sandcastle runner uses no sandbox for the sequential review workflow', () => {
  const runner = fs.readFileSync('.sandcastle/main.mts', 'utf8');

  assert.equal(packageJson.scripts['sandcastle:codex'], 'tsx .sandcastle/main.mts');
  assert.equal(packageJson.scripts.typecheck, 'tsc -p tsconfig.sandcastle.json');
  assert.equal(packageJson.devDependencies['@ai-hero/sandcastle'], '0.12.0');
  assert.match(runner, /sandboxes\/no-sandbox/);
  assert.match(runner, /sandbox:\s*noSandbox\(\)/);
  assert.doesNotMatch(runner, /sandboxes\/podman|podman\(\)/);
  assert.match(runner, /sandcastle\.createSandbox\(\{/);
  assert.match(runner, /branch,\s*\n\s*sandbox:\s*noSandbox\(\)/);
  assert.match(runner, /name:\s*["']implementer["']/);
  assert.match(runner, /name:\s*["']reviewer["']/);
  assert.match(runner, /sandcastle\.codex\(/);
  assert.match(runner, /["']\.\/\.sandcastle\/implement-prompt\.md["']/);
  assert.match(runner, /["']\.\/\.sandcastle\/review-prompt\.md["']/);
  assert.match(runner, /finally\s*\{\s*await sandbox\.close\(\)/);
});

test('Sandcastle implement prompt focuses on a single task with RGR cycle', () => {
  const implement = fs.readFileSync('.sandcastle/implement-prompt.md', 'utf8');

  assert.match(implement, /Work on issues in this order/);
  assert.match(implement, /one issue per iteration/i);
  assert.match(implement, /<promise>COMPLETE<\/promise>/);
  assert.match(implement, /Red → Green → Repeat → Refactor/);
  assert.match(implement, /npm run typecheck/);
  assert.match(implement, /npm run test/);
  assert.match(implement, /RALPH:/);
  assert.match(implement, /gh issue close <ID>/);
});

test('Sandcastle review prompt reviews and verifies the implementation branch', () => {
  const review = fs.readFileSync('.sandcastle/review-prompt.md', 'utf8');

  assert.match(review, /\{\{BRANCH\}\}/);
  assert.match(review, /Check correctness/);
  assert.match(review, /Run tests and type checking/);
  assert.match(review, /preserving exact functionality/i);
  assert.match(review, /<promise>COMPLETE<\/promise>/);
});
