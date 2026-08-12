'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const packageJson = require('../package.json');

test('Sandcastle runner launches an optional-prompt interactive local Codex session on an explicit task branch', () => {
  const runner = fs.readFileSync('.sandcastle/main.mts', 'utf8');

  assert.equal(packageJson.scripts['sandcastle:codex'], 'tsx .sandcastle/main.mts');
  assert.equal(packageJson.devDependencies['@ai-hero/sandcastle'], '0.12.0');
  assert.match(runner, /sandbox:\s*noSandbox\(\)/);
  assert.match(runner, /branchStrategy:\s*\{[\s\S]*?type:\s*["']branch["']/);
  assert.match(runner, /sandcastle\/fanbox-/);
  assert.match(runner, /CODEX_MODEL\?\.trim\(\) \|\| ["']gpt-5\.6-sol["']/);
  assert.match(runner, /codex\(model/);
  assert.match(runner, /model_reasoning_effort=/);
  assert.match(runner, /await interactive\s*\(/);
  assert.match(runner, /\.\.\.\(task \? \{ prompt \} : \{\}\)/);
  assert.doesNotMatch(runner, /completionSignal/);
  assert.doesNotMatch(runner, /if \(!task\)/);
});

test('Sandcastle plan prompt continues through every unfinished phase', () => {
  const prompt = fs.readFileSync('.sandcastle/prompt.md', 'utf8');
  const interactiveRunner = fs.readFileSync('.sandcastle/interactive.mts', 'utf8');

  assert.match(interactiveRunner, /await interactive\s*\(/);
  assert.match(interactiveRunner, /promptFile:\s*["']\.\/\.sandcastle\/prompt\.md["']/);
  assert.match(interactiveRunner, /CODEX_FULL_ACCESS\s*===\s*["']1["']/);
  assert.match(interactiveRunner, /--dangerously-bypass-approvals-and-sandbox/);
  assert.match(prompt, /Implement every unfinished phase in dependency order/);
  assert.match(prompt, /continue to the next phase automatically/i);
  assert.match(prompt, /npm test/);
  assert.match(prompt, /<promise>NO MORE TASKS<\/promise>/);
  assert.doesNotMatch(prompt, /ONLY WORK ON A SINGLE TASK/);
  assert.doesNotMatch(prompt, /only work on a single phase/i);
  assert.doesNotMatch(prompt, /pnpm run (?:test|typecheck)/);
});

test('Sandcastle plan prompt expands a phase directory in filename order', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fanbox sandcastle-plan-'));
  const planDir = path.join(root, 'phase plans');
  fs.mkdirSync(planDir);
  fs.writeFileSync(path.join(planDir, '02-second.md'), '# Phase 02\nsecond');
  fs.writeFileSync(path.join(planDir, '01-first.md'), '# Phase 01\nfirst');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const prompt = fs.readFileSync('.sandcastle/prompt.md', 'utf8');
  const expression = [...prompt.matchAll(/!`([^`]*\{\{ PLAN_LOCATION \}\}[^`]*)`/g)][0]?.[1];
  assert.ok(expression, 'PLAN_LOCATION shell expression should exist');
  const command = expression.replaceAll('{{ PLAN_LOCATION }}', planDir);
  const result = spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.indexOf('# Phase 01') < result.stdout.indexOf('# Phase 02'));
});
