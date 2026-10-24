# Changelog — step-api-forge

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循 semver。

## [1.3.1] - 2026-10-22

### 安全

- 生成器对 OpenAPI 输入做白名单与转义：path 仅允许 URL 安全字符、path 参数名/operationId/响应码校验、`servers[].url` 以 JSON 字符串字面量输出、TS 注释与文档页 HTML 全量转义；恶意 spec 不再能注入可执行代码，合法 spec 输出不变。

## [1.3.0] - 2026-09-27

### 新增

- Python requests SDK 生成；反向生成走提示词辅助模式

## [1.2.0] - 2026-09-27

### 新增

- `diff_spec` breaking change 检测与兼容性摘要

## [1.1.0] - 2026-09-27

### 新增

- mock server 与文档页生成

## [1.0.0] - 2026-09-27

### 新增

- api-forge 校验与 TS 客户端生成
