/**
 * step-orchestra — Step Code extension entry point.
 *
 * This file is intentionally thin. It subscribes to host events, normalises
 * them into the wire contract, and hands them to the Go gateway. All topology
 * reconstruction and presentation lives downstream so the terminal process
 * carries no rendering cost.
 *
 * Registration path: the package declares `extensions/index.ts`, and the
 * directory is also named `extensions/`, which is Step Code's convention-based
 * discovery path when no manifest field is honoured.
 */

import { Bridge } from "./bridge.ts";
import { createConversation } from "./conversation.ts";
import { createTurnTracker } from "./metrics.ts";
import { applyProfile } from "./profiles.ts";
import { extractProgress, normalizeMode } from "./progress.ts";
import { digestSummary, firstString, redactArgs } from "./redact.ts";
import {
	isOrchestrationTool,
	type BridgeAction,
	type BridgeMessage,
	type OrchestrationMode,
	type ProgressSnapshot,
	type ToolCallMessage,
	type ToolResultMessage,
	type ToolUpdateMessage,
	type UsageEvent,
} from "./types.ts";

/** Synthetic root: every tool observed in this process belongs to the main agent. */
const ROOT_ID = "main";

/**
 * Minimal structural view of Step Code's `ExtensionAPI`.
 *
 * Declared locally rather than imported from `@step-harness/coding-agent`:
 * that package is private and not resolvable from an installed extension.
 * TypeScript's structural typing keeps this assignment-compatible with the
 * real interface.
 */
interface HostEventContext {
	cwd?: string;
	model?: { id?: string; name?: string; contextWindow?: number };
	/** False while the host is processing a run, retry, or compaction. */
	isIdle?: () => boolean;
	/** Current context-window consumption, when the host exposes it. */
	getContextUsage?: () => { tokens?: number } | undefined;
	/** Present on the real host; the only place session state is exposed. */
	sessionManager?: {
		getSessionId?: () => string;
		getBranch?: () => unknown[];
		buildContextEntries?: () => unknown[];
	};
}

interface StepExtensionAPI {
	on(event: string, handler: (event: unknown, context: HostEventContext) => unknown): void;
	registerCommand?(name: string, options: Record<string, unknown>): void;
	/** Sends a real user message, as if typed. Throws while the agent is busy. */
	sendUserMessage?(
		content: string,
		options?: { deliverAs?: "steer" | "followUp"; expandPromptTemplates?: boolean },
	): void;
}

interface TrackedCall {
	toolName: string;
	startedAt: number;
}

const EMPTY_PROGRESS: ProgressSnapshot = {
	running: 0,
	queued: 0,
	completed: 0,
	total: 0,
	failures: 0,
	cacheHits: 0,
	cancellations: 0,
	tokenSpend: 0,
};

export default function stepOrchestra(pi: StepExtensionAPI): void {
	const bridge = new Bridge();
	const tracked = new Map<string, TrackedCall>();

	const emit = (message: BridgeMessage): void => bridge.send(message);

	// ------------------------------------------------- progress update coalescing
	//
	// The host can emit `tool_execution_update` far faster than any observer
	// needs it: each frame carries a full progress snapshot, so only the newest
	// per tool call matters. A short trailing window keeps the panel live while
	// bounding the stdin/SSE/DOM pipeline to one frame per tool per window.
	const UPDATE_COALESCE_MS = 60;
	const pendingUpdates = new Map<
		string,
		{ message: ToolUpdateMessage; timer: ReturnType<typeof setTimeout> }
	>();

	function flushToolUpdate(toolCallId: string): void {
		const pending = pendingUpdates.get(toolCallId);
		if (!pending) return;
		pendingUpdates.delete(toolCallId);
		emit(pending.message);
	}

	function emitToolUpdate(message: ToolUpdateMessage): void {
		const pending = pendingUpdates.get(message.toolCallId);
		if (pending) clearTimeout(pending.timer);

		const timer = setTimeout(() => flushToolUpdate(message.toolCallId), UPDATE_COALESCE_MS);
		// Never hold the host process open just to flush a progress frame.
		(timer as unknown as { unref?: () => void }).unref?.();

		pendingUpdates.set(message.toolCallId, { message, timer });
	}

	// The conversation mirror needs `ctx.isIdle()` to pick a delivery mode, but
	// actions arrive outside any event handler. Cache the newest context seen —
	// `ctx.isIdle` is a live method call, so a stale object still reports truth.
	let latestContext: HostEventContext | null = null;

	const conversation = createConversation({
		emit,
		sendUserMessage: (text, deliverAs) => {
			if (deliverAs) {
				pi.sendUserMessage?.(text, { deliverAs });
				return;
			}
			pi.sendUserMessage?.(text);
		},
		isIdle: () => latestContext?.isIdle?.() ?? true,
	});

	// Throughput tracking behind the metric row under the composer.
	const tracker = createTurnTracker();
	let sessionOutput = 0;

	// State a re-spawned gateway needs to look alive again: the session header,
	// the history source, and the newest usage reading.
	let lastSession: BridgeMessage | null = null;
	let lastHistory: readonly unknown[] | null = null;
	let lastUsage: UsageEvent["usage"] | null = null;

	// The only reverse channel: browser → gateway stdout → here.
	bridge.onAction((action) => {
		if (action.action === "apply_profile") {
			applyProfileAction(action);
			return;
		}
		conversation.handleAction(action);
	});

	// A crashed gateway takes its in-memory state with it. Profiles reload from
	// disk on their own; everything else is replayed here.
	bridge.onRestart(() => {
		if (lastSession) emit(lastSession);
		if (lastHistory) conversation.hydrate(lastHistory);
		if (lastUsage) emit({ kind: "usage", ts: Date.now(), usage: lastUsage });
	});

	// Bring the gateway up eagerly so the panel URL exists before the first turn.
	bridge.start();

	// --------------------------------------------------------------- session

	pi.on("session_start", (event, context) => {
		const record = asRecord(event);

		// `session_start` carries reasons (startup/reload/new/resume/fork) but no
		// id of its own — the host exposes it through the session manager. Event
		// fields are kept as a fallback for other host versions.
		const fromManager =
			typeof context?.sessionManager?.getSessionId === "function"
				? context.sessionManager.getSessionId()
				: undefined;

		const sessionMessage: BridgeMessage = {
			kind: "session",
			ts: Date.now(),
			sessionId: firstString(fromManager, record?.sessionId, record?.id) || "session",
			cwd: firstString(context?.cwd, record?.cwd) || process.cwd(),
			model: modelName(context),
		};
		lastSession = sessionMessage;
		emit(sessionMessage);

		latestContext = context ?? latestContext;

		// A new session starts its throughput history over.
		tracker.reset();
		sessionOutput = 0;

		// Replay prior turns so a freshly opened panel is not blank. A throwing
		// host accessor must not break the session_start dispatch.
		const manager = context?.sessionManager;
		try {
			const entries = manager?.buildContextEntries?.() ?? manager?.getBranch?.();
			if (Array.isArray(entries)) {
				lastHistory = entries;
				conversation.hydrate(entries);
			}
		} catch (error) {
			process.stderr.write(`[step-orchestra] history replay failed: ${String(error)}\n`);
		}
	});

	pi.on("session_shutdown", () => {
		bridge.dispose();
	});

	// ----------------------------------------------------------------- agent

	pi.on("agent_start", (_event, context) => {
		latestContext = context ?? latestContext;
		emit({ kind: "agent_start", ts: Date.now() });
	});
	pi.on("agent_end", (_event, context) => {
		latestContext = context ?? latestContext;
		emit({ kind: "agent_end", ts: Date.now() });
	});
	pi.on("agent_settled", (_event, context) => {
		latestContext = context ?? latestContext;
		emit({ kind: "agent_settled", ts: Date.now() });
	});

	// Credential health comes from real traffic: a rejected key surfaces as
	// 401/403 here, so nothing has to probe the endpoint on a timer.
	pi.on("after_provider_response", (event) => {
		const status = Number(asRecord(event)?.status);
		if (status !== 401 && status !== 403) return;
		emit({
			kind: "profile_status",
			ts: Date.now(),
			lastError: `凭据被拒绝（HTTP ${status}）`,
		});
	});

	// -------------------------------------------------------------- messages

	pi.on("message_start", (event, context) => {
		latestContext = context ?? latestContext;

		const role = roleOf(event);
		if (role === "assistant") tracker.begin();

		emit({ kind: "message", phase: "start", ts: Date.now(), role });
		conversation.recordMessage(event);
	});

	// `text_delta` is what drives the streaming chat view. Thinking and
	// tool-call deltas are ignored here: they already surface as tool nodes.
	pi.on("message_update", (event, context) => {
		latestContext = context ?? latestContext;

		// Only visible text counts toward generation speed — it is what the user
		// actually waited to read.
		if (isTextDelta(event)) tracker.markDelta();

		conversation.applyDelta(event);
	});

	pi.on("message_end", (event, context) => {
		latestContext = context ?? latestContext;

		const role = roleOf(event);
		emit({ kind: "message", phase: "end", ts: Date.now(), role });
		conversation.finalizeMessage(event);

		// The numbers only move when a response lands, so this is the natural
		// cadence — no polling, no per-token churn.
		if (role === "assistant") reportUsage(context, outputTokensOf(event));
	});

	// ----------------------------------------------------------------- tools

	pi.on("tool_call", (event) => {
		const record = asRecord(event);
		const toolCallId = firstString(record?.toolCallId);
		if (!toolCallId) return;

		const toolName = firstString(record?.toolName) || "unknown";
		const input = asRecord(record?.input) ?? {};

		tracked.set(toolCallId, { toolName, startedAt: Date.now() });

		const message: ToolCallMessage = {
			kind: "tool_call",
			ts: Date.now(),
			toolCallId,
			toolName,
			parentId: ROOT_ID,
			args: redactArgs(input),
		};

		if (isOrchestrationTool(toolName)) {
			message.mode = inferMode(input);
			message.label = firstString(input.label, input.agent, input.role, input.name) || toolName;
			message.summary = summarizeInput(input);
		}

		emit(message);
	});

	pi.on("tool_execution_update", (event) => {
		const record = asRecord(event);
		const toolCallId = firstString(record?.toolCallId);
		if (!toolCallId) return;

		const extracted = extractProgress(record);
		// Updates that carry neither counters nor agent rows are of no interest.
		if (!extracted.progress && !extracted.agents) return;

		emitToolUpdate({
			kind: "tool_update",
			ts: Date.now(),
			toolCallId,
			toolName: firstString(record?.toolName) || tracked.get(toolCallId)?.toolName || "unknown",
			progress: extracted.progress ?? EMPTY_PROGRESS,
			text: extracted.text,
			agents: extracted.agents,
		});
	});

	pi.on("tool_result", (event) => {
		const record = asRecord(event);
		const toolCallId = firstString(record?.toolCallId);
		if (!toolCallId) return;

		const call = tracked.get(toolCallId);
		tracked.delete(toolCallId);

		// The terminal frame must not overtake a coalesced progress snapshot.
		flushToolUpdate(toolCallId);

		const usage = asRecord(record?.usage);
		const inputTokens = numberOr(usage?.input, usage?.inputTokens, usage?.promptTokens);
		const outputTokens = numberOr(usage?.output, usage?.outputTokens, usage?.completionTokens);

		const message: ToolResultMessage = {
			kind: "tool_result",
			ts: Date.now(),
			toolCallId,
			toolName: firstString(record?.toolName) || call?.toolName || "unknown",
			isError: record?.isError === true,
			durationMs: call ? Date.now() - call.startedAt : 0,
		};

		if (inputTokens !== undefined || outputTokens !== undefined) {
			message.tokens = { input: inputTokens ?? 0, output: outputTokens ?? 0 };
		}

		emit(message);
	});

	// --------------------------------------------------------------- command

	pi.registerCommand?.("orchestra", {
		description: "Print the live orchestration panel URL",
		handler: (): void => {
			const url = bridge.getPanelUrl();
			if (url) {
				process.stderr.write(`[step-orchestra] panel: ${url}\n`);
				return;
			}
			const reason = bridge.getFailureReason();
			process.stderr.write(
				`[step-orchestra] panel not ready${reason ? `: ${reason}` : ""}\n` +
					"[step-orchestra] 一键方案:双击仓库根目录的 start.bat(Windows)/ start.sh(macOS/Linux),或运行 npm start。\n" +
					"[step-orchestra] One-click: run start.bat / start.sh or npm start from the repo root.\n"
			);
		},
	});

	/**
	 * Push a stored profile into the provider registry. Reached from the reverse
	 * channel; takes effect on the next request without a reload.
	 */
	function applyProfileAction(action: BridgeAction): void {
		const profile = action.profile;
		if (!profile) {
			emit({
				kind: "action_ack",
				ts: Date.now(),
				requestId: action.requestId,
				ok: false,
				error: "缺少配置内容",
			});
			return;
		}

		const result = applyProfile(pi, profile);
		emit({
			kind: "action_ack",
			ts: Date.now(),
			requestId: action.requestId,
			ok: result.ok,
			error: result.error,
		});
	}

	/**
	 * Publish context-window consumption.
	 *
	 * Fields are read defensively: the host documents `tokens` on ContextUsage,
	 * and the ceiling comes from the active model's `contextWindow`. If neither
	 * is available the panel simply keeps its previous reading rather than
	 * showing a misleading zero.
	 */
	function reportUsage(context: HostEventContext | null, outputTokens?: number): void {
		if (!context) return;

		const usage = context.getContextUsage?.();
		const used = numberOr(usage?.tokens);
		const limit = numberOr(context.model?.contextWindow);

		const turn = tracker.finish(outputTokens);
		if (turn && turn.output > 0) sessionOutput += turn.output;

		// With no reading at all there is nothing worth pushing.
		if (used === undefined && limit === undefined && !turn) return;

		const usageEvent: UsageEvent = {
			kind: "usage",
			ts: Date.now(),
			usage: {
				used: used ?? 0,
				limit: limit ?? null,
				sessionOutput,
				recentRate: tracker.recentRate(),
				turn,
				at: Date.now(),
			},
		};
		lastUsage = usageEvent.usage;
		emit(usageEvent);
	}
}

// ------------------------------------------------------------------ helpers

function asRecord(value: unknown): Record<string, any> | null {
	if (value === null || typeof value !== "object") return null;
	return value as Record<string, any>;
}

/**
 * Infer the fan-out shape from argument keys. The `subagent` tool signals its
 * mode structurally rather than through an explicit field:
 *   single   -> { agent, task }
 *   parallel -> { tasks: [{ agent, task }, ...] }
 *   chain    -> { chain: [{ agent, task }, ...] }
 */
function inferMode(input: Record<string, any>): OrchestrationMode | undefined {
	const explicit = normalizeMode(input.mode);
	if (explicit) return explicit;
	if (Array.isArray(input.chain)) return "chain";
	if (Array.isArray(input.tasks)) return "parallel";
	if (typeof input.agent === "string" || typeof input.task === "string") return "single";
	return undefined;
}

/** Collapse task arrays into a short arrow chain for the card subtitle. */
function summarizeInput(input: Record<string, any>): string {
	const direct = digestSummary(
		firstString(input.task, input.prompt, input.summary, input.instruction, input.description),
	);
	if (direct) return direct;

	const items = Array.isArray(input.tasks)
		? input.tasks
		: Array.isArray(input.chain)
			? input.chain
			: null;
	if (!items || items.length === 0) return "";

	const parts: string[] = [];
	for (const item of items.slice(0, 6)) {
		const part = firstString(item?.agent, item?.task);
		if (part) parts.push(part);
	}
	return digestSummary(parts.join(" → "));
}

function numberOr(...candidates: unknown[]): number | undefined {
	for (const candidate of candidates) {
		if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
	}
	return undefined;
}

function modelName(context: HostEventContext | undefined): string | undefined {
	const model = context?.model;
	if (!model) return undefined;
	return firstString(model.name, model.id) || undefined;
}

function roleOf(event: unknown): string | undefined {
	const record = asRecord(event);
	const message = asRecord(record?.message);
	return firstString(message?.role, record?.role) || undefined;
}

/** True for a visible-text streaming delta, as opposed to thinking or a tool call. */
function isTextDelta(event: unknown): boolean {
	const streamEvent = asRecord(asRecord(event)?.assistantMessageEvent);
	return streamEvent?.type === "text_delta";
}

/** Pull output tokens out of a finalized message's usage block. */
function outputTokensOf(event: unknown): number | undefined {
	const message = asRecord(asRecord(event)?.message);
	const usage = asRecord(message?.usage);
	return numberOr(usage?.output, usage?.outputTokens, usage?.completionTokens);
}
