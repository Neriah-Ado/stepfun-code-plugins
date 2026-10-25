# Changelog — step-license-guard

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循 semver。

## [1.0.0] - 2026-10-26

### 新增

- `/license-audit` 依赖许可审计：npm 离线读取、pip 外部工具降级指引、go.mod 直读，报告落盘
- `/license-header` SPDX 头批量校验/补写，默认 dry-run，写盘逐批确认
- 自定义策略表（config/licenses.json）整体覆盖默认 allow/warn/deny
