#!/usr/bin/env node
/**
 * Local end-to-end harness.
 *
 * Replays a representative orchestration scenario into the gateway, exercising
 * the exact wire contract the Step Code extension produces. Useful because the
 * host itself is not required to develop or verify the panel.
 *
 * Usage: node tools/mock-feed.mjs
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The extension layer redacts before writing to the pipe; mirroring that here
// means the harness exercises the real wire contract rather than a laxer one.
import { redactArgs } from "../extensions/redact.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const BINARY_NAME =
	process.platform === "win32" ? "step-orchestra-gateway.exe" : "step-orchestra-gateway";
const BINARY = resolve(ROOT, "bin", BINARY_NAME);

if (!existsSync(BINARY)) {
	console.error(`[mock] gateway binary not found at ${BINARY}`);
	console.error(`[mock] build it first:  cd gateway && go build -o ../bin/${BINARY_NAME} .`);
	process.exit(1);
}

/** Isolated credential home so the harness never touches real user config. */
const MOCK_HOME = resolve(ROOT, ".mock-home");

const child = spawn(BINARY, [], {
	stdio: ["pipe", "pipe", "pipe"],
	env: {
		...process.env,
		STEP_ORCHESTRA_WEB: resolve(ROOT, "web"),
		STEP_ORCHESTRA_HOME: MOCK_HOME,
	},
});

let panelUrl = null;
const PANEL_URL_PATTERN = /http:\/\/127\.0\.0\.1:\d+\/#t=[A-Za-z0-9_-]+/;

/**
 * Actions the gateway writes back toward the extension. Captured here so the
 * reverse channel can be asserted without a real Step Code host attached.
 */
const reverseActions = [];
let stdoutBuffer = "";

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
	process.stdout.write(chunk);
	if (!panelUrl) {
		const match = chunk.match(PANEL_URL_PATTERN);
		if (match) panelUrl = match[0];
	}

	stdoutBuffer += chunk;
	const lines = stdoutBuffer.split("\n");
	stdoutBuffer = lines.pop() ?? "";
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.charCodeAt(0) !== 0x7b) continue;
		try {
			const parsed = JSON.parse(trimmed);
			if (parsed && parsed.type === "action") reverseActions.push(parsed);
		} catch {
			// not an action line
		}
	}
});
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => process.stderr.write(chunk));

const now = () => Date.now();
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Pull the bearer token out of the panel URL's fragment. */
function tokenFrom(url) {
	const match = url.match(/[#?&]t=([A-Za-z0-9_-]+)/);
	return match ? match[1] : "";
}
const send = (message) =>
	child.stdin.write(
		`${JSON.stringify(
			message.kind === "tool_call" && message.args
				? { ...message, args: redactArgs(message.args) }
				: message
		)}\n`
	);

const WORKFLOW_AGENTS = [
	{ id: "w1", label: "api-layer", summary: "审查路由层错误处理与超时", tokens: 14800 },
	{ id: "w2", label: "auth-guard", summary: "检查令牌校验与刷新路径", tokens: 12200 },
	{ id: "w3", label: "billing", summary: "核对计费幂等性", tokens: 17400 },
	{ id: "w4", label: "cache", summary: "排查缓存穿透与失效策略", tokens: 9600 },
	{ id: "w5", label: "scheduler", summary: "复核定时任务重试边界", tokens: 13100 },
	{ id: "w6", label: "webhooks", summary: "验证投递签名与去重", tokens: 8900 },
];

const CHAIN_AGENTS = [
	{ id: "s1", label: "read-schema", summary: "读取现有迁移约定", tokens: 5200 },
	{ id: "s2", label: "author-migration", summary: "生成可回滚迁移脚本", tokens: 8100 },
	{ id: "s3", label: "verify-rollback", summary: "校验回滚步骤完整性", tokens: 4600 },
];

function withStatus(agents, completed) {
	return agents.map((agent, index) => ({
		id: agent.id,
		label: agent.label,
		summary: agent.summary,
		status: index < completed ? "done" : index === completed ? "running" : "queued",
		tokens: index < completed ? agent.tokens : 0,
	}));
}

async function scenario() {
	send({
		kind: "session",
		ts: now(),
		sessionId: "mock-session-001",
		cwd: "E:\\Project\\demo-service",
		model: "step-3.7-flash",
	});
	await sleep(220);

	// --- conversation replay + streaming reply ---------------------------
	send({
		kind: "conversation_history",
		ts: now(),
		messages: [
			{ id: "m1", role: "user", text: "帮我审查一下 api 层的错误处理。", at: now() - 60000 },
			{
				id: "m2",
				role: "assistant",
				text: "我先看路由和中间件，再逐个模块给建议。",
				at: now() - 58000,
			},
		],
	});
	await sleep(180);

	send({ kind: "agent_start", ts: now() });
	send({
		kind: "conversation",
		ts: now(),
		message: { id: "m3", role: "user", text: "顺便把计费模块也过一遍。", at: now() },
	});
	await sleep(140);

	const reply = "计费模块看过了：需要补幂等键校验，重试次数建议从 5 次降到 3 次。";
	send({
		kind: "conversation",
		ts: now(),
		message: { id: "m4", role: "assistant", text: "", at: now(), streaming: true },
	});

	let streamed = "";
	for (const piece of reply.match(/.{1,5}/g) ?? []) {
		streamed += piece;
		send({
			kind: "conversation",
			ts: now(),
			message: { id: "m4", role: "assistant", text: streamed, at: now(), streaming: true },
		});
		await sleep(40);
	}

	send({
		kind: "conversation",
		ts: now(),
		message: { id: "m4", role: "assistant", text: reply, at: now(), streaming: false },
	});
	await sleep(160);

	// Context usage + throughput, deliberately near the ceiling so the warning
	// path is exercised rather than only the calm case.
	send({
		kind: "usage",
		ts: now(),
		usage: {
			used: 168000,
			limit: 200000,
			sessionOutput: 51300,
			recentRate: 494.9,
			turn: { output: 223, ttftMs: 3000, generationMs: 415, rate: 537.3 },
			at: now(),
		},
	});
	await sleep(180);

	// --- workflow fan-out -------------------------------------------------
	const workflowId = "call_workflow_01";
	send({
		kind: "tool_call",
		ts: now(),
		toolCallId: workflowId,
		toolName: "workflow",
		parentId: "main",
		label: "refactor-sweep",
		mode: "parallel",
		summary: "并行审查六个模块的错误处理与测试覆盖",
		args: {
			label: "refactor-sweep",
			mode: "parallel",
			prompt: "为每个模块补齐错误处理与测试",
			authorization: "Bearer sk-should-be-redacted",
		},
	});
	await sleep(320);

	for (let step = 1; step <= 6; step += 1) {
		send({
			kind: "tool_update",
			ts: now(),
			toolCallId: workflowId,
			toolName: "workflow",
			progress: {
				running: step < 6 ? 2 : 0,
				queued: Math.max(0, 6 - step - 2),
				completed: step,
				total: 6,
				failures: step >= 5 ? 1 : 0,
				cacheHits: 2,
				cancellations: 0,
				tokenSpend: step * 18400,
				phase: step < 4 ? "分析" : "汇总",
			},
			text: `已完成 ${step}/6`,
			agents: withStatus(WORKFLOW_AGENTS, step),
		});
		await sleep(480);
	}

	send({
		kind: "tool_result",
		ts: now(),
		toolCallId: workflowId,
		toolName: "workflow",
		isError: false,
		durationMs: 3400,
		tokens: { input: 82000, output: 41000 },
	});
	await sleep(260);

	// --- subagent chain ---------------------------------------------------
	const chainId = "call_subagent_02";
	send({
		kind: "tool_call",
		ts: now(),
		toolCallId: chainId,
		toolName: "subagent",
		parentId: "main",
		label: "migration-plan",
		mode: "chain",
		summary: "按顺序：读取 schema → 生成迁移 → 校验回滚",
		args: { mode: "chain", task: "设计可回滚的迁移方案", apiKey: "sk-live-should-be-redacted" },
	});
	await sleep(380);

	for (let step = 1; step <= 3; step += 1) {
		send({
			kind: "tool_update",
			ts: now(),
			toolCallId: chainId,
			toolName: "subagent",
			progress: {
				running: step < 3 ? 1 : 0,
				queued: Math.max(0, 3 - step - 1),
				completed: step,
				total: 3,
				failures: 0,
				cacheHits: 0,
				cancellations: 0,
				tokenSpend: step * 7200,
				phase: "chain:" + step,
			},
			agents: withStatus(CHAIN_AGENTS, step),
		});
		await sleep(560);
	}

	send({
		kind: "tool_result",
		ts: now(),
		toolCallId: chainId,
		toolName: "subagent",
		isError: false,
		durationMs: 2100,
		tokens: { input: 11000, output: 6300 },
	});
	await sleep(240);

	// --- a plain tool, hidden by the "orchestration only" filter ----------
	send({
		kind: "tool_call",
		ts: now(),
		toolCallId: "call_read_03",
		toolName: "read",
		parentId: "main",
		args: { path: "src/index.ts" },
	});
	await sleep(280);
	send({
		kind: "tool_result",
		ts: now(),
		toolCallId: "call_read_03",
		toolName: "read",
		isError: false,
		durationMs: 42,
	});

	send({ kind: "agent_end", ts: now() });
	send({ kind: "agent_settled", ts: now() });

	console.log("[mock] scenario replayed.");

	if (!panelUrl) {
		console.error("[mock] FAIL: the gateway never printed a panel URL");
		child.kill();
		process.exit(1);
	}

	// The fragment carries the token; strip it for HTTP requests. Reads may use
	// the query form, writes must send the token header.
	const base = panelUrl.replace(/#.*$/, "");
	const authToken = tokenFrom(panelUrl);
	const readUrl = (path) =>
		base + path + (path.indexOf("?") === -1 ? "?" : "&") + "t=" + authToken;

	const response = await fetch(readUrl("/api/snapshot"));
	if (!response.ok) {
		console.error(`[mock] FAIL: snapshot request returned ${response.status}`);
		child.kill();
		process.exit(1);
	}

	const snapshot = await response.json();
	const nodes = snapshot.nodes || [];
	const workflow = nodes.find((node) => node.toolName === "workflow");
	const chain = nodes.find((node) => node.toolName === "subagent");
	const plain = nodes.find((node) => node.toolName === "read");

	const checks = [];
	const check = (name, passed, detail) => checks.push({ name, passed, detail });

	check("session id echoed", snapshot.session && snapshot.session.id === "mock-session-001", snapshot.session && snapshot.session.id);
	check("three nodes materialised", nodes.length === 3, "got " + nodes.length);
	check("workflow flagged as orchestration", !!workflow && workflow.orchestration === true);
	check("workflow carries 6 agents", !!workflow && !!workflow.agents && workflow.agents.length === 6, workflow && workflow.agents ? workflow.agents.length : 0);
	check("workflow reached done", !!workflow && workflow.status === "done", workflow && workflow.status);
	check("chain mode preserved", !!chain && chain.mode === "chain", chain && chain.mode);
	check("workflow tokens recorded", !!workflow && !!workflow.tokens && workflow.tokens.input === 82000, workflow && workflow.tokens ? workflow.tokens.input : undefined);
	check("authorization redacted", !!workflow && !!workflow.args && workflow.args.authorization === "***", workflow && workflow.args ? workflow.args.authorization : undefined);
	check("apiKey redacted", !!chain && !!chain.args && chain.args.apiKey === "***", chain && chain.args ? chain.args.apiKey : undefined);
	check("plain tool tracked", !!plain && plain.status === "done", plain && plain.status);
	check("run settled", !!snapshot.run && snapshot.run.status === "settled", snapshot.run && snapshot.run.status);
	check("token spend aggregated", !!snapshot.stats && snapshot.stats.tokenSpend > 0, snapshot.stats && snapshot.stats.tokenSpend);

	// --- conversation -----------------------------------------------------
	const messages = snapshot.messages || [];
	check("conversation replayed + replied", messages.length >= 4, "got " + messages.length);
	check(
		"streamed reply finalized",
		messages.some((item) => item.id === "m4" && item.streaming !== true && item.text.startsWith("计费模块")),
		JSON.stringify(messages.find((item) => item.id === "m4") || null).slice(0, 90)
	);

	// --- reverse channel: browser -> gateway -> extension -----------------
	const denied = await fetch(base + "/api/send", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ text: "should be rejected" }),
	});
	check("send without token rejected", denied.status === 401, "status " + denied.status);

	// A token that leaked through the URL must not authorize a mutation.
	const queryOnly = await fetch(base + "/api/send?t=" + authToken, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ text: "query token must not write" }),
	});
	check("query token cannot authorize a write", queryOnly.status === 401, "status " + queryOnly.status);

	// Cross-site browsers can reach loopback; the Origin check is what stops them.
	const crossSite = await fetch(base + "/api/send", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Orchestra-Token": authToken,
			Origin: "https://attacker.example",
		},
		body: JSON.stringify({ text: "cross-site attempt" }),
	});
	check("cross-site origin rejected", crossSite.status === 403, "status " + crossSite.status);

	const accepted = await fetch(base + "/api/send", {
		method: "POST",
		headers: { "Content-Type": "application/json", "X-Orchestra-Token": authToken },
		body: JSON.stringify({ text: "ping from the panel" }),
	});
	check("send with token accepted", accepted.status === 200, "status " + accepted.status);

	await sleep(250);
	check(
		"action reached the reverse channel",
		reverseActions.length === 1 && reverseActions[0].text === "ping from the panel",
		JSON.stringify(reverseActions[0] || null).slice(0, 110)
	);

	// Acknowledge as the extension would, clearing the panel's pending state.
	if (reverseActions.length > 0) {
		send({ kind: "action_ack", ts: now(), requestId: reverseActions[0].requestId, ok: true });
	}

	// The browser's own POST carries an Origin equal to the page authority.
	const sameOrigin = await fetch(base + "/api/send", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Orchestra-Token": authToken,
			Origin: new URL(base).origin,
		},
		body: JSON.stringify({ text: "same-origin write" }),
	});
	check("same-origin write accepted", sameOrigin.status === 200, "status " + sameOrigin.status);

	// Static assets load before any token exists in the page; only the bundled
	// web/ directory is ever exposed this way.
	const page = await fetch(base + "/");
	const pageBody = await page.text();
	check(
		"static panel served without a token",
		page.status === 200 && pageBody.includes("<!DOCTYPE html>"),
		"status " + page.status
	);

	// --- credential profiles ---------------------------------------------
	const profileUrl = base + "/api/profiles";
	const jsonHeaders = { "Content-Type": "application/json", "X-Orchestra-Token": authToken };
	const SECRET = "sk-mock-abcdef1234567890";

	const created = await fetch(profileUrl, {
		method: "POST",
		headers: jsonHeaders,
		body: JSON.stringify({ name: "个人 Plan", provider: "step", apiKey: SECRET }),
	});
	check("profile create accepted", created.status === 200, "status " + created.status);
	const createdBody = await created.json();

	// Persistence is the point of the feature: assert the file really exists.
	const profileFile = join(MOCK_HOME, "profiles.json");
	const onDisk = existsSync(profileFile) ? readFileSync(profileFile, "utf8") : "";
	check("profiles.json written to disk", onDisk.includes(SECRET), profileFile);
	check("profiles.json is version-stamped", onDisk.includes('"version": 1'), profileFile);

	const roster = await (await fetch(readUrl("/api/profiles"))).json();
	check(
		"profile persisted",
		Array.isArray(roster.profiles) && roster.profiles.length === 1,
		"got " + (roster.profiles || []).length
	);
	check(
		"plaintext key never returned to the browser",
		!JSON.stringify(roster).includes(SECRET),
		JSON.stringify(roster.profiles?.[0] ?? null).slice(0, 96)
	);
	check(
		"key is masked for display",
		roster.profiles?.[0]?.keyHint === "sk-m…7890",
		roster.profiles?.[0]?.keyHint
	);

	// Editing without a key must keep the stored secret.
	const edited = await fetch(profileUrl, {
		method: "POST",
		headers: jsonHeaders,
		body: JSON.stringify({ id: createdBody.id, name: "个人 Plan（改名）", provider: "step", apiKey: "" }),
	});
	check("metadata edit accepted", edited.status === 200, "status " + edited.status);

	const afterEdit = await (await fetch(readUrl("/api/profiles"))).json();
	check(
		"blank key preserves the stored secret",
		afterEdit.profiles?.[0]?.keyHint === "sk-m…7890" && afterEdit.profiles?.[0]?.name === "个人 Plan（改名）",
		JSON.stringify(afterEdit.profiles?.[0] ?? null).slice(0, 96)
	);

	// --- activation pushes the credential to the host --------------------
	reverseActions.length = 0;

	const activated = await fetch(profileUrl + "/activate", {
		method: "POST",
		headers: jsonHeaders,
		body: JSON.stringify({ id: createdBody.id }),
	});
	check("activation accepted", activated.status === 200, "status " + activated.status);

	await sleep(250);
	const applied = reverseActions.find((action) => action.action === "apply_profile");
	check(
		"credential pushed over the reverse channel",
		!!applied?.profile && applied.profile.apiKey === SECRET && applied.profile.provider === "step",
		applied ? applied.profile.provider : "none"
	);

	const afterActivate = await (await fetch(readUrl("/api/profiles"))).json();
	check("active profile reported", afterActivate.activeId === createdBody.id, afterActivate.activeId);

	// --- removal ----------------------------------------------------------
	// A query-string token must not authorize the delete either.
	const deleteQueryOnly = await fetch(
		profileUrl + "?t=" + authToken + "&id=" + encodeURIComponent(createdBody.id),
		{ method: "DELETE" }
	);
	check("query token cannot authorize profile deletion", deleteQueryOnly.status === 401, "status " + deleteQueryOnly.status);

	const removed = await fetch(profileUrl + "?id=" + encodeURIComponent(createdBody.id), {
		method: "DELETE",
		headers: { "X-Orchestra-Token": authToken },
	});
	check("profile delete accepted", removed.status === 200, "status " + removed.status);

	const finalRoster = await (await fetch(readUrl("/api/profiles"))).json();
	check(
		"profile removed and active cleared",
		Array.isArray(finalRoster.profiles) &&
			finalRoster.profiles.length === 0 &&
			!finalRoster.activeId,
		"profiles=" + (finalRoster.profiles || []).length + " active=" + (finalRoster.activeId || "none")
	);

	// Unauthenticated access to the credential endpoints must fail.
	const profileDenied = await fetch(profileUrl);
	check("profile list requires a token", profileDenied.status === 401, "status " + profileDenied.status);

	// --- context usage + throughput ---------------------------------------
	check(
		"usage mirrored to the panel",
		!!snapshot.usage &&
			snapshot.usage.used === 168000 &&
			snapshot.usage.limit === 200000 &&
			snapshot.usage.sessionOutput === 51300,
		JSON.stringify(snapshot.usage ?? null).slice(0, 120)
	);
	check(
		"turn metrics survive the round trip",
		!!snapshot.usage?.turn &&
			snapshot.usage.turn.output === 223 &&
			Math.abs(snapshot.usage.turn.rate - 537.3) < 0.01 &&
			snapshot.usage.turn.ttftMs === 3000 &&
			snapshot.usage.turn.generationMs === 415,
		JSON.stringify(snapshot.usage?.turn ?? null)
	);

	let failed = 0;
	for (const item of checks) {
		const mark = item.passed ? "PASS" : "FAIL";
		if (!item.passed) failed += 1;
		const detail = item.detail === undefined ? "" : "  (" + item.detail + ")";
		console.log(`[verify] ${mark}  ${item.name}${detail}`);
	}
	console.log(`[verify] ${checks.length - failed}/${checks.length} checks passed`);

	const keepAlive = process.argv.includes("--serve");
	if (failed > 0 || !keepAlive) {
		child.kill();
		// Isolated harness state; leaving it behind would confuse the next run.
		try {
			rmSync(MOCK_HOME, { recursive: true, force: true });
		} catch {
			// best effort
		}
		process.exit(failed > 0 ? 1 : 0);
	}

	console.log(`[mock] gateway still serving at ${panelUrl}`);
	console.log("[mock] press Ctrl+C to stop.");
}

process.on("SIGINT", () => {
	child.kill();
	process.exit(0);
});

scenario().catch((error) => {
	console.error("[mock] scenario failed:", error);
	child.kill();
	process.exit(1);
});
