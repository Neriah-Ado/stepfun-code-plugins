#!/usr/bin/env node
// TPS 实时监控大屏服务:零依赖,Node >= 18。
//   node dashboard/server.mjs [--port 7423] [--idle-exit 180]
// 本文件只是 CLI 壳:服务逻辑在 server-core.mjs(Electron 桌面客户端内嵌复用同一份)。
// 页面通过 SSE(/api/events:token / sys / history-append 三类事件 + 心跳,重连补全量快照)
// 取数;REST 端点 /api/token-rate、/api/metrics 保留给第三方脚本与旧版页面。
// 数据源同采集脚本(TPS_URL 环境变量,未设置时演示数据)。
// 外观配置:GET/POST /api/config,读写 ~/.zcode/tps-monitor.config.json 的 appearance 节。

import { startDashboardServer, cleanupPidFile } from "./server-core.mjs";

const args = process.argv.slice(2);
const portIdx = args.indexOf("--port");
const PORT = portIdx !== -1 ? Number(args[portIdx + 1]) || 7423 : 7423;
// 空闲自退:连续无 HTTP 请求超过该分钟数则自动退出,避免关闭会话后残留后台进程(0 = 不自退)
const idleIdx = args.indexOf("--idle-exit");
const IDLE_EXIT_MIN = idleIdx !== -1 ? Number(args[idleIdx + 1]) : 180;

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
process.on("exit", cleanupPidFile);

const app = await startDashboardServer({ port: PORT, idleExitMin: IDLE_EXIT_MIN, writePidFile: true });
const src = process.env.TPS_URL && !process.env.TPS_URL.startsWith("${")
  ? `remote: ${process.env.TPS_URL}`
  : "demo(内置演示数据)";
console.log(`[zcode-tps-monitor] 大屏已启动: http://127.0.0.1:${app.port}   数据源: ${src}`);
if (IDLE_EXIT_MIN > 0) {
  console.log(`[zcode-tps-monitor] ${IDLE_EXIT_MIN} 分钟无访问将自动退出(--idle-exit 0 关闭该行为)`);
}
