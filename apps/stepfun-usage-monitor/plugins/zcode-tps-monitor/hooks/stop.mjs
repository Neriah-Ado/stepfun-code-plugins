#!/usr/bin/env node
// Stop hook: 主回复刚结束 → 本轮(刚完成的用户轮次)的全部请求已写入 usage 库。
// 此时计算"本轮即时速率",经 systemMessage 直接显示给用户——
// 消除 UserPromptSubmit 只能看到上一轮的固有滞后(发送消息的瞬间本轮尚未发生)。
// 输出严格 JSON;任何异常静默退出,不影响对话。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openUsageDb } from "../scripts/lib/usage-db.mjs";
import { timedRead } from "../scripts/lib/perf-log.mjs";
import { formatTurnLine } from "../scripts/token-rate.mjs";

// stdin 是钩子入参 JSON(含 session_id);设超时兜底,客户端不给 stdin 也不挂起
function readStdin() {
  return new Promise((resolve) => {
    let raw = "";
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve(raw);
      }
    };
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", finish);
    setTimeout(finish, 1500);
  });
}

function readConfig() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(os.homedir(), ".zcode", "tps-monitor.config.json"), "utf8")
    );
  } catch {
    return {};
  }
}

function noteSession(sid) {
  if (!sid) return;
  try {
    const file = path.join(os.homedir(), ".zcode", "tps-monitor.last-session.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ sessionId: sid, ts: Date.now(), source: "stop" })
    );
  } catch {}
}

async function main() {
  let payload = {};
  try {
    payload = JSON.parse((await readStdin()) || "{}");
  } catch {}
  const sid =
    payload.session_id ||
    process.env.ZCODE_SESSION_ID ||
    process.env.CLAUDE_SESSION_ID ||
    "";
  noteSession(sid);

  const cfg = readConfig();
  if (cfg.tokenRateLine === false || cfg.stopHookLine === false) return;

  // Stop 触发与末次请求写库之间存在毫秒级竞态,短重试直到本轮出现有效样本。
  // 预编译语句 + 单连接:5 次重试复用同一只读连接与同一批 StatementSync。
  let r = null;
  let reader = null;
  try {
    reader = openUsageDb();
    for (let i = 0; i < 5; i++) {
      r = timedRead("stop", () => reader.queryTurn(sid || null));
      if (r.turn && r.turn.rated > 0) break;
      if (i < 4) await new Promise((res) => setTimeout(res, 250));
    }
  } catch {} finally {
    try { reader && reader.close(); } catch {}
  }
  if (!r || !r.turn) return; // 无本轮数据(如中断轮)则不打扰
  process.stdout.write(JSON.stringify({ systemMessage: formatTurnLine(r) }));
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
