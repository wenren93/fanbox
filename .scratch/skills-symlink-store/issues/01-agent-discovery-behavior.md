# 01 — 四个 agent 对 skills 目录的真实发现行为

**Type:** research · **Blocked by:** — · **Status:** resolved · **Claimed by:** research-agent

**GitHub issue:** [#12](https://github.com/wenren93/fanbox/issues/12)（母票 [#11](https://github.com/wenren93/fanbox/issues/11)）

## Question

链模型的地基事实：Claude Code、Codex、WorkBuddy、ZCode 各自实际从哪些目录发现 skills、是否跟随符号链接、是否原生读 `~/.agents/skills`、官方启停机制在「链接存在/不存在」下的语义是什么？需要一份逐 agent 的事实清单，每条注明来源（官方文档 / 本机实证）。

待回答的具体问题：

1. **Claude Code**：`~/.claude/skills` 是否跟随逐 skill 软链（本机整目录链已实证可用，逐 skill 链是否同样被 `Skill` 工具发现）？`settings.json` `skillOverrides` 在链模式下的行为（按名称生效，删链后遗留的 override 是否无害）？是否原生扫描 `~/.agents/skills`？
2. **Codex**：`~/.codex/skills` 是否跟随软链？`config.toml` `[[skills.config]]` path + enabled 的官方语义与重启要求；是否原生读 `~/.agents/skills`（server.js 目前把 agents 目录的启停投影到 Codex config，这个耦合是否成立）？
3. **ZCode**：扫描哪些目录（本机实证：`~/.zcode/skills` 与 `~/.agents/skills` 同时被读，同一 skill 出现两次，如 eli5）？是否按 realpath 去重？有没有官方启停/禁用机制？逐 skill 软链是否可用（本机已有 `eli5`、`agently-mail` 两条相对链，可实证）？
4. **WorkBuddy**：`~/.workbuddy/skills` + 同级 `skills_disabled` 约定；是否跟随软链？
5. **skills.sh 安装器约定**：它装到 `~/.agents/skills` 后为各 agent 建的链接是相对还是绝对、链到哪些 agent 目录——FanBox 的链接风格应与之一致，避免两套工具互相破坏。

本机可实证的证据：`~/.claude/settings.json`、`~/.codex/config.toml` 现内容；本会话（ZCode）的可用 skills 清单里 eli5 双列；`~/.zcode/skills` 的两条手写链。

发现文件落 `.scratch/skills-symlink-store/research/01-agent-discovery-behavior.md`，票内留指针。

## Resolution

- **Claude Code**：不原生读 `~/.agents/skills`（本机靠整目录链）；**逐 skill 软链官方支持且按目标去重**；`skillOverrides` 按名生效，删链后残留无害（本机实证）；SKILL.md 变更免重启。
- **Codex**：原生读 `~/.agents/skills`（USER 主位置），`~/.codex/skills` 为废弃但仍扫描的兼容根；User/Repo/Admin 范围**一律跟随目录软链**（源码级证实）；`[[skills.config]]` 按 canonical SKILL.md 路径或 name 匹配、缺省即启用、`enabled=true` 仅用于抵消更早的 false；config 改动必须重启 Codex。
- **ZCode**：官方扫描 `~/.zcode/skills` 与 `~/.agents/skills`（+ 工作区与插件根），**不按 realpath 去重**（本会话 eli5 双列已核实，且重名会触发 Skill 工具 ambiguous 报错）；逐 skill 相对链可用、断链无害；官方禁用 = config.json 按绝对路径 enable:false。
- **WorkBuddy**：`skills_disabled` 是 FanBox 自创约定（asar 内 0 处）；渲染层清单会跳过顶层软链（isDirectory），真实 loader 在 daemon 内无法证实——**四家中唯一链模型未证实者**。
- **skills.sh**：正本 = `~/.agents/skills` 真实目录，**逐 skill 相对链**；claude/zcode 链到各自目录，codex 视为 universal 全局不建链；FanBox 链接风格应取相对路径与之同构。
- 发现文件：`../research/01-agent-discovery-behavior.md`（逐 agent 事实表 + 对 02/03 启示 + 未决问题 5 项）。
