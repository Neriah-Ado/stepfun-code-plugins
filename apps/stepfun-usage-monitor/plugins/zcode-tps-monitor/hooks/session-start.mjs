#!/usr/bin/env node
// SessionStart hook:
// 1) 记录"用户最后所处的会话"到状态文件(供数据服务锁定当前会话)
// 2) 注入一行使用提示(严格 JSON 输出)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function readConfig() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(os.homedir(), ".zcode", "tps-monitor.config.json"), "utf8")
    );
  } catch {
    return {};
  }
}

const sid = process.env.ZCODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || "";
if (sid) {
  try {
    const file = path.join(os.homedir(), ".zcode", "tps-monitor.last-session.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ sessionId: sid, ts: Date.now(), source: "session-start" })
    );
  } catch {}
}

// 默认:本轮即时速率行由 Stop 钩子直接显示给用户,模型无需转发;
// stopHookLine===false 时回到旧行为,才需要模型在回复末尾转发(上轮数据)。
const legacyQuote = readConfig().stopHookLine === false;
const hint = legacyQuote
  ? "[zcode-tps-monitor] 已就绪。每轮用户消息都会注入【token 速率】行(真实,来自 usage 库;显示的是上一轮),请在每条回复末尾原样附上「⚡」开头的整行。命令:/tps(快照)、/tps-doctor(自检)。大屏:dashboard/server.mjs(http://127.0.0.1:7423);悬浮条(仅 Windows):dashboard/overlay.ps1;关闭速率行:~/.zcode/tps-monitor.config.json → {\"tokenRateLine\":false}。"
  : "[zcode-tps-monitor] 已就绪。每轮回复结束时,本轮即时 token 速率(真实,来自 usage 库)会由 Stop 钩子自动显示给用户,无需在回复末尾转发速率行。命令:/tps(快照)、/tps-doctor(自检)。大屏:dashboard/server.mjs(http://127.0.0.1:7423);关闭:~/.zcode/tps-monitor.config.json → {\"tokenRateLine\":false} 或 {\"stopHookLine\":false}。";

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: hint,
    },
  })
);
