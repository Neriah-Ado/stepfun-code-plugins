// 单元测试:node --test test/
// 用临时 SQLite 库做夹具,在导入被测模块前设置 ZCODE_USAGE_DB。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

process.removeAllListeners("warning");
process.on("warning", () => {});

const PLUGIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "plugins", "zcode-tps-monitor");

// --- 夹具库(必须在导入 token-rate.mjs 之前就绪,模块在加载时读取路径/环境) ---
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tps-test-"));
const dbFile = path.join(tmp, "db.sqlite");
process.env.ZCODE_USAGE_DB = dbFile;
process.env.TOKEN_RATE_WINDOW = "5";
process.env.TOKEN_RATE_HIST = "10";
process.env.TOKEN_RATE_MIN_MS = "100";
process.env.TOKEN_RATE_MAX_MS = "60000";
// 多源聚合层(V2.4.0)读取 ~/.zcode/tps-monitor.config.json 的 providers 字段:
// 把 HOME/USERPROFILE 指到夹具目录,避免真实用户配置(比如启用过的其他客户端)
// 把单源断言带进多源路径。config.mjs 在模块加载时解析该路径,必须在导入前设置。
process.env.HOME = tmp;
process.env.USERPROFILE = tmp;

const { DatabaseSync } = await import("node:sqlite");
{
  const db = new DatabaseSync(dbFile);
  db.exec(`CREATE TABLE model_usage (
    session_id TEXT, status TEXT, query_source TEXT, model_id TEXT,
    output_tokens INTEGER, reasoning_tokens INTEGER, input_tokens INTEGER, cache_read_input_tokens INTEGER,
    first_token_at INTEGER, completed_at INTEGER, time_to_first_token_ms INTEGER, turn_id TEXT)`);
  const ins = db.prepare(
    "INSERT INTO model_usage VALUES (?, 'completed', 'main_turn', 'test-model', ?, ?, 120000, 118000, ?, ?, ?, ?)"
  );
  // 速率 = (output + reasoning) / genMs;turn_id 按用户轮次分组,本轮 = 最新 turn_id
  ins.run("s1", 500, 100, 1000, 2000, 800, "t_old");  // gen 1000ms → 600 tok/s(验证思考 token 计入分子)
  ins.run("s1", 900, 0, 2000, 5000, 700, "t_old");    // gen 3000ms → 300 tok/s
  ins.run("s1", 80, 0, 6500, 7000, 450, "t_new");     // gen 500ms  → 160 tok/s(本轮第 1 段)
  ins.run("s1", 20, 0, 7550, 7600, 100, "t_new");     // gen 50ms < MIN → 无速率,但计入累计
  ins.run("s1", 220, 0, 9000, 10100, 600, "t_new");   // gen 1100ms → 200 tok/s(本轮第 2 段 = 会话最新)
  // 非 main_turn:主对话存在时必须被排除
  db.exec("INSERT INTO model_usage VALUES ('s1', 'completed', 'sub', 'test-model', 999, 0, 120000, 118000, 8000, 9000, 500, 't_new')");
  db.close();
}

const { query, queryTurn, formatLine, formatTurnLine, fmtCompact, fmtNum } = await import(pathToFileURL(path.join(PLUGIN, "scripts", "token-rate.mjs")).href);

// --- 换算规则 ---
test("fmtCompact 分档:<1k 原始、1k~1w 一位小数、1w~100w 取整 k、≥100w 一位小数 M", () => {
  assert.equal(fmtCompact(999), "999");
  assert.equal(fmtCompact(1600), "1.6k");
  assert.equal(fmtCompact(9800), "9.8k");
  assert.equal(fmtCompact(51300), "51k");
  assert.equal(fmtCompact(128600), "129k");
  assert.equal(fmtCompact(73818000), "73.8M");
  assert.equal(fmtCompact(2000000), "2.0M");
});

test("fmtNum 千分位", () => {
  assert.equal(fmtNum(2762), "2,762");
  assert.equal(fmtNum(128643), "128,643");
  assert.equal(fmtNum(275), "275");
});

test("速率含思考 token:600 = (500+100)/1s", () => {
  const r = query("s1");
  const first = r.history[0]; // 最早一条
  assert.equal(first.outputTokens, 500);
  assert.equal(first.tokPerSec, 600);
});

test("头条取最近有效样本,且排除无效与非主对话行", () => {
  const r = query("s1");
  assert.equal(r.latest.tokPerSec, 200);       // 最近有效是本轮第 2 段(gen 1100ms),而非 gen 50ms / sub 行
  assert.ok(r.history.every((h) => h.outputTokens !== 999)); // sub 行被过滤
  const invalid = r.history.find((h) => h.outputTokens === 20);
  assert.equal(invalid.tokPerSec, null);        // 过短生成无速率
});

test("窗口统计与会话累计(独立 SUM,不受窗口限制)", () => {
  const r = query("s1");
  assert.equal(r.session.samples, 4);
  assert.equal(r.session.avg, 315);            // (600+300+160+200)/4
  assert.equal(r.session.max, 600);
  assert.equal(r.session.totalOutput, 1720);   // 500+900+80+20+220(含无效速率行)
  assert.equal(r.session.totalReasoning, 100);
  assert.equal(r.session.requests, 5);         // 5 条 main_turn(sub 不计)
});

test("行文案:上轮标注、思考 token、会话累计", () => {
  const line = formatLine(query("s1"));
  assert.match(line, /\(上轮\)/);
  assert.match(line, /近4次均 315 \/ 峰 600/);
  assert.match(line, /累计 1\.8k tok/);         // 1720+100
});

test("本轮统计:按最新 turn_id 圈定,多段加权速率", () => {
  const r = queryTurn("s1");
  assert.equal(r.turnId, "t_new");             // 只圈最新一轮,不含 t_old 两段
  assert.equal(r.turn.requests, 3);            // 160 + 无效 50ms + 200
  assert.equal(r.turn.rated, 2);
  assert.equal(r.turn.totalOutput, 320);       // 80+20+220
  assert.equal(r.turn.ttftMs, 450);            // 本轮第一段的首字延迟
  // 加权:有效段 300 tok / 1600ms → 187.5(总产出/总生成时长,非各段速率均值)
  assert.equal(r.turn.tokPerSec, 187.5);
  assert.equal(r.turn.peak, 200);
  assert.equal(r.session.samples, 4);          // 会话累计仍是全会话口径
});

test("本轮文案:本轮标注、段数峰值、会话累计", () => {
  const line = formatTurnLine(queryTurn("s1"));
  assert.match(line, /⚡ 187\.5 tok\/s\(本轮\)/);
  assert.match(line, /首字 0\.5s/);
  assert.match(line, /输出 320 tok \/ 生成/);
  assert.match(line, /3 段 \/ 峰 200/);
  assert.match(line, /累计 1\.8k tok/);
});

test("旧库无 turn_id 列:本轮查询优雅降级不抛错", async () => {
  const legacyFile = path.join(tmp, "legacy.sqlite");
  const db = new DatabaseSync(legacyFile);
  db.exec(`CREATE TABLE model_usage (
    session_id TEXT, status TEXT, query_source TEXT, model_id TEXT,
    output_tokens INTEGER, reasoning_tokens INTEGER, input_tokens INTEGER, cache_read_input_tokens INTEGER,
    first_token_at INTEGER, completed_at INTEGER, time_to_first_token_ms INTEGER)`);
  db.exec("INSERT INTO model_usage VALUES ('s2', 'completed', 'main_turn', 'm', 100, 0, 100000, 99000, 1000, 2000, 500)");
  db.close();
  // DB 路径在模块加载时读取:带 query 重导入一份模块实例指向旧库
  process.env.ZCODE_USAGE_DB = legacyFile;
  try {
    const legacy = await import(pathToFileURL(path.join(PLUGIN, "scripts", "token-rate.mjs")).href + "?legacy");
    const r = legacy.queryTurn("s2");
    assert.equal(r.turnId, null);
    assert.equal(r.turn, null);
    assert.equal(r.session.samples, 1);        // 会话统计不受影响
  } finally {
    process.env.ZCODE_USAGE_DB = dbFile;
  }
});

// --- doctor:对夹具环境应全绿 ---
test("doctor:夹具环境全部通过", async () => {
  fs.mkdirSync(path.join(tmp, ".zcode"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".zcode", "tps-monitor.last-session.json"),
    JSON.stringify({ sessionId: "sess_test", ts: Date.now(), source: "test" }));
  process.env.ZCODE_USAGE_DB = dbFile; // doctor 同样在加载时读取该变量
  // doctor 在模块加载时用 os.homedir() 解析 ~/.zcode 状态目录:临时把 HOME/USERPROFILE
  // 指向夹具目录做环境隔离(POSIX 读 HOME,Windows 读 USERPROFILE),
  // 否则在无 ~/.zcode 的干净环境(CI)上"会话状态文件"检查必然失败
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmp;
  process.env.USERPROFILE = tmp;
  try {
    const { runDoctor } = await import(pathToFileURL(path.join(PLUGIN, "scripts", "doctor.mjs")).href);
    const report = await runDoctor();
    assert.equal(report.failed, 0, JSON.stringify(report.checks, null, 2));
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;
  }
});
