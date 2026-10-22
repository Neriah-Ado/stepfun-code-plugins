# Changelog — step-api-forge

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循 semver。

<!-- 版本节由 tests/bootstrap-changelog.mjs 从 git 历史自举生成 -->

## [1.3.1] - 2026-10-22

### Security
- C-04：生成器对 OpenAPI 输入做白名单与转义——path 仅允许 URL 安全字符、path 参数名/operationId/响应码校验、`servers[].url` 以 JSON 字符串字面量输出、TS 注释与文档页 HTML 全量转义；恶意 spec 不再能注入可执行代码，合法 spec 输出不变 (AF-131-1)

## [1.3.0] - 2026-09-27

### Other Changes
- 自举 /changelog 生成 step-api-forge v1.2.0/v1.3.0 条目并接入市场源 (AF-120, AF-130)

## [1.1.0] - 2026-09-27

### Added
- mock server 与文档页生成并标记 v1.1.0 完成 (AF-110-1, AF-110-2)

### Other Changes
- 自举 /changelog 生成 step-api-forge v1.1.0 条目 (AF-110)

## [1.0.0] - 2026-09-27

### Added
- api-forge 校验与 TS 客户端生成 (AF-100-1, AF-100-2, AF-100-3)

### Other Changes
- 自举 /changelog 生成 step-api-forge CHANGELOG (AF-100)
- 引入插件仓库骨架与全局开发规范
