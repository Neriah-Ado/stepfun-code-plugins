// 安全回归测试(B-01):大屏服务的本机来源校验。
//   - Host 必须是回环主机(DNS rebinding 防护)
//   - 带 Origin 的请求必须与本服务同源;跨站/异端口/不透明 Origin 一律 403
//   - POST 只接受 application/json(挡住 CORS 简单请求的跨站写入)
// 全程无子进程、无网络,只监听 127.0.0.1 的临时端口。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.join(HERE, "..", "plugins", "zcode-tps-monitor");

// HOME/USERPROFILE 指向临时目录:配置文件只落到夹具里,不碰真实 ~/.zcode
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tps-dashboard-security-"));
process.env.HOME = tmp;
process.env.USERPROFILE = tmp;
delete process.env.TPS_PROVIDERS;

const { createDashboardServer } = await import(
  pathToFileURL(path.join(PLUGIN, "dashboard", "server-core.mjs")).href
);

// 发一个原始请求,返回状态码与响应文本(不假设响应一定是 JSON)
function request(port, { method = "GET", path: urlPath = "/", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: urlPath,
        method,
        headers: {
          ...(payload ? { "Content-Length": payload.length } : {}),
          ...headers,
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode, text }));
      }
    );
    req.on("error", reject);
    req.end(payload);
  });
}

function startServer() {
  const app = createDashboardServer({ port: 0, idleExitMin: 0, writePidFile: false });
  return app.start().then((info) => ({ app, ...info }));
}

test("大屏:错误 Origin 返回 403,无 Origin 与同源请求照常", async () => {
  const { app, port } = await startServer();
  const sameOrigin = `http://127.0.0.1:${port}`;
  try {
    // 本机脚本 / CLI 不带 Origin:照常
    assert.equal((await request(port, { path: "/api/config" })).status, 200);

    // 浏览器同源请求:照常(读取 + 写入)
    assert.equal(
      (await request(port, { path: "/api/config", headers: { Origin: sameOrigin } })).status,
      200
    );
    const sameOriginPost = await request(port, {
      path: "/api/config",
      method: "POST",
      headers: { Origin: sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ providers: ["zcode"] }),
    });
    assert.equal(sameOriginPost.status, 200, sameOriginPost.text);

    // 跨站 / 异端口 / 不透明 Origin:一律 403
    const rejectedOrigins = [
      "http://evil.example",
      "https://attacker.example",
      `http://127.0.0.1:${port + 1}`,
      "null",
      "file://",
    ];
    for (const origin of rejectedOrigins) {
      const res = await request(port, { path: "/api/config", headers: { Origin: origin } });
      assert.equal(res.status, 403, `Origin ${origin} 应被拒绝`);
      assert.match(res.text, /仅接受本机同源请求/);
    }

    // 跨站写配置在 Origin 层就被挡住,不会走到写盘
    const crossPost = await request(port, {
      path: "/api/config",
      method: "POST",
      headers: { Origin: "http://evil.example", "Content-Type": "application/json" },
      body: JSON.stringify({ providers: ["codex"] }),
    });
    assert.equal(crossPost.status, 403);
    const afterCross = await request(port, { path: "/api/config" });
    assert.deepEqual(JSON.parse(afterCross.text).providers, ["zcode"]);

    // Host 不在回环白名单(DNS rebinding):403
    const rebinding = await request(port, {
      path: "/api/config",
      headers: { Host: `evil.example:${port}` },
    });
    assert.equal(rebinding.status, 403);
  } finally {
    app.close();
  }
});

test("大屏:POST /api/config 强制 application/json", async () => {
  const { app, port } = await startServer();
  try {
    const body = JSON.stringify({ providers: ["codex"] });
    // CORS 简单请求能带的三种 Content-Type 都必须被拒
    for (const contentType of [undefined, "text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
      const headers = contentType ? { "Content-Type": contentType } : {};
      const res = await request(port, { path: "/api/config", method: "POST", headers, body });
      assert.equal(res.status, 415, `Content-Type ${contentType} 应被拒绝`);
    }
    // 被拒的写入不得落盘
    const after = await request(port, { path: "/api/config" });
    assert.deepEqual(JSON.parse(after.text).providers, ["zcode"]);

    // 带参数的 application/json 仍然接受
    const accepted = await request(port, {
      path: "/api/config",
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body,
    });
    assert.equal(accepted.status, 200, accepted.text);
    assert.deepEqual(JSON.parse(accepted.text).providers, ["codex"]);
  } finally {
    app.close();
  }
});
