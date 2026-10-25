# Changelog — step-log-lens

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循 semver。

## [1.0.0] - 2026-10-26

### 新增

- `/log-analyze` 错误聚类与时间线分析，报告落盘 `docs/log-report/`，喂模型片段 ≤ 200 行
- `/log-tail` 关键字过滤的尾部快照，命中过多自动降级为汇总
- 凭据形态字符串（Bearer、token、URL 查询串凭据）输出前统一脱敏
