# 外部 Skill 安装使用固定 GitHub commit 归档

对于可安装的 skills.sh 条目，FanBox 使用本机 Git 查询公开仓库 HEAD 的完整 commit SHA，再从 GitHub codeload 下载该 commit 的归档，在临时目录限额解包并唯一匹配 Skill 子目录；不使用未绑定 commit 且只表达文本文件的 skills.sh 下载快照。这样无需 GitHub Token 或新增运行时依赖，也能保留资源文件并得到可复现内容；代价是安装依赖本机 Git 与 GitHub codeload，可搜索但缺少这些条件时必须禁用安装。
