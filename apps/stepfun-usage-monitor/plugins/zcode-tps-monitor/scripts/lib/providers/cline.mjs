// cline Provider(V2.4.0):Cline(VS Code 扩展)的本地任务记录。
//
// 数据源:编辑器 globalStorage 下的 saoudrizwan.claude-dev/tasks/<taskId>/
// api_conversation_history.json 与 ui_messages.json(只读)。
// 目录按客户端官方摆放顺序探测:VS Code / Cursor / Windsurf / vscode-server。
//
// 口径:api_req_started 条目的 text 里嵌着 JSON(或条目自身带 tokensIn/tokensOut
// 等字段),即一次模型请求的 token 账;ts 是该请求的时刻。该格式不记录首 token
// 时刻,也没有显式的分段起止,genMs 只能用相邻请求的时间差估算。
//
// 版本相关(按 V2.4.0 计划只做只读适配):字段随扩展版本变动较大,这里只认明确
// 的 token 字段,认不出就跳过该条 —— 返回空数组而不是抛错,不影响其他数据源。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MAX_GAP_ESTIMATE_MS,
  buildRateView,
  buildTurnView,
  isDir,
  lastPromptTs,
  makeRecord,
} from "./common.mjs";

// 编辑器的 globalStorage 扩展目录名(扩展改名历史)
const EXT_DIRS = ["saoudrizwan.claude-dev", "saoudrizwan.cline", "cline.cline"];

function candidateRoots(env) {
  const override = env.TPS_CLINE_HOME;
  if (typeof override === "string" && override.trim()) return [path.resolve(override.trim())];
  const list = [];
  const push = (base, editor) => {
    if (!base) return;
    for (const ext of EXT_DIRS) list.push(path.join(base, editor, "User", "globalStorage", ext));
  };
  const home = os.homedir();
  if (process.platform === "win32") {
    push(env.APPDATA, "Code");
    push(env.APPDATA, "Cursor");
    push(env.APPDATA, "Windsurf");
    push(home, ".vscode\\extensions"); // 便携版
  } else if (process.platform === "darwin") {
    push(path.join(home, "Library", "Application Support"), "Code");
    push(path.join(home, "Library", "Application Support"), "Cursor");
  } else {
    push(path.join(home, ".config"), "Code");
    push(path.join(home, ".config"), "Cursor");
    push(path.join(home, ".vscode-server", "data"), "Code");
  }
  return list;
}

// 从条目里取 token 账:直接字段优先,其次 text 里嵌的 JSON 字符串
function readUsage(entry) {
  const direct = pick(entry);
  if (direct) return direct;
  if (typeof entry.text === "string") {
    const t = entry.text.trim();
    if (t.startsWith("{")) {
      try {
        return pick(JSON.parse(t));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function pick(obj) {
  if (!obj || typeof obj !== "object") return null;
  const out = num(obj, ["tokensOut", "output_tokens", "outputTokens", "completion_tokens"]);
  const reason = num(obj, ["reasoningTokens", "reasoning_tokens"]);
  if (out == null) return null;
  return {
    outputTokens: out,
    reasoningTokens: reason ?? 0,
    inputTokens: num(obj, ["tokensIn", "input_tokens", "inputTokens", "prompt_tokens"]) ?? 0,
    cacheRead:
      num(obj, ["cacheReads", "cache_read_input_tokens", "cacheReadInputTokens", "cached_input_tokens"]) ?? 0,
  };
}

function num(obj, keys) {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

// 一个任务目录 → 归一化记录(新→旧)。认不出的条目跳过,损坏的 JSON 跳过。
function readTask(taskDir, sessionId) {
  let entries = [];
  for (const name of ["api_conversation_history.json", "ui_messages.json"]) {
    const file = path.join(taskDir, name);
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Array.isArray(parsed)) entries.push(...parsed);
    } catch {
      continue;
    }
  }
  entries = entries.filter((e) => e && typeof e === "object" && typeof e.ts === "number");
  entries.sort((a, b) => a.ts - b.ts); // 旧→新
  const out = [];
  let prevTs = null;
  let turnKey = null;
  for (const e of entries) {
    // 用户输入开启新轮次(ask/say 里带用户文本,且不是工具回显)
    const say = typeof e.say === "string" ? e.say : "";
    const ask = typeof e.ask === "string" ? e.ask : "";
    if ((e.type === "user" || ask) && !/tool|command_result|api_req|checkpoint/i.test(say + ask)) {
      turnKey = `turn_${e.ts}`;
    }
    const usage = readUsage(e);
    if (usage) {
      const gap = prevTs == null ? null : e.ts - prevTs;
      out.push(
        makeRecord({
          provider: "cline",
          sessionId,
          turnKey,
          requestId: typeof e.id === "string" ? e.id : `cline_${e.ts}`,
          model: typeof e.model === "string" ? e.model : null,
          outputTokens: usage.outputTokens,
          reasoningTokens: usage.reasoningTokens,
          inputTokens: usage.inputTokens,
          cacheRead: usage.cacheRead,
          ttftMs: null, // 该格式不记录首 token 延迟
          genMs: gap != null && gap > 0 && gap <= MAX_GAP_ESTIMATE_MS ? gap : null,
          completedAt: e.ts,
        })
      );
    }
    prevTs = e.ts;
  }
  return out.reverse(); // 新→旧
}

export function createClineProvider(opts = {}) {
  const env = opts.env || process.env;
  const roots = opts.root ? [opts.root] : candidateRoots(env);

  const tasksDir = () => {
    for (const r of roots) {
      const dir = path.join(r, "tasks");
      if (isDir(dir)) return dir;
    }
    return null;
  };

  const tasks = () => {
    const dir = tasksDir();
    if (!dir) return [];
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => ({ id: e.name, dir: path.join(dir, e.name) }))
      .sort((a, b) => statMtime(b.dir) - statMtime(a.dir));
  };

  return {
    id: "cline",
    label: "Cline",
    capabilities: { turnRate: true, ttft: false, sessionScope: true },
    format: "json/tasks-v1",
    dataDir: tasksDir(),
    roots,
    note: "按 tasks/<taskId>/api_conversation_history.json 只读解析;该扩展版本相关,认不出的字段跳过",

    detect() {
      return tasks().length > 0;
    },

    installed() {
      return roots.some((r) => isDir(r));
    },

    currentSessionId() {
      const list = tasks();
      return list.length ? list[0].id : null;
    },

    listSessions(limit = 20) {
      return tasks()
        .slice(0, limit)
        .map((t) => ({ sessionId: t.id, lastAt: statMtime(t.dir), samples: null }));
    },

    getUsage(sessionId, o = {}) {
      const list = tasks();
      const sid = sessionId || (list.length ? list[0].id : null);
      if (!sid) return [];
      const task = list.find((t) => t.id === sid);
      if (!task) return [];
      return readTask(task.dir, sid).slice(0, o.limit || 5000);
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

function statMtime(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}
