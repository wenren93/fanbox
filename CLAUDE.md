# FanBox

FanBox — the cockpit for coding agents. Command Claude Code or Codex, watch every file and line they change, and take over anytime.

FanBox 汇集并管理分布在不同 Agent、插件和项目目录中的 Skills，让用户能够查看每个安装副本并控制其可见性。

## Language

**Skill**: 由名称表达的一项 Agent 能力；同一个 Skill 可以同时存在多个安装项。
**Skill 条目**: 外部来源中可被发现和评估、但尚未安装到本机的 Skill 记录；安装成功后才产生 Skill 安装项。
**发现**: 从受支持的外部来源搜索和浏览 Skill 条目，以便用户评估并选择是否安装。
**安装**: 用户确认 Skill 条目、目标 Agent 和风险信息后，将固定版本的外部内容安全地创建为本机 Skill 安装项。
**风险检查**: 安装前由 FanBox 对固定版本内容执行的客观静态检查。
**来源身份**: 能够唯一指向外部 Skill 条目的公开仓库和 Skill 子目录组合。
**同源更新**: 使用同一来源身份的新固定版本替换既有安装项；更新必须重新执行风险检查，旧内容保持可恢复。
**Skill 安装项**: Skill 在某一来源和目录中的具体安装副本，是选择、启停和卸载的最小对象。
**目标 Agent**: 用户为 Skill 导入选择的接收方；首批可选项是 Claude、Codex、Agents 和 WorkBuddy 的全局 Skill 位置。
**导入**: 从一个已有的有效 Skill 安装项完整复制出目标 Agent 的新安装项。
**覆盖**: 用户确认内容冲突后，以来源的完整内容替换目标安装项。
**启用**: 让一个 Skill 安装项在对应 Agent 的配置中处于可用状态。
**停用**: 让一个 Skill 安装项在对应 Agent 的配置中变为不可用但仍保留在本机。
**卸载**: 将一个 Skill 安装项移到系统废纸篓。

## Tech Stack

* **Node.js + CommonJS**: >=18

* **Electron**: ^33.2.0 — desktop app

* **node-pty**: ^1.0.0 — terminal emulation

* **@xterm/xterm**: ^6.0.0 — terminal UI

* **Monaco Editor**: ^0.52.2 — code editor

* **Milkdown**: ^7.21.2 — markdown editor

* **highlight.js**: ^11.11.1 — syntax highlighting

* **marked**: ^12.0.2 — markdown rendering

* **zod**: ^4.4.3 — schema validation

* **esbuild**: ^0.28.0 — bundler

## Project Structure

* `electron/main.js` — Electron main process

* `electron/preload.js` — preload script

* `electron/terminal-activity.js` — terminal activity handling

* `public/` — renderer HTML/CSS/JS

* `public/vendor/` — bundled vendor libs (milkdown, hljs)

* `server.js` — Node server entry

* `src-vendor/` — vendor source for esbuild bundling

* `lib/` — shared library code

* `scripts/` — utility scripts (e.g. WeChat messaging)

* `skills/` — bundled skills

* `test/` — test files

* `design-demos/` — design demo files

* `build/` — Electron build resources (icons, entitlements)

## Commands

* `npm start` — start Node server

* `npm run app` — launch Electron app

* `npm test` — run tests (`node --test test/*.test.js`)

* `npm run typecheck` — typecheck Sandcastle TypeScript files

* `npm run rebuild` — rebuild Electron native modules

* `npm run build:milkdown` — bundle Milkdown editor

* `npm run build:hljs` — bundle highlight.js + marked

* `npm run dist` — build macOS DMG (arm64)

* `npm run dist:x64` — build macOS DMG (x64)

## Code Style

* **Module system**: CommonJS (`"type": "commonjs"`)

* **Language**: 中文注释和提交信息

<br />
