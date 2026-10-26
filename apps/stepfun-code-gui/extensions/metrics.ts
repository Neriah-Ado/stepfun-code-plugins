/**
 * Turn-level throughput tracking.
 *
 * Mirrors the metric row that stepfun-usage-monitor prints under each reply:
 * time-to-first-token, pure generation window, and output tokens per second.
 *
 * All timing comes from event arrival timestamps, which is the only clock the
 * extension layer has. That makes TTFT an upper bound (it includes IPC latency)
 * and the generation window slightly generous — acceptable for a gauge, and the
 * sample filter below keeps obviously bogus windows out of the average.
 */
import type { TurnMetrics } from "./types.ts";

/** Sliding window size for the recent-average rate. */
const WINDOW = 5;
/** Windows outside this range are noise, not throughput. */
const MIN_GENERATION_MS = 200;
const MAX_GENERATION_MS = 60 * 60 * 1000;

export interface TurnTracker {
	/** Start a turn: called on message_start for an assistant reply. */
	begin(): void;
	/** Record that a text delta arrived. */
	markDelta(): void;
	/** Close the turn and compute its metrics. */
	finish(outputTokens: number | undefined): TurnMetrics | null;
	/** Mean rate over the last few measured turns. */
	recentRate(): number | null;
	/** Forget everything, e.g. on a new session. */
	reset(): void;
}

export function createTurnTracker(): TurnTracker {
	let startedAt = 0;
	let firstDeltaAt = 0;
	let lastDeltaAt = 0;
	const rates: number[] = [];

	function begin(): void {
		startedAt = Date.now();
		firstDeltaAt = 0;
		lastDeltaAt = 0;
	}

	function markDelta(): void {
		const now = Date.now();
		if (!firstDeltaAt) firstDeltaAt = now;
		lastDeltaAt = now;
	}

	function finish(outputTokens: number | undefined): TurnMetrics | null {
		// No delta at all means nothing was generated in this turn.
		if (!firstDeltaAt) return null;

		const generationMs = lastDeltaAt - firstDeltaAt;
		const output = Number(outputTokens) || 0;

		let rate: number | null = null;
		if (output > 0 && generationMs >= MIN_GENERATION_MS && generationMs < MAX_GENERATION_MS) {
			rate = (output / generationMs) * 1000;
			rates.push(rate);
			if (rates.length > WINDOW) rates.shift();
		}

		const metrics: TurnMetrics = {
			output,
			// Absent a start mark we cannot separate queueing from generation.
			ttftMs: startedAt > 0 && firstDeltaAt >= startedAt ? firstDeltaAt - startedAt : null,
			// A single delta spans nothing; report unknown rather than a fake divide.
			generationMs: generationMs > 0 ? generationMs : null,
			rate,
		};

		// Clear the window. Without this, a message_end arriving with no matching
		// message_start would reuse these timestamps and report a bogus duration
		// measured from a previous turn.
		startedAt = 0;
		firstDeltaAt = 0;
		lastDeltaAt = 0;

		return metrics;
	}

	function recentRate(): number | null {
		if (rates.length === 0) return null;

		let sum = 0;
		for (const value of rates) sum += value;
		return sum / rates.length;
	}

	function reset(): void {
		startedAt = 0;
		firstDeltaAt = 0;
		lastDeltaAt = 0;
		rates.length = 0;
	}

	return { begin, markDelta, finish, recentRate, reset };
}
