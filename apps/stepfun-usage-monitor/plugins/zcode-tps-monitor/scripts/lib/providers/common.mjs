// 多 agent Provider 公共层(V2.4.0):归一化记录、速率视图构建、JSONL 增量游标。
//
// 各客户端工具(Claude Code / Codex / OpenCode / Cline)的本地用量数据格式互不相同,
// 但监控口径只有一套。本模块把它们统一归一成 UsageRecord,再按与 usage-db.mjs
// 完全一致的公式构建速率视图:
//   - 速率分子 = 输出 token + 思考 token;分母 = 纯生成耗时(完成时刻 - 首 token 时刻)
//   - 有效样本区间 [TOKEN_RATE_MIN_MS, TOKEN_RATE_MAX_MS),区间外只计入累计、不产速率
//   - 会话累计取全部记录(不受展示窗口限制);窗口统计/头条取最近 TOKEN_RATE_WINDOW 条
//   - 本轮 = 记录里最新的 turnKey(一次用户提问触发的全部请求)
// 口径常量与 usage-db.mjs 共用本文件这份定义,避免两处漂移。
//
// 硬约束:零第三方依赖、只读本地文件、不联网。JSONL 解析只发生在命令/大屏/MCP 的
// 按需读取里(带增量游标缓存),钩子热路径只走 zcode 源,不调用本模块的解析函数。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------- 统计口径(与 usage-db.mjs 共用,模块加载时读取) ----------

export const RATE_ENV = {
  window: Number(process.env.TOKEN_RATE_WINDOW) || 5, // 统计窗口(均/峰/头条)
  hist: Number(process.env.TOKEN_RATE_HIST) || 60, // 曲线历史点数
  minGenMs: Number(process.env.TOKEN_RATE_MIN_MS) || 200, // 有效样本:最短生成耗时
  maxGenMs: Number(process.env.TOKEN_RATE_MAX_MS) || 3_600_000, // 有效样本:最长生成耗时(1h)
};

// 单个数据文件保留的记录上限:超长会话只保留最近若干条(JSONL 追加写,旧记录在头部)
export const MAX_SOURCE_RECORDS = 20000;

// 用"与上一条记录的时间差"估算单段纯生成耗时的上限。超过它说明中间夹着长耗时
// 工具调用或用户长时间离开,时间差已不代表生成耗时 —— 宁可判未知(该记录只计入
// 累计、不产速率),也不拿一个离谱的小速率去污染均值和头条。
export const MAX_GAP_ESTIMATE_MS = 120_000;

// 钩子写入的"最后所处会话/提问时刻"状态文件;--current 守卫与跨源圈定都用它
export const STATE_FILE = "tps-monitor.last-session.json";

/** 最近一次用户提问的时间戳(prompt-submit 钩子写入);读不到返回 null。 */
export function lastPromptTs(home = os.homedir()) {
  try {
    const st = JSON.parse(fs.readFileSync(path.join(home, ".zcode", STATE_FILE), "utf8"));
    return Number.isFinite(st.ts) ? st.ts : null;
  } catch {
    return null;
  }
}

// ---------- 字段提取(各客户端字段名五花八门,统一在这里认领) ----------

const OUT_KEYS = ["output_tokens", "outputTokens", "tokensOut", "completion_tokens"];
const REASONING_KEYS = ["reasoning_tokens", "reasoningTokens", "reasoning_output_tokens", "thinking_tokens"];
const IN_KEYS = ["input_tokens", "inputTokens", "tokensIn", "prompt_tokens"];
// genMs / cacheRead 是各 Provider 自己传进来的规范字段名(见本文件 makeRecord 的入参),
// 必须和客户端原始字段名并列认领,否则归一化时这两项会被抹成 null
const CACHE_KEYS = ["cache_read_input_tokens", "cacheReadInputTokens", "cached_input_tokens", "cache_read_tokens", "cacheRead"];
const TTFT_KEYS = ["time_to_first_token_ms", "timeToFirstTokenMs", "ttft_ms", "ttftMs"];
const DURATION_KEYS = [
  "duration_ms", "durationMs", "latency_ms", "latencyMs",
  "generation_ms", "generationMs", "output_duration_ms", "elapsed_ms", "elapsedMs", "genMs",
];

// 依次在对象自身与若干常见容器里找字段(usage / tokens / info.last_token_usage …)
export function pickNumber(obj, keys, containers = []) {
  if (!obj || typeof obj !== "object") return null;
  for (const c of containers) {
    const nested = obj[c];
    if (nested && typeof nested === "object") {
      for (const k of keys) {
        const v = nested[k];
        if (typeof v === "number" && Number.isFinite(v)) return v;
      }
    }
  }
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

const TOKEN_CONTAINERS = ["usage", "tokens", "token_usage", "last_token_usage", "total_token_usage"];

/** 时间戳:ISO 字符串或 epoch 毫秒都认;取不到返回 null。 */
export function pickTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return ms;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * 显式记录的单段"纯生成耗时"(各客户端字段名不同);取不到返回 null。
 * 取不到时由调用方退回"与上一条记录的时间差"估算。
 */
export function explicitDurationMs(...objs) {
  for (const o of objs) {
    const v = pickNumber(o, DURATION_KEYS);
    if (typeof v === "number" && v > 0) return v;
  }
  return null;
}

// ---------- 归一化记录 ----------

/**
 * 构造一条归一化记录(所有 Provider 的 getUsage 都返回这种形状)。
 * 速率与有效性与 usage-db.mjs 的 toItem 同口径:分子含思考 token,
 * 生成耗时不在 [minGenMs, maxGenMs) 内或产出为 0 时 tokPerSec = null(仍计入累计)。
 */
export function makeRecord(raw) {
  const outputTokens = Math.max(0, Math.round(pickNumber(raw, OUT_KEYS, TOKEN_CONTAINERS) ?? 0));
  const reasoningTokens = Math.max(0, Math.round(pickNumber(raw, REASONING_KEYS, TOKEN_CONTAINERS) ?? 0));
  const inputTokens = Math.max(0, Math.round(pickNumber(raw, IN_KEYS, TOKEN_CONTAINERS) ?? 0));
  const cacheRead = Math.max(0, Math.round(pickNumber(raw, CACHE_KEYS, TOKEN_CONTAINERS) ?? 0));
  const ttftRaw = pickNumber(raw, TTFT_KEYS, TOKEN_CONTAINERS);
  const genMsRaw = pickNumber(raw, DURATION_KEYS, TOKEN_CONTAINERS);
  const genMs = typeof genMsRaw === "number" && genMsRaw > 0 ? Math.round(genMsRaw) : null;
  const ttftMs = typeof ttftRaw === "number" && Number.isFinite(ttftRaw) ? Math.round(ttftRaw) : null;
  const rateTokens = outputTokens + reasoningTokens;
  const valid =
    genMs != null && genMs >= RATE_ENV.minGenMs && genMs < RATE_ENV.maxGenMs && rateTokens > 0;
  return {
    provider: raw.provider ?? null,
    sessionId: raw.sessionId ?? null,
    // 轮次分组键:一次用户提问触发的全部请求(Claude Code 用消息 id 链,Codex 用 turn 事件)
    turnKey: raw.turnKey ?? null,
    requestId: raw.requestId ?? null,
    model: raw.model ?? null,
    outputTokens,
    reasoningTokens,
    inputTokens,
    cacheRead,
    ttftMs,
    genMs,
    tokPerSec: valid ? Math.round((rateTokens / genMs) * 10000) / 10 : null,
    completedAt: Number(raw.completedAt) || 0,
  };
}

/** 记录 → 展示项(与 usage-db.mjs toItem 的输出字段一一对应)。 */
export function toViewItem(r) {
  return {
    model: r.model ?? null,
    outputTokens: r.outputTokens ?? 0,
    reasoningTokens: r.reasoningTokens ?? 0,
    inputTokens: r.inputTokens ?? 0,
    cacheRead: r.cacheRead ?? 0,
    ttftMs: r.ttftMs ?? null,
    genMs: r.genMs ?? null,
    tokPerSec: r.tokPerSec ?? null,
    completedAt: r.completedAt ?? 0,
  };
}

/** 会话累计:样本数来自窗口内的有效记录,累计值取全部记录(不受窗口限制)。 */
function sessionAggregate(rated, all) {
  return {
    samples: rated.length,
    requests: all.length,
    avg: Math.round((rated.reduce((s, i) => s + i.tokPerSec, 0) / rated.length) * 10) / 10,
    max: Math.max(...rated.map((i) => i.tokPerSec)),
    min: Math.min(...rated.map((i) => i.tokPerSec)),
    totalOutput: all.reduce((s, i) => s + (i.outputTokens ?? 0), 0),
    totalReasoning: all.reduce((s, i) => s + (i.reasoningTokens ?? 0), 0),
    totalInput: all.reduce((s, i) => s + (i.inputTokens ?? 0), 0),
    totalCacheRead: all.reduce((s, i) => s + (i.cacheRead ?? 0), 0),
  };
}

/**
 * 由归一化记录构建速率视图(与 usage-db.mjs query() 返回同构)。
 * records 新→旧;allRecords 为会话累计口径,默认等同 records。
 */
export function buildRateView(records, opts = {}) {
  const items = records.slice(0, RATE_ENV.hist).slice(0, RATE_ENV.window).map(toViewItem);
  const rated = items.filter((i) => i.tokPerSec != null);
  // 头条优先取最近一条有效记录,避免在途/缺字段行顶掉头条
  const latest = rated[0] ?? items[0] ?? null;
  const all = opts.allRecords || records;
  return {
    sessionId: opts.sessionId ?? null,
    scoped: opts.scoped || "explicit",
    latest,
    session: rated.length ? sessionAggregate(rated, all) : null,
    history: items.slice().reverse(),
  };
}

/**
 * 由归一化记录构建本轮视图(与 usage-db.mjs queryTurn() 返回同构)。
 * opts.current 打开 --current 守卫:最新轮次全部早于本次提问时刻时不当作"本问"。
 */
export function buildTurnView(records, opts = {}) {
  const sid = opts.sessionId ?? null;
  if (!sid) return { sessionId: null, turnId: null, turn: null, session: null };
  const session = buildRateView(records, { sessionId: sid }).session;
  const turnKey = records.length ? records[0].turnKey : null;
  if (!turnKey) return { sessionId: sid, turnId: null, turn: null, session };
  // 同轮次记录按时间正序(JSONL 读到的是倒序)
  const turnRecords = records.filter((r) => r.turnKey === turnKey).sort((a, b) => a.completedAt - b.completedAt);
  if (!turnRecords.length) return { sessionId: sid, turnId: turnKey, turn: null, session };
  if (opts.current) {
    const ts = opts.lastPromptTs ?? null;
    const lastAt = Math.max(...turnRecords.map((r) => r.completedAt ?? 0));
    if (ts && lastAt < ts) {
      return { sessionId: sid, turnId: turnKey, turn: null, noCurrentTurnData: true, session };
    }
  }
  const items = turnRecords.map(toViewItem);
  const rated = items.filter((i) => i.tokPerSec != null);
  const totalTok = rated.reduce((s, i) => s + i.outputTokens + i.reasoningTokens, 0);
  const genMs = rated.reduce((s, i) => s + (i.genMs ?? 0), 0);
  const turn = {
    requests: items.length,
    rated: rated.length,
    ttftMs: items[0].ttftMs, // 本轮第一段的首字延迟
    firstAt: items[0].completedAt,
    lastAt: items[items.length - 1].completedAt,
    genMs,
    totalOutput: items.reduce((s, i) => s + i.outputTokens, 0),
    totalReasoning: items.reduce((s, i) => s + i.reasoningTokens, 0),
    // 本轮即时速率:总产出 / 总纯生成时长(按段加权,排除段间工具等待)
    tokPerSec: genMs >= RATE_ENV.minGenMs && totalTok > 0 ? Math.round((totalTok / genMs) * 10000) / 10 : null,
    peak: rated.length ? Math.max(...rated.map((i) => i.tokPerSec)) : null,
  };
  return { sessionId: sid, turnId: turnKey, turn, session };
}

// ---------- 文件系统工具 ----------

/** 数据目录解析:插件自有环境变量优先,其次客户端官方变量,最后默认相对主目录路径。 */
export function resolveDataRoot(env = process.env, pluginVar, officialVar, rel) {
  for (const name of [pluginVar, officialVar]) {
    const raw = name ? env[name] : null;
    if (typeof raw === "string" && raw.trim()) return path.resolve(raw.trim());
  }
  return path.join(os.homedir(), ...rel);
}

export function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

// 目录扫描缓存:detect()/currentSessionId() 每条查询都会调,给个短 TTL 避免反复遍历
const scanCache = new Map();
const SCAN_TTL_MS = 2000;

/** 递归列出目录下所有 .jsonl(按路径排序);目录不存在返回 []。 */
export function scanJsonlFiles(dir, ext = ".jsonl") {
  let mtime = 0;
  try {
    mtime = fs.statSync(dir).mtimeMs;
  } catch {
    scanCache.delete(dir);
    return [];
  }
  const hit = scanCache.get(dir);
  const now = Date.now();
  if (hit && hit.mtime === mtime && now - hit.at < SCAN_TTL_MS) return hit.files;
  const files = [];
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith(ext)) files.push(p);
    }
  };
  walk(dir);
  files.sort();
  scanCache.set(dir, { at: now, mtime, files });
  return files;
}

/** 目录下修改时间最新的 .jsonl( Codex/Claude Code 的"当前会话"便宜解析)。 */
export function newestJsonl(dir, ext = ".jsonl") {
  let best = null;
  let bestAt = -1;
  for (const f of scanJsonlFiles(dir, ext)) {
    let at = 0;
    try {
      at = fs.statSync(f).mtimeMs;
    } catch {
      continue;
    }
    if (at > bestAt) {
      bestAt = at;
      best = f;
    }
  }
  return best;
}

// ---------- JSONL 增量游标 ----------

function readRange(file, start, end) {
  const fd = fs.openSync(file, "r");
  try {
    const len = end - start;
    if (len <= 0) return "";
    const buf = Buffer.allocUnsafe(len);
    fs.readSync(fd, buf, 0, len, start);
    return buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 建一个 JSONL 读取器:同一进程内重复读同一文件只解析新增字节。
 * parseLine(obj, state) 返回归一化记录或 null;state 由调用方自行维护
 * (如轮次分组),随游标一起缓存在进程内,追加写时能接着上次的状态继续。
 * 假设文件只追加不改写:长度变短视为重新开始(从头解析)。
 * 单行损坏(截断的半行/非法 JSON)只跳过该行,不影响其余记录 —— 故障隔离的一环。
 *
 * 返回 { read, peek }:peek 只查缓存不读盘,供"已解析过才报样本数"这类省事调用。
 */
export function createJsonlReader(parseLine) {
  const cache = new Map();
  const read = (file) => {
    let stat = null;
    try {
      stat = fs.statSync(file);
    } catch {
      return { records: [], state: {} };
    }
    let entry = cache.get(file);
    if (!entry || entry.size > stat.size) {
      entry = { size: 0, records: [], state: {} };
    }
    if (stat.size > entry.size) {
      const text = readRange(file, entry.size, stat.size);
      const lines = text.split("\n");
      const tail = lines.pop() || ""; // 可能只写了一半,留给下次
      for (const raw of lines) {
        const t = raw.trim();
        if (!t) continue;
        let obj = null;
        try {
          obj = JSON.parse(t);
        } catch {
          continue;
        }
        let rec = null;
        try {
          rec = parseLine(obj, entry.state);
        } catch {
          continue; // 单行解析异常同样只跳过该行
        }
        if (rec) entry.records.push(rec);
      }
      entry.size = stat.size - Buffer.byteLength(tail, "utf8");
      if (entry.records.length > MAX_SOURCE_RECORDS) {
        entry.records.splice(0, entry.records.length - MAX_SOURCE_RECORDS);
      }
    }
    cache.set(file, entry);
    return entry;
  };
  const peek = (file) => cache.get(file) || null;
  return { read, peek };
}
