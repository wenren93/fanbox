# MCP 集成测试

你运行在 SandCastle 沙箱中。任务是验证 vision MCP 服务器**实际可用**——不仅配置正确，还能真正调用工具。

## 测试步骤

### 1. 确认 MCP 工具已加载

运行以下命令检查 vision 服务器状态：
```bash
claude mcp list
```
确认 vision 服务器显示为 ✅ Connected（而非 ⏸ Pending）。

### 2. 调用 import_image 导入测试图片

使用 MCP 工具 `import_image` 导入一张测试图片：
- sourcePath: `/home/agent/workspace/build/icon.png`

记录返回的 `assetId`。

### 3. 调用 inspect_image 分析图片

使用 MCP 工具 `inspect_image` 对导入的图片进行分析：
- assetId: 上一步返回的 assetId
- goal: "描述这张图片的内容"

记录返回的分析结果。

### 4. 验证结果

检查：
- `import_image` 是否返回了有效的 `assetId`
- `inspect_image` 是否返回了有意义的分析文本（非空、非错误）

## 输出格式

输出一份简洁的测试报告：

```
## MCP 集成测试结果

| 测试项 | 结果 | 详情 |
|--------|------|------|
| MCP 服务器连接 | ✅/❌ | 状态信息 |
| import_image | ✅/❌ | assetId 值 |
| inspect_image | ✅/❌ | 分析结果摘要 |

总结：通过/失败
```

完成后输出 `<promise>COMPLETE</promise>`。
