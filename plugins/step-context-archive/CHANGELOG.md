# Changelog — step-context-archive

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循 semver。

## [1.0.0] - 2026-10-01

### 新增

- 新增 step-context-archive 插件清单并登记 roadmap 与市场源
- 实现 `/archive` 归档命令（原文落盘 + 三点摘要索引 + 完成状态汇报）
- 实现 `/recall` 命令与 context-archive 技能，补充 README 索引与 CHANGELOG

### 变更

- 许可证由 MIT 切换为 AGPL-3.0-only
- 补全参考实现的许可引用链接与许可名

### 修复

- `#STAMP` 索引行改为项目相对路径，并明确退化 id 为例外
