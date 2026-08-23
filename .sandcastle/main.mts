// Parallel Planner — three-phase orchestration loop (Ralph 版本)
//
// Ralph 版本特点:
//   - 最外层循环最大 5 次
//   - 当 plan 阶段没有发现 issue 时，进入 60s 睡眠后重试
//
// 三个阶段:
//   Phase 1 (Plan):    分析 open issues，构建依赖图，输出可并行处理的 issue 列表
//   Phase 2 (Execute): 并行执行每个 issue
//   Phase 3 (Merge):   合并所有产生提交的分支
//
// Usage:
//   npx tsx .sandcastle/main.mts

import * as sandcastle from "@ai-hero/sandcastle";
import { podman } from "@ai-hero/sandcastle/sandboxes/podman";
import { z } from "zod";

// plan 输出的 JSON schema。分支名由模型输出，必须在进入 git 操作前严格校验。
const issueSchema = z
  .object({
    id: z.string().regex(/^\d+$/, "issue id 必须是数字"),
    title: z.string().trim().min(1, "issue title 不能为空"),
    branch: z
      .string()
      .regex(/^sandcastle\/issue-\d+$/, "branch 必须匹配 sandcastle/issue-{id}"),
  })
  .superRefine((issue, ctx) => {
    if (issue.branch !== `sandcastle/issue-${issue.id}`) {
      ctx.addIssue({
        code: "custom",
        path: ["branch"],
        message: "branch 必须与 issue id 一致",
      });
    }
  });

const planSchema = z
  .object({
    issues: z.array(issueSchema).max(100),
  })
  .superRefine((plan, ctx) => {
    const seenIds = new Set<string>();
    for (const [index, issue] of plan.issues.entries()) {
      if (seenIds.has(issue.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["issues", index, "id"],
          message: `issue ${issue.id} 重复`,
        });
      }
      seenIds.add(issue.id);
    }
  });

type PlannedIssue = z.infer<typeof issueSchema>;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// 最大循环次数
const MAX_ITERATIONS = 5;

// 无 issue 时的睡眠时间（毫秒）
const SLEEP_MS = 60_000;

// implementer 错峰启动间隔（毫秒）——避免同秒并发建容器触发 podman API 抖动
const IMPLEMENTER_STAGGER_MS = 10_000;

// 所有 agent 都需要依赖；只有 planner 和 implementer 需要 vision MCP。
const installHooks = {
  sandbox: {
    onSandboxReady: [
      { command: "npm install --ignore-scripts", timeoutMs: 300_000 },
    ],
  },
};

const agentHooks = {
  sandbox: {
    onSandboxReady: [
      ...installHooks.sandbox.onSandboxReady,
      // 注册 MCP 服务器（自动处理 assets 目录权限问题）
      { command: "node .sandcastle/setup-mcp.js" },
    ],
  },
};

// Claude/MCP 相关信息复制到隔离 worktree 的文件；这些路径中的密钥文件均被 gitignore。
const copyToWorktree = [
  ".claude",
  ".mcp.json",
  ".sandcastle/setup-mcp.js",
  ".sandcastle/.mcp.json",
];

// planner 需要 MCP，但不应直接修改当前分支；merge-to-head 会使用临时分支并在结束时清理。
const plannerBranchStrategy = { type: "merge-to-head" as const };
const mergerBranchStrategy = { type: "merge-to-head" as const };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// planner 没有仓库副作用，遇到瞬态错误自动重试。
const RETRY_COUNT = 3;
const RETRY_DELAY_MS = 10_000;

// 瞬态错误特征：网络不可用、API 限流、服务器过载等
const TRANSIENT_PATTERNS = [
  /503/,          // Service Unavailable
  /429/,          // Too Many Requests (rate limit)
  /ECONNRESET/,
  /ETIMEDOUT/,
  /ENOTFOUND/,
  /EAI_AGAIN/,
  /socket hang up/,
  /network/i,
];

function isTransient(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return TRANSIENT_PATTERNS.some((p) => p.test(msg));
}

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  retries = RETRY_COUNT,
  delayMs = RETRY_DELAY_MS,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // 非瞬态错误直接抛出，不浪费重试
      if (!isTransient(err)) {
        throw err;
      }
      if (attempt < retries) {
        console.error(
          `  ✗ ${label} failed (attempt ${attempt}/${retries}): ${err}`,
        );
        console.error(`    Retrying in ${delayMs / 1000}s...`);
        await sleep(delayMs);
      }
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

const unresolvedIssueIds = new Set<string>();

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
  console.log(`\n=== Ralph Iteration ${iteration}/${MAX_ITERATIONS} ===\n`);

  // -------------------------------------------------------------------------
  // Phase 1: Plan
  // -------------------------------------------------------------------------
  const plan = await withRetry("planner", () =>
    sandcastle.run({
      hooks: agentHooks,
      copyToWorktree,
      sandbox: podman(),
      branchStrategy: plannerBranchStrategy,
      name: "planner",
      maxIterations: 1,
      agent: sandcastle.claudeCode("stealth/ox-alpha"),
      promptFile: "./.sandcastle/plan-prompt.md",
      output: sandcastle.Output.object({ tag: "plan", schema: planSchema }),
    }),
  );

  const issues: PlannedIssue[] = plan.output.issues;

  if (issues.length === 0) {
    // 没有发现 issue —— 睡眠后继续下一轮；最后一轮不再无意义地等待。
    if (iteration < MAX_ITERATIONS) {
      console.log(
        `No unblocked issues found. Sleeping ${SLEEP_MS / 1000}s before next iteration...`,
      );
      await sleep(SLEEP_MS);
    } else {
      console.log("No unblocked issues found.");
    }
    continue;
  }

  console.log(
    `Planning complete. ${issues.length} issue(s) to work in parallel:`,
  );
  for (const issue of issues) {
    console.log(`  ${issue.id}: ${issue.title} → ${issue.branch}`);
  }

  // -------------------------------------------------------------------------
  // Phase 2: Execute
  // -------------------------------------------------------------------------
  const settled = await Promise.allSettled(
    issues.map((issue, index) =>
      (async () => {
        if (index > 0) {
          await sleep(index * IMPLEMENTER_STAGGER_MS);
        }
        return sandcastle.run({
          hooks: agentHooks,
          copyToWorktree,
          sandbox: podman(),
          branchStrategy: { type: "branch", branch: issue.branch },
          name: "implementer",
          maxIterations: 100,
          agent: sandcastle.claudeCode("stealth/ox-alpha"),
          promptFile: "./.sandcastle/implement-prompt.md",
          promptArgs: {
            TASK_ID: issue.id,
            ISSUE_TITLE: issue.title,
            BRANCH: issue.branch,
          },
        });
      })(),
    ),
  );

  // 记录失败的 agent
  for (const [i, outcome] of settled.entries()) {
    if (outcome.status === "rejected") {
      unresolvedIssueIds.add(issues[i]!.id);
      console.error(
        `  ✗ ${issues[i]!.id} (${issues[i]!.branch}) failed: ${outcome.reason}`,
      );
    } else if (outcome.value.commits.length > 0) {
      unresolvedIssueIds.delete(issues[i]!.id);
    } else {
      unresolvedIssueIds.add(issues[i]!.id);
      console.error(
        `  ✗ ${issues[i]!.id} (${issues[i]!.branch}) produced no commit`,
      );
    }
  }

  // 筛选有提交的分支
  const completedIssues = settled
    .map((outcome, i) => ({ outcome, issue: issues[i]! }))
    .filter(
      (
        entry,
      ): entry is {
        outcome: PromiseFulfilledResult<
          Awaited<ReturnType<typeof sandcastle.run>>
        >;
        issue: (typeof issues)[number];
      } =>
        entry.outcome.status === "fulfilled" &&
        entry.outcome.value.commits.length > 0,
    )
    .map((entry) => entry.issue);

  const completedBranches = completedIssues.map((i) => i.branch);

  console.log(
    `\nExecution complete. ${completedBranches.length} branch(es) with commits:`,
  );
  for (const branch of completedBranches) {
    console.log(`  ${branch}`);
  }

  if (completedBranches.length === 0) {
    console.log("No commits produced. Nothing to merge.");
    continue;
  }

  // -------------------------------------------------------------------------
  // Phase 3: Merge
  // -------------------------------------------------------------------------
  // merge 会产生真实 git/Issue 副作用，不对它做自动重试，避免重复合并或关闭 issue。
  await sandcastle.run({
    hooks: installHooks,
    sandbox: podman(),
    branchStrategy: mergerBranchStrategy,
    name: "merger",
    maxIterations: 1,
    agent: sandcastle.claudeCode("stealth/ox-alpha"),
    promptFile: "./.sandcastle/merge-prompt.md",
    promptArgs: {
      BRANCHES: completedBranches.map((b) => `- ${b}`).join("\n"),
      ISSUES: completedIssues.map((i) => `- ${i.id}: ${i.title}`).join("\n"),
    },
  });

  console.log("\nBranches merged.");
}

if (unresolvedIssueIds.size > 0) {
  console.error(
    `\nCompleted with unresolved issue(s): ${[...unresolvedIssueIds].sort((a, b) => Number(a) - Number(b)).join(", ")}`,
  );
  process.exitCode = 1;
} else {
  console.log("\nAll done.");
}
