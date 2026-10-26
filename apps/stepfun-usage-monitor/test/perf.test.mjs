// 单元测试:node --test test/
// V2.2.0 性能回归:SSE 线格式与增量包体积、预编译语句复用、索引自检、
// 钩子单次 DB 读取预算(Stop 钩子 P95 < 50ms 且超预算可被 doctor 检出)。
// HOME/USERPROFILE 指向临时目录,隔离真实 ~/.zcode(诊断日志写在那里)。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

process.removeAllListeners("warning");
process.on("warning", () => {});

const PLUGIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "plugins", "zcode-tps-monitor");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tps-perf-"));
process.env.HOME = tmp;
process.env.USERPROFILE = tmp;

// --- 夹具库(必须在导入被测模块前就绪) ---
const COLS = `session_id TEXT, status TEXT, query_source TEXT, model_id TEXT,
  output_tokens INTEGER, reasoning_tokens INTEGER, input_tokens INTEGER, cache_read_input_tokens INTEGER,
  first_token_at INTEGER, completed_at INTEGER, time_to_first_token_ms INTEGER, turn_id TEXT`;

// 小库:与 token-rate.test.mjs 同构,供钩子/大屏端到端使用
const smallDb = path.join(tmp, "small.sqlite");
// 大库:2 万行,模拟长会话,用于耗时预算与索引自检
const bigDb = path.join(tmp, "big.sqlite");
const ROWS = 20000;
process.env.ZCODE_USAGE_DB = smallDb;
process.env.TOKEN_RATE_WINDOW = "5";
process.env.TOKEN_RATE_HIST = "10";
process.env.TOKEN_RATE_MIN_MS = "100";
process.env.TOKEN_RATE_MAX_MS = "60000";

const { DatabaseSync } = await import("node:sqlite");
{
  const db = new DatabaseSync(smallDb);
  db.exec(`CREATE TABLE model_usage (${COLS})`);
  const ins = db.prepare(
    "INSERT INTO model_usage VALUES (?, 'completed', 'main_turn', 'test-model', ?, ?, 120000, 118000, ?, ?, ?, ?)"
  );
  ins.run("s1", 500, 100, 1000, 2000, 800, "t_old");
  ins.run("s1", 80, 0, 6500, 7000, 450, "t_new");
  ins.run("s1", 220, 0, 9000, 10100, 600, "t_new");
  db.close();
}
{
  const db = new DatabaseSync(bigDb);
  db.exec(`CREATE TABLE model_usage (${COLS})`);
  const ins = db.prepare(
    "INSERT INTO model_usage VALUES (?, 'completed', 'main_turn', 'test-model', ?, ?, 120000, 118000, ?, ?, ?, ?)"
  );
  db.exec("BEGIN"); // 2 万行单事务:否则每条 INSERT 各自 fsync,夹具构建要几十秒
  for (let i = 0; i < ROWS; i++) {
    const gen = 300 + (i % 1200);
    ins.run("sess_big", 100 + (i % 400), i % 5, 1000 + i * 10, 1000 + i * 10 + gen, 40 + (i % 200), `turn_${i}`);
  }
  db.exec("COMMIT");
  db.close();
}

const { sseEvent, sseComment, sseRetry, parseSseStream, SSE_HEARTBEAT_MS, SSE_SYS_INTERVAL_MS } = await import(
  pathToFileURL(path.join(PLUGIN, "scripts", "lib", "sse.mjs")).href
);
const { DB_READ_BUDGET_MS, perfLogPath, readTimings, recordTiming, summarize, timedRead } = await import(
  pathToFileURL(path.join(PLUGIN, "scripts", "lib", "perf-log.mjs")).href
);
const { openUsageDb, SUGGESTED_INDEXES } = await import(
  pathToFileURL(path.join(PLUGIN, "scripts", "lib", "usage-db.mjs")).href
);

// --- SSE 线格式 ---

test("SSE 线格式:事件帧 / 心跳注释行 / retry 指令,心跳零数据载荷", () => {
  assert.equal(sseEvent("token", { a: 1 }), 'event: token\ndata: {"a":1}\n\n');
  assert.equal(sseComment(), ": ping\n\n");
  assert.equal(sseRetry(2000), "retry: 2000\n\n");
  assert.equal(SSE_HEARTBEAT_MS, 15000);
  assert.equal(SSE_SYS_INTERVAL_MS, 5000);
  // 验收:无数据变化时仅 SSE 心跳、零数据载荷 —— 心跳帧不得出现 data: 行
  const hb = sseComment("ping");
  assert.ok(!hb.includes("data:"), hb);
  assert.equal(Buffer.byteLength(hb), 8);
});

test("parseSseStream:retry / 事件 / 注释帧与多行 data 拼回", () => {
  const text =
    sseRetry(2000) +
    sseEvent("snapshot", { token: { latest: null }, sys: { cpuPercent: 1 }, histWindow: 5 }) +
    sseComment("ping") +
    sseEvent("history-append", { item: { completedAt: 1 } });
  const frames = parseSseStream(text);
  assert.equal(frames.length, 4);
  assert.equal(frames[0].retry, 2000);
  assert.equal(frames[1].event, "snapshot");
  assert.deepEqual(JSON.parse(frames[1].data), {
    token: { latest: null },
    sys: { cpuPercent: 1 },
    histWindow: 5,
  });
  assert.deepEqual(frames[2], { comment: "ping" });
  assert.equal(frames[3].event, "history-append");
  assert.deepEqual(JSON.parse(frames[3].data), { item: { completedAt: 1 } });
  // 多行 data 按 \n 拼回(JSON.stringify 不产生裸换行,故正常不会走到这条路径)
  const multi = parseSseStream("event: x\ndata: line1\ndata: line2\n\n");
  assert.equal(multi[0].data, "line1\nline2");
});

test("SSE 增量包稳态 < 1KB(history-append 与 token 两帧)", () => {
  const reader = openUsageDb(bigDb);
  try {
    const r = reader.query("sess_big");
    const histItem = r.history[r.history.length - 1];
    const histFrame = sseEvent("history-append", { item: histItem });
    const tokenFrame = sseEvent("token", {
      latest: r.latest,
      session: r.session,
      sessionId: r.sessionId,
      follow: { id: "sess_big", source: "hook" },
    });
    assert.ok(Buffer.byteLength(histFrame) < 1024, `history-append ${Buffer.byteLength(histFrame)}B`);
    assert.ok(Buffer.byteLength(tokenFrame) < 1024, `token ${Buffer.byteLength(tokenFrame)}B`);
  } finally {
    reader.close();
  }
});

// --- 数据层:预编译语句与索引 ---

test("预编译语句按 SQL 文本复用:预热后重复查询零新增 prepare", () => {
  const reader = openUsageDb(bigDb);
  try {
    const orig = reader.db.prepare.bind(reader.db);
    let calls = 0;
    reader.db.prepare = (sql) => {
      calls++;
      return orig(sql);
    };
    reader.query("sess_big");
    reader.queryTurn("sess_big");
    const warm = calls;
    assert.ok(warm > 0, "至少应编译过若干条语句");
    // Stop 钩子的重试循环正是这个场景:同一批语句被反复执行
    for (let i = 0; i < 10; i++) {
      reader.query("sess_big");
      reader.queryTurn("sess_big");
    }
    assert.equal(calls, warm, `预热 ${warm} 条后又编译了 ${calls - warm} 条`);
    assert.equal(reader.stmt("SELECT 1"), reader.stmt("SELECT 1"), "同一 SQL 文本应复用同一 StatementSync");
  } finally {
    reader.close();
  }
});

test("建议索引能消除全表扫描(doctor 提示的 DDL 真实有效)", () => {
  const idxDb = path.join(tmp, "indexed.sqlite");
  fs.copyFileSync(bigDb, idxDb);
  const before = openUsageDb(idxDb);
  let scansBefore = 0;
  try {
    const hints = before.indexHints();
    assert.equal(hints.length, 6, "应覆盖全部 6 条受检查询");
    scansBefore = hints.filter((h) => h.fullScan).length;
    assert.equal(scansBefore, 6, "无索引时 6 条查询都应被识别为全表扫描");
  } finally {
    before.close();
  }
  // 只读连接不能建索引:用可写连接代客户端执行建议 DDL(真实客户端权限更大)
  const w = new DatabaseSync(idxDb);
  try {
    for (const idx of SUGGESTED_INDEXES) w.exec(idx.ddl);
  } finally {
    w.close();
  }
  const after = openUsageDb(idxDb);
  try {
    const hints = after.indexHints();
    assert.deepEqual(
      hints.filter((h) => h.fullScan).map((h) => h.query),
      [],
      "建索引后不应再有全表扫描"
    );
    assert.ok(
      hints.every((h) => h.plan.some((p) => p.includes("USING INDEX"))),
      JSON.stringify(hints)
    );
  } finally {
    after.close();
  }
});

test("大库单次查询远低于 50ms 预算(Stop 钩子 P95 场景)", () => {
  const reader = openUsageDb(bigDb);
  try {
    const samples = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      reader.queryTurn("sess_big");
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)];
    assert.ok(
      p95 < DB_READ_BUDGET_MS,
      `2 万行库上 queryTurn P95 ${p95.toFixed(1)}ms,超出 ${DB_READ_BUDGET_MS}ms 预算`
    );
  } finally {
    reader.close();
  }
});

// --- 钩子耗时诊断日志 ---

test("timedRead 透传返回值并落诊断日志,超预算打标", () => {
  assert.equal(timedRead("probe-kind", () => 42), 42);
  const last = readTimings(1)[0];
  assert.equal(last.kind, "probe-kind");
  assert.ok(Number.isFinite(last.dbMs));
  assert.equal(last.overBudget, false);
  // 睡眠 60ms > 50ms 预算 → overBudget(doctor 的 perf 节据此检出)
  const spin = () => {
    const end = performance.now() + 60;
    while (performance.now() < end) {}
  };
  assert.equal(timedRead("probe-slow", spin), undefined);
  const slow = readTimings(1)[0];
  assert.equal(slow.kind, "probe-slow");
  assert.equal(slow.overBudget, true);
  assert.ok(slow.dbMs >= 50);
  assert.ok(fs.existsSync(perfLogPath()), "诊断日志应写在隔离 HOME 下");
});

test("summarize:分位数、最近一条与超预算计数", () => {
  const s = summarize([
    { kind: "stop", dbMs: 1, overBudget: false, ts: 1 },
    { kind: "stop", dbMs: 2, overBudget: false, ts: 2 },
    { kind: "prompt-submit", dbMs: 80, overBudget: true, ts: 3 },
  ]);
  assert.equal(s.count, 3);
  assert.equal(s.lastKind, "prompt-submit");
  assert.equal(s.lastDbMs, 80);
  assert.equal(s.p50DbMs, 2);
  assert.equal(s.p95DbMs, 80);
  assert.equal(s.maxDbMs, 80);
  assert.equal(s.overBudget, 1);
  assert.deepEqual(summarize([]), {
    count: 0, lastDbMs: null, lastKind: null, lastTs: null,
    p50DbMs: null, p95DbMs: null, maxDbMs: null, overBudget: 0,
  });
});

test("诊断日志超限时截断保留尾部,半行被跳过", () => {
  const line = JSON.stringify({ ts: 1, kind: "bulk", dbMs: 1, overBudget: false });
  for (let i = 0; i < 2400; i++) recordTiming({ kind: "bulk", dbMs: 1, overBudget: false });
  const size = fs.statSync(perfLogPath()).size;
  assert.ok(size < 131072 + line.length + 64, `截断后仍过大:${size}`);
  const entries = readTimings(1000);
  assert.ok(entries.length > 0);
  assert.ok(entries.length <= 1000);
  assert.ok(entries.every((e) => e.kind === "bulk" && Number.isFinite(e.dbMs)));
});

// --- 钩子进程边界:输出格式不变 + 读取计时落盘 ---

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

test("Stop 钩子:systemMessage 格式不变,单次 DB 读取落入诊断日志", async () => {
  const { out } = await runHook("stop.mjs", JSON.stringify({ session_id: "s1" }), {
    ZCODE_USAGE_DB: smallDb,
  });
  const msg = JSON.parse(out.trim());
  assert.ok(msg.systemMessage, out);
  assert.match(msg.systemMessage, /^⚡ [\d.]+ tok\/s\(本轮\)/);
  assert.match(msg.systemMessage, /首字 [\d.]+s/);
  assert.match(msg.systemMessage, /累计 [\d.]+k? tok/);
  const stops = readTimings(200).filter((e) => e.kind === "stop");
  assert.ok(stops.length >= 1, "Stop 钩子应记录至少一次读取耗时");
  assert.ok(
    stops.every((e) => e.dbMs < DB_READ_BUDGET_MS),
    JSON.stringify(stops)
  );
});

test("prompt-submit 钩子:速率行上下文与本问统计指令不变", async () => {
  const { out } = await runHook("prompt-submit.mjs", "", {
    ZCODE_USAGE_DB: smallDb,
    ZCODE_SESSION_ID: "s1",
  });
  const ctx = JSON.parse(out.trim()).hookSpecificOutput;
  assert.equal(ctx.hookEventName, "UserPromptSubmit");
  assert.match(ctx.additionalContext, /\(上轮\)/);
  assert.match(ctx.additionalContext, /【本轮统计指令】/);
  assert.match(ctx.additionalContext, /token-rate\.mjs" --turn --current/);
  const prompts = readTimings(200).filter((e) => e.kind === "prompt-submit");
  assert.ok(prompts.length >= 1, "prompt-submit 钩子应记录读取耗时");
});

// --- 大屏 SSE 端到端 ---

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

function getJson(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
  });
}

function readEvents(port, ms) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/api/events", headers: { Accept: "text/event-stream" } },
      (res) => {
        res.setEncoding("utf8");
        let text = "";
        res.on("data", (c) => (text += c));
        setTimeout(() => {
          res.destroy();
          resolve({ headers: res.headers, text });
        }, ms);
      }
    );
    req.on("error", reject);
  });
}

async function waitPort(port, timeoutMs = 15000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await getJson(port, "/api/token-rate");
      if (r.status === 200) return;
    } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error("大屏未在时限内就绪");
    await new Promise((r) => setTimeout(r, 100));
  }
}

test("大屏 SSE:重连先推全量快照,空闲只有心跳;REST 端点保留", async () => {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(PLUGIN, "dashboard", "server.mjs"), "--port", String(port), "--idle-exit", "0"], {
    env: { ...process.env, ZCODE_USAGE_DB: smallDb },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitPort(port);
    // 非 GET 一律 405(SSE 只接受 GET)
    const bad = await new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: "/api/events", method: "POST" }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(bad, 405);

    const stream = await readEvents(port, 1600);
    assert.match(String(stream.headers["content-type"]), /^text\/event-stream/);
    const frames = parseSseStream(stream.text);
    assert.equal(frames[0].retry, 2000, "首帧应是 retry 指令(断线 2s 重连)");
    const snap = frames.find((f) => f.event === "snapshot");
    assert.ok(snap, stream.text);
    const snapData = JSON.parse(snap.data);
    assert.ok(snapData.token && snapData.sys, "快照应一次带齐 token 全量与系统指标");
    assert.equal(snapData.histWindow, 5);
    // 空闲(库无变化):不得出现周期性数据帧,只有心跳注释行保活
    const dataFrames = frames.filter((f) => f.event === "token" || f.event === "history-append");
    assert.deepEqual(dataFrames, [], stream.text);

    // REST 端点保留(第三方脚本与旧版页面)
    const rate = await getJson(port, "/api/token-rate");
    assert.equal(rate.status, 200);
    const rateBody = JSON.parse(rate.body);
    assert.ok(rateBody.latest && rateBody.session && Array.isArray(rateBody.history));
    const metrics = await getJson(port, "/api/metrics");
    assert.equal(metrics.status, 200);
    assert.ok(JSON.parse(metrics.body).system, "系统指标应在推送窗口内缓存复用");
  } finally {
    child.kill();
  }
});
