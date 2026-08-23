# 08 — 正本仓的第三方写入并存规则

**Type:** grilling · **Blocked by:** — · **Status:** open · **Claimed by:** —

**GitHub issue:** [#19](https://github.com/wenren93/fanbox/issues/19)（母票 [#11](https://github.com/wenren93/fanbox/issues/11)）

## Question

skills.sh CLI、cc-switch、手动 `git clone` 等第三方安装器会直接往 `~/.agents/skills` 写内容。FanBox 与这些非自装正本的并存规则是什么？与用户对谈收敛。

待收敛的具体决策：

1. **身份识别**：无来源身份（无安装记录）的正本在 UI 中如何呈现——与 FanBox 安装的正本同权，还是标记「来源未知」？
2. **冲突规则**：FanBox 安装/收编遇正本仓已有同名目录（第三方先装）时的覆盖语义与来源身份替换规则；反向（FanBox 先装、第三方后覆盖）如何被健康检查发现。
3. **更新与卸载的边界**：对非自装正本，FanBox 是否提供同源更新/卸载，还是只提供接入管理（内容维护交还原安装器）？
4. **写入互斥**：FanBox 的原子换位与第三方并发写的边界——复用 queueSkillsWrite 串行是否足够。

产出：并存规则决策清单，供 07 号票规格引用。

## Resolution

（待解）
