# 06 — 后端扫描 / 启停 / 导入接口在链模型下的重设计

**Type:** grilling · **Blocked by:** 02 · **Status:** open · **Claimed by:** —

**GitHub issue:** [#17](https://github.com/wenren93/fanbox/issues/17)（母票 [#11](https://github.com/wenren93/fanbox/issues/11)）

## Question

`server.js` 的 Skills 透视后端（扫描、启停、批量、导入、预算统计）在链模型下怎么重构？与用户对谈收敛接口设计。

待收敛的具体决策：

1. **扫描模型**：从「扫四根 + 插件 + 项目级、按 realpath 去重、每个目录是一个安装项」改为「扫正本仓为行 + 扫四 agent 目录的链接为列状态」。agent 目录里发现的**非链实体**（真实目录、外部链、断链）如何呈现与处置（迁移提示？残留告警？）。现有 `importTargets`、`toggleStrategy`（claude-settings/codex-config/directory）大部分作废，替代接口的形状。
2. **启停接口**：`/api/skills/toggle` → `/api/skills/link`（POST 建/删链）。校验沿袭「只动扫描清单内的路径」；目标被占用时的冲突返回（走覆盖决策）。写入仍走 `queueSkillsWrite` 串行队列。
3. **链的建立规则**：相对链（`../../.agents/skills/x`，zcode 手写链与 skills.sh 惯例）vs 绝对链——定一种；链接目标不存在（正本缺失）时的错误语义；建链前是否 stat 正本有效性。
4. **状态读取**：图标状态 = lstat(agentDir/name) 为软链且 realpath 落在正本仓内；官方配置启停的存量记录是否参与状态合成（依 02 号票决策）。
5. **健康检查**：新增断链检测（链在、正本亡）、死环检测（链指回自身）、正本仓内混入的外部链识别。现有 description 截断/预算检查保留。
6. **迁移接口**：03 号票的方案需要的服务端能力（拆整目录链、死环修复、批量替换拷贝为链、可见性快照与比对报告）是独立 `/api/skills/migrate` 族还是复用现有 batch。
7. **兼容期**：旧客户端/并发多窗口（多窗口写队列已存在）在接口切换期的行为；`skills_disabled` 与 `_disabled` 的历史兼容保留多久。

产出：接口与数据形状决策清单，供 07 号票成文。
