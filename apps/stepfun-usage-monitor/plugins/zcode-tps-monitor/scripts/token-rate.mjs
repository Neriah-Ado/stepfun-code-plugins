#!/usr/bin/env node
// Token 输出速率:从各客户端工具的本地用量数据计算真实的模型生成速率。
// 用法:
//   node token-rate.mjs                     最近一次请求 + 会话统计(人类可读)
//   node token-rate.mjs --turn              本轮(刚结束的用户轮次)即时速率
//   node token-rate.mjs --json              JSON 输出
//   node token-rate.mjs --agent claude-code 只统计某个客户端的数据源
//   node token-rate.mjs --session <id>      只统计指定会话
//   node token-rate.mjs --agents            列出数据源及各自的探测结果
//   ZCODE_SESSION_ID=xxx node ...           只统计指定会话(--session 优先级更高)
// V2.5.0 聚合输出:多源时人类可读输出按 provider 分组给出各源速率,--json 附 perProvider;
// 缺省(单 zcode)不打印这些块,保持既有格式。
//   ZCODE_SESSION_ID=xxx node ...           只统计指定会话(--session 优先级更高)
//   ZCODE_USAGE_DB=/path/db.sqlite          指定 ZCode 数据库路径(默认按用户主目录解析)
// 多 agent(V2.4.0):默认只读 ZCode 自己的 usage 库,输出与 V2.3.0 完全一致;
// 在 ~/.zcode/tps-monitor.config.json 里配置 "providers": ["zcode","claude-code"]
// 等,可把 Claude Code / Codex / OpenCode / Cline 的本地记录一并纳入统计。
// 只读打开 WAL 数据库,不影响运行中的客户端。
// 数据层(只读连接、预编译语句、索引自检)在 lib/usage-db.mjs;多源归一化与合并在
// lib/collect-core.mjs 的聚合查询层;本文件只做作用域解析、格式化与 CLI。
// 统计口径、字段与输出文案和 V2.1.0 完全一致。

import { aggregateRate, aggregateTurn, agentStatus } from "./lib/collect-core.mjs";
import { RATE_ENV } from "./lib/usage-db.mjs";
import { isKnownProviderId } from "./lib/providers/index.mjs";

// 速率视图:sessionId 为 null 时取各源的当前会话;agent 限定单一数据源
function query(sessionId, opts = {}) {
  return aggregateRate({ sessionId: sessionId ?? null, agent: opts.agent ?? null });
}

function queryTurn(sessionId, opts = {}) {
  return aggregateTurn({
    sessionId: sessionId ?? null,
    agent: opts.agent ?? null,
    current: Boolean(opts.current),
  });
}

// 紧凑单位(注入行等需一眼扫读处):千以下原始、千~万一位小数 k、万~百万取整 k、百万以上一位小数 M
function fmtCompact(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 10_000) return Math.round(n / 1000) + "k";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

// 千分位精确数字(每轮输出与 CLI 明细):2,762
function fmtNum(n) {
  return n.toLocaleString("en-US");
}

function formatLine(r) {
  const l = r.latest;
  if (!l) return "暂无已完成的模型请求";
  const t = new Date(l.completedAt).toLocaleTimeString("zh-CN", { hour12: false });
  const parts = [
    // 采样发生在发送消息的瞬间,头条描述的是上一条已完成回复
    `⚡ ${l.tokPerSec ?? "-"} tok/s(上轮)`,
    `首字 ${l.ttftMs != null ? (l.ttftMs / 1000).toFixed(1) : "-"}s`,
    `输出 ${fmtNum(l.outputTokens)}${l.reasoningTokens ? `(+${fmtNum(l.reasoningTokens)} 思考)` : ""} tok / 生成 ${l.genMs != null ? (l.genMs / 1000).toFixed(1) : "-"}s`,
  ];
  if (r.session) {
    parts.push(`近${r.session.samples}次均 ${r.session.avg} / 峰 ${r.session.max}`);
    parts.push(`累计 ${fmtCompact(r.session.totalOutput + r.session.totalReasoning)} tok`);
  }
  parts.push(`⏱ ${t}`);
  return parts.join(" · ");
}

// Stop 钩子用:回复刚结束时的本轮即时行
function formatTurnLine(r) {
  const t = r.turn;
  if (!t) return "暂无本轮请求记录";
  const time = new Date(t.lastAt).toLocaleTimeString("zh-CN", { hour12: false });
  const parts = [
    // 采样发生在回复刚结束的瞬间,头条即本轮即时速率
    `⚡ ${t.tokPerSec ?? "-"} tok/s(本轮)`,
    `首字 ${t.ttftMs != null ? (t.ttftMs / 1000).toFixed(1) : "-"}s`,
    `输出 ${fmtNum(t.totalOutput)}${t.reasoningTokens ? `(+${fmtNum(t.reasoningTokens)} 思考)` : ""} tok / 生成 ${t.genMs > 0 ? (t.genMs / 1000).toFixed(1) : "-"}s`,
  ];
  if (t.requests > 1) parts.push(`${t.requests} 段 / 峰 ${t.peak ?? "-"}`);
  if (r.session) parts.push(`累计 ${fmtCompact(r.session.totalOutput + r.session.totalReasoning)} tok`);
  parts.push(`⏱ ${time}`);
  return parts.join(" · ");
}

// 多源明细:只有启用了一个以上数据源时才出现(默认单源时不打印,保持输出不变)
function formatSources(r) {
  if (!Array.isArray(r.sources)) return null;
  return r.sources
    .map((s) => {
      const cap = [];
      if (s.ok) {
        if (s.samples != null) cap.push(`${s.samples} 条样本`);
        if (s.sessionId) cap.push(`会话 ${String(s.sessionId).slice(0, 8)}…`);
        if (s.format) cap.push(s.format);
      } else if (s.reason) {
        cap.push(s.reason);
      }
      return `  ${s.ok ? "✅" : "⏭"} ${s.label}(${s.provider})${cap.length ? `: ${cap.join(" · ")}` : ""}`;
    })
    .join("\n");
}

// V2.5.0 聚合输出:多源时按数据源分组给出各自速率;
// 缺省(单 zcode)不打印整块,保持 V2.4.0 原格式。会话作用域与主查询一致:
// 显式 --session/环境变量时各源按该会话圈定(无数据的源如实显示),
// 未指定时各源解析自己的"当前会话"。故障隔离:单源读取失败只影响它那一行。
function formatPerProviderRates(r, scopeSession) {
  if (!Array.isArray(r.sources) || r.sources.length <= 1) return null;
  const lines = ["各源速率:"];
  for (const s of r.sources) {
    const label = `${s.label}(${s.provider})`;
    if (!s.ok) {
      lines.push(`  ⏭ ${label}: 不可用`);
      continue;
    }
    try {
      const v = query(scopeSession, { agent: s.provider });
      const l = v.latest;
      if (!l) {
        lines.push(`  · ${label}: 当前作用域无数据`);
        continue;
      }
      const seg = [
        `⚡ ${l.tokPerSec ?? "-"} tok/s`,
        `首字 ${l.ttftMs != null ? (l.ttftMs / 1000).toFixed(1) : "-"}s`,
        `输出 ${fmtNum(l.outputTokens)} tok`,
      ];
      if (v.session) seg.push(`请求 ${v.session.requests} 次`);
      lines.push(`  · ${label}: ${seg.join(" · ")}`);
    } catch (err) {
      lines.push(`  · ${label}: 读取失败(${err && err.message ? err.message : "未知错误"})`);
    }
  }
  return lines.join("\n");
}

// --- CLI ---
if (process.argv[1] && process.argv[1].endsWith("token-rate.mjs")) {
  const json = process.argv.includes("--json");
  const turnOnly = process.argv.includes("--turn");
  const current = process.argv.includes("--current");

  // --flag value(值不能是下一个 --flag)
  const argValue = (flag) => {
    const i = process.argv.indexOf(flag);
    if (i === -1) return null;
    const v = process.argv[i + 1];
    return v && !v.startsWith("--") ? v : null;
  };

  if (process.argv.includes("--agents")) {
    // 数据源清单:探测结果 + 数据格式 + 样本条数(全部本地只读)
    const rows = agentStatus().map((a) => ({
      provider: a.provider,
      label: a.label,
      available: a.ok,
      installed: a.installed,
      format: a.format,
      capabilities: a.capabilities,
      sessions: a.sessions,
      samples: a.samples,
      reason: a.reason,
      note: a.note,
    }));
    if (json) console.log(JSON.stringify(rows, null, 2));
    else {
      for (const a of rows) {
        console.log(`${a.available ? "✅" : "⏭"} ${a.label}(${a.provider}) · ${a.format}`);
        console.log(
          `    ${a.available ? `会话 ${a.sessions} 个 · 当前会话 ${a.samples} 条样本` : a.reason || "不可用"}`
        );
        if (a.note) console.log(`    备注:${a.note}`);
      }
    }
  } else {
    const agent = argValue("--agent");
    if (agent && !isKnownProviderId(agent)) {
      console.error(`未知的数据源:${agent}`);
      console.error(`可用:zcode / claude-code / codex / opencode / cline(用 --agents 查看探测结果)`);
      process.exitCode = 1;
    } else {
      // --session 优先于环境变量;两者都没有时按各源的"当前会话"解析
      const sid = argValue("--session") || process.env.ZCODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || null;
      const opts = { agent, current };
      const r = turnOnly ? queryTurn(sid, opts) : query(sid, opts);
      if (json) {
        // V2.5.0:多源时附每源视图(缺省单源不加字段,保持输出结构稳定)
        if (!turnOnly && Array.isArray(r.sources) && r.sources.length > 1) {
          const pp = {};
          for (const s of r.sources) {
            if (!s.ok) continue;
            try {
              const v = query(sid, { agent: s.provider });
              pp[s.provider] = {
                provider: s.provider,
                sessionId: v.sessionId,
                latest: v.latest,
                session: v.session,
              };
            } catch {}
          }
          r.perProvider = pp;
        }
        console.log(JSON.stringify(r, null, 2));
      } else if (turnOnly) {
        if (r.turn) console.log(formatTurnLine(r));
        // --current 且本问尚无数据:不输出任何行,调用方据此不显示统计(绝不回退到上一轮)
      } else {
        console.log(formatLine(r));
        const s = r.session;
        if (s) {
          // CLI 明细面向细读,全部千分位精确数字
          console.log(`会话累计:输出 ${fmtNum(s.totalOutput)}${s.totalReasoning ? `(+${fmtNum(s.totalReasoning)} 思考)` : ""} tok · 输入 ${fmtNum(s.totalInput)} tok(其中缓存读 ${fmtNum(s.totalCacheRead)}) · 请求 ${s.requests} 次`);
        }
        const src = formatSources(r);
        if (src) console.log(`数据源:\n${src}`);
        const rates = formatPerProviderRates(r, sid);
        if (rates) console.log(rates);
      }
    }
  }
}

export { query, queryTurn, formatLine, formatTurnLine, fmtCompact, fmtNum, RATE_ENV };
