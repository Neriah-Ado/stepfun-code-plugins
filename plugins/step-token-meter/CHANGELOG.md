# Changelog — step-token-meter

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循 semver。

## [1.3.0] - 2026-09-27

### 新增

- 预算告警（ok/warn/exceed 三态）、多机数据合并、schema migration 适配层

## [1.2.0] - 2026-09-27

### 新增

- 本地 HTML 报告与 `/cron` 周报规则

## [1.1.0] - 2026-09-27

### 新增

- 零依赖 MCP server 化，提供 `get_usage` / `get_usage_by_model` 工具
- 清单注册 mcpServers 并新增 MCP 冒烟校验

## [1.0.0] - 2026-09-27

### 新增

- CSV 导出与容错解析层
- 实现 `/usage` 聚合与成本粗估命令
- 逆向会话存储格式并建立容错策略文档
