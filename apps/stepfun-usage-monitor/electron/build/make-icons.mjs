#!/usr/bin/env node
// 生成 Electron 打包用图标:electron/build/icons/{icon.png,tray.png,icon.ico,icon.icns}。
// 纯 Node、零依赖:PNG 复用仓库既有的 assets/generate-icon.mjs(SDF 渲染器),
// ICO/ICNS 只是容器格式的壳(PNG 载荷),不需要额外工具链。
// 用法:node electron/build/make-icons.mjs
//   图标会提交进仓库,打包时不需要再跑;改了 assets/generate-icon.mjs 的图形后重跑即可。

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { spawnSync } from "node:child_process";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const OUT_DIR = path.join(HERE, "icons");
const GEN = path.join(ROOT, "assets", "generate-icon.mjs");

// PNG 尺寸:窗口图标 256、托盘 32;ICO/ICNS 各嵌一套多分辨率
const PNG_SIZES = [256, 128, 64, 48, 32, 16];
const ICO_SIZES = [16, 32, 48, 256];
// ICNS 类型码 → 像素尺寸
const ICNS_SIZES = [
  ["icp4", 16],
  ["icp5", 32],
  ["icp6", 64],
  ["ic07", 128],
  ["ic08", 256],
  ["ic09", 512],
];

function render(size) {
  const out = path.join(OUT_DIR, `tmp-${size}.png`);
  const r = spawnSync(process.execPath, [GEN, out, String(size)], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`生成 ${size}px 图标失败`);
  return out;
}

function buildIco(entries) {
  // ICO:6 字节头 + N×16 字节目录 + 各 PNG 载荷(256 记 0)
  const count = entries.length;
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(count, 4);
  let dirSize = 16 * count;
  const dir = Buffer.alloc(dirSize);
  const body = [];
  let offset = 6 + dirSize;
  entries.forEach((e, i) => {
    const o = i * 16;
    dir[o] = e.size >= 256 ? 0 : e.size;
    dir[o + 1] = e.size >= 256 ? 0 : e.size;
    dir[o + 2] = 0; // 调色板颜色数(0 = 真彩色)
    dir[o + 3] = 0; // 保留
    dir.writeUInt16LE(1, o + 4); // 颜色平面
    dir.writeUInt16LE(32, o + 6); // 位深
    dir.writeUInt32LE(e.png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.png.length;
    body.push(e.png);
  });
  return Buffer.concat([head, dir, ...body]);
}

function buildIcns(entries) {
  // ICNS:"icns" + 总长 + (4 字节类型 + 4 字节长度 + 载荷)×N,均为大端
  let total = 8;
  for (const e of entries) total += 8 + e.png.length;
  const out = Buffer.alloc(total);
  out.write("icns", 0, "ascii");
  out.writeUInt32BE(total, 4);
  let o = 8;
  for (const e of entries) {
    out.write(e.type, o, "ascii");
    o += 4;
    out.writeUInt32BE(8 + e.png.length, o);
    o += 4;
    e.png.copy(out, o);
    o += e.png.length;
  }
  return out;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const rendered = new Map();
  for (const size of new Set([...PNG_SIZES, ...ICO_SIZES, ...ICNS_SIZES.map(([, s]) => s)])) {
    const file = render(size);
    rendered.set(size, { file, png: fs.readFileSync(file) });
  }

  // 256px 作为应用/窗口图标,32px 作为托盘图标(其余是容器用的中间尺寸)
  const icon256 = rendered.get(256);
  fs.copyFileSync(icon256.file, path.join(OUT_DIR, "icon.png"));
  fs.copyFileSync(rendered.get(32).file, path.join(OUT_DIR, "tray.png"));

  fs.writeFileSync(
    path.join(OUT_DIR, "icon.ico"),
    buildIco(ICO_SIZES.map((s) => ({ size: s, png: rendered.get(s).png })))
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "icon.icns"),
    buildIcns(ICNS_SIZES.map(([type, size]) => ({ type, png: rendered.get(size).png })))
  );

  for (const { file } of rendered.values()) fs.unlinkSync(file); // 清掉中间尺寸
  for (const f of ["icon.png", "tray.png", "icon.ico", "icon.icns"]) {
    const p = path.join(OUT_DIR, f);
    console.log(`OK ${path.relative(ROOT, p)} ${fs.statSync(p).size} bytes`);
  }
}

main();
