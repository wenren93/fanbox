# 03 — 存量拷贝与死环的一次性迁移方案

**Type:** grilling · **Blocked by:** 01 · **Status:** resolved（closed）· **Claimed by:** wenren93（2026-08-23）

**GitHub issue:** [#14](https://github.com/wenren93/fanbox/issues/14)（母票 [#11](https://github.com/wenren93/fanbox/issues/11)）· **Resolution:** [issuecomment-5384494094](https://github.com/wenren93/fanbox/issues/14#issuecomment-5384494094)

## Question

怎么把这台机器的现状（见 map Notes 的勘察清单）迁到「正本 + 四 agent 软链」终态，且每一步可回滚？与用户对谈收敛迁移方案。

迁移面（按风险从高到低）：

1. **`~/.claude/skills` 整目录链拆解**：删整目录链 → 建真实目录 → 为当前 Claude 可见的每个 skill 建逐条软链。默认保持迁移前后 Claude 可见性不变。风险窗口：拆链瞬间 Claude 短暂看不到 skills。
2. **`~/.agents/skills` 自引用死环（约 20 个）**：这些名字的正本实际在 `fanbox/.agents/skills/`（仓库内）。收编方式：把仓库副本提升为正本仓真实目录？还是正本仓放链指向仓库（仓库变外部正本）？逐名决策还是批量规则（如同名仓库目录存在则收编）？
3. **`~/.codex/skills` 的 `.cc-switch` 链**：Codex 现有 37 条链指向 `~/.cc-switch/skills`。保持链不动（cc-switch 继续管）还是改指到 `.agents` 正本？同名内容在 `.agents` 与 `.cc-switch` 之间漂移的（如 code-review）以哪边为准？`a-stock-data`、`wechat-reminder` 等 Codex 独有真实目录要不要入正本仓？
4. **`~/.workbuddy/skills` 的 60 个真实目录**：与正本同名的去重替换为链；仅 WorkBuddy 有的（writing-* 系列、superpowers 等）收编入正本仓再回链。WorkBuddy 现有 `skills_disabled` 状态如何映射（禁用=不建链）。
5. **ZCode**：已有 2 条手写链；若 01 号票证实 ZCode 原生读 `~/.agents/skills`，ZCode 列可能**零迁移**（或需要处理双读）。
6. **执行形态**：一次性向导（扫描→出清单→用户确认→批量执行→报告）vs 渐进式（UI 里逐 skill 提供「转为链接」操作）。用户偏好与可回滚要求（沿用现有 trash/备份机制）。
7. **验收**：迁移后四 agent 可见性逐一比对迁移前快照（谁启着/停着不变），正本仓无死环，`.cc-switch`/ego 等外部正本不被破坏。

产出：迁移方案决策 + 分步清单（含回滚点）。不执行。
