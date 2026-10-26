// 桌面端状态持久化:窗口位置/尺寸、置顶开关、点击穿透、开机自启、悬浮条可见性。
// 存储位置 ~/.zcode/tps-monitor.desktop.json(与 appearance 配置分开:
// 外观仍走共享的 ~/.zcode/tps-monitor.config.json,桌面专属状态不污染插件配置节)。
// 纯函数 + fs,零依赖;路径每次调用时解析,便于测试隔离 HOME/USERPROFILE。
// 任何损坏/越界都回退默认值,绝不抛异常——桌面端不能因为状态文件坏了而起不来。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function statePath() {
  return path.join(os.homedir(), ".zcode", "tps-monitor.desktop.json");
}

export const DEFAULTS = {
  main: { width: 1180, height: 800, alwaysOnTop: false },
  overlay: { width: 232, height: 64, x: null, y: null, visible: false, clickThrough: false },
  autostart: false,
};

const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const bool = (v, d) => (typeof v === "boolean" ? v : d);

// 夹紧到合理区间:防止历史版本/手改出的越界值把窗口放到屏幕外或缩成一条线
function clampInt(v, lo, hi, d) {
  const n = Math.round(num(v, d));
  return Math.min(hi, Math.max(lo, n));
}

export function sanitizeState(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const main = s.main && typeof s.main === "object" ? s.main : {};
  const ov = s.overlay && typeof s.overlay === "object" ? s.overlay : {};
  return {
    main: {
      width: clampInt(main.width, 480, 10000, DEFAULTS.main.width),
      height: clampInt(main.height, 360, 10000, DEFAULTS.main.height),
      x: main.x == null ? null : clampInt(main.x, -10000, 10000, 0),
      y: main.y == null ? null : clampInt(main.y, -10000, 10000, 0),
      alwaysOnTop: bool(main.alwaysOnTop, DEFAULTS.main.alwaysOnTop),
    },
    overlay: {
      width: clampInt(ov.width, 120, 2000, DEFAULTS.overlay.width),
      height: clampInt(ov.height, 40, 2000, DEFAULTS.overlay.height),
      // 位置允许为 null(尚未放置过,由主进程决定默认位置)
      x: ov.x == null ? null : clampInt(ov.x, -10000, 10000, 0),
      y: ov.y == null ? null : clampInt(ov.y, -10000, 10000, 0),
      visible: bool(ov.visible, DEFAULTS.overlay.visible),
      clickThrough: bool(ov.clickThrough, DEFAULTS.overlay.clickThrough),
    },
    autostart: bool(s.autostart, DEFAULTS.autostart),
  };
}

export function loadState() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return sanitizeState(null); // 首次运行 / 文件损坏:默认值
  }
  return sanitizeState(raw);
}

// 原子写:先写临时文件再 rename,避免崩溃时留下半个 JSON
export function saveState(state) {
  const file = statePath();
  const clean = sanitizeState(state);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(clean, null, 2)}\n`);
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false; // 状态写失败不影响运行(下次用默认值)
  }
}

// 把窗口边界合并进状态(仅更新传入的键),返回新状态对象(纯函数)
export function mergeBounds(state, which, bounds) {
  const cur = state[which] || {};
  return {
    ...state,
    [which]: {
      ...cur,
      width: clampInt(bounds.width, 120, 10000, cur.width ?? DEFAULTS[which].width),
      height: clampInt(bounds.height, 40, 10000, cur.height ?? DEFAULTS[which].height),
      x: bounds.x == null ? null : clampInt(bounds.x, -10000, 10000, cur.x ?? 0),
      y: bounds.y == null ? null : clampInt(bounds.y, -10000, 10000, cur.y ?? 0),
    },
  };
}
