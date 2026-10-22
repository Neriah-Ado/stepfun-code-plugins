# Changelog — step-docker-mate

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循 semver。

<!-- 版本节由 tests/bootstrap-changelog.mjs 从 git 历史自举生成 -->

## [1.3.1] - 2026-10-22

### Security
- C-05：容器名/镜像引用走白名单（`[A-Za-z0-9][A-Za-z0-9_.-]{0,127}` / 镜像引用字符集，且不得以 `-` 开头），并在 `inspect`/`logs`/`history` 的位置参数前加 `--` 终止符，避免用户输入被 docker 当作选项；`--tail` 收敛到 1..5000 (DM-131-1)

## [1.3.0] - 2026-09-27

### Added
- /docker-health 健康日报与远程 context 支持 (DM-130-1, DM-130-2)

### Other Changes
- 自举 /changelog 生成 step-docker-mate v1.3.0 条目并接入市场源 (DM-130)
- 标记 step-docker-mate v1.3.0 完成并接入市场源

## [1.2.0] - 2026-09-27

### Added
- slimming_plan 镜像瘦身方案与多 compose 项目管理 (DM-120-1, DM-120-2)

### Other Changes
- 自举 /changelog 生成 step-docker-mate v1.2.0 条目 (DM-120)
- 标记 step-docker-mate v1.2.0 任务完成

## [1.1.0] - 2026-09-27

### Added
- 崩溃模式库 diagnose 与 docker_events 巡检 (DM-110-1, DM-110-2)

### Other Changes
- 自举 /changelog 生成 step-docker-mate v1.1.0 条目 (DM-110)
- 清单升级 v1.1.0
- 标记 step-docker-mate v1.1.0 任务完成

## [1.0.0] - 2026-09-27

### Added
- docker-mate MCP server 与运维 skill (DM-100-1, DM-100-2, DM-100-3, DM-100-4)

### Other Changes
- 自举 /changelog 生成 step-docker-mate CHANGELOG (DM-100)
- 补充 step-docker-mate 文档并标记 v1.0.0 完成 (G5)
- 引入插件仓库骨架与全局开发规范
