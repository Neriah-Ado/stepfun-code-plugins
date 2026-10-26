// 单元测试:node --test test/
// 外观配置(appearance)读写与校验:scripts/lib/config.mjs + doctor 外观自检。
// 通过 HOME/USERPROFILE 指向临时目录隔离真实 ~/.zcode 配置。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

process.removeAllListeners("warning");
process.on("warning", () => {});

const PLUGIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "plugins", "zcode-tps-monitor");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tps-config-"));

// 必须在导入 config.mjs 之前设置:模块加载时用 os.homedir() 解析配置文件路径
process.env.HOME = tmp;
process.env.USERPROFILE = tmp;

const {
  CONFIG_FILE,
  DEFAULT_APPEARANCE,
  normalizeAppearance,
  readConfig,
  readAppearance,
  patchAppearance,
} = await import(pathToFileURL(path.join(PLUGIN, "scripts", "lib", "config.mjs")).href);

// --- 默认值与读取 ---

test("无配置文件:readAppearance 返回全套默认值", () => {
  assert.deepEqual(readAppearance(), DEFAULT_APPEARANCE);
  assert.deepEqual(readConfig(), {});
});

test("配置缺失单字段时回落默认,其余保留", () => {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ appearance: { theme: "light", fontSize: 20 } }));
  const a = readAppearance();
  assert.equal(a.theme, "light");
  assert.equal(a.fontSize, 20);
  assert.equal(a.fontScale, DEFAULT_APPEARANCE.fontScale); // 未配置 → 默认
});

// --- 数值夹紧 ---

test("数值字段越界被夹紧到合法区间", () => {
  const { value, errors } = normalizeAppearance({
    fontSize: 99, fontScale: 0.1, glassIntensity: 5,
  });
  assert.equal(errors.length, 0);
  assert.equal(value.fontSize, 24);   // 上限
  assert.equal(value.fontScale, 0.8); // 下限
  assert.equal(value.glassIntensity, 1);
});

test("数值字段下越界与小数步进", () => {
  const { value } = normalizeAppearance({ fontSize: 5, fontScale: 9, glassIntensity: -1 });
  assert.equal(value.fontSize, 12);
  assert.equal(value.fontScale, 1.6);
  assert.equal(value.glassIntensity, 0);
});

test("非数字与空字体栈被拒绝", () => {
  const r1 = normalizeAppearance({ fontSize: "abc" });
  assert.equal(r1.errors.length, 1);
  assert.equal(r1.errors[0].field, "fontSize");
  const r2 = normalizeAppearance({ fontFamily: "   " });
  assert.equal(r2.errors[0].field, "fontFamily");
  const r3 = normalizeAppearance({ theme: "bogus" });
  assert.equal(r3.errors[0].field, "theme");
});

// --- 安全校验 ---

test("字体栈注入被拒绝(; { } < > 等 CSS 破坏字符)", () => {
  for (const bad of [
    'Segoe UI; } body{display:none',
    'Segoe UI <script>alert(1)</script>',
    'Segoe UI, url(javascript:alert(1))',
  ]) {
    const { value, errors } = normalizeAppearance({ fontFamily: bad });
    assert.equal(value.fontFamily, undefined, bad);
    assert.equal(errors.length, 1, bad);
  }
});

test("合法字体栈(含中文/等宽/回退)通过", () => {
  const { value, errors } = normalizeAppearance({
    fontFamily: 'Segoe UI, "Microsoft YaHei", 思源黑体, sans-serif',
    monoFont: "Cascadia Mono, Consolas, monospace",
  });
  assert.equal(errors.length, 0);
  assert.equal(value.fontFamily, 'Segoe UI, "Microsoft YaHei", 思源黑体, sans-serif');
  assert.equal(value.monoFont, "Cascadia Mono, Consolas, monospace");
});

test("accentColor 只接受合法 CSS 颜色", () => {
  const ok = normalizeAppearance({ accentColor: "#4da3ff" });
  assert.equal(ok.value.accentColor, "#4da3ff");
  assert.equal(normalizeAppearance({ accentColor: "rgb(77, 163, 255)" }).errors.length, 0);
  assert.equal(normalizeAppearance({ accentColor: "orange" }).errors.length, 0);
  const bad = normalizeAppearance({ accentColor: "blue; } * { display:none" });
  assert.equal(bad.value.accentColor, undefined);
  assert.equal(bad.errors[0].field, "accentColor");
});

test("fontUrl 只允许 http(s)/file,空值合法", () => {
  assert.equal(normalizeAppearance({ fontUrl: "" }).errors.length, 0);
  assert.equal(normalizeAppearance({ fontUrl: "https://cdn.example.com/font.woff2" }).value.fontUrl,
    "https://cdn.example.com/font.woff2");
  const bad = normalizeAppearance({ fontUrl: "javascript:alert(1)" });
  assert.equal(bad.value.fontUrl, undefined);
  assert.equal(bad.errors[0].field, "fontUrl");
});

// --- 合并写入(字段只增不删) ---

test("patchAppearance 只改 appearance,旧字段原样保留", () => {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({
    stopHookLine: false,
    tokenRateLine: false,
    appearance: { theme: "dark", fontSize: 14 },
  }));
  const merged = patchAppearance({ theme: "light" });
  assert.equal(merged.theme, "light");
  assert.equal(merged.fontSize, 14);          // 未提供的字段保留
  assert.equal(merged.fontScale, DEFAULT_APPEARANCE.fontScale);
  const onDisk = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  assert.equal(onDisk.stopHookLine, false);   // 旧配置字段不丢
  assert.equal(onDisk.tokenRateLine, false);
  assert.equal(onDisk.appearance.theme, "light");
});

test("旧配置(无 appearance 节)补写后行为不变", () => {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ tokenRateLine: false }));
  const merged = patchAppearance({ glassIntensity: 0 });
  assert.equal(merged.glassIntensity, 0);
  const onDisk = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  assert.equal(onDisk.tokenRateLine, false);
  assert.deepEqual(onDisk.appearance, { ...DEFAULT_APPEARANCE, glassIntensity: 0 });
});

test("非法补写被拒绝,且不落盘", () => {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ appearance: { theme: "dark" } }));
  const before = fs.readFileSync(CONFIG_FILE, "utf8");
  // 越界数值会被夹紧(不算非法),这里用非数字 + 未知主题构造真失败
  assert.throws(() => patchAppearance({ fontSize: "abc", theme: "rainbow" }), (err) => {
    assert.equal(err.fieldErrors.length, 2);
    return true;
  });
  assert.equal(fs.readFileSync(CONFIG_FILE, "utf8"), before); // 校验失败不动原文件
});

test("配置损坏时补写抛修复提示,不静默覆盖", () => {
  fs.writeFileSync(CONFIG_FILE, "{ this is not json");
  assert.throws(() => patchAppearance({ theme: "light" }), /损坏/);
});

// --- doctor 外观自检 ---

test("doctor:含非法外观的配置被识别为失败项", async () => {
  // fontSize 越界会被夹紧(不算非法),用注入型字体栈构造真失败
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({
    appearance: { fontFamily: "Segoe UI; } body{display:none" },
  }));
  const { runDoctor } = await import(pathToFileURL(path.join(PLUGIN, "scripts", "doctor.mjs")).href);
  const report = await runDoctor();
  const appearance = report.checks.find((c) => c.name === "外观配置");
  assert.ok(appearance, "doctor 应包含外观配置检查");
  assert.equal(appearance.ok, false);
  assert.match(appearance.detail, /fontFamily/);
});

test("doctor:合法外观配置通过且不被 fontUrl 阻断", async () => {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({
    stopHookLine: false,
    appearance: { theme: "light", fontSize: 18, fontScale: 1.2, glassIntensity: 0 },
  }));
  const { runDoctor } = await import(pathToFileURL(path.join(PLUGIN, "scripts", "doctor.mjs")).href);
  const report = await runDoctor();
  const appearance = report.checks.find((c) => c.name === "外观配置");
  assert.equal(appearance.ok, true);
  assert.match(appearance.detail, /light/);
});

test("doctor:无配置文件时外观检查为提示项而非失败项", async () => {
  fs.rmSync(CONFIG_FILE, { force: true });
  const { runDoctor } = await import(pathToFileURL(path.join(PLUGIN, "scripts", "doctor.mjs")).href);
  const report = await runDoctor();
  const appearance = report.checks.find((c) => c.name === "外观配置");
  assert.equal(appearance.ok, true);
  assert.match(appearance.detail, /未配置/);
});
