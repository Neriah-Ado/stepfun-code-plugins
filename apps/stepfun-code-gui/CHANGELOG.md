# 变更记录

> 遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。
> 只记录用户可感知的变更；详尽说明见 `docs/releases/`，版本索引见 [README.md](README.md)。

> v2.0.0 发布后另有安全加固：面板 token 仅经 URL 片段 `#t=` 传递、写操作增加 `Origin` 校验，
> 端到端断言增至 38 项（含读写鉴权、跨站 `Origin`、静态资源校验）；详见 README「安全设计」，
> 该部分待下个版本归档。

## [2.0.0] - 2026-10-02

### 新增

- 一键启动器 `start.mjs` 与双击入口 `start.bat` / `start.sh` / `start.command`：自动定位或用 Go 构建网关、启动网关并打开浏览器。
- `npm start` / `npm run demo` / `npm run build` / `npm test` 四个脚本；`npm run demo` 无需安装 Step Code 即可回放完整场景。
- 扩展侧自动构建：网关二进制缺失时在后台用 Go 构建（每次会话限一次，30 s 冷却），构建期间事件排队并在完成后回放；`STEP_ORCHESTRA_AUTOBUILD=0` 可关闭。
- 性能模式与 topbar「性能」开关：冻结极光、关闭全部 `backdrop-filter` 与持续动画、跳过指针追踪；`prefers-reduced-motion`、≤ 4 逻辑核或 ≤ 4 GB 内存的设备首次访问自动启用；手动选择持久化到 `localStorage`，后台标签页自动休眠。
- 测试基建：`gateway/state_test.go` 6 组状态机测试、`tools/test-launcher.mjs`、`tools/test-extension-import.mjs`，以及支持 `--rounds N` / `--skip-build` 的聚合入口 `tools/run-all-tests.mjs`。

### 变更

- `npm test` 依次执行 go vet、go test、模块图、载荷解析、层叠校验、启动器与端到端测试，任一步失败即非零退出。

## [1.5.0] - 2026-09-27

### 修复

- 超长 stdin 行不再使网关永久失效或以退出码 0 退出；扩展侧历史回放增加 150 万字符预算，超限从最旧端裁剪并保底保留最新一条。
- 网关 EPIPE 不再升级为宿主进程内的未捕获异常；网关崩溃后清空过期面板地址，重拉成功后自动重放会话头、对话历史与最近一次用量。
- 消除快照 data race；帧序号严格单调；SSE 先订阅后发快照，闭合订阅与初始快照之间的竞窗。
- 修复编排树全量闪烁，改为增量有序 diff；结构变更与脏节点合并到单个 rAF 队列；节点详情按内容签名跳过重建；进度按 `toolCallId` 做 60 ms 尾随合帧。
- 环形进度改为原地更新 `stroke-dashoffset`，保留 0.5 s 描边过渡。
- SSE 断开 2 秒后探测 `/api/snapshot`，收到 401 即停止重连并提示重新运行 `/orchestra`。

### 变更

- 网关节点数上限设为 1000，超限从最旧端淘汰已终结节点，运行中与等待中的节点永不淘汰。
- 节点卡片移除 `backdrop-filter` 与常驻 `will-change`，毛玻璃保留在 topbar 与两块面板；运行节点的呼吸动画改由覆盖层 `opacity` 驱动，不再逐帧重绘 `box-shadow`。
- 消息发送即时回显「待达」气泡，失败时原文回填输入框；agent 生成中可发送，自动进入 `followUp` 队列。
- 空状态按过滤后可见数判定；移除编排树上的 `aria-live`；宿主未提供 id 时不再产生重复气泡。

### 安全

- 脱敏改为两级匹配：`metaKey` / `keyCode` / `author` 不再误伤，`apiKey` / `authorization` / `token` 照常整值替换。
- 短密钥（<24 字符）掩码收紧为前 2 后 2。
- `/healthz` 增加鉴权。

## [1.0.0] - 2026-09-27

### 新增

- 编排视图：实时编排树、按参数形状推断扇出模式、子代理行内明细、顶栏聚合指标、节点详情面板与「仅编排」筛选。
- 对话视图：会话历史回放、80 ms 合帧流式气泡、贴底滚动、Enter / Shift+Enter 与 IME 处理；视图切换不卸载 DOM。
- 多账户 API 配置热切换：凭据仅存网关侧 `profiles.json`，浏览器只接收掩码；`registerProvider` 免重启生效；401 / 403 时标红告警。
- Token 用量单行指标：`tok/s`、首字延迟、输出 / 生成耗时、均值、累计与上下文占用，≥75% / ≥92% 整行变色并提示。
- 液态玻璃界面：`backdrop-filter` 折射底、指针跟随高光、≤4.5° 视差倾斜、空状态 SVG 位移滤镜，以及 `prefers-reduced-motion` 降级。

### 安全

- 网关仅绑定 `127.0.0.1`，端口冲突自动顺延；每次运行生成 24 字节随机 token，数据端点常数时间校验。
- 参数经脱敏处理，单字符串截断至 2048 字符；前端一律以 `textContent` 写入宿主数据。
