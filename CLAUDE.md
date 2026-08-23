# FanBox

FanBox — the cockpit for coding agents. Command Claude Code or Codex, watch every file and line they change, and take over anytime.

FanBox 以「原件 + 接入」模型管理本机 Skills：每个 Skill 只有一份原件，各 Agent 通过接入引用它，FanBox 让用户看清每个 Agent 能看到什么，并一处维护、逐 Agent 启停。

## Language

完整词汇表以 `CONTEXT.md` 为准；核心词条：

**Skill**: 由名称表达的一项 Agent 能力；对应一个原件和各 Agent 的接入状态，不再以多副本形式存在。
**原件**: 一个 Skill 的权威内容目录，是所有引用最终指向的真实目录。
**原件仓**: `~/.agents/skills`，FanBox 存放自管原件的目录；Codex 与 ZCode 原生扫描它。
**Skill 条目**: 外部来源中可被发现和评估、但尚未安装到本机的 Skill 记录。
**发现**: 从受支持的外部来源搜索和浏览 Skill 条目。
**安装**: 将固定版本的外部内容安全地创建为原件仓中的原件，并按所选 Agent 建立接入；纯库存合法。
**风险检查**: 内容成为原件前（安装与收编）执行的同一套客观静态检查。
**健康检查**: 对本机原件与接入现值的持续只读检查（断链、死环、漂移、外部修改等）。
**来源身份**: 能够唯一指向外部 Skill 条目的公开仓库和 Skill 子目录组合。
**同源更新**: 用同一来源身份的新固定版本原子替换原件；呈现受影响接入范围，旧内容可恢复。
**接入 / 取消接入**: 让某 Agent 的后续会话发现 / 不再发现一个原件；形态随 Agent 原生机制而异（软链、配置或拷贝）。
**收编**: 把原件仓外的本机 Skill 拷贝提升为原件仓中的原件。
**外来原件**: 原件仓中没有来源身份记录的原件；同权管理接入与卸载，无同源更新。
**目标 Agent**: 接入的接收方；首批为 Claude、Codex、ZCode 和 WorkBuddy。
**内容冲突 / 覆盖 / 接管**: 接入目标位已有同名实体时经确认完整替换并保持可恢复；FanBox 的来源身份记录随之接管。
**卸载**: 原件仓原件进系统废纸篓并取消全部接入；外部原件仅取消接入。
**批量管理**: 多个 Skill 或整列表达一次接入、取消接入或卸载意图的临时模式。

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
