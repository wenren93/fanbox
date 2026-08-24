# Skills 一次性迁移：真实 HOME 验收报告

日期：2026-08-24（Asia/Shanghai）
实施票：[GitHub #29](https://github.com/wenren93/fanbox/issues/29)
规格：`docs/16-Skills透视-原件与接入模型及迁移规格.md` §8–§9

## 结论

真实 HOME 迁移已完成，向导最终报告 **8/8 通过**。最终可回滚 manifest：

```text
/Users/one/.fanbox/migration/manifest-1787550540874-f4af36.json
```

迁移后的 refresh v2 扫描结果：77 个原件，`anomalies: []`；原件仓无死环、无断链，ego 外部链继续识别为外部原件。14 条 `wb-drift` 是仓库胜出版与保留不动的 WorkBuddy 旧拷贝之间的健康提示，不属于 anomaly。

## 执行记录

向导使用扫描所得默认胜出版本，未作人工改判。

1. 首次执行在 Phase 1 触发 cc-switch 包装备份适配缺陷；失败阶段已自动回滚，其余阶段跳过。现场保存在 `manifest-1787550298443-556752.json`。
2. 修复并加入集成回归后重新执行，Phase 0–5 全部完成。Claude / WorkBuddy 可见集合严格不变；Codex 新增 52 个、消失 0 个；ZCode 新增 0 个、消失 0 个。该次报告仅因 `~/.codex/skills/.DS_Store` 未清理而未全绿，现场保存在 `manifest-1787550460435-db8349.json`。
3. 修复隐藏残留清理并加入回归后幂等重试，Phase 0–5 全部完成，最终 8/8 通过；四 Agent 在此次幂等复核中的 added / removed 均为 0。

两项真实 HOME 才暴露的缺陷均已固化为自动化测试：

- cc-switch `skill-backups/<timestamp>/` 是包装目录；扫描现读取 `meta.json.skill.name`，以 `skill/` 为候选内容，同名多备份只取最新一份。
- Codex 终态严格只留 `.system`；`.DS_Store` 等隐藏残留同样经系统废纸篓清理。

## §9 八项验收

| 验收项 | 结果 | 证据 |
|---|---:|---|
| 1. 可见性不变式 | 通过 | 首次有效迁移：Claude / WorkBuddy added 0、removed 0；Codex added 52、removed 0；ZCode added 0、removed 0。最终幂等复核四列均 added 0、removed 0。 |
| 2. 原件仓健康 | 通过 | migrate scan：`storeDeadLoops=[]`、`storeBrokenLinks=[]`、`storeAliasLinks=[]`；ego-browser 保持 external-link。 |
| 3. 外部不动 | 通过 | WorkBuddy 两目录与 ego 内容指纹前后完全一致；cc-switch 备份文件最后修改时间仍停留在 2026-08-18。迁移期间 cc-switch 自身更新了 DB / log，迁移代码未写其目录。 |
| 4. Codex 终态 | 通过 | `~/.codex/skills` 仅剩 `.system`；77 个原件由原件仓原生扫描可见。 |
| 5. ZCode 终态 | 通过 | `~/.zcode/skills` 无软链；服务端按迁移前可见集合批量写入 `enable`，向导终态检查通过。 |
| 6. Claude 终态 | 通过 | `~/.claude/skills` 为真实目录；顶层接入均为相对链；`settings.json` 已无 `skillOverrides`。 |
| 7. 可回滚 | 通过 | 三次执行均留 manifest；删除动作全部经过 trash。最终 manifest 存在并记录各 Phase。 |
| 8. 提醒项 | 通过 | UI 报告明确提醒 review / git commit，以及 Codex 配置需重启后生效。 |

## 外部内容指纹

以下 SHA-256 来自执行前后同一路径的只读归档指纹：

| 路径 | 执行前 | 执行后 |
|---|---|---|
| `~/.workbuddy/skills` | `0ab73e4f7f5c98d85baa90c9be7c72805bd1da5333767a6c7cbb49eda71e16b3` | 同左 |
| `~/.workbuddy/skills_disabled` | `e82e7b9d1016813997ee994f1d77cad9c347a756bb35aeb27cd1000dd65cae79` | 同左 |
| ego-browser 外部原件 | `dbd11d74cdd0e316c5658bc227499be30dc70b7818e4a80f4911eddeef59972a` | 同左 |

cc-switch 整目录归档指纹在期间发生变化，核对后只有其自身运行产生的 `cc-switch.db` 与 `logs/cc-switch.log` 在 13:49:10 更新；`skill-backups/` 内容文件没有迁移期修改。迁移对 cc-switch 只读。

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
