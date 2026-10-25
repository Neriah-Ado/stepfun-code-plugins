# Changelog — step-a11y-check

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循 semver。

## [1.0.0] - 2026-10-26

### 新增

- `/a11y-audit` 七类可访问性反模式静态扫描，四列表报告落盘并映射 WCAG 条目
- `/a11y-fix` 按报告定点最小 diff 修复，逐处确认后写盘并复核
- lint 注释标住的行自动跳过并计数，降低误报噪音
