// 单元测试:node --test
// V2.5.0 多 agent 聚合展示层测试矩阵。
//   - config focusAgent:缺省 zcode、合法值 / "all" / 非法值、只增不删
//   - agentStatus.sessionList(会话切换器的最小数据层补齐)
//   - /api/agents 端点:启用清单 + 逐源探测 + 会话列表
//   - SSE agents 事件:多源连接即推;providers 配置变化(单 → 多)时推送
//   - SSE 快照/事件 perProvider(仅多源);单源不带(与 V2.4.0 结构一致)
//   - /api/token-rate 的 ?agent / ?session 作用域参数(未知源 400)
//   - CLI /tps 多源分组输出(各源速率)与 --json perProvider;单源保持原格式
//   - 大屏/悬浮条静态结构:切换条、对比视图、能力降级「—」、桌面按钮仍默认隐藏
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

process.removeAllListeners("warning");
process.on("warning", () => {});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const PLUGIN = path.join(ROOT, "plugins", "zcode-tps-monitor");
const NODE = process.execPath;

// --- 环境隔离:HOME/USERPROFILE 指向夹具目录(与 providers.test.mjs 同一套约定) ---
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tps-agview-"));
process.env.HOME = tmp;
process.env.USERPROFILE = tmp;
delete process.env.TPS_PROVIDERS;
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
const writeState = (sessionId = "z1") => {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ sessionId, ts: Date.now(), source: "test" }));
};

const T = 1_800_000_000_000;

const { DatabaseSync } = await import("node:sqlite");

// ---------- 夹具:zcode(SQLite)+ claude-code(JSONL)+ codex(rollout JSONL) ----------
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
  ins.run("z1", 500, 100, 1000, 2000, 800, "t_old");   // 600 tok/s
  ins.run("z1", 900, 0, 2000, 5000, 700, "t_old");     // 300 tok/s
  ins.run("z1", 80, 0, 6500, 7000, 450, "t_new");      // 160 tok/s
  ins.run("z1", 220, 0, 9000, 10100, 600, "t_new");    // 200 tok/s(会话最新有效样本)
  db.close();
}
process.env.ZCODE_USAGE_DB = zcodeDb;

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

const CDX_SESSION = "cdx-s1";
const CDX_UUID = "aaaaaaa1-2222-3333-4444-555555555555";
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

const { agentStatus } = await import(
  pathToFileURL(path.join(PLUGIN, "scripts", "lib", "collect-core.mjs")).href
);
const { readFocusAgent, patchFocusAgent, readProviders } = await import(
  pathToFileURL(path.join(PLUGIN, "scripts", "lib", "config.mjs")).href
);
const { createDashboardServer } = await import(
  pathToFileURL(path.join(PLUGIN, "dashboard", "server-core.mjs")).href
);

// ---------- 工具 ----------

function runCli(args) {
  return spawnSync(NODE, [path.join(PLUGIN, "scripts", "token-rate.mjs"), ...args], {
    encoding: "utf8", env: process.env, cwd: PLUGIN,
  });
}

async function getJson(port, p) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: p }, (res) => {
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf || "{}") }); }
        catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

async function postJson(port, p, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      { host: "127.0.0.1", port, path: p, method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } },
      (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(buf || "{}") }); }
          catch (e) { reject(e); }
        });
      }
    );
    req.on("error", reject);
    req.end(payload);
  });
}

// 在同一条 SSE 连接上等若干类事件的首次出现(连接保持打开,供后续事件继续到达)
function sseCollect(port, events, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const out = {};
    const req = http.get({ host: "127.0.0.1", port, path: "/api/events" }, (res) => {
      res.setEncoding("utf8");
      let buf = "";
      res.on("data", (c) => {
        buf += c;
        for (const ev of events) {
          if (out[ev]) continue;
          const i = buf.indexOf(`event: ${ev}\n`);
          if (i === -1) continue;
          const m = /^data: (.*)$/m.exec(buf.slice(i));
          if (!m) continue;
          try { out[ev] = JSON.parse(m[1]); } catch (e) { reject(e); return; }
        }
        if (events.every((ev) => out[ev])) {
          req.destroy();
          resolve(out);
        }
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    setTimeout(() => {
      req.destroy();
      reject(new Error(`SSE 等待 ${events.filter((e) => !out[e]).join("/")} 超时`));
    }, timeoutMs).unref();
  });
}

// 往指定 zcode 库补一条更晚的样本(驱动服务端产生新的 token 事件)
function insertZcodeRow(dbPath, { sessionId = "z1", out = 300, gen = 1000, at }) {
  const db = new DatabaseSync(dbPath);
  try {
    db.prepare(
      "INSERT INTO model_usage VALUES (?, 'completed', 'main_turn', 'test-model', ?, 0, 120000, 118000, ?, ?, ?, 't_live')"
    ).run(sessionId, out, at - gen, at, gen);
  } finally {
    db.close();
  }
}

function startServer() {
  const app = createDashboardServer({ port: 0, idleExitMin: 0, writePidFile: false });
  return app.start().then((info) => ({ app, ...info }));
}

// 打开一条 SSE 连接并交给回调;api.waitEvent(ev) 在这条连接上等某事件的首次出现
function withSse(port, fn, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/api/events" });
    req.on("error", reject);
    req.on("response", (res) => {
      res.setEncoding("utf8");
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("error", reject);
      const api = {
        waitEvent(ev) {
          return new Promise((res2, rej2) => {
            const timer = setTimeout(
              () => rej2(new Error(`SSE 等待 ${ev} 超时`)), timeoutMs
            );
            const scan = () => {
              const i = buf.indexOf(`event: ${ev}\n`);
              if (i === -1) return;
              const m = /^data: (.*)$/m.exec(buf.slice(i));
              if (!m) return;
              clearTimeout(timer);
              try { res2(JSON.parse(m[1])); } catch (e) { rej2(e); }
            };
            scan();
            res.on("data", scan);
          });
        },
      };
      fn(api).then(
        (v) => { req.destroy(); resolve(v); },
        (e) => { req.destroy(); reject(e); }
      );
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- config focusAgent ----------

test("config:focusAgent 缺省 zcode,patch 接受合法源与 all,非法值拒绝且不动其他字段", async () => {
  removeConfig();
  assert.equal(readFocusAgent(), "zcode");
  assert.equal(patchFocusAgent("codex"), "codex");
  assert.equal(readFocusAgent(), "codex");
  assert.equal(patchFocusAgent({ focusAgent: "all" }), "all");
  // 只增不删:providers / appearance 不受 focusAgent 写入影响
  writeConfig({ providers: ["zcode", "codex"], stopHookLine: true, appearance: { theme: "light" } });
  assert.equal(patchFocusAgent("cline"), "cline");
  assert.deepEqual(readProviders(), ["zcode", "codex"]);
  assert.equal(readFocusAgent(), "cline");
  const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  assert.equal(cfg.stopHookLine, true);
  assert.equal(cfg.appearance.theme, "light");
  assert.throws(() => patchFocusAgent("bogus"), (e) => Array.isArray(e.fieldErrors) && e.fieldErrors.length > 0);
  assert.throws(() => patchFocusAgent(42), (e) => Array.isArray(e.fieldErrors));
  assert.equal(readFocusAgent(), "cline");
  removeConfig();
});

// ---------- agentStatus.sessionList(V2.5.0 最小补齐) ----------

test("agentStatus:sessionList 列出各源最近会话,会话切换器据此渲染", () => {
  writeConfig({ providers: ["zcode", "claude-code", "codex"] });
  const rows = agentStatus();
  const z = rows.find((r) => r.provider === "zcode");
  assert.ok(Array.isArray(z.sessionList), "zcode 应有 sessionList");
  assert.ok(z.sessionList.some((s) => s.sessionId === "z1"));
  assert.ok(z.sessionList[0].lastAt != null);
  const cc = rows.find((r) => r.provider === "claude-code");
  assert.ok(Array.isArray(cc.sessionList) && cc.sessionList.some((s) => s.sessionId === CC_SESSION));
  const cx = rows.find((r) => r.provider === "codex");
  // listSessions 的 sessionId 来自文件名派生(权威 id 走 currentSessionId 的内容兜底),
  // 这里只断言会话列表存在且非空
  assert.ok(Array.isArray(cx.sessionList) && cx.sessionList.length >= 1);
  removeConfig();
});

// ---------- /api/agents ----------

test("大屏:/api/agents 返回启用清单、逐源探测与会话列表", async () => {
  writeState("z1");
  writeConfig({ providers: ["zcode", "claude-code", "codex"] });
  const { app, port } = await startServer();
  try {
    const got = await getJson(port, "/api/agents");
    assert.equal(got.status, 200);
    assert.deepEqual(got.body.enabled, ["zcode", "claude-code", "codex"]);
    assert.equal(got.body.agents.length, 3);
    const byId = Object.fromEntries(got.body.agents.map((a) => [a.provider, a]));
    assert.equal(byId.zcode.ok, true);
    assert.equal(byId.zcode.capabilities.ttft, true);
    assert.ok(byId.zcode.sessionList.some((s) => s.sessionId === "z1"));
    assert.equal(byId["claude-code"].capabilities.ttft, false);
    assert.equal(byId["claude-code"].sessionId, CC_SESSION);
    assert.equal(byId.codex.format, "jsonl/sessions-v1");

    // 单源:enabled 只有一项(切换条据此隐藏)
    writeConfig({ providers: ["zcode"] });
    const single = await getJson(port, "/api/agents");
    assert.deepEqual(single.body.enabled, ["zcode"]);
  } finally {
    app.close();
  }
  removeConfig();
});

// ---------- SSE:快照 perProvider + agents 事件 ----------

test("大屏:SSE 多源快照带 perProvider,连接即推 agents 事件", async () => {
  writeState("z1");
  writeConfig({ providers: ["zcode", "codex"] });
  const { app, port } = await startServer();
  try {
    const { snapshot, agents } = await sseCollect(port, ["snapshot", "agents"]);
    // 快照:merged 仍是 followed 会话口径;perProvider 是各源自己的当前会话
    assert.equal(snapshot.token.provider, "zcode");
    assert.ok(Array.isArray(snapshot.token.sources), "多源快照带来源明细");
    assert.ok(snapshot.perProvider, "多源快照应带 perProvider");
    assert.equal(snapshot.perProvider.zcode.provider, "zcode");
    assert.equal(snapshot.perProvider.zcode.sessionId, "z1");
    assert.equal(snapshot.perProvider.zcode.latest.tokPerSec, 200);
    assert.equal(snapshot.perProvider.codex.sessionId, CDX_SESSION);
    assert.equal(snapshot.perProvider.codex.latest.tokPerSec, 33.3);
    assert.equal(snapshot.perProvider.codex.latest.ttftMs, null, "codex 无 TTFT,降级为 null 而非编数字");
    assert.ok(Array.isArray(snapshot.perProvider.codex.history));
    // agents 事件:连接即推,载荷与 /api/agents 同构
    assert.deepEqual(agents.enabled, ["zcode", "codex"]);
    assert.equal(agents.agents.length, 2);
    assert.ok(Array.isArray(agents.agents[0].sessionList));
  } finally {
    app.close();
  }
  removeConfig();
});

test("大屏:单源快照不带 perProvider(与 V2.4.0 事件结构一致)", async () => {
  writeState("z1");
  writeConfig({ providers: ["zcode"] });
  const { app, port } = await startServer();
  try {
    const { snapshot } = await sseCollect(port, ["snapshot"]);
    assert.equal(snapshot.token.provider, "zcode");
    assert.ok(!("perProvider" in snapshot), "单源快照不背多源结构");
    assert.ok(!("sources" in snapshot.token));
  } finally {
    app.close();
  }
  removeConfig();
});

test("大屏:providers 配置变化(单 → 多)时推送 agents 事件", async () => {
  writeState("z1");
  writeConfig({ providers: ["zcode"] });
  const { app, port } = await startServer();
  try {
    const posted = await postJson(port, "/api/config", { providers: ["zcode", "codex"] });
    assert.equal(posted.status, 200, JSON.stringify(posted.body));
    const { agents } = await sseCollect(port, ["agents"], 10000);
    assert.deepEqual(agents.enabled, ["zcode", "codex"]);
  } finally {
    app.close();
  }
  removeConfig();
});

test("大屏:新样本到达时 token 事件带 perProvider(仅多源);单源事件结构不变", async () => {
  writeState("z1");
  const at = T + 60_000;
  // 本测试插入"未来样本",换用独立 DB,避免污染后续测试对主夹具的数值断言
  const liveDb = path.join(tmp, "zcode-live.sqlite");
  fs.copyFileSync(zcodeDb, liveDb);
  process.env.ZCODE_USAGE_DB = liveDb;
  try {
    // 多源:zcode 新样本 → token 事件携带 perProvider(各源 latest/session)
    writeConfig({ providers: ["zcode", "codex"] });
    const app1 = createDashboardServer({ port: 0, idleExitMin: 0, writePidFile: false });
    const s1 = await app1.start();
    try {
      await withSse(s1.port, async (sse) => {
        await sleep(300); // 让连接完成快照,增量游标就位
        insertZcodeRow(liveDb, { out: 300, gen: 1000, at });
        const token = await sse.waitEvent("token");
        assert.equal(token.provider, "zcode");
        assert.ok(token.perProvider, "多源 token 事件应带 perProvider");
        assert.equal(token.perProvider.codex.provider, "codex");
        assert.ok(token.perProvider.zcode.latest);
        assert.ok(!("history" in token.perProvider.zcode), "token 事件的每源视图不带历史(增量走 history-append)");
      });
    } finally {
      app1.close();
    }

    // 单源:同样插入新样本,token 事件不带 perProvider/sources(与 V2.4.0 逐字段一致)
    writeConfig({ providers: ["zcode"] });
    const app2 = createDashboardServer({ port: 0, idleExitMin: 0, writePidFile: false });
    const s2 = await app2.start();
    try {
      await withSse(s2.port, async (sse) => {
        await sleep(300);
        insertZcodeRow(liveDb, { out: 400, gen: 1000, at: at + 60_000 });
        const token = await sse.waitEvent("token");
        assert.equal(token.provider, "zcode");
        assert.ok(!("perProvider" in token), "单源 token 事件不背多源结构");
        assert.ok(!("sources" in token));
      });
    } finally {
      app2.close();
    }
  } finally {
    process.env.ZCODE_USAGE_DB = zcodeDb;
    removeConfig();
  }
});

// ---------- /api/token-rate 作用域参数 ----------

test("大屏:/api/token-rate 支持 ?agent/?session 作用域(additive),未知源 400", async () => {
  writeState("z1");
  writeConfig({ providers: ["zcode", "codex"] });
  const { app, port } = await startServer();
  try {
    const codex = await getJson(port, "/api/token-rate?agent=codex");
    assert.equal(codex.status, 200);
    assert.equal(codex.body.provider, "codex");
    assert.equal(codex.body.sessionId, CDX_SESSION);
    assert.equal(codex.body.latest.tokPerSec, 33.3);
    assert.equal(codex.body.latest.ttftMs, null);

    const zcode = await getJson(port, "/api/token-rate?agent=zcode");
    assert.equal(zcode.body.provider, "zcode");
    assert.equal(zcode.body.sessionId, "z1");
    assert.equal(zcode.body.latest.tokPerSec, 200);

    const scoped = await getJson(port, `/api/token-rate?agent=codex&session=${CDX_SESSION}`);
    assert.equal(scoped.body.sessionId, CDX_SESSION);

    const merged = await getJson(port, "/api/token-rate");
    assert.equal(merged.body.sessionId, "z1", "无参数时仍跟随会话");
    assert.ok(Array.isArray(merged.body.sources), "无参数多源时带来源明细");

    const bad = await getJson(port, "/api/token-rate?agent=bogus");
    assert.equal(bad.status, 400);
  } finally {
    app.close();
  }
  removeConfig();
});

// ---------- /api/config focusAgent ----------

test("大屏:/api/config 读写 focusAgent,非法值 400 且不写文件", async () => {
  writeState("z1");
  writeConfig({ providers: ["zcode", "codex"], appearance: { theme: "light" } });
  const { app, port } = await startServer();
  try {
    const got = await getJson(port, "/api/config");
    assert.equal(got.body.focusAgent, "zcode");

    const posted = await postJson(port, "/api/config", { focusAgent: "codex" });
    assert.equal(posted.status, 200, JSON.stringify(posted.body));
    assert.equal(posted.body.focusAgent, "codex");
    assert.deepEqual((await getJson(port, "/api/config")).body.providers, ["zcode", "codex"]);

    const all = await postJson(port, "/api/config", { focusAgent: "all" });
    assert.equal(all.body.focusAgent, "all");

    const bad = await postJson(port, "/api/config", { focusAgent: "bogus" });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.fieldErrors);
    assert.equal((await getJson(port, "/api/config")).body.focusAgent, "all");

    const none = await postJson(port, "/api/config", {});
    assert.equal(none.status, 400);

    // focusAgent 写入不动 appearance
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    assert.equal(cfg.appearance.theme, "light");
  } finally {
    app.close();
  }
  removeConfig();
});

// ---------- CLI 聚合输出 ----------

test("CLI:/tps 多源按数据源分组输出各源速率,--json 附 perProvider", () => {
  writeState("z1");
  writeConfig({ providers: ["zcode", "codex"] });
  const multi = runCli([]);
  assert.equal(multi.status, 0, multi.stderr);
  assert.match(multi.stdout, /各源速率:/);
  assert.match(multi.stdout, /ZCode\(zcode\): ⚡ 200 tok\/s/);
  assert.match(multi.stdout, /Codex\(codex\): ⚡ 33\.3 tok\/s/);

  const js = runCli(["--json"]);
  const o = JSON.parse(js.stdout);
  assert.ok(o.perProvider, "多源 --json 应带 perProvider");
  assert.equal(o.perProvider.codex.latest.tokPerSec, 33.3);
  assert.equal(o.perProvider.zcode.sessionId, "z1");

  // 显式 --session:各源按该会话圈定,codex 无此会话 → 如实显示无数据
  const scoped = runCli(["--session", "z1"]);
  assert.match(scoped.stdout, /Codex\(codex\): 当前作用域无数据/);
  removeConfig();
});

test("CLI:单源缺省输出不含分组块与 perProvider(保持 V2.4.0 原格式)", () => {
  writeState("z1");
  writeConfig({ providers: ["zcode"] });
  const single = runCli([]);
  assert.equal(single.status, 0, single.stderr);
  assert.ok(!single.stdout.includes("各源速率:"), "单源不打印分组块");
  const o = JSON.parse(runCli(["--json"]).stdout);
  assert.ok(!("perProvider" in o), "单源 --json 不带 perProvider");
  removeConfig();
});

// ---------- 静态结构:大屏与悬浮条 ----------

test("静态结构:大屏切换条/对比视图/能力降级,悬浮条聚焦标签,桌面按钮仍默认隐藏", () => {
  const html = fs.readFileSync(path.join(PLUGIN, "dashboard", "index.html"), "utf8");
  assert.ok(html.includes('id="agentBar"'), "应有数据源切换条");
  assert.ok(html.includes('id="agentsSection"'), "应有分组卡片/对比视图区块");
  assert.ok(html.includes('id="cmpChart"'), "应有对比视图 canvas");
  assert.ok(html.includes("perProvider"), "应消费 token 事件的 perProvider");
  assert.match(html, /"—"/, "能力缺失字段应显示「—」(不编数字)");
  assert.match(html, /localStorage\.getItem\("tps\.focusAgent"\)/, "焦点记忆应在 localStorage");
  assert.match(html, /localStorage\.getItem\("tps\.sessFocus"\)/, "会话聚焦记忆应在 localStorage");
  // 既有桌面端约束不得回退:桌面按钮浏览器里始终隐藏
  assert.match(html, /\.deskBtn \{[\s\S]*?display: none;/);

  const ov = fs.readFileSync(path.join(PLUGIN, "..", "..", "electron", "renderer", "overlay.html"), "utf8");
  assert.ok(ov.includes('id="agentTag"'), "悬浮条应有聚焦来源标签");
  const payload = fs.readFileSync(
    path.join(PLUGIN, "..", "..", "electron", "lib", "overlay-payload.mjs"), "utf8"
  );
  assert.ok(payload.includes("agentScoped"), "悬浮条载荷应区分聚焦/聚合");
});
