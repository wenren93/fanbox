# 各 Agent 接入与启停机制

日期：2026-08-23 · 依据：研究票 01（四 Agent 真实发现行为的事实清单）与决策票 02

## 决策

「原件 + 接入」模型下，四个目标 Agent 列的接入机制**混合采用各自的原生机制**，而非统一为软链；UI 图标外观统一表达接入状态（亮=接入、灰=未接入），机制差异藏在 tooltip 与详情抽屉中。

| Agent | 接入机制 | 取消接入 | 依据与代价 |
|---|---|---|---|
| Claude | `~/.claude/skills/<name>` 逐 skill **相对**软链 → `../../.agents/skills/<name>` | 删链 | 官方支持且按链接目标去重；与 skills.sh 安装器同构。SKILL.md 变更免重启 |
| Codex | **不建链**，写 `~/.codex/config.toml` `[[skills.config]]`（canonical SKILL.md 路径选择器） | 删除/禁用条目 | Codex 原生扫描原件仓（USER 主位置），链反而冗余。config 改动需重启 Codex 生效 |
| ZCode | **不建链**，写 `~/.zcode/cli/config.json` 按原件绝对路径 `enable` 开关 | `enable:false` | ZCode 原生同时扫描 `~/.zcode/skills` 与原件仓且**不按 realpath 去重**（同一 skill 双列、重名触发 ambiguous 报错），不建链以消除双读 |
| WorkBuddy | **拷贝接入**：原件拷入 `~/.workbuddy/skills` | 移入同级 `skills_disabled` | 软链跟随性是四家中唯一未证实者（渲染层清单跳过顶层软链）；`skills_disabled` 为 FanBox 自创约定，继续作为该列机制 |

「链在即启用」的原始假设据此修正为：仅 Claude 列字面成立；图标状态一律**只读各列现值**（链 lstat/realpath、config 现值、WorkBuddy 目录在否），不做「官方配置残留 AND 链」的状态合成。

## 存量启停配置的归一

旧模型遗留的启停记录不在运行时参与状态合成，而是一次性迁移中归一（迁移规格见 docs/16）：

- Claude：清理 `settings.json` `skillOverrides` 残留（实证无害，但求干净）。
- Codex：按新模型重写 `config.toml`。
- ZCode：首迁按迁移前可见性快照批量写 `config.json`（原可见者 `enable:true`、其余 `enable:false`），避免「不写 = 全启用」把全部原件意外入锁。

## 后果

- 建链风格统一为**相对链**（与 ZCode 手写链、skills.sh 惯例同构）。
- WorkBuddy 列存在拷贝漂移：原件更新后拷贝可能落后，由健康检查提示并提供「刷新拷贝」。
- Codex 列操作后需提示「重启 Codex 生效」；其余列对新会话即时可见。
