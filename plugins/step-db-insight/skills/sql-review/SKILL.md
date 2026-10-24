---
name: sql-review
description: 数据库 SQL 审查方法论：只读守卫原则、EXPLAIN 计划解读、迁移脚本审查要点、受控写入事务边界。涉及 SQL/数据库任务时使用。
---

# sql-review — SQL 审查方法论

## 只读边界（READONLY-BOUNDARY）

- **真正的边界是数据库权限**：插件级语句白名单/标识符白名单只防误操作与低级注入，不能替代只读账号。连接必须使用仅 `GRANT SELECT` 的角色（或显式只读事务），禁止用超级用户/拥有写权限的账号。
- `describe_table` / `sample_rows` 的表名只允许未加引号的 `[A-Za-z_][A-Za-z0-9_$]*`（可带 `schema.` 前缀）；含引号、分号、空白、注释符的输入直接拒绝。
- `read_query` 仍提供任意只读 SELECT——若连接账号可写，白名单不是沙箱；不要向不可信来源暴露本 MCP server。

## EXPLAIN 解读规则

<!-- EXPLAIN-RULES-START -->
```json
{
  "seq_scan": "Seq Scan on 大表（rows>1000）→ 检查 WHERE/JOIN 列是否缺索引",
  "nested_loop": "大规模 Nested Loop → 连接条件缺索引或应改写 Hash Join",
  "external_sort": "排序溢出磁盘 → 增大 work_mem 或减少排序集",
  "type_mismatch": "隐式类型转换（列 on 左侧套函数/字符比较数字）→ 使索引失效的常见原因"
}
```
<!-- EXPLAIN-RULES-END -->

## 迁移脚本审查要点（MIGRATION-RULES）

- 必须含 up/down 双向；大表加列用带默认值的分步策略（避免长锁）；加索引用 CONCURRENTLY（pg）；破坏性变更（删列/改类型）必须两段式（先停写入路径再删）；迁移文件永不自动执行，人工审查入库。

## 受控写入事务边界（TXN-RULES）

- INSERT/UPDATE：BEGIN → 语句 → 核对影响行数 → COMMIT；异常即 ROLLBACK；
- 批量写入分批提交（每批 ≤1000 行）；
- 长事务内禁止混入人工确认等待（先确认再开事务）。
