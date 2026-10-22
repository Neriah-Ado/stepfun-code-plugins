# Changelog — step-sec-scan

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循 semver。

## [1.3.1] - 2026-10-22

### 安全

- secret 规则收紧与降噪修正：补齐 Slack/Stripe/OpenAI 风格前缀与 PGP 私钥块，generic key 值门槛 24→20；测试/示例/文档路径不再整体忽略，仅占位值忽略，非占位值降级为 low 并标注 noise；文档补充「历史扫描需显式传入 `git log -p --all` 输出」的实现范围说明。

## [1.3.0] - 2026-09-27

### 新增

- `upgrade_plan` 自动修复升级清单与 `ci_gate` CI 卡点

## [1.2.0] - 2026-09-27

### 新增

- 基线对比与 CycloneDX SBOM 生成

## [1.1.0] - 2026-09-27

### 新增

- pip-audit / cargo audit 解析接入

## [1.0.0] - 2026-09-27

### 新增

- sec-scan MCP server 与 `/audit` 审计工作流
