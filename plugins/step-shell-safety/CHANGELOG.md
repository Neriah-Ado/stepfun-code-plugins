# Changelog — step-shell-safety

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循 semver。

## [1.0.0] - 2026-10-26

### 新增

- `/shell-check` 命令风险预检（副作用解释、三级分级、更安全替代），预检零执行
- `/risk-baseline` 项目风险白名单管理，写操作先展示 diff
- `dangerous-patterns` 危险命令模式库技能（五类高危形态）
