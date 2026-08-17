'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const packageJson = require('../package.json');

test('Sandcastle runner uses parallel planner with podman sandbox and three phases', () => {
  const runner = fs.readFileSync('.sandcastle/main.mts', 'utf8');

  assert.equal(packageJson.scripts['sandcastle:codex'], 'tsx .sandcastle/main.mts');
  assert.equal(packageJson.devDependencies['@ai-hero/sandcastle'], '0.12.0');
  // podman sandbox instead of noSandbox
  assert.match(runner, /sandbox:\s*podman\(\)/);
  // branch strategy for each issue
  assert.match(runner, /branchStrategy:\s*\{[\s\S]*?type:\s*["']branch["']/);
  // three named phases: planner, implementer, merger
  assert.match(runner, /name:\s*["']planner["']/);
  assert.match(runner, /name:\s*["']implementer["']/);
  assert.match(runner, /name:\s*["']merger["']/);
  // claudeCode agent
  assert.match(runner, /sandcastle\.claudeCode\(/);
  // structured output with plan schema
  assert.match(runner, /Output\.object\(\{[\s\S]*?tag:\s*["']plan["']/);
  // prompt files for each phase
  assert.match(runner, /["']\.\/\.sandcastle\/plan-prompt\.md["']/);
  assert.match(runner, /["']\.\/\.sandcastle\/implement-prompt\.md["']/);
  assert.match(runner, /["']\.\/\.sandcastle\/merge-prompt\.md["']/);
  // retry logic for transient errors
  assert.match(runner, /withRetry\(/);
  assert.doesNotMatch(runner, /completionSignal/);
  assert.doesNotMatch(runner, /await interactive\s*\(/);
});

test('Sandcastle implement prompt focuses on a single task with RGR cycle', () => {
  const implement = fs.readFileSync('.sandcastle/implement-prompt.md', 'utf8');

  assert.match(implement, /ONLY WORK ON A SINGLE TASK/);
  assert.match(implement, /<promise>COMPLETE<\/promise>/);
  assert.match(implement, /npm run test/);
  assert.match(implement, /RALPH:/);
  assert.doesNotMatch(implement, /pnpm run (?:test|typecheck)/);
});

test('Sandcastle merge prompt merges branches and closes issues', () => {
  const merge = fs.readFileSync('.sandcastle/merge-prompt.md', 'utf8');

  assert.match(merge, /git merge.*--no-edit/);
  assert.match(merge, /npm run typecheck/);
  assert.match(merge, /npm run test/);
  assert.match(merge, /gh issue close/);
  assert.match(merge, /<promise>COMPLETE<\/promise>/);
});

test('Sandcastle plan prompt fetches open issues and outputs plan JSON', () => {
  const plan = fs.readFileSync('.sandcastle/plan-prompt.md', 'utf8');

  assert.match(plan, /gh issue list/);
  assert.match(plan, /<plan>/);
  assert.match(plan, /dependency graph/i);
  assert.match(plan, /sandcastle\/issue-/);
  assert.match(plan, /\{"issues":\s*\[/);
});
