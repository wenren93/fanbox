import { codex, interactive } from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";

const task =
  process.argv.slice(2).join(" ").trim() || process.env.SANDCASTLE_TASK?.trim();

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error("Sandcastle 交互模式需要在 TTY 终端中运行");
  process.exit(1);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const branch =
  process.env.SANDCASTLE_BRANCH?.trim() ||
  `sandcastle/fanbox-${timestamp}`;
const model = process.env.CODEX_MODEL?.trim() || "gpt-5.6-sol";
const effort = process.env.CODEX_EFFORT?.trim() || "high";

if (!new Set(["low", "medium", "high", "xhigh"]).has(effort)) {
  console.error("CODEX_EFFORT 只支持 low、medium、high 或 xhigh");
  process.exit(1);
}

console.warn(
  "[Sandcastle] 未启用 Sandcastle 容器隔离；Codex 自身审批与沙盒策略仍按本机配置执行。",
);
console.log(`[Sandcastle] 任务分支：${branch}`);
console.log(`[Sandcastle] Codex 模型：${model}（默认推理强度：${effort}）`);
console.log(
  task
    ? "[Sandcastle] 将用给定任务启动 Codex 交互会话。"
    : "[Sandcastle] 未给初始任务，将直接进入 Codex 交互界面。",
);

const baseAgent = codex(model, {
  effort: effort as "low" | "medium" | "high" | "xhigh",
});
const agent = {
  ...baseAgent,
  buildInteractiveArgs(options: Parameters<NonNullable<typeof baseAgent.buildInteractiveArgs>>[0]) {
    const args = baseAgent.buildInteractiveArgs!(options);
    args.splice(3, 0, "-c", `model_reasoning_effort=${JSON.stringify(effort)}`);
    return args;
  },
};

const prompt = task
  ? `
# 任务

${task}

# 工作约定

- 只处理上述任务，不修改无关文件。
- 遵守仓库 AGENTS.md 和现有代码约定。
- 先理解相关实现，再进行修改；不要执行不可逆或任务范围外的操作。
- 完成后运行与改动相关的测试；完整测试命令为 npm test（当前等价于 node --test test/*.test.js）。
- 检查 git diff，确保没有秘密、凭据或无关产物。
- 如需提交，用中文提交信息说明需求或问题及实现思路。
  `.trim()
  : undefined;

const result = await interactive({
  name: "FanBox Interactive Codex",
  agent,
  sandbox: noSandbox(),
  branchStrategy: {
    type: "branch",
    branch,
  },
  ...(task ? { prompt } : {}),
});

console.log("\n[Sandcastle] 交互会话结束");
console.log("分支：", result.branch);
console.log(
  "提交：",
  result.commits.length
    ? result.commits.map(({ sha }) => sha).join(", ")
    : "无提交",
);
if (result.preservedWorktreePath) {
  console.log("保留的 worktree：", result.preservedWorktreePath);
}
console.log("退出码：", result.exitCode);

if (result.exitCode !== 0) process.exitCode = result.exitCode;
