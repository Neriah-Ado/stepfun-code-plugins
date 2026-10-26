// 悬浮条数据载荷(Electron 主进程 → 悬浮条渲染层,经 IPC 推送)。
// 纯函数、零依赖、不碰 node:sqlite:入参是 scripts/token-rate.mjs 的 query() 结果,
// 出参是渲染层直接可用的扁平结构。抽成独立模块是为了能在 node --test 里
// 不起 Electron 就跑断言(与 V2.2.0 的纯逻辑测试同一思路)。

// 入参 result 形状(与 REST /api/token-rate 一致):
//   { sessionId, scoped, latest, session, history, follow? }
//   latest : { model, outputTokens, reasoningTokens, ttftMs, genMs, tokPerSec, completedAt } | null
//   session: { samples, requests, avg, max, min, totalOutput, totalReasoning, totalInput, totalCacheRead } | null
//   history: 同 latest 的数组(曲线历史,新→旧)
export function buildOverlayPayload(result) {
  const latest = result && result.latest ? result.latest : null;
  const session = result && result.session ? result.session : null;
  const history = result && Array.isArray(result.history) ? result.history : [];
  const fin = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  // 有数据时的当前 tok/s:取最近一条有效样本(与 Stop 钩子/token-rate 口径一致)
  const tokPerSec = latest ? fin(latest.tokPerSec) : null;
  // 近 N 次均值:N 即统计窗口(默认 5),与 session.avg 同源
  const avg = session ? fin(session.avg) : null;
  const samples = session ? session.samples | 0 : 0;
  // 会话累计 token:输出 + 思考(与"累计 xxx tok"口径一致)
  const totalTok = session ? (session.totalOutput ?? 0) + (session.totalReasoning ?? 0) : 0;
  // 首字延迟:最近一次有效样本的 TTFT
  const ttftMs = latest ? fin(latest.ttftMs) : null;

  return {
    ok: true,
    ts: Date.now(),
    sessionId: result && result.sessionId != null ? result.sessionId : null,
    follow: result && result.follow ? result.follow : null,
    model: latest ? latest.model ?? null : null,
    // V2.5.0:聚焦数据源(id)。缺省 zcode —— 单源默认配置下恒为 "zcode",
    // 渲染层据此决定是否显示来源标签,与 V2.4.0 视觉一致。
    // agentScoped:本次查询是否圈定了单一来源(合并聚合时为 false,不显示单一标签)。
    provider: result && result.provider != null ? result.provider : null,
    agentScoped: Array.isArray(result && result.sources) ? result.sources.length === 1 : false,
    tokPerSec,
    ttftMs,
    avg,
    samples,
    totalTok,
    // 迷你曲线:最近若干个有效样本的 tok/s(新→旧),供悬浮条画 sparkline
    spark: history
      .map((h) => fin(h && h.tokPerSec))
      .filter((v) => v != null)
      .slice(0, 12),
  };
}

// 无数据(库不存在 / 尚未产生任何请求)时的占位载荷:渲染层显示 "--"
export function emptyOverlayPayload(reason) {
  return {
    ok: false,
    ts: Date.now(),
    reason: reason || "no-data",
    sessionId: null,
    follow: null,
    model: null,
    provider: null,
    agentScoped: false,
    tokPerSec: null,
    ttftMs: null,
    avg: null,
    samples: 0,
    totalTok: 0,
    spark: [],
  };
}

// 采集一次并产出载荷:queryFn 抛错(库未就绪等瞬时错误)时回退占位载荷,
// 绝不让悬浮条采集循环把主进程拖崩。
export async function collectOverlayPayload(queryFn, sessionId) {
  try {
    const result = await queryFn(sessionId);
    return buildOverlayPayload(result);
  } catch (err) {
    return emptyOverlayPayload(err && err.message ? err.message : "error");
  }
}
