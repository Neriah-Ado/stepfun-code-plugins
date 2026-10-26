// 悬浮条采集循环:主进程按固定节奏读一次 usage 库,经 IPC 推给悬浮条窗口。
// 与浏览器大屏的 SSE 采集器是两条独立通路——悬浮条不连 HTTP,直接吃 IPC 载荷,
// 避免为一个小窗再起一轮 SSE 客户端。queryFn 可注入,测试里用假数据驱动。

import { collectOverlayPayload } from "./overlay-payload.mjs";

export const OVERLAY_INTERVAL_MS = 1000;

// opts:
//   queryFn(sessionId) → Promise<token-rate query 结果>  必填
//   sessionId          跟随的会话 id(null = 自动解析当前会话)
//   intervalMs         采集节奏,默认 1000ms
//   onData(payload)    每次采集后调用(含失败占位载荷)
//   onError(err)       循环本身出错(理论上不会,onData 已兜底)
export function createOverlayCollector(opts) {
  const intervalMs = Math.max(200, Number(opts.intervalMs) || OVERLAY_INTERVAL_MS);
  let timer = null;
  let stopped = false;
  let running = false;

  async function tick() {
    if (stopped || running) return; // 上一次还没跑完(库锁/慢盘)就跳过,绝不叠加
    running = true;
    try {
      const payload = await collectOverlayPayload(opts.queryFn, opts.sessionId ?? null);
      if (!stopped && typeof opts.onData === "function") opts.onData(payload);
    } catch (err) {
      if (!stopped && typeof opts.onError === "function") opts.onError(err);
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (timer || stopped) return;
      timer = setInterval(tick, intervalMs);
      timer.unref();
      tick(); // 立即采一次,悬浮条不会先显示一秒 "--"
    },
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
    get running() {
      return timer != null;
    },
  };
}
