# step-todo-flow — 项目 TODO 工作流

纯声明式插件：用一个 `TODO.md` 承载团队任务流。所有写操作先 diff 后确认，拆分出的条目必须可验收。

## 它解决什么

会话里口头排的任务散落在聊天记录里，第二天就丢；而拆需求最常见的问题是拆出一堆「优化一下」这种没法判定做没做完的条目。本插件把任务落成一个可评审、可提交的文件，并强制每条任务带完成标准。

## 使用

| 命令 | 说明 |
| --- | --- |
| `/todo [add\|done\|remove\|list]` | TODO.md 增删改查：按 P0/P1/P2 分节，写盘前 diff 确认，写盘前重读防并发覆盖 |
| `/todo-plan <需求>` | 拆分需求为 ≤ 7 条带验收标准的条目，含糊点标「待澄清」 |

## 安装

```bash
/plugin marketplace add Neriah-Ado/stepcode-plugins
/plugin install step-todo-flow
```

## 验证

```bash
node tests/validate.mjs
```

## 边界与限制

- 单文件单优先级体系，不做看板、不做多视图。
- 条目文本不应包含密钥或个人敏感信息，检测到会要求改写。
- 「已完成」区只保留近 10 条，更早条目清理（提示后执行）。

## 许可证

[AGPL-3.0-only](../../LICENSE)
