---
description: 查看 TPS 吞吐、延迟分位数、错误率与系统资源快照
---

使用 zcode-tps-monitor 插件获取吞吐指标并以中文清晰展示。

执行步骤：

1. 优先调用 MCP 工具 `tps_snapshot`(即时快照)。
2. 如果用户给了数字参数(如 `/tps 10`),改用 `tps_watch` 并把 seconds 设为该数字(2-30 之间),展示采样统计(平均/峰值)。
3. 若 MCP 工具不可用,退回运行采集脚本:插件目录下 `scripts/collect.mjs`(即本技能 base directory 的 `../../scripts/collect.mjs`),加 `--watch N` 可采样观察。

展示要求:

- 用列表或表格呈现:TPS、延迟 p50/p95/p99、错误率、CPU、内存。
- 注明数据模式:remote(真实接口)或 demo(演示数据)。若是 demo,提醒用户可在 设置 → 插件管理 → zcode-tps-monitor 中配置 metrics_url 接入真实数据源。

## 多 agent 用量作用域(V2.4.0,可选)

如果用户问的是「某个客户端/某次会话的 token 速率」而不是接口吞吐,改用 token 速率查询:

- 插件目录下 `scripts/token-rate.mjs`(即本技能 base directory 的 `../../scripts/token-rate.mjs`)。
- 缺省行为与本插件历史版本完全一致:只统计 ZCode 自己的用量库。
- `--agent <id>` 限定单一数据源,可选值 `zcode` / `claude-code` / `codex` / `opencode` / `cline`;该源没有首字延迟等字段时自动降级显示,不报错。
- `--session <id>` 限定单个会话(优先级高于环境变量 `ZCODE_SESSION_ID` / `CLAUDE_SESSION_ID`)。
- `--agents` 列出本机各数据源的探测结果、当前会话与样本条数(用于回答「为什么没有某个客户端的数据」)。
- 要同时统计多个客户端,把它们的 id 写进 `~/.zcode/tps-monitor.config.json` 的 `providers` 数组(默认 `["zcode"]`,只增不删的字段);未安装的客户端会被自动跳过,单个源数据损坏不影响其余源。
- 多源聚合时(V2.5.0),token 速率查询的人类可读输出会按数据源分组给出各源速率(`各源速率:`块),`--json` 附 `perProvider` 字段;缺省单 zcode 时保持原格式。
- 数据全部来自本机文件,不联网;各客户端的数据来源与统计口径见 README「多 agent 支持」章节。

用户附加要求:$ARGUMENTS
