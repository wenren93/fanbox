# Skill 发现由本机直连 skills.sh

Skills 透视的“发现”由 FanBox 本机通过独立数据源适配器调用 skills.sh 官方 CLI 正在使用的匿名搜索端点，不建设 FanBox 托管代理、不执行 CLI，也不使用普通 GitHub 搜索补充结果。这样无需账号、密钥或云端运维，搜索词只发送给 skills.sh；代价是该端点尚未进入正式 API 文档，未来变更时需要替换适配器，接口异常期间发现功能可以暂时不可用但不得影响本机 Skills 管理。
