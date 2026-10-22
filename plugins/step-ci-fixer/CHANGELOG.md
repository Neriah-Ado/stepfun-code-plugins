# Changelog — step-ci-fixer

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循 semver。

<!-- 版本节由 tests/bootstrap-changelog.mjs 从 git 历史自举生成 -->

## [1.3.1] - 2026-10-22

### Security
- C-05：`runId`/`prNumber` 只接受正整数（`^[1-9]\d{0,19}$`），`--limit` 收敛到 1..100，`--workflow` 改用 `--workflow=<name>` 等号形式并拒绝控制符/前导 `-`，避免参数被 gh 当作选项（flag 混淆） (CF-131-1)

## [1.3.0] - 2026-09-27

### Added
- GitLab/Jenkins 日志适配层并标记 v1.3.0 完成 (CF-130-1, CF-130-2)

### Other Changes
- 自举 /changelog 生成 step-ci-fixer v1.3.0 条目 (CF-130)

## [1.2.0] - 2026-09-27

### Added
- /ci-watch 挂机监控与 PR 评论交互 (CF-120-1, CF-120-2)

### Other Changes
- 自举 /changelog 生成 step-ci-fixer v1.2.0 条目 (CF-120)

## [1.1.0] - 2026-09-27

### Other Changes
- 自举 /changelog 生成 step-ci-fixer v1.0.0/v1.1.0 条目 (CF-100, CF-110)
- 标记 step-ci-fixer v1.0.0/v1.1.0 任务完成

## [1.0.0] - 2026-09-27

### Added
- ci-fixer MCP server 与 /ci-fix 修复闭环 (CF-100-1, CF-100-2, CF-100-3, CF-100-4)

### Other Changes
- 自举 /changelog 生成 step-ci-fixer CHANGELOG (CF-100)
- 补充 step-ci-fixer 文档并标记 v1.0.0 完成 (G5)
- 引入插件仓库骨架与全局开发规范
