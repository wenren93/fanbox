# Skills 一次性迁移：真实 HOME 验收报告

日期：2026-08-24（Asia/Shanghai）
实施票：[GitHub #29](https://github.com/wenren93/fanbox/issues/29)
规格：`docs/16-Skills透视-原件与接入模型及迁移规格.md` §8–§9

## 结论

真实 HOME 迁移已完成，向导最终报告 **8/8 通过**。最终可回滚 manifest：

```text
/Users/one/.fanbox/migration/manifest-1787551290252-114952.json
```

迁移后的 refresh v2 扫描结果：77 个原件，`anomalies: []`；原件仓无死环、无断链，ego 外部链继续识别为外部原件。15 条 `wb-drift` 是仓库胜出版与保留不动的 WorkBuddy 旧拷贝之间的健康提示，不属于 anomaly。

## 执行记录

向导使用扫描所得默认胜出版本，未作人工改判。

1. 首次执行在 Phase 1 触发 cc-switch 包装备份适配缺陷；失败阶段已自动回滚，其余阶段跳过。现场保存在 `manifest-1787550298443-556752.json`。
2. 修复并加入集成回归后重新执行，Phase 0–5 全部完成。Claude / WorkBuddy 可见集合严格不变；Codex 新增 52 个、消失 0 个；ZCode 新增 0 个、消失 0 个。该次报告仅因 `~/.codex/skills/.DS_Store` 未清理而未全绿，现场保存在 `manifest-1787550460435-db8349.json`。
3. 修复隐藏残留清理并加入回归后幂等重试，Phase 0–5 全部完成，最终 8/8 通过；四 Agent 在此次幂等复核中的 added / removed 均为 0。
4. 双轴 code review 发现三处验收缺口：链接删除未进入 trash、外部不动只比较链接名称、已拆分 Claude 目录未强制相对链。修复后新增集成回归，并把 Codex / ZCode 清理动作恢复到各自 Phase。
5. 新版真实 HOME 首次复核准确捕获 cc-switch 运行时 DB / log 写入造成的整目录指纹噪声；验收边界收窄为迁移实际读取的 `skill-backups/` 与 `skills/`。最终再次幂等执行，8/8 通过，四列均 added 0、removed 0。

真实 HOME 与 code review 暴露的缺陷均已固化为自动化测试：

- cc-switch `skill-backups/<timestamp>/` 是包装目录；扫描现读取 `meta.json.skill.name`，以 `skill/` 为候选内容，同名多备份只取最新一份。
- Codex 终态严格只留 `.system`；`.DS_Store` 等隐藏残留同样经系统废纸篓清理。
- 被替换或移除的软链与真实内容一样先进入废纸篓，manifest 记录 `originalPath` 与 trash 目标；Phase 失败仍可原位恢复。
- 外部验收比较 WorkBuddy、cc-switch Skills/备份和每个原件仓外链目标的内容指纹；cc-switch 自主写入的 DB / log 不纳入迁移边界。
- Claude 已是真实目录时，真实拷贝、绝对链和错指链也会归一为指向原件仓的相对链。

## §9 八项验收

| 验收项 | 结果 | 证据 |
|---|---:|---|
| 1. 可见性不变式 | 通过 | 首次有效迁移：Claude / WorkBuddy added 0、removed 0；Codex added 52、removed 0；ZCode added 0、removed 0。最终幂等复核四列均 added 0、removed 0。 |
| 2. 原件仓健康 | 通过 | migrate scan：`storeDeadLoops=[]`、`storeBrokenLinks=[]`、`storeAliasLinks=[]`；ego-browser 保持 external-link。 |
| 3. 外部不动 | 通过 | 最终 manifest 内 WorkBuddy、ego、cc-switch `skill-backups/` 与 `skills/` 的内容指纹前后完全一致。cc-switch 运行时 DB / log 不属于迁移读写边界。 |
| 4. Codex 终态 | 通过 | `~/.codex/skills` 仅剩 `.system`；77 个原件由原件仓原生扫描可见。 |
| 5. ZCode 终态 | 通过 | `~/.zcode/skills` 无软链；服务端按迁移前可见集合批量写入 `enable`，向导终态检查通过。 |
| 6. Claude 终态 | 通过 | `~/.claude/skills` 为真实目录；顶层接入均为相对链；`settings.json` 已无 `skillOverrides`。 |
| 7. 可回滚 | 通过 | 最终 manifest 存在并记录各 Phase，`recoverable=true`。code review 后的实现保证内容与链接删除均经 trash，并由集成测试验证 `originalPath`；前三份历史 manifest 早于该修复，不作为链接恢复证据。 |
| 8. 提醒项 | 通过 | UI 报告明确提醒 review / git commit，以及 Codex 配置需重启后生效。 |

## 外部内容指纹

以下 SHA-256 来自执行前后同一路径的只读归档指纹：

| 路径 | 执行前 | 执行后 |
|---|---|---|
| `~/.workbuddy/skills` | `bd2fc1d2d665e3271d5e02491dab626c04d28c53cb2206379113d7165aff4e15` | 同左 |
| `~/.cc-switch/skill-backups` | `e448f27e79d7b1fd7b1e6812b65f241922ed7b5d802175352a41e76015af588a` | 同左 |
| `~/.cc-switch/skills` | `5f1f6d78ed40c51909ec015ba082c5529dfacf1640dab7a069de6cb108962e93` | 同左 |
| ego-browser 外部原件 | `ef5d67ce3ce7727b84c7c103798e18e9b0927711f543ceb874ff97e45b79a504` | 同左 |

cc-switch 整目录会因其运行时持续写 `cc-switch.db` 与 `logs/cc-switch.log` 而变化；最终验收只比较迁移读取的两个稳定子树，二者均保持不变。

## 最终 refresh v2

```json
{
  "counts": {
    "total": 77,
    "claude": 24,
    "codex": 77,
    "workbuddy": 61,
    "zcode": 24,
    "stock": 0
  },
  "anomalies": []
}
```

仓库中由胜出版恢复或更新的内容包括 `prototype`、`research`、`resolving-merge-conflicts`，以及死名恢复件 `grill-me`、`grilling`、`handoff`；这些内容与向导 UI/API 修复一并 review 后提交。
