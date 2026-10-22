# Changelog — step-test-guard

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循 semver。

## [1.3.0] - 2026-09-27

### 新增

- `/flaky` 识别与隔离建议
- `/bisect` 回归根因定位命令

## [1.2.0] - 2026-09-27

### 新增

- `/nightly-test` 接入 `/cron` 无头夜间任务
- 新增报告渲染与上轮对比校验

## [1.1.0] - 2026-09-27

### 新增

- 新增失败用例缓存与增量重跑
- 新增 istanbul/cobertura 覆盖率报告解读
- 新增 go/cargo/maven/gradle 输出解析

## [1.0.0] - 2026-09-27

### 新增

- 编写 step-test-guard 插件清单
- 内置 vitest/jest/pytest 输出解析与框架检测
- 实现 test-fix-loop 修复循环 skill
- 实现 `/test` 测试守护入口命令
