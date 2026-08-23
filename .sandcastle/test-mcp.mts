// Test script to verify MCP configuration in SandCastle sandbox
import * as sandcastle from "@ai-hero/sandcastle";
import { podman } from "@ai-hero/sandcastle/sandboxes/podman";

const hooks = {
  sandbox: {
    onSandboxReady: [
      { command: "npm install", timeoutMs: 300_000 },
      // 注册 MCP 服务器（自动处理 assets 目录权限问题）
      { command: "node .sandcastle/setup-mcp.js" },
    ],
  },
};

const copyToWorktree = [
  ".claude",
  ".mcp.json",
  ".sandcastle/setup-mcp.js",
  ".sandcastle/.mcp.json",
];

console.log("Testing MCP configuration in SandCastle sandbox...\n");

const result = await sandcastle.run({
  hooks,
  sandbox: podman(),
  branchStrategy: { type: "branch", branch: "test-mcp-verification" },
  name: "mcp-test",
  maxIterations: 1,
  agent: sandcastle.claudeCode("stealth/ox-alpha"),
  promptFile: "./.sandcastle/test-mcp.md",
  copyToWorktree,
});

console.log("\n=== Test Result ===");
console.log(result.stdout);
console.log("\n=== Commits ===");
console.log(result.commits);
