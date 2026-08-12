import { codex, interactive } from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";

const fullAccess = process.env.CODEX_FULL_ACCESS === "1";
const baseAgent = codex("gpt-5.6-sol");
const agent = fullAccess
  ? {
      ...baseAgent,
      buildInteractiveArgs(
        options: Parameters<NonNullable<typeof baseAgent.buildInteractiveArgs>>[0],
      ) {
        const args = baseAgent.buildInteractiveArgs!(options);
        args.splice(1, 0, "--dangerously-bypass-approvals-and-sandbox");
        return args;
      },
    }
  : baseAgent;

if (fullAccess) {
  console.warn(
    "[Sandcastle] CODEX_FULL_ACCESS=1：已关闭 Codex 审批和沙盒，进程可直接操作主机。",
  );
}

await interactive({
  agent,
  sandbox: noSandbox(),
  promptFile: "./.sandcastle/prompt.md",
});
