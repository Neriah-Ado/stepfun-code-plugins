# step-db-insight — 数据库只读助手

MCP server（零依赖 Node）：**双重只读防线**（语句白名单解析 + 建议只读账号）+ `psql` CLI 执行层（测试缝可换）。

## 它解决什么

想快速看清一张表的结构、抽样几条数据、理解一条 SQL 的执行计划，又不想把生产库暴露给写操作。本插件把 schema 浏览、只读查询、EXPLAIN 解读与迁移草稿做成工具，写操作单独走确认路径，删除与 DDL 永久拒绝。

## 使用

| 命令 / 工具 | 说明 |
| --- | --- |
| `/db-insight` | 只读数据库助手入口：schema 浏览、白名单守卫的只读查询、EXPLAIN 解读 |
| `list_tables` / `describe_table` / `sample_rows` | schema 浏览（只读） |
| `read_query` / `explain_query` | 白名单守卫的只读查询与计划解读 |
| `migration_scaffold` | 迁移 SQL 草稿（up/down，人工审查，不自动执行） |
| `write_confirm` | 受控 INSERT/UPDATE（逐条确认；DELETE/DDL 永久拒绝） |
| `schema_timeline` | 迁移目录 → mermaid 演进时间线 |

## 安装

```bash
/plugin marketplace add Neriah-Ado/stepcode-plugins
/plugin install step-db-insight
```

## 验证

```bash
node tests/validate.mjs   # 含 9 条对抗样本的只读守卫测试
```

## 边界与限制

- **所需凭据**：`DATABASE_URL`。未配置时输出 export 示例与安全提示；连接串禁止落盘、打印或提交。
- 连接串**不会**作为 `psql` 的 argv：插件解析后经 `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE`（及 `sslmode` 等）环境变量传给子进程，避免密码出现在进程列表或审计日志。
- `describe_table` / `sample_rows` 的表名走标识符白名单（`[A-Za-z_][A-Za-z0-9_$]*`，可 `schema.table`，长度上限 63）。
- **插件白名单不是沙箱**：真正的安全边界是数据库只读账号（仅 `GRANT SELECT`）或只读事务，请勿用超级用户连接。
- `write_confirm` 的 `confirm` 只是显式确认语义，最终仍应由人类在宿主侧确认；只读工具也一样，不要将不可信请求直接转给本 server。
- MCP server 走 stdio JSON-RPC，**无认证、无审计日志**：安全边界即启动它的宿主进程（stdio 继承宿主信任）。
- **仅限本机**：不要将 stdio 桥接为网络/tcp 服务，也不要把本插件 server 暴露到公网；如需网络化，必须自行增加认证与访问控制。

## 许可证

[AGPL-3.0-only](../../LICENSE)
