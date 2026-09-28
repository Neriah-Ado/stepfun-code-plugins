# zcode-tps-monitor

项目介绍、安装与使用说明见[仓库首页 README](../../README.md)。本文件面向插件内部结构与开发测试。

## 能力一览

| 形态 | 入口 | 说明 |
|---|---|---|
| 本轮即时速率 | `hooks/stop.mjs` | 回复刚结束(Stop 钩子)时按最新 `turn_id` 圈定本轮全部请求,经 `systemMessage` 直接显示本轮即时速率行;可经 `~/.zcode/tps-monitor.config.json`(`{"stopHookLine": false}`)停用并回到模型转发旧行为 |
| 上下文注入 | `hooks/prompt-submit.mjs` | 每轮对话读取 ZCode usage 数据库,注入上一轮速率作为模型上下文;`{"tokenRateLine": false}` 可关闭 |
| 会话提示 | `hooks/session-start.mjs` | 会话启动时记录会话 ID,并注入一行使用提示 |
| 多 agent 数据源 | `scripts/lib/providers/` | 统一 Provider 接口 + 五个内置数据源(zcode / claude-code / codex / opencode / cline);`providers` 配置默认 `["zcode"]`,此时行为与 V2.3.0 逐字节一致 |
| 多 agent 聚合展示 | `dashboard/` + `focusAgent` | V2.5.0:大屏数据源切换条 / 每源分组卡片(能力缺失显示「—」)/ 同轴对比曲线 + 会话切换器;悬浮条按 `focusAgent`(缺省 zcode)聚焦,托盘可切换;单源时新 UI 全部隐藏 |
| 自检 | `/tps-doctor`(`scripts/doctor.mjs`) | 检查 Node 版本、数据库与表结构、状态/配置文件、大屏进程、外观配置、多 agent 数据源与性能(perf 节:钩子耗时分布 / 超 50ms 预算次数 / 库文件大小 / 索引全表扫描);`--json` 可编程消费 |
| 实时大屏 | `dashboard/server.mjs` | 浏览器监控面板,**SSE 实时推送**(`GET /api/events`)取代定时轮询,空闲仅心跳:`/zcode-tps-monitor:dashboard` 拉起,或手动运行;液态玻璃外观可配置(`GET/POST /api/config`),右上角「⚙ 外观」抽屉即时保存 |
| 悬浮条 | `dashboard/overlay.ps1` | Windows 桌面常驻文字悬浮条;跟随 `appearance` 配置的字体/字号,玻璃强度 > 0 时尝试 Acrylic |
| 斜杠命令 | `/zcode-tps-monitor:tps` | 即时快照;`/zcode-tps-monitor:tps 10` 采样观察 10 秒 |
| 技能 | `zcode-tps-monitor` | 用户询问速率/TPS 相关问题时自动触发 |
| MCP 工具 | `tps_snapshot` / `tps_watch` | stdio MCP server(`mcp/tps-server.mjs`),供 agent 程序化取数 |

## 数据源

### Token 速率(真实,默认开启)

由钩子读取 ZCode usage 数据库(`model_usage` 表)计算,可手动验证:

```bash
node scripts/token-rate.mjs            # 人类可读
node scripts/token-rate.mjs --turn     # 本轮(刚结束轮次)即时速率
node scripts/token-rate.mjs --json     # JSON
node scripts/token-rate.mjs --agents   # 五个数据源的探测结果 / 格式 / 会话数 / 样本数
node scripts/token-rate.mjs --agent claude-code   # 只看单一数据源
node scripts/token-rate.mjs --session <id>        # 只看指定会话(优先于 ZCODE_SESSION_ID)
```

可设置 `ZCODE_SESSION_ID` 环境变量只统计当前会话(钩子已自动设置)。

数据库路径默认按用户主目录解析(`~/.zcode/cli/db/db.sqlite`,Windows 同理),可用 `ZCODE_USAGE_DB` 环境变量覆盖;以只读方式打开 WAL 库,不影响运行中的客户端。

### 多 agent 数据源(V2.4.0,`providers` 配置)

`~/.zcode/tps-monitor.config.json` 的 `providers` 数组决定启用哪些数据源,**只增不删**:不写时默认 `["zcode"]`,即只读 ZCode usage 库——速率行、`/tps`、大屏、MCP 输出与 V2.3.0 完全一致(只多一个 `provider` 字段)。

| ID | 数据位置(默认) | 格式 | turnRate | ttft | sessionScope |
|---|---|---|---|---|---|
| `zcode` | `~/.zcode/cli/db/db.sqlite` · `model_usage` | sqlite | ✅ | ✅ | ✅ |
| `claude-code` | `~/.claude/projects/**/*.jsonl` | jsonl | ✅ | ❌ | ✅ |
| `codex` | `~/.codex/sessions/**/rollout-*.jsonl` | jsonl | ✅ | ❌ | ✅ |
| `opencode` | `~/.local/share/opencode/storage/message/**/*.json` | json | ✅ | ❌ | ✅ |
| `cline` | `<编辑器 globalStorage>/…/tasks/*/api_conversation_history.json` | json | ✅ | ❌ | ✅ |

- 各源根目录可用 `TPS_CLAUDE_CODE_HOME` / `TPS_CODEX_HOME` / `TPS_OPENCODE_HOME` / `TPS_CLINE_HOME` 覆盖;`TPS_PROVIDERS`(逗号分隔)可整体覆盖启用列表,优先级低于配置文件。
- **能力降级**:四个第三方客户端均不记录首 token 时刻,`ttft` 一律为 `false`,`ttftMs` 恒为 `null`,显示为 `-`;不拿相邻请求时间差冒充首字延迟。
- **生成耗时口径不统一**(zcode 实测 `completed_at - first_token_at`;claude-code / cline 相邻请求差;codex `token_count` 事件间隔;opencode 客户端自记 `created`/`completed`),**跨源不可横向比较**。
- **故障隔离**:`collect-core.mjs` 的 `aggregateRate` 对每个源单独 try/catch,单源损坏只在 `sources` 里记失败原因;未安装的客户端在 `detect()` 阶段跳过。
- **聚合展示(V2.5.0)**:`/api/agents` 列出启用源与会话列表;SSE `agents` 事件在列表变化时推送;多源快照/事件附 `perProvider`;`/api/token-rate` 支持可选 `?agent=` / `?session=`(未知源 400)。
- **钩子热路径不读 JSONL**:Stop / prompt-submit 始终直连 zcode usage 库,不经聚合层——因此即使配满五个源,钩子输出与只用 zcode 时逐字节相同。
- 多源时按完成时刻降序合并(并列按 `providers` 声明顺序,保证可复现),窗口与累计统计跨源求和;`sources` / `agents` 明细只在该字段出现于多源结果中。

### 业务 TPS(demo / remote)

- **demo(默认)**:内置模拟数据(随机游走,数值连续逼真),开箱即可看到效果。
- **remote(真实)**:在 **设置 → 插件管理 → zcode-tps-monitor** 中配置 `metrics_url`,
  指向任何返回 JSON 的指标接口。字段兼容(支持最多三层嵌套):
  - 吞吐:`tps` / `qps` / `throughput` / `transactionsPerSecond`
  - 延迟:`p50` / `p95` / `p99`(或 `latency_p50` 等)
  - 错误率:`error_rate` / `errorRate` / `err_rate`

  例:`{"data":{"tps":1240,"p50":11,"p95":28,"p99":46,"error_rate":0.05}}`

## 外观配置

`~/.zcode/tps-monitor.config.json` 新增 `appearance` 节(与 `stopHookLine` / `tokenRateLine` 同级,只增不删,旧配置无此节时行为不变):

| 字段 | 取值 | 默认 |
|---|---|---|
| `theme` | `dark` / `light` / `system` | `dark` |
| `fontFamily` | CSS 字体栈 | `Segoe UI, Microsoft YaHei, system-ui, sans-serif` |
| `monoFont` | CSS 字体栈 | `Cascadia Mono, Consolas, monospace` |
| `fontSize` | 8–24 | `16` |
| `fontScale` | 0.8–1.5 | `1` |
| `accentColor` | `#hex` / `rgb(a)` / `hsl(a)` / 常用色名 | `#4da3ff` |
| `glassIntensity` | 0–1(0 = 关闭液态玻璃,恢复纯色面板) | `0.6` |
| `fontUrl` | `http(s)://` / `file://`(可选 Web 字体,失败静默回退) | 空 |

- 读写共用 `scripts/lib/config.mjs`(零依赖):数值越界夹紧,非法值整条拒绝且不落盘,损坏 JSON 抛修复提示。
- HTTP 接口:`GET /api/config`(当前外观 + 配置路径)、`POST /api/config`(`{"appearance": {…}}` 合并写入,非法字段 400 + `fieldErrors`)。
- 大屏页内「⚙ 外观」抽屉可可视化管理同一配置;doctor 新增外观配置自检项。

## 实时推送与性能

- **SSE**:`GET /api/events`(`text/event-stream`,纯 `node:http`)。连接建立先推全量 `snapshot`,之后只推 `token` / `history-append` / `sys`(5s)三类增量事件;每 15s 一条心跳注释行,断线按 `retry: 2000` 自动重连并重推全量。空闲时通道上只有心跳,页面无任何周期性请求。
- **REST 保留**:`/api/token-rate`、`/api/metrics` 行为不变(第三方与不支持 EventSource 的浏览器自动回退轮询)。
- **渲染**:canvas 仅在收到新样本或 resize 时重绘(以最后样本时间戳做脏标记,DPR × 尺寸一致则复用缓冲);文本节点写入前比对 `textContent`,值不变不写。
- **数据**:`scripts/lib/usage-db.mjs` 按 SQL 文本缓存 `StatementSync`,Stop 钩子 5 次重试复用同一只读连接;`SUGGESTED_INDEXES` + `indexHints()` 给出建议索引与全表扫描自检。
- **钩子预算**:`scripts/lib/perf-log.mjs` 对单次 DB 读取计时,写入 `~/.zcode/tps-monitor.perf.log`,超 50ms 标记 `overBudget`(写失败静默);doctor `--json` 的 `perf` 节呈现分布与超支次数。

实测:空闲大屏周期性轮询请求 0;稳态增量包 < 1KB;2 万行 usage 库 `queryTurn` P95 ≈ 5ms;建议索引使全表扫描 6 → 0;悬浮条 2s 轮询。

## 开发与测试

```bash
# 实时大屏(默认 http://127.0.0.1:7423;空闲 180 分钟自退,--idle-exit 0 关闭)
node dashboard/server.mjs
node dashboard/server.mjs --port 8080
node dashboard/server.mjs --idle-exit 30
TPS_URL=http://host/metrics node dashboard/server.mjs   # 接真实数据源

# 自检
node scripts/doctor.mjs             # 人类可读(❌ 项给出修复建议)
node scripts/doctor.mjs --json      # JSON,失败时退出码 1

# 业务 TPS 采集 CLI
node scripts/collect.mjs            # 人类可读快照
node scripts/collect.mjs --json     # JSON
node scripts/collect.mjs --watch 5  # 采样 5 秒

# 单元测试(仓库根目录;临时库夹具,不读真实数据)
node --test
```

```bash
# MCP server 冒烟
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"manual","version":"0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node mcp/tps-server.mjs
```
## 目录结构

```
zcode-tps-monitor/
├── .zcode-plugin/plugin.json   # 插件清单(name / userConfig)
├── .claude-plugin/plugin.json  # 兼容清单
├── .mcp.json                   # MCP server 注册(${ZCODE_PLUGIN_ROOT})
├── commands/tps.md             # /zcode-tps-monitor:tps
├── commands/dashboard.md       # /zcode-tps-monitor:dashboard
├── commands/tps-doctor.md      # /zcode-tps-monitor:tps-doctor
├── skills/zcode-tps-monitor/SKILL.md  # 自动触发技能
├── hooks/hooks.json            # 钩子注册(SessionStart + UserPromptSubmit + Stop)
├── hooks/session-start.mjs     # 会话启动:记录会话 ID + 使用提示
├── hooks/prompt-submit.mjs     # 每轮:注入上一轮速率作模型上下文
├── hooks/stop.mjs              # 回复结束:按 turn_id 圈定本轮,systemMessage 显示即时速率
├── mcp/tps-server.mjs          # stdio MCP server
├── dashboard/
│   ├── server.mjs              # HTTP 服务(页面 + /api/metrics + /api/config + /api/events SSE)
│   ├── index.html              # 大屏布局(EventSource 局部更新 + canvas 脏标记 + CSS 变量主题 + 液态玻璃 + 外观抽屉)
│   └── overlay.ps1             # Windows 悬浮条(2s 轮询,跟随 appearance 配置)
├── scripts/
│   ├── token-rate.mjs          # token 速率 CLI(人类可读 / --json / --turn / --agent / --session / --agents)
│   ├── collect.mjs             # 业务 TPS CLI 入口
│   ├── doctor.mjs              # 自检(人类可读 / --json,含外观配置、多 agent 数据源与 perf 节)
│   ├── lib/collect-core.mjs    # 采集核心(CLI/MCP 共用,零依赖;aggregateRate/aggregateTurn/agentStatus 聚合层)
│   ├── lib/config.mjs          # appearance / providers 配置读写与校验(大屏/doctor 共用,零依赖)
│   ├── lib/usage-db.mjs        # usage 库只读访问层(预编译语句 + 索引自检,零依赖)
│   ├── lib/perf-log.mjs        # 钩子耗时诊断日志(零依赖)
│   ├── lib/providers/          # 多 agent 数据源(V2.4.0,零依赖)
│   │   ├── index.mjs           # 注册表:ID / 别名 / 能力矩阵 / 归一化 / 按配置取源
│   │   ├── common.mjs          # 归一化与视图构建(速率公式与 usage-db 同源)
│   │   ├── zcode.mjs           # ~/.zcode/cli/db/db.sqlite(V2.3.0 逻辑原样迁入)
│   │   ├── claude-code.mjs     # ~/.claude/projects/**/*.jsonl
│   │   ├── codex.mjs           # ~/.codex/sessions/(无 TTFT,能力降级)
│   │   ├── opencode.mjs        # opencode storage/message 本地存储
│   │   └── cline.mjs           # Cline 任务目录 api_conversation_history.json
│   └── lib/sse.mjs             # SSE 线格式(事件 / 心跳 / retry,零依赖)
└── docs/
    └── effect-token-rate.png   # 效果截图
```

## 修改后生效

在 **设置 → 插件管理** 中重新安装/刷新插件,并重开会话使钩子重新注册。要求 Node ≥ 22.5(需内置 `node:sqlite`)。

## License

[AGPL-3.0-only](../../LICENSE) · 上游 MIT 文本见 [LICENSE-MIT](../../LICENSE-MIT)
