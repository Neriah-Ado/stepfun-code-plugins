// 采集核心:CLI(scripts/collect.mjs)与 MCP server(mcp/tps-server.mjs)共用。
// 零第三方依赖,要求 Node >= 18(全局 fetch)。

import os from "node:os";

// ---------- 工具 ----------

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

export function resolveUrl(env = process.env) {
  // 未配置的 user_config 占位符原样传入时视为未配置
  const url = (env.TPS_URL || "").trim();
  if (!url || url.startsWith("${")) return null;
  return url;
}

// ---------- 演示数据(随机游走,数值连续且逼真) ----------

const demo = { tps: 820, p50: 12.4, err: 0.12 };

function demoStep() {
  demo.tps = clamp(demo.tps + (Math.random() * 120 - 60), 240, 1560);
  demo.p50 = clamp(demo.p50 + (Math.random() * 2 - 1), 6, 40);
  demo.err = clamp(demo.err + (Math.random() * 0.08 - 0.04), 0.01, 2.5);
  return {
    tps: Math.round(demo.tps),
    p50: r1(demo.p50),
    p95: r1(demo.p50 * 2.6),
    p99: r1(demo.p50 * 4.1),
    errorRate: r2(demo.err),
  };
}

// ---------- 远程接口(字段名宽松匹配,支持一层嵌套) ----------

const TPS_KEYS = ["tps", "qps", "throughput", "transactionsPerSecond"];
const LAT_KEYS = { p50: ["p50", "latency_p50"], p95: ["p95", "latency_p95"], p99: ["p99", "latency_p99"] };
const ERR_KEYS = ["error_rate", "errorRate", "err_rate"];

function deepFind(obj, keys, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 3) return undefined;
  for (const k of keys) {
    if (typeof obj[k] === "number" && isFinite(obj[k])) return obj[k];
  }
  for (const v of Object.values(obj)) {
    const hit = deepFind(v, keys, depth + 1);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

export async function fetchRemoteMetrics(url, timeoutMs = 5000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { signal: ac.signal, headers: { Accept: "application/json" } });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const tps = deepFind(data, TPS_KEYS);
  if (tps === undefined) throw new Error("响应中未找到 tps/qps 字段");
  return {
    tps: Math.round(tps),
    p50: deepFind(data, LAT_KEYS.p50) ?? null,
    p95: deepFind(data, LAT_KEYS.p95) ?? null,
    p99: deepFind(data, LAT_KEYS.p99) ?? null,
    errorRate: deepFind(data, ERR_KEYS) ?? null,
  };
}

// ---------- 本机系统资源(Windows 下 loadavg 恒为 0,用 CPU 时间差采样) ----------

function cpuTimes() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) {
    idle += c.times.idle;
    total += c.times.idle + c.times.user + c.times.nice + c.times.sys + c.times.irq;
  }
  return { idle, total };
}

export async function sampleCpuPercent(intervalMs = 250) {
  const a = cpuTimes();
  await new Promise((r) => setTimeout(r, intervalMs));
  const b = cpuTimes();
  const dIdle = b.idle - a.idle, dTotal = b.total - a.total;
  if (dTotal <= 0) return null;
  return r1(clamp((1 - dIdle / dTotal) * 100, 0, 100));
}

// 系统指标:CPU 采样含 250ms 睡眠,调用方(SSE 采集器)需在窗口内缓存复用
export async function systemMetrics() {
  const cpus = os.cpus().length;
  const cpuPercent = await sampleCpuPercent();
  const totalMB = os.totalmem() / 1048576;
  const freeMB = os.freemem() / 1048576;
  return {
    cpuPercent,
    cpuCores: cpus,
    memTotalMB: Math.round(totalMB),
    memUsedMB: Math.round(totalMB - freeMB),
    memPercent: r1(((totalMB - freeMB) / totalMB) * 100),
    hostUptimeHours: r1(os.uptime() / 3600),
    platform: `${os.platform()}/${os.arch()}`,
  };
}

// ---------- 快照与采样 ----------

export async function snapshot(env = process.env) {
  const url = resolveUrl(env);
  let m, mode;
  if (url) {
    try {
      m = await fetchRemoteMetrics(url);
      mode = "remote";
    } catch (err) {
      m = demoStep();
      mode = `demo(接口不可用: ${err.message},已回退演示数据)`;
    }
  } else {
    m = demoStep();
    mode = "demo";
  }
  return { time: new Date().toISOString(), mode, ...m, system: await systemMetrics() };
}

export async function watch(seconds, env = process.env) {
  const n = clamp(Math.round(seconds || 5), 2, 60);
  const url = resolveUrl(env);
  const samples = [];
  let mode = url ? "remote" : "demo";
  let fallbackNote = null;
  for (let i = 0; i < n; i++) {
    if (url && mode === "remote") {
      try {
        const m = await fetchRemoteMetrics(url, 3000);
        samples.push(m);
      } catch (err) {
        mode = "demo";
        fallbackNote = `接口不可用(${err.message}),已回退演示数据`;
        samples.push(demoStep());
      }
    } else {
      samples.push(demoStep());
    }
    if (i < n - 1) await new Promise((r) => setTimeout(r, 1000));
  }
  const tpsArr = samples.map((s) => s.tps).sort((a, b) => a - b);
  const stat = (arr, q) => arr[Math.min(arr.length - 1, Math.floor(arr.length * q))];
  const avg = (f) => r1(samples.reduce((s, x) => s + (x[f] ?? 0), 0) / samples.filter((x) => x[f] != null).length);
  return {
    time: new Date().toISOString(),
    mode: fallbackNote ? `demo(${fallbackNote})` : mode,
    seconds: n,
    count: samples.length,
    tps: { avg: Math.round(avg("tps")), min: tpsArr[0], max: tpsArr[tpsArr.length - 1] },
    p95avg: avg("p95"),
    p99avg: avg("p99"),
    errorRateAvg: r2(avg("errorRate")),
    samples,
  };
}

// ---------- 多 agent 聚合查询层(V2.4.0) ----------
// 把「按配置并发/顺序采集各客户端的本地用量数据 → 归一化 → 合并成一份视图」
// 收在这一层,上层(CLI / 大屏 / MCP / Electron 悬浮条)只认同一组入口:
//   aggregateRate / aggregateTurn / agentStatus
// 设计约束(来自 V2.4.0 计划):
//   - 默认 providers=["zcode"] 时走原路径(openUsageDb().query()/queryTurn()),
//     与 V2.3.0 输出逐字节一致,只在结果上多一个 provider 字段,不引入额外开销;
//   - 第三方源(Claude Code / Codex / OpenCode / Cline)一律 detect 闸门:没装就
//     跳过并记原因,数据损坏只让那一个源不可用,其余源照常出数(故障隔离);
//   - 全部只读本地文件,不联网;JSONL 只在命令/大屏/MCP 按需读取,带增量游标缓存。

import { readConfig } from "./config.mjs";
import { buildRateView, buildTurnView } from "./providers/common.mjs";
import { PROVIDER_LABELS, createProvider, enabledProviderIds, normalizeProviderIds } from "./providers/index.mjs";

// 合并视图时单个源最多取多少条归一化记录(足够覆盖窗口与近万级会话统计)
const MAX_MERGE_RECORDS = 5000;

const errMsg = (err) => (err && err.message ? err.message : String(err));

// 单 zcode 源 → 原路径:不探测、不合并、不读配置文件以外的东西
const isFastPath = (ids) => ids.length === 1 && ids[0] === "zcode";

// agent 显式指定时只走那一个源(可用于 /tps --agent claude-code);
// cfg 传 null 表示「不看配置文件」,缺省(undefined)时才读一次配置文件。
function resolveIds(agent, cfg, env) {
  if (agent) return normalizeProviderIds([agent]);
  return enabledProviderIds(cfg === undefined ? readConfig() : cfg, env);
}

function safeCall(fn, fallback = null) {
  try {
    const v = fn();
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

// 探测单个源:返回 { id, provider, installed, detected, reason }
// provider 为 null 表示这个源完全不可用(未知 id / 构造失败),reason 说明原因。
function probeProvider(id, env) {
  let p = null;
  try {
    p = createProvider(id, { env });
  } catch (err) {
    return { id, provider: null, installed: null, detected: false, reason: `数据源初始化失败:${errMsg(err)}` };
  }
  if (!p) return { id, provider: null, installed: null, detected: false, reason: `未知的 provider:${id}` };
  const installed = safeCall(() => (typeof p.installed === "function" ? p.installed() : null));
  // 宿主自己的库不设闸门:缺失/损坏按 V2.3.0 语义抛错,由调用方既有方式降级
  if (p.strictRead) return { id, provider: p, installed, detected: true, reason: null };
  const detected = safeCall(() => Boolean(p.detect()), false);
  if (detected) return { id, provider: p, installed, detected: true, reason: null };
  return {
    id,
    provider: p,
    installed,
    detected: false,
    reason: installed ? "已安装该客户端,但本地还没有会话数据" : "未检测到该客户端的数据目录",
  };
}

// 附加字段:provider 始终有(单源时即该源 id);sources/agents 只在多源时出现,
// 免得默认配置下给每个消费者平白多背两份结构。
function tag(view, providerId, sources, agents) {
  const out = { ...view, provider: providerId };
  if (sources) out.sources = sources;
  if (agents) out.agents = agents;
  return out;
}

function sourceEntry(probe, extra) {
  const p = probe.provider;
  return {
    provider: probe.id,
    label: p ? p.label : PROVIDER_LABELS[probe.id] || probe.id,
    ok: Boolean(probe.detected),
    format: p ? p.format : null,
    ...(probe.reason ? { reason: probe.reason } : {}),
    ...extra,
  };
}

/** 速率视图(窗口内最近请求 + 会话累计 + 历史曲线)。 */
export function aggregateRate({ sessionId = null, agent = null, cfg, env = process.env } = {}) {
  const ids = resolveIds(agent, cfg, env);
  if (isFastPath(ids)) {
    const p = createProvider("zcode", { env });
    return tag(p.rate(sessionId), "zcode");
  }
  const sources = [];
  const agents = [];
  const records = [];
  let primary = null;
  let firstError = null;
  for (const id of ids) {
    const probe = probeProvider(id, env);
    if (!probe.provider) {
      sources.push({ provider: id, ok: false, ...(probe.reason ? { reason: probe.reason } : {}) });
      continue;
    }
    const p = probe.provider;
    agents.push({ provider: id, label: p.label, capabilities: p.capabilities });
    if (!probe.detected) {
      sources.push(sourceEntry(probe));
      continue;
    }
    let sid = null;
    let count = 0;
    try {
      sid = sessionId || safeCall(() => p.currentSessionId());
      const list = p.getUsage(sid, { limit: MAX_MERGE_RECORDS }) || [];
      count = list.length;
      for (const r of list) records.push(r);
      if (!primary) primary = { id, sid };
    } catch (err) {
      if (!firstError) firstError = err;
      sources.push(sourceEntry(probe, { ok: false, reason: `数据读取失败:${errMsg(err)}` }));
      continue;
    }
    sources.push(sourceEntry(probe, { sessionId: sid, samples: count }));
  }
  // 归一化后合并:按完成时间倒序,再走与单源完全相同的窗口/会话统计构造
  records.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  const view = buildRateView(records, {
    sessionId: primary ? primary.sid : sessionId,
    scoped: sessionId ? "explicit" : "auto", // 与 usage-db.mjs resolveSession 的取值一致
  });
  if (!primary && firstError) throw firstError;
  return tag(view, primary ? primary.id : null, sources, agents);
}

/** 本轮视图(一次用户轮次的全部请求)。多源时取「最近一个有本轮数据的源」。 */
export function aggregateTurn({ sessionId = null, agent = null, current = false, cfg, env = process.env } = {}) {
  const ids = resolveIds(agent, cfg, env);
  if (isFastPath(ids)) {
    const p = createProvider("zcode", { env });
    return tag(p.turn(sessionId, { current }), "zcode");
  }
  const sources = [];
  const agents = [];
  let primary = null;
  let newest = null;
  let firstError = null;
  for (const id of ids) {
    const probe = probeProvider(id, env);
    if (!probe.provider) {
      sources.push({ provider: id, ok: false, ...(probe.reason ? { reason: probe.reason } : {}) });
      continue;
    }
    const p = probe.provider;
    agents.push({ provider: id, label: p.label, capabilities: p.capabilities });
    if (!probe.detected) {
      sources.push(sourceEntry(probe));
      continue;
    }
    let sid = null;
    let view = null;
    try {
      sid = sessionId || safeCall(() => p.currentSessionId());
      view = p.turn(sid, { current });
    } catch (err) {
      if (!firstError) firstError = err;
      sources.push(sourceEntry(probe, { ok: false, reason: `数据读取失败:${errMsg(err)}` }));
      continue;
    }
    const lastAt = view && view.turn ? view.turn.lastAt : null;
    if (!primary) primary = { id, view, sid };
    if (lastAt != null && (!newest || lastAt > newest.lastAt)) newest = { id, view, sid, lastAt };
    sources.push(sourceEntry(probe, { sessionId: sid, turnId: view ? view.turnId : null, lastAt }));
  }
  const chosen = newest || primary;
  if (!chosen) {
    if (firstError) throw firstError;
    return tag({ sessionId: sessionId ?? null, turnId: null, turn: null, session: null }, null, sources, agents);
  }
  return tag(chosen.view, chosen.id, sources, agents);
}

/**
 * 每个启用源的可用性(doctor 多源自检 / 大屏「数据源」面板 / MCP 的作用域字段共用)。
 * 逐源独立探测与试读:任一源损坏只影响它自己那一项,不影响其他源的结论。
 */
export function agentStatus({ cfg, env = process.env } = {}) {
  const ids = enabledProviderIds(cfg === undefined ? readConfig() : cfg, env);
  const out = [];
  for (const id of ids) {
    const probe = probeProvider(id, env);
    const entry = {
      provider: id,
      label: probe.provider ? probe.provider.label : PROVIDER_LABELS[id] || id,
      source: probe.provider ? probe.provider.dataDir : null,
      format: probe.provider ? probe.provider.format : null,
      capabilities: probe.provider ? probe.provider.capabilities : null,
      installed: probe.installed,
      detected: Boolean(probe.detected),
      ok: false,
      reason: probe.reason,
      sessionId: null,
      sessions: null,
      samples: null,
      lastAt: null,
      note: probe.provider ? probe.provider.note || null : null,
    };
    const p = probe.provider;
    if (p && probe.detected) {
      try {
        const sessions = p.listSessions(20) || [];
        entry.sessions = sessions.length;
        entry.lastAt = sessions.length ? sessions[0].lastAt ?? null : null;
        // sessionList 是 V2.5.0 展示层的最小补齐:大屏「会话切换器」要列出可选会话,
        // 这里顺手保留探测时已取到的列表(≤10 条),不产生额外读取。
        entry.sessionList = sessions.slice(0, 10);
        const sid = safeCall(() => p.currentSessionId());
        entry.sessionId = sid ?? null;
        entry.samples = sid ? (p.getUsage(sid, { limit: MAX_MERGE_RECORDS }) || []).length : 0;
        entry.ok = true;
        entry.reason = null;
      } catch (err) {
        entry.ok = false;
        entry.reason = `数据读取失败:${errMsg(err)}`;
      }
    }
    out.push(entry);
  }
  return out;
}

// ---------- 人类可读输出 ----------

const GB = (mb) => (mb / 1024).toFixed(1);

export function formatSnapshot(s) {
  const t = s.time.replace("T", " ").slice(0, 19);
  const lines = [
    `⏱ TPS 监控快照  ${t}   [模式: ${s.mode}]`,
    `  TPS(当前)         : ${s.tps}`,
    `  延迟 p50/p95/p99   : ${s.p50 ?? "-"} / ${s.p95 ?? "-"} / ${s.p99 ?? "-"} ms`,
    `  错误率             : ${s.errorRate ?? "-"} %`,
    `  —— 系统资源 ——`,
    `  CPU                : ${s.system.cpuPercent ?? "-"} %  (${s.system.cpuCores} 核)`,
    `  内存               : ${GB(s.system.memUsedMB)} / ${GB(s.system.memTotalMB)} GB (${s.system.memPercent} %)`,
    `  主机运行时长       : ${s.system.hostUptimeHours} 小时  (${s.system.platform})`,
  ];
  return lines.join("\n");
}

export function formatWatch(w) {
  const t = w.time.replace("T", " ").slice(0, 19);
  const head = `⏱ TPS 采样报告  ${t}   [模式: ${w.mode}]  采样 ${w.count} 次 × 1s`;
  const rows = w.samples.map((s, i) => `  #${String(i + 1).padStart(2, "0")}  tps=${String(s.tps).padEnd(6)} p95=${String(s.p95 ?? "-").padEnd(6)} err=${s.errorRate ?? "-"}%`);
  const stat = [
    `  —— 统计 ——`,
    `  TPS 平均/最小/最大  : ${w.tps.avg} / ${w.tps.min} / ${w.tps.max}`,
    `  p95 均值           : ${w.p95avg} ms`,
    `  p99 均值           : ${w.p99avg} ms`,
    `  错误率均值         : ${w.errorRateAvg} %`,
  ];
  return [head, ...rows, ...stat].join("\n");
}
