# 04 — Skill × Agent 图标矩阵的 UI 设计

**Type:** grilling（可产出 prototype）· **Blocked by:** 02 · **Status:** open · **Claimed by:** —

**GitHub issue:** [#15](https://github.com/wenren93/fanbox/issues/15)（母票 [#11](https://github.com/wenren93/fanbox/issues/11)）

## Question

Skills 透视「已安装」页从「安装项列表」改为「Skill 行 + agent 图标矩阵」后的界面长什么样、怎么交互？以低保真原型（design-demos 或 HTML 草稿）辅助与用户对谈收敛。

待收敛的具体决策：

1. **行模型**：一行 = 一个 Skill（正本），右侧固定四列 agent 图标（Claude / Codex / WorkBuddy / ZCode）。图标亮 = 该 agent 目录存在指向正本的链；灰 = 无链。点图标 = 建链/删链。现有行内容（描述、触发统计、健康问题、mtime）如何保留。
2. **未接入正本**：正本存在但四列全灰的 skill 怎么呈现（不丢——它们是「库存」）；来源是外部正本（ego 链）的行怎么标注。
3. **agent 筛选页签**：参考截图顶部的「Claude: N / Codex: N」带计数页签；筛选语义 = 链存在的 skills。现有 source 筛选（全局/插件/项目级）与之并存还是合并。
4. **项目级与插件 skills 的去处**：链接矩阵只覆盖四个全局 agent；项目级（`.claude/skills` 等）与插件 skills 在新 UI 里是保留原列表形态、单独页签，还是「其他来源」折叠区。
5. **批量操作**：现有 batch（启停/卸载）映射为「按列批量建链/删链」？跨 skill 全列操作（如「全部接入 Codex」）要不要。
6. **反馈与失败态**：点图标的即时态（busy/成功 toast/失败原因——目标被同名真实目录占用时的引导走覆盖流程）；断链（正本被删）的行级警告。
7. **触发统计与预算**：hits 现按 skill 名聚合（Claude/Codex 日志），行模型下天然按 skill 归位；Claude 描述预算改为统计「Claude 列亮着的」skills。

产出：UI 决策清单 + 可选低保真原型（design-demos/ 下，命名带 skills-symlink 前缀，用完可删）。
