// 钩子耗时诊断日志(V2.2.0):JSONL,只写本机 ~/.zcode/tps-monitor.perf.log,
// 供 /tps-doctor 的 perf 节呈现(最近一次钩子耗时、查询耗时分布、超预算计数)。
// 硬约束:写入失败必须静默——诊断日志绝不能影响钩子本身。
// 路径在每次调用时解析(而非模块加载时),以便测试隔离 HOME/USERPROFILE。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 单次 DB 读取预算:超过即标记 overBudget(Stop 钩子验收 P95 < 50ms)
export const DB_READ_BUDGET_MS = 50;
const MAX_BYTES = 131072; // 超过则保留尾部,防止长年累月无限增长
const KEEP_BYTES = 32768;

export function perfLogPath() {
  return path.join(os.homedir(), ".zcode", "tps-monitor.perf.log");
}

export function recordTiming(entry) {
  try {
    const file = perfLogPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      if (fs.statSync(file).size > MAX_BYTES) {
        const buf = fs.readFileSync(file);
        fs.writeFileSync(file, buf.subarray(buf.length - KEEP_BYTES));
      }
    } catch {}
    fs.appendFileSync(file, `${JSON.stringify({ ts: Date.now(), ...entry })}\n`);
  } catch {}
}

// 钩子侧计时包装:对单次 DB 读取计时并落诊断日志,fn 的返回值原样透传。
// 超 DB_READ_BUDGET_MS 即标记 overBudget(供 /tps-doctor 检出);记录失败静默。
export function timedRead(kind, fn) {
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    const dbMs = performance.now() - t0;
    recordTiming({ kind, dbMs: Math.round(dbMs * 10) / 10, overBudget: dbMs > DB_READ_BUDGET_MS });
  }
}

// 倒序读取最后 limit 条(日志只追加,最新的在末尾);截断产生的半行直接跳过
export function readTimings(limit = 200) {
  try {
    const lines = fs.readFileSync(perfLogPath(), "utf8").split("\n");
    const out = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        out.push(JSON.parse(line));
      } catch {}
    }
    return out.reverse();
  } catch {
    return [];
  }
}

// 最近邻分位数:样本量小时不做插值,避免制造虚假精度
function quantile(sorted, q) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

export function summarize(entries) {
  const dbms = entries
    .map((e) => e.dbMs)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (!dbms.length) {
    return { count: 0, lastDbMs: null, lastKind: null, lastTs: null, p50DbMs: null, p95DbMs: null, maxDbMs: null, overBudget: 0 };
  }
  const last = entries[entries.length - 1];
  return {
    count: entries.length,
    lastDbMs: round1(last.dbMs),
    lastKind: last.kind ?? null,
    lastTs: last.ts ?? null,
    p50DbMs: round1(quantile(dbms, 0.5)),
    p95DbMs: round1(quantile(dbms, 0.95)),
    maxDbMs: round1(dbms[dbms.length - 1]),
    overBudget: entries.filter((e) => e.overBudget === true).length,
  };
}
