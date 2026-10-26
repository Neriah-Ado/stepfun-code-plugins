#!/usr/bin/env node
// Electron 主进程:窗口 / 悬浮条 / 托盘 / 生命周期 / 开机自启 / 自动更新。
//
// 与插件的边界(硬性约束):
//   - 本文件是 electron/ 下唯一直接依赖 Electron 的模块;其余逻辑都在 electron/lib/*.mjs
//     里以纯函数 + 可注入依赖实现,node --test 不起 Electron 也能覆盖;
//   - 数据通路复用插件核心:内嵌启动 dashboard/server-core.mjs 的同一套服务(端口 0 随机、
//     127.0.0.1、不写 PID 文件、不空闲退出),主窗口直接加载它渲染出的 index.html,
//     与浏览器大屏是同一份页面、同一套接口;悬浮条则走 IPC 吃 scripts/token-rate.mjs;
//   - 不新增插件核心依赖:electron/ 与工作区级 package.json 之外,hooks/scripts/mcp/
//     commands/dashboard 一个包都不加。
//   - 数据全本地:服务只监听 127.0.0.1,无任何遥测/外网请求(自动更新除外,且仅安装版)。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PLUGIN = path.join(ROOT, "plugins", "zcode-tps-monitor");
const PRELOAD = path.join(HERE, "preload.cjs");
const OVERLAY_PAGE = path.join(HERE, "renderer", "overlay.html");
const ICON_DIR = path.join(HERE, "build", "icons");
const OVERLAY_EXPANDED_H = 150; // 悬停展开时的窗口高度(收起时回到记忆值)

// 开发态没装依赖时给出可操作的提示,而不是甩一截 MODULE_NOT_FOUND
let electron;
try {
  electron = await import("electron");
} catch {
  console.error(
    "[zcode-tps-monitor] 未找到 Electron。请先在仓库根目录执行 npm install(或 npm run dev)。"
  );
  process.exit(1);
}
const E = electron.default ?? electron;
const { app, BrowserWindow, Tray, Menu, nativeImage, nativeTheme, screen, ipcMain, shell } = E;

const { startDashboardServer, followedSessionId } = await import(
  pathToFileURL(path.join(PLUGIN, "dashboard", "server-core.mjs")).href
);
const { readAppearance, patchAppearance, CONFIG_FILE, readFocusAgent, patchFocusAgent } = await import(
  pathToFileURL(path.join(PLUGIN, "scripts", "lib", "config.mjs")).href
);
// token 速率查询:V2.4.0 起 token-rate.mjs 即多源聚合层(providers 配置,缺省仅 zcode),
// 悬浮条与大屏因此走同一份归一化结果;单源默认配置下与 V2.3.0 行为完全一致。
// V2.5.0:悬浮条按 focusAgent 圈定来源(缺省 zcode,与 V2.4.0 一致;"all" = 聚合)。
const { query: tokenRateQuery } = await import(
  pathToFileURL(path.join(PLUGIN, "scripts", "token-rate.mjs")).href
);
// agentStatus 给托盘「聚焦数据源」子菜单提供启用源与可用性(带 2s 缓存,菜单刷新频繁)
const { agentStatus } = await import(
  pathToFileURL(path.join(PLUGIN, "scripts", "lib", "collect-core.mjs")).href
);
let agentStatusCache = null;
let agentStatusAt = 0;
function cachedAgentStatus() {
  if (agentStatusCache && Date.now() - agentStatusAt < 2000) return agentStatusCache;
  try {
    agentStatusCache = agentStatus();
    agentStatusAt = Date.now();
  } catch (err) {
    agentStatusCache = [];
  }
  return agentStatusCache;
}
const { loadState, saveState, mergeBounds } = await import(
  pathToFileURL(path.join(HERE, "lib", "state-store.mjs")).href
);
const { createOverlayCollector } = await import(
  pathToFileURL(path.join(HERE, "lib", "collect-loop.mjs")).href
);

// ---------- 运行时状态 ----------

let state = loadState(); // 窗口尺寸/位置、置顶、穿透、自启、悬浮条可见性
let mainWin = null;
let overlayWin = null;
let tray = null;
let dash = null; // 内嵌大屏服务 { port, url, close() }
let collector = null; // 悬浮条采集循环
let quitting = false;
let overlayExpanded = false;

// ---------- 图标 ----------

// 极端兜底:图标文件缺失时用内联 16px PNG,托盘仍能出来
const FALLBACK_ICON =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAADuElEQVR42l3R609TdwDG8ZPwB8j9" +
  "UtqetrSlpT097TktvUGlgK7IHUphwW0MVDY3cc5hohi2I5soYhDZBm6DolR+boB0ExWQCAyRu9wz" +
  "ydhmssWXe9X3z9Ile7M/4Jsn+TwUX/k6gvf9aeN9fwh8xa8BrvwXYirbJsaSF4QtXCTMkZ+J7o0p" +
  "os19SNTu+0SZSQIKu1+g03tsEq4zguJ9f9l436sgX7Ef4r0vwZXvgivfgLFsFYayBeiLZ5F2ZBKa" +
  "3J+gzhqCMmMActu3Idr8ZVBiardRXMUrgfP+FuK8e+C8u+Aqt8HVbsLSuAqr8Bzpn87C1DAFbcUY" +
  "VDnfI8Xph9zaDSnfERKzrQJl8u4HTOV7/y6bqrZhPrsFV+8i3BMTyJ4fQe78IA6N34Wrexj6YyNQ" +
  "ZPkhs3RBYrqGZKYlQBnLXhJj6Q6M3i3wp7fgGlxCxvITZE2Pwz38GNlDozg87YdntQs5t/ugOXoH" +
  "tLUTYvYyRLpmQrElO4Qt3oCheh32rnXYF+eRGXwGS/McmJopMG8/gqd1HPUzQyhcugZ7Sx+kzhtI" +
  "ZgQkas8TylC0TpiiFbAn1uAYfgHr3DIsXyxAVzqJgrqnONOyBP/oHvpmdlA1FID74l3I7G1I0jUh" +
  "IfUsofT5y0RfsAD21AqsjzaRPr4Bw4ezcPoeo6P/NQbH/kZb9wo8tcPIbxhBXu0AFOZLSNQ0Il7V" +
  "QKg0zzOSljcLpv45LMEd8JO7YM7MwFAwivNX13GhbQ1sbi90B79CSc0APL5boNkmxKtOIy7lfUJp" +
  "D08TzaEn0FY9hfm7TTDzv8PUtYbUimGoXX4oHT1QWDvhyO+Br+42nHnXkaT5GHEpJxErP0ao1JwJ" +
  "os5+CJXnAZhzc2DH9nFwIgi2YRByZw9ocwe0GR0orO5FftXXUFuaEKf8ALHy44ih3yGUKusBUbru" +
  "Q+n6AcrCEXDNP8LZ3g+Vtx9Syw1IjFdAmz4Hn30VOnszElSnEKs4gRi6BtGSakKlZI4EFM57kDsG" +
  "IHf4IXP3gXZ/A0n6DYjZVogYAUlpF8LiiFeG43rEyN5FtLQaUWJfgJI77gky250Qnd4LqbkbEv4m" +
  "xMZ2JBsuQ6T/DInacPxJWBxxivcQI6tFtPQoosSVoUhRqUDJ7AM22toblJp7QhLu/3H468b/xBEr" +
  "r0OM9C1EiatCkaKy4IHEIhsls/ZFSC23bBK+SxCbrgeSDVeISH+JJKVdJAmacyRe/RGJSzlJYuXH" +
  "SRgtWvJmICrZK0QmFdsOJORH/AOF9gEyG2H9+QAAAABJRU5ErkJggg==";

function firstExisting(...files) {
  return files.find((f) => fs.existsSync(f) && fs.statSync(f).size > 0) || null;
}

function windowIcon() {
  const f = firstExisting(
    path.join(ICON_DIR, "icon.png"),
    path.join(ROOT, "assets", "icon.png")
  );
  if (f) return nativeImage.createFromPath(f);
  return nativeImage.createFromDataURL(`data:image/png;base64,${FALLBACK_ICON}`);
}

function trayIcon() {
  const f = firstExisting(
    path.join(ICON_DIR, "tray.png"),
    path.join(ICON_DIR, "icon.png"),
    path.join(ROOT, "assets", "icon.png")
  );
  if (f) return nativeImage.createFromPath(f);
  return nativeImage.createFromDataURL(`data:image/png;base64,${FALLBACK_ICON}`);
}

// ---------- 主窗口 ----------

function showLoadError(win, err) {
  const html = `<!DOCTYPE html><meta charset="utf-8"><body style="font:14px system-ui;padding:24px;color:#cbd5e1;background:#0b1020">
<h3>大屏服务加载失败</h3><p>${String(err && err.message ? err.message : err)}</p>
<p>可先以浏览器方式使用:运行 <code>node plugins/zcode-tps-monitor/dashboard/server.mjs</code></p></body>`;
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => {});
}

function createMainWindow() {
  const bounds = { width: state.main.width, height: state.main.height };
  if (state.main.x != null && state.main.y != null) {
    bounds.x = state.main.x;
    bounds.y = state.main.y;
  }
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 640,
    minHeight: 480,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0b1020" : "#eef1f8",
    title: "StepFun TPS 监视器",
    icon: windowIcon(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.once("ready-to-show", () => win.show());
  win.loadURL(dash.url).catch((err) => showLoadError(win, err));
  win.setAlwaysOnTop(state.main.alwaysOnTop);
  // 页面加载期间的广播可能还没人接收:加载完再同步一次桌面端状态,按钮初值不会错
  win.webContents.once("did-finish-load", () => {
    broadcast("tps:always-on-top-changed", state.main.alwaysOnTop);
    broadcast("tps:overlay-visible-changed", state.overlay.visible);
    broadcast("tps:click-through-changed", state.overlay.clickThrough);
  });

  // 尺寸/位置记忆:停手后再落盘,避免拖动过程刷几十次文件
  let saveTimer = null;
  const rememberBounds = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (mainWin && !mainWin.isDestroyed() && !mainWin.isMaximized()) {
        state = mergeBounds(state, "main", mainWin.getBounds());
        saveState(state);
      }
    }, 300);
  };
  win.on("resize", rememberBounds);
  win.on("move", rememberBounds);

  // 关闭 = 最小化到托盘(计划要求);真正退出只走托盘菜单/快捷键
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
  });
  win.on("closed", () => {
    if (mainWin === win) mainWin = null;
  });
  // 大屏里的外链(仓库地址等)走系统浏览器,不在应用内开新窗
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWin = win;
  return win;
}

function showMainWindow() {
  if (!mainWin || mainWin.isDestroyed()) {
    createMainWindow();
    return;
  }
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}

function toggleMainWindow() {
  if (mainWin && !mainWin.isDestroyed() && mainWin.isVisible()) mainWin.hide();
  else showMainWindow();
}

function setMainAlwaysOnTop(on) {
  state.main.alwaysOnTop = on;
  saveState(state);
  if (mainWin && !mainWin.isDestroyed()) mainWin.setAlwaysOnTop(on);
  broadcast("tps:always-on-top-changed", on);
  refreshTrayMenu();
}

// ---------- 悬浮条窗口 ----------

function defaultOverlayBounds() {
  const wa = screen.getPrimaryDisplay().workArea;
  const m = 24;
  const w = state.overlay.width;
  const h = state.overlay.height;
  return {
    width: w,
    height: h,
    x: state.overlay.x != null ? state.overlay.x : Math.round(wa.x + wa.width - w - m),
    y: state.overlay.y != null ? state.overlay.y : Math.round(wa.y + wa.height - h - m),
  };
}

function createOverlayWindow() {
  const b = defaultOverlayBounds();
  const win = new BrowserWindow({
    width: b.width,
    height: b.height,
    x: b.x,
    y: b.y,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    icon: windowIcon(),
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  // 悬浮层级:压在普通置顶窗口之上,但不用 screen-saver 级(会盖住输入法/通知)
  win.setAlwaysOnTop(true, "floating");
  win.loadFile(OVERLAY_PAGE).catch((err) => console.error("[overlay] 页面加载失败", err));
  win.on("moved", () => {
    state = mergeBounds(state, "overlay", win.getBounds());
    saveState(state);
  });
  win.on("closed", () => {
    if (overlayWin === win) overlayWin = null;
  });
  applyClickThrough(state.overlay.clickThrough);
  try {
    // 所有工作区/全屏时也可见(部分平台不支持,失败无所谓)
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {}
  overlayWin = win;
  return win;
}

// 点击穿透:true 时鼠标事件落到下层窗口;forward:true 仍把 mousemove 送进来,
// 悬停展开详情因此不受影响——这是"穿透 + 悬停详情"能同时成立的关键。
function applyClickThrough(on) {
  state.overlay.clickThrough = on;
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.setIgnoreMouseEvents(on, { forward: true });
  }
  broadcast("tps:click-through-changed", on);
  refreshTrayMenu();
}

function setClickThrough(on) {
  applyClickThrough(Boolean(on));
  saveState(state);
}

function showOverlay() {
  if (!overlayWin || overlayWin.isDestroyed()) createOverlayWindow();
  overlayWin.show();
  state.overlay.visible = true;
  saveState(state);
  startCollector();
  broadcast("tps:overlay-visible-changed", true);
  refreshTrayMenu();
}

function hideOverlay() {
  stopCollector();
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.hide();
  state.overlay.visible = false;
  saveState(state);
  broadcast("tps:overlay-visible-changed", false);
  refreshTrayMenu();
}

function toggleOverlay() {
  if (state.overlay.visible) hideOverlay();
  else showOverlay();
  return state.overlay.visible;
}

// 悬停展开:保持左上角锚点,只在高度上长;贴近屏幕下沿时先上移,保证详情不被裁掉
function setOverlayExpanded(on) {
  overlayExpanded = Boolean(on);
  if (!overlayWin || overlayWin.isDestroyed()) return;
  const b = overlayWin.getBounds();
  const h = overlayExpanded ? OVERLAY_EXPANDED_H : state.overlay.height;
  const wa = screen.getDisplayMatching(b).workArea;
  let y = b.y;
  if (y + h > wa.y + wa.height) y = Math.max(wa.y, wa.y + wa.height - h);
  overlayWin.setBounds({ x: b.x, y, width: state.overlay.width, height: h });
}

// ---------- 采集循环(悬浮条数据) ----------

function startCollector() {
  if (collector) return;
  collector = createOverlayCollector({
    // sessionId 传 null:每次都重新解析"当前跟随的会话",切会话后悬浮条立刻跟上。
    // V2.5.0:focusAgent 每次采集时现读配置(托盘切换/手改配置文件即刻生效);
    // 缺省 zcode 在默认 providers=["zcode"] 下与 V2.4.0 的合并查询结果完全一致。
    // 聚焦第三方源时由该源自己解析"当前会话"(会话 id 与 zcode 不通用);
    // "all" = 聚合全部启用源。
    queryFn: async (sid) => {
      const focus = readFocusAgent();
      if (focus && focus !== "all") {
        const baseSid = focus === "zcode" ? (sid || followedSessionId().id) : null;
        return tokenRateQuery(baseSid, { agent: focus });
      }
      return tokenRateQuery(sid || followedSessionId().id);
    },
    sessionId: null,
    onData: (payload) => {
      if (overlayWin && !overlayWin.isDestroyed()) {
        overlayWin.webContents.send("tps:overlay-data", payload);
      }
    },
    onError: (err) => console.error("[overlay] 采集循环异常:", err),
  });
  collector.start();
}

function stopCollector() {
  if (!collector) return;
  collector.stop();
  collector = null;
}

// ---------- 托盘 ----------

// 切换聚焦数据源:写 config focusAgent(悬浮条采集循环每次采集都现读,即刻生效),
// overlay.ps1 读同一份配置,天然互通。
function setFocusAgent(id) {
  try {
    patchFocusAgent(id);
    refreshTrayMenu();
  } catch (err) {
    console.error("[focus] 切换聚焦数据源失败:", err.message);
  }
}

function refreshTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const ovVisible = state.overlay.visible;
  // V2.5.0:「聚焦数据源」子菜单 —— 单选悬浮条显示哪个客户端的速率。
  // "全部(聚合)" 不圈定来源;各源显示可用性,不可用的源也能选(显示空态)。
  let focusNow = "zcode";
  try { focusNow = readFocusAgent(); } catch {}
  const focusItems = [{ label: "全部(聚合)", value: "all" }].concat(
    cachedAgentStatus().map((a) => ({
      label: `${a.label}${a.ok ? "" : "(无数据)"}`,
      value: a.provider,
    }))
  );
  const menu = Menu.buildFromTemplate([
    { label: ovVisible ? "隐藏悬浮条" : "显示悬浮条", click: () => toggleOverlay() },
    { label: "打开仪表盘", click: () => showMainWindow() },
    {
      label: "聚焦数据源",
      submenu: focusItems.map((it) => ({
        label: it.label,
        type: "radio",
        checked: focusNow === it.value,
        click: () => setFocusAgent(it.value),
      })),
    },
    { type: "separator" },
    {
      label: "主窗口置顶",
      type: "checkbox",
      checked: state.main.alwaysOnTop,
      click: (item) => setMainAlwaysOnTop(item.checked),
    },
    {
      label: "悬浮条点击穿透",
      type: "checkbox",
      checked: state.overlay.clickThrough,
      click: (item) => setClickThrough(item.checked),
    },
    {
      label: "开机自启",
      type: "checkbox",
      checked: state.autostart,
      click: (item) => setAutostart(item.checked),
    },
    { type: "separator" },
    { label: "退出", click: () => quitApp() },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  const img = trayIcon();
  tray = new Tray(img.isEmpty() ? nativeImage.createFromDataURL(`data:image/png;base64,${FALLBACK_ICON}`) : img);
  tray.setToolTip("StepFun TPS 监视器");
  tray.on("click", () => toggleMainWindow());
  refreshTrayMenu();
}

// ---------- 开机自启 / 自动更新 ----------

// 登录项只在安装版上注册:开发态 process.execPath 是 electron 二进制,
// 注册它没有意义(会启动一个没有应用上下文的光壳)。
function applyAutostart() {
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({ openAtLogin: state.autostart });
  } catch (err) {
    console.error("[autostart] 设置登录项失败:", err.message);
  }
}

function setAutostart(on) {
  state.autostart = Boolean(on);
  saveState(state);
  if (app.isPackaged) {
    try {
      app.setLoginItemSettings({ openAtLogin: state.autostart });
    } catch (err) {
      console.error("[autostart] 设置登录项失败:", err.message);
    }
  }
  refreshTrayMenu();
}

function setupAutoUpdate() {
  if (!app.isPackaged) return; // 开发态没有发布配置,检查只会刷错误日志
  import("electron-updater")
    .then(({ autoUpdater }) => {
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.on("error", (err) => console.error("[updater] 检查更新失败:", err.message));
      autoUpdater.on("update-available", (info) =>
        console.log(`[updater] 发现新版本 ${info.version},开始后台下载`)
      );
      autoUpdater.on("update-downloaded", (info) =>
        console.log(`[updater] ${info.version} 已就绪,退出后自动安装`)
      );
      return autoUpdater.checkForUpdatesAndNotify();
    })
    .catch((err) => console.error("[updater] 不可用:", err.message));
}

// ---------- IPC(通道与 preload.cjs 白名单一一对应) ----------

function registerIpc() {
  ipcMain.handle("tps:get-config", () => {
    try {
      return { appearance: readAppearance(), configFile: CONFIG_FILE };
    } catch (err) {
      return { error: err.message, configFile: CONFIG_FILE };
    }
  });

  ipcMain.handle("tps:set-config", (_e, patch) => {
    try {
      return { appearance: patchAppearance(patch || {}) };
    } catch (err) {
      return { error: err.message, fieldErrors: err.fieldErrors || [] };
    }
  });

  ipcMain.handle("tps:main:minimize", () => {
    if (mainWin && !mainWin.isDestroyed()) mainWin.minimize();
  });

  ipcMain.handle("tps:main:hide", () => {
    if (mainWin && !mainWin.isDestroyed()) mainWin.hide();
  });

  ipcMain.handle("tps:main:always-on-top:get", () => state.main.alwaysOnTop);

  ipcMain.handle("tps:main:always-on-top:set", (_e, value) => {
    setMainAlwaysOnTop(Boolean(value));
    return state.main.alwaysOnTop;
  });

  ipcMain.handle("tps:overlay:show", () => showOverlay());
  ipcMain.handle("tps:overlay:hide", () => hideOverlay());
  ipcMain.handle("tps:overlay:toggle", () => toggleOverlay());

  ipcMain.handle("tps:overlay:click-through:get", () => state.overlay.clickThrough);

  ipcMain.handle("tps:overlay:click-through:set", (_e, value) => {
    setClickThrough(Boolean(value));
    return state.overlay.clickThrough;
  });

  ipcMain.handle("tps:overlay:expand", () => setOverlayExpanded(true));
  ipcMain.handle("tps:overlay:collapse", () => setOverlayExpanded(false));

  ipcMain.handle("tps:app:info", () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    packaged: app.isPackaged,
  }));
}

// ---------- 广播 / 生命周期 ----------

function broadcast(channel, payload) {
  for (const win of [mainWin, overlayWin]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function quitApp() {
  quitting = true;
  saveState(state);
  app.quit();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showMainWindow());

  app
    .whenReady()
    .then(async () => {
      app.setAppUserModelId("com.stepfun.tps-monitor");
      // 先起服务再开窗:主窗口 loadURL 时端口必须已经在听
      dash = await startDashboardServer({ port: 0, idleExitMin: 0, writePidFile: false });
      console.log(`[zcode-tps-monitor] 内嵌大屏服务: ${dash.url}`);
      createMainWindow();
      createTray();
      registerIpc();
      applyAutostart();
      setupAutoUpdate();
      if (state.overlay.visible) showOverlay();
      // 主题跟随系统:浏览器大屏靠 CSS 媒体查询自动切换,这里再把原生主题变化
      // 广播给两端(供桌面专属控件同步"跟随系统"的选中态),并同步窗口底色防闪烁
      nativeTheme.on("updated", () => {
        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#0b1020" : "#eef1f8");
        }
        broadcast("tps:theme-changed", nativeTheme.shouldUseDarkColors ? "dark" : "light");
      });
      app.on("activate", () => showMainWindow()); // macOS 点 Dock 图标
    })
    .catch((err) => {
      console.error("[zcode-tps-monitor] 启动失败:", err);
      app.exit(1);
    });

  // 托盘常驻:所有窗口关掉也不退出(主窗口关闭本就只是隐藏)
  app.on("window-all-closed", () => {});

  app.on("before-quit", () => {
    quitting = true;
    stopCollector();
    if (dash) {
      try {
        dash.close();
      } catch {}
      dash = null;
    }
  });
}
