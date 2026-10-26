// Provider 注册表(V2.4.0):把各客户端的只读适配收拢到一处。
// 纯 Node、零依赖;config.providers 只做「启用哪些源」的开关,缺省 ["zcode"]。

import { createZcodeProvider } from "./zcode.mjs";
import { createClaudeCodeProvider } from "./claude-code.mjs";
import { createCodexProvider } from "./codex.mjs";
import { createOpenCodeProvider } from "./opencode.mjs";
import { createClineProvider } from "./cline.mjs";

/** 默认只启用 ZCode 自己的库 —— 与 V2.3.0 行为完全一致。 */
export const DEFAULT_PROVIDER_IDS = ["zcode"];

export const PROVIDER_IDS = ["zcode", "claude-code", "codex", "opencode", "cline"];

const CREATORS = {
  zcode: createZcodeProvider,
  "claude-code": createClaudeCodeProvider,
  codex: createCodexProvider,
  opencode: createOpenCodeProvider,
  cline: createClineProvider,
};

export const PROVIDER_LABELS = {
  zcode: "ZCode",
  "claude-code": "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  cline: "Cline",
};

export const PROVIDER_CAPABILITIES = {
  zcode: { turnRate: true, ttft: true, sessionScope: true },
  "claude-code": { turnRate: true, ttft: false, sessionScope: true },
  codex: { turnRate: true, ttft: false, sessionScope: true },
  opencode: { turnRate: true, ttft: false, sessionScope: true },
  cline: { turnRate: true, ttft: false, sessionScope: true },
};

/** 数据源说明(README / doctor / 大屏共用,口径与合规声明只在这里说一次)。 */
export const PROVIDER_SOURCES = {
  zcode: "~/.zcode/cli/db/db.sqlite 的 model_usage 表(ZCode 自己记录的用量库)",
  "claude-code": "~/.claude/projects/**/*.jsonl 会话日志(逐条解析 usage 字段)",
  codex: "~/.codex/sessions/**.jsonl 会话记录(解析 token 计数字段)",
  opencode: "~/.local/share/opencode/storage/message 下的消息文件(版本相关只读适配)",
  cline: "编辑器 globalStorage 的 saoudrizwan.claude-dev/tasks 任务记录(版本相关只读适配)",
};

/** 常见笔误/别名的规范化映射。 */
const ALIASES = { claude: "claude-code", "z-code": "zcode" };

/** 规范化单个 id:返回 canonical id,不认识返回 null(不做回退,交由调用方决定)。 */
export function canonicalProviderId(id) {
  if (typeof id !== "string") return null;
  const key = id.trim().toLowerCase();
  if (!key) return null;
  return ALIASES[key] || (CREATORS[key] ? key : null);
}

/** 清洗用户配置:未知 id 丢弃、去重、保持顺序;空结果回退默认。 */
export function normalizeProviderIds(list) {
  if (!Array.isArray(list)) return [...DEFAULT_PROVIDER_IDS];
  const out = [];
  for (const raw of list) {
    const id = canonicalProviderId(raw);
    if (!id || out.includes(id)) continue;
    out.push(id);
  }
  return out.length ? out : [...DEFAULT_PROVIDER_IDS];
}

/** 从配置对象取启用列表:config.providers 优先,其次 env.TPS_PROVIDERS(逗号分隔)。 */
export function enabledProviderIds(cfg, env = process.env) {
  const fromCfg = Array.isArray(cfg?.providers) ? cfg.providers : null;
  if (fromCfg) return normalizeProviderIds(fromCfg);
  const fromEnv = typeof env?.TPS_PROVIDERS === "string" ? env.TPS_PROVIDERS.split(",") : null;
  if (fromEnv) return normalizeProviderIds(fromEnv);
  return [...DEFAULT_PROVIDER_IDS];
}

/**
 * 创建单个 Provider。id 未知时返回 null(调用方据此给出「未知 provider」提示)。
 * 构造异常不在这里吞掉:由调用方的 try/catch 兜底并记入 sources,这样单个源的
 * 故障仍会被明确报出来,而不是伪装成「该源不存在」。
 */
export function createProvider(id, opts = {}) {
  const create = CREATORS[id];
  if (!create) return null;
  return create(opts);
}

export function createProviders(ids, opts = {}) {
  const out = [];
  for (const id of normalizeProviderIds(ids)) {
    const p = createProvider(id, opts);
    if (p) out.push(p);
  }
  return out;
}

export function isKnownProviderId(id) {
  return typeof id === "string" && Boolean(CREATORS[id]);
}
