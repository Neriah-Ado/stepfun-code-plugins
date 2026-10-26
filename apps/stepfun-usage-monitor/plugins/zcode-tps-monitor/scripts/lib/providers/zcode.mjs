// zcode Provider(V2.4.0):ZCode 自身的 usage 库。
//
// 这是宿主自己的数据源,逻辑从 usage-db.mjs 原样迁入:rate()/turn() 直接复用
// openUsageDb().query()/queryTurn(),不套任何额外加工——默认 providers=["zcode"]
// 时速率行/命令/大屏/MCP 的输出与 V2.3.0 逐字节一致,只在结果上多一个 provider 字段。
//
// 与其他第三方 Provider 的唯一区别:不设 detect 闸门(strictRead)。库缺失或损坏时
// 按 V2.3.0 的语义原样抛出错误,由调用方按既有方式降级(大屏跳过一次 tick、
// CLI 报错、doctor 的数据库检查项报红),而不是静默返回空视图——否则"库里明明
// 有数据却显示 0"这类问题会被悄悄吞掉。

import fs from "node:fs";
import { openUsageDb, resolveDbPath } from "../usage-db.mjs";
import { makeRecord } from "./common.mjs";

const LATEST_SESSION_SQL =
  "SELECT session_id FROM model_usage WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1";

export function createZcodeProvider(opts = {}) {
  const env = opts.env || process.env;
  const dbPath = opts.dbPath || resolveDbPath(env);
  return {
    id: "zcode",
    label: "ZCode",
    capabilities: { turnRate: true, ttft: true, sessionScope: true },
    format: "sqlite/model_usage",
    dataDir: dbPath,
    strictRead: true,
    dbPath,

    detect() {
      try {
        return fs.statSync(dbPath).isFile();
      } catch {
        return false;
      }
    },

    currentSessionId() {
      const reader = openUsageDb(dbPath);
      try {
        const row = reader.db.prepare(LATEST_SESSION_SQL).get();
        return row ? row.session_id : null;
      } finally {
        reader.close();
      }
    },

    listSessions(limit = 20) {
      const reader = openUsageDb(dbPath);
      try {
        return reader.db
          .prepare(
            "SELECT session_id, COUNT(*) n, MAX(completed_at) last FROM model_usage" +
              " WHERE status = 'completed' GROUP BY session_id ORDER BY last DESC LIMIT ?"
          )
          .all(limit)
          .map((r) => ({ sessionId: r.session_id, samples: r.n, lastAt: r.last }));
      } finally {
        reader.close();
      }
    },

    getUsage(sessionId, opts2 = {}) {
      const reader = openUsageDb(dbPath);
      try {
        const { sid, scoped, rows } = reader.rows(sessionId, opts2.limit || 5000);
        return rows.map((r, i) =>
          makeRecord({
            provider: "zcode",
            sessionId: sid,
            turnKey: r.turn_id ?? null, // 旧库无此列时为 null,顶层会退化为单轮统计
            requestId: `${sid}#${r.completed_at}#${i}`,
            model: r.model_id,
            outputTokens: r.output_tokens,
            reasoningTokens: r.reasoning_tokens,
            inputTokens: r.input_tokens,
            cacheRead: r.cache_read_input_tokens,
            ttftMs: Number.isFinite(r.time_to_first_token_ms) ? r.time_to_first_token_ms : null,
            genMs:
              Number.isFinite(r.first_token_at) && Number.isFinite(r.completed_at) && r.completed_at > r.first_token_at
                ? r.completed_at - r.first_token_at // 纯生成耗时(不含首 token 等待)
                : null,
            completedAt: r.completed_at,
          })
        );
      } finally {
        reader.close();
      }
    },

    rate(sessionId) {
      const reader = openUsageDb(dbPath);
      try {
        return reader.query(sessionId ?? null);
      } finally {
        reader.close();
      }
    },

    turn(sessionId, opts2 = {}) {
      const reader = openUsageDb(dbPath);
      try {
        return reader.queryTurn(sessionId ?? null, { current: Boolean(opts2.current) });
      } finally {
        reader.close();
      }
    },
  };
}
