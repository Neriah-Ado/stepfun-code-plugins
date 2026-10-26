/**
 * Defensive reader for the host's progress payload.
 *
 * `tool_execution_update` carries a `details` object whose exact shape follows
 * Step Code's internal `WorkflowProgress`. Field names are additionally aliased
 * here so a host rename degrades to a partial reading rather than a blank panel.
 */
import type { AgentRow, ProgressSnapshot } from "./types.ts";

/** Field aliases per counter, in priority order. */
const COUNTER_ALIASES: Record<keyof Omit<ProgressSnapshot, "phase">, readonly string[]> = {
	running: ["running", "runningCount", "active", "activeCount"],
	queued: ["queued", "queuedCount", "pending", "waiting", "waitingCount"],
	completed: ["completed", "completedCount", "done", "doneCount", "finished", "settled"],
	total: ["total", "totalAgents", "totalCount", "count", "agents"],
	failures: ["failures", "failureCount", "failed", "failedCount", "errors", "errorCount"],
	cacheHits: ["cacheHits", "cacheHitCount", "cached", "reused"],
	cancellations: ["cancellations", "cancellationCount", "cancelled", "cancelledCount", "aborted"],
	tokenSpend: ["tokenSpend", "tokensSpent", "tokensUsed", "tokens", "spend", "usage"],
};

const PHASE_ALIASES = ["phase", "currentPhase", "stage", "step"] as const;
const TEXT_ALIASES = ["text", "message", "statusLine", "label", "title"] as const;

/**
 * Nested containers the real snapshot may be wrapped in.
 *
 * `partialResult` is the field Step Code 0.1.1 uses on `tool_execution_update`;
 * `details` is what the 0.84.x line used. Both are accepted so the panel works
 * across host versions.
 */
const WRAPPER_KEYS = [
	"partialResult",
	"progress",
	"workflowProgress",
	"snapshot",
	"details",
	"update",
	"value",
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function readNumber(source: Record<string, unknown>, keys: readonly string[]): number | undefined {
	for (const key of keys) {
		const value = source[key];
		if (typeof value === "number" && Number.isFinite(value)) return value;
		if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
			return Number(value);
		}
	}
	return undefined;
}

function readString(source: Record<string, unknown>, keys: readonly string[]): string | undefined {
	for (const key of keys) {
		const value = source[key];
		if (typeof value === "string" && value.trim().length > 0) return value.trim();
	}
	return undefined;
}

/** Walk one level into known wrappers until counters are found. */
function locateCounters(raw: unknown): Record<string, unknown> | null {
	let current = asRecord(raw);
	if (!current) return null;

	for (let hop = 0; hop < 3; hop += 1) {
		const probe = readNumber(current, COUNTER_ALIASES.running);
		if (probe !== undefined) return current;

		let descended: Record<string, unknown> | null = null;
		for (const key of WRAPPER_KEYS) {
			const nested = asRecord(current[key]);
			if (nested) {
				descended = nested;
				break;
			}
		}
		if (!descended) break;
		current = descended;
	}
	return current;
}

/** Containers that may hold the per-agent list. */
const AGENT_LIST_ALIASES = ["agents", "tasks", "children", "rows", "items", "childAgents"] as const;

const AGENT_LABEL_ALIASES = ["label", "name", "title", "id"] as const;
const AGENT_ID_ALIASES = ["id", "agentId", "callId", "taskId"] as const;
const AGENT_SUMMARY_ALIASES = ["task", "summary", "prompt", "description", "instruction"] as const;
const AGENT_STATUS_ALIASES = ["status", "state", "phase", "lifecycle"] as const;
const AGENT_TOKEN_ALIASES = ["tokens", "tokenSpend", "usage", "totalTokens", "spend"] as const;

/** Max rows mirrored to the browser per snapshot; the panel caps its own too. */
const MAX_AGENT_ROWS = 200;

function readAgentRows(source: Record<string, unknown>): AgentRow[] | undefined {
	for (const key of AGENT_LIST_ALIASES) {
		const raw = source[key];
		if (raw === null || raw === undefined) continue;

		let items: unknown[];
		if (Array.isArray(raw)) {
			items = raw;
		} else {
			const record = asRecord(raw);
			if (!record) continue;
			// Object-keyed form: the key is usually the agent id.
			items = Object.entries(record).map(([id, value]) => {
				const inner = asRecord(value);
				return inner ? { id, ...inner } : { id, label: String(value) };
			});
		}
		if (items.length === 0) continue;

		const rows: AgentRow[] = [];
		for (const item of items.slice(0, MAX_AGENT_ROWS)) {
			const record = asRecord(item);
			if (!record) continue;

			const label = readString(record, AGENT_LABEL_ALIASES) ?? `agent-${rows.length + 1}`;
			const row: AgentRow = { label };

			const id = readString(record, AGENT_ID_ALIASES);
			if (id) row.id = id;

			const summary = readString(record, AGENT_SUMMARY_ALIASES);
			if (summary) row.summary = summary.slice(0, 200);

			const status = readString(record, AGENT_STATUS_ALIASES);
			if (status) row.status = status;

			const tokens = readNumber(record, AGENT_TOKEN_ALIASES);
			if (tokens !== undefined) row.tokens = tokens;

			rows.push(row);
		}
		if (rows.length > 0) return rows;
	}
	return undefined;
}

export interface ExtractedProgress {
	progress: ProgressSnapshot | null;
	text?: string;
	/** Per-agent breakdown, when the payload carries one. */
	agents?: AgentRow[];
}

/** Pull a normalised snapshot out of an arbitrary update payload. */
export function extractProgress(raw: unknown): ExtractedProgress {
	const source = locateCounters(raw);
	if (!source) return { progress: null };

	const running = readNumber(source, COUNTER_ALIASES.running);
	const queued = readNumber(source, COUNTER_ALIASES.queued);
	const completed = readNumber(source, COUNTER_ALIASES.completed);
	const total = readNumber(source, COUNTER_ALIASES.total);

	// Without at least one of these the payload is not a fan-out snapshot.
	if (running === undefined && queued === undefined && completed === undefined && total === undefined) {
		const text = readString(asRecord(raw) ?? {}, TEXT_ALIASES);
		return { progress: null, text };
	}

	const progress: ProgressSnapshot = {
		running: running ?? 0,
		queued: queued ?? 0,
		completed: completed ?? 0,
		total: total ?? (running ?? 0) + (queued ?? 0) + (completed ?? 0),
		failures: readNumber(source, COUNTER_ALIASES.failures) ?? 0,
		cacheHits: readNumber(source, COUNTER_ALIASES.cacheHits) ?? 0,
		cancellations: readNumber(source, COUNTER_ALIASES.cancellations) ?? 0,
		tokenSpend: readNumber(source, COUNTER_ALIASES.tokenSpend) ?? 0,
	};

	const phase = readString(source, PHASE_ALIASES);
	if (phase) progress.phase = phase;

	// Counters and agent rows can sit at different depths, so fall back to the
	// original payload when the located container carries no agent list.
	const agents = readAgentRows(source) ?? readAgentRows(asRecord(raw) ?? {});

	const extracted: ExtractedProgress = { progress, text: readString(source, TEXT_ALIASES) };
	if (agents) extracted.agents = agents;
	return extracted;
}

/** Normalise a fan-out mode token coming from tool arguments. */
export function normalizeMode(value: unknown): "single" | "parallel" | "chain" | undefined {
	if (typeof value !== "string") return undefined;
	const token = value.trim().toLowerCase();
	return token === "single" || token === "parallel" || token === "chain" ? token : undefined;
}
