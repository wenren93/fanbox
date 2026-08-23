# 02 — 链接模型的领域语言与 ADR 0001 改写

**Type:** grilling · **Blocked by:** 01 · **Status:** open · **Claimed by:** —

**GitHub issue:** [#13](https://github.com/wenren93/fanbox/issues/13)（母票 [#11](https://github.com/wenren93/fanbox/issues/11)）

## Question

「正本 + 软链」模型的领域语言怎么定，CONTEXT.md 与 ADR 0001 怎么改写？与用户对谈收敛（grilling + domain-modeling），产出术语决策与 ADR 改写要点。

待收敛的具体决策：

1. **术语**：现有 CONTEXT.md 定义了 导入（=完整复制）、安装项、覆盖、启用/停用（各 agent 官方配置语义）。新模型需要：正本（canonical，`~/.agents/skills` 的真实目录）、接入/链接（agent 目录里的软链）、链接启用（链在即启用）。旧词「导入」是改义、退役还是保留给「把外部拷贝收编为正本」的动作？「安装项」在链模型下指什么——正本 + N 条链算一个安装项还是 N+1 个对象？
2. **外部正本**：正本仓里的链（如 `ego-browser -> ~/.local/share/ego/ego-skills`，归 ego 工具管）算「正本」吗？「正本 = FanBox 管理的真实目录」与「正本 = 链条最终指向的真实目录」两种定义选哪个？这决定「同源更新」「卸载」对这些条目的语义。
3. **官方启停配置的去留**：链在即启用后，Claude `skillOverrides` / Codex `config.toml` 的存量禁用记录：迁移时清理？保留为兼容读取（图标状态 = 链存在 AND 配置启用）？还是彻底无视？依据 01 号票的事实回答。
4. **禁用的物理位置**：删链即禁用后，「重新启用」意味着重建链——无需记状态；但「从未接入的正本」与「曾接入后被禁用」在 UI 上要不要区分（可能不需要，这正是该模型的简化红利，需明确拍板）。
5. **ADR 0001 改写要点**：从「独立副本、不建软链」改为「全局目标一律软链」；写清动机（单一事实源、一键启停、迁移成本）与新代价（正本损坏全 agent 受影响、Windows 不可用、第三方工具并存约束）。是否同时需要新 ADR 记录「图标=链存在」的启停语义。

产出：CONTEXT.md 术语增删草案（随决策当场更新 CONTEXT.md）+ ADR 0001 改写要点。成文执行归 07 号票。
