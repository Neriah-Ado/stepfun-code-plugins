# 更新日志

> 各版本的完整双语 Release Notes 见 [`docs/releases/`](docs/releases/)（中文 + English）。

## 未发布（安全加固）

安全审计的可自动修复项。B-03（`fontUrl` 协议收窄）与 B-04（Electron `sandbox` / `openExternal` 收紧）属行为变化，待用户确认后再实施。

### 安全
- **大屏服务来源校验（B-01）**：`dashboard/server-core.mjs` 校验 `Host`（仅回环主机名，防 DNS rebinding）与 `Origin`（必须同源），`POST /api/config` 强制 `Content-Type: application/json`；无 Origin 的本机脚本与同源页面行为不变。新增 `test/dashboard-security.test.mjs`（错误 Origin → 403）。
- **发布流程权限下沉与 Action pin（B-06）**：workflow 级 `permissions: contents: read`，仅 build job 提升到 `contents: write`；所有 Action 固定到 40 位 commit SHA。
- **依赖可复现（B-05）**：新增并提交 `package-lock.json`，CI 改用 `npm ci`，发布前对生产依赖执行 `npm audit --omit=dev --audit-level=high`。

### 文档
- **v1.x 升级提示（B-08）**：中英文 README 补充“建议升级并删除旧 `~/.stepfun-usage-monitor/providers.json`（明文保存 API key）”。

## v2.5.0（多 agent 聚合展示层：切换条 + 分组卡片 + 同轴对比 + 会话聚焦）

目标：在 V2.4.0 数据层之上补齐**展示层**——大屏、Electron 悬浮条、托盘与 `/tps` 输出同时展示多个 agent,支持切换与对比。数据层除 `agentStatus` 补 `sessionList` 外不再改动;默认 `providers=["zcode"]` 时新 UI 元素一律不出现,输出与 V2.4.0 完全一致。

### 新增
- **`/api/agents` 端点**:列出已启用的数据源及各自探测结果(标签/能力/格式/可用性/当前会话/会话列表),大屏切换条、分组卡片与会话切换器共用。
- **SSE `agents` 事件**:数据源列表变化时推送(多 → 单也推,前端据此隐藏切换条);多源连接建立时补推一帧。旧事件字段语义冻结,旧前端逻辑兼容。
- **大屏 agent 切换条**:「全部 / ZCode / Claude Code / …」胶囊条,点击聚焦某源(对比曲线中其余变淡);焦点记忆在 localStorage,单源时整条隐藏。
- **分组卡片**:每 provider 一张「速率 / 首字 / 输出 / 请求」卡片,按能力降级——第三方源无 TTFT 显示「—」而非编数字。
- **对比视图**:多 agent 速率曲线同轴叠加(复用现有 canvas 绘制,多 series),图例标注各源口径差异(实测 / 估算);空闲不轮询、仍由数据驱动重绘。
- **会话切换器**:同一工具多会话时单选聚焦(REST 一次性快照,不新增轮询)/ 跟随当前会话;记忆在 localStorage。
- **悬浮条聚焦数据源**:新配置字段 `focusAgent`(缺省 `zcode`,默认配置下行为与 V2.4.0 一致;`"all"` = 聚合);Electron 托盘新增「聚焦数据源」子菜单,悬浮条聚焦非 zcode 源时显示来源标签。
- **`/tps` 聚合输出**:多源时人类可读输出按数据源分组(`各源速率:`块),`--json` 附 `perProvider`;缺省单 zcode 保持原格式。

### 变更
- **`/api/token-rate` 可选作用域参数**:`?agent=<id>`(未知源 400)、`?session=<id>`;聚焦第三方源且未显式给会话时由该源自己解析"当前会话"(会话 id 与 zcode 不通用)。不带参数行为不变。
- **`agentStatus` 最小补齐**:新增 `sessionList`(≤10 条最近会话),供会话切换器使用,不产生额外读取。
- **overlay.ps1**:读 `focusAgent` 决定轮询作用域与来源前缀;不配置时 URL 与 V2.4.0 逐字节一致。
- **悬浮条采集**:每次采集现读 `focusAgent`(托盘切换/手改配置即刻生效)。

### 约束与口径
- 插件核心(hooks / scripts / mcp / commands)继续零 npm 依赖;大屏为纯 CSS + 原生 JS,无构建工具。
- 聚焦 zcode(缺省)时查询结果与 V2.4.0 的合并查询完全一致;多源分组卡片与对比曲线是各源"自己的当前会话"口径,顶部主卡片仍为 followed 会话口径——两者横向不可比,详见 README。
- 数据全本地;配置字段只增不删;MCP 返回结构不变。

### 版本
- `marketplace.json` / `.zcode-plugin/plugin.json` / `.claude-plugin/plugin.json` / 根 `package.json` 统一升级 **2.5.0**(图标 URL 同步)。
- 新增 `test/aggregate-view.test.mjs`(12 条):focusAgent 配置、agentStatus.sessionList、/api/agents、SSE agents 事件(连接即推 + 列表变化)、多源 perProvider 快照与 token 事件、单源结构不变、REST 作用域参数、CLI 分组输出、大屏/悬浮条静态结构。单元测试 **76 → 88**,`node --test` 全绿。

## v2.4.0（多 agent Provider 数据层：Claude Code / Codex / OpenCode / Cline）

目标：把「只读 ZCode 自己的 usage 库」抽象成统一的 Provider 接口，让同一套速率口径也能覆盖 **Claude Code、Codex、OpenCode、Cline** 等客户端工具的本地 usage 数据；同时保持插件核心（hooks / scripts / mcp / commands / dashboard）零 npm 依赖、纯 Node，**默认配置下行为与 V2.3.0 完全一致**。本版只做**数据层与命令层**，多 agent 聚合展示 UI 留到 V2.5.0。

### 新增
- **Provider 接口**（`scripts/lib/providers/`，纯 Node、零依赖）：每个 Provider 声明 `id` / `label` / `capabilities`（`turnRate` / `ttft` / `sessionScope`），实现 `detect()`、`listSessions()`、`getUsage()`。归一化记录统一为 `tokens / 时间 / 模型 / turnKey` 四类字段，上游字段口径差异全部收口在 Provider 内部。
- **五个内置数据源**：
  - `zcode`：`~/.zcode/cli/db/db.sqlite` 的 `model_usage` 表——现有逻辑原样迁入，字段口径不变，`strictRead` 不设探测闸门（库缺失/损坏仍按 V2.3.0 语义抛错）。
  - `claude-code`：`~/.claude/projects/**/*.jsonl` 会话日志，逐条解析 usage 事件，`turnKey` 取用户消息 id 链。
  - `codex`：`~/.codex/sessions/` 的 rollout 记录，解析 token 计数字段；旧版只给累计值时按差分求单次增量，reset 自动识别。
  - `opencode` / `cline`：各自本地存储的只读适配（能力矩阵随版本迭代）。
- **多源聚合查询层**（`scripts/lib/collect-core.mjs` 的 `aggregateRate` / `aggregateTurn` / `agentStatus`）：按 `providers` 配置并发采集、归一化后按完成时刻合并。**单源时走原路径**（`isFastPath`），不引入额外开销。
- **能力降级**：四个第三方客户端都不记录 TTFT，`capabilities.ttft = false`，`ttftMs` 恒为 `null`，UI/命令按能力显示 `-` 而不是编数字。
- **`/tps` 作用域参数**：`--agent <id>` 圈定单一数据源，`--session <id>` 圈定会话；新增 `--agents` 列出每个源的探测结果与样本数。缺省行为不变。
- **配置字段 `providers`**（只增不删）：默认 `["zcode"]`；环境变量 `TPS_PROVIDERS` 可临时覆盖。可直接编辑 `~/.zcode/tps-monitor.config.json`，或经大屏 `GET/POST /api/config` 读写同一字段（与 `appearance` 相互独立，只传一段也能用）；大屏内的「数据源」面板属 V2.5.0 展示层范围。
- **JSONL 增量游标**：`createJsonlReader` 按字节游标增量读取，单行 JSON 解析失败只跳过该行；目录扫描带 2s mtime 缓存，2 万条记录上限。
- **故障隔离**：任一源数据损坏/格式变更只让它自己那一项报错并说明原因，其余源照常出数；未安装的客户端自动跳过。

### 变更
- **MCP 返回结构扩展**：`tps_snapshot` / `tps_watch` 结果新增 `provider` 与 `sessionId` 两个字段（**只增字段、不改名**），老客户端忽略时行为不变；工具名与 `content` / `isError` 原样保留。
- **doctor 多源自检**：新增「数据源(多 agent)」检查项，对每个启用的源单独给「可用/不可用 + 原因 + 数据格式 + 样本条数」；已安装但无数据只提示不算失败。
- **usage 数据库自检加固**：能打开不代表读得了——文件被截断/不是 SQLite 时 `dbCheck` 现在返回失败项并给出修复提示，而不是让整份自检报告崩掉。
- **Electron 桌面客户端同步切换**：悬浮条与大屏经 `token-rate.mjs` 取数，该模块即聚合层，因此自动切到多源聚合，无额外改动；单源默认配置下与 V2.3.0 行为一致。

### 约束与口径
- 插件核心**零新增 npm 依赖**，Provider 全部纯 Node 实现；全部只读本地文件，不联网、无遥测。
- **钩子热路径不读 JSONL**：Stop / prompt-submit 钩子仍直连 zcode usage 库，即使 `providers` 配满五个源，钩子输出与只用 zcode 时逐字节相同（有专项测试守着）。
- 第三方源的生成耗时口径：Claude Code 取相邻请求时间差（>120s 视为无效），Codex 取 token_count 事件间隔，OpenCode 取客户端自记的 created/completed，Cline 取相邻请求差；都是**估算值**，与 ZCode 库直接落库的 `first_token_at` / `completed_at` 不可直接横向比较。

### 版本
- 新增 `scripts/lib/providers/`（`index.mjs` 注册表 + `common.mjs` 归一化 + `zcode` / `claude-code` / `codex` / `opencode` / `cline` 五个 Provider）、`test/providers.test.mjs`；插件本体零新增依赖。
- `marketplace.json` / `.zcode-plugin/plugin.json` / `.claude-plugin/plugin.json` / 根 `package.json` 统一升级 **2.4.0**。
- 新增 `test/providers.test.mjs`（21 条：每源一组只读夹具、能力降级、多源合并、单源字节一致、损坏隔离、doctor 多源自检、CLI 作用域参数、MCP 结构、大屏 SSE、钩子不读 JSONL）；单元测试 **55 → 76**，`node --test` 全绿。

## v2.3.0（Electron 桌面客户端：主窗口 + 悬浮条 + 托盘 + 自动更新）

目标：在不动插件本体的前提下，新增一个**可选的跨平台 Electron 桌面客户端**——仪表盘主窗口、透明置顶悬浮条、托盘菜单、开机自启与自动更新，并打通三平台打包流水线。插件核心（hooks / scripts / mcp / commands / dashboard server.mjs）零依赖原则不变，钩子、命令、MCP 行为零改动，浏览器大屏保持可用。

### 新增
- **Electron 工程**：新增 `electron/`（`main.mjs` 主进程、`preload.cjs` 预加载、`renderer/overlay.html` 悬浮条渲染层、`lib/` 纯逻辑）与**工作区级根 `package.json`**（`electron` / `electron-builder` 为 devDependency，`electron-updater` 为运行依赖）+ `electron-builder.yml`。桌面客户端是独立分发物，**不进插件市场**，插件目录内不新增 package.json / node_modules。
- **内嵌大屏服务**：主进程复用插件的大屏服务工厂 `dashboard/server-core.mjs`，以随机端口（`port: 0`）绑定 127.0.0.1、不写 PID 文件、不空闲退出，`loadURL` 加载**同一份 index.html**——桌面端与浏览器大屏是同一套页面、同一条 SSE 通路。
- **悬浮条窗口**：无边框透明置顶小窗，显示当前 tok/s；`-webkit-app-region: drag` 可拖拽，位置/尺寸持久化到 `~/.zcode/tps-monitor.desktop.json`；点击穿透可切换（`setIgnoreMouseEvents(on, { forward: true })`，穿透时仍能收到 mousemove，悬停展开 TTFT / 近5次均 / 累计 tok 详情）；数据由主进程采集循环经 IPC 推送，不走 HTTP。
- **托盘与窗口管理**：托盘菜单（显示/隐藏悬浮条、打开仪表盘、主窗口置顶、悬浮条点击穿透、开机自启、退出）；关闭主窗口最小化到托盘；单实例锁；窗口尺寸/位置/置顶状态重启后恢复。
- **开机自启 + 自动更新**：`setLoginItemSettings` 开机自启（仅打包后生效）；`electron-updater` 对接 GitHub Releases，自动下载、退出时安装。
- **三平台打包流水线**：`.github/workflows/release.yml` 在推送 `v*` 标签时先跑 `node --test`，再矩阵构建 Windows（NSIS 安装包 + portable）/ macOS（dmg）/ Linux（AppImage），产物上传为 Release 附件。
- **图标生成**：`electron/build/make-icons.mjs` 复用插件现有 SDF 图标生成器，纯 Node 组装 ICO / ICNS 容器（无新增依赖）。
- **桌面专属按钮**：大屏页头新增「📌 置顶」「▣ 悬浮条」两枚按钮，仅 `html.tps-electron` 下显示，浏览器打开完全不可见。

### 变更
- **配置互通**：桌面端与浏览器大屏共用同一份 `~/.zcode/tps-monitor.config.json` 的 `appearance` 节（`scripts/lib/config.mjs`），任一端改外观另一端重启即生效；桌面专属状态单独存 `~/.zcode/tps-monitor.desktop.json`，不污染插件配置节。
- **`overlay.ps1` 退役路径标注**：保留并标注为「无 Electron 时的轻量替代」（零安装、单文件、仅 Windows），自 V2.3.0 起只维护不新增功能，跨平台需求引导至 Electron 客户端。

### 版本
- 新增 `electron/`（主进程 / 预加载 / 渲染层 / 纯逻辑）、`electron-builder.yml`、`.github/workflows/release.yml`、工作区级 `package.json`；插件本体零新增依赖。
- `marketplace.json` / `.zcode-plugin/plugin.json` / `.claude-plugin/plugin.json` 统一升级 **2.3.0**。
- 新增 `test/desktop.test.mjs`（17 条：悬浮条载荷口径、状态持久化与夹紧、采集循环、ICO/ICNS 容器自洽、IPC 通道一一对应、插件零依赖扫描、桌面按钮默认隐藏、overlay.ps1 标注）；单元测试 **38 → 55**，`node --test` 全绿。

## v2.2.0（性能优化：SSE 推送 + 脏标记重绘 + 预编译语句）

目标：消除通信层无效轮询、渲染层全量重绘、数据层低效 SQL 三类开销，全部优化在 V2.1.0 的渲染管线上进行。钩子速率计算逻辑与输出格式不变，`/tps`、`/tps-doctor` 行为不变（仅 doctor `--json` 增 perf 节），MCP 返回结构不变，配置字段只增不删。

### 新增
- **SSE 实时推送**：大屏服务新增 `GET /api/events`（`Content-Type: text/event-stream`，纯 `node:http` 实现，零依赖）。三类事件：`token`（新速率样本）、`sys`（系统指标）、`history-append`（历史增量）。连接建立先推一次全量 `snapshot`，之后只推增量；每 15s 一条心跳注释行，断线重连（EventSource 自动重连）再推全量快照。REST 端点 `/api/token-rate`、`/api/metrics` 原样保留，不支持 EventSource 的浏览器自动回退轮询。
- **钩子耗时诊断日志**：新增零依赖模块 `scripts/lib/perf-log.mjs`，对钩子单次 DB 读取计时并追加写入本地 `~/.zcode/tps-monitor.perf.log`（超 50ms 预算标记 `overBudget`，写失败静默，绝不影响钩子）。
- **doctor perf 节**：`scripts/doctor.mjs --json` 新增 `perf` 节——最近一次钩子耗时、P50/P95/最大耗时、超预算次数、DB 文件大小、慢查询日志路径、索引全表扫描提示。
- **建议索引自检**：`scripts/lib/usage-db.mjs` 导出 `SUGGESTED_INDEXES`（两条 DDL）与 `indexHints()`（`EXPLAIN QUERY PLAN` 自检），doctor 检出全表扫描时给出建索引提示。
- **性能回归测试**：新增 `test/perf.test.mjs`（12 条：SSE 线格式与心跳零载荷、增量包 < 1KB、预编译语句复用、建议索引消除全表扫描、2 万行库查询耗时、钩子预算、大屏 SSE 端到端）。

### 变更
- **通信层**：`index.html` 改用 EventSource 按事件类型局部更新 DOM/canvas，`setInterval` 仅保留时钟；服务端单条 1s 采集 tick 只读一次库供全部 SSE 客户端复用。
- **渲染层**：canvas 仅在收到新样本或窗口 resize 时重绘（以最后样本时间戳做脏标记），`devicePixelRatio × 尺寸` 变化才重置 canvas 缓冲；文本节点写入前比对 `textContent`，值不变不写 DOM。
- **服务端缓存**：CPU 百分比采样（含 250ms 睡眠）在 5s 窗口内缓存复用，SSE 推送间隔放宽至 5s。
- **悬浮条**：`overlay.ps1` 轮询间隔由 1s 放宽到 2s，主题采样按墙上时钟 5s 一次，文本无变化时跳过 WPF 元素更新。
- **数据层**：按最新 `turn_id` 圈定本轮的查询统一封装为预编译语句（`node:sqlite StatementSync`，同连接内按 SQL 文本复用），Stop 钩子 5 次重试复用同一只读连接与同一批语句。

### 修复
- `overlay.ps1` 预存的 PowerShell 解析错误（`0x20 | 0x40 | 0x80 | 0x100` 作为赋值右值不被解析）改为 `-bor` 位运算符——此前该脚本完全无法运行。

### 版本
- 新增零依赖模块 `scripts/lib/usage-db.mjs`（只读访问层 + 预编译语句 + 索引自检）、`scripts/lib/sse.mjs`（SSE 线格式）、`scripts/lib/perf-log.mjs`（耗时诊断）；core 仍保持零 npm 依赖。
- `marketplace.json` / `.zcode-plugin/plugin.json` / `.claude-plugin/plugin.json` 统一升级 **2.2.0**。
- 单元测试扩充至 **38** 条（新增性能断言 12 条）；`node --test` 全绿。

## v2.1.0（外观自定义 + 液态玻璃）

### 新增
- **外观配置节** `~/.zcode/tps-monitor.config.json` 新增 `appearance`：`theme`（dark / light / system）、`fontFamily`、`monoFont`、`fontSize`（8–24）、`fontScale`（0.8–1.5）、`accentColor`、`glassIntensity`（0–1，0 为关闭）、`fontUrl`（可选 Web 字体，仅允许 http/https/file）。只增不删，旧配置文件行为不变。
- **配置读写 API**：大屏服务新增 `GET / POST /api/config`；GET 返回当前外观与配置文件路径，POST 逐字段校验后合并写入（非法字段返回 400 + 字段级错误，不落盘）。
- **页内设置抽屉**：大屏右上角「⚙ 外观」打开抽屉，主题 / 字体 / 字号 / 缩放 / 主题色 / 玻璃强度 / Web 字体即时保存即时生效；留空的字体字段回落到默认值。
- **Web 字体动态加载**：`fontUrl` 指向的字体经 FontFace API 静默加载，失败自动回退系统字体栈，不阻塞渲染。
- **Windows 悬浮条外观对齐**：`overlay.ps1` 读取同一配置节，按配置切换字体与字号；玻璃强度 > 0 时尝试 Acrylic 背景（失败静默回退原透明纯文本形态）。
- **doctor 外观自检**：`/tps-doctor` 新增外观配置检查（配置文件缺失为提示项、JSON 损坏或字段非法为失败项并给出修复建议；`fontUrl` 可达性仅作提示，不阻断）。

### 变更
- 大屏样式全面 CSS 变量化：主题色、字体、字号、缩放、玻璃参数均由配置驱动，`html` 根字号按 `fontSize × fontScale` 计算，卡片 / 面板 / 图表全部改用 rem 与 CSS 变量，主题切换无需刷新。
- **液态玻璃**：默认 `glassIntensity 0.6`，卡片使用半透明底 + `backdrop-filter` 模糊/增饱和 + 内侧高光边 + 多层投影；`@supports not (backdrop-filter)` 时自动降级为实色面板；`glassIntensity: 0` 完全恢复 V2.0.0 实色外观与 12px 圆角。
- 配置在服务端注入页面（`window.__TPS_CONFIG__`，首屏前生效），彻底消除主题闪烁；`file://` 直开时回退为客户端拉取。
- 速率曲线 / 系统图表颜色与字体改读 CSS 变量，跟随主题与主题色变化；非 hex 主题色不再拼接 alpha。

### 安全
- 字体栈字符白名单（拒绝 `; { } < > ( ) \` 等 CSS 破坏字符）、颜色格式校验（hex / rgb(a) / hsl(a) / 常用英文色名）、`fontUrl` 协议白名单（http / https / file），注入式外观配置无法进入页面。

### 版本
- 新增零依赖共享模块 `scripts/lib/config.mjs`（大屏、doctor、测试共用同一套校验）；`marketplace.json` / `.zcode-plugin/plugin.json` / `.claude-plugin/plugin.json` 统一升级 **2.1.0**。
- 单元测试扩充至 26 条（新增外观配置校验 / 合并写 / 损坏修复 / doctor 外观检查）。

## v2.0.0（按 zcode-tps-monitor 完整重构：ZCode 原生 Token 速率监控插件）

### 修复
- **接入必须改客户端 Base URL 并经本地代理转发**：v1.x 以本地反向代理（`127.0.0.1:8787`）作为唯一记账入口，客户端需把 Base URL 指向代理并在 `providers.json` 按服务商覆盖 baseUrl / apiKey——多一跳进程多一处失效点，代理未起时请求全部失败。V2.0.0 废弃代理架构，改为只读 ZCode 自带 usage 数据库（默认 `~/.zcode/cli/db/db.sqlite`，可用 `ZCODE_USAGE_DB` 覆盖），安装即用、客户端零配置。
- **速率展示滞后、「上轮」与「本轮」口径易混淆**：v1.x 依赖模型转发或入库后采样，展示的常是上一条回复的数据，多段轮次无统一口径。V2.0.0 注册 `Stop` 钩子，在回复结束瞬间按最新 `turn_id` 圈定本轮全部请求（含多段），以「总产出 / 总纯生成时长」加权，经 `systemMessage` 由客户端直接渲染，从机制上消除滞后。
- **运行时依赖重、安装态与仓库代码易脱节**：v1.x 需 `npx` 拉取运行时 + Python statusbar 常驻进程，安装态 runtime 还要手工同步校验。V2.0.0 全部实现为零依赖纯 `.mjs`（Node 内置 `node:sqlite` / `node:http`），无常驻进程（大屏空闲 3 小时自退）。

### 新增
- **每轮即时速率行（Stop 钩子，默认开启）**：回复结束自动显示本轮即时 tok/s、首字时间（TTFT）、输出 tokens、纯生成时长、请求段数 / 段内峰值、近几次滑动均值、会话累计输出、采样时刻；速率分子纳入思考 token，多段轮次加权并剔除段间工具等待。
- **实时监控大屏**：`/dashboard` 打开暗色运维风面板，每秒刷新，空闲 3 小时自退，默认 `127.0.0.1:7423`。
- **斜杠命令**：`/tps` 即时快照、`/tps 10` 采样 10 秒（2–30）、`/tps-doctor` 环境自检（`--json`，失败退出码 1）。
- **MCP 工具** `tps_snapshot` / `tps_watch`：标准 stdio 服务器，版本号自动读取 `plugin.json`。
- **Windows 桌面悬浮条** `dashboard/overlay.ps1`。
- **业务 TPS 监控（可选）**：`metrics_url` 指向任意 JSON 指标接口，字段名三级嵌套自适应；未配置用演示数据，与 Token 速率相互独立。
- **单元测试**：`node --test` 10 条断言（数字换算 / 本轮查询 / doctor 夹具等）。

### 版本
- 仓库定位整体变更：由「StepFun API 用量本地代理」重构为「ZCode 会话级 Token 速率监控插件」，目录结构、技术栈与实现方式全部对齐上游 [shy3130/zcode-tps-monitor](https://github.com/shy3130/zcode-tps-monitor)；v1.x 代码保留于 git 历史（tag `v1.5.10`）。
- `marketplace.json` / `.zcode-plugin/plugin.json` / `.claude-plugin/plugin.json` 统一升级 **2.0.0**。
- README（中 / 英）按 V2.0.0 身份完整重写；恢复 `docs/releases/` 双语发布说明。

## 0.8.2 — 2026-09-12

### 修复:每条回复显示「本问」统计,不再出现「上轮」
- **本问统计指令**:UserPromptSubmit 注入新增指令——模型在回答收尾时运行 `token-rate.mjs --turn --current`,把输出行原样引用在回复末尾。它统计的是**本次提问**从提出到最近一次工具调用的真实速率(usage 数据库按 turn 逐段实时入库)。
- **--current 守卫**:最新 turn 的数据若全部早于本次提问时刻(纯问答轮尚无本问数据),脚本不输出任何统计行——**任何情况下都不把上一轮数据当作本问显示**,并明确禁止模型引用「(上轮)」上下文行。
- 注入的「(上轮)」行降级为纯模型上下文并标注禁止引用。
- 说明:统计覆盖到最近一次工具调用为止;最终总结文字在其后生成,不计入。纯问答(无工具调用)的回答没有可靠的「本问」数据,按守卫不显示统计行。

## 0.8.1 — 2026-09-12

### 新增
- **插件图标**:新增 `assets/icon.png`(256×256 速度仪表盘 + 吞吐柱,`node assets/generate-icon.mjs` 可再生成),并在市场清单中为插件声明 `icon` 字段——客户端「发现 / 已安装」列表可显示插件图标。
- 仓库 README 顶部展示图标。

## 0.8.0 — 2026-09-12

### 新增
- **本轮即时速率(Stop 钩子)**:新增 `hooks/stop.mjs` 并注册 `Stop` 事件。回复刚结束、本轮全部请求已入库的瞬间,按最新 `turn_id` 圈定本轮(含"模型→工具→模型"多段),以"总产出 / 总纯生成时长"计算加权即时速率,经 `systemMessage` 由客户端直接显示——不再依赖模型转发,消除"回复完成时统计的却是上一轮"的滞后。
- `token-rate.mjs` 新增 `queryTurn` / `formatTurnLine` 与 `--turn` CLI;多段轮次显示「N 段 / 峰值」。

### 变更
- `prompt-submit` 默认不再附加"回复末尾转发速率行"指令,注入的上一轮速率仅作模型上下文;新配置 `{"stopHookLine": false}` 可停用 Stop 行为、完整恢复 v0.7.x 模型转发旧行为。
- SessionStart 提示语区分新旧两种展示模式。

### 兼容
- 旧版客户端 usage 库无 `turn_id` 列时,本轮查询优雅降级(不抛错,退回单段口径)。

## 0.7.1 — 2026-09-04

### 变更
- 数字显示规则化:每轮「输出」用千分位精确数字(`2,762 tok`);「累计」紧凑单位新增 M 档——千以下原始、1k~1万一位小数(`9.8k`)、1万~100万取整(`51k`)、≥100万一位小数(`73.8M`),修复百万级显示成 `73818k` 的问题。
- CLI 明细行全部改为千分位精确数字(输出/输入/缓存读/请求次数)。
- 监控大屏「上轮输出」卡片与悬浮信息同步千分位。
- 新增 `fmtCompact` / `fmtNum` 换算单测(累计 7 项)。

## 0.7.0 — 2026-08-30

### 修复
- **严重**:prompt-submit 钩子把算好的速率行弄丢了(`line` 计算后未拼进 additionalContext),自 v0.6.1 起新安装的插件不会显示速率行。0.7.0 修复。
- usage 数据库路径不再硬编码具体机器,按用户主目录解析(Windows/macOS/Linux),可用 `ZCODE_USAGE_DB` 覆盖。

### 变更
- 速率分子纳入思考 token(`reasoning_tokens`;ZCode 未记录时为 0,行为不变)。注入行在存在思考 token 时显示「(+N 思考)」。
- 速率行明确标注「(上轮)」——行在发送消息瞬间采样,描述的是上一条已完成回复。
- 注入行新增「会话累计 N tok」;`token-rate.mjs` 人类可读模式追加输入/缓存读/请求数明细(累计用独立 SQL SUM,不受展示窗口限制)。
- 有效样本判定可配置:`TOKEN_RATE_MIN_MS`(默认 200)、`TOKEN_RATE_MAX_MS`(默认 1 小时,原固定 10 分钟)。

### 新增
- 自检命令 `/tps-doctor`(`scripts/doctor.mjs`):检查 Node 版本、usage 数据库与表结构、最近样本时间、会话状态文件、配置文件、大屏进程;支持 `--json`,失败时退出码为 1。
- 注入开关:`~/.zcode/tps-monitor.config.json` 写入 `{"tokenRateLine": false}` 关闭每轮速率行注入。
- 大屏生命周期:`--idle-exit`(默认 180 分钟)空闲自退;处理 SIGINT/SIGTERM;写 PID 文件(`~/.zcode/tps-monitor.dashboard.pid`)供 doctor 探测并给出停止命令。
- 单元测试(`node --test`,临时库夹具)与 GitHub Actions CI(Node 22/24 × Ubuntu/Windows/macOS)。
- MCP server 版本号自动读取 plugin.json,不再与插件版本脱节;本文件(CHANGELOG)。

### 清理
- CLI 与钩子不再向 stderr 输出 `node:sqlite` 的 ExperimentalWarning 噪音。

## 0.6.1 — 2026-08-30
- 插件更名 tps-monitor → zcode-tps-monitor,明确 ZCode 专属定位;技能目录同步更名。

## 0.6.0 — 2026-08-30
- 首个公开版本:每轮真实 token 速率注入、/tps 命令、MCP 工具、实时大屏、业务 TPS(demo/remote)。
