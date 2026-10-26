#!/usr/bin/env node
// zcode-tps-monitor 的 stdio MCP server。协议实现沿用官方 example-plugin 的
// Content-Length 帧 + 换行 JSON 兼容写法,业务逻辑复用 scripts/lib/collect-core.mjs。
//
// 手工冒烟测试:
//   printf '%s\n' \
//     '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"manual","version":"0"}}}' \
//     '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
//     | node mcp/tps-server.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  agentStatus,
  snapshot,
  watch,
  formatSnapshot,
  formatWatch,
} from "../scripts/lib/collect-core.mjs";

// 版本号自动跟随插件清单,避免与插件版本脱节
const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let VERSION = "0.0.0";
try {
  VERSION = JSON.parse(readFileSync(join(PLUGIN_ROOT, ".zcode-plugin", "plugin.json"), "utf8")).version;
} catch {}
const SERVER_INFO = { name: "zcode-tps-monitor", version: VERSION };

/**
 * 本次调用对应的多 agent 作用域(V2.4.0):provider = 实际出数的数据源,
 * sessionId = 该源的当前会话。只增字段 —— 默认 providers=["zcode"] 时
 * provider 恒为 "zcode",老客户端忽略这两个字段时行为与 V2.3.0 完全一致。
 * 探测本身失败不能让快照失败:退化为两个 null,由调用方按"无作用域"处理。
 */
function dataScope() {
  try {
    const list = agentStatus();
    const hit = list.find((a) => a.ok) || list[0] || null;
    return { provider: hit ? hit.provider : null, sessionId: hit ? hit.sessionId ?? null : null };
  } catch {
    return { provider: null, sessionId: null };
  }
}

const TOOLS = [
  {
    name: "tps_snapshot",
    description:
      "获取一次 TPS 吞吐快照:当前 TPS、延迟 p50/p95/p99、错误率,以及本机 CPU/内存使用。结果附带 provider / sessionId 两个字段,说明本次快照对应的客户端数据源与该源当前会话(默认 zcode)。无需参数。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "tps_watch",
    description:
      "按秒采样观察 TPS 一段时间,返回平均/最小/最大与延迟、错误率统计。seconds: 2-30,默认 5。结果同样附带 provider / sessionId 字段。",
    inputSchema: {
      type: "object",
      properties: {
        seconds: { type: "integer", minimum: 2, maximum: 30, description: "采样秒数" },
      },
    },
  },
];

function writeMessage(message) {
  const body = JSON.stringify(message);
  // MCP stdio 帧:Content-Length 头 + 体(同时兼容简单客户端的裸 JSON 行)
  const payload = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
  process.stdout.write(payload);
}

const ok = (id, result) => writeMessage({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) =>
  writeMessage({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function handleRequest(msg) {
  const { id, method, params } = msg;

  if (id === undefined || id === null) {
    return; // 通知(如 initialized)直接忽略
  }

  switch (method) {
    case "initialize":
      ok(id, {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
      return;
    case "ping":
      ok(id, {});
      return;
    case "tools/list":
      ok(id, { tools: TOOLS });
      return;
    case "tools/call": {
      const name = params?.name;
      const args = params?.arguments || {};
      try {
        if (name === "tps_snapshot") {
          const s = await snapshot();
          ok(id, {
            content: [{ type: "text", text: formatSnapshot(s) }],
            isError: false,
            ...dataScope(),
          });
        } else if (name === "tps_watch") {
          const sec = Math.min(30, Math.max(2, Number(args.seconds) || 5));
          const w = await watch(sec);
          ok(id, {
            content: [{ type: "text", text: formatWatch(w) }],
            isError: false,
            ...dataScope(),
          });
        } else {
          fail(id, -32601, `Unknown tool: ${name}`);
        }
      } catch (err) {
        ok(id, {
          content: [{ type: "text", text: `[zcode-tps-monitor] 采集失败: ${err.message}` }],
          isError: true,
        });
      }
      return;
    }
    default:
      fail(id, -32601, `Method not found: ${method}`);
  }
}

function handleRaw(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (Array.isArray(msg)) {
    for (const item of msg) handleRequest(item);
    return;
  }
  handleRequest(msg);
}

let buffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      const asText = buffer.toString("utf8");
      if (asText.includes("\n") && asText.trimStart().startsWith("{")) {
        const lines = asText.split(/\r?\n/);
        buffer = Buffer.from(lines.pop() || "", "utf8");
        for (const line of lines) handleRaw(line);
      }
      break;
    }
    const header = buffer.slice(0, headerEnd).toString("utf8");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + Number(match[1]);
    if (buffer.length < bodyEnd) break;
    handleRaw(buffer.slice(bodyStart, bodyEnd).toString("utf8"));
    buffer = buffer.slice(bodyEnd);
  }
});

process.stdin.on("end", () => {
  if (buffer.length) handleRaw(buffer.toString("utf8"));
});

process.stderr.write("[zcode-tps-monitor] stdio MCP server ready\n");
