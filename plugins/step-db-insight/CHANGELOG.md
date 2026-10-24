# Changelog — step-db-insight

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循 semver。

## [1.3.1] - 2026-10-22

### 安全

- `DATABASE_URL` 不再作为 `psql` 的 argv——解析后经 `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE`（及 sslmode 等）环境变量传子进程，避免密码出现在进程列表、崩溃转储或审计日志；同步更新 `PSQL_FAKE` 测试缝与回归测试。
- `describe_table` / `sample_rows` 的表名增加标识符白名单（仅 `[A-Za-z_][A-Za-z0-9_$]*`，可 `schema.table`，长度上限 63），拒绝引号/分号/空白/注释符等；文档明确「只读 DB 角色才是真正的边界，插件正则不是」。

## [1.3.0] - 2026-09-27

### 新增

- db-insight 只读助手与对抗测试
