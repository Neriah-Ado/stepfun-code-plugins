// Electron 预加载脚本(contextBridge 暴露最小 API)。
// 设计约束:
//   - contextIsolation 开启,渲染层拿不到任何 Node/Electron 内部对象,只能走这里的方法;
//   - 通道白名单显式列举,没有通用 invoke——渲染层(含复用的大屏页面)无法借道访问任意 IPC;
//   - 只暴露"窗口控制 / 配置读写 / 数据订阅"三类能力,配置校验仍在主进程侧(共享 config.mjs)。
// 大屏页面通过 documentElement 上的 tps-electron 类识别桌面环境,按注入标记启用专属能力
// (置顶开关);浏览器里该类不存在,行为与 V2.2.0 完全一致。

const { contextBridge, ipcRenderer } = require("electron");

// 渲染层 → 主进程(invoke 通道白名单)
const INVOKE = [
  "tps:get-config",
  "tps:set-config",
  "tps:main:minimize",
  "tps:main:hide",
  "tps:main:always-on-top:get",
  "tps:main:always-on-top:set",
  "tps:overlay:show",
  "tps:overlay:hide",
  "tps:overlay:toggle",
  "tps:overlay:click-through:get",
  "tps:overlay:click-through:set",
  "tps:overlay:expand",
  "tps:overlay:collapse",
  "tps:app:info",
];
// 主进程 → 渲染层(订阅通道白名单)
const EVENTS = [
  "tps:overlay-data",
  "tps:theme-changed",
  "tps:always-on-top-changed",
  "tps:click-through-changed",
  "tps:overlay-visible-changed",
];

const invoke = (channel, payload) => {
  if (!INVOKE.includes(channel)) return Promise.reject(new Error(`未授权的 IPC 通道: ${channel}`));
  return ipcRenderer.invoke(channel, payload);
};
const on = (channel, cb) => {
  if (!EVENTS.includes(channel)) return () => {};
  const handler = (_ev, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

// 标记桌面环境:CSS 据此显示置顶开关等 Electron 专属控件(首屏绘制前生效,无闪烁)
document.documentElement.classList.add("tps-electron");

contextBridge.exposeInMainWorld("tpsDesktop", {
  isOverlay: location.pathname.includes("overlay"),
  invoke,
  on,
  // ---- 配置(与浏览器大屏读写同一份 ~/.zcode/tps-monitor.config.json)----
  getConfig: () => invoke("tps:get-config"),
  setConfig: (patch) => invoke("tps:set-config", patch),
  // ---- 主窗口控制 ----
  minimize: () => invoke("tps:main:minimize"),
  hideToTray: () => invoke("tps:main:hide"),
  getAlwaysOnTop: () => invoke("tps:main:always-on-top:get"),
  setAlwaysOnTop: (v) => invoke("tps:main:always-on-top:set", Boolean(v)),
  toggleAlwaysOnTop: () =>
    invoke("tps:main:always-on-top:get").then((v) => invoke("tps:main:always-on-top:set", !v)),
  // ---- 悬浮条 ----
  showOverlay: () => invoke("tps:overlay:show"),
  hideOverlay: () => invoke("tps:overlay:hide"),
  toggleOverlay: () => invoke("tps:overlay:toggle"),
  getClickThrough: () => invoke("tps:overlay:click-through:get"),
  setClickThrough: (v) => invoke("tps:overlay:click-through:set", Boolean(v)),
  expandOverlay: () => invoke("tps:overlay:expand"),
  collapseOverlay: () => invoke("tps:overlay:collapse"),
  // ---- 订阅 ----
  onOverlayData: (cb) => on("tps:overlay-data", cb),
  onThemeChanged: (cb) => on("tps:theme-changed", cb),
  onAlwaysOnTopChanged: (cb) => on("tps:always-on-top-changed", cb),
  onClickThroughChanged: (cb) => on("tps:click-through-changed", cb),
  onOverlayVisibleChanged: (cb) => on("tps:overlay-visible-changed", cb),
  appInfo: () => invoke("tps:app:info"),
});
