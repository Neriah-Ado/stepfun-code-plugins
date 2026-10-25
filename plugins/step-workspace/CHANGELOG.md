# Changelog — step-workspace

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循 semver。

## [1.0.0] - 2026-10-26

### 新增

- `/affected` 受影响包计算：变更包 + 依赖闭包分层展示，最小验证命令建议
- `/workspace-graph` mermaid 依赖图落盘与循环依赖检测
- 支持 npm/pnpm/yarn workspaces、Cargo workspace、go.work
