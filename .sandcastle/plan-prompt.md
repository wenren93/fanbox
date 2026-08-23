# ISSUES

Here are the open issues in the repo:

<issues-json>

!`gh issue list --state open --limit 500 --json number,title,body,labels,comments --jq '[.[] | select([.labels[].name] | any(. == "Sandcastle" or . == "ready-for-agent")) | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`

</issues-json>

The list above is filtered to issues carrying **either** the `Sandcastle` or the
`ready-for-agent` label（任一标签即入选；`ready-for-agent` 表示人工放行）. Use the issue
body and comments to determine whether each issue is ready for work.

<br />

# TASK

Analyze the open issues and build a dependency graph. For each issue, determine whether it **blocks** or **is blocked by** any other open issue.

An issue B is **blocked by** issue A if:

* B requires code or infrastructure that A introduces

* B and A modify overlapping files or modules, making concurrent work likely to produce merge conflicts

* B's requirements depend on a decision or API shape that A will establish

An issue is **unblocked** if it has zero blocking dependencies on other open issues.

For each unblocked issue, assign a branch name using the exact format `sandcastle/issue-{id}` (no slug or other suffix). This must be deterministic so that re-planning the same issue always produces the same branch name and accumulated progress is preserved.

# OUTPUT

Output your plan as a JSON object wrapped in `<plan>` tags:

<plan>
{"issues": [{"id": "42", "title": "Fix auth bug", "branch": "sandcastle/issue-42"}]}
</plan>

Include only unblocked issues. If every issue is blocked, include the single highest-priority candidate (the one with the fewest or weakest dependencies).

Always emit the `<plan>` tags, even when there is nothing to do. If there are no issues to work on at all, output `<plan>{"issues": []}</plan>` so the run can exit cleanly.

# 图片识别规则

当传入图片、截图或图片文件路径时：

1. 必须优先使用 `vision` MCP，不要直接凭主模型分析图片。
2. 如果有图片文件路径，先调用：
   `vision.import_image({ sourcePath })`
3. 获取 `assetId` 后，立即调用：
   `vision.inspect_image({ assetId, goal })`
4. 只有在 MCP 调用失败后，才允许说明失败原因。
