#!/usr/bin/env node
// 生成插件图标 assets/icon.png(256×256,4× 超采样抗锯齿)。
// 纯 Node 实现,无依赖:用 SDF(有向距离场)画形状,zlib 编码 PNG。
// 用法:node assets/generate-icon.mjs [输出路径] [尺寸]
//   node assets/generate-icon.mjs                # assets/icon.png 256px
//   node assets/generate-icon.mjs preview 32     # 预览小尺寸(检验 16~32px 可辨识度)

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import zlib from "node:zlib";

const OUT = process.argv[2] && !/^\d+$/.test(process.argv[2]) ? process.argv[2] : path.join(path.dirname(url.fileURLToPath(import.meta.url)), "icon.png");
const SIZE = Number(process.argv[2] && /^\d+$/.test(process.argv[2]) ? process.argv[2] : process.argv[3]) || 256;
const SS = 4; // 超采样倍数
const W = SIZE * SS;

// ---------- 基础 SDF ----------
const sdRoundedRect = (px, py, cx, cy, hx, hy, r) => {
  const dx = Math.abs(px - cx) - (hx - r), dy = Math.abs(py - cy) - (hy - r);
  const ax = Math.max(dx, 0), ay = Math.max(dy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - r;
};
const sdSegment = (px, py, ax, ay, bx, by, r) => {
  const abx = bx - ax, aby = by - ay, apx = px - ax, apy = py - ay;
  const t = Math.min(1, Math.max(0, (apx * abx + apy * aby) / (abx * abx + aby * aby)));
  return Math.hypot(apx - abx * t, apy - aby * t) - r;
};
const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;
// 圆环弧段:角度制,屏幕坐标(y 向下),角度顺时针增大,0°=东
function sdArc(px, py, cx, cy, R, halfW, a0, a1) {
  const dx = px - cx, dy = py - cy;
  const dist = Math.abs(Math.hypot(dx, dy) - R) - halfW;
  const norm = (a) => {
    let x = a % 360;
    if (x < 0) x += 360;
    return x;
  };
  let d = norm(a1 - a0), t = norm(px === 0 && py === 0 ? 0 : (Math.atan2(dy, dx) * 180) / Math.PI - a0);
  return t >= 0 && t <= d ? dist : Math.hypot(dx, dy) - R - halfW + 1e9 * 0; // 弧外端点距离用半径差近似
}
function arcDist(px, py, cx, cy, R, halfW, a0, a1) {
  const dx = px - cx, dy = py - cy;
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  const norm = (a) => ((a % 360) + 360) % 360;
  const sweep = norm(a1 - a0) || 360;
  const rel = norm(ang - a0);
  if (rel <= sweep) return Math.abs(Math.hypot(dx, dy) - R) - halfW;
  // 超出弧范围:取到两端点(弧线端点)的最小距离
  const rad = (d) => (d * Math.PI) / 180;
  const e0 = [cx + R * Math.cos(rad(a0)), cy + R * Math.sin(rad(a0))];
  const e1 = [cx + R * Math.cos(rad(a1)), cy + R * Math.sin(rad(a1))];
  const dEnd = (e) => Math.max(Math.hypot(px - e[0], py - e[1]) - halfW, Math.abs(Math.hypot(px - cx, py - cy) - R) - halfW - 1e9);
  // 端点圆帽:以端点为圆心 halfW 半径的圆,与环带相交;简化为端点圆
  const cap = (e) => Math.hypot(px - e[0], py - e[1]) - halfW;
  return Math.min(cap(e0), cap(e1), dEnd(e0), dEnd(e1));
}

// ---------- 配色 ----------
const mix = (c1, c2, t) => c1.map((v, i) => v + (c2[i] - v) * t);
const BG_TOP = [47, 84, 235];     // #2F54EB 靛蓝
const BG_BOT = [13, 20, 66];      // #0D1442 深夜蓝
const TRACK = [255, 255, 255];
const GLOW = [34, 211, 238];      // #22D3EE 青
const FAST = [74, 222, 128];      // #4ADE80 绿
const WHITE = [255, 255, 255];

// ---------- 场景参数(以 256 坐标系描述,绘制时乘 SS) ----------
// S 必须换算到超采样画布:W = SIZE×SS,故 S = W/256(而不是 SIZE/256,
// 否则内容只画进画布左上 1/4,其余透明——正是"图标缩在左上角"的根因)。
const S = W / 256;
const C = [128, 124];              // 表盘中心(水平居中)
const R = 64;                      // 弧半径
const RING = 13;                   // 环半宽
const A0 = 135, SWEEP = 270;       // 起点左下,顺时针 270°
const PROG = 0.72;                 // 进度占比(高速)
const NEEDLE_A = A0 + SWEEP * PROG;

function coverage(px, py) {
  // 背景:圆角方 + 对角渐变 + 顶部微光
  const bg = sdRoundedRect(px, py, 128 * S, 128 * S, 124 * S, 124 * S, 56 * S);
  const g = Math.min(1, Math.max(0, (px / W) * 0.55 + (py / W) * 0.45));
  let col = mix(BG_TOP, BG_BOT, g);
  const glow = Math.max(0, 1 - Math.hypot(px - 88 * S, py - 52 * S) / (170 * S));
  col = mix(col, [90, 130, 255], glow * 0.25);

  const aa = 0.8 * SS; // 1px@输出分辨率 的过渡带
  const cov = (d) => Math.min(1, Math.max(0, 0.5 - d / (aa * 2)));

  // 表盘轨道(半透明白,足够亮以保证整圈可见)
  const track = arcDist(px, py, C[0] * S, C[1] * S, R * S, RING * S, A0, A0 + SWEEP);
  const tCov = cov(track);
  if (tCov > 0) col = mix(col, TRACK, tCov * 0.30);

  // 进度弧:青→绿渐变 + 轻微外发光
  const a1 = A0 + SWEEP * PROG;
  const prog = arcDist(px, py, C[0] * S, C[1] * S, R * S, RING * S, A0, a1);
  const pCov = cov(prog);
  if (pCov > 0) {
    const t = Math.min(1, Math.max(0, ((Math.atan2(py - C[1] * S, px - C[0] * S) * 180) / Math.PI - A0 + 360) % 360 / (SWEEP * PROG)));
    col = mix(col, mix(GLOW, FAST, t), pCov);
  }
  const halo = Math.max(0, 1 - Math.max(0, prog - RING * S) / (18 * S));
  if (halo > 0 && prog > 0) col = mix(col, GLOW, halo * halo * 0.15);

  // 指针:白,圆帽;止于弧内侧,留出间隙
  const nA = (NEEDLE_A * Math.PI) / 180;
  const tip = [C[0] * S + (R - RING - 9) * S * Math.cos(nA), C[1] * S + (R - RING - 9) * S * Math.sin(nA)];
  const needle = sdSegment(px, py, C[0] * S, C[1] * S, tip[0], tip[1], 7 * S);
  const nCov = cov(needle);
  if (nCov > 0) col = mix(col, WHITE, nCov);

  // 轴心:白圆 + 中心色点
  const hub = sdCircle(px, py, C[0] * S, C[1] * S, 12 * S);
  const hCov = cov(hub);
  if (hCov > 0) col = mix(col, WHITE, hCov);
  const hubDot = sdCircle(px, py, C[0] * S, C[1] * S, 5 * S);
  const dCov = cov(hubDot);
  if (dCov > 0) col = mix(col, BG_TOP, dCov);

  const bgCov = cov(bg);
  return { col, a: bgCov };
}

// ---------- 渲染 + 4× 盒式下采样 ----------
const px = new Float64Array(W * W * 3);
const al = new Float64Array(W * W);
for (let y = 0; y < W; y++) {
  for (let x = 0; x < W; x++) {
    const { col, a } = coverage(x + 0.5, y + 0.5);
    const i = (y * W + x) * 3;
    px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2];
    al[y * W + x] = a;
  }
}
const n = SIZE, out = Buffer.alloc(n * n * 4);
for (let y = 0; y < n; y++) {
  for (let x = 0; x < n; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) {
      const si = ((y * SS + dy) * W + x * SS + dx) * 3, sa = al[(y * SS + dy) * W + x * SS + dx];
      r += px[si] * sa; g += px[si + 1] * sa; b += px[si + 2] * sa; a += sa;
    }
    const o = (y * n + x) * 4;
    out[o] = a ? Math.round(r / a) : 0;
    out[o + 1] = a ? Math.round(g / a) : 0;
    out[o + 2] = a ? Math.round(b / a) : 0;
    out[o + 3] = Math.round((a / (SS * SS)) * 255);
  }
}

// ---------- PNG 编码 ----------
const crcTable = Array.from({ length: 256 }, (_, k) => {
  let c = k;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
const raw = Buffer.alloc((n * 4 + 1) * n);
for (let y = 0; y < n; y++) {
  raw[y * (n * 4 + 1)] = 0;
  out.copy(raw, y * (n * 4 + 1) + 1, y * n * 4, (y + 1) * n * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
fs.writeFileSync(OUT, png);
console.log(`OK ${OUT} ${n}x${n} ${png.length} bytes`);
