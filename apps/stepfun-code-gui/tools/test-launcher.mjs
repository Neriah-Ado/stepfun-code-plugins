#!/usr/bin/env node
/**
 * Launcher unit tests.
 *
 * start.mjs is the one-click entry for every newcomer, so its pure decision
 * logic — platform naming, flag parsing, candidate resolution — is pinned
 * here. The main() flow is exercised separately by the manual start checklist
 * and by mock-feed (which shares the same binary layout).
 *
 * Usage: node tools/test-launcher.mjs
 */
import { strict as assert } from "node:assert";
import { binaryNameFor, findPanelUrl, openCommandFor, parseArgs, pickBinary } from "../start.mjs";

const checks = [];
const check = (name, fn) => {
	try {
		fn();
		checks.push({ name, passed: true });
	} catch (error) {
		checks.push({ name, passed: false, detail: error.message });
	}
};

check("binary name is platform-specific", () => {
	assert.equal(binaryNameFor("win32"), "step-orchestra-gateway.exe");
	assert.equal(binaryNameFor("linux"), "step-orchestra-gateway");
	assert.equal(binaryNameFor("darwin"), "step-orchestra-gateway");
});

check("open command matches the platform", () => {
	assert.deepEqual(openCommandFor("win32", "http://x"), {
		command: "cmd",
		args: ["/c", "start", "", "http://x"],
	});
	assert.deepEqual(openCommandFor("darwin", "http://x"), { command: "open", args: ["http://x"] });
	assert.deepEqual(openCommandFor("linux", "http://x"), { command: "xdg-open", args: ["http://x"] });
});

check("flags parse", () => {
	assert.deepEqual(parseArgs(["--demo"]), {
		demo: true,
		noOpen: false,
		buildOnly: false,
		help: false,
		port: null,
	});
	assert.equal(parseArgs(["--build-only", "--no-open"]).buildOnly, true);
	assert.equal(parseArgs(["--no-open"]).noOpen, true);
	assert.equal(parseArgs(["--help"]).help, true);
});

check("port flags parse into a valid range", () => {
	assert.equal(parseArgs(["--port", "50000"]).port, 50000);
	assert.equal(parseArgs(["--port=47810"]).port, 47810);
	assert.equal(parseArgs(["50000"]).port, 50000);
	assert.equal(parseArgs(["--port", "99999"]).port, null, "out-of-range port must be ignored");
	assert.equal(parseArgs(["--port", "abc"]).port, null);
});

check("unknown flags are ignored, not fatal", () => {
	assert.equal(parseArgs(["--totally-unknown"]).demo, false);
});

check("pickBinary returns the first existing candidate", () => {
	const exists = (path) => path.includes("b");
	assert.equal(pickBinary(["a", "b", "c"], exists), "b");
	assert.equal(pickBinary(["a"], () => false), null);
	assert.equal(pickBinary([], () => true), null);
});

check("panel URL is scraped with the token in the fragment", () => {
	const line = "[step-orchestra] panel http://127.0.0.1:47810/#t=0123456789abcdef\n";
	assert.equal(findPanelUrl(line), "http://127.0.0.1:47810/#t=0123456789abcdef");
	assert.equal(findPanelUrl("http://127.0.0.1:47811/#t=ab-cd_ef"), "http://127.0.0.1:47811/#t=ab-cd_ef");
	// An incomplete URL yields null until the tail is reassembled.
	assert.equal(findPanelUrl("noise http://127.0.0.1:47810/#t="), null);
	assert.equal(findPanelUrl(""), null);
});

check("legacy ?t= panel URLs are no longer matched", () => {
	assert.equal(findPanelUrl("http://127.0.0.1:47810/?t=0123456789abcdef"), null);
});

let failed = 0;
for (const item of checks) {
	if (!item.passed) failed += 1;
	const detail = item.detail ? "  (" + String(item.detail).slice(0, 120) + ")" : "";
	console.log(`[launcher] ${item.passed ? "PASS" : "FAIL"}  ${item.name}${detail}`);
}
console.log(`[launcher] ${checks.length - failed}/${checks.length} checks passed`);

process.exit(failed > 0 ? 1 : 0);
