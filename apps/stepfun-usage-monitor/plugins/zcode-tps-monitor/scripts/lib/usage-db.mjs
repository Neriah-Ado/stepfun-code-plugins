// usage 数据库只读访问层(V2.2.0 数据层)。
// 职责:打开 ZCode usage 库(只读)、把"按最新 turn_id 圈定本轮"等查询统一封装为
// 预编译语句(node:sqlite StatementSync,同进程内按 SQL 文本复用,不再每次
// db.prepare)、给出建议索引与 EXPLAIN QUERY PLAN 自检。
// 格式化与 CLI 仍在上层 scripts/token-rate.mjs;本模块零第三方依赖。
// 语义与 V2.1.0 完全一致(统计口径、字段名、守卫条件),仅把"每次查询新建
// StatementSync"改为"按 SQL 文本复用";旧库缺 turn_id 列时本轮查询优雅降级。

// node:sqlite 在 Node <22.5 不存在、≥22.5 为实验特性:静态 import 会在模块求值期
// 触发 ExperimentalWarning,而钩子进程需要在更早的阶段接管 warning 通道——
// 因此与 scripts/token-rate.mjs 一样:先静默警告,再动态导入。
process.removeAllListeners("warning");
process.on("warning", () => {});

const { DatabaseSync } = await import("node:sqlite");
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 统计口径常量与多 agent Provider 层共用一份定义(V2.4.0):各客户端工具的用量
// 数据格式不同,但"速率分子 = 输出 + 思考 token、分母 = 纯生成耗时"这套口径必须
// 完全一致,否则同一台机器上不同数据源的数字不可比。
import { RATE_ENV } from "./providers/common.mjs";

// 常量仍从这里导出(token-rate.mjs / 大屏 / 桌面悬浮条都从这个入口取),定义在
// providers/common.mjs 一份,避免 zcode 源与第三方源的统计口径漂移。
export { RATE_ENV };

const N = RATE_ENV.window;
const HIST = RATE_ENV.hist;
const MIN_GEN_MS = RATE_ENV.minGenMs;
const MAX_GEN_MS = RATE_ENV.maxGenMs;

export function resolveDbPath(env = process.env) {
  return env.ZCODE_USAGE_DB || path.join(os.homedir(), ".zcode", "cli", "db", "db.sqlite");
}

// 建议索引:查询条件全部落在 (session_id, completed_at) 与 (status, completed_at) 上。
// 插件只以只读方式连接,不能代客户端建索引,因此这里只作文档与 doctor 提示。
export const SUGGESTED_INDEXES = [
  {
    name: "idx_model_usage_session_completed",
    ddl: "CREATE INDEX IF NOT EXISTS idx_model_usage_session_completed ON model_usage(session_id, completed_at DESC)",
    why: "按会话圈定本轮/窗口历史的查询:WHERE session_id = ? ORDER BY completed_at",
  },
  {
    name: "idx_model_usage_status_completed",
    ddl: "CREATE INDEX IF NOT EXISTS idx_model_usage_status_completed ON model_usage(status, completed_at DESC)",
    why: "解析当前会话:WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1",
  },
];

const BASE_COLS =
  "model_id, output_tokens, reasoning_tokens, input_tokens, cache_read_input_tokens," +
  " first_token_at, completed_at, time_to_first_token_ms, status";

// 两段作用域:主对话范围(main_turn 有数据时)与全量回退
const SCOPE = {
  main: "status = 'completed' AND query_source = 'main_turn'",
  all: "status = 'completed'",
};
const scopeWhere = (mainOnly, sid) => `${SCOPE[mainOnly ? "main" : "all"]}${sid ? " AND session_id = ?" : ""}`;

const SQL = {
  latestSession: "SELECT session_id FROM model_usage WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1",
  mainProbe: (sid) => `SELECT 1 FROM model_usage WHERE ${scopeWhere(true, sid)} LIMIT 1`,
  window: (mainOnly, sid) =>
    `SELECT ${BASE_COLS} FROM model_usage WHERE ${scopeWhere(mainOnly, sid)} ORDER BY completed_at DESC LIMIT ?`,
  turnRows: (mainOnly, sid) =>
    `SELECT ${BASE_COLS} FROM model_usage WHERE ${scopeWhere(mainOnly, sid)} AND turn_id = ? ORDER BY completed_at ASC`,
  latestTurnId: "SELECT turn_id FROM model_usage WHERE session_id = ? AND turn_id IS NOT NULL ORDER BY completed_at DESC LIMIT 1",
  sessionSum: (mainOnly, sid) =>
    "SELECT COUNT(*) n, SUM(output_tokens) o, SUM(reasoning_tokens) r," +
    " SUM(input_tokens) i, SUM(cache_read_input_tokens) c FROM (" +
    `SELECT ${BASE_COLS} FROM model_usage WHERE ${scopeWhere(mainOnly, sid)})`,
};

// 打开只读连接并返回一组查询器。调用方负责 close();预编译语句随连接销毁,
// 同一 reader 内的重复查询(如 Stop 钩子的重试循环)复用同一份 StatementSync。
export function openUsageDb(dbPath = resolveDbPath()) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const stmts = new Map();
  const stmt = (text) => {
    let s = stmts.get(text);
    if (!s) {
      s = db.prepare(text);
      stmts.set(text, s);
    }
    return s;
  };

  function toItem(r) {
    const tok = r.output_tokens ?? 0;
    const reasoning = r.reasoning_tokens ?? 0;
    // 部分行(如非流式/中断请求)缺 first_token_at,须判无效
    const hasTime =
      Number.isFinite(r.first_token_at) && Number.isFinite(r.completed_at) && r.completed_at > r.first_token_at;
    const genMs = hasTime ? r.completed_at - r.first_token_at : null; // 纯生成耗时(不含首 token 等待)
    // 速率分子含思考 token:思考内容同样是流式输出,ZCode 未单独记录时该列为 0,行为不变
    const rateTokens = tok + reasoning;
    const valid = genMs != null && genMs >= MIN_GEN_MS && genMs < MAX_GEN_MS && rateTokens > 0;
    return {
      model: r.model_id,
      outputTokens: tok,
      reasoningTokens: reasoning,
      inputTokens: r.input_tokens ?? 0,
      cacheRead: r.cache_read_input_tokens ?? 0,
      ttftMs: Number.isFinite(r.time_to_first_token_ms) ? r.time_to_first_token_ms : null,
      genMs,
      tokPerSec: valid ? Math.round((rateTokens / genMs) * 10000) / 10 : null,
      completedAt: r.completed_at,
    };
  }

  // 未显式指定会话时,取最近一次完成请求所属的会话 = 当前会话
  function resolveSession(sessionId) {
    let sid = sessionId;
    const scoped = sessionId ? "explicit" : "auto";
    if (!sid) {
      const row = stmt(SQL.latestSession).get();
      sid = row ? row.session_id : null;
    }
    return { sid, scoped };
  }

  // 主对话优先的过滤范围:有 main_turn 数据时只统计 main_turn,否则回退为全部请求
  function resolveScope(sid) {
    const hasMain = stmt(SQL.mainProbe(sid)).get(...(sid ? [sid] : []));
    return { mainOnly: Boolean(hasMain) };
  }

  const windowRows = (mainOnly, sid, limit) => stmt(SQL.window(mainOnly, sid)).all(...(sid ? [sid] : []), limit);

  // 会话累计用独立 SUM(不受展示窗口限制);速率均值/峰值由调用方按窗口传入
  function sessionAggregate(rated, mainOnly, sid) {
    if (!rated.length) return null;
    const s = stmt(SQL.sessionSum(mainOnly, sid)).get(...(sid ? [sid] : []));
    return {
      samples: rated.length,
      requests: s.n ?? 0,
      avg: Math.round((rated.reduce((sum, i) => sum + i.tokPerSec, 0) / rated.length) * 10) / 10,
      max: Math.max(...rated.map((i) => i.tokPerSec)),
      min: Math.min(...rated.map((i) => i.tokPerSec)),
      totalOutput: s.o ?? 0,
      totalReasoning: s.r ?? 0,
      totalInput: s.i ?? 0,
      totalCacheRead: s.c ?? 0,
    };
  }

  function query(sessionId) {
    const { sid, scoped } = resolveSession(sessionId);
    const { mainOnly } = resolveScope(sid);
    // 曲线历史(大窗口)与统计(小窗口)分别查询,刷新/重开不丢
    const items = windowRows(mainOnly, sid, HIST).slice(0, N).map(toItem);
    const rated = items.filter((i) => i.tokPerSec != null);
    // 展示用 latest 优先取最近一条"有效"记录,避免在途/缺字段行顶掉头条
    const latest = rated[0] ?? items[0] ?? null;
    const session = sessionAggregate(rated, mainOnly, sid);
    return { sessionId: sid, scoped, latest, session, history: items.slice().reverse() };
  }

  // 本轮 = 会话里最新的 turn_id(一次用户消息触发的全部请求共享同一个 turn_id,
  // 含"模型→工具→模型"的每一段)。Stop 钩子在回复刚结束时调用,此时本轮已全部入库,
  // 因此能给出真正的"本轮即时速率";而 prompt-submit 时刻本轮尚未发生,只能看到上一轮。
  function latestTurnId(sid) {
    try {
      const row = stmt(SQL.latestTurnId).get(sid);
      return row ? row.turn_id : null;
    } catch {
      return null; // 旧版客户端的库没有 turn_id 列
    }
  }

  // 最近一次用户提问的时间戳(prompt-submit 钩子写入);--current 守卫用:
  // 最新 turn 的所有行都早于它,说明本问尚未产生任何模型请求(纯问答轮),不得当作"本问"统计。
  function lastPromptTs() {
    try {
      const st = JSON.parse(
        fs.readFileSync(path.join(os.homedir(), ".zcode", "tps-monitor.last-session.json"), "utf8")
      );
      return Number.isFinite(st.ts) ? st.ts : null;
    } catch {
      return null;
    }
  }

  function queryTurn(sessionId, opts = {}) {
    const { sid } = resolveSession(sessionId);
    if (!sid) return { sessionId: null, turnId: null, turn: null, session: null };
    const { mainOnly } = resolveScope(sid);
    const winRows = windowRows(mainOnly, sid, N);
    const session = sessionAggregate(
      winRows.map(toItem).filter((i) => i.tokPerSec != null),
      mainOnly,
      sid
    );
    const turnId = latestTurnId(sid);
    if (!turnId) return { sessionId: sid, turnId: null, turn: null, session };
    let turnRows;
    try {
      turnRows = stmt(SQL.turnRows(mainOnly, sid)).all(...(sid ? [sid] : []), turnId);
    } catch {
      return { sessionId: sid, turnId: null, turn: null, session };
    }
    if (!turnRows.length) return { sessionId: sid, turnId, turn: null, session };
    // --current 守卫:最新 turn 的行全部早于本次提问时刻 → 本问还没有任何模型请求
    // (典型场景:纯问答轮在回答结束前),绝不把上一轮数据冒充"本问"返回。
    if (opts.current) {
      const ts = lastPromptTs();
      const lastAt = Math.max(...turnRows.map((r) => r.completed_at ?? 0));
      if (ts && lastAt < ts) {
        return { sessionId: sid, turnId, turn: null, noCurrentTurnData: true, session };
      }
    }
    const items = turnRows.map(toItem);
    const rated = items.filter((i) => i.tokPerSec != null);
    const totalTok = rated.reduce((s, i) => s + i.outputTokens + i.reasoningTokens, 0);
    const genMs = rated.reduce((s, i) => s + i.genMs, 0);
    const turn = {
      requests: items.length,
      rated: rated.length,
      ttftMs: items[0].ttftMs, // 本轮第一段的首字延迟
      firstAt: items[0].completedAt,
      lastAt: items[items.length - 1].completedAt,
      genMs,
      totalOutput: items.reduce((s, i) => s + i.outputTokens, 0),
      totalReasoning: items.reduce((s, i) => s + i.reasoningTokens, 0),
      // 本轮即时速率:总产出 / 总纯生成时长(按段加权,排除段间工具等待),单段时即该段速率
      tokPerSec: genMs >= MIN_GEN_MS && totalTok > 0 ? Math.round((totalTok / genMs) * 10000) / 10 : null,
      peak: rated.length ? Math.max(...rated.map((i) => i.tokPerSec)) : null,
    };
    return { sessionId: sid, turnId, turn, session };
  }

  // 未加工原始行(V2.4.0 多 agent Provider 的 zcode 源消费):与 query() 走同一套
  // 作用域解析(会话圈定 + main_turn 优先),但不做 toItem 加工,由 Provider 层归一成
  // 跨源统一记录。新→旧。
  function rows(sessionId, limit = 5000) {
    const { sid, scoped } = resolveSession(sessionId);
    if (!sid) return { sessionId: null, scoped: "auto", rows: [] };
    const { mainOnly } = resolveScope(sid);
    return { sessionId: sid, scoped, rows: windowRows(mainOnly, sid, limit) };
  }

  // EXPLAIN QUERY PLAN:自检查询是否走索引(只读连接无法建索引,只能看)
  function planFor(text) {
    const marks = (text.match(/\?/g) || []).length;
    try {
      return stmt(`EXPLAIN QUERY PLAN ${text}`)
        .all(...Array(marks).fill("x"))
        .map((r) => r.detail);
    } catch {
      return [];
    }
  }

  const fullScan = (details) => details.some((d) => /\bSCAN\b/.test(d));

  function indexHints() {
    const queries = [
      { key: "window(main,session)", sql: SQL.window(true, "s") },
      { key: "window(all,session)", sql: SQL.window(false, "s") },
      { key: "turnRows", sql: SQL.turnRows(true, "s") },
      { key: "latestTurnId", sql: SQL.latestTurnId },
      { key: "sessionSum(main,session)", sql: SQL.sessionSum(true, "s") },
      { key: "latestSession", sql: SQL.latestSession },
    ];
    return queries.map((q) => {
      const plan = planFor(q.sql);
      return { query: q.key, plan, fullScan: fullScan(plan) };
    });
  }

  return {
    path: dbPath,
    db,
    stmt,
    query,
    queryTurn,
    rows,
    planFor,
    indexHints,
    suggestedIndexes: SUGGESTED_INDEXES,
    close() {
      try {
        db.close();
      } catch {}
    },
  };
}
