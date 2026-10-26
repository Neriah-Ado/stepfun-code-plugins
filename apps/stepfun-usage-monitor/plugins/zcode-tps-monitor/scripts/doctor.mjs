#!/usr/bin/env node
// 自检:检查插件运行依赖的各个环节,定位"速率行不见了"之类的问题。
// 用法:
//   node scripts/doctor.mjs           人类可读
//   node scripts/doctor.mjs --json    JSON(供程序消费)
// 退出码:存在 ❌ 项时为 1,否则 0。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CONFIG_FILE,
  DEFAULT_APPEARANCE,
  normalizeAppearance,
  readProviders,
} from "./lib/config.mjs";
import { agentStatus } from "./lib/collect-core.mjs";
import {
  DB_READ_BUDGET_MS,
  perfLogPath,
  readTimings,
  summarize,
} from "./lib/perf-log.mjs";

process.removeAllListeners("warning");
process.on("warning", () => {});

const HOME = os.homedir();
const DB_PATH =
  process.env.ZCODE_USAGE_DB || path.join(HOME, ".zcode", "cli", "db", "db.sqlite");
const STATE_FILE = path.join(HOME, ".zcode", "tps-monitor.last-session.json");
const PID_FILE = path.join(HOME, ".zcode", "tps-monitor.dashboard.pid");

// 钩子查询依赖的列(model_usage 表)
const REQUIRED_COLS = [
  "session_id", "status", "query_source", "model_id",
  "output_tokens", "reasoning_tokens", "input_tokens", "cache_read_input_tokens",
  "first_token_at", "completed_at", "time_to_first_token_ms",
];

function nodeVersionCheck() {
  const [maj, min] = process.versions.node.split(".").map(Number);
  const ok = maj > 22 || (maj === 22 && min >= 5);
  return {
    name: "Node 版本",
    ok,
    detail: `当前 ${process.versions.node},需要 ≥ 22.5(内置 node:sqlite)`,
    hint: ok ? null : "升级 Node 后重试:nvm install 22 / 官网安装最新 LTS",
  };
}

async function dbCheck() {
  if (!fs.existsSync(DB_PATH)) {
    return {
      name: "usage 数据库",
      ok: false,
      detail: `未找到 ${DB_PATH}`,
      hint: "若 ZCode 数据不在默认位置,设置环境变量 ZCODE_USAGE_DB 指向 db.sqlite",
    };
  }
  let db;
  try {
    // 动态加载,避免不支持 node:sqlite 的 Node 在 import 阶段就崩
    const { DatabaseSync } = await import("node:sqlite");
    db = new DatabaseSync(DB_PATH, { readOnly: true });
  } catch (e) {
    return {
      name: "usage 数据库",
      ok: false,
      detail: `无法只读打开 ${DB_PATH}: ${e.message}`,
      hint: "确认文件为 SQLite 格式且未被独占锁定",
    };
  }
  try {
    const cols = db.prepare("PRAGMA table_info(model_usage)").all().map((c) => c.name);
    if (!cols.length) {
      return { name: "usage 数据库", ok: false, detail: "model_usage 表不存在", hint: "ZCode 版本过旧或尚未产生用量数据;发一条消息后再试" };
    }
    const missing = REQUIRED_COLS.filter((c) => !cols.includes(c));
    if (missing.length) {
      return {
        name: "usage 数据库", ok: false,
        detail: `model_usage 缺少列: ${missing.join(", ")}`,
        hint: "ZCode 版本变更了表结构,请升级插件或反馈 issue",
      };
    }
    const last = db
      .prepare("SELECT completed_at FROM model_usage WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1")
      .get();
    const ageMin = last ? Math.round((Date.now() - last.completed_at) / 60000) : null;
    return {
      name: "usage 数据库",
      ok: true,
      detail: `表结构完整;最近完成样本 ${ageMin == null ? "无" : ageMin + " 分钟前"}`,
      hint: null,
    };
  } catch (e) {
    // 能打开不代表读得了:文件被截断/不是 SQLite 时,失败发生在第一次 prepare。
    // 这里必须兜住,否则一个坏库会让整份自检报告都出不来 —— 与多源自检同一套故障隔离口径。
    return {
      name: "usage 数据库",
      ok: false,
      detail: `读取失败: ${e.message}`,
      hint: "文件不是可用的 SQLite 库(可能被截断或格式不符);确认 ZCODE_USAGE_DB 指向 db.sqlite",
    };
  } finally {
    try { db.close(); } catch {}
  }
}

function stateFileCheck() {
  try {
    const st = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    const age = Math.round((Date.now() - (st.ts || 0)) / 60000);
    return {
      name: "会话状态文件",
      ok: true,
      detail: `存在,sessionId=${String(st.sessionId).slice(0, 8)}…,更新于 ${age} 分钟前`,
      hint: null,
    };
  } catch {
    return {
      name: "会话状态文件",
      ok: false,
      detail: "不存在或不可读",
      hint: "钩子未运行过:确认插件已安装且会话已重开(钩子在安装/更新后需新会话才注册)",
    };
  }
}

function configCheck() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    const off = cfg.tokenRateLine === false;
    return {
      name: "配置文件",
      ok: true,
      detail: off ? "tokenRateLine=false,速率行注入已关闭(属预期)" : "已读取,注入开启",
      hint: off ? "如需恢复注入,删除该文件或改回 true" : null,
    };
  } catch {
    return { name: "配置文件", ok: true, detail: "未配置(默认注入开启)", hint: null };
  }
}

// 多 agent 数据源自检(V2.4.0):对每个启用的 provider 单独给「可用/不可用 + 原因」。
// 故障隔离在这里体现为:某个源数据损坏或格式变更只让它自己那一项变红并说明原因,
// 其余源照常出数;没安装的客户端只是被跳过(提示级),不算自检失败 —— 聚合层本来
// 就会跳过它,插件其余功能不受影响。
function providersCheck() {
  const ids = readProviders();
  let list;
  try {
    list = agentStatus();
  } catch (err) {
    return {
      name: "数据源(多 agent)",
      ok: false,
      detail: `无法枚举数据源:${err.message}`,
      hint: "检查配置文件里的 providers 字段;删掉该字段即回到默认的 zcode 单源",
      providers: [],
    };
  }
  const skipped = list.filter((p) => !p.ok && !p.detected);
  const broken = list.filter((p) => p.detected && !p.ok);
  const detail = list
    .map((p) =>
      p.ok
        ? `${p.label} ✅ ${p.sessions} 个会话 · 当前会话 ${p.samples} 条样本 · ${p.format}`
        : `${p.label} ${p.detected ? "❌" : "⏭"} ${p.reason || "不可用"}`
    )
    .join("\n   ");
  let hint = null;
  if (broken.length) {
    hint = `损坏/不可读的源会被自动跳过,其余源照常统计;数据来源与口径见 README「多 agent 支持」。当前启用:${ids.join(", ")}`;
  } else if (skipped.length) {
    hint = `已启用但本机没有数据、被跳过的源:${skipped.map((p) => p.provider).join(", ")};不需要就把它从 providers 里去掉`;
  }
  return {
    name: "数据源(多 agent)",
    ok: broken.length === 0,
    detail: detail || "没有启用任何数据源",
    hint,
    providers: list.map((p) => ({
      provider: p.provider,
      label: p.label,
      ok: p.ok,
      skipped: !p.detected,
      source: p.source,
      format: p.format,
      capabilities: p.capabilities,
      sessions: p.sessions,
      samples: p.samples,
      sessionId: p.sessionId,
      lastAt: p.lastAt,
      reason: p.reason,
      note: p.note,
    })),
  };
}

// 外观配置(appearance 节)自检:校验失败阻断,fontUrl 不可达仅提示。
async function appearanceCheck() {
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return {
        name: "外观配置",
        ok: true,
        detail: `未配置(默认:${DEFAULT_APPEARANCE.theme} / 系统字体 / 玻璃 ${DEFAULT_APPEARANCE.glassIntensity})`,
        hint: null,
      };
    }
    return {
      name: "外观配置",
      ok: false,
      detail: `配置文件损坏:${CONFIG_FILE}`,
      hint: "修复 JSON 或删除该文件后重试;字段含义见 docs/releases/v2.1.0.md",
    };
  }

  const raw = cfg && typeof cfg === "object" ? cfg.appearance : undefined;
  if (raw === undefined) {
    return { name: "外观配置", ok: true, detail: "未配置 appearance 节(全部使用默认值)", hint: null };
  }
  const { errors } = normalizeAppearance(raw);
  if (errors.length) {
    return {
      name: "外观配置",
      ok: false,
      detail: "非法字段:" + errors.map((e) => `${e.field}(${e.message})`).join(";"),
      hint: "在大屏「⚙ 外观」面板修正,或直接编辑配置文件",
    };
  }
  const a = { ...DEFAULT_APPEARANCE, ...normalizeAppearance(raw).value };
  let hint = null;
  // fontUrl 可达性仅作提示:离线/内网环境下不阻断自检
  if (a.fontUrl && /^https?:/i.test(a.fontUrl)) {
    try {
      const res = await fetch(a.fontUrl, { method: "HEAD", signal: AbortSignal.timeout(3000) });
      if (!res.ok) hint = `fontUrl 返回 HTTP ${res.status}(仅提示,字体加载失败时会回退系统字体栈)`;
    } catch {
      hint = "fontUrl 当前不可达(仅提示,字体加载失败时会回退系统字体栈)";
    }
  }
  return {
    name: "外观配置",
    ok: true,
    detail: `主题 ${a.theme} · 字号 ${a.fontSize}px × ${a.fontScale} · 玻璃 ${a.glassIntensity}`,
    hint,
  };
}

function dashboardCheck() {
  try {
    const pid = Number(fs.readFileSync(PID_FILE, "utf8").trim());
    process.kill(pid, 0); // 探活
    const stopCmd = process.platform === "win32" ? `taskkill /PID ${pid} /F` : `kill ${pid}`;
    return {
      name: "大屏进程",
      ok: true,
      detail: `运行中(PID ${pid})`,
      hint: `如需停止:${stopCmd}`,
    };
  } catch {
    return { name: "大屏进程", ok: true, detail: "未运行", hint: null };
  }
}

// 性能诊断(V2.2.0):钩子单次 DB 读取耗时分布、库文件大小、索引命中情况。
// 只读信息节,不影响通过与否;数据源为钩子写入的 ~/.zcode/tps-monitor.perf.log。
async function perfCheck() {
  const entries = readTimings(200);
  const s = summarize(entries);
  const dbBytes = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : null;
  let fullScans = [];
  try {
    // 动态加载:node:sqlite 的 ExperimentalWarning 抑制须先于其 import 生效
    const { openUsageDb } = await import("./lib/usage-db.mjs");
    const reader = openUsageDb(DB_PATH);
    try {
      fullScans = reader.indexHints().filter((h) => h.fullScan);
    } finally {
      reader.close();
    }
  } catch {}

  const perf = {
    budgetMs: DB_READ_BUDGET_MS,
    samples: s.count,
    lastKind: s.lastKind,
    lastDbMs: s.lastDbMs,
    lastTs: s.lastTs,
    p50DbMs: s.p50DbMs,
    p95DbMs: s.p95DbMs,
    maxDbMs: s.maxDbMs,
    overBudget: s.overBudget,
    dbFile: DB_PATH,
    dbBytes,
    logFile: perfLogPath(),
    fullScans,
  };

  if (!s.count) {
    return {
      name: "性能诊断",
      ok: true,
      detail: "暂无钩子耗时记录(发一条消息触发 Stop 钩子后再看)",
      hint: null,
      perf,
    };
  }
  const dist = `P50 ${s.p50DbMs} / P95 ${s.p95DbMs} / 最大 ${s.maxDbMs}ms`;
  const detail =
    `最近一次 ${s.lastKind} 读取 ${s.lastDbMs}ms · ${dist} · 共 ${s.count} 次,` +
    `超 ${DB_READ_BUDGET_MS}ms 预算 ${s.overBudget} 次 · 库 ${fmtMB(dbBytes)}`;
  let hint = null;
  if (s.overBudget > 0) hint = `有 ${s.overBudget} 次读取超预算,明细见 ${perfLogPath()}`;
  else if (fullScans.length) {
    hint =
      `${fullScans.length} 条查询走全表扫描(${fullScans.map((f) => f.query).join("、")});` +
      "建议索引见 docs/releases/v2.2.0.md";
  }
  return { name: "性能诊断", ok: true, detail, hint, perf };
}

function fmtMB(bytes) {
  return bytes == null ? "--" : (bytes / 1048576).toFixed(1) + "MB";
}

export async function runDoctor() {
  const results = [];
  results.push(nodeVersionCheck());
  results.push(await dbCheck());
  results.push(stateFileCheck());
  results.push(configCheck());
  results.push(providersCheck());
  results.push(await appearanceCheck());
  results.push(dashboardCheck());
  const perf = await perfCheck();
  results.push(perf);
  return { checks: results, failed: results.filter((r) => !r.ok).length, perf: perf.perf };
}

// --- CLI ---
if (process.argv[1] && process.argv[1].endsWith("doctor.mjs")) {
  const report = await runDoctor();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const c of report.checks) {
      console.log(`${c.ok ? "✅" : "❌"} ${c.name}:${c.detail}`);
      if (c.hint) console.log(`   ↳ ${c.hint}`);
    }
    console.log(report.failed ? `\n${report.failed} 项未通过` : "\n全部通过");
  }
  process.exitCode = report.failed ? 1 : 0;
}
