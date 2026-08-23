# 01 — 四个 agent 对 skills 目录的真实发现行为

**Type:** research · **Blocked by:** — · **Status:** open · **Claimed by:** research-agent

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
