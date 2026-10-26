// claude-code Provider(V2.4.0):Claude Code 的本地会话日志。
//
// 数据源:~/.claude/projects/<项目目录转义名>/<sessionId>.jsonl(只读,逐行 JSONL)。
// 口径:assistant 行的 message.usage 即一次模型请求的 token 账;turnKey 取最近一条
// "真实用户输入"的消息 id —— 与 ZCode 的 turn_id 对应(一次提问触发的全部请求,
// 含"模型→工具→模型"的每一段),因此能给出同一口径的本轮速率。
//
// 已知降级(capabilities.ttft = false):Claude Code 的 JSONL 不记录首 token 时刻,
// 只有整段 usage,所以单段 genMs 只能用"与上一条记录的时间差"估算,TTFT 一律为空,
// 展示层显示 "-" 而非编一个数字。客户端版本相关:认不出的行直接跳过(不抛错)。

import path from "node:path";
import fs from "node:fs";
import {
  MAX_GAP_ESTIMATE_MS,
  buildRateView,
  buildTurnView,
  createJsonlReader,
  explicitDurationMs,
  isDir,
  lastPromptTs,
  makeRecord,
  newestJsonl,
  pickTimestamp,
  resolveDataRoot,
  scanJsonlFiles,
} from "./common.mjs";

// 工具结果行:内容数组首元素是 tool_result(或整行带 toolUseResult)。
// 它们不是用户发起的提问,不能开启新轮次,否则本轮会被工具返回切碎。
function isToolResult(msg, line) {
  if (line && typeof line === "object" && line.toolUseResult !== undefined) return true;
  const content = msg && msg.content;
  if (!Array.isArray(content)) return false;
  return content.some((c) => c && typeof c === "object" && c.type === "tool_result");
}

// 逐行解析:state 里维护 { sessionId, prevTs, turnKey },追加写时接着上次的状态继续
function parseLine(obj, state) {
  const ts = pickTimestamp(obj.timestamp);
  if (ts == null) return null;
  if (!state.sessionId && typeof obj.sessionId === "string") state.sessionId = obj.sessionId;
  if (state.prevTs == null) state.prevTs = ts;
  const msg = obj.message && typeof obj.message === "object" ? obj.message : null;
  const type = typeof obj.type === "string" ? obj.type : "";

  // 真实用户输入开启一个新轮次:优先用消息 id(同一条消息在多行里重复出现也能对上),
  // 退回行 uuid,再退回时间戳兜底
  if (type === "user" && msg && !isToolResult(msg, obj)) {
    state.turnKey =
      (typeof msg.id === "string" && msg.id) ||
      (typeof obj.uuid === "string" && obj.uuid) ||
      `turn_${ts}`;
  }

  let record = null;
  const usage = msg && msg.usage && typeof msg.usage === "object" ? msg.usage : null;
  if (usage) {
    // 单段纯生成耗时:客户端没记就用与上一条的时间差(含模型思考前的等待,略偏保守);
    // 差得太大说明中间夹着长耗时工具调用,判未知而不是给一个离谱的小速率
    const gap = Math.max(0, ts - state.prevTs);
    const genMs =
      explicitDurationMs(msg, usage, obj) ?? (gap > 0 && gap <= MAX_GAP_ESTIMATE_MS ? gap : null);
    record = makeRecord({
      provider: "claude-code",
      sessionId: state.sessionId,
      turnKey: state.turnKey,
      requestId:
        (typeof obj.requestId === "string" && obj.requestId) ||
        (typeof msg.id === "string" && msg.id) ||
        null,
      model: (typeof msg.model === "string" && msg.model) || null,
      outputTokens: usage.output_tokens,
      reasoningTokens:
        usage.reasoning_tokens ?? usage.thinking_tokens ?? usage.output_tokens_details?.reasoning_tokens,
      inputTokens: usage.input_tokens,
      cacheRead: usage.cache_read_input_tokens,
      ttftMs: null, // 该格式不记录首 token 延迟
      genMs,
      completedAt: ts,
    });
  }
  state.prevTs = ts;
  return record;
}

export function createClaudeCodeProvider(opts = {}) {
  const env = opts.env || process.env;
  // 目录解析优先级:插件自有变量 > 客户端官方变量(CLAUDE_CONFIG_DIR)> 默认 ~/.claude
  const root = opts.root || resolveDataRoot(env, "TPS_CLAUDE_CODE_HOME", "CLAUDE_CONFIG_DIR", [".claude"]);
  const projectsDir = path.join(root, "projects");
  const reader = createJsonlReader(parseLine);

  const files = () => scanJsonlFiles(projectsDir);
  const sessionOf = (file) => path.basename(file, ".jsonl");

  return {
    id: "claude-code",
    label: "Claude Code",
    capabilities: { turnRate: true, ttft: false, sessionScope: true },
    format: "jsonl/projects-v1",
    dataDir: projectsDir,
    root,

    detect() {
      return files().length > 0;
    },

    installed() {
      return isDir(projectsDir);
    },

    currentSessionId() {
      const file = newestJsonl(projectsDir);
      if (!file) return null;
      const { records } = reader.read(file);
      const last = records[records.length - 1];
      return (last && last.sessionId) || sessionOf(file);
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
            samples: cached ? cached.records.length : null, // 只有真解析过才报数,避免为列表读全库
            file,
          };
        });
    },

    getUsage(sessionId, o = {}) {
      const all = files();
      const sid = sessionId || this.currentSessionId();
      if (!sid) return [];
      let out = [];
      // 会话 id 就在文件名里(Claude Code 的命名约定),直接定位,不必遍历全部会话
      const direct = all.find((f) => sessionOf(f) === sid);
      if (direct) {
        out = reader.read(direct).records.filter((r) => !r.sessionId || r.sessionId === sid);
      } else {
        // 文件名对不上(版本差异):退回复核文件内容里的 sessionId
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
