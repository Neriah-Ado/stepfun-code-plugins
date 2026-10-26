// SSE 线格式助手(V2.2.0):纯字符串拼接、零依赖。
// 服务端(dashboard/server.mjs)与测试共用;协议细节集中在此:
//   - 事件帧:`event: <name>\ndata: <单行 JSON>\n\n`
//   - 心跳:注释行 `: ping\n\n`(无数据载荷,仅保活)
//   - 重连:retry 指令(毫秒)
// data 一律单行 JSON:SSE 的 data 字段按行分隔,JSON.stringify 会把换行转义成
// 字面量 \n,因此一个事件永远是一行 data,不会半路截断。

export const SSE_HEARTBEAT_MS = 15000;   // 心跳注释行间隔(空闲时唯一流量)
export const SSE_SYS_INTERVAL_MS = 5000; // 系统指标推送间隔(CPU 采样窗口内缓存)

export function sseEvent(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function sseComment(text = "ping") {
  return `: ${text}\n\n`;
}

export function sseRetry(ms) {
  return `retry: ${ms}\n\n`;
}

// 解析 SSE 字节流为帧(测试与调试用):注释行单独成帧,event/data/retry 行按空行分帧。
export function parseSseStream(text) {
  const frames = [];
  let cur = null;
  for (const raw of text.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line === "") {
      // retry 指令可以单独成帧(服务端连接建立时第一条就是 retry: 2000)
      if (cur && (cur.event || cur.data !== null || cur.retry !== undefined)) frames.push(cur);
      cur = null;
      continue;
    }
    if (line.startsWith(":")) {
      frames.push({ comment: line.slice(1).trim() });
      continue;
    }
    if (!cur) cur = { event: null, data: null };
    if (line.startsWith("event:")) cur.event = line.slice(6).trim();
    else if (line.startsWith("data:")) {
      const chunk = line.slice(5).trim();
      cur.data = cur.data === null ? chunk : `${cur.data}\n${chunk}`;
    } else if (line.startsWith("retry:")) cur.retry = Number(line.slice(6).trim());
  }
  return frames;
}
