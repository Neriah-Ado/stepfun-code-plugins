---
description: 数据库只读助手：schema 浏览、只读查询（白名单守卫）、EXPLAIN 解读；连接串走 DATABASE_URL 环境变量
argument-hint: [表名或 SQL，可选]
---

# /db-insight — 只读数据库助手

## 安全红线（G3/G4/C4）

<!-- READONLY-RULES-START -->
```json
{
  "readonly": "双重防线：① 连接层只读（建议只读账号/只读事务）② 语句白名单解析（仅 SELECT/EXPLAIN/SHOW）",
  "real_boundary": "插件正则/白名单只防误操作，真正的安全边界是数据库只读账号（仅 GRANT SELECT）或只读事务；禁止用超级用户连接",
  "identifier_whitelist": "describe_table/sample_rows 的表名仅允许未加引号的 [A-Za-z_][A-Za-z0-9_$]*（可 schema.table），拒绝引号/分号/空白/注释符",
  "reject": "任何写关键字（INSERT/UPDATE/DELETE/DROP/...）、多语句、注释走私一律拒绝并说明原因",
  "credential": "DATABASE_URL 仅环境注入，禁止落盘/打印/提交仓库；连接串解析后经 PG* 环境变量传给 psql，密码不进 argv/进程列表",
  "degrade": "DATABASE_URL 未配置时输出 export 示例指引；psql 缺失时给安装指引"
}
```
<!-- READONLY-RULES-END -->

## 工作流

1. `list_tables` → `describe_table` → `sample_rows`（默认 20 行）逐步了解 schema。
2. 任意只读查询走 `read_query`（白名单守卫）；被拒绝时阅读 reason，不要尝试绕过。
3. EXPLAIN 解读规则（与 tests 同源）：Seq Scan 大表 → 建索引建议；大规模 Nested Loop → 连接条件检查；排序溢出磁盘 → work_mem。

## 慢查询优化与迁移（v1.1.0）

- `migration_scaffold`：生成带 `+up/+down` 的迁移 SQL 草稿，文件名 `时间戳_名称.sql`；**只生成不执行**，人工审查后才入库。
- 慢查询建议：按 EXPLAIN 发现给出索引/改写/work_mem 三类建议。

## 受控写入（v1.2.0）

`write_confirm`：INSERT/UPDATE 逐条确认（先返回确认载荷 → 用户同意 → confirm=true 执行）；DELETE/DDL **永久拒绝**；建议事务包裹（BEGIN; 语句; 核对影响行; COMMIT / ROLLBACK）。

## 多库（v1.3.0）

`DB_DIALECT` 环境变量切换 postgres/mysql/sqlite（引号与元数据查询自适应）；`schema_timeline` 从迁移目录生成 mermaid 时间线。
