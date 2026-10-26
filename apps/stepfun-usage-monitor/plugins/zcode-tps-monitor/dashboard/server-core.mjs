// TPS 实时监控大屏服务核心:零依赖,Node >= 18。
// 同时服务两种宿主,行为完全一致:
//   1. 浏览器/CLI   —— dashboard/server.mjs 以 CLI 参数启动,写 PID 文件、可空闲自退;
//   2. Electron 壳   —— electron/main.mjs 内嵌启动(临时端口、不写 PID、不空闲自退),
//                      主窗口直接加载 http://127.0.0.1:<port>/,大屏页面与 SSE 逻辑零改动。
// 页面通过 SSE(/api/events:token / sys / history-append 三类事件 + 心跳,重连补全量快照)
// 取数;REST 端点 /api/token-rate、/api/metrics 保留给第三方脚本与旧版页面。
// 数据源同采集脚本(TPS_URL 环境变量,未设置时演示数据)。
// 外观配置:GET/POST /api/config,读写 ~/.zcode/tps-monitor.config.json 的 appearance 节;
// 多 agent 数据源(V2.4.0):同一端点读写 providers 数组,大屏与 Electron 壳共用。
// token 速率一律经 scripts/token-rate.mjs 取数 —— 该模块在 V2.4.0 起就是多源聚合层,
// 因此大屏、REST、SSE、Electron 悬浮条拿到的是同一份归一化结果,行为完全一致。

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { snapshot, systemMetrics, agentStatus } from "../scripts/lib/collect-core.mjs";
import { query as tokenRateQuery, RATE_ENV } from "../scripts/token-rate.mjs";
import {
  sseEvent,
  sseComment,
  sseRetry,
  SSE_HEARTBEAT_MS,
  SSE_SYS_INTERVAL_MS,
} from "../scripts/lib/sse.mjs";
import {
  CONFIG_FILE,
  DEFAULT_APPEARANCE,
  readConfigStrict,
  readAppearance,
  patchAppearance,
  readProviders,
  patchProviders,
  readFocusAgent,
  patchFocusAgent,
  DEFAULT_FOCUS_AGENT,
} from "../scripts/lib/config.mjs";
import { isKnownProviderId } from "../scripts/lib/providers/index.mjs";

// 状态文件:钩子(SessionStart/UserPromptSubmit)记录"用户最后所处的会话"
export const STATE_FILE = path.join(os.homedir(), ".zcode", "tps-monitor.last-session.json");
// PID 文件:/tps-doctor 探测独立大屏进程的运行状态(内嵌模式不写,避免误判)
export const PID_FILE = path.join(os.homedir(), ".zcode", "tps-monitor.dashboard.pid");

export function followedSessionId() {
  try {
    const st = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (st && st.sessionId && Date.now() - (st.ts || 0) < 7 * 24 * 3600 * 1000) {
      return { id: st.sessionId, source: st.source || "hook" };
    }
  } catch {}
  return { id: null, source: "auto" };
}

const here = path.dirname(fileURLToPath(import.meta.url));
// index.html 模板:内含 <!--TPS_CONFIG--> 占位符,按请求注入当前外观配置(消除首屏 FOUC)
const indexTemplate = fs.readFileSync(path.join(here, "index.html"), "utf8");

export function renderIndex() {
  let injected;
  try {
    injected = JSON.stringify({
      appearance: readAppearance(),
      defaults: DEFAULT_APPEARANCE,
      // V2.5.0 展示层:首屏就知道是否多源 + 初始聚焦,切换条不必等 SSE 才渲染
      providers: readProviders(),
      focusAgent: readFocusAgent(),
    });
  } catch (err) {
    injected = JSON.stringify({ error: err.message });
  }
  return indexTemplate.replace("<!--TPS_CONFIG-->", `<script>window.__TPS_CONFIG__ = ${injected};</script>`);
}

// 退出时清理 PID 文件(仅当内容确实是本进程,避免误删他人)
export function cleanupPidFile() {
  try {
    if (fs.existsSync(PID_FILE) &&
        fs.readFileSync(PID_FILE, "utf8").trim() === String(process.pid)) {
      fs.unlinkSync(PID_FILE);
    }
  } catch {}
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}

// ---------- 本机来源校验(B-01) ----------
// 服务只监听回环地址,但浏览器里的任意网页仍可跨站发“简单请求”写配置。
// 因此对每个请求做三件事,均为纯增量防护,不改变同源页面行为:
//   1. Host 必须是回环主机名(防 DNS rebinding 把恶意域名解析到 127.0.0.1);
//   2. 带 Origin 的请求必须与本服务同源(协议 http/https、主机在白名单、端口一致);
//   3. POST 只接受 application/json(CORS 简单请求无法带这个 Content-Type,挡住表单/纯文本跨站写入)。
// 无 Origin 的请求放行:本机脚本、CLI、测试以及浏览器同源 GET/SSE 都可能不带 Origin。
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);

// 解析 Host/Origin 的 authority 部分,统一 IPv6 方括号与端口缺省值
function parseAuthority(value) {
  if (typeof value !== "string" || !value) return null;
  let url;
  try {
    url = new URL(`http://${value}`);
  } catch {
    return null;
  }
  return {
    hostname: url.hostname.replace(/^\[|\]$/g, ""),
    port: url.port || "80",
  };
}

function isJsonContentType(value) {
  return typeof value === "string" && value.split(";")[0].trim().toLowerCase() === "application/json";
}

function readBody(req, limit = 65536) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// 创建一个大屏服务实例(未监听)。opts:
//   host          监听地址,默认 127.0.0.1(仅本机,数据不出网)
//   port          0 = 系统分配临时端口(Electron 内嵌模式推荐)
//   idleExitMin   连续无 HTTP 请求超过该分钟数则自动退出(0 = 不自退)
//   writePidFile  是否写 PID 文件(仅独立 CLI 模式;内嵌模式会让 doctor 误判)
// 返回 { server, start(), close(), get port(), url }
export function createDashboardServer(opts = {}) {
  const host = opts.host || "127.0.0.1";
  const IDLE_EXIT_MIN = Number(opts.idleExitMin) || 0;
  let listening = false;

  let lastRequestAt = Date.now();

  // Host/Origin 白名单:回环主机 + 显式配置的监听主机(默认只有回环)
  const allowedHostnames = new Set(LOOPBACK_HOSTNAMES);
  const configuredHostname = parseAuthority(host)?.hostname;
  if (configuredHostname) allowedHostnames.add(configuredHostname);

  function listeningPort() {
    const address = server.address();
    return address ? String(address.port) : "";
  }

  function hostAllowed(req) {
    const parsed = parseAuthority(req.headers.host);
    return Boolean(parsed && allowedHostnames.has(parsed.hostname));
  }

  function originAllowed(req) {
    const origin = req.headers.origin;
    if (origin === undefined) return true; // 本机脚本 / CLI / 同源 GET、SSE
    if (origin === "null") return false;   // 沙箱 iframe、data: 页面
    let url;
    try {
      url = new URL(origin);
    } catch {
      return false;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (!allowedHostnames.has(url.hostname.replace(/^\[|\]$/g, ""))) return false;
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    return port === listeningPort();
  }

  // ---------- SSE 增量推送(/api/events):纯 node:http,零依赖 ----------
  // 单一采集 tick 服务所有连接:每 1s 读一次 usage 库,出现新样本才推 token /
  // history-append;系统指标按 5s 节奏推(CPU 采样在服务端缓存);无数据时只有
  // 心跳注释行。断线重连(EventSource 自动重连)后先补一次全量快照,再回到增量。
  const sseClients = new Set();
  let lastHistAt = 0;   // 已推送的最新 history 时间戳(增量游标)
  let lastSysAt = 0;    // 上次推送系统指标的时刻
  let sysCache = null;
  let sysCacheAt = 0;
  let collectorTimer = null;
  // V2.5.0 展示层:每源增量游标 + 数据源列表指纹(agents 事件只在列表变化时推送)
  const perHistAt = new Map();
  let lastAgentsFp = null;

  function sseWrite(res, chunk) {
    try {
      res.write(chunk);
      lastRequestAt = Date.now(); // SSE 连接视为活跃,避免空闲自退误杀
    } catch {
      dropClient(res);
    }
  }

  function dropClient(res) {
    if (!sseClients.delete(res)) return;
    try {
      res.end();
    } catch {}
  }

  function broadcast(event, data) {
    const chunk = sseEvent(event, data);
    for (const res of [...sseClients]) sseWrite(res, chunk);
  }

  // CPU 采样含 250ms 睡眠:在推送窗口内缓存,SSE 与 REST 共用同一份
  async function cachedSystemMetrics(ttlMs = SSE_SYS_INTERVAL_MS) {
    if (sysCache && Date.now() - sysCacheAt < ttlMs) return sysCache;
    sysCache = await systemMetrics();
    sysCacheAt = Date.now();
    return sysCache;
  }

  // 连接建立/重连时的全量快照:一次事件带齐 token 全量与系统指标;
  // 多源时附 perProvider(每源各自的当前会话视图,含历史,供分组卡片与对比视图起步)
  async function sendSnapshot(res) {
    const followed = followedSessionId();
    const r = tokenRateQuery(followed.id);
    r.follow = followed;
    const newest = r.history.length ? r.history[r.history.length - 1].completedAt : 0;
    if (newest > lastHistAt) lastHistAt = newest;
    const perProvider = perProviderViews();
    if (perProvider) {
      for (const [id, v] of Object.entries(perProvider)) {
        const hist = Array.isArray(v.history) ? v.history : [];
        const n = hist.length ? hist[hist.length - 1].completedAt : 0;
        perHistAt.set(id, Math.max(perHistAt.get(id) || 0, n));
      }
    }
    sseWrite(
      res,
      sseEvent("snapshot", {
        token: r,
        sys: await cachedSystemMetrics(),
        histWindow: RATE_ENV.window,
        serverTime: Date.now(),
        ...(perProvider ? { perProvider } : {}),
      })
    );
  }

  // 每源视图(仅多源时计算):各源解析自己的当前会话,供分组卡片与对比视图使用。
  // 单源返回 null —— 快照/token 事件与 V2.4.0 逐字节一致,不背多源结构。
  function perProviderViews() {
    const ids = readProviders();
    if (ids.length <= 1) return null;
    const out = {};
    for (const id of ids) {
      try {
        const v = tokenRateQuery(null, { agent: id });
        out[id] = {
          provider: id,
          sessionId: v.sessionId ?? null,
          latest: v.latest ?? null,
          session: v.session ?? null,
          history: Array.isArray(v.history) ? v.history : [],
        };
      } catch (err) {
        // 故障隔离:单源读取失败只影响它自己那格,其余源照常出数
        out[id] = { provider: id, error: err && err.message ? err.message : "读取失败" };
      }
    }
    return out;
  }

  function agentsPayload() {
    return { enabled: readProviders(), agents: agentStatus() };
  }

  // 向单个连接补推一帧 agents 事件(连接建立时用),并以此刷新列表指纹基线
  function sendAgents(res) {
    lastAgentsFp = readProviders().join(",");
    sseWrite(res, sseEvent("agents", agentsPayload()));
  }

  async function collectTick() {
    if (!sseClients.size) return;
    // agents 事件:启用的数据源列表变化时推送(多 → 单也要推,前端据此隐藏切换条)
    const fp = readProviders().join(",");
    if (lastAgentsFp !== null && fp !== lastAgentsFp) {
      broadcast("agents", agentsPayload());
    }
    lastAgentsFp = fp;

    let r;
    try {
      const followed = followedSessionId();
      r = tokenRateQuery(followed.id);
      const newest = r.history.length ? r.history[r.history.length - 1].completedAt : 0;
      let perProvider = null;
      let perNew = false;
      if (readProviders().length > 1) {
        const views = perProviderViews();
        perProvider = {};
        for (const [id, v] of Object.entries(views)) {
          const hist = Array.isArray(v.history) ? v.history : [];
          const cur = perHistAt.get(id) || 0;
          const newestP = hist.length ? hist[hist.length - 1].completedAt : 0;
          for (const h of hist) {
            if (h.completedAt > cur) {
              // 带 provider 字段的增量:旧前端按字段语义忽略,不会混进单源曲线
              broadcast("history-append", { provider: id, item: h });
              perNew = true;
            }
          }
          perHistAt.set(id, Math.max(cur, newestP));
          // token 事件里的每源视图只带 latest/session(稳态增量保持精悍);
          // 历史起点在快照里播种,之后靠上面的 history-append 推进
          perProvider[id] = { provider: id, sessionId: v.sessionId, latest: v.latest, session: v.session };
        }
      }
      if (newest > lastHistAt || perNew) {
        if (newest > lastHistAt) {
          // 只推增量:窗口内比游标新的条目(稳态每条 < 1KB)
          for (const h of r.history) {
            if (h.completedAt > lastHistAt) broadcast("history-append", { item: h });
          }
          lastHistAt = newest;
        }
        // provider/sessionId 为 V2.4.0 多源聚合新增字段(默认单源下 provider 恒为 zcode);
        // sources/agents/perProvider 只在启用多个数据源时才带上,单源路径与 V2.3.0 逐字节一致
        broadcast("token", {
          latest: r.latest,
          session: r.session,
          sessionId: r.sessionId,
          provider: r.provider,
          ...(r.sources ? { sources: r.sources } : {}),
          ...(r.agents ? { agents: r.agents } : {}),
          ...(perProvider ? { perProvider } : {}),
          follow: followed,
        });
      }
    } catch {
      return; // 库未就绪等瞬时错误:等下一个 tick
    }
    if (Date.now() - lastSysAt >= SSE_SYS_INTERVAL_MS) {
      lastSysAt = Date.now();
      try {
        broadcast("sys", await cachedSystemMetrics());
      } catch {}
    }
  }

  function startCollector() {
    if (collectorTimer) return;
    collectorTimer = setInterval(() => {
      collectTick().catch(() => {});
    }, 1000);
    collectorTimer.unref();
  }

  // 心跳:无数据时唯一的连接流量(注释行,零数据载荷)
  const heartbeat = setInterval(() => {
    if (!sseClients.size) return;
    const chunk = sseComment("ping");
    for (const res of [...sseClients]) sseWrite(res, chunk);
  }, SSE_HEARTBEAT_MS);
  heartbeat.unref();

  const server = http.createServer(async (req, res) => {
    lastRequestAt = Date.now();
    // B-01:来源校验先于一切路由,跨站请求一律 403
    if (!hostAllowed(req) || !originAllowed(req)) {
      sendJson(res, 403, { error: "仅接受本机同源请求" });
      return;
    }
    // B-01:POST 只收 JSON(CORS 简单请求带不了这个 Content-Type)
    if (req.method === "POST" && !isJsonContentType(req.headers["content-type"])) {
      sendJson(res, 415, { error: "POST 仅接受 Content-Type: application/json" });
      return;
    }
    if (req.url === "/" || req.url.startsWith("/index")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(renderIndex());
      return;
    }
    if (req.url.startsWith("/api/config")) {
      if (req.method === "GET") {
        try {
          const cfg = readConfigStrict();
          sendJson(res, 200, {
            appearance: readAppearance(),
            stopHookLine: cfg.stopHookLine,
            tokenRateLine: cfg.tokenRateLine,
            configFile: CONFIG_FILE,
            providers: readProviders(),
            focusAgent: readFocusAgent(),
          });
        } catch (err) {
          sendJson(res, 500, { error: err.message });
        }
        return;
      }
      if (req.method === "POST") {
        try {
          const raw = await readBody(req);
          let body;
          try {
            body = JSON.parse(raw || "{}");
          } catch {
            sendJson(res, 400, { error: "请求体不是合法 JSON" });
            return;
          }
          const patch = body.appearance;
          const providerPatch = body.providers;
          const focusPatch = body.focusAgent === undefined ? undefined : body;
          if (!patch && providerPatch === undefined && focusPatch === undefined) {
            sendJson(res, 400, { error: "缺少 appearance 对象、providers 数组或 focusAgent" });
            return;
          }
          if (patch !== undefined && (typeof patch !== "object" || patch === null)) {
            sendJson(res, 400, { error: "appearance 必须是对象" });
            return;
          }
          // 三段补写相互独立:只传其中一段也能用(多源开关与聚焦走同一端点)
          const out = { ok: true };
          if (patch) out.appearance = patchAppearance(patch);
          if (providerPatch !== undefined) out.providers = patchProviders(providerPatch);
          if (focusPatch !== undefined) out.focusAgent = patchFocusAgent(focusPatch);
          sendJson(res, 200, out);
        } catch (err) {
          if (err && err.fieldErrors) {
            sendJson(res, 400, { error: err.message, fieldErrors: err.fieldErrors });
          } else {
            sendJson(res, 500, { error: err.message });
          }
        }
        return;
      }
      sendJson(res, 405, { error: "仅支持 GET / POST" });
      return;
    }
    // V2.5.0 展示层:已启用的数据源及其探测结果、会话列表(切换条 / 分组卡片 / 会话切换器共用)
    if (req.url.startsWith("/api/agents")) {
      try {
        sendJson(res, 200, agentsPayload());
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return;
    }
    if (req.url.startsWith("/api/events")) {
      if (req.method !== "GET") {
        sendJson(res, 405, { error: "仅支持 GET" });
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-store",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // 反代场景禁用缓冲
      });
      res.write(sseRetry(2000)); // 断线后 2s 重连(EventSource 默认约 3s)
      res.on("close", () => dropClient(res));
      sseClients.add(res);
      startCollector();
      // 重连先推全量快照,之后只走增量;多源时再补一帧 agents 事件(切换条数据源)
      sendSnapshot(res).catch(() => {});
      if (readProviders().length > 1) {
        try { sendAgents(res); } catch {}
      } else {
        lastAgentsFp = readProviders().join(",");
      }
      return;
    }
    if (req.url.startsWith("/api/metrics")) {
      try {
        const s = await snapshot();
        s.system = await cachedSystemMetrics(); // CPU 采样窗口内缓存,免去每次 250ms 睡眠
        sendJson(res, 200, s);
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return;
    }
    if (req.url.startsWith("/api/token-rate")) {
      try {
        // V2.5.0:可选作用域参数(additive)。agent 圈定单一数据源("all" = 聚合),
        // session 圈定会话;不带参数时与 V2.4.0 行为一致(跟随会话 + 按 providers 聚合)。
        // 聚焦单一源且未显式给会话时,由该源自己解析"当前会话"——zcode 仍跟随会话文件
        // (与 V2.4.0 的 zcode 行为一致),第三方源的会话 id 与 zcode 不同,不能借用。
        const u = new URL(req.url, "http://127.0.0.1");
        const agentParam = u.searchParams.get("agent");
        if (agentParam && agentParam !== "all" && !isKnownProviderId(agentParam)) {
          sendJson(res, 400, { error: `未知的数据源:${agentParam}` });
          return;
        }
        const followed = followedSessionId();
        const session = u.searchParams.get("session");
        const scoped = Boolean(agentParam) && agentParam !== "all";
        const sid = scoped && !session && agentParam !== "zcode"
          ? null
          : (session || followed.id);
        const r = tokenRateQuery(sid, {
          agent: scoped ? agentParam : null,
        });
        r.follow = followed;
        sendJson(res, 200, r);
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
  });

  function writePid() {
    try {
      fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
      fs.writeFileSync(PID_FILE, String(process.pid));
    } catch {}
  }

  // 空闲自退巡检:取空闲阈值的一半作为巡检间隔(夹紧在 1s~60s)
  let idleTimer = null;
  function startIdleWatch() {
    if (IDLE_EXIT_MIN <= 0) return;
    const tick = Math.min(60000, Math.max(1000, (IDLE_EXIT_MIN * 60 * 1000) / 2));
    idleTimer = setInterval(() => {
      if (Date.now() - lastRequestAt > IDLE_EXIT_MIN * 60 * 1000) {
        close();
        setTimeout(() => process.exit(0), 2000).unref();
      }
    }, tick);
    idleTimer.unref();
  }

  function close() {
    if (collectorTimer) clearInterval(collectorTimer);
    collectorTimer = null;
    if (idleTimer) clearInterval(idleTimer);
    idleTimer = null;
    clearInterval(heartbeat);
    for (const res of [...sseClients]) {
      try {
        res.end();
      } catch {}
    }
    sseClients.clear();
    cleanupPidFile();
    try {
      server.close();
    } catch {}
  }

  return {
    server,
    // 监听并解析实际端口(port=0 时由系统分配);resolve { port, url }
    start() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(opts.port || 0, host, () => {
          listening = true;
          const port = server.address().port;
          if (opts.writePidFile) writePid();
          startIdleWatch();
          resolve({ port, url: `http://${host}:${port}/` });
        });
      });
    },
    get listening() {
      return listening;
    },
    close,
  };
}

// 便捷入口:创建并立即监听
export async function startDashboardServer(opts = {}) {
  const app = createDashboardServer(opts);
  const info = await app.start();
  return { ...app, ...info };
}
