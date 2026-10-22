# Changelog — step-docker-mate

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循 semver。

## [1.3.1] - 2026-10-22

### 安全

- 容器名/镜像引用走白名单（`[A-Za-z0-9][A-Za-z0-9_.-]{0,127}` / 镜像引用字符集，且不得以 `-` 开头），并在 `inspect`/`logs`/`history` 的位置参数前加 `--` 终止符，避免用户输入被 docker 当作选项；`--tail` 收敛到 1..5000。

## [1.3.0] - 2026-09-27

### 新增

- `/docker-health` 健康日报与远程 context 支持

## [1.2.0] - 2026-09-27

### 新增

- `slimming_plan` 镜像瘦身方案与多 compose 项目管理

## [1.1.0] - 2026-09-27

### 新增

- 崩溃模式库 `diagnose` 与 `docker_events` 巡检

## [1.0.0] - 2026-09-27

### 新增

- docker-mate MCP server 与运维 skill
