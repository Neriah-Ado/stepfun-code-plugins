#!/usr/bin/env node
/**
 * Regression checks for the host-payload reader.
 *
 * Exists because the 0.1.1 host nests progress under `partialResult` while the
 * 0.84.x line used `details`. Both shapes, plus field aliases and the agent-row
 * extraction, are pinned here so a host change fails loudly instead of silently
 * blanking the panel.
 *
 * Usage: node tools/test-progress.mjs
 */
import { extractProgress, normalizeMode } from "../extensions/progress.ts";

const checks = [];
const check = (name, passed, detail) => checks.push({ name, passed, detail });

// 1. Flat shape: what our own wire contract uses.
const flat = extractProgress({
	toolCallId: "a",
	toolName: "subagent",
	progress: { running: 2, queued: 1, completed: 3, total: 6 },
	agents: [],
});
check("flat progress parses", flat.progress?.total === 6, JSON.stringify(flat.progress));

// 2. Step Code 0.1.1: payload nested under `partialResult`.
const v011 = extractProgress({
	toolCallId: "b",
	toolName: "subagent",
	args: {},
	partialResult: {
		running: 1,
		queued: 0,
		completed: 2,
		total: 3,
		failures: 0,
		cacheHits: 1,
		cancellations: 0,
		tokenSpend: 5000,
		phase: "chain:2",
	},
});
check(
	"0.1.1 partialResult parses",
	v011.progress?.completed === 2 && v011.progress?.phase === "chain:2",
	JSON.stringify(v011.progress)
);

// 3. 0.84.x: payload nested under `details`.
const v084 = extractProgress({
	toolCallId: "c",
	toolName: "workflow",
	details: { running: 4, queued: 2, completed: 1, total: 8, tokenSpend: 12345 },
});
check(
	"0.84.x details parses",
	v084.progress?.running === 4 && v084.progress?.tokenSpend === 12345,
	JSON.stringify(v084.progress)
);

// 4. Alias tolerance for renamed counters.
const aliased = extractProgress({
	progress: { runningCount: 3, waiting: 2, finished: 5, totalAgents: 10, errors: 1, cached: 4 },
});
check(
	"field aliases resolve",
	aliased.progress?.running === 3 &&
		aliased.progress?.queued === 2 &&
		aliased.progress?.completed === 5 &&
		aliased.progress?.failures === 1 &&
		aliased.progress?.cacheHits === 4,
	JSON.stringify(aliased.progress)
);

// 5. Per-agent rows, including summary/status aliasing.
const rows = extractProgress({
	partialResult: {
		running: 1,
		completed: 1,
		total: 2,
		agents: [
			{ id: "a1", label: "scout", task: "map the repo", status: "done", tokens: 1200 },
			{ id: "a2", label: "worker", summary: "apply the patch", state: "running" },
		],
	},
});
check(
	"agent rows extracted",
	rows.agents?.length === 2 &&
		rows.agents[0].summary === "map the repo" &&
		rows.agents[0].tokens === 1200 &&
		rows.agents[1].status === "running",
	JSON.stringify(rows.agents)
);

// 6. Object-keyed agent maps are accepted too.
const keyed = extractProgress({
	progress: { running: 1, total: 2 },
	agents: { a1: { label: "alpha", status: "done" }, a2: { label: "beta" } },
});
check("object-keyed agents accepted", keyed.agents?.length === 2, JSON.stringify(keyed.agents));

// 7. Non-progress payloads are ignored rather than misread.
check("unrelated payload ignored", extractProgress({ text: "hello" }).progress === null);
check("null payload ignored", extractProgress(null).progress === null);
check("empty object ignored", extractProgress({}).progress === null);

// 8. Mode normalisation used by the extension.
check(
	"normalizeMode is case-insensitive",
	normalizeMode("PARALLEL") === "parallel" && normalizeMode("Chain") === "chain"
);
check("normalizeMode rejects unknown", normalizeMode("nope") === undefined && normalizeMode(7) === undefined);

let failed = 0;
for (const item of checks) {
	if (!item.passed) failed += 1;
	const detail = item.detail ? "  (" + String(item.detail).slice(0, 96) + ")" : "";
	console.log(`[progress] ${item.passed ? "PASS" : "FAIL"}  ${item.name}${detail}`);
}
console.log(`[progress] ${checks.length - failed}/${checks.length} checks passed`);

process.exit(failed > 0 ? 1 : 0);
