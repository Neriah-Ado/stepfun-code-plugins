# Changelog — step-sec-scan

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循 semver。

<!-- 版本节由 tests/bootstrap-changelog.mjs 从 git 历史自举生成 -->

## [1.3.1] - 2026-10-22

### Security
- C-06：secret 规则收紧与降噪修正——补齐 Slack/Stripe/OpenAI 风格前缀与 PGP 私钥块，generic key 值门槛 24→20；测试/示例/文档路径不再整体忽略，仅占位值忽略，非占位值降级为 low 并标注 noise；文档补充「历史扫描需显式传入 `git log -p --all` 输出」的实现范围说明 (SS-131-1)

## [1.3.0] - 2026-09-27

### Other Changes
- 自举 /changelog 生成 step-sec-scan v1.2.0/v1.3.0 条目并接入市场源 (SS-120, SS-130)

## [1.1.0] - 2026-09-27

### Added
- pip-audit/cargo audit 解析接入并标记 v1.1.0 完成 (SS-110-1, SS-110-2)

### Other Changes
- 自举 /changelog 生成 step-sec-scan v1.1.0 条目 (SS-110)

## [1.0.0] - 2026-09-27

### Added
- sec-scan MCP server 与 /audit 审计工作流 (SS-100-1, SS-100-2, SS-100-3)

### Other Changes
- 自举 /changelog 生成 step-sec-scan CHANGELOG (SS-100)
- 引入插件仓库骨架与全局开发规范
