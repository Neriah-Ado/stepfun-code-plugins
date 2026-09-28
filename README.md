<img src="assets/icon.png" align="right" width="96" alt="zcode-tps-monitor 图标">

# stepfun-usage-monitor — ZCode Token 速率监控（zcode-tps-monitor）

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A5%2022.5-brightgreen)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)
![Tests](https://img.shields.io/badge/tests-88%20pass-brightgreen)

**V2.5.0**：本仓库不再是 v1.x 的「StepFun API 用量本地监控代理」，而是参照 [shy3130/zcode-tps-monitor](https://github.com/shy3130/zcode-tps-monitor) 重写的 **ZCode 会话级 Token 速率监控插件**。每轮回复结束的瞬间自动显示**本轮即时 tok/s**——数据直读 ZCode usage 数据库与其他客户端工具的本地会话记录，非模型自述、非估算；另附实时监控大屏、斜杠命令、MCP 工具与可选的业务 TPS 监控。

| 版本 | 里程碑 |
|---|---|
| V2.1.0 | **外观自定义 + 液态玻璃**——主题 / 字体 / 字号 / 主题色 / 玻璃强度，大屏设置抽屉即时生效 |
| V2.2.0 | **性能优化**——SSE 实时推送（空闲零轮询）、canvas 脏标记重绘、预编译语句与索引自检、钩子耗时诊断 |
| V2.3.0 | **Electron 桌面客户端**——主窗口 + 透明悬浮条 + 托盘 + 开机自启 + 自动更新，三平台打包（独立分发物，不进插件市场） |
| V2.4.0 | **多 agent 数据层**——Claude Code / Codex / OpenCode / Cline 经统一 Provider 接口接入聚合 |
| V2.5.0 | **多 agent 聚合展示**——大屏切换条 / 分组卡片 / 同轴对比曲线 / 会话聚焦，悬浮条 `focusAgent`（默认仍只读 ZCode，新 UI 仅在多源时出现） |

> **从 v1.x 升级**：v1.x（≤ 1.5.11）通过本地反向代理（`127.0.0.1:8787`）统计 API 用量，需改客户端 Base URL。V2.0.0 起直读 ZCode 自身 usage 数据库——**无需改任何客户端配置，装上即用**。v1.x 代码在 git 历史中（tag `v1.5.10`）。

> **[English README](README.en.md)** · 本文档为中文版 · 插件内部结构与开发说明见 [plugins/zcode-tps-monitor/README.md](plugins/zcode-tps-monitor/README.md) · 各版本双语 Release Notes 见 [docs/releases/](docs/releases/)

本仓库同时是一个 ZCode 本地插件市场（marketplace 名称：`tps-local-marketplace`），插件本体位于 [`plugins/zcode-tps-monitor/`](plugins/zcode-tps-monitor/)。

## ✨ 功能特性

- **本轮即时速率行（默认开启）** —— 每轮回复结束的瞬间（Stop 钩子）自动显示一行指标：本轮即时 tok/s、首 token 延迟（TTFT）、输出 token 数、纯生成耗时、请求段数 / 单段峰值、最近数轮滑动平均、会话累计与采样时刻。多段工具调用的长轮次按「总产出 / 总纯生成时长」加权，段间等待不计入。
- **实时监控大屏** —— `/dashboard` 一键拉起；**SSE 实时推送**取代定时轮询，新样本到达即刷新，空闲时通道上只有心跳；空闲 3 小时自动退出。默认液态玻璃质感，可整体关闭。
- **外观自定义** —— 主题（深 / 浅 / 跟随系统）、界面与数字字体、基准字号、整体缩放、主题色、玻璃强度；大屏「⚙ 外观」抽屉即时保存即时生效，同一份配置驱动 Windows 悬浮条与 Electron 客户端。
- **多 agent 聚合展示（V2.5.0）** —— 数据源切换条、每源分组卡片（能力缺失显示「—」）、同轴对比曲线（图例标注实测 / 估算口径）、每源会话切换器；悬浮条按 `focusAgent` 聚焦。单源时全部隐藏。
- **斜杠命令** —— `/tps` 即时快照；`/tps 10` 采样观察 10 秒（2–30 秒）；`/tps-doctor` 环境自检逐项排查。
- **MCP 工具** —— `tps_snapshot` / `tps_watch`，供 agent 程序化取数。
- **Electron 桌面客户端（可选）** —— 仪表盘主窗口、透明置顶悬浮条、托盘（含聚焦数据源子菜单）、开机自启与自动更新；与浏览器大屏共用同一份页面与配置。
- **业务 TPS 监控（可选）** —— 配置 `metrics_url` 接入真实业务指标接口；未配置时使用内置演示数据。与 Token 速率相互独立。
- **低开销** —— 钩子一次只读连接完成查询（预编译语句，单次预算 50ms，超支可被 `/tps-doctor` 检出）；canvas 仅在新样本或窗口变化时重绘；悬浮条 2s 轮询、无变化跳过更新。

## 🏗 技术架构

### 总览

```
                    ┌─────────────────────────────────────────────┐
                    │              展示层（三种同构形态）              │
                    │                                             │
                    │  浏览器大屏 index.html  ⇄  Electron 主窗口     │
                    │      ▲ SSE/REST                （同一份页面）  │
                    │      │                          ▲ IPC        │
                    │  Windows overlay.ps1 ──REST──┐  Electron 悬浮条│
                    └──────────────────────────────┼──────────────┘
                                                   │
┌──────────────────────────────────────────────────▼─────────────────────────┐
│  通信层   SSE /api/events（snapshot / token / history-append / sys / agents）│
│           REST /api/token-rate · /api/metrics · /api/config · /api/agents   │
│           MCP stdio（tps_snapshot / tps_watch） · 斜杠命令 · token-rate CLI  │
└──────────────────────────────────────────────────┬─────────────────────────┘
                                                   │ tokenRateQuery
┌──────────────────────────────────────────────────▼─────────────────────────┐
│  聚合层  collect-core.mjs：aggregateRate / aggregateTurn / agentStatus      │
│          单源 zcode → 原路径直连（isFastPath，零额外开销）                      │
│          多源 → 各自归一化 → 按完成时刻合并（逐源故障隔离）                       │
└──────┬───────────────┬───────────────┬───────────────┬─────────────┬──────┘
       │ Provider 接口  │               │               │             │
┌──────▼─────┐  ┌──────▼─────┐  ┌──────▼─────┐  ┌──────▼─────┐  ┌────▼───────┐
│   zcode    │  │claude-code │  │   codex    │  │  opencode  │  │   cline    │
│ db.sqlite  │  │   *.jsonl  │  │   *.jsonl  │  │  *.json    │  │   *.json   │
└────────────┘  └────────────┘  └────────────┘  └────────────┘  └────────────┘
        ▲ 只读本地文件，不联网、无遥测
        │
┌───────┴────────────────────────────────────────────────────────────────────┐
│  钩子热路径（固定直连 zcode usage 库，不经聚合层、不读 JSONL）                    │
│  SessionStart（记录会话）· UserPromptSubmit（注入上一轮）· Stop（本轮即时速率行）  │
└────────────────────────────────────────────────────────────────────────────┘
```

### 分层职责

| 层 | 位置 | 职责 |
|---|---|---|
| 数据层 | `scripts/lib/providers/` + `lib/usage-db.mjs` | 每个客户端工具一个 Provider，实现 `detect()` / `listSessions()` / `currentSessionId()` / `getUsage()`；把上游字段名差异（`output_tokens` / `outputTokens` / `tokensOut` / `completion_tokens`…）归一化为统一记录 |
| 聚合层 | `scripts/lib/collect-core.mjs` | `aggregateRate` / `aggregateTurn` / `agentStatus`：按 `providers` 配置采集、归一化、按完成时刻合并，构建窗口 / 会话 / 本轮视图；逐源 try/catch 故障隔离 |
| 通信层 | `dashboard/server-core.mjs`、`mcp/tps-server.mjs`、`scripts/token-rate.mjs` | SSE 增量推送、REST 端点、stdio MCP、CLI；一条采集 tick 读一次库扇出给全部 SSE 客户端 |
| 展示层 | `dashboard/index.html`、`electron/`、`dashboard/overlay.ps1` | 浏览器大屏（液态玻璃 + 外观抽屉 + 多 agent 展示）、Electron 主窗口 / 悬浮条 / 托盘、Windows 文字悬浮条 |
| 命令层 | `hooks/`、`commands/` | 三个钩子承载零滞后的速率行；`/tps`、`/tps-doctor`、`/dashboard` 斜杠命令 |

### 数据源与能力矩阵

| ID | 客户端 | 数据位置（默认） | 格式 | 速率 | TTFT | 会话维度 |
|---|---|---|---|---|---|---|
| `zcode` | ZCode | `~/.zcode/cli/db/db.sqlite` · `model_usage` 表 | sqlite | ✅ | ✅ | ✅ |
| `claude-code` | Claude Code | `~/.claude/projects/**/*.jsonl` | jsonl | ✅ | ❌ | ✅ |
| `codex` | Codex CLI | `~/.codex/sessions/**/rollout-*.jsonl` | jsonl | ✅ | ❌ | ✅ |
| `opencode` | OpenCode | `~/.local/share/opencode/storage/message/**/*.json` | json | ✅ | ❌ | ✅ |
| `cline` | Cline | `<编辑器 globalStorage>/…/tasks/*/api_conversation_history.json` | json | ✅ | ❌ | ✅ |

- 各源数据根目录可用环境变量覆盖（`TPS_CLAUDE_CODE_HOME` / `TPS_CODEX_HOME` / `TPS_OPENCODE_HOME` / `TPS_CLINE_HOME`），默认取各客户端官方位置；`ZCODE_USAGE_DB` 沿用既有语义。
- Provider 声明 `capabilities`（`turnRate` / `ttft` / `sessionScope`），UI 与命令按能力降级——**不记录的字段显示「—」，绝不编数字**。

### 目录结构

```
marketplace.json                      市场清单（tps-local-marketplace → plugins/zcode-tps-monitor）
package.json                          Electron 桌面客户端工作区清单（独立分发物，不进市场）
electron-builder.yml                  三平台打包配置（nsis / dmg / AppImage + GitHub Releases 发布）
.github/workflows/release.yml         标签触发的三平台构建流水线（先跑 node --test）
electron/                             Electron 桌面客户端（与插件核心隔离）
├─ main.mjs                           主进程：窗口 / 托盘(含聚焦数据源子菜单) / 开机自启 / 自动更新 / IPC
├─ preload.cjs                        预加载：contextBridge + 通道白名单
├─ renderer/overlay.html              悬浮条渲染层（透明 / 可拖 / 悬停展开 / 来源标签）
├─ lib/                               纯逻辑：overlay-payload / collect-loop / state-store
└─ build/make-icons.mjs               纯 Node 生成 ICO / ICNS / PNG 图标
plugins/zcode-tps-monitor/
├─ .zcode-plugin/plugin.json          插件清单（V2.5.0，含 userConfig.metrics_url）
├─ .claude-plugin/plugin.json         Claude 兼容清单（同版本）
├─ .mcp.json                          stdio MCP 服务器定义（tps_snapshot / tps_watch）
├─ commands/                          /tps · /tps-doctor · /dashboard
├─ skills/zcode-tps-monitor/SKILL.md  技能：用户问速率/TPS 相关问题时自动触发
├─ hooks/                             钩子热路径（固定直连 zcode usage 库）
│  ├─ hooks.json                      SessionStart / UserPromptSubmit / Stop 注册
│  ├─ session-start.mjs               会话提示
│  ├─ prompt-submit.mjs               上一轮速率注入上下文
│  └─ stop.mjs                        本轮即时速率行
├─ scripts/
│  ├─ collect.mjs                     业务 TPS 采集（--watch N 采样观察）
│  ├─ token-rate.mjs                  Token 速率 CLI（--turn / --json / --agent / --session / --agents）
│  ├─ doctor.mjs                      环境自检（--json 可编程消费，含 perf 与多 agent 数据源节）
│  ├─ lib/collect-core.mjs            聚合层（aggregateRate / aggregateTurn / agentStatus）
│  ├─ lib/config.mjs                  appearance / providers / focusAgent 配置读写与校验
│  ├─ lib/usage-db.mjs                usage 库只读访问层（预编译语句 + 索引自检）
│  ├─ lib/perf-log.mjs                钩子耗时诊断日志（~/.zcode/tps-monitor.perf.log）
│  ├─ lib/providers/                  多 agent 数据源（零依赖纯 Node）
│  │  ├─ index.mjs                    注册表：ID / 别名 / 能力矩阵 / 归一化 / 按配置取源
│  │  ├─ common.mjs                   归一化与视图构建（速率公式与 usage-db 同源）
│  │  ├─ zcode.mjs / claude-code.mjs / codex.mjs / opencode.mjs / cline.mjs
│  └─ lib/sse.mjs                     SSE 线格式（事件 / 心跳 / retry）
├─ dashboard/
│  ├─ server.mjs                      实时大屏服务（默认 127.0.0.1:7423，空闲 3h 自动退出）
│  ├─ server-core.mjs                 大屏服务工厂（Electron 主进程以随机端口复用；SSE/REST/agents）
│  ├─ index.html                      大屏页面（EventSource 局部更新 + canvas 脏标记 + 液态玻璃 + 外观抽屉 + 多 agent 展示）
│  └─ overlay.ps1                     Windows 桌面悬浮条（2s 轮询，focusAgent 聚焦；无 Electron 时的轻量替代）
└─ docs/effect-token-rate.png         速率行效果图

test/                                 node --test 六个文件共 88 条（token-rate / config / perf / desktop / providers / aggregate-view）
docs/releases/                        各版本双语 Release Notes（中文 + English）
assets/                               仓库图标（node assets/generate-icon.mjs 可再生成）
```

## ⚙️ 工作原理

### 速率计算：一条公式

```
单段请求   tok/s = (输出 token + 思考 token) ÷ 纯生成耗时 × 1000
           纯生成耗时(zcode 实测) = completed_at − first_token_at
           有效样本区间 [200ms, 1h)（TOKEN_RATE_MIN_MS / TOKEN_RATE_MAX_MS 可调），
           区间外只计入会话累计、不产速率
多段轮次   rate = Σ(输出+思考) ÷ Σ纯生成耗时 —— 段间工具等待不计入（Stop 钩子）
窗口统计   近 N 次均/峰，N = TOKEN_RATE_WINDOW（默认 5）；会话累计不受窗口限制
```

全部数字来自客户端落盘的真实 token 累计值（输出侧口径，含思考 token），不经过模型转述。多段工具调用的长轮次按总产出 / 总纯生成时长加权，因此段间等待（工具执行、人工操作）天然不计入。

### 钩子时序：为什么零滞后

```
t0  用户发送消息 ─▶ UserPromptSubmit 钩子
    │  毫秒级读库；此刻本轮尚未发生，只注入「上一轮」速率作模型上下文（纯上下文，禁止引用展示）
t1  模型开始出字……工具调用 × N 段，每段一条请求陆续写入 usage 库
t2  回复结束 ─▶ Stop 钩子
    │  按最新 turn_id 精确圈定本轮全部请求（一次用户消息触发的所有段），
    │  短重试(5×250ms)等待末条落库，计算「总产出 / 总纯生成时长」，
    │  经 systemMessage 由客户端直接显示 —— 无需模型转发，天然零滞后
```

- **SessionStart**：记录当前会话 ID 并注入一行使用提示。
- **钩子热路径隔离**：三个钩子固定直连 zcode usage 库（预编译语句、单次只读连接、50ms 预算），**不经聚合层、不读 JSONL**——即使配满五个数据源，钩子输出与只用 zcode 时逐字节相同（有专项测试守着）。
- 钩子把"最后所处会话"写入状态文件，大屏 / Electron 据此跟随当前会话。

### 多源聚合：归一化 → 合并 → 降级 → 隔离

1. **归一化**：每个 Provider 把上游记录转成统一形状（`tokens / 时间 / 模型 / turnKey` 四类字段），字段名差异全部收口在 Provider 内部。
2. **合并**：多源时各记录按完成时刻倒序合并（同刻并列按 `providers` 声明顺序，保证可复现），再走与单源相同的窗口 / 会话统计构造；窗口与累计统计跨源求和。
3. **能力降级**：第三方源没有首 token 时刻，TTFT 显示 `-` / 「—」（`ttftMs` 为 `null`），**不拿相邻请求时间差冒充首字延迟**。生成耗时口径各家不同（见下表），**跨源横向不可比**：

   | 数据源 | 生成耗时口径 | 说明 |
   |---|---|---|
   | `zcode` | `completed_at - first_token_at` | 实测值 |
   | `claude-code` | 相邻请求时间差 | 超过 120s 视为夹了人工思考，判无效 |
   | `codex` | `token_count` 事件间隔 | 旧版只给累计值时按差分求增量，累计回退自动识别 reset |
   | `opencode` | 客户端自记的 `created` / `completed` | 最接近实测 |
   | `cline` | 相邻条目差 | 与任意条目比对，不限有用例的条目 |

4. **故障隔离**：任一源数据损坏或格式变更，只影响该源自己（`sources` 明细里记一条失败原因），其余源照常出数；未安装的客户端在探测阶段跳过，读都不读。JSONL 解析带单行故障隔离，单源最多读取 2 万条记录，坏行只跳过自己。
5. **单源快路径**：`providers` 为 `["zcode"]`（默认）时走 `isFastPath` 直连原代码路径，结果与 V2.3.0 逐字节一致（只多一个 `provider` 字段）——多 agent 能力开启才引入多源开销。

### 实时推送：SSE 增量协议

| 事件 | 载荷 | 时机 |
|---|---|---|
| `snapshot` | token 全量（含历史）+ 系统指标 + `perProvider`（多源） | 连接建立 / 断线重连 |
| `token` | latest / session + `provider` / `sessionId` + `perProvider`（多源） | 新样本入库 |
| `history-append` | 单条历史增量（多源时带 `provider` 字段） | 新样本入库 |
| `sys` | CPU / 内存 / 运行时长 | 每 5s |
| `agents` | 启用清单 + 逐源探测 + 会话列表 | 数据源列表变化；多源连接建立 |

- 纯 `node:http` 实现（零依赖）；每 15s 一条心跳注释行，断线按 `retry: 2000` 自动重连并重推全量快照。
- **空闲零轮询**：无数据变化时通道上只有心跳（零数据载荷），页面不存在任何周期性请求；服务端一条 1s 采集 tick 只读一次库并扇出。
- 渲染按事件类型局部更新：canvas 以最后样本时间戳做脏标记（DPR × 尺寸缓存），文本节点值不变不写 DOM。
- REST 端点保留（`/api/token-rate`、`/api/metrics`），供第三方脚本与不支持 EventSource 的浏览器回退轮询。

### 性能预算与自检

| 指标 | 数值 |
|---|---|
| 钩子单次 DB 读取预算 | 50ms（P95 实测 ≈ 5ms @ 2 万行） |
| 空闲大屏周期性轮询请求 | 0（仅 15s 心跳注释行） |
| 稳态增量包 | < 1KB |
| 建议索引效果 | 全表扫描 6 → 0 |
| 系统指标推送间隔 | 5s |
| 悬浮条轮询间隔 | 2s（无变化跳过 WPF 元素更新） |

钩子每次读库计时写入 `~/.zcode/tps-monitor.perf.log`；`/tps-doctor --json` 的 `perf` 节呈现耗时分布 / 超预算次数 / 库文件大小 / 全表扫描提示，并给出建议索引（插件只读连接，不会代建索引）：

```sql
CREATE INDEX IF NOT EXISTS idx_model_usage_session_completed ON model_usage(session_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_usage_status_completed ON model_usage(status, completed_at DESC);
```

## 效果预览

每轮回复结束时自动显示一行速率指标，无需任何手动操作：

![token 速率行效果](plugins/zcode-tps-monitor/docs/effect-token-rate.png)

| 字段 | 含义 |
|---|---|
| `537.3 tok/s` | 本轮即时输出速率（含思考 token；多段轮次为加权速率） |
| `首字 3.0s` | 首 token 延迟（TTFT，本轮第一段） |
| `输出 223 tok / 生成 0.4s` | 本轮输出 token 数与纯生成耗时（不含段间工具等待） |
| `2 段 / 峰 537.3` | 本轮的请求段数与单段峰值速率（多段轮次才显示） |
| `近3次均 494.9` | 最近数轮滑动平均 |
| `累计 51.3k tok` | 当前会话累计输出（独立统计，不受窗口限制） |
| `⏱ 10:23:04` | 采样时刻（回复结束时间） |

数字显示规则：每轮「输出」用千分位精确数字（如 `2,762 tok`）；「累计」用紧凑单位——千以下原始、1k~1万一位小数（`9.8k`）、1万~100万取整（`51k`）、百万以上一位小数 M（`73.8M`）。

## 📦 安装

**前置要求**：Node.js ≥ 22.5（需内置 `node:sqlite`；Windows / macOS / Linux 相同）。

### 方式一：从 GitHub 添加市场（推荐）

在 ZCode 中执行：

```text
/plugin marketplace add Neriah-Ado/stepfun-usage-monitor
/plugin install zcode-tps-monitor@tps-local-marketplace
```

安装后**重开会话**使钩子重新注册，之后每轮回复结束即自动显示速率。

### 方式二：本地目录

克隆本仓库后，在 ZCode 中打开 **设置 → 插件管理 → 发现 → +**，来源选择「本地目录」，指向仓库根目录即可。

### 方式三：只用手脚本 / 大屏（不装插件）

```bash
git clone https://github.com/Neriah-Ado/stepfun-usage-monitor.git
cd stepfun-usage-monitor/plugins/zcode-tps-monitor

node scripts/token-rate.mjs            # 当前速率（人类可读）
node scripts/token-rate.mjs --turn     # 本轮（刚结束轮次）即时速率
node scripts/token-rate.mjs --json     # JSON 输出
node scripts/doctor.mjs                # 环境自检
node dashboard/server.mjs              # 实时大屏（默认 127.0.0.1:7423）
```

### 更新

```text
/plugin marketplace update tps-local-marketplace
```

更新后重装/升级插件，并重开会话使钩子重新注册。

### 桌面客户端（Electron，可选）

插件本体之外的**独立分发物**（不属于插件市场，装不装都不影响插件功能），复用插件的采集核心、大屏服务与同一份外观配置：

- **直接下载**：到 [Releases](https://github.com/Neriah-Ado/stepfun-usage-monitor/releases) 下载对应平台安装包——Windows NSIS（`Setup.exe`，另有 x64+arm64 合并包）/ portable、macOS dmg、Linux AppImage（均含 x64 + arm64）。安装版支持 `electron-updater` 自动更新。
- **开发运行**：

  ```bash
  git clone https://github.com/Neriah-Ado/stepfun-usage-monitor.git
  cd stepfun-usage-monitor
  npm install
  npm run dev            # 启动 Electron(首次运行会下载 Electron 二进制)
  ```

- **本地构建**：

  ```bash
  npm run icons          # 重新生成图标(纯 Node,无需图片处理依赖)
  npm run dist:win       # Windows:NSIS 安装包(x64/arm64)+ portable(x64)
  npm run dist:mac       # macOS:dmg(x64/arm64)
  npm run dist:linux     # Linux:AppImage(x64/arm64)
  ```

  推送 `v*` 标签时 `.github/workflows/release.yml` 会自动跑完单测并构建三平台产物，上传为 GitHub Release 附件。

**界面与操作**：

| 元素 | 行为 |
|---|---|
| 主窗口 | 加载与浏览器**同一份**大屏页面；尺寸 / 位置 / 置顶状态记忆；**关闭 = 最小化到托盘**，进程不退 |
| 页头「📌」 | 切换主窗口置顶 |
| 页头「▣」 | 显示 / 隐藏悬浮条 |
| 悬浮条 | 透明无边框置顶小窗，显示当前 tok/s；整条可拖拽；悬停展开 TTFT / 近 N 次均 / 累计 token 与迷你曲线 |
| 悬浮条「📌」 | 点击穿透开关：开启后点击落到下层窗口，悬停展开仍可用 |
| 托盘菜单 | 显示/隐藏悬浮条、打开仪表盘、**聚焦数据源（V2.5.0 子菜单）**、主窗口置顶、悬浮条点击穿透、开机自启、退出 |

> **体积说明**：安装包含完整 Electron 运行时，属百 MB 量级。只想要 Windows 上的一枚悬浮条、不想装 Electron 的话，`dashboard/overlay.ps1` 仍是零安装单文件选择。

> **依赖隔离**：`electron` / `electron-builder` / `electron-updater` 全部集中在**工作区级根 `package.json`**，Electron 代码全部在 `electron/` 目录内；插件目录零 npm 依赖、行为零改动，`node --test` 有专门断言守着这条线。

## 📖 使用

### 场景速查

| 场景 | 操作 |
|---|---|
| 查看每轮速率 | 无需操作，每轮回复结束时自动显示本轮即时速率 |
| 即时快照 | 输入 `/tps`；或 `/tps 10` 持续采样 10 秒 |
| 打开监控大屏 | 输入 `/dashboard`，或手动 `node dashboard/server.mjs` |
| 环境自检 | 速率行不见了？输入 `/tps-doctor` 逐项排查 |
| 多 agent 展示 | 配置 `providers` 后大屏出现切换条 / 分组卡片 / 对比视图（见「配置」） |
| 悬浮条换数据源 | Electron 托盘「聚焦数据源」子菜单；或配置 `focusAgent` |
| 关闭本轮即时行 | `~/.zcode/tps-monitor.config.json` 写入 `{"stopHookLine": false}`，重开会话生效 |
| 关闭全部速率注入 | 同文件写入 `{"tokenRateLine": false}`，重开会话生效 |
| 改大屏外观 | 大屏右上角「⚙ 外观」抽屉；或直接编辑配置文件的 `appearance` 节 |
| Windows 文字悬浮条 | 运行 `dashboard/overlay.ps1`；跨平台请用 Electron 桌面客户端 |
| agent 取数 | MCP 工具 `tps_snapshot` / `tps_watch` |

命令带插件名前缀的等价写法：`/zcode-tps-monitor:tps`、`/zcode-tps-monitor:tps-doctor`、`/zcode-tps-monitor:dashboard`。

### 命令行（token-rate CLI）

```bash
node scripts/token-rate.mjs                    # 聚合快照(人类可读;多源时附「各源速率」分组)
node scripts/token-rate.mjs --turn             # 本轮(刚结束轮次)即时速率
node scripts/token-rate.mjs --json             # JSON(多源时附 perProvider)
node scripts/token-rate.mjs --agent claude-code   # 圈定单一数据源(无 TTFT 字段自动降级)
node scripts/token-rate.mjs --session <id>     # 圈定会话(优先于 ZCODE_SESSION_ID 环境变量)
node scripts/token-rate.mjs --agents           # 各源探测结果 / 格式 / 会话数 / 样本数
```

### MCP 工具

- `tps_snapshot`：即时快照（速率 / TTFT / 累计；多源时附 `provider` / `sessionId` / `sources` / `agents`）。
- `tps_watch`：采样观察 2–30 秒，返回平均 / 峰值。

## 🔧 配置

全部配置集中在 `~/.zcode/tps-monitor.config.json`，**字段只增不删**——旧配置缺任何字段都按默认值工作：

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `stopHookLine` | bool | 开 | Stop 钩子速率行开关 |
| `tokenRateLine` | bool | 开 | 速率注入总开关 |
| `providers` | string[] | `["zcode"]` | 启用的数据源（见下） |
| `focusAgent` | string | `"zcode"` | 悬浮条聚焦数据源（`"all"` = 聚合；Electron 托盘可切换） |
| `appearance` | object | 见下 | 大屏外观（大屏 / 悬浮条 / Electron 三端互通） |

### 外观自定义（appearance）

```json
{
  "appearance": {
    "theme": "dark",
    "fontFamily": "Segoe UI, Microsoft YaHei, system-ui, sans-serif",
    "monoFont": "Cascadia Mono, Consolas, monospace",
    "fontSize": 16,
    "fontScale": 1,
    "accentColor": "#4da3ff",
    "glassIntensity": 0.6,
    "fontUrl": ""
  }
}
```

| 字段 | 取值 | 默认 | 说明 |
|---|---|---|---|
| `theme` | `dark` / `light` / `system` | `dark` | `system` 跟随系统深浅色偏好 |
| `fontFamily` | CSS 字体栈 | `Segoe UI, Microsoft YaHei, system-ui, sans-serif` | 界面字体 |
| `monoFont` | CSS 字体栈 | `Cascadia Mono, Consolas, monospace` | 数字 / 时钟字体 |
| `fontSize` | 12–24 | `16` | 基准字号（px） |
| `fontScale` | 0.8–1.6 | `1` | 整体缩放倍率（根字号 = fontSize × fontScale） |
| `accentColor` | `#hex` / `rgb(a)` / `hsl(a)` / 常用色名 | `#4da3ff` | 主题色（曲线、按钮、高亮） |
| `glassIntensity` | 0–1 | `0.6` | 液态玻璃强度；`0` 完全关闭，恢复纯色面板 |
| `fontUrl` | `http(s)://` / `file://` | 空 | 可选 Web 字体，加载失败静默回退系统字体 |

- 数值越界自动夹紧到合法区间；非法值（注入字符、非法颜色 / 协议）整条写入被拒绝，不影响已存配置；配置文件损坏时给出修复提示，不静默覆盖。
- 更方便的方式：大屏右上角「⚙ 外观」抽屉内调整并保存，即时生效。
- 悬浮条 `overlay.ps1` 读取同一配置（玻璃强度 > 0 时尝试 Acrylic 背景，失败自动回退原形态）；Electron 悬浮条与主窗口读取的也是这一份配置。

### 多 agent 数据源（providers）

| 写法 | 含义 |
|---|---|
| 不写 / `["zcode"]` | 只读 ZCode，与 V2.3.0 逐字节一致（默认） |
| `["claude-code"]` | 只看 Claude Code 的会话数据 |
| `["zcode", "codex"]` | 两源聚合，按完成时刻合并排序 |
| 全五个 | 全聚合；未安装的客户端自动跳过，读都不读 |

未知 ID 在归一化时被丢弃并回退默认值，写错一个名字不会让插件起不来。也可用环境变量 `TPS_PROVIDERS` 覆盖（逗号分隔），优先级低于配置文件。多源展示的切换条 / 卡片 / 对比视图与口径说明见「技术架构」与「工作原理」。

### 悬浮条聚焦（focusAgent）

| 取值 | 含义 |
|---|---|
| `"zcode"`（默认） | 悬浮条显示 ZCode 速率（默认 providers 配置下与 V2.4.0 行为一致） |
| `"claude-code"` 等 | 显示对应客户端的速率，统计行带来源前缀；Electron 悬浮条显示来源标签 |
| `"all"` | 聚合全部启用源 |

Electron 托盘「聚焦数据源」子菜单写入即生效；overlay.ps1 每次启动时读取。REST 端点 `GET /api/token-rate` 亦支持 `?agent=` / `?session=` 可选作用域（未知源 400），供脚本按源取数。

### 业务 TPS（可选）

插件默认提供演示数据；若要监控真实业务吞吐，在 **设置 → 插件管理 → zcode-tps-monitor** 中配置 `metrics_url`，指向任意返回 JSON 的指标接口。字段自动兼容（支持最多三层嵌套）：

| 指标 | 识别的字段名 |
|---|---|
| 吞吐 | `tps` / `qps` / `throughput` / `transactionsPerSecond` |
| 延迟 | `p50` / `p95` / `p99`（或 `latency_p50` 等） |
| 错误率 | `error_rate` / `errorRate` / `err_rate` |

示例接口返回：

```json
{"data":{"tps":1240,"p50":11,"p95":28,"p99":46,"error_rate":0.05}}
```

> 注意：`metrics_url` 未配置时，插件的 MCP 服务器在部分客户端会因清单变量无法展开而启动失败（表现为 `plugins validate` 报 `plugin_variable_missing: metrics_url`）。在插件设置里为该字段随便填个值（空串即可）即可；钩子、命令与技能不受影响。

### 环境变量

| 变量 | 说明 |
|---|---|
| `ZCODE_USAGE_DB` | 覆盖 usage 数据库路径（默认 `~/.zcode/cli/db/db.sqlite`），特殊安装位置用 |
| `TPS_PROVIDERS` | 覆盖启用的数据源（逗号分隔，如 `zcode,claude-code`），优先级低于配置文件 |
| `TPS_CLAUDE_CODE_HOME` / `TPS_CODEX_HOME` / `TPS_OPENCODE_HOME` / `TPS_CLINE_HOME` | 覆盖对应客户端的数据根目录，默认取各客户端官方位置 |
| `TOKEN_RATE_WINDOW` / `TOKEN_RATE_HIST` | 统计窗口（默认 5）/ 曲线历史点数（默认 60） |
| `TOKEN_RATE_MIN_MS` / `TOKEN_RATE_MAX_MS` | 有效样本的生成耗时区间（默认 200ms – 1h） |
| `TPS_URL` | 业务 TPS 指标接口（独立大屏 / 脚本模式用） |

## 🧪 测试与验证

```bash
node --test                                              # 测试套件（数字格式化 / turn 查询 / 外观配置 / SSE 与性能断言 / 多 agent Provider / 聚合展示 / 桌面客户端等 88 条）
cd plugins/zcode-tps-monitor && node scripts/doctor.mjs  # 环境自检（--json 含 perf 与多 agent 数据源节）
```

MCP 服务器手工冒烟（响应为 `Content-Length` 帧，同时兼容裸 JSON 行请求）：

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"manual","version":"0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node plugins/zcode-tps-monitor/mcp/tps-server.mjs
```

## ❓ 常见问题

**Q：可以在 OpenCode / Codex / Claude Code 等其他工具中使用吗？**

A：插件机制与钩子绑定 ZCode——速率行只在 ZCode 会话里显示。但**数据源不限 ZCode**：在 `providers` 里加入 Claude Code、Codex、OpenCode、Cline 后，`/tps`、大屏、MCP 就能读到这些客户端的本地会话用量（口径见「工作原理 · 多源聚合」）。未开启时仍只读 ZCode，行为与此前完全一致；业务 TPS 采集脚本与大屏是独立程序，可脱离 ZCode 运行。

**Q：显示的速率准确吗？**

A：速率由客户端用量数据中的真实 token 累计值计算得出，口径为模型输出侧 token（含思考 token）。行在回复刚结束的瞬间采样，显示的就是本轮；多段轮次为「总产出 / 总纯生成时长」加权，段间工具等待不计入。ZCode 的纯生成耗时是实测值；其他客户端没有首 token 时刻，只能用估算口径且各家不同（见「工作原理」的对照表），**跨源横向不可比**。与其他工具显示的数字也可能因统计窗口不同而略有差异。

**Q：速率行突然不见了？**

A：运行 `/tps-doctor` 自检。常见原因：Node 版本低于 22.5（需内置 `node:sqlite`）、ZCode 更新后表结构变化、升级插件后未重开会话（钩子需新会话注册）、或配置文件里关闭了注入。

**Q：大屏是轮询还是推送？会占多少资源？**

A：SSE 推送（`GET /api/events`）。空闲时通道上只有 15 秒一条心跳注释行，页面上不存在任何周期性请求；服务端一条 1s 采集 tick 只读一次库并扇出给所有 SSE 客户端。新样本到达时才按事件类型局部更新 DOM 与 canvas（脏标记重绘），稳态增量包 < 1KB。钩子侧单次 DB 读取有 50ms 预算，耗时分布与超支次数可在 `/tps-doctor` 的 perf 节查看。

**Q：多源时分组卡片和顶部主卡片数字对不上？**

A：正常。分组卡片与对比曲线是各源**自己的当前会话**口径（会话 id 跨工具不通用，不能借用）；顶部主卡片与速率行跟随的是 ZCode 的当前会话。两处横向不可比，这是多工具场景的固有属性。

**Q：macOS / Linux 支持吗？**

A：支持。钩子、命令、大屏、MCP 均为跨平台 Node 实现；usage 数据库路径按用户主目录自动解析，特殊安装位置可用 `ZCODE_USAGE_DB` 环境变量覆盖。桌面形态有两种：`overlay.ps1` 依赖 Windows API 仅限 Windows；**Electron 桌面客户端**三平台都有安装包（NSIS / dmg / AppImage），macOS 与 Linux 用户可用它获得悬浮条、托盘与开机自启。

**Q：和 v1.x 的 stepfun-usage-monitor 什么关系？**

A：同一个仓库的两代产品。v1.x 通过本地反向代理（`127.0.0.1:8787`）统计各大模型 API 的 Token 用量，需要改客户端 Base URL；V2.0.0 完整重构为 ZCode 插件，直读 ZCode 自身 usage 数据库，无需改任何客户端配置。若仍需要 v1.x 的代理，代码在 git 历史中（见 tag `v1.5.10`）。

**Q：演示数据怎么关掉？**

A：演示数据只影响「业务 TPS」部分（Token 速率始终真实）；不配置 `metrics_url` 即为演示模式，配置后自动切换为真实数据源。

**Q：不喜欢液态玻璃效果 / 想换字体？**

A：大屏右上角「⚙ 外观」抽屉里把「玻璃强度」拖到 0 即恢复纯色面板；主题、字体、字号、缩放、主题色都在同一抽屉内即时生效。也可直接编辑 `~/.zcode/tps-monitor.config.json` 的 `appearance` 节（字段见「配置」一节）。

## License

[AGPL-3.0-only](LICENSE) · 上游 MIT 文本与版权声明保留在 [LICENSE-MIT](LICENSE-MIT)，版权人 © 2026 shy3130（上游作者）· V2.1.0 外观与液态玻璃、V2.2.0 性能优化、V2.3.0 Electron 桌面客户端、V2.4.0 多 agent Provider 数据层、V2.5.0 多 agent 聚合展示：Neriah-Ado
