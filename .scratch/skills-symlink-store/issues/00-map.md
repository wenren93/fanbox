# Wayfinder Map — Skills 正本 + 软链改造（wayfinder:map）

## Destination

Skills 透视改造为「正本 + 软链」模型：`~/.agents/skills` 为唯一正本仓，Claude / Codex / WorkBuddy / ZCode 四个 agent 目录以逐 skill 软链接接入；UI 每行一个 Skill、行内 agent 图标点选即建链/删链（链在即启用）；导入与发现页安装全面改软链，ADR 0001 相应改写，规格成文后交实施。

## Notes

- 已拍板的四个方向性决策（2026-08-23，与用户确认）：
  1. 正本仓 = `~/.agents/skills`（skills.sh 约定目录，机器上已是事实中心）；`~/.agents` 本身不再作为第五列 agent。
  2. 链接为唯一安装/导入方式，废止拷贝式导入 → **ADR 0001 需改写**。
  3. agent 图标语义 = 软链在即启用；不写各 agent 官方启停配置（现有 skillOverrides / config.toml 启停体系在新模型下的去留见 02 号票）。
  4. 首批 agent 列：Claude、Codex、WorkBuddy、ZCode（`~/.zcode/skills`）。
- 参考交互：用户提供的截图（另一产品）——每行右侧一组 agent 图标，亮=启用、灰=禁用，点选切换；顶部按 agent 的筛选页签带计数。截图中的「从备份中恢复 / 从 ZIP 安装」等其余功能不采纳。
- 机器现状勘察（2026-08-23，迁移票的事实输入）：
  - `~/.claude/skills` 是**整目录软链** → `~/.agents/skills`（无法按 skill 启停，须拆为逐 skill 链接）。
  - `~/.agents/skills`（40 项）混有真实目录与约 20 个**自引用死环软链**（如 `ask-matt -> /Users/one/.agents/skills/ask-matt`，目标实为仓库内 `.agents/skills/`）；另有指向外部的链（`ego-browser -> ~/.local/share/ego/ego-skills`）。
  - `~/.codex/skills`（40 项）大量软链指向**第三家仓库 `~/.cc-switch/skills`**（cc-switch 工具），外加少量真实目录与外部链。
  - `~/.workbuddy/skills`（60 项）几乎全是真实目录拷贝，与 `.agents` 大面积同名重复，且含仅此一份的独有 skill。
  - `~/.zcode/skills` 已是手写相对链接（`../../.agents/skills/x`），且 ZCode 似乎**原生同时扫描** `~/.zcode/skills` 与 `~/.agents/skills`（同一 skill 会在会话中出现两次），ZCode 列语义待 01 号票澄清。
- 后端事实：`server.js:2066` 起 Skills 透视扫描四根 + 插件 + 项目级；启停策略 claude-settings / codex-config / directory（`skills_disabled`）；扫描器已跟随软链并按 realpath 去重；导入 = 拷贝（`skillImport`），发现页安装 = skills.sh 固定版本解包 + 风险检查。前端 `public/app.js` `skillsView`（约 5034 行起，注意该文件含 `\x00` 分隔符，grep/部分工具会当二进制，用 awk/python/rg 读）。
- 本地 tracker 约定：票 = `.scratch/skills-symlink-store/issues/NN-slug.md`，认领 = 在票上写 **Claimed by**；blocking 写在票头。每张票一个会话，一次只解一张。
- 实施交接：地图走完后用 implement/tdd 技能执行，实施会话应先读本 map 与 07 号规格票。

## Decisions so far

- [01 — 四个 agent 对 skills 目录的真实发现行为](https://github.com/wenren93/fanbox/issues/12)（本地: issues/01-agent-discovery-behavior.md）: Claude/Codex/ZCode 官方支持逐 skill 目录软链（Codex、ZCode 原生读 `~/.agents/skills`，ZCode 不按 realpath 去重致双列）；WorkBuddy 软链未证实且 `skills_disabled` 系 FanBox 自创；skills.sh 约定 = `.agents` 真实正本 + 逐 skill 相对链，FanBox 应取同构风格。

- [02 — 链接模型的领域语言与 ADR 0001 改写](https://github.com/wenren93/fanbox/issues/13)（本地: issues/02-link-domain-model.md）: 一行一 Skill（正本+接入状态，导入/安装项退役）；正本=链条终点真实目录（含 ego 等外部正本）；各列混合原生机制（Claude 相对软链 / Codex config.toml / ZCode config.json / WorkBuddy 拷贝）；存量配置迁移时归一。CONTEXT.md 已重写。

- [03 — 存量拷贝与死环的一次性迁移方案](https://github.com/wenren93/fanbox/issues/14)（本地: issues/03-existing-copies-migration.md）: 一次性向导（漂移矩阵最新默认胜出+可改判）；仓库家族正本留仓库、`.agents` 放相对链；Codex 零链（收编三件+清 38 死链）；WorkBuddy 零改动+37 独有件拷入；死名三张恢复进仓库；全程 trash 可回滚+前后可见性快照 diff 验收；ZCode 段依 02 终稿修正（删双链+首迁批量写 config.json）。

- [04 — Skill × Agent 图标矩阵的 UI 设计](https://github.com/wenren93/fanbox/issues/15)（本地: issues/04-skill-agent-matrix-ui.md）: 一行一正本+四列统一图标（机制藏 tooltip）；库存混排+chip 开关；agent 页签带计数替代 source 筛选、项目级/插件折叠区；行选择+整列批量；WB 列拷贝接入/skills_disabled+落后提示；低保真原型已出（design-demos/skills-symlink-矩阵UI.html）。

- [05 — 导入与发现页安装改为建链](https://github.com/wenren93/fanbox/issues/16)（本地: issues/05-import-install-via-links.md）: 拷贝导入彻底退役、行内图标即全部分发；「导入」让位收编（共用风险检查）；安装默认全选四 agent、纯库存合法；同源更新=原子换位+影响面提示+trash 回滚；卸载两级（卸载=删正本+全接入，点图标=取消接入）。CONTEXT.md 增「纯库存」「残留」。

- [06 — 后端扫描 / 启停 / 导入接口在链模型下的重设计](https://github.com/wenren93/fanbox/issues/17)（本地: issues/06-backend-api-redesign.md）: refresh v2 行=正本+anomalies+counts；单一 /api/skills/link 四列分发（相对链/config/WB 拷贝）+batch v2（行/整列+uninstall 外部正本不删）+annex 收编+import/discovery 一律入正本仓；独立 migrate/scan|snapshot|execute 族；状态只读现值不合成残留；硬切换删 /toggle 与三策略；queueSkillsWrite/trashPath 沿用。

- [08 — 正本仓的第三方写入并存规则](https://github.com/wenren93/fanbox/issues/19)（本地: issues/08-store-third-party-coexistence.md）: 外来正本（无来源身份：收编件/第三方装入/手动放入）同权管理接入与卸载、来源 chip 区分、无同源更新；同名冲突走覆盖接管流程、外部覆盖由健康检查发现；写互斥不加锁。CONTEXT.md 增「外来正本」。
## Not yet specified

- WorkBuddy 软链跟随性单链实测（ego-browser 式）——02 已拍拷贝接入，实测仅在未来想链化 WorkBuddy 时点亮。
（迁移验收标准已并入 07 号票范围。）

## Out of scope

- Windows 符号链接支持（macOS 优先；Windows 社区移植另行立项）。
- 项目级 skills（`.claude/skills` 等）的链接化——保持现有扫描与展示。
- Claude 插件 skills——插件体系自管，维持现状。
- cc-switch 工具本身的整合或替代——只处理其软链在迁移中的去留。
- 参考截图产品的其余功能（从 ZIP 安装、从备份恢复、备份体系等）。
