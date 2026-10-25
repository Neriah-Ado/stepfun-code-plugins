# Changelog — step-env-vault

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循 semver。

## [1.0.0] - 2026-10-26

### 新增

- `/env-diff` 环境文件对比（缺失/多余/空值不一致），输出默认脱敏
- `/env-example` 从 `.env` 生成类型占位符版 `.env.example`，保留注释与顺序
- `.gitignore` 未忽略 `.env` 时自动告警
