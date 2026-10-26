#!/usr/bin/env node
/**
 * Aggregated reliability harness.
 *
 * Runs the whole verification surface in dependency order and supports
 * multiple rounds, which is how release candidates are soaked:
 *
 *   node tools/run-all-tests.mjs               one full pass
 *   node tools/run-all-tests.mjs --rounds 3    soak: three full passes
 *   node tools/run-all-tests.mjs --skip-build  reuse an existing bin/ binary
 *
 * Exit code is non-zero if any step in any round fails, so this is safe to
 * wire into CI or a pre-push hook.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const NODE = process.execPath;

const argv = process.argv.slice(2);
const rounds = Math.max(1, Number.parseInt(argv[argv.indexOf("--rounds") + 1] ?? "1", 10) || 1);
const skipBuild = argv.includes("--skip-build");

const binaryName = process.platform === "win32" ? "step-orchestra-gateway.exe" : "step-orchestra-gateway";
const binaryPath = resolve(ROOT, "bin", binaryName);

/** Ordered verification surface. Build runs once, outside the round loop. */
const steps = [
	{
		name: "go vet",
		run: () => spawnSync("go", ["vet", "./..."], { cwd: resolve(ROOT, "gateway"), encoding: "utf8" }),
	},
	{
		name: "go test",
		run: () => spawnSync("go", ["test", "./..."], { cwd: resolve(ROOT, "gateway"), encoding: "utf8" }),
	},
	{
		name: "extension modules load",
		run: () => spawnSync(NODE, [resolve(HERE, "test-extension-import.mjs")], { encoding: "utf8" }),
	},
	{
		name: "host payload reader",
		run: () => spawnSync(NODE, [resolve(HERE, "test-progress.mjs")], { encoding: "utf8" }),
	},
	{
		name: "stacking-order guard",
		run: () => spawnSync(NODE, [resolve(HERE, "check-layers.mjs")], { encoding: "utf8" }),
	},
	{
		name: "launcher units",
		run: () => spawnSync(NODE, [resolve(HERE, "test-launcher.mjs")], { encoding: "utf8" }),
	},
	{
		name: "panel token bootstrap",
		run: () => spawnSync(NODE, [resolve(HERE, "test-token.mjs")], { encoding: "utf8" }),
	},
	{
		name: "end-to-end (mock feed)",
		run: () => spawnSync(NODE, [resolve(HERE, "mock-feed.mjs")], { encoding: "utf8", timeout: 120_000 }),
	},
];

let failed = false;

if (!skipBuild) {
	console.log("[run-all] building gateway…");
	const build = spawnSync(NODE, [resolve(ROOT, "start.mjs"), "--build-only"], {
		stdio: "inherit",
		encoding: "utf8",
	});
	if (build.status !== 0) {
		console.error("[run-all] FAIL  gateway build");
		process.exit(1);
	}
} else if (!existsSync(binaryPath)) {
	console.error(`[run-all] --skip-build requested but ${binaryPath} is missing`);
	process.exit(1);
}

for (let round = 1; round <= rounds && !failed; round += 1) {
	console.log(`\n========== round ${round}/${rounds} ==========`);

	for (const step of steps) {
		const result = step.run();
		const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
		const tail = output.split("\n").slice(-3).join("\n");
		const passed = result.status === 0;

		if (!passed) failed = true;
		console.log(`[run-all] ${passed ? "PASS" : "FAIL"}  ${step.name}${tail ? "\n" + indent(tail) : ""}`);
	}
}

console.log(failed ? "\n[run-all] RESULT: FAIL" : `\n[run-all] RESULT: PASS (${rounds} round${rounds > 1 ? "s" : ""})`);
process.exit(failed ? 1 : 0);

function indent(text) {
	return text
		.split("\n")
		.map((line) => "           " + line)
		.join("\n");
}
