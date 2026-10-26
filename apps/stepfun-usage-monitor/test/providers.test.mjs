// 单元测试:node --test
// V2.4.0 多 agent Provider 数据层测试矩阵。
// 每个 Provider 一组只读本地夹具,外加:
//   - 默认 providers=["zcode"] 与 V2.3.0 字节一致(只多一个 provider 字段)
//   - 多源合并、能力降级(不记录 TTFT 的源 ttftMs=null)、来源明细
//   - 单源数据损坏时其余源照常出数(故障隔离)
//   - doctor 对每个启用的源给「可用/不可用 + 原因」
//   - /tps CLI 的 --agent / --session / --agents 作用域参数
//   - MCP 返回结构只增字段(provider / sessionId)
//   - 大屏 /api/config 与 SSE 的 provider 字段
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

process.removeAllListeners("warning");
process.on("warning", () => {});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const PLUGIN = path.join(ROOT, "plugins", "zcode-tps-monitor");
const NODE = process.execPath;

// --- 环境隔离:HOME/USERPROFILE 指向夹具目录,配置与 ~/.zcode 状态都落在里面 ---
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tps-providers-"));
process.env.HOME = tmp;
process.env.USERPROFILE = tmp;
delete process.env.TPS_PROVIDERS; // 环境变量会覆盖配置文件,先清掉
// 速率口径与 token-rate.test.mjs 一致(短窗口便于精确断言)
process.env.TOKEN_RATE_WINDOW = "5";
process.env.TOKEN_RATE_HIST = "10";
process.env.TOKEN_RATE_MIN_MS = "100";
process.env.TOKEN_RATE_MAX_MS = "60000";

const CONFIG_FILE = path.join(tmp, ".zcode", "tps-monitor.config.json");
const STATE_FILE = path.join(tmp, ".zcode", "tps-monitor.last-session.json");
const writeConfig = (cfg) => {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
};
const removeConfig = () => {
  try { fs.unlinkSync(CONFIG_FILE); } catch {}
};
// 钩子写的"最后所处会话":大屏/Electron 据此圈定会话,这里固定成 zcode 夹具会话
const writeState = (sessionId = "z1") => {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ sessionId, ts: Date.now(), source: "test" }));
};

// 夹具统一用同一个时间基址,便于逐条核对完成时刻与生成耗时
const T = 1_800_000_000_000;

// ---------- 夹具 1:zcode(SQLite usage 库,与 token-rate.test.mjs 同口径) ----------
const zcodeDb = path.join(tmp, "zcode.sqlite");
{
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(zcodeDb);
  db.exec(`CREATE TABLE model_usage (
    session_id TEXT, status TEXT, query_source TEXT, model_id TEXT,
    output_tokens INTEGER, reasoning_tokens INTEGER, input_tokens INTEGER, cache_read_input_tokens INTEGER,
    first_token_at INTEGER, completed_at INTEGER, time_to_first_token_ms INTEGER, turn_id TEXT)`);
  const ins = db.prepare(
    "INSERT INTO model_usage VALUES (?, 'completed', 'main_turn', 'test-model', ?, ?, 120000, 118000, ?, ?, ?, ?)"
  );
  ins.run("z1", 500, 100, 1000, 2000, 800, "t_old");   // gen 1000ms → 600 tok/s
  ins.run("z1", 900, 0, 2000, 5000, 700, "t_old");     // gen 3000ms → 300 tok/s
  ins.run("z1", 80, 0, 6500, 7000, 450, "t_new");      // gen 500ms  → 160 tok/s
  ins.run("z1", 20, 0, 7550, 7600, 100, "t_new");      // gen 50ms < MIN → 无速率,计入累计
  ins.run("z1", 220, 0, 9000, 10100, 600, "t_new");    // gen 1100ms → 200 tok/s(会话最新)
  db.close();
}
process.env.ZCODE_USAGE_DB = zcodeDb;

// ---------- 夹具 2:claude-code(JSONL 会话日志) ----------
const CC_SESSION = "cc111111-2222-3333-4444-555555555555";
const claudeHome = path.join(tmp, "claude");
const ccFile = path.join(claudeHome, "projects", "E--proj", `${CC_SESSION}.jsonl`);
{
  const lines = [
    { type: "user", sessionId: CC_SESSION, timestamp: T, uuid: "u1",
      message: { id: "msg_u1", role: "user", content: [{ type: "text", text: "hi" }] } },
    { type: "assistant", sessionId: CC_SESSION, timestamp: T + 1000, uuid: "a1", requestId: "req_1",
      message: { id: "msg_a1", model: "claude-sonnet-4-5",
        usage: { input_tokens: 1000, output_tokens: 300, cache_read_input_tokens: 200 } } },
    { type: "assistant", sessionId: CC_SESSION, timestamp: T + 3000, uuid: "a2", requestId: "req_2",
      message: { id: "msg_a2", model: "claude-sonnet-4-5",
        usage: { input_tokens: 1200, output_tokens: 100 } } },
  ];
  fs.mkdirSync(path.dirname(ccFile), { recursive: true });
  fs.writeFileSync(ccFile, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}
process.env.TPS_CLAUDE_CODE_HOME = claudeHome;

// ---------- 夹具 3:codex(rollout JSONL,只有累计 token 计数的旧版格式) ----------
const CDX_UUID = "aaaaaaa1-2222-3333-4444-555555555555";
const CDX_SESSION = "cdx-s1"; // session_meta 里的权威 id,与文件名不同(走内容兜底分支)
const codexHome = path.join(tmp, "codex");
const cdxFile = path.join(codexHome, "sessions", "2026", "09", "26",
  `rollout-2026-09-26T10-00-00-${CDX_UUID}.jsonl`);
{
  const lines = [
    { type: "session_meta", timestamp: T, payload: { id: CDX_SESSION } },
    { type: "turn_context", timestamp: T, payload: { model: "gpt-5-codex" } },
    { type: "response_item", timestamp: T, payload: { type: "message", role: "user", id: "m1" } },
    { type: "response_item", timestamp: T + 2000,
      payload: { type: "token_count", info: { total_token_usage: {
        input_tokens: 1000, output_tokens: 300, reasoning_output_tokens: 0, cached_input_tokens: 100 } } } },
    { type: "response_item", timestamp: T + 5000,
      payload: { type: "token_count", info: { total_token_usage: {
        input_tokens: 1300, output_tokens: 400, reasoning_output_tokens: 0, cached_input_tokens: 200 } } } },
  ];
  fs.mkdirSync(path.dirname(cdxFile), { recursive: true });
  fs.writeFileSync(cdxFile, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}
process.env.TPS_CODEX_HOME = codexHome;

// ---------- 夹具 4:opencode(storage/message 消息文件) ----------
const OC_SESSION = "oc-s1";
const opencodeHome = path.join(tmp, "opencode");
const ocDir = path.join(opencodeHome, "storage", "message", OC_SESSION);
{
  fs.mkdirSync(ocDir, { recursive: true });
  fs.writeFileSync(path.join(ocDir, "m1.json"), JSON.stringify({
    id: "ocm_u1", role: "user", time: { created: T, completed: T },
  }));
  fs.writeFileSync(path.join(ocDir, "m2.json"), JSON.stringify({
    id: "ocm_a1", role: "assistant", modelID: "opencode-model",
    tokens: { input: 100, output: 300, reasoning: 50, cache: { read: 20 } },
    time: { created: T + 1000, completed: T + 3000 },
  }));
}
process.env.TPS_OPENCODE_HOME = opencodeHome;

// ---------- 夹具 5:cline(任务目录里的对话历史) ----------
const CLINE_SESSION = "task-1";
const clineHome = path.join(tmp, "cline");
const clineTaskDir = path.join(clineHome, "tasks", CLINE_SESSION);
{
  const entries = [
    { ts: T + 1000, type: "say", say: "task", text: "开始" },
    { ts: T + 1100, type: "ask", ask: "followup" },
    { ts: T + 2000, type: "say", say: "api_req_started",
      text: JSON.stringify({ tokensIn: 100, tokensOut: 300, cacheReads: 10 }) },
    { ts: T + 5000, type: "say", say: "api_req_started",
      text: JSON.stringify({ tokensIn: 150, tokensOut: 100 }) },
  ];
  fs.mkdirSync(clineTaskDir, { recursive: true });
  fs.writeFileSync(path.join(clineTaskDir, "api_conversation_history.json"), JSON.stringify(entries));
}
process.env.TPS_CLINE_HOME = clineHome;

// ---------- 夹具 6:损坏的数据(不是 SQLite 的文件;坏 JSONL 行) ----------
const brokenDb = path.join(tmp, "broken.sqlite");
fs.writeFileSync(brokenDb, "this is definitely not a sqlite database");
const brokenJsonl = path.join(tmp, "broken-cc.jsonl");
fs.writeFileSync(brokenJsonl, '{"type":"user","timestamp":"x"\n{"broken json\n');

const { aggregateRate, aggregateTurn, agentStatus } = await import(
  pathToFileURL(path.join(PLUGIN, "scripts", "lib", "collect-core.mjs")).href
);
const { openUsageDb } = await import(pathToFileURL(path.join(PLUGIN, "scripts", "lib", "usage-db.mjs")).href);
const providersIndex = await import(pathToFileURL(path.join(PLUGIN, "scripts", "lib", "providers", "index.mjs")).href);
const { query: cliQuery, queryTurn: cliQueryTurn } = await import(
  pathToFileURL(path.join(PLUGIN, "scripts", "token-rate.mjs")).href
);

// 以钩子进程的真实边界跑一遍(与 perf.test.mjs 同一套约定)
function runHook(script, stdinText, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(PLUGIN, "hooks", script)], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out, err }));
    child.stdin.end(stdinText);
  });
}

// ---------- Provider 注册表 ----------

test("注册表:五个源、能力矩阵、默认仅 zcode", () => {
  assert.deepEqual(providersIndex.DEFAULT_PROVIDER_IDS, ["zcode"]);
  assert.deepEqual(providersIndex.PROVIDER_IDS, ["zcode", "claude-code", "codex", "opencode", "cline"]);
  assert.deepEqual(providersIndex.PROVIDER_CAPABILITIES.zcode,
    { turnRate: true, ttft: true, sessionScope: true });
  for (const id of ["claude-code", "codex", "opencode", "cline"]) {
    assert.deepEqual(providersIndex.PROVIDER_CAPABILITIES[id],
      { turnRate: true, ttft: false, sessionScope: true }, `${id} 不记录 TTFT,必须声明降级`);
  }
  // 缺省配置(空对象)与未知 id 都回到默认单源
  assert.deepEqual(providersIndex.enabledProviderIds({}), ["zcode"]);
  assert.deepEqual(providersIndex.normalizeProviderIds(["claude", "z-code", "bogus", "zcode"]),
    ["claude-code", "zcode"]);
  assert.deepEqual(providersIndex.normalizeProviderIds(["nope"]), ["zcode"]);
  assert.equal(providersIndex.isKnownProviderId("cline"), true);
  assert.equal(providersIndex.isKnownProviderId("cursor"), false);
});

// ---------- 各 Provider 夹具 ----------

test("claude-code fixture:两段 usage 归一化为速率,turnKey 取用户消息 id", () => {
  const r = cliQuery(CC_SESSION, { agent: "claude-code" });
  assert.equal(r.provider, "claude-code");
  assert.equal(r.sessionId, CC_SESSION);
  assert.equal(r.latest.tokPerSec, 50);          // 100 tok / 2000ms
  assert.equal(r.latest.model, "claude-sonnet-4-5");
  assert.equal(r.session.samples, 2);
  assert.equal(r.session.max, 300);              // 300 tok / 1000ms
  assert.equal(r.session.requests, 2);
  assert.equal(r.session.totalOutput, 400);
  assert.equal(r.session.totalCacheRead, 200);   // 缓存读字段也要归一化进来
  const t = cliQueryTurn(CC_SESSION, { agent: "claude-code" });
  assert.equal(t.turnId, "msg_u1");
  assert.equal(t.turn.requests, 2);
  assert.equal(t.turn.totalOutput, 400);
  assert.equal(t.turn.tokPerSec, 133.3);         // 400 tok / 3000ms 加权
  assert.equal(t.turn.peak, 300);
  assert.equal(t.turn.lastAt, T + 3000);
});

test("codex fixture:累计 token 计数求差得到单次增量", () => {
  const r = cliQuery(CDX_SESSION, { agent: "codex" });
  assert.equal(r.provider, "codex");
  assert.equal(r.sessionId, CDX_SESSION);
  assert.equal(r.latest.tokPerSec, 33.3);        // 第 2 次增量 100 tok / 3000ms
  assert.equal(r.latest.model, "gpt-5-codex");
  assert.equal(r.session.max, 150);              // 第 1 次按绝对值 300 tok / 2000ms
  assert.equal(r.session.requests, 2);
  assert.equal(r.session.totalOutput, 400);
  const t = cliQueryTurn(CDX_SESSION, { agent: "codex" });
  assert.equal(t.turnId, "m1");
  assert.equal(t.turn.requests, 2);
  assert.equal(t.turn.totalOutput, 400);
  assert.equal(t.turn.tokPerSec, 80);            // 400 tok / 5000ms
  assert.equal(t.turn.peak, 150);
  assert.equal(t.turn.lastAt, T + 5000);
});

test("opencode fixture:客户端自记的 created/completed 即纯生成耗时", () => {
  const r = cliQuery(OC_SESSION, { agent: "opencode" });
  assert.equal(r.provider, "opencode");
  assert.equal(r.sessionId, OC_SESSION);
  assert.equal(r.latest.tokPerSec, 175);         // (300 输出 + 50 思考) / 2000ms
  assert.equal(r.latest.model, "opencode-model");
  assert.equal(r.session.samples, 1);
  assert.equal(r.session.totalReasoning, 50);    // 思考 token 计入分子
  assert.equal(r.session.totalCacheRead, 20);
  const t = cliQueryTurn(OC_SESSION, { agent: "opencode" });
  assert.equal(t.turnId, "ocm_u1");
  assert.equal(t.turn.requests, 1);
  assert.equal(t.turn.tokPerSec, 175);
  assert.equal(t.turn.genMs, 2000);
});

test("cline fixture:相邻请求时间差估算生成耗时,turnKey 取用户提问", () => {
  const r = cliQuery(CLINE_SESSION, { agent: "cline" });
  assert.equal(r.provider, "cline");
  assert.equal(r.sessionId, CLINE_SESSION);
  assert.equal(r.latest.tokPerSec, 33.3);        // 100 tok / 3000ms
  assert.equal(r.session.max, 333.3);            // 300 tok / 900ms
  assert.equal(r.session.requests, 2);
  assert.equal(r.session.totalOutput, 400);
  const t = cliQueryTurn(CLINE_SESSION, { agent: "cline" });
  assert.equal(t.turnId, `turn_${T + 1100}`);
  assert.equal(t.turn.requests, 2);
  assert.equal(t.turn.tokPerSec, 102.6);         // 400 tok / 3900ms
  assert.equal(t.turn.peak, 333.3);
  assert.equal(t.turn.lastAt, T + 5000);
});

test("能力降级:四个第三方源都没有 TTFT,字段为空而不是编数字", () => {
  for (const [id, sid] of [["claude-code", CC_SESSION], ["codex", CDX_SESSION],
    ["opencode", OC_SESSION], ["cline", CLINE_SESSION]]) {
    const r = cliQuery(sid, { agent: id });
    assert.equal(r.latest.ttftMs, null, `${id} 无 TTFT 时应为空`);
    const t = cliQueryTurn(sid, { agent: id });
    assert.equal(t.turn.ttftMs, null, `${id} 无 TTFT 时应为空`);
  }
  // zcode 自己的库有首 token 时刻,不受降级影响
  assert.equal(cliQuery("z1").latest.ttftMs, 600);
});

// ---------- 默认单源:与 V2.3.0 字节一致 ----------

test("默认 providers 只读 zcode,输出与 V2.3.0 逐字节一致(只多 provider 字段)", () => {
  removeConfig(); // 完全没有配置文件 = 用户机器上的缺省状态
  const env = process.env;
  const r = aggregateRate({ sessionId: "z1", env });
  const { provider, ...rest } = r;
  assert.equal(provider, "zcode");
  const reader = openUsageDb(zcodeDb);
  try {
    assert.deepEqual(rest, reader.query("z1")); // 除 provider 外零差异
  } finally {
    reader.close();
  }
  assert.ok(!("sources" in r) && !("agents" in r), "单源路径不背多源结构");
  assert.equal(r.latest.tokPerSec, 200);
  assert.equal(r.session.totalOutput, 1720);

  const t = aggregateTurn({ sessionId: "z1", env });
  const { provider: tp, ...trest } = t;
  assert.equal(tp, "zcode");
  const reader2 = openUsageDb(zcodeDb);
  try {
    assert.deepEqual(trest, reader2.queryTurn("z1"));
  } finally {
    reader2.close();
  }
  // 显式写成 ["zcode"] 也一样
  const r2 = aggregateRate({ sessionId: "z1", cfg: { providers: ["zcode"] }, env });
  assert.deepEqual(r2, r);
});

// ---------- 多源聚合 ----------

test("多源合并:归一化后按完成时刻排序,统计与来源明细齐全", () => {
  const env = process.env;
  const r = aggregateRate({ cfg: { providers: ["claude-code", "codex", "opencode", "cline"] }, env });
  assert.equal(r.provider, "claude-code");       // 第一个出数的源
  assert.equal(r.sessionId, CC_SESSION);
  assert.equal(r.scoped, "auto");
  assert.equal(r.session.samples, 5);            // 窗口 5 条
  assert.equal(r.session.requests, 7);           // 四个源合计 7 条记录
  assert.equal(r.session.totalOutput, 1500);     // 400+400+300+400
  assert.equal(r.session.totalReasoning, 50);    // 只有 opencode 记了思考 token
  assert.equal(r.latest.tokPerSec, 33.3);        // codex/cline 并列最新,取声明在前的 codex
  assert.equal(r.latest.model, "gpt-5-codex");
  assert.equal(r.history.length, 5);
  assert.equal(r.history[0].completedAt, T + 2000); // 曲线为旧→新
  assert.equal(r.history[r.history.length - 1].completedAt, T + 5000);

  assert.equal(r.sources.length, 4);
  for (const s of r.sources) {
    assert.equal(s.ok, true, `${s.provider} 应探测到数据`);
    assert.ok(s.samples > 0);
    assert.ok(s.format);
  }
  const byId = Object.fromEntries(r.sources.map((s) => [s.provider, s]));
  assert.equal(byId["claude-code"].samples, 2);
  assert.equal(byId.codex.samples, 2);
  assert.equal(byId.opencode.samples, 1);
  assert.equal(byId.cline.samples, 2);
  assert.equal(byId.codex.sessionId, CDX_SESSION);

  assert.equal(r.agents.length, 4);
  for (const a of r.agents) assert.deepEqual(a.capabilities,
    { turnRate: true, ttft: false, sessionScope: true });

  // 本轮:多源取最近一个有本轮数据的源(codex 与 cline 并列,声明在前的 codex 胜出)
  const t = aggregateTurn({ cfg: { providers: ["claude-code", "codex", "opencode", "cline"] }, env });
  assert.equal(t.provider, "codex");
  assert.equal(t.turnId, "m1");
  assert.equal(t.turn.requests, 2);
  assert.equal(t.turn.tokPerSec, 80);
  assert.equal(t.turn.lastAt, T + 5000);
  assert.equal(t.session.totalOutput, 400);      // 会话累计只算被选中的那个源
});

test("未安装的客户端被跳过,不影响已安装源的统计", () => {
  const empty = path.join(tmp, "empty-claude");
  fs.mkdirSync(empty, { recursive: true });
  const env = { ...process.env, TPS_CLAUDE_CODE_HOME: empty };
  const r = aggregateRate({ cfg: { providers: ["claude-code", "codex"] }, env });
  assert.equal(r.provider, "codex");
  const claude = r.sources.find((s) => s.provider === "claude-code");
  assert.equal(claude.ok, false);
  assert.match(claude.reason, /未检测到该客户端的数据目录|已安装该客户端,但本地还没有会话数据/);
  assert.equal(r.latest.tokPerSec, 33.3);
});

// ---------- 故障隔离 ----------

test("单源数据损坏:该源报错并说明原因,其余源照常出数", () => {
  const env = { ...process.env, ZCODE_USAGE_DB: brokenDb };
  const cfg = { providers: ["zcode", "codex"] };
  const r = aggregateRate({ cfg, env }); // 不抛错
  assert.equal(r.provider, "codex");
  assert.equal(r.latest.tokPerSec, 33.3);
  const z = r.sources.find((s) => s.provider === "zcode");
  assert.equal(z.ok, false);
  assert.match(z.reason, /数据读取失败/);
  const cdx = r.sources.find((s) => s.provider === "codex");
  assert.equal(cdx.ok, true);
  assert.equal(cdx.samples, 2);
  // 本轮视图同样隔离
  const t = aggregateTurn({ cfg, env });
  assert.equal(t.provider, "codex");
  assert.equal(t.turn.tokPerSec, 80);
});

test("损坏 JSONL 的单行只跳过该行,不影响同文件其余记录", async () => {
  const home = path.join(tmp, "claude-broken-line");
  const dir = path.join(home, "projects");
  fs.mkdirSync(dir, { recursive: true });
  const good = [
    { type: "user", sessionId: "ccb", timestamp: T, uuid: "u1",
      message: { id: "m_u", role: "user", content: [{ type: "text", text: "hi" }] } },
    "{ this line is not json",
    { type: "assistant", sessionId: "ccb", timestamp: T + 1000, uuid: "a1",
      message: { id: "m_a", model: "m", usage: { input_tokens: 10, output_tokens: 200 } } },
  ].map((l) => (typeof l === "string" ? l : JSON.stringify(l)));
  fs.writeFileSync(path.join(dir, "ccb.jsonl"), good.join("\n") + "\n");
  const env = { ...process.env, TPS_CLAUDE_CODE_HOME: home };
  const r = aggregateRate({ cfg: { providers: ["claude-code"] }, env });
  assert.equal(r.provider, "claude-code");
  assert.equal(r.session.requests, 1);            // 坏行被跳过,只剩 1 条 usage
  assert.equal(r.latest.tokPerSec, 200);          // 200 tok / 1000ms
  assert.equal(r.latest.model, "m");
});

test("agentStatus:逐源独立给结论,损坏源只让自己变红", () => {
  const list = agentStatus({ cfg: { providers: ["zcode", "claude-code", "codex", "opencode", "cline"] } });
  assert.equal(list.length, 5);
  for (const e of list) {
    assert.equal(e.ok, true, `${e.provider}: ${e.reason}`);
    assert.ok(e.format);
    assert.ok(e.capabilities);
    assert.ok(e.sessions >= 1);
    assert.ok(e.samples >= 1);
    assert.ok(e.sessionId);
  }
  const broken = agentStatus({ cfg: { providers: ["zcode", "codex"] }, env: { ...process.env, ZCODE_USAGE_DB: brokenDb } });
  const z = broken.find((e) => e.provider === "zcode");
  assert.equal(z.ok, false);
  assert.equal(z.detected, true);                 // 库在但不读得了:算损坏而非未安装
  assert.match(z.reason, /数据读取失败/);
  const cdx = broken.find((e) => e.provider === "codex");
  assert.equal(cdx.ok, true);
  assert.equal(cdx.samples, 2);
});

// ---------- doctor 多源自检 ----------

test("doctor:对每个启用的源给出可用/不可用 + 原因,损坏源不连累其他源", async () => {
  writeState();
  writeConfig({ providers: ["zcode", "claude-code", "codex", "opencode", "cline"] });
  process.env.ZCODE_USAGE_DB = zcodeDb;
  const ok = await import(pathToFileURL(path.join(PLUGIN, "scripts", "doctor.mjs")).href);
  const report = await ok.runDoctor();
  const check = report.checks.find((c) => c.name === "数据源(多 agent)");
  assert.ok(check, "doctor 应包含多源数据自检项");
  assert.equal(check.ok, true, JSON.stringify(check.providers, null, 2));
  assert.equal(check.providers.length, 5);
  for (const p of check.providers) {
    assert.equal(p.ok, true, `${p.provider}: ${p.reason}`);
    assert.equal(p.skipped, false);
    assert.ok(p.format);
    assert.ok(p.capabilities);
    assert.ok(p.samples >= 1);
  }
  assert.match(check.detail, /ZCode ✅/);

  // 损坏 zcode 库:只有它自己那一项变红,其余四项照常
  process.env.ZCODE_USAGE_DB = brokenDb;
  try {
    const bad = await import(pathToFileURL(path.join(PLUGIN, "scripts", "doctor.mjs")).href + "?corrupt");
    const report2 = await bad.runDoctor();
    const check2 = report2.checks.find((c) => c.name === "数据源(多 agent)");
    assert.equal(check2.ok, false, "有源损坏时该项必须报红");
    const pz = check2.providers.find((p) => p.provider === "zcode");
    assert.equal(pz.ok, false);
    assert.equal(pz.skipped, false);
    assert.match(pz.reason, /数据读取失败/);
    for (const id of ["claude-code", "codex", "opencode", "cline"]) {
      const p = check2.providers.find((x) => x.provider === id);
      assert.equal(p.ok, true, `${id} 不应被别的源连累`);
    }
  } finally {
    process.env.ZCODE_USAGE_DB = zcodeDb;
  }
});

// ---------- /tps CLI 作用域参数 ----------

const runCli = (args) =>
  spawnSync(NODE, [path.join(PLUGIN, "scripts", "token-rate.mjs"), ...args], {
    encoding: "utf8", env: process.env, cwd: PLUGIN,
  });

test("CLI:--agent 未知 id 时报错并列出可用数据源", () => {
  const r = runCli(["--agent", "bogus", "--json"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /未知的数据源:bogus/);
  for (const id of ["zcode", "claude-code", "codex", "opencode", "cline"]) {
    assert.ok(r.stderr.includes(id), `应提示可用源 ${id}`);
  }
});

test("CLI:--agents 列出每个源的探测结果与样本数", () => {
  writeConfig({ providers: ["zcode", "claude-code", "codex", "opencode", "cline"] });
  const r = runCli(["--agents", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const rows = JSON.parse(r.stdout);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((x) => x.provider),
    ["zcode", "claude-code", "codex", "opencode", "cline"]);
  for (const row of rows) {
    assert.equal(row.available, true);
    assert.ok(row.format);
    assert.ok(row.samples >= 1);
    assert.equal(row.capabilities.ttft, row.provider === "zcode");
  }
  // 人类可读输出也要能看
  const text = runCli(["--agents"]);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /Claude Code/);
  assert.match(text.stdout, /条样本/);
});

test("CLI:--agent 圈定单一源,多源明细与降级字段都在", () => {
  writeConfig({ providers: ["zcode", "claude-code", "codex", "opencode", "cline"] });
  const r = runCli(["--agent", "codex", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.equal(o.provider, "codex");
  assert.equal(o.sessionId, CDX_SESSION);
  assert.equal(o.sources.length, 1);
  assert.equal(o.sources[0].ok, true);
  assert.equal(o.latest.tokPerSec, 33.3);

  // 无 TTFT 的源:人类可读输出里首字显示 "-",不编数字
  const cline = runCli(["--agent", "cline"]);
  assert.equal(cline.status, 0, cline.stderr);
  assert.match(cline.stdout, /首字 -s/);
  assert.match(cline.stdout, /33\.3 tok\/s/);
  assert.match(cline.stdout, /数据源:/);         // 多源时才打印来源明细
});

test("CLI:--session 优先于环境变量,缺省仍是 zcode 单源", () => {
  removeConfig();
  const r = runCli(["--session", "z1", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.equal(o.provider, "zcode");
  assert.equal(o.sessionId, "z1");
  assert.equal(o.scoped, "explicit");
  assert.ok(!("sources" in o), "缺省单源不打印多源明细");
  assert.equal(o.latest.tokPerSec, 200);

  // 环境变量兜底(--session 没有时才用)
  const envRun = spawnSync(NODE, [path.join(PLUGIN, "scripts", "token-rate.mjs"), "--json"], {
    encoding: "utf8", env: { ...process.env, ZCODE_SESSION_ID: "z1" }, cwd: PLUGIN,
  });
  assert.equal(envRun.status, 0, envRun.stderr);
  assert.equal(JSON.parse(envRun.stdout).sessionId, "z1");
});

test("CLI:--turn 与 --current 走同一条聚合层", () => {
  removeConfig();
  const r = runCli(["--turn", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.equal(o.provider, "zcode");
  assert.equal(o.turnId, "t_new");
  assert.equal(o.turn.tokPerSec, 187.5);
});

// ---------- MCP 返回结构只增字段 ----------

function mcpRoundTrip(requests, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const child = spawn(NODE, [path.join(PLUGIN, "mcp", "tps-server.mjs")], {
      env: process.env, stdio: ["pipe", "pipe", "pipe"],
    });
    child.unref();
    // 按字节累计:Content-Length 数的是字节,而快照文案含中文,拿字符串下标切会错位
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`MCP 响应超时,已收到: ${buf.toString("utf8").slice(0, 200)}`));
    }, timeoutMs);
    const done = (fn, arg) => { clearTimeout(timer); child.kill(); fn(arg); };
    child.stdout.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const frames = [];
      let rest = buf;
      while (true) {
        const i = rest.indexOf("\r\n\r\n");
        if (i === -1) break;
        const m = /Content-Length:\s*(\d+)/i.exec(rest.toString("latin1", 0, i));
        if (!m) { rest = rest.subarray(i + 4); continue; }
        const start = i + 4;
        const end = start + Number(m[1]);
        if (rest.length < end) break;
        frames.push(JSON.parse(rest.toString("utf8", start, end)));
        rest = rest.subarray(end);
      }
      if (frames.length >= requests.length) done(resolve, frames);
    });
    child.on("error", (e) => done(reject, e));
    child.stdin.end(requests.map((r) => JSON.stringify(r)).join("\n") + "\n");
  });
}

test("MCP:工具清单与返回结构稳定,只新增 provider/sessionId", async () => {
  writeConfig({ providers: ["zcode"] });
  const frames = await mcpRoundTrip([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "tps_snapshot", arguments: {} } },
  ]);
  const byId = Object.fromEntries(frames.map((f) => [f.id, f]));
  assert.equal(byId[1].result.serverInfo.name, "zcode-tps-monitor");
  // 工具名不变:老客户端按名字调用不受影响
  assert.deepEqual(byId[2].result.tools.map((t) => t.name), ["tps_snapshot", "tps_watch"]);
  const snap = byId[3].result;
  assert.equal(snap.isError, false);
  assert.ok(Array.isArray(snap.content) && snap.content[0].type === "text");
  // 只增字段:provider / sessionId
  assert.equal(snap.provider, "zcode");
  assert.equal(snap.sessionId, "z1");
  // 原有字段一个没少
  for (const k of ["content", "isError"]) assert.ok(k in snap, `原字段 ${k} 应保留`);
});

// ---------- 大屏 /api/config 与 SSE ----------

function getJson(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch (e) { reject(new Error(`${urlPath} 响应不是 JSON: ${body.slice(0, 200)}`)); }
      });
    }).on("error", reject);
  });
}

function postJson(port, urlPath, obj) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(obj);
    const req = http.request({ host: "127.0.0.1", port, path: urlPath, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } },
    (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch (e) { reject(new Error(`POST ${urlPath} 响应不是 JSON: ${body.slice(0, 200)}`)); }
      });
    });
    req.on("error", reject);
    req.end(payload);
  });
}

// 连上 SSE,等第一个指定事件的帧(服务端连上就推全量快照)
function sseFrame(port, event, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/api/events" }, (res) => {
      res.setEncoding("utf8");
      let buf = "";
      res.on("data", (c) => {
        buf += c;
        const i = buf.indexOf(`event: ${event}\n`);
        if (i === -1) return;
        const m = /^data: (.*)$/m.exec(buf.slice(i));
        if (!m) return;
        try { resolve(JSON.parse(m[1])); } catch (e) { reject(e); }
        req.destroy();
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    setTimeout(() => { req.destroy(); reject(new Error(`SSE 等待 ${event} 超时`)); }, timeoutMs).unref();
  });
}

test("大屏:/api/config 读写 providers,SSE 只多 provider 字段", async () => {
  writeState("z1");
  writeConfig({ providers: ["zcode"], stopHookLine: true });
  const { createDashboardServer } = await import(
    pathToFileURL(path.join(PLUGIN, "dashboard", "server-core.mjs")).href
  );
  const app = createDashboardServer({ port: 0, idleExitMin: 0, writePidFile: false });
  const { port } = await app.start();
  try {
    // GET:providers 新字段 + 老字段都在
    const got = await getJson(port, "/api/config");
    assert.equal(got.status, 200);
    assert.deepEqual(got.body.providers, ["zcode"]);
    assert.equal(got.body.tokenRateLine, undefined);   // 未配置即缺省
    assert.equal(got.body.stopHookLine, true);         // 老字段原样保留
    assert.ok(got.body.configFile.endsWith("tps-monitor.config.json"));

    // POST:只改 providers,不动 appearance/老字段
    const posted = await postJson(port, "/api/config", { providers: ["zcode", "codex"] });
    assert.equal(posted.status, 200, JSON.stringify(posted.body));
    assert.deepEqual(posted.body.providers, ["zcode", "codex"]);
    const after = await getJson(port, "/api/config");
    assert.deepEqual(after.body.providers, ["zcode", "codex"]);
    assert.equal(after.body.stopHookLine, true, "补写 providers 不能动其他字段");

    // 未知 id 被拒绝,不写文件
    const bad = await postJson(port, "/api/config", { providers: ["cursor"] });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.fieldErrors);
    assert.deepEqual((await getJson(port, "/api/config")).body.providers, ["zcode", "codex"]);

    // 缺 appearance 也缺 providers → 400
    const none = await postJson(port, "/api/config", {});
    assert.equal(none.status, 400);
  } finally {
    app.close();
  }

  // 回到默认单源:SSE 快照的 token 载荷只多一个 provider 字段
  writeConfig({ providers: ["zcode"] });
  const app2 = createDashboardServer({ port: 0, idleExitMin: 0, writePidFile: false });
  const info2 = await app2.start();
  try {
    const snap = await sseFrame(info2.port, "snapshot");
    assert.equal(snap.token.provider, "zcode");
    assert.equal(snap.token.sessionId, "z1");
    assert.equal(snap.token.latest.tokPerSec, 200);
    assert.ok(!("sources" in snap.token), "单源快照不带多源结构");
    assert.ok(!("agents" in snap.token));
    assert.ok(snap.sys && typeof snap.sys.cpuCores === "number");
    assert.equal(snap.token.follow.id, "z1");
    assert.equal(snap.token.follow.source, "test"); // 状态文件里的来源原样透传
  } finally {
    app2.close();
  }

  // 多源配置:SSE 快照带上来源明细
  writeConfig({ providers: ["zcode", "codex"] });
  const app3 = createDashboardServer({ port: 0, idleExitMin: 0, writePidFile: false });
  const info3 = await app3.start();
  try {
    const snap = await sseFrame(info3.port, "snapshot");
    assert.ok(Array.isArray(snap.token.sources), "多源快照应带来源明细");
    assert.equal(snap.token.sources.length, 2);
    assert.equal(snap.token.provider, "zcode");
  } finally {
    app3.close();
  }
});

// ---------- 钩子热路径:JSONL 不得进入 ----------

test("钩子热路径不读 JSONL:即使 providers 配了五个源,Stop 钩子仍只走 zcode 库", async () => {
  // 构造一份"毒药"夹具:时间戳远在未来、token 数独一无二。
  // 先证明聚合层确实读得到它(否则本测试没有牙齿),再证明钩子对它无感。
  const poisonHome = path.join(tmp, "claude-poison");
  const poisonDir = path.join(poisonHome, "projects");
  fs.mkdirSync(poisonDir, { recursive: true });
  const POISON_OUT = 999999;
  const POISON_AT = T + 10_000_000;
  fs.writeFileSync(path.join(poisonDir, "cc-poison.jsonl"), [
    JSON.stringify({ type: "user", sessionId: "cc-poison", timestamp: POISON_AT, uuid: "p1",
      message: { id: "p_u", role: "user", content: [{ type: "text", text: "x" }] } }),
    JSON.stringify({ type: "assistant", sessionId: "cc-poison", timestamp: POISON_AT + 1000, uuid: "p2",
      message: { id: "p_a", model: "poison", usage: { input_tokens: 1, output_tokens: POISON_OUT } } }),
  ].join("\n") + "\n");

  const poisonEnv = { ...process.env, TPS_CLAUDE_CODE_HOME: poisonHome };
  const merged = aggregateRate({ cfg: { providers: ["zcode", "claude-code"] }, env: poisonEnv });
  assert.equal(merged.latest.outputTokens, POISON_OUT, "聚合层应读到毒药记录(否则本条测试无意义)");
  assert.equal(merged.latest.completedAt, POISON_AT + 1000);
  assert.equal(merged.session.totalOutput, 1720 + POISON_OUT);

  // 配满五个源 + 毒药数据在环境里,Stop 钩子的输出必须与只用 zcode 时逐字节相同
  writeConfig({ providers: ["zcode", "claude-code", "codex", "opencode", "cline"] });
  const hooked = await runHook("stop.mjs", JSON.stringify({ session_id: "z1" }), {
    ZCODE_USAGE_DB: zcodeDb, TPS_CLAUDE_CODE_HOME: poisonHome,
  });
  const msg = JSON.parse(hooked.out.trim());
  assert.ok(msg.systemMessage, hooked.out);
  assert.match(msg.systemMessage, /^⚡ 187\.5 tok\/s\(本轮\)/, hooked.out);
  assert.match(msg.systemMessage, /累计 1\.8k tok/, hooked.out);   // 不是 1.0M:毒药没进来
  assert.ok(!/999999|poison/.test(msg.systemMessage), hooked.out);
  // 只读 zcode 时的输出与之完全一致
  writeConfig({ providers: ["zcode"] });
  const plain = await runHook("stop.mjs", JSON.stringify({ session_id: "z1" }), {
    ZCODE_USAGE_DB: zcodeDb,
  });
  assert.equal(JSON.parse(plain.out.trim()).systemMessage, msg.systemMessage);

  // prompt-submit 同样:速率行上下文仍只来自 usage 库
  const ctx = await runHook("prompt-submit.mjs", "", {
    ZCODE_USAGE_DB: zcodeDb, TPS_CLAUDE_CODE_HOME: poisonHome,
  });
  const payload = JSON.parse(ctx.out.trim());
  const text = JSON.stringify(payload);
  assert.ok(!text.includes("999999"), ctx.out);
  assert.ok(!text.includes("poison"), ctx.out);
});
