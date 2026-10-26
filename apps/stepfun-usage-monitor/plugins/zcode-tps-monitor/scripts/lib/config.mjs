// 配置文件读写与外观(appearance)节校验。
// 配置文件:~/.zcode/tps-monitor.config.json
// 硬约束:字段只增不删——旧配置(仅有 stopHookLine / tokenRateLine)必须原样生效。
// 本模块零依赖,server.mjs / doctor.mjs / 单元测试共用。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PROVIDER_IDS, canonicalProviderId, normalizeProviderIds } from "./providers/index.mjs";

export const CONFIG_FILE = path.join(os.homedir(), ".zcode", "tps-monitor.config.json");

/** 默认只启用 ZCode 自己的用量库 —— 未配置 providers 时与 V2.3.0 行为完全一致。 */
export const DEFAULT_PROVIDERS = ["zcode"];

export const DEFAULT_APPEARANCE = {
  theme: "dark", // dark | light | system
  fontFamily: "Segoe UI, Microsoft YaHei, system-ui, sans-serif",
  monoFont: "Cascadia Mono, Consolas, monospace",
  fontSize: 16, // 12-24
  fontScale: 1.0, // 0.8-1.6
  accentColor: "#4da3ff",
  glassIntensity: 0.6, // 0-1;0 = 关闭液态玻璃,回到 V2.0 实色风格
  fontUrl: "", // http(s):// 或 file://;空 = 用系统字体栈
};

const THEMES = new Set(["dark", "light", "system"]);

// 字体栈允许:字母(含中文)、数字、空格、逗号、点、连字符、下划线、引号。
// 拒绝 < > ; { } ( ) \ 等可破坏 CSS 上下文的字符。
const SAFE_FONT_STACK = /^[\w\u4e00-\u9fff\u3000-\u303f\s,.\-'_"]{1,300}$/u;

const NAMED_COLORS = new Set([
  "transparent", "currentcolor", "white", "black", "red", "green", "blue",
  "yellow", "orange", "purple", "pink", "gray", "grey", "cyan", "magenta",
  "gold", "silver", "navy", "teal", "olive", "maroon", "lime", "aqua", "fuchsia",
]);

const APPEARANCE_NUMBERS = {
  fontSize: { min: 12, max: 24, integer: true },
  fontScale: { min: 0.8, max: 1.6 },
  glassIntensity: { min: 0, max: 1 },
};

/** 读取并解析配置文件;文件缺失或不可读时返回 {}。 */
export function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) || {};
  } catch {
    return {};
  }
}

/** 与 readConfig 相同,但配置损坏时抛出带修复提示的错误。 */
export function readConfigStrict() {
  let raw;
  try {
    raw = fs.readFileSync(CONFIG_FILE, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return {};
    throw new Error(`无法读取配置文件: ${err.message}`);
  }
  try {
    return JSON.parse(raw) || {};
  } catch (err) {
    throw new Error(
      `配置文件损坏(不是合法 JSON): ${CONFIG_FILE} —— ${err.message}。请手动修复或删除该文件后重试。`
    );
  }
}

export function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
}

/** 当前生效外观(含默认值填充;非法字段被丢弃后回落默认)。 */
export function readAppearance() {
  return { ...DEFAULT_APPEARANCE, ...normalizeAppearance(readConfig().appearance).value };
}

function clampNumber(field, value, errors) {
  const spec = APPEARANCE_NUMBERS[field];
  let n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) {
    errors.push({ field, message: "必须是数字" });
    return null;
  }
  const clamped = Math.min(spec.max, Math.max(spec.min, n));
  if (spec.integer) return Math.round(clamped);
  return Math.round(clamped * 100) / 100;
}

function isValidColor(value) {
  if (typeof value !== "string") return false;
  const s = value.trim();
  if (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return true;
  if (/^rgba?\(\s*[\d.]+(\s*,\s*[\d.]+){2,3}\s*\)$/i.test(s)) return true;
  if (/^hsla?\(\s*[\d.]+(deg)?\s*,\s*[\d.]+%\s*,\s*[\d.]+%(\s*,\s*[\d.]+)?\s*\)$/i.test(s)) return true;
  return NAMED_COLORS.has(s.toLowerCase());
}

function isValidFontUrl(value) {
  if (typeof value !== "string" || value === "") return true;
  try {
    const proto = new URL(value).protocol;
    return proto === "http:" || proto === "https:" || proto === "file:";
  } catch {
    return false;
  }
}

/**
 * 校验外观字段(可为部分字段)。
 * 返回 { value, errors }:value 只含通过校验的字段;errors 逐条给出字段与原因。
 */
export function normalizeAppearance(raw) {
  const value = {};
  const errors = [];
  if (!raw || typeof raw !== "object") {
    if (raw !== undefined && raw !== null) errors.push({ field: "appearance", message: "必须是对象" });
    return { value, errors };
  }

  if (raw.theme !== undefined) {
    const t = String(raw.theme).toLowerCase();
    if (THEMES.has(t)) value.theme = t;
    else errors.push({ field: "theme", message: "必须是 dark / light / system" });
  }

  for (const f of ["fontFamily", "monoFont"]) {
    if (raw[f] === undefined) continue;
    const v = String(raw[f]).trim();
    if (!v) { errors.push({ field: f, message: "不能为空" }); continue; }
    if (!SAFE_FONT_STACK.test(v)) {
      errors.push({ field: f, message: "含非法字符(仅允许字体名、逗号、引号等 CSS 字体栈安全字符)" });
      continue;
    }
    value[f] = v;
  }

  for (const f of Object.keys(APPEARANCE_NUMBERS)) {
    if (raw[f] === undefined) continue;
    const n = clampNumber(f, raw[f], errors);
    if (n !== null) value[f] = n;
  }

  if (raw.accentColor !== undefined) {
    if (isValidColor(raw.accentColor)) value.accentColor = String(raw.accentColor).trim();
    else errors.push({ field: "accentColor", message: "不是合法的 CSS 颜色(支持 #hex / rgb(a) / hsl(a) / 常用英文色名)" });
  }

  if (raw.fontUrl !== undefined) {
    if (isValidFontUrl(raw.fontUrl)) value.fontUrl = String(raw.fontUrl).trim();
    else errors.push({ field: "fontUrl", message: "仅支持 http(s):// 或 file:// 地址" });
  }

  return { value, errors };
}

/**
 * 合并写入 appearance(只替换提供的字段,其余配置原样保留)。
 * 校验失败或配置损坏时抛出带 fieldErrors 的错误。
 */
export function patchAppearance(patch) {
  const current = readConfigStrict();
  const { value, errors } = normalizeAppearance(patch);
  if (errors.length) {
    const err = new Error("外观配置校验失败");
    err.fieldErrors = errors;
    throw err;
  }
  const next = {
    ...current,
    appearance: { ...DEFAULT_APPEARANCE, ...(current.appearance || {}), ...value },
  };
  writeConfig(next);
  return next.appearance;
}

// ---------- 数据源(providers,V2.4.0 多 agent) ----------

/** 当前生效的数据源列表(缺省 ["zcode"]);非法值按 index.mjs 的清洗规则回落。 */
export function readProviders() {
  return normalizeProviderIds(readConfig().providers);
}

/**
 * 合并写入 providers(启用哪些客户端工具的本地用量数据)。只增不删原则:
 * 只替换 providers 这一个字段,stopHookLine / tokenRateLine / appearance 原样保留。
 * 校验失败(非数组 / 含未知 id)时抛出带 fieldErrors 的错误,不写文件。
 */
export function patchProviders(patch) {
  const current = readConfigStrict();
  const list = Array.isArray(patch) ? patch : Array.isArray(patch?.providers) ? patch.providers : null;
  if (!list) {
    const err = new Error("数据源配置校验失败");
    err.fieldErrors = [
      { field: "providers", message: `必须是数组,元素取自 ${PROVIDER_IDS.join(" / ")}` },
    ];
    throw err;
  }
  const unknown = list.filter((id) => !canonicalProviderId(id));
  if (unknown.length) {
    const err = new Error("数据源配置校验失败");
    err.fieldErrors = [
      { field: "providers", message: `未知的数据源: ${unknown.join(", ")}` },
    ];
    throw err;
  }
  const next = { ...current, providers: normalizeProviderIds(list) };
  writeConfig(next);
  return next.providers;
}

// ---------- 聚焦数据源(focusAgent,V2.5.0 展示层) ----------

/** 悬浮条/桌面端聚焦的数据源;缺省 zcode,默认配置下行为与 V2.4.0 完全一致。 */
export const DEFAULT_FOCUS_AGENT = "zcode";

/**
 * 当前聚焦的数据源。"all" 表示聚合(不圈定单一源);
 * 字段缺省或非法时回落 zcode(只增不删:旧配置无此字段行为不变)。
 */
export function readFocusAgent() {
  const v = readConfig().focusAgent;
  if (typeof v === "string" && (v === "all" || canonicalProviderId(v))) return v;
  return DEFAULT_FOCUS_AGENT;
}

/**
 * 合并写入 focusAgent(悬浮条/托盘切换用)。接受已知数据源 id 或 "all";
 * 其他值抛出带 fieldErrors 的错误,不写文件。其余配置字段原样保留。
 */
export function patchFocusAgent(patch) {
  const current = readConfigStrict();
  const raw = typeof patch === "string"
    ? patch
    : typeof patch?.focusAgent === "string" ? patch.focusAgent : null;
  if (raw == null || (raw !== "all" && !canonicalProviderId(raw))) {
    const err = new Error("聚焦数据源配置校验失败");
    err.fieldErrors = [
      { field: "focusAgent", message: `取值必须是 ${PROVIDER_IDS.join(" / ")} 或 "all"` },
    ];
    throw err;
  }
  const next = { ...current, focusAgent: raw };
  writeConfig(next);
  return next.focusAgent;
}
