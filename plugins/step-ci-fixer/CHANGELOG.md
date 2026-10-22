# Changelog — step-ci-fixer

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循 semver。

## [1.3.1] - 2026-10-22

### 安全

- `runId`/`prNumber` 只接受正整数（`^[1-9]\d{0,19}$`），`--limit` 收敛到 1..100，`--workflow` 改用 `--workflow=<name>` 等号形式并拒绝控制符/前导 `-`，避免参数被 gh 当作选项（flag 混淆）。

## [1.3.0] - 2026-09-27

### 新增

- GitLab/Jenkins 日志适配层

## [1.2.0] - 2026-09-27

### 新增

- `/ci-watch` 挂机监控与 PR 评论交互

## [1.1.0] - 2026-09-27

### 新增

- `check_gh` 区分未安装/未登录两类指引
- 多 workflow 选择器与失败四分类修复策略

## [1.0.0] - 2026-09-27

### 新增

- ci-fixer MCP server 与 `/ci-fix` 修复闭环
