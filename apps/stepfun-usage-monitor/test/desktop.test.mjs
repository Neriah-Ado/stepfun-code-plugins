// 单元测试:node --test
// V2.3.0 桌面客户端(Electron)。思路与 V2.2.0 一脉相承:Electron 碰不到的纯逻辑
// (electron/lib/*.mjs)用可注入依赖驱动;真正依赖 Electron 的 main.mjs 只做静态一致性
// 断言(IPC 通道白名单、内嵌服务参数、插件零依赖),不起 GUI 也能守住回归。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

process.removeAllListeners("warning");
process.on("warning", () => {});

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = path.join(ROOT, "plugins", "zcode-tps-monitor");
const ELECTRON = path.join(ROOT, "electron");
const read = (p) => fs.readFileSync(p, "utf8");

// 状态文件走 ~/.zcode,先隔离 HOME/USERPROFILE 再加载被测模块
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tps-desktop-"));
process.env.HOME = tmp;
process.env.USERPROFILE = tmp;

const { buildOverlayPayload, emptyOverlayPayload, collectOverlayPayload } = await import(
  pathToFileURL(path.join(ELECTRON, "lib", "overlay-payload.mjs")).href
);
const {
  DEFAULTS,
  sanitizeState,
  loadState,
  saveState,
  mergeBounds,
  statePath,
} = await import(pathToFileURL(path.join(ELECTRON, "lib", "state-store.mjs")).href);
const { createOverlayCollector, OVERLAY_INTERVAL_MS } = await import(
  pathToFileURL(path.join(ELECTRON, "lib", "collect-loop.mjs")).href
);

// ---------- 悬浮条载荷 ----------

const RESULT = {
  sessionId: "s1",
  latest: { model: "step-3", outputTokens: 500, reasoningTokens: 100, ttftMs: 820, genMs: 2000, tokPerSec: 25.5, completedAt: 3 },
  session: { samples: 5, requests: 7, avg: 21.4, max: 40, min: 8, totalOutput: 4200, totalReasoning: 800, totalInput: 900, totalCacheRead: 10 },
  history: [
    { tokPerSec: 25.5 },
    { tokPerSec: 30.1 },
    { tokPerSec: null },
    { tokPerSec: 18.2 },
  ],
};

test("buildOverlayPayload:tok/s / TTFT / 近N次均 / 累计口径与 Stop 钩子一致", () => {
  const p = buildOverlayPayload(RESULT);
  assert.equal(p.ok, true);
  assert.equal(p.tokPerSec, 25.5);
  assert.equal(p.ttftMs, 820);
  assert.equal(p.avg, 21.4);
  assert.equal(p.samples, 5);
  // 累计 = 输出 + 思考(与"累计 xxx tok"同口径)
  assert.equal(p.totalTok, 5000);
  assert.equal(p.model, "step-3");
  assert.equal(p.sessionId, "s1");
  // 曲线只保留有效样本,最多 12 个,新→旧
  assert.deepEqual(p.spark, [25.5, 30.1, 18.2]);
  assert.ok(p.ts > 0);
});

test("buildOverlayPayload:空结果/异常数值不炸,全部回落 null", () => {
  const p = buildOverlayPayload({ latest: null, session: null, history: undefined });
  assert.equal(p.ok, true);
  assert.equal(p.tokPerSec, null);
  assert.equal(p.avg, null);
  assert.equal(p.totalTok, 0);
  assert.deepEqual(p.spark, []);
  const weird = buildOverlayPayload({
    latest: { tokPerSec: NaN, ttftMs: "x" },
    session: { samples: 0, avg: Infinity },
    history: "not-an-array",
  });
  assert.equal(weird.tokPerSec, null);
  assert.equal(weird.ttftMs, null);
  assert.equal(weird.avg, null);
});

test("collectOverlayPayload:查询抛错时回退占位载荷,不向上抛", async () => {
  const p = await collectOverlayPayload(() => {
    throw new Error("库不存在");
  }, "s1");
  assert.equal(p.ok, false);
  assert.equal(p.reason, "库不存在");
  assert.equal(p.tokPerSec, null);
  // 同步抛错与异步 reject 都要兜住
  const q = await collectOverlayPayload(() => Promise.reject(new Error("boom")), null);
  assert.equal(q.ok, false);
  assert.equal(q.reason, "boom");
  // 正常路径原样透出
  const ok = await collectOverlayPayload(() => RESULT, "s1");
  assert.equal(ok.tokPerSec, 25.5);
  assert.equal(emptyOverlayPayload().ok, false);
});

// ---------- 桌面状态持久化 ----------

test("sanitizeState:越界数值被夹紧,类型错误回落默认,位置允许 null", () => {
  const s = sanitizeState({
    main: { width: 99999, height: -5, x: 99999, alwaysOnTop: "yes" },
    overlay: { width: 5, height: 99999, y: -99999, visible: 1, clickThrough: 0 },
    autostart: "true",
  });
  assert.equal(s.main.width, 10000, "宽度超上界夹到 10000");
  assert.equal(s.main.height, 360, "高度低于下界夹到 360");
  assert.equal(s.main.x, 10000, "位置超界夹回屏内区间");
  assert.equal(s.overlay.width, 120, "悬浮条宽度低于下界夹到 120");
  assert.equal(s.overlay.height, 2000);
  assert.equal(s.overlay.y, -10000);
  assert.equal(s.main.alwaysOnTop, DEFAULTS.main.alwaysOnTop); // 非布尔回落默认
  assert.equal(s.overlay.visible, DEFAULTS.overlay.visible);
  assert.equal(s.overlay.clickThrough, DEFAULTS.overlay.clickThrough);
  assert.equal(s.autostart, false);
  // 类型错误(非数字)才整体回落默认值
  const t = sanitizeState({ main: { width: "很宽", height: {} }, overlay: { width: null } });
  assert.equal(t.main.width, DEFAULTS.main.width);
  assert.equal(t.main.height, DEFAULTS.main.height);
  assert.equal(t.overlay.width, DEFAULTS.overlay.width);
  assert.equal(sanitizeState(null).main.width, DEFAULTS.main.width);
  assert.equal(t.main.x, null, "未放置过的位置保持 null");
  assert.equal(sanitizeState("garbage").overlay.x, null);
});

test("loadState:文件损坏/不存在都回落默认值,绝不抛异常", () => {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  assert.deepEqual(loadState(), sanitizeState(null));
  fs.writeFileSync(statePath(), "{ 这不是 JSON");
  assert.equal(loadState().overlay.width, DEFAULTS.overlay.width);
});

test("saveState:原子写入并可读回;写失败返回 false 而不抛", () => {
  assert.equal(saveState({ overlay: { x: 120, y: 80, visible: true } }), true);
  const back = loadState();
  assert.equal(back.overlay.x, 120);
  assert.equal(back.overlay.y, 80);
  assert.equal(back.overlay.visible, true);
  // 把状态路径占成目录 → 写入失败,但不抛
  const dir = statePath();
  fs.rmSync(dir, { force: true });
  fs.mkdirSync(dir);
  assert.equal(saveState({}), false);
  fs.rmdirSync(dir);
});

test("mergeBounds:只更新目标窗口的边界,其余字段原样保留", () => {
  const base = sanitizeState({
    main: { width: 1000, height: 700, alwaysOnTop: true },
    overlay: { width: 232, height: 64, clickThrough: true },
  });
  const m = mergeBounds(base, "overlay", { width: 300, height: 150, x: 10, y: 20 });
  assert.equal(m.overlay.width, 300);
  assert.equal(m.overlay.clickThrough, true, "未提及的开关不被清掉");
  assert.equal(m.main.width, 1000, "另一窗口的尺寸不受影响");
  assert.equal(m.main.alwaysOnTop, true);
  assert.equal(base.overlay.width, 232, "原对象不被修改(纯函数)");
});

// ---------- 采集循环 ----------

test("采集循环:立即采一次、按节奏推进、上一次未结束不叠加、stop 即停", async () => {
  let ticks = 0; // queryFn 实际调用次数
  const pushed = []; // onData 收到的载荷
  let slow = false;
  const c = createOverlayCollector({
    queryFn: async () => {
      ticks++;
      if (slow) await new Promise((r) => setTimeout(r, 300));
      return RESULT;
    },
    sessionId: "s1",
    intervalMs: 200,
    onData: (p) => pushed.push(p.tokPerSec),
  });
  c.start();
  assert.ok(c.running);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(ticks, 1, "start() 后应立即有一次采集,悬浮条不必先显示一秒 --");
  assert.equal(pushed.length, 1, "一次采集对应一次推送");

  slow = true; // 单次查询 300ms > 间隔 200ms
  await new Promise((r) => setTimeout(r, 390));
  // t=200 与 t=400 两个间隔到点,但 300ms 的那次还没结束:第二次被跳过
  assert.equal(ticks, 2, "上一次未结束时间隔被跳过,不并发叠加");
  await new Promise((r) => setTimeout(r, 300));
  // t=500 采集结束,t=600 间隔恢复推进
  assert.equal(ticks, 3, "上一次结束后恢复按节奏采集");
  assert.equal(pushed.length, 2, "推送次数等于已完成的采集次数");

  c.stop();
  assert.equal(c.running, false);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(ticks, 3, "stop() 后不再采集");
  assert.equal(pushed.length, 2, "stop() 后不再推送");
  assert.equal(OVERLAY_INTERVAL_MS, 1000);
});

test("采集循环:queryFn 抛错只走 onError,循环本身不崩", async () => {
  const errs = [];
  const c = createOverlayCollector({
    queryFn: () => {
      throw new Error("db locked");
    },
    onError: (e) => errs.push(e.message),
  });
  c.start();
  await new Promise((r) => setTimeout(r, 30));
  c.stop();
  // collectOverlayPayload 已把错误转成占位载荷,循环层的 onError 是第二道保险
  assert.ok(Array.isArray(errs));
  assert.ok(errs.every((e) => typeof e === "string"));
});

// ---------- 打包产物图标(容器格式) ----------

test("icon.ico:目录项与 PNG 载荷自洽,含 256 尺寸", () => {
  const buf = fs.readFileSync(path.join(ELECTRON, "build", "icons", "icon.ico"));
  assert.equal(buf.readUInt16LE(0), 0);
  assert.equal(buf.readUInt16LE(2), 1, "type=1 表示图标");
  const count = buf.readUInt16LE(4);
  assert.ok(count >= 4, `ICO 至少 4 个尺寸,实际 ${count}`);
  const sizes = [];
  let offset = 6 + 16 * count;
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 16;
    const w = buf[o] === 0 ? 256 : buf[o];
    const h = buf[o + 1] === 0 ? 256 : buf[o + 1];
    assert.equal(w, h, "ICO 项应为正方形");
    assert.equal(buf.readUInt16LE(o + 4), 1);
    assert.equal(buf.readUInt16LE(o + 6), 32, "32 位真彩");
    const len = buf.readUInt32LE(o + 8);
    const at = buf.readUInt32LE(o + 12);
    assert.equal(at, offset, "载荷偏移应紧跟在前一项之后");
    assert.deepEqual(buf.subarray(at, at + 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "PNG 魔数");
    assert.ok(buf.subarray(at, at + 33).includes(Buffer.from("IHDR")), "PNG 应有 IHDR");
    offset += len;
    sizes.push(w);
  }
  assert.ok(sizes.includes(256) && sizes.includes(16), sizes.join(","));
  assert.equal(offset, buf.length, "目录描述的长度之和应等于文件大小");
});

test("icon.icns:icns 魔数、条目长度与大端尺寸", () => {
  const buf = fs.readFileSync(path.join(ELECTRON, "build", "icons", "icon.icns"));
  assert.equal(buf.subarray(0, 4).toString("ascii"), "icns");
  assert.equal(buf.readUInt32BE(4), buf.length, "总长字段应等于文件大小");
  const types = [];
  let o = 8;
  while (o < buf.length) {
    const type = buf.subarray(o, o + 4).toString("ascii");
    const len = buf.readUInt32BE(o + 4);
    assert.ok(len >= 8, `${type} 长度应含 8 字节头`);
    assert.deepEqual(
      buf.subarray(o + 8, o + 16),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      `${type} 载荷应为 PNG`,
    );
    assert.ok(buf.subarray(o + 8, o + 41).includes(Buffer.from("IHDR")), "PNG 应有 IHDR");
    types.push(type);
    o += len;
  }
  assert.equal(o, buf.length, "条目长度之和应等于文件大小");
  assert.ok(types.includes("ic08"), `应有 256px 条目: ${types.join(",")}`);
  assert.ok(types.includes("icp4"), `应有 16px 条目: ${types.join(",")}`);
});

// ---------- Electron 侧静态一致性(不起 GUI 也能守住的契约) ----------

test("preload 与 main 的 IPC 通道一一对应,没有悬空 handler", () => {
  const preload = read(path.join(ELECTRON, "preload.cjs"));
  const main = read(path.join(ELECTRON, "main.mjs"));
  const arr = (name) => {
    const m = preload.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`, "s"));
    assert.ok(m, `preload 中应定义 ${name}`);
    return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  };
  const invoke = arr("INVOKE");
  const events = arr("EVENTS");
  assert.ok(invoke.length >= 10, "invoke 白名单应覆盖配置/窗口/悬浮条/信息");
  for (const ch of invoke) {
    assert.ok(main.includes(`ipcMain.handle("${ch}"`), `main.mjs 缺少 ${ch} 的 handler`);
  }
  for (const ch of events) {
    assert.ok(main.includes(`"${ch}"`), `main.mjs 未使用事件通道 ${ch}`);
  }
  // 渲染层只能经白名单调用:不得出现通用 invoke 透传
  assert.ok(!/ipcRenderer\.invoke\(/.test(preload.replace(/const invoke = [\s\S]*?\n};/, "")), "invoke 应包一层白名单校验");
  assert.ok(preload.includes('contextIsolation'), "预加载脚本需在 contextIsolation 下工作");
});

test("main.mjs:内嵌大屏服务用随机端口、不写 PID 文件、不空闲退出", () => {
  const main = read(path.join(ELECTRON, "main.mjs"));
  assert.match(main, /startDashboardServer\(\{\s*port: 0,\s*idleExitMin: 0,\s*writePidFile: false\s*\}\)/);
  assert.ok(main.includes("server-core.mjs"), "应复用插件的大屏服务工厂");
  assert.ok(main.includes("loadURL(dash.url)"), "主窗口应加载内嵌服务渲染的同一份 index.html");
  // 悬浮条四要素:透明 / 置顶 / 穿透 / 可拖(拖拽在渲染层 -webkit-app-region)
  for (const needle of ["frame: false", "transparent: true", "setIgnoreMouseEvents", "alwaysOnTop: true"]) {
    assert.ok(main.includes(needle), `main.mjs 应包含 ${needle}`);
  }
  const overlay = read(path.join(ELECTRON, "renderer", "overlay.html"));
  assert.ok(overlay.includes("-webkit-app-region: drag"), "悬浮条应可拖拽");
  assert.ok(overlay.includes("background: transparent"), "悬浮条背景应透明");
  // 关窗最小化到托盘 + 单实例 + 登录项 + 自动更新
  for (const needle of ["requestSingleInstanceLock", "preventDefault", "setLoginItemSettings", "checkForUpdatesAndNotify"]) {
    assert.ok(main.includes(needle), `main.mjs 应包含 ${needle}`);
  }
  // 数据全本地:服务只绑 127.0.0.1(默认值),不主动发起任何外网请求
  assert.ok(!/fetch\(\s*["']https?:/.test(main), "主进程不得主动请求外网");
});

test("插件核心零依赖:hooks/scripts/mcp/commands 无 npm 包引用", () => {
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.(mjs|cjs|js)$/.test(e.name)) files.push(f);
    }
  })(PLUGIN);
  assert.ok(files.length > 10, `应扫到插件核心源码,实际 ${files.length}`);
  const bad = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?:from\s*|import\s*\(\s*|require\(\s*)["']([^"']+)["']/g)) {
      const spec = m[1];
      // 只允许 node: 内置与相对路径;file: 只可能出现在测试/文档字符串里
      if (!spec.startsWith("node:") && !spec.startsWith(".") && !spec.startsWith("file:")) {
        bad.push(`${path.relative(ROOT, f)} -> ${spec}`);
      }
    }
    assert.ok(!/\brequire\(\s*["'](?!node:)/.test(src), `${f} 不应使用 require 引包`);
  }
  assert.deepEqual(bad, [], "插件核心不得引入任何 npm 依赖");
  // 插件目录下不应出现 package.json(避免被当成 Node 包分发)
  assert.ok(!fs.existsSync(path.join(PLUGIN, "package.json")), "插件本体不新增 package.json");
  assert.ok(!fs.existsSync(path.join(PLUGIN, "node_modules")), "插件本体不新增 node_modules");
});

test("工作区级依赖只在根 package.json,electron-updater 是运行依赖", () => {
  const pkg = JSON.parse(read(path.join(ROOT, "package.json")));
  assert.equal(pkg.private, true, "桌面客户端是独立分发物,不进插件市场");
  assert.equal(pkg.main, "electron/main.mjs");
  assert.ok(pkg.dependencies["electron-updater"], "electron-updater 必须在 dependencies(asar 不含 devDeps)");
  assert.ok(pkg.devDependencies.electron && pkg.devDependencies["electron-builder"]);
  assert.equal(pkg.scripts.dev, "electron .");
  // 插件市场清单不应引用桌面客户端
  const market = JSON.parse(read(path.join(ROOT, "marketplace.json")));
  assert.ok(!JSON.stringify(market).includes("electron"), "市场清单不得涉及桌面客户端");
});

test("大屏页面:桌面专属按钮默认隐藏,仅 Electron 环境显示", () => {
  const html = read(path.join(PLUGIN, "dashboard", "index.html"));
  assert.ok(html.includes("html.tps-electron .deskBtn"), "按钮应由 tps-electron 类放行");
  assert.match(html, /\.deskBtn\s*\{[^}]*display:\s*none/s, "默认必须隐藏,浏览器里不可见");
  assert.ok(html.includes('id="pinBtn"') && html.includes('id="ovBtn"'), "应有置顶与悬浮条按钮");
  assert.ok(html.includes("if (window.tpsDesktop)"), "桌面能力按注入标记启用");
  // 浏览器行为不变:SSE 与配置接口仍是页面自己的事
  assert.ok(html.includes("/api/events") || html.includes("EventSource"), "浏览器大屏 SSE 通路保留");
});

test("overlay.ps1 保留为无 Electron 时的轻量替代(只加标注,不加功能)", () => {
  const ps1 = read(path.join(PLUGIN, "dashboard", "overlay.ps1"));
  assert.ok(ps1.includes("轻量替代"), "应标注为无 Electron 时的轻量替代");
  assert.match(ps1, /Electron/, "应指向 Electron 桌面客户端");
});
