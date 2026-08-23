# Research 01 — 四个 agent 对 skills 目录的真实发现行为 + skills.sh 链接约定

日期：2026-08-23 · 票：`issues/01-agent-discovery-behavior.md` · 方法：官方文档 + 官方源码 + 本机实证（只读）。

来源缩写：[CC-docs] = https://code.claude.com/docs/en/skills ；[CC-settings] = https://code.claude.com/docs/en/settings-reference ；[Codex-docs] = https://learn.chatgpt.com/docs/build-skills （developers.openai.com/codex/skills 308 重定向至此）；[Codex-src] = openai/codex 仓库源码（GitHub）；[ZC-guide] = 本机官方插件文档 `~/.zcode/cli/plugins/cache/zcode-plugins-official/zcode-guide/0.1.0/skills/{zcode-configuration-guide,diagnosing-skills}/SKILL.md`；[skills-src] = vercel-labs/skills CLI v1.5.23 源码（GitHub，skills.sh 即其目录站）；[本机] = 只读实证，路径随条目给出。本会话即 ZCode 会话，其可用 skills 清单为第一手证据。

## 1. Claude Code

| # | 事实 | 来源 |
|---|---|---|
| C1 | 发现目录仅四类：Enterprise（受管 settings 目录下 `.claude/skills/`）、Personal `~/.claude/skills/<name>/SKILL.md`、Project `.claude/skills/`（含嵌套与 `--add-dir`）、Plugin `<plugin>/skills/`；另有保留目录 `~/.claude/skills/synced/`（claude.ai 下载）。**不原生扫描 `~/.agents/skills`** | [CC-docs] |
| C2 | **逐 skill 软链官方支持**：三个本地位置的 `<skill-name>` 条目"can be a symlink to a directory elsewhere on disk"，Claude Code "follows the symlink and reads SKILL.md from the target directory"；且 **按目标去重**："if the same target is reachable from more than one location, Claude Code loads the skill once"。插件 skills 例外（另见 plugins 文档） | [CC-docs] |
| C3 | 本机现状：`~/.claude/skills` 是**整目录软链** → `/Users/one/.agents/skills`（绝对路径）。这就是本机 Claude 能看到 .agents 内容的原因——不是原生支持，是这条链 | [本机] `ls -la ~/.claude/skills` |
| C4 | `skillOverrides` 语义：**键 = skill 名**，值 = `on` / `name-only` / `user-invocable-only` / `off`；缺省即 `on`；只影响非插件 skills（"Plugin skills are not affected"）；v2.1.199 起 `off` 同时从 Remote Control/Agent SDK 命令列表隐藏，调用返回 skillOverrides 错误而非执行 | [CC-docs]、[CC-settings] |
| C5 | **链模式下的残留 override**：官方文档未写“条目对应 skill 已不存在”时的行为。本机实证：`~/.claude/settings.json` 存在 `"skillOverrides": {"weread-skills": "off"}`，而 `~/.agents/skills` 中已无 weread-skills——Claude Code 照常运行，无报错。结论（本机级证据）：删链后遗留的按名 override 无害 | [本机] `~/.claude/settings.json`；[CC-docs]（明确写“未覆盖此情形”） |
| C6 | 生效时机：**文件变更免重启**——Claude Code 监听 skills 目录，`~/.claude/skills/`、项目 `.claude/skills/`、`--add-dir` 下的增删改“without a restart”即时生效（live 检测只覆盖 SKILL.md 文本）；例外：会话启动时顶层 skills 目录不存在则需重启才能挂监听；删除的 skill 已注入上下文的内容保留到会话结束 | [CC-docs] |
| C7 | 兼容性风险：skills.sh 历史上对“`~/.claude/skills` 本身是整目录链”会安装失败（issue #293）；新版 CLI 已加 parent-symlink 解析兜底，但整目录链仍是其反复出 bug 的形态 | https://github.com/vercel-labs/skills/issues/293 |

## 2. Codex

| # | 事实 | 来源 |
|---|---|---|
| X1 | **官方扫描位置**（docs 表）：`$CWD/.agents/skills`、从 cwd 到 repo 根每一层的 `.agents/skills`、**`$HOME/.agents/skills`（USER 主位置）**、`/etc/codex/skills`（ADMIN）、OpenAI 内置 system skills。同名 skill 多处出现时**都进选择器、不合并**（"no merging"） | [Codex-docs] |
| X2 | **`~/.codex/skills` 是已废弃但仍扫描的用户位置**。源码：User 层先 push `$CODEX_HOME/skills`（注释 "Deprecated user skills location (`$CODEX_HOME/skills`), kept for backward compatibility"），再 push `~/.agents/skills`，再加 system cache root；root 按**路径字符串**去重（非 realpath） | [Codex-src] `codex-rs/ext/skills/src/host_roots.rs` |
| X3 | **软链跟随：User/Repo/Admin 范围一律 Follow**（`SkillScope::User | Repo | Admin → DirectorySymlinkPolicy::Follow`，仅 System 范围 Ignore）；docs 同义表述 "Codex supports symlinked skill folders and follows the symlink target"。注意：支持的是**目录级**软链；SKILL.md 文件本身是软链曾有跳过 bug（issue #17344） | [Codex-src] `codex-rs/ext/skills/src/loader/host.rs`、`discovery.rs`；[Codex-docs]；https://github.com/openai/codex/issues/17344 |
| X4 | **原生读 `~/.agents/skills`：是**（X1/X2）。因此 server.js 把启停投影到 `config.toml`、键指向 `~/.agents/skills/...` 的耦合成立——这些路径正是 Codex 的 USER 发现路径 | [Codex-docs]、[Codex-src]、[本机] `~/.codex/config.toml` |
| X5 | `[[skills.config]]` 语义（源码级）：条目 = 可选 `path` 选择器**或** `name` 选择器 + `enabled`(bool)；skill **缺省即启用**；`enabled=false` 将匹配项加入禁用集，`enabled=true` 仅在抵消同选择器更早的 `false` 时有意义（后条目覆盖前条目），否则是冗余无害项。**path 选择器按 skill 的 canonical 文档路径（绝对 SKILL.md 路径）精确匹配**——只禁那一份拷贝；`name` 选择器匹配该名字的**所有**拷贝 | [Codex-src] `codex-rs/config/src/skills_config.rs`；[Codex-docs] |
| X6 | path 形态官方表述冲突：config-reference 写 "Path to a skill folder containing SKILL.md"（目录），build-skills 示例却是 `path = "/path/to/skill/SKILL.md"`（文件）；源码语义为 canonical 文档路径。本机/FanBox 现用 SKILL.md 文件路径，可用 | [Codex-docs] 两页、[Codex-src]、[本机] `~/.codex/config.toml` |
| X7 | 本机实证：config.toml 有 7 条 caveman 系 `enabled=false`（路径在 `/Users/one/Documents/GitHub/.agents/skills/...`）、2 条 `enabled=true`（`agently-mail`、`implement`，路径在 `~/.agents/skills/...`）——即 FanBox 的投影；按 X5，`enabled=true` 条目相对缺省是冗余但无害的 | [本机] `~/.codex/config.toml` |
| X8 | 生效时机：**config.toml 改动必须重启 Codex**（"Restart Codex after changing ~/.codex/config.toml"）；skill 文件本身增删改自动检测（"Codex detects skill changes automatically. If an update doesn't appear, restart Codex."）。初始清单预算 = 上下文窗口 2%（未知时 8000 字符） | [Codex-docs] |

## 3. ZCode

| # | 事实 | 来源 |
|---|---|---|
| Z1 | **官方发现顺序**：① 显式配置根 → ② 用户 `~/.zcode/skills` → ③ **用户 `~/.agents/skills`** → ④ 工作区 `.zcode/skills`（cwd 向上至 repo 根，逐层、深层优先）→ ⑤ 工作区 `.agents/skills` → ⑥ 已启用插件根。同级内 `.zcode` 先于 `.agents`。跳过 `.` 开头目录（`.system` 除外）与 `node_modules` | [ZC-guide] 两篇 |
| Z2 | **原生读 `~/.agents/skills`：是**（Z1 ③；且官方指南原话建议跨工具共享就放 `~/.agents/skills/`） | [ZC-guide] |
| Z3 | **不按 realpath 去重（已核实）**：skill 的身份是**文件路径**；"same-named skills at different paths are all discovered, but only the first in discovery order is loaded"。本会话第一手证据：eli5 同时以 `/Users/one/.zcode/skills/eli5/SKILL.md` 和 `/Users/one/.agents/skills/eli5/SKILL.md` 双列——两条路径的 realpath 同为 `/Users/one/.agents/skills/eli5`，仍两条都列出（加载时取发现序第一条，即 `.zcode` 那条） | [ZC-guide]；本会话（ZCode 会话）可用 skills 清单；[本机] `realpath ~/.zcode/skills/eli5` = `/Users/one/.agents/skills/eli5` |
| Z4 | 双列不只是观感问题：本会话用 Skill 工具调 `research`（在 `~/.agents/skills/research` 与仓库 `fanbox/.agents/skills/research` 各有一份）直接报错 "Skill name is ambiguous for subagent"——重复名会实际阻塞调用 | 本会话第一手（本次研究开头实测） |
| Z5 | **逐 skill 软链可用（已实证）**：`~/.zcode/skills/eli5 -> ../../.agents/skills/eli5`（相对链）被发现且可加载。仓内 `.agents/skills` 的目录链（ego-browser → `~/.local/share/ego/ego-skills`）同样被发现——目录级链在所有扫描根下都被跟随 | 本会话清单 + [本机] `ls -la ~/.zcode/skills` |
| Z6 | **断链无害**：`~/.zcode/skills/agently-mail -> ../../.agents/skills/agently-mail` 是悬空链（`~/.agents/skills` 里已无 agently-mail，realpath 报 No such file or directory），ZCode 只是不发现它，不报错不崩溃 | [本机] `realpath ~/.zcode/skills/agently-mail` |
| Z7 | **官方启停机制**：`~/.zcode/cli/config.json`（或工作区 `.zcode/config.json`）按 **skill 绝对路径**写 `enable: false` 禁用（"The configuration disables it by absolute path"）；全局开关 `skills.enabled` + skill feature 总开关（均默认 true）。注意与 Codex 同型的坑：按路径禁用只覆盖那一条路径——`.zcode` 拷贝和 `.agents` 拷贝需分别禁（或改用别的方式） | [ZC-guide] diagnosing-skills pitfall 5/12 |
| Z8 | 本机 `~/.zcode/cli/config.json` 现无任何 skills 覆盖项（仅 plugins 配置）——从未用过 ZCode 禁用机制 | [本机] |
| Z9 | 重启要求：指南未提及链接/配置变更的生效时机——**未证实**（已尝试：zcode-guide 两篇全文、会话内观察） | [ZC-guide]（无此内容） |

## 4. WorkBuddy

| # | 事实 | 来源 |
|---|---|---|
| W1 | 身份：腾讯 WorkBuddy（workbuddy.ai），Electron 桌面应用，bundle id `com.workbuddy.workbuddy`，本机装于 `/Applications/WorkBuddy.app` | [本机] Info.plist；https://www.workbuddy.ai/ |
| W2 | skills 位置：全局 `~/.workbuddy/skills/`、项目 `.workbuddy/skills`（skills CLI 适配请求表单所列，与本机布局一致）。官方文档（Skills-Market 页）只写 UI 安装/启停/卸载，**未披露任何磁盘路径、导入机制、软链行为**——技术细节层面官方无文档 | https://github.com/vercel-labs/skills/issues/1353；https://www.codebuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Skills-Market |
| W3 | **`skills_disabled` 不是 WorkBuddy 约定，是 FanBox 自己的约定**：283MB app.asar 全文 0 处 `skills_disabled` 字符串；FanBox `server.js` 2323/2876 行实现它（把目录移出扫描根即"禁用"）。本机 `~/.workbuddy/skills_disabled` 存在且为空 | [本机] asar 二进制 grep（0 hits）；`server.js:2323,2876` |
| W4 | **软链跟随：混合证据，总体未证实**。应用内渲染层清单函数 `scanSkillsDir` 用 `readdirSync(dir, {withFileTypes:true})` 且只收 `entry.isDirectory()`——Dirent 对符号链接 `isDirectory()` 为 false，**该路径会跳过顶层逐 skill 软链**（同一坑 skills CLI 源码里有专门 workaround，见 S5）。但真正喂给 agent 的清单走独立 daemon/backend IPC（`backend:get-skill-list`，扫描目录来自产品配置 `skillScanDirs`），其扫描代码不在 app bundle 内，无法从本包证实 | [本机] app.asar 反解出的 `scanSkillsDir`/`getSkillList` 代码；对照 [skills-src] installer.ts L84 |
| W5 | 本机 `~/.workbuddy/skills` 60 项 = 59 真实目录 + 1 软链（ego-browser，8-21 建的试验链）。该链是否被 WorkBuddy 列出——**未证实**（需开应用实测） | [本机] `ls -la ~/.workbuddy/skills` |
| W6 | WorkBuddy 自身的禁用机制迹象：`~/.workbuddy/skills/.disable_to_model_invocation_migration.json`（version 1, scanned 63, migrated 1）表明其曾把禁用表示迁移到 SKILL.md frontmatter 的 `disable-model-invocation`（与 Claude 同名机制），非目录移动 | [本机] 该文件内容 |
| W7 | 重启要求：官方文档未写——**未证实**（已尝试：官方 Skills-Market 页、web 搜索） | W2 来源页 |

## 5. skills.sh（= vercel-labs/skills CLI，v1.5.23）链接约定

| # | 事实 | 来源 |
|---|---|---|
| S1 | **正本**：skill 以真实目录拷贝落 `.agents/skills/<name>`（项目级）/ `~/.agents/skills/<name>`（全局）——"Canonical location: .agents/skills/<skill-name>"。默认安装模式 `symlink`，失败回退 `copy` | [skills-src] `src/installer.ts`（InstallMode、注释原文） |
| S2 | **链接风格：相对路径**。`createSymlink`: `relative(realLinkDir, target)` —— 先解析父目录软链再算相对路径（专门处理 `~/.claude/skills` 整目录链的情形），macOS/Linux 用相对链，Windows 用 junction（绝对）。**逐 skill 一条链**：`createSymlink(canonicalDir, agentDir)`，如 `~/.claude/skills/<name>` | [skills-src] `src/installer.ts` L197-258、L387 |
| S3 | **哪些 agent 目录被链**（`src/agents.ts`，共 77 个 agent）：<br>• claude-code：`skillsDir='.claude/skills'` → 非 universal → 全局安装链到 `~/.claude/skills`<br>• **codex：`skillsDir='.agents/skills'` → universal → 全局安装不建 `~/.codex/skills` 链**，正本即安装（源码注释 "Skip creating a symlink to the agent-specific global dir … to avoid duplicates"——Codex 原生读 `~/.agents/skills`）<br>• zcode：`skillsDir='.zcode/skills'` → 非 universal → 全局安装**链到 `~/.zcode/skills`**（尽管 ZCode 也原生读 `.agents`——即双列是 skills.sh 设计如此）<br>• workbuddy：**不在列表**，适配请求 issue #1353 仍 open<br>• 项目级：非 universal agent 若项目内无其配置目录则跳链（claude-code 例外必链） | [skills-src] `src/agents.ts`（claude-code/codex/zcode 条目、`isUniversalAgent`、`getUniversalAgents`）；https://github.com/vercel-labs/skills/issues/1353 |
| S4 | universal 判定 = `agents[type].skillsDir === '.agents/skills'`（这些 agent 共享 `.agents/skills`，"don't need symlinks"） | [skills-src] `src/agents.ts` `isUniversalAgent` |
| S5 | 已知 bug 面：#293（`~/.claude/skills` 整目录链时安装失败）、#851/#744/#1355（装到 `.agents` 但没建链）、#537（agent skills 目录不存在时 "not linked"）。方向性结论：**逐 skill 相对链 + `.agents` 真实正本**是其稳定形态，整目录链是其雷区 | https://github.com/vercel-labs/skills/issues/293、851、537 等 |
| S6 | 对 FanBox 的直接含义：地图拍板的「正本仓 `~/.agents/skills` + 逐 skill 链」与 skills.sh 约定**同构**；链接风格应取**相对路径**（与 S2 一致）；为 Claude 建链、为 ZCode 建链都会与 skills.sh 共存不冲突；Codex 按 skills.sh 语义可零链 | S1-S3 |

## 6. 对 02/03 号票的直接启示

**02（领域语言/ADR）**
1. 「链在即启用」对 Claude、Codex、ZCode 三个 agent 在官方语义上都成立（C2、X3、Z5）；WorkBuddy 是唯一未证实者（W4）——02 定术语时应把 WorkBuddy 列为「拷贝式接入，链模型豁免/待验证」，而不是假设四列同构。
2. ZCode 列有结构性矛盾：ZCode 原生读正本仓（Z2），删 `~/.zcode/skills` 链并不能让它看不到正本。ZCode 列只有三种可能形态：①恒开列（同 skills.sh 对 codex 的做法，S3）②用官方 config.json 按绝对路径禁用正本路径（Z7，回到写官方启停配置）③接受双列（Z3-Z4 证明还会触发 ambiguous 报错，不可取）。02 必须三选一，推荐①，与 skills.sh 生态一致。
3. 存量官方启停记录的处置有据可依：Claude `skillOverrides` 按名、删链后残留无害（C4/C5）→ 可保留为兼容读取或迁移时清理，代价都低；Codex 条目按 canonical SKILL.md 路径（X5）→ 只要正本仓路径不变即继续有效，且 `enabled=true` 条目本就冗余（X7），迁移时可清；注意 Codex path 选择器只禁一份拷贝，若走 `.zcode`/`.codex` 链路需 per-path 或改 name 选择器（X5）。
4. 「从未接入」vs「接入后禁用」无需区分的判断被 C5/Z6 支持：删链即彻底不可见、断链无副作用，状态无需记忆。

**03（存量迁移）**
1. Claude 整目录链拆解为逐 skill 相对链后，与 skills.sh 完全同构（S1/S2），且消除 #293 类冲突面（C7）；Claude 免重启监听（C6）使拆链窗口风险更低。
2. Codex：鉴于 skills.sh 视 codex 为 universal（全局不建 `~/.codex/skills` 链，S3）且 Codex 原生读 `~/.agents/skills`（X1/X2），03 可考虑 Codex 列也走「零链」终态；现存的 37 条 `~/.cc-switch` 链在废弃扫描根里依然有效（X2），去留是纯管理问题不是功能问题。注意 config.toml 改动需重启 Codex（X8）——迁移涉及启停投影时要提示用户。
3. ZCode：若采「恒开列」，ZCode 零迁移（地图 15 行预判成立）；顺手清理 `~/.zcode/skills/agently-mail` 悬空链（Z6）。
4. WorkBuddy：W4 的 isDirectory 跳链证据足以否决「直接把 60 个目录换成链」的方案——03 里 WorkBuddy 保持真实目录拷贝（或先做一个 ego-browser 式单链实测再定），`skills_disabled` 为空、迁移成本为零（W3/W5）。

## 7. 未决问题

1. ZCode 链接/禁用变更的生效时机（免重启与否）——未证实。已尝试：zcode-guide 两篇全文、本会话观察（eli5 链建于本会话启动前，无法区分）。
2. ZCode config.json skills 覆盖项的确切 JSON 形状（键名层级）——指南只给语义（按绝对路径 enable:false），未给字段样例。已尝试：zcode-guide、`~/.zcode/cli/config.json` 现文件（无实例）。
3. WorkBuddy daemon 加载器是否跟随逐 skill 软链——未证实（渲染层会跳过，daemon 代码不在 app bundle）。已尝试：asar 反解（scanSkillsDir/backend:get-skill-list）、官方文档、issue #1353。建议 02/03 期间用现有 ego-browser 链做一次人工实测。
4. Codex `path` 选择器的规范形态（目录 vs SKILL.md 文件）官方两页矛盾（X6）——源码语义支持 canonical 文档路径；FanBox 现用 SKILL.md 形态且可用，保持即可，无需阻塞。
5. Claude 遗留 `skillOverrides` 条目的官方语义——文档未覆盖，仅本机单例证据（C5）。
