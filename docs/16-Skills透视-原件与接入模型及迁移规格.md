# Skills 透视：原件 + 接入模型与一次性迁移规格

状态：`ready-for-agent` · 本规格是「原件 + 软链」改造的实施总纲，合成决策票 02（领域语言）、03（迁移）、04（UI）、05（安装/收编）、06（接口）、08（外来原件）的全部结论。实施会话以本规格 + docs/14（收编）+ docs/15（发现与安装）+ ADR 0001/0005 为完整输入，无需回读 wayfinder 地图。

## 1. 模型总览

- **一行一 Skill**：核心对象 = 原件 + 各 Agent 接入状态。「安装项」「导入」「目标安装项」退役。
- **原件 = 链条最终指向的真实目录**。原件仓 `~/.agents/skills` 是 FanBox 自管原件的存放地；仓库家族（`fanbox/.agents/skills/`）原件留在仓库、原件仓放逐条相对链（git 继续当唯一真源）；外部工具目录（ego、.cc-switch 等）作为外部原件被引用，FanBox 不碰其内容。
- **接入机制混合原生**（详见 ADR 0005）：Claude = 逐 skill 相对软链 `../../.agents/skills/<name>`；Codex = 不建链、`~/.codex/config.toml` 启停（原生扫描原件仓，重启生效）；ZCode = 不建链、`~/.zcode/cli/config.json` 按原件绝对路径 `enable` 开关（消除双读）；WorkBuddy = 拷贝入 `~/.workbuddy/skills` / 移入 `skills_disabled`。
- **图标状态 = 只读各列现值**（链 lstat/realpath、config 现值、WorkBuddy 目录在否），不做「官方配置残留 AND 链」的状态合成；存量残留由迁移一次性归一。
- 「从未接入」与「取消接入」不做区分；四列全灰的**纯库存**是合法形态。
- **跨 Agent 分发 = 点亮/熄灭行内图标**，拷贝式导入不复存在；外部内容进入原件仓只有两个门：发现页安装（docs/15）与收编（docs/14）。
- **同源更新只替换原件一次**（原子换位 + 影响面提示 + trash 回滚），全部接入即时生效；**卸载两级**：点图标 = 取消接入（原件不动），行级卸载 = 原件 + 全部接入一起进 trash（外部原件只取消接入、不删内容）。

## 2. 数据形状（refresh v2）

`POST /api/skills/refresh` 返回**行 = 原件**：

```
items: [{
  name, desc, dir(原件真实路径),
  origin: 'store' | 'repo' | 'external' | 'project' | 'plugin',
  agents: {
    claude:    { on },           // lstat 软链且 realpath ∈ 原件仓（含经原件仓转指仓库）
    codex:     { on, via:'config' },
    zcode:     { on, via:'config' },
    workbuddy: { on, drift? },   // 拷贝在 ~/.workbuddy/skills；drift = 拷贝落后于原件
  },
  hits, last, health: [{ level, code, msg }],
}],
anomalies: [{ agent, name, kind: 'real-dir'|'external-link'|'broken-link'|'dead-loop', path, action }],
counts: { total, claude, codex, workbuddy, zcode, stock }
```

- 项目级与插件 skills 保持在原有扫描与展示形态（折叠区，无图标列），不进入行模型。
- 健康检查集合：断链（链在原件亡）、死环（链指回自身）、原件仓内外部链识别（origin=external 徽标数据，非错误）、WorkBuddy 拷贝漂移、已被外部修改（记录指纹/commit 与实际内容不符，见 §6）、描述预算与截断检查（保留现有）。

## 3. 接口族

### 接入与批量

- `POST /api/skills/link` `{name, agent, on}` — **单一端点四列分发**：按 ADR 0005 各列机制建/删接入。返回代价 note（如 Codex 需重启）。建链前 stat 原件有效性；目标被同名真实目录占用 → `{ok:false, conflict:{kind:'occupied', path}}`，前端走收编/覆盖流程。
- `POST /api/skills/batch` v2 — `{names[], agent, on, scope:'rows'|'column'}`（行选择与整列批量，整列带确认计数）；`{names[], action:'uninstall'}` = 先取消全部接入再 trash 原件；**外部原件（origin=external）只取消接入、绝不删外部内容**。
- `POST /api/skills/annex` — 收编，规格见 docs/14。

### 安装与更新（详见 docs/15）

- `POST /api/skills/discovery/install` v2 — 目标一律为原件仓，`agents[]` 多选装完即接入；纯库存合法（为 Codex/ZCode 写禁用配置）；`defaultTargetAgent` 单选设置退役，改多选、默认全选四 Agent。
- 同源更新确认返回**受影响接入数**；更新 = 临时副本 + 原子换位 + 旧原件进 trash，链与配置全程不动；WorkBuddy 拷贝按漂移规则刷新。

### 迁移族（独立端点，一次性向导消费）

- `POST /api/skills/migrate/scan` — 四仓 + cc-switch 备份的漂移矩阵 `{names:[{name, candidates:[{store,hash,mtime}], winner, ops[]}]}`，最新 mtime 默认胜出、逐行可改判后锁定。
- `POST /api/skills/migrate/snapshot` `{phase:'before'|'after'}` — 四 Agent 可见性快照，after 自动 diff before。
- `POST /api/skills/migrate/execute` `{plan}` — 按 §8 Phase 0–5 执行，全程 trashPath，manifest 落 `CONFIG_DIR/migration/`，返回分阶段报告 + 可见性 diff。

### 硬切换（同 server 多窗口同版本，无旧客户端）

删除净：`/api/skills/toggle`、`skillToggle`、`toggleStrategy` 及 claude-settings / codex-config / directory 三策略代码、拷贝式 `/api/skills/import`、`SKILL_IMPORT_TARGETS`、`importTargets`。`skills_disabled` 保留（WorkBuddy 列机制）；历史 `skills/_disabled` 只读识别一个版本后删。

### 沿用不动

`queueSkillsWrite` 串行写队列 + 代数失效缓存、`trashPath`（系统废纸篓）、`backupSkillConfig`、「只动扫描清单内路径」校验、建链前 stat 原件、链接风格 = 相对链。

## 4. UI 规格（Skill × Agent 图标矩阵）

低保真原型（决策全部具象化，可交互）：`design-demos/skills-symlink-矩阵UI.html`（实施参考，验收后可删）。

1. **行模型**：一行 = 一个原件（名称 + 描述 + 原件徽标〔仓库 / 外部·ego / —〕+ 四列接入图标 + 触发数 + 健康 + mtime）。四列图标**外观统一**（亮=接入、灰=未接入），机制差异只藏在 tooltip 与详情抽屉；代价提示走 toast（如「已接入（重启 Codex 生效）」）。
2. **库存呈现**：四列全灰的原件**混排**主列表（淡化样式 + 「未接入」徽标），hits 排序自然沉底；「只看未接入 N」chip 开关。
3. **页签与筛选**：顶部 **agent 页签带计数**（✳ Claude N / ◇ Codex N / ⌂ WorkBuddy N / ▲ ZCode N，点击 = 筛该列已接入）**替代**旧 source 筛选（全局/插件/项目级页签退役）；重复/健康保留为次级筛选；**项目级与插件进底部折叠区**，保持原列表形态、无图标列。
4. **批量**：行选择模式（选中后按列执行 接入/取消接入/卸载）+ 表头图标**整列批量**（点击弹确认，如「全部接入 Codex：影响 N 个」）。
5. **WorkBuddy 列动作**：接入 = 从原件拷入；取消接入 = 移入 `skills_disabled`；拷贝落后时健康列提示「WB拷贝落后」，详情抽屉提供「刷新拷贝」。
6. **反馈与失败态**：图标点击 busy → toast；目标被同名真实目录占用 → 引收编/覆盖流程；断链行级警告 + 修复动作。
7. **触发统计**：hits 按 skill 名聚合天然归行；Claude 描述预算 = Claude 列亮着的行数。
8. **详情抽屉**：原件路径与来源、四列各自接入方式明细（如「Codex：config.toml 未条目=默认启用」）、刷新 WB 拷贝 / Finder 显示 / 卸载原件（trash）/ 收编为原件（项目级与插件行）。

## 5. 安装、收编、更新、卸载（要点索引）

| 动作 | 规格 |
|---|---|
| 安装（发现页） | docs/15：原件入仓 + 多选接入（默认全选）+ 纯库存 |
| 收编 | docs/14：残留/项目级内容提升为原件，共用风险检查 |
| 同源更新 | docs/15：原子换位 + 影响面提示 + trash 回滚；外来原件无此入口 |
| 卸载 | 行级：原件 + 全部接入进 trash；外部原件只取消接入 |
| 覆盖接管 | §6：外来原件同名冲突的双向出路 |

## 6. 外来原件（原件仓的第三方写入并存）

背景：来源身份记录存于 `configDir/skill-sources.json`（`records.installations[绝对路径]`）；迁移本身会放入大量无记录实体，**外来原件是迁移后的常态**。

1. **身份识别 = 同权呈现 + 来源 chip 区分**：外来原件（无记录：收编件、skills.sh CLI / cc-switch / 手动放入）与安装原件同样支持接入/取消接入/卸载；行内来源标「本机收编 / 外部装入」，同源更新入口不出现。
2. **冲突规则 = 内容冲突覆盖流程，双向有出路**：FanBox 安装/收编遇原件仓同名外来目录 → 差异概要 → 用户确认后原子换位（旧目录进 trash），来源身份由 FanBox 记录接管（外来原件的「转正」路径）；反向（第三方覆盖 FanBox 装的原件）由健康检查标「已被外部修改」（记录指纹与实际不符），提供重新检查或重装接管。
3. **维护边界**：卸载对外来原件照常提供（删本机内容是用户权利）；外来原件的更新路径 = 发现页装同源走覆盖接管，或交原安装器；收编件永久无同源更新。
4. **写入互斥 = 不加锁**：`queueSkillsWrite` 串行 + 临时副本 + 原子换位保证自家安全；对第三方并发写不做互斥（无锁文件/监听），靠健康检查事后发现。

## 7. 现状 → 终态映射表（2026-08-23 勘察）

| 位置 | 现状 | 终态 |
|---|---|---|
| `~/.claude/skills` | 整目录软链 → `~/.agents/skills` | 真实目录 + 约 24 条逐 skill 相对链 `../../.agents/skills/<name>` |
| `~/.agents/skills` | 40 项：真实目录 + 约 16 条自引用死环链（原件实在仓库）+ 外部链（ego-browser 等） | 唯一原件仓：自管真实目录 + 21 条仓库家族相对链 + 外部链（origin=external 标注） |
| `~/.codex/skills` | 40 项：38 条死链（37 指向已清空的 `~/.cc-switch/skills` + claude-to-im）+ 少量真实目录 | 只留 `.system`；**零链**；靠原件仓原生扫描 + config.toml 启停 |
| `~/.workbuddy/skills` | 60 项几乎全为真实目录拷贝；`skills_disabled` 为空 | **零改动**（拷贝接入保持）；37 个独有件拷入原件仓 |
| `~/.zcode/skills` | 2 条手写相对链（eli5、agently-mail） | 删两条链（消除双读）；config.json enable 开关 |
| `fanbox/.agents/skills/` | 18 张仓库家族 | 原件留仓库（git 真源）；死名三张恢复进仓库 |
| `~/.cc-switch/` | skills 已清空；`skill-backups/` 留 8–17 家族备份 | 不动；备份作为死名恢复 fallback |

漂移事实：22 个同名跨仓几乎全漂移——仓库最新（wayfinder/tdd/code-review/grill-with-docs 家族）、WorkBuddy 反而最新（implement/teach/writing-great-skills/agently-mail）、三份全等仅 frontend-design 与 wechat-reminder；WorkBuddy 另有 37 个全网独有件，`~/.agents` 独有 16 件。

## 8. 一次性迁移方案

执行形态 = **一次性向导**：扫描 → 漂移矩阵 → 用户确认（最新 mtime 默认胜出、逐行可改判后锁定）→ 批量执行 → 报告。仓库家族名的胜出版内容写进仓库（而非仅取仓库现版）；死名 grill-me / grilling / handoff 从 WorkBuddy 活拷贝恢复进仓库（cc-switch 备份 fallback）。向导可写仓库文件，git 提交留给用户 review。

| 阶段 | 动作 | 回滚 |
|---|---|---|
| 0 准备 | 扫四仓 + cc-switch 备份出漂移矩阵；拍迁移前四 Agent 可见性快照；要求无运行中 Claude/Codex 会话 | manifest + 快照 |
| 1 原件仓只增 | 收编 Codex 三件（a-stock-data / agently-mail / wechat-reminder，按矩阵胜出版）；拷 37 个 WorkBuddy 独有件；teach / writing-great-skills 按矩阵刷新；死名三张 + 胜出版仓库内容写入仓库（不 commit）；删 16 条死环 → 建 21 条仓库相对链 | trash + 逆操作清单 |
| 2 Claude 拆链 | 删整目录链 → 建真实目录 → 连建约 24 条相对链（一个连续动作，窗口毫秒级） | 重建整目录链一步还原 |
| 3 Codex 清理 | trash 三真实目录 + 38 死链，只留 `.system`；不动 config.toml | trash |
| 4 ZCode | 删 `~/.zcode/skills` 两条链（消除双读）；按迁移前 ZCode 可见性快照批量写 config.json（原亮者 `enable:true`、其余 `enable:false`，避免新收编件全量入锁） | trash + config 备份 |
| 5 验收报告 | 重拍快照 diff（标准见 §9）；提醒 git commit | — |

存量启停配置归一（ADR 0005）：Claude 清理 `skillOverrides` 残留；Codex 按新模型重写 config；ZCode 首迁批量写 enable。

## 9. 迁移验收标准（dogfood 式真实 HOME 清单）

迁移向导内置**前后四 Agent 可见性快照 diff**，不靠人眼；实施验收在同一台真实 HOME 上按此清单执行：

1. **可见性不变式**：Claude 与 WorkBuddy 迁移前后可见集合**严格不变**（谁启着/停着逐一对应）；Codex 与 ZCode 允许「新增」（新收编件经原件仓原生可见）、**不允许消失**。
2. **原件仓健康**：无死环（链不再指回自身）；无断链；外部链（ego 等）识别标注且未被改动。
3. **外部不动**：`~/.cc-switch/`、ego 目录、WorkBuddy 目录内容未被迁移破坏。
4. **Codex 终态**：`~/.codex/skills` 仅剩 `.system`；原件仓经原生扫描对 Codex 可见。
5. **ZCode 终态**：`~/.zcode/skills` 无残留链；config.json 的 enable 集合与迁移前可见性一致；无双列。
6. **Claude 终态**：逐 skill 相对链生效，整目录链已拆；`skillOverrides` 残留已清。
7. **可回滚**：manifest 落 `CONFIG_DIR/migration/`，全程删除均经 trashPath 可恢复。
8. **提醒项**：报告末尾提醒用户 review 并提交仓库改动（死名恢复件、胜出版内容）。

## 10. Out of Scope

- Windows 符号链接支持（macOS 优先；社区移植另行立项）。
- 项目级 skills 的链接化（保持现有扫描与展示，仅提供收编入口）。
- Claude 插件 skills（插件体系自管）。
- cc-switch 工具的整合或替代（只处理其软链在迁移中的去留）。
- 参考截图产品的其余功能（从 ZIP 安装、从备份恢复、备份体系等）。

## 11. Further Notes

- 实施拆票见本仓库 issue tracker（wayfinder 地图 #11 的实施子票）；每票一个会话，先读本规格再动工。
- 前端注意：`public/app.js` 含 `\x00` 分隔符，grep/部分工具会当二进制，用 awk/python/rg 读。
- 收编、安装、更新的详细用户故事与测试决策分别在 docs/14 与 docs/15，本规格不重复。
