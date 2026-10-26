/**
 * Process bridge: spawns the Go gateway and feeds it newline-delimited JSON.
 *
 * Design notes:
 * - The extension must never block or throw into the host's agent loop. Every
 *   failure degrades to a one-shot warning; Step Code keeps running.
 * - The gateway is launched lazily on the first `start()` call, then kept alive
 *   for the whole session so the browser panel survives reconnects.
 * - A crash is not fatal: the bridge re-spawns on the next message.
 * - A missing binary triggers a one-shot background build with the Go
 *   toolchain, so a fresh clone works from `/orchestra` without ever opening a
 *   terminal. Set STEP_ORCHESTRA_AUTOBUILD=0 to opt out.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BridgeAction, BridgeMessage } from "./types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, "..");

const BINARY_NAME =
	process.platform === "win32" ? "step-orchestra-gateway.exe" : "step-orchestra-gateway";

/** Resolution order: explicit override, shipped binary, dev build output. */
const BINARY_CANDIDATES: string[] = [
	process.env.STEP_ORCHESTRA_BIN ?? "",
	resolve(PACKAGE_ROOT, "bin", BINARY_NAME),
	resolve(PACKAGE_ROOT, "gateway", BINARY_NAME),
].filter((candidate) => candidate.length > 0);

const AUTOBUILD_OUTPUT = resolve(PACKAGE_ROOT, "bin", BINARY_NAME);
const GATEWAY_DIR = resolve(PACKAGE_ROOT, "gateway");

const AUTOBUILD_DISABLED = /^(0|false|off)$/i.test(process.env.STEP_ORCHESTRA_AUTOBUILD ?? "");
/** Rebuild attempts are rate-limited so a broken toolchain cannot spawn `go` in a loop. */
const AUTOBUILD_COOLDOWN_MS = 30_000;

/** The gateway prints exactly one such line on startup. The token sits in the
 * URL fragment so it never travels to a server or leaks through Referer. */
const PANEL_URL_PATTERN = /https?:\/\/127\.0\.0\.1:\d+\/#t=[A-Za-z0-9_-]+/;

export class Bridge {
	private child: ChildProcess | null = null;
	private pending: string[] = [];
	private stdoutTail = "";
	private pendingStdout = "";
	private actionHandler: ((action: BridgeAction) => void) | null = null;
	/** Invoked when a gateway is re-spawned after a previous one exited. */
	private restartHandler: (() => void) | null = null;
	private panelUrl: string | null = null;
	private failureReason: string | null = null;
	private warned = false;
	private disposed = false;
	private everStarted = false;
	/** One background `go build` at a time, rate-limited by AUTOBUILD_COOLDOWN_MS. */
	private building = false;
	private buildChild: ChildProcess | null = null;
	private lastBuildAttemptAt = 0;

	/** Launch the gateway if it is not already running. Safe to call repeatedly. */
	start(): void {
		if (this.disposed || this.child) return;

		const binary = BINARY_CANDIDATES.find((candidate) => existsSync(candidate));
		if (!binary) {
			if (AUTOBUILD_DISABLED) {
				this.failureReason = `gateway binary missing (looked in ${BINARY_CANDIDATES.join(", ")})`;
			} else {
				this.autoBuild();
			}
			return;
		}

		let child: ChildProcess;
		try {
			child = spawn(binary, [], {
				stdio: ["pipe", "pipe", "pipe"],
				env: {
					...process.env,
					STEP_ORCHESTRA_WEB: process.env.STEP_ORCHESTRA_WEB ?? resolve(PACKAGE_ROOT, "web"),
					// Where the gateway keeps credential profiles. Placed beside the
					// host's own agent state so it inherits the same directory.
					STEP_ORCHESTRA_HOME:
						process.env.STEP_ORCHESTRA_HOME ??
						join(homedir(), ".stepcode", "agent", "step-orchestra"),
				},
				windowsHide: true,
			});
		} catch (error) {
			this.failureReason = `gateway spawn threw: ${String(error)}`;
			return;
		}

		// Writing to a pipe whose reader died surfaces as an async EPIPE error on
		// the stream, not a synchronous throw — without a listener it would be an
		// uncaught exception inside the host process. Swallow it; `exit` handles
		// the lifecycle, `send` re-checks writability before every write.
		child.stdin?.on("error", () => {});
		child.stdout?.on("error", () => {});
		child.stderr?.on("error", () => {});

		child.on("error", (error) => {
			this.failureReason = `gateway error: ${error.message}`;
			this.child = null;
		});
		child.on("exit", (code) => {
			this.child = null;
			// A stale URL would point at a dead port/token; the re-spawn prints a
			// fresh one and `/orchestra` must not keep serving the old.
			this.panelUrl = null;
			if (!this.disposed && code !== null) {
				this.failureReason =
					code === 0
						? "gateway exited unexpectedly (code 0)"
						: `gateway exited with code ${code}`;
			}
		});

		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => this.absorbStdout(chunk));
		child.stderr?.setEncoding("utf8");
		child.stderr?.on("data", (chunk: string) => process.stderr.write(chunk));

		this.child = child;
		this.failureReason = null;

		// A re-spawned gateway starts with empty state; let the owner replay
		// session/history/usage so a surviving panel keeps its context.
		const isRestart = this.everStarted;
		this.everStarted = true;
		if (isRestart) this.restartHandler?.();

		for (const line of this.pending) child.stdin?.write(`${line}\n`);
		this.pending.length = 0;
	}

	/** Queue one message. Never throws. */
	send(message: BridgeMessage): void {
		if (this.disposed) return;

		const line = JSON.stringify(message);

		// While the one-shot build runs there is no gateway to start; holding the
		// frames keeps the panel's first paint complete once the build lands.
		if (this.building) {
			this.pending.push(line);
			return;
		}

		if (!this.child) {
			this.start();
			if (!this.child) {
				this.warnOnce();
				return;
			}
		}

		const stdin = this.child.stdin;
		if (!stdin || stdin.destroyed || !stdin.writable) {
			this.child = null;
			this.pending.push(line);
			return;
		}

		// `write` returning false means the kernel buffer is full, NOT that the
		// write failed — Node buffers the remainder and flushes it as the pipe
		// drains. Treating it as an error would drop the message for no reason.
		stdin.write(`${line}\n`);
	}

	/** Register the reverse-channel handler for gateway-originated actions. */
	onAction(handler: (action: BridgeAction) => void): void {
		this.actionHandler = handler;
	}

	/** Register a callback fired whenever the gateway is re-spawned mid-session. */
	onRestart(handler: () => void): void {
		this.restartHandler = handler;
	}

	/** Panel URL, available once the gateway has printed it. */
	getPanelUrl(): string | null {
		return this.panelUrl;
	}

	/** Human-readable reason the bridge is inert, if any. */
	getFailureReason(): string | null {
		return this.failureReason;
	}

	/** Tell the gateway to exit, then drop the handle. */
	dispose(): void {
		this.disposed = true;
		const child = this.child;
		this.child = null;
		if (this.buildChild) {
			try {
				this.buildChild.kill();
			} catch {
				// build process already gone
			}
			this.buildChild = null;
		}
		if (!child) return;
		try {
			child.stdin?.write(`${JSON.stringify({ kind: "shutdown", ts: Date.now() })}\n`);
			child.stdin?.end();
		} catch {
			// stdin already gone; the kill below is enough
		}
		const timer = setTimeout(() => {
			try {
				child.kill();
			} catch {
				// already reaped
			}
		}, 1500);
		timer.unref?.();
	}

	/**
	 * Build the gateway with the local Go toolchain, then start it.
	 *
	 * This is the zero-CLI install path: a fresh clone plus `step install` is
	 * enough, because the first `/orchestra` (or first forwarded event) finds no
	 * binary and produces one. The build runs in the background — the host's
	 * agent loop is never awaited on; incoming frames queue and flush when the
	 * gateway comes up. Failures collapse into the usual one-shot warning.
	 */
	private autoBuild(): void {
		if (this.building || this.disposed) return;
		const now = Date.now();
		if (now - this.lastBuildAttemptAt < AUTOBUILD_COOLDOWN_MS) return;
		this.lastBuildAttemptAt = now;

		let child: ChildProcess;
		try {
			mkdirSync(resolve(PACKAGE_ROOT, "bin"), { recursive: true });
			child = spawn(
				"go",
				["build", "-trimpath", "-ldflags", "-s -w", "-o", AUTOBUILD_OUTPUT, "."],
				{
					cwd: GATEWAY_DIR,
					stdio: ["ignore", "ignore", "pipe"],
					windowsHide: true,
				}
			);
		} catch (error) {
			this.failureReason = `gateway auto-build could not start: ${String(error)}`;
			this.warnOnce();
			return;
		}

		this.building = true;
		this.buildChild = child;
		this.failureReason = "gateway binary missing — auto-build in progress (first run: ~10–30s)";
		process.stderr.write(
			"[step-orchestra] gateway binary missing — building it with Go in the background (first run takes ~10–30s)…\n" +
				`[step-orchestra] 首次运行将自动构建网关,预计 10–30 秒;完成后再次运行 /orchestra 即可。\n`
		);

		// A missing toolchain surfaces as an async ENOENT here, not a throw.
		child.on("error", (error) => {
			this.building = false;
			this.buildChild = null;
			this.failureReason =
				`Go 工具链不可用(${error.message})。请安装 Go(https://go.dev/dl)后重试,` +
				`或双击仓库根目录的 start.bat / 运行 npm start 一次。` +
				`Go toolchain unavailable — install it from https://go.dev/dl, or run start.bat / npm start once.`;
			this.warnOnce();
		});

		let stderrTail = "";
		child.stderr?.setEncoding("utf8");
		child.stderr?.on("data", (chunk: string) => {
			stderrTail = (stderrTail + chunk).slice(-1024);
		});

		child.on("exit", (code) => {
			this.building = false;
			this.buildChild = null;
			if (this.disposed) return;
			if (code === 0) {
				process.stderr.write("[step-orchestra] gateway built — starting it now.\n");
				this.start();
				return;
			}
			this.failureReason =
				`网关自动构建失败(退出码 ${code})。` +
				`可在仓库根目录运行 npm run build 查看完整输出。Go build failed (exit ${code}).`;
			this.warnOnce();
			process.stderr.write(`${stderrTail}\n`);
		});
	}

	/**
	 * Consume gateway stdout. Action lines go to the reverse-channel handler;
	 * everything else is mirrored to the host log. The panel URL is scraped on
	 * the way through so `/orchestra` can print it.
	 */
	private absorbStdout(chunk: string): void {
		this.stdoutTail = (this.stdoutTail + chunk).slice(-2048);
		if (!this.panelUrl) {
			const match = this.stdoutTail.match(PANEL_URL_PATTERN);
			if (match) this.panelUrl = match[0];
		}

		this.pendingStdout += chunk;
		const lines = this.pendingStdout.split("\n");
		// Keep the trailing partial line for the next chunk.
		this.pendingStdout = lines.pop() ?? "";

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;

			if (trimmed.charCodeAt(0) === 0x7b && this.actionHandler) {
				try {
					const parsed = JSON.parse(trimmed) as Partial<BridgeAction>;
					if (parsed && parsed.type === "action") {
						this.actionHandler(parsed as BridgeAction);
						continue;
					}
				} catch {
					// not JSON — fall through and mirror it as a log line
				}
			}

			process.stderr.write(`${trimmed}\n`);
		}
	}

	private warnOnce(): void {
		if (this.warned) return;
		this.warned = true;
		const reason = this.failureReason ?? "unknown reason";
		process.stderr.write(
			`[step-orchestra] live panel unavailable: ${reason}\n` +
				`[step-orchestra] 一键方案:双击仓库根目录的 start.bat(Windows)或 start.sh(macOS/Linux),` +
				`或在仓库根目录运行 npm start。\n` +
				`[step-orchestra] One-click: run start.bat (Windows) / start.sh (macOS/Linux) or npm start from the repo root.\n`
		);
	}
}
