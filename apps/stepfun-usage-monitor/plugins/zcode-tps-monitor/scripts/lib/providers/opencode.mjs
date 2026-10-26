// opencode Provider(V2.4.0):OpenCode 的本地存储。
//
// 数据源:~/.local/share/opencode/storage/message/<sessionId>/<messageId>.json
// (另有 ~/.opencode、%APPDATA%/opencode 等位置,逐一探测)。
// 口径:每条 assistant 消息的 tokens 即一次模型请求的 token 账,time.created /
// time.completed 给出该段的起止,因此 genMs 是客户端自己记录的纯生成耗时(最准)。
// 轮次边界取用户消息(role=user),与 ZCode 的 turn_id 口径对齐。
//
// 版本相关(按 V2.4.0 计划只做只读适配):存储布局随版本变化,认不出布局时
// getUsage 返回空数组并保留 note 说明,不影响其他数据源,也不抛错。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildRateView,
  buildTurnView,
  isDir,
  lastPromptTs,
  makeRecord,
} from "./common.mjs";

// 客户端官方位置不统一,这里按常见摆放顺序探测
function candidateRoots(env) {
  const override = env.TPS_OPENCODE_HOME;
  const list = [];
  if (typeof override === "string" && override.trim()) {
    list.push(path.resolve(override.trim()));
  }
  const home = os.homedir();
  list.push(path.join(home, ".local", "share", "opencode"));
  list.push(path.join(home, ".opencode"));
  if (process.platform === "win32" && env.APPDATA) list.push(path.join(env.APPDATA, "opencode"));
  return list;
}

// 单条消息 JSON → 归一化记录;认不出返回 null
function toRecord(msg, sessionId, turnKey) {
  if (!msg || typeof msg !== "object") return null;
  const tokens = msg.tokens && typeof msg.tokens === "object" ? msg.tokens : null;
  const cache = tokens && tokens.cache && typeof tokens.cache === "object" ? tokens.cache : null;
  const time = msg.time && typeof msg.time === "object" ? msg.time : null;
  const created = time && typeof time.created === "number" ? time.created : null;
  const completed = time && typeof time.completed === "number" ? time.completed : null;
  if (!tokens || completed == null) return null;
  const genMs = created != null && completed > created ? completed - created : null;
  return makeRecord({
    provider: "opencode",
    sessionId,
    turnKey,
    requestId: typeof msg.id === "string" ? msg.id : null,
    model: typeof msg.modelID === "string" ? msg.modelID : null,
    outputTokens: tokens.output,
    reasoningTokens: tokens.reasoning,
    inputTokens: tokens.input,
    cacheRead: cache ? cache.read : null,
    ttftMs: null, // 该布局不记录首 token 延迟
    genMs,
    completedAt: completed,
  });
}

export function createOpenCodeProvider(opts = {}) {
  const env = opts.env || process.env;
  const roots = opts.root ? [opts.root] : candidateRoots(env);

  // 定位到第一个含 storage/message 的根目录
  const messageDir = () => {
    for (const r of roots) {
      const dir = path.join(r, "storage", "message");
      if (isDir(dir)) return dir;
    }
    return null;
  };

  const sessionDirs = () => {
    const dir = messageDir();
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
      .sort((a, b) => {
        const ma = statMtime(a.dir);
        const mb = statMtime(b.dir);
        return mb - ma; // 新的在前
      });
  };

  const readSession = (sessionDir) => {
    let files = [];
    try {
      files = fs.readdirSync(sessionDir).filter((f) => f.endsWith(".json")).sort();
    } catch {
      return [];
    }
    const out = [];
    let turnKey = null;
    for (const f of files) {
      let msg = null;
      try {
        msg = JSON.parse(fs.readFileSync(path.join(sessionDir, f), "utf8"));
      } catch {
        continue; // 单条损坏不影响其余
      }
      const role = typeof msg.role === "string" ? msg.role : "";
      if (role === "user") {
        turnKey = typeof msg.id === "string" ? msg.id : `turn_${f}`;
        continue; // 用户消息本身没有 token 账
      }
      const rec = toRecord(msg, path.basename(sessionDir), turnKey);
      if (rec) out.push(rec);
    }
    return out;
  };

  return {
    id: "opencode",
    label: "OpenCode",
    capabilities: { turnRate: true, ttft: false, sessionScope: true },
    format: "json/storage-message-v1",
    dataDir: messageDir(),
    roots,
    note: "按 storage/message 布局只读解析;该客户端版本相关,识别不到布局时返回空(不影响其他数据源)",

    detect() {
      return sessionDirs().length > 0;
    },

    installed() {
      return roots.some((r) => isDir(r));
    },

    currentSessionId() {
      const dirs = sessionDirs();
      return dirs.length ? dirs[0].id : null;
    },

    listSessions(limit = 20) {
      return sessionDirs()
        .slice(0, limit)
        .map((d) => ({ sessionId: d.id, lastAt: statMtime(d.dir), samples: null }));
    },

    getUsage(sessionId, o = {}) {
      const dirs = sessionDirs();
      const sid = sessionId || (dirs.length ? dirs[0].id : null);
      if (!sid) return [];
      const dir = dirs.find((d) => d.id === sid);
      if (!dir) return [];
      return readSession(dir.dir)
        .sort((a, b) => b.completedAt - a.completedAt)
        .slice(0, o.limit || 5000);
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
