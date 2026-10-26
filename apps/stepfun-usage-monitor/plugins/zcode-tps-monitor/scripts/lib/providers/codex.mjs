// codex Provider(V2.4.0):Codex CLI 的本地会话记录。
//
// 数据源:~/.codex/sessions/<年>/<月>/<日>/rollout-<时间戳>-<sessionId>.jsonl(只读)。
// 口径:session_meta 行给出会话 id;token_count 事件的 info.last_token_usage 是
// 单次请求的 token 账(优先采用);只有累计值 total_token_usage 的版本按相邻两次
// 累计值求差得到单次增量。轮次边界取真实用户输入(response_item / message / user)。
//
// 已知降级(capabilities.ttft = false):该格式没有任何首 token 时刻信息,TTFT 为空。
// 版本相关:认不出的行直接跳过;累计计数重置(换模型/新会话)时按绝对值计入一次。

import path from "node:path";
import fs from "node:fs";
import {
  MAX_GAP_ESTIMATE_MS,
  buildRateView,
  buildTurnView,
  createJsonlReader,
  explicitDurationMs,
  isDir,
  makeRecord,
  newestJsonl,
  pickNumber,
  pickTimestamp,
  resolveDataRoot,
  scanJsonlFiles,
} from "./common.mjs";

// rollout-2026-01-01T12-00-00-<uuid>.jsonl → uuid
const SESSION_IN_NAME = /^rollout-.*-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.jsonl$/;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// 累计 token 账 → 归一化四元组
function readTotals(t) {
  if (!t || typeof t !== "object") return null;
  return {
    inputTokens: num(t.input_tokens),
    outputTokens: num(t.output_tokens),
    reasoningTokens: num(t.reasoning_output_tokens ?? t.reasoning_tokens),
    cacheRead: num(t.cached_input_tokens ?? t.cache_read_input_tokens),
  };
}

function parseLine(obj, state) {
  const ts = pickTimestamp(obj.timestamp);
  if (ts == null) return null;
  if (state.prevTs == null) state.prevTs = ts;
  const payload = obj.payload && typeof obj.payload === "object" ? obj.payload : null;
  const payloadType = payload && typeof payload.type === "string" ? payload.type : "";
  const type = typeof obj.type === "string" ? obj.type : "";

  // 会话 id:session_meta 里的权威值优先于文件名
  if (type === "session_meta" && payload && typeof payload.id === "string") {
    state.sessionId = payload.id;
  }
  // 模型名:turn_context 携带,后续请求沿用最近一次
  if (type === "turn_context" && payload && typeof payload.model === "string") {
    state.model = payload.model;
  }
  // 真实用户输入开启新轮次
  if (payloadType === "message" && payload.role === "user") {
    state.turnKey =
      (typeof payload.id === "string" && payload.id) ||
      (typeof obj.uuid === "string" && obj.uuid) ||
      `turn_${ts}`;
  }

  // token 账:优先单次增量,退回累计值求差
  if (payloadType === "token_count") {
    const info = payload.info && typeof payload.info === "object" ? payload.info : {};
    const totals = readTotals(info.total_token_usage || info.total);
    // 必须先取上一次的累计值再更新状态:顺序反了会自己减自己,差值为 0 出不来记录
    const prevTotals = state.prevTotals;
    if (totals) state.prevTotals = totals;
    const last = readTotals(info.last_token_usage || info.last);
    let usage = last;
    if (!usage && totals) {
      const prev = prevTotals;
      if (prev) {
        const reset =
          totals.inputTokens < prev.inputTokens ||
          totals.outputTokens < prev.outputTokens ||
          totals.reasoningTokens < prev.reasoningTokens;
        usage = reset
          ? totals
          : {
              inputTokens: totals.inputTokens - prev.inputTokens,
              outputTokens: totals.outputTokens - prev.outputTokens,
              reasoningTokens: totals.reasoningTokens - prev.reasoningTokens,
              cacheRead: Math.max(0, totals.cacheRead - prev.cacheRead),
            };
      } else {
        usage = totals;
      }
    }
    if (usage && usage.outputTokens + usage.reasoningTokens > 0) {
      const gap = Math.max(0, ts - state.prevTs);
      const genMs =
        explicitDurationMs(payload, info, obj) ??
        (gap > 0 && gap <= MAX_GAP_ESTIMATE_MS ? gap : null);
      const record = makeRecord({
        provider: "codex",
        sessionId: state.sessionId,
        turnKey: state.turnKey,
        requestId: (typeof obj.requestId === "string" && obj.requestId) || null,
        model: state.model ?? null,
        outputTokens: usage.outputTokens,
        reasoningTokens: usage.reasoningTokens,
        inputTokens: usage.inputTokens,
        cacheRead: usage.cacheRead,
        ttftMs: null, // 该格式不记录首 token 延迟
        genMs,
        completedAt: ts,
      });
      state.prevTs = ts;
      return record;
    }
  }

  state.prevTs = ts;
  return null;
}

export function createCodexProvider(opts = {}) {
  const env = opts.env || process.env;
  // 目录解析优先级:插件自有变量 > 客户端官方变量(CODEX_HOME)> 默认 ~/.codex
  const root = opts.root || resolveDataRoot(env, "TPS_CODEX_HOME", "CODEX_HOME", [".codex"]);
  const sessionsDir = path.join(root, "sessions");
  const reader = createJsonlReader(parseLine);

  const files = () => scanJsonlFiles(sessionsDir);
  const sessionOf = (file) => {
    const m = SESSION_IN_NAME.exec(path.basename(file));
    return m ? m[1] : path.basename(file, ".jsonl");
  };

  return {
    id: "codex",
    label: "Codex",
    capabilities: { turnRate: true, ttft: false, sessionScope: true },
    format: "jsonl/sessions-v1",
    dataDir: sessionsDir,
    root,

    detect() {
      return files().length > 0;
    },

    installed() {
      return isDir(sessionsDir);
    },

    currentSessionId() {
      const file = newestJsonl(sessionsDir);
      if (!file) return null;
      const { records, state } = reader.read(file);
      const last = records[records.length - 1];
      return (last && last.sessionId) || state.sessionId || sessionOf(file);
    },

    listSessions(limit = 20) {
      return files()
        .slice(-limit)
        .reverse()
        .map((file) => {
          let lastAt = 0;
          try {
            lastAt = fs.statSync(file).mtimeMs;
          } catch {}
          const cached = reader.peek(file);
          return {
            sessionId: sessionOf(file),
            lastAt,
            samples: cached ? cached.records.length : null,
            file,
          };
        });
    },

    getUsage(sessionId, o = {}) {
      const all = files();
      const sid = sessionId || this.currentSessionId();
      if (!sid) return [];
      let out = [];
      const direct = all.find((f) => sessionOf(f) === sid);
      if (direct) {
        out = reader.read(direct).records.filter((r) => !r.sessionId || r.sessionId === sid);
      } else {
        for (const file of all) {
          out.push(...reader.read(file).records.filter((r) => r.sessionId === sid));
        }
      }
      return out.sort((a, b) => b.completedAt - a.completedAt).slice(0, o.limit || 5000);
    },

    rate(sessionId) {
      const sid = sessionId || this.currentSessionId();
      if (!sid) return buildRateView([], { sessionId: null });
      return buildRateView(this.getUsage(sid), { sessionId: sid });
    },

    turn(sessionId, o = {}) {
      const sid = sessionId || this.currentSessionId();
      if (!sid) return { sessionId: null, turnId: null, turn: null, session: null };
      return buildTurnView(this.getUsage(sid), {
        sessionId: sid,
        current: Boolean(o.current),
        lastPromptTs: o.current ? lastPromptTs() : null,
      });
    },
  };
}
