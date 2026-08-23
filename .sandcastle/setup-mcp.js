#!/usr/bin/env node
// 从 .sandcastle/.mcp.json 读取配置，用 claude mcp add 注册服务器
// 绕过 .mcp.json 的交互式批准机制
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// 优先从当前 worktree 读取，回退到仓库根目录和 agent home。
const workspaceRoot = process.cwd();
const candidateMcpPaths = [
  path.join(workspaceRoot, ".sandcastle", ".mcp.json"),
  path.join(workspaceRoot, ".mcp.json"),
  path.join(process.env.HOME || "/home/agent", ".mcp.json"),
];
const mcpPath = candidateMcpPaths.find((candidate) => fs.existsSync(candidate));

if (!mcpPath) {
  console.error(".mcp.json not found (checked: " + candidateMcpPaths.join(", ") + ")");
  process.exit(1);
}

console.log("Reading MCP config from:", mcpPath);

let config;
try {
  config = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
} catch (error) {
  console.error("Failed to parse .mcp.json:", error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const servers = config && typeof config === "object" ? config.mcpServers : undefined;
if (!servers || typeof servers !== "object") {
  console.error(".mcp.json must contain an mcpServers object");
  process.exit(1);
}

// 将 assets 目录复制到 agent 可写的位置（原始目录可能属于 root）
const ORIGINAL_ASSET_ROOT = "/home/agent/mimo-vision-mcp/assets";
const WRITABLE_ASSET_ROOT = "/home/agent/workspace/.vision-assets";

function copyDirectoryContents(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source)) {
    fs.cpSync(
      path.join(source, entry),
      path.join(destination, entry),
      { recursive: true, force: true },
    );
  }
}

let failed = false;

for (const [name, server] of Object.entries(servers)) {
  if (!server || typeof server !== "object" || server.type !== "stdio") continue;
  if (typeof server.command !== "string" || !server.command) {
    console.error(`Invalid stdio MCP server command: ${name}`);
    failed = true;
    continue;
  }
  if (
    server.args !== undefined &&
    (!Array.isArray(server.args) || server.args.some((arg) => typeof arg !== "string"))
  ) {
    console.error(`Invalid stdio MCP server args: ${name}`);
    failed = true;
    continue;
  }
  if (
    server.env !== undefined &&
    (!server.env || typeof server.env !== "object" || Array.isArray(server.env))
  ) {
    console.error(`Invalid stdio MCP server env: ${name}`);
    failed = true;
    continue;
  }

  // 如果 env 中有 VISION_ASSET_ROOT 且原始目录不可写，复制到可写目录
  const env = { ...(server.env || {}) };
  if (env.VISION_ASSET_ROOT === ORIGINAL_ASSET_ROOT) {
    try {
      fs.accessSync(ORIGINAL_ASSET_ROOT, fs.constants.W_OK);
      console.log(`Asset root ${ORIGINAL_ASSET_ROOT} is writable, keeping as-is`);
    } catch {
      console.log(`Asset root not writable, copying to ${WRITABLE_ASSET_ROOT}`);
      if (!fs.existsSync(ORIGINAL_ASSET_ROOT)) {
        console.error(`Asset root does not exist: ${ORIGINAL_ASSET_ROOT}`);
        failed = true;
        continue;
      }
      copyDirectoryContents(ORIGINAL_ASSET_ROOT, WRITABLE_ASSET_ROOT);
      env.VISION_ASSET_ROOT = WRITABLE_ASSET_ROOT;
    }
  }

  const envArgs = [];
  for (const [key, value] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      console.error(`Invalid MCP environment variable name: ${key}`);
      failed = true;
      continue;
    }
    envArgs.push("-e", `${key}=${String(value)}`);
  }
  const commandArgs = [
    "mcp",
    "add",
    name,
    ...envArgs,
    "--",
    server.command,
    ...(server.args || []),
  ];
  console.log(`Registering MCP server: ${name}`);
  try {
    execFileSync("claude", commandArgs, { stdio: "inherit" });
  } catch (error) {
    failed = true;
    console.error(
      `Failed to register ${name}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

if (failed) process.exitCode = 1;
