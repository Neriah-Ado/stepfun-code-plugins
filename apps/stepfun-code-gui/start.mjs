#!/usr/bin/env node
/**
 * One-click launcher for step-orchestra.
 *
 * Existence rationale: the README quick start used to require opening a
 * terminal, changing directories, and typing a platform-specific `go build`
 * line. This script collapses all of that into "double-click start.bat" (or
 * `npm start`): it locates the gateway binary, builds it with Go if needed,
 * launches it, and opens the panel in the default browser.
 *
 * Modes:
 *   node start.mjs              locate/build/launch gateway, open the panel
 *   node start.mjs --demo       replay the mock scenario instead (no Step Code
 *                               required — lets a newcomer see the panel alive)
 *   node start.mjs --build-only build the gateway and exit (used by npm run build)
 *   node start.mjs --no-open    do not launch the browser
 *   node start.mjs --port N     override the gateway's starting port
 *
 * The pure helpers are exported so tools/test-launcher.mjs can pin their
 * behaviour; main() only runs when this file is the entry script.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATEWAY_DIR = resolve(HERE, "gateway");
const WEB_DIR = resolve(HERE, "web");
const BIN_DIR = resolve(HERE, "bin");

/** Platform-specific gateway binary name, matching extensions/bridge.ts. */
export function binaryNameFor(platform) {
	return platform === "win32" ? "step-orchestra-gateway.exe" : "step-orchestra-gateway";
}

/**
 * The gateway prints exactly one panel URL, with the bearer token in the URL
 * fragment. A fragment is never sent to a server and never reaches Referer,
 * unlike the query string this used to be.
 */
const PANEL_URL_PATTERN = /https?:\/\/127\.0\.0\.1:\d+\/#t=[A-Za-z0-9_-]+/;

/** First panel URL found in a chunk of gateway output, or null. */
export function findPanelUrl(text) {
	const match = String(text ?? "").match(PANEL_URL_PATTERN);
	return match ? match[0] : null;
}

/** The command that opens a URL in the default browser, per platform. */
export function openCommandFor(platform, url) {
	if (platform === "win32") {
		// `start` treats its first quoted argument as the window title, so an
		// empty title must sit between /c and the URL.
		return { command: "cmd", args: ["/c", "start", "", url] };
	}
	if (platform === "darwin") return { command: "open", args: [url] };
	return { command: "xdg-open", args: [url] };
}

/** Minimal flag parser; unknown flags are ignored so typos never crash a launch. */
export function parseArgs(argv) {
	const options = { demo: false, noOpen: false, buildOnly: false, help: false, port: null };
	for (const arg of argv) {
		if (arg === "--demo") options.demo = true;
		else if (arg === "--no-open") options.noOpen = true;
		else if (arg === "--build-only") options.buildOnly = true;
		else if (arg === "--help" || arg === "-h") options.help = true;
		else if (arg === "--port") options.port = null;
		else if (String(arg).startsWith("--port=")) {
			const value = Number.parseInt(String(arg).slice(7), 10);
			if (Number.isFinite(value) && value > 0 && value < 65536) options.port = value;
		} else if (options.port === null && /^-?\d+$/.test(String(arg))) {
			const value = Number.parseInt(String(arg), 10);
			if (Number.isFinite(value) && value > 0 && value < 65536) options.port = value;
		}
	}
	return options;
}

/** First candidate that exists on disk, or null. */
export function pickBinary(candidates, exists) {
	for (const candidate of candidates) {
		if (exists(candidate)) return candidate;
	}
	return null;
}

/** True when `go` is runnable from PATH. */
export function findGo() {
	const probe = spawnSync("go", ["version"], { stdio: "ignore", windowsHide: true });
	return !probe.error && probe.status === 0;
}

const HELP_TEXT = `
StepFun Code-GUI 启动器 · step-orchestra launcher

用法 / usage:
  node start.mjs [选项]        启动网关并打开面板
  node start.mjs --demo        演示模式(无需 Step Code,回放内置场景)
  node start.mjs --build-only  仅构建网关后退出

选项 / options:
  --demo      回放 mock 场景,适合首次体验 / replay the built-in scenario
  --no-open   不自动打开浏览器 / do not open the browser
  --port N    指定起始端口 / starting port (default 47810)
  --help      显示本说明 / show this help
`.trim();

function printHelp() {
	console.log(HELP_TEXT);
}

/**
 * Build the gateway binary if it is missing. Returns { ok, reused, reason }.
 * The build is deliberately synchronous here: a human is waiting on a
 * double-click, and the gateway is standard-library-only (~10 s cold build).
 */
export function buildGateway(root, log = (line) => process.stdout.write(`${line}\n`)) {
	const name = binaryNameFor(process.platform);
	const output = resolve(root, "bin", name);
	if (existsSync(output)) return { ok: true, reused: true };

	if (!findGo()) {
		return {
			ok: false,
			reason:
				"未找到 Go 工具链。请安装 Go (https://go.dev/dl) 后重试 / Go toolchain not found — install it from https://go.dev/dl",
		};
	}

	try {
		mkdirSync(resolve(root, "bin"), { recursive: true });
	} catch (error) {
		return { ok: false, reason: `cannot create bin/: ${String(error)}` };
	}

	log("[start] 网关二进制缺失,正在用 Go 构建(首次约 10–30 秒)…");
	log("[start] gateway binary missing — building with Go (first run takes ~10–30s)…");

	const started = Date.now();
	const build = spawnSync(
		"go",
		["build", "-trimpath", "-ldflags", "-s -w", "-o", output, "."],
		{ cwd: resolve(root, "gateway"), windowsHide: true, encoding: "utf8" }
	);

	if (build.error) return { ok: false, reason: `go build failed to start: ${build.error.message}` };
	if (build.status !== 0) {
		const tail = String(build.stderr || "").trim().split("\n").slice(-6).join("\n");
		return { ok: false, reason: `go build exited with ${build.status}\n${tail}` };
	}

	log(`[start] 构建完成,用时 ${((Date.now() - started) / 1000).toFixed(1)}s / build done.`);
	return { ok: true, reused: false, output };
}

/** Spawn the gateway and resolve once its panel URL appears on stdout. */
function launchGateway(root, options) {
	return new Promise((resolveLaunch) => {
		const env = {
			...process.env,
			STEP_ORCHESTRA_WEB: process.env.STEP_ORCHESTRA_WEB || WEB_DIR,
			// Same directory the extension uses, so profiles configured from the
			// standalone panel are visible inside Step Code sessions and vice versa.
			STEP_ORCHESTRA_HOME:
				process.env.STEP_ORCHESTRA_HOME || join(homedir(), ".stepcode", "agent", "step-orchestra"),
		};
		if (options.port && !process.env.STEP_ORCHESTRA_PORT) env.STEP_ORCHESTRA_PORT = String(options.port);

		const child = spawn(resolve(BIN_DIR, binaryNameFor(process.platform)), [], {
			stdio: ["inherit", "pipe", "pipe"],
			env,
			windowsHide: true,
		});

		let url = null;
		let stdoutTail = "";
		const settle = (value) => resolveLaunch({ child, url });

		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			process.stdout.write(chunk);
			if (url) return;
			stdoutTail = (stdoutTail + chunk).slice(-2048);
			const found = findPanelUrl(stdoutTail);
			if (found) {
				url = found;
				if (!options.noOpen) openBrowser(url);
				console.log("[start] 浏览器已打开面板;若未弹出,请手动访问上面的地址。");
				console.log("[start] 数据需要 Step Code 会话驱动:安装扩展后在 Step Code 中运行 /orchestra。");
			}
		});
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk) => process.stderr.write(chunk));
		child.on("error", (error) => {
			process.stderr.write(`[start] gateway spawn failed: ${error.message}\n`);
			settle(null);
		});
		// The URL arrives within milliseconds of start; don't wait for exit.
		const timer = setTimeout(() => settle(child), 4000);
		timer.unref?.();
		child.on("exit", (code) => {
			clearTimeout(timer);
			process.exitCode = code ?? 0;
			settle(child);
		});
	});
}

/** Demo mode: replay the built-in scenario, then keep the gateway serving. */
function launchDemo(root, options) {
	return new Promise((resolveLaunch) => {
		const child = spawn(process.execPath, [resolve(root, "tools", "mock-feed.mjs"), "--serve"], {
			stdio: ["inherit", "pipe", "pipe"],
			cwd: root,
			windowsHide: true,
		});

		let url = null;
		let buffer = "";
		const settle = () => resolveLaunch({ child, url });

		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			process.stdout.write(chunk);
			if (url) return;
			buffer = (buffer + chunk).slice(-4096);
			const found = findPanelUrl(buffer);
			if (found) {
				url = found;
				if (!options.noOpen) openBrowser(url);
				console.log("[start] 演示面板已在浏览器打开。");
			}
		});
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk) => process.stderr.write(chunk));
		child.on("error", (error) => {
			process.stderr.write(`[start] demo spawn failed: ${error.message}\n`);
			settle();
		});
		const timer = setTimeout(settle, 12000);
		timer.unref?.();
		child.on("exit", (code) => {
			clearTimeout(timer);
			process.exitCode = code ?? 0;
			settle();
		});
	});
}

function openBrowser(url) {
	const opener = openCommandFor(process.platform, url);
	try {
		const child = spawn(opener.command, opener.args, {
			stdio: "ignore",
			detached: true,
			windowsHide: true,
		});
		child.on("error", () => {});
		child.unref?.();
	} catch {
		// Opening the browser is a convenience; the URL is printed regardless.
	}
}

/** Entry-point guard so tools/test-launcher.mjs can import the helpers. */
function isEntryScript() {
	const entry = process.argv[1];
	if (!entry) return false;
	try {
		return import.meta.url === pathToFileURL(entry).href;
	} catch {
		return false;
	}
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		printHelp();
		return;
	}

	const build = buildGateway(HERE);
	if (!build.ok) {
		console.error(`[start] ${build.reason}`);
		process.exitCode = 1;
		return;
	}
	if (options.buildOnly) {
		console.log("[start] 网关已就绪 / gateway ready.");
		return;
	}

	console.log("[start] StepFun Code-GUI v2.0.0 — Ctrl+C 退出 / press Ctrl+C to stop.");

	const launched = options.demo ? await launchDemo(HERE, options) : await launchGateway(HERE, options);
	if (!launched?.child) {
		process.exitCode = 1;
		return;
	}

	const stop = () => {
		try {
			launched.child.kill();
		} catch {
			// already gone
		}
	};
	process.on("SIGINT", () => {
		stop();
		process.exit(0);
	});
	process.on("SIGTERM", () => {
		stop();
		process.exit(0);
	});
}

if (isEntryScript()) {
	main().catch((error) => {
		console.error(`[start] ${error?.stack || error}`);
		process.exitCode = 1;
	});
}
