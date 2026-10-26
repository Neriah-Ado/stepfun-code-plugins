/**
 * Wire contract between the Step Code extension (producer) and the Go gateway
 * (consumer). One JSON object per line on the child process stdin.
 *
 * The extension never interprets topology; it forwards facts. All state
 * reconstruction lives on the Go side so the terminal process stays cheap.
 */

/** Lifecycle of a single orchestration node. */
export type NodeStatus = "pending" | "running" | "done" | "failed" | "cancelled";

/**
 * Fan-out shape, mirroring Step Code's `subagent` tool modes.
 * `chain` nodes are ordered by `chainIndex`; `parallel` siblings share a bus.
 */
export type OrchestrationMode = "single" | "parallel" | "chain";

/**
 * Normalised view of Step Code's `WorkflowProgress` snapshot, as delivered in
 * the `details` payload of `tool_execution_update`.
 */
export interface ProgressSnapshot {
	running: number;
	queued: number;
	completed: number;
	total: number;
	failures: number;
	cacheHits: number;
	cancellations: number;
	tokenSpend: number;
	phase?: string;
}

/**
 * One child agent inside a fan-out. Child agents run in separate processes, so
 * these rows are the only per-agent detail the main process can observe.
 */
export interface AgentRow {
	id?: string;
	label: string;
	summary?: string;
	status?: string;
	tokens?: number;
}

/** Common envelope: every message carries a monotonic client timestamp. */
interface Envelope {
	ts: number;
}

/** Session opened or resumed. Sent once per session, before any tool traffic. */
export interface SessionMessage extends Envelope {
	kind: "session";
	sessionId: string;
	cwd: string;
	model?: string;
}

/** The main agent's turn loop started / ended. */
export interface AgentMessage extends Envelope {
	kind: "agent_start" | "agent_end";
}

/** Whole run settled: no retry, compaction, or queued continuation will follow. */
export interface SettledMessage extends Envelope {
	kind: "agent_settled";
}

/** A tool is about to execute. */
export interface ToolCallMessage extends Envelope {
	kind: "tool_call";
	toolCallId: string;
	toolName: string;
	/** The orchestrating call this tool belongs to, or null for top-level work. */
	parentId: string | null;
	/** Present only for orchestration tools (`subagent` / `workflow`). */
	mode?: OrchestrationMode;
	label?: string;
	summary?: string;
	args: Record<string, unknown>;
}

/** Streaming progress for an in-flight tool, notably `workflow` fan-out. */
export interface ToolUpdateMessage extends Envelope {
	kind: "tool_update";
	toolCallId: string;
	toolName: string;
	progress: ProgressSnapshot;
	/** Short human-readable line from the host, when provided. */
	text?: string;
	/** Per-agent breakdown, when the host exposes one. */
	agents?: AgentRow[];
}

/** A tool finished. */
export interface ToolResultMessage extends Envelope {
	kind: "tool_result";
	toolCallId: string;
	toolName: string;
	isError: boolean;
	durationMs: number;
	tokens?: { input: number; output: number };
}

/** Assistant/user message boundary or delta. Used for activity indication only. */
export interface MessageMessage extends Envelope {
	kind: "message";
	phase: "start" | "update" | "end";
	role?: string;
}

/** The extension host is tearing down; the gateway should exit. */
export interface ShutdownMessage extends Envelope {
	kind: "shutdown";
}

export type BridgeMessage =
	| SessionMessage
	| AgentMessage
	| SettledMessage
	| ToolCallMessage
	| ToolUpdateMessage
	| ToolResultMessage
	| MessageMessage
	| ConversationHistoryMessage
	| ConversationEvent
	| ProfilesEvent
	| ProfileStatusEvent
	| UsageEvent
	| ActionAckMessage
	| ShutdownMessage;

/**
 * Tools whose execution fans out into child agents. `subagent` covers the
 * single/parallel/chain modes; `workflow` covers scripted orchestration runs.
 */
export const ORCHESTRATION_TOOLS: readonly string[] = ["subagent", "workflow"];

export function isOrchestrationTool(toolName: string): boolean {
	return ORCHESTRATION_TOOLS.includes(toolName);
}

// ------------------------------------------------------------- conversation

/** One chat message mirrored to the browser. */
export interface ConversationMessage {
	id: string;
	role: "user" | "assistant";
	text: string;
	at: number;
	/** True while the assistant reply is still streaming. */
	streaming?: boolean;
}

/** Full replay, sent on session start so a freshly opened tab has context. */
export interface ConversationHistoryMessage extends Envelope {
	kind: "conversation_history";
	messages: ConversationMessage[];
}

/** A single message added or updated. */
export interface ConversationEvent extends Envelope {
	kind: "conversation";
	message: ConversationMessage;
}

/** Acknowledgement for a gateway-originated action. */
export interface ActionAckMessage extends Envelope {
	kind: "action_ack";
	requestId: string;
	ok: boolean;
	error?: string;
}

/**
 * One stored API configuration. The plaintext key stays inside the gateway and
 * the extension process — it is never mirrored to the browser.
 */
export interface ApiProfile {
	id: string;
	name: string;
	/** Provider id the credential applies to, e.g. "step" or "anthropic". */
	provider: string;
	apiKey: string;
	/** Optional endpoint override, for proxy or gateway setups. */
	baseUrl?: string;
}

/** Credential health as surfaced in the picker. */
export type ProfileState = "ok" | "missing" | "suspicious" | "rejected";

/**
 * Masked projection sent to the browser. `keyHint` is display-only, e.g.
 * "sk-…4f2a" — never the key itself.
 */
export interface ProfileView {
	id: string;
	name: string;
	provider: string;
	active: boolean;
	state: ProfileState;
	keyHint: string;
	baseUrl?: string;
}

/** Full profile roster, replayed on connect and after every mutation. */
export interface ProfilesEvent extends Envelope {
	kind: "profiles";
	profiles: ProfileView[];
	activeId: string | null;
}

/**
 * Credential health update for the active profile. Emitted when the provider
 * itself rejects a request, so no active probing of the endpoint is needed.
 */
export interface ProfileStatusEvent extends Envelope {
	kind: "profile_status";
	/** Human-readable authentication error, or null to clear it. */
	lastError: string | null;
}

/**
 * Per-turn timing and throughput, mirroring the metric row that
 * stepfun-usage-monitor prints after each reply.
 */
export interface TurnMetrics {
	/** Output tokens attributed to this turn. */
	output: number;
	/** Time to first token, in ms — null when no delta ever arrived. */
	ttftMs: number | null;
	/** Pure generation time in ms: first delta to last delta. */
	generationMs: number | null;
	/** Output tokens per second over the generation window. */
	rate: number | null;
}

/** Context-window consumption plus throughput for the active session. */
export interface UsageSnapshot {
	/** Tokens currently occupying the context window. */
	used: number;
	/** The model's context window, when the host reports one. */
	limit: number | null;
	/** Cumulative output tokens for this session, not window-limited. */
	sessionOutput: number;
	/** Sliding average rate over the last few turns. */
	recentRate: number | null;
	/** Most recent turn, or null before the first reply lands. */
	turn: TurnMetrics | null;
	/** Sample time. */
	at: number;
}

/**
 * Context usage update. Sent when a response lands rather than continuously —
 * the number only moves at that point, and the panel renders it as a quiet
 * one-line gauge above the composer.
 */
export interface UsageEvent extends Envelope {
	kind: "usage";
	usage: UsageSnapshot;
}

/**
 * A command travelling from the browser, through gateway stdout, back into the
 * extension. This is the only reverse channel in the system — everything else
 * flows one way.
 */
export interface BridgeAction {
	type: "action";
	action: "send" | "apply_profile";
	requestId: string;
	text?: string;
	deliverAs?: "steer" | "followUp";
	/** Present for apply_profile only. */
	profile?: ApiProfile;
}
