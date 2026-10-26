/**
 * Panel controller: SSE ingestion, state aggregation, chrome updates, and the
 * node inspector.
 *
 * Host data is only ever written through textContent. JSON arguments are
 * rendered inside a <pre> as text, never parsed into markup.
 */
(function (global) {
	"use strict";

	var tree = global.OrchestraTree;
	var chat = global.OrchestraChat;
	var profiles = global.OrchestraProfiles;

	// The token is bootstrapped by token.js from the URL fragment, which is
	// stripped from the address bar before this script runs.
	var token = global.OrchestraToken || "";

	var state = { session: {}, run: {}, nodes: [], usage: { used: 0, limit: 0 } };
	var nodeIndex = new Map();
	/** node id → its position in state.nodes, so updates stay O(1). */
	var nodePositions = new Map();
	var selectedId = null;

	var els = {
		modeSwitch: document.getElementById("mode-switch"),
		modeLabel: document.getElementById("mode-switch-label"),
		viewOrchestration: document.getElementById("view-orchestration"),
		viewChat: document.getElementById("view-chat"),
		chatRunState: document.getElementById("chat-run-state"),
		chatRunText: document.getElementById("chat-run-text"),
		usageBar: document.getElementById("usage-bar"),
		usageText: document.getElementById("usage-text"),
		usageClock: document.getElementById("usage-clock"),
		tree: document.getElementById("tree"),
		empty: document.getElementById("empty"),
		inspector: document.getElementById("inspector"),
		live: document.getElementById("live"),
		liveText: document.getElementById("live-text"),
		runState: document.getElementById("run-state"),
		runStateText: document.getElementById("run-state-text"),
		running: document.getElementById("m-running"),
		completed: document.getElementById("m-completed"),
		failed: document.getElementById("m-failed"),
		orchestrations: document.getElementById("m-orchestrations"),
		tokens: document.getElementById("m-tokens"),
		model: document.getElementById("s-model"),
		cwd: document.getElementById("s-cwd"),
		filterOrchestration: document.getElementById("filter-orchestration-only"),
		collapse: document.getElementById("btn-collapse")
	};

	var options = {
		onlyOrchestration: els.filterOrchestration.checked,
		collapseDone: false
	};

	// ------------------------------------------------------------------- utils

	function el(tag, className, text) {
		var node = document.createElement(tag);
		if (className) node.className = className;
		if (text !== undefined && text !== null && text !== "") node.textContent = String(text);
		return node;
	}

	function define(term, value) {
		var dt = el("dt", null, term);
		var dd = el("dd", null, value === undefined || value === null || value === "" ? "—" : value);
		return [dt, dd];
	}

	function section(title) {
		var wrap = el("div", "insp-section");
		wrap.appendChild(el("h2", "insp-section-title", title));
		return wrap;
	}

	// ----------------------------------------------------------------- painting

	// One rAF queue for everything the event stream touches. SSE frames can
	// arrive far faster than frames should render; structural changes and
	// per-node updates are coalesced here so chrome stats and the tree are
	// touched at most once per display frame.
	var updateQueued = false;
	var structuralDirty = false;
	var dirtyNodeIds = new Set();

	function scheduleRender() {
		structuralDirty = true;
		scheduleFlush();
	}

	function scheduleNodeUpdate(id) {
		dirtyNodeIds.add(id);
		scheduleFlush();
	}

	function scheduleFlush() {
		if (updateQueued) return;
		updateQueued = true;
		global.requestAnimationFrame(flushUpdates);
	}

	function flushUpdates() {
		updateQueued = false;
		var selectedDirty = selectedId !== null && dirtyNodeIds.has(selectedId);
		var structural = structuralDirty;
		var hasUpdates = dirtyNodeIds.size > 0;

		if (structural) {
			structuralDirty = false;
			dirtyNodeIds.clear();
			tree.render(els.tree, state, options);
			// Judge emptiness against the filtered view: with "仅编排" on and no
			// orchestration nodes yet, a hint beats a blank panel.
			els.empty.hidden = tree.visibleCount(state, options) > 0;
		} else if (hasUpdates) {
			dirtyNodeIds.forEach(function (id) {
				var node = nodeIndex.get(id);
				if (node) tree.upsert(els.tree, state, options, node);
			});
			dirtyNodeIds.clear();
		}

		if (structural || hasUpdates) updateChrome();
		if (selectedDirty) renderInspector();
	}

	var lastStats = { total: 0, orchestrations: 0, running: 0, completed: 0, failed: 0, tokenSpend: 0 };

	function computeStats() {
		var stats = { total: 0, orchestrations: 0, running: 0, completed: 0, failed: 0, tokenSpend: 0 };

		state.nodes.forEach(function (node) {
			stats.total += 1;
			if (node.orchestration) stats.orchestrations += 1;

			if (node.status === "running") stats.running += 1;
			else if (node.status === "done") stats.completed += 1;
			else if (node.status === "failed") stats.failed += 1;

			if (node.tokens) {
				stats.tokenSpend += (node.tokens.input || 0) + (node.tokens.output || 0);
			}
		});

		return stats;
	}

	function updateChrome() {
		var stats = computeStats();
		lastStats = stats;

		els.running.textContent = String(stats.running);
		els.completed.textContent = String(stats.completed);
		els.failed.textContent = String(stats.failed);
		els.orchestrations.textContent = String(stats.orchestrations);
		els.tokens.textContent = tree.formatTokens(stats.tokenSpend);

		els.model.textContent = state.session.model || "未连接模型";
		els.cwd.textContent = state.session.cwd || "—";
		els.cwd.title = state.session.cwd || "";

		var status = state.run.status || "idle";
		els.runState.dataset.state = status;
		els.runStateText.textContent =
			status === "running" ? "运行中" : status === "settled" ? "已结算" : "空闲";
	}

	function setLive(status, text) {
		els.live.dataset.state = status;
		els.liveText.textContent = text;
		// The composer is only usable while the event stream is up.
		chat.setEnabled(status === "live");
	}

	// ------------------------------------------------------------------ ingress

	function handleSnapshot(payload) {
		state.session = payload.session || {};
		state.run = payload.run || {};
		state.nodes = Array.isArray(payload.nodes) ? payload.nodes : [];

		nodeIndex.clear();
		nodePositions.clear();
		state.nodes.forEach(function (node, position) {
			nodeIndex.set(node.id, node);
			nodePositions.set(node.id, position);
		});

		if (Array.isArray(payload.messages)) chat.replace(payload.messages);

		if (Array.isArray(payload.profiles)) {
			profiles.apply({
				profiles: payload.profiles,
				activeId: payload.activeProfileId || null,
				lastError: payload.profileError || "",
			});
		}

		if (payload.usage) {
			state.usage = payload.usage;
			renderUsage();
		}

		tree.reset();
		scheduleRender();
		renderInspector();
	}

	function handleNode(node) {
		if (!node || !node.id) return;

		// A linear scan per update would make a fan-out with N frames O(N²).
		// The position map is only invalidated by a snapshot, which rebuilds both.
		var index = nodePositions.has(node.id) ? nodePositions.get(node.id) : -1;

		if (index === -1) {
			nodePositions.set(node.id, state.nodes.length);
			state.nodes.push(node);
		} else {
			state.nodes[index] = node;
		}
		nodeIndex.set(node.id, node);

		// First sighting changes the tree structure; later frames update in
		// place — both funnel through the same rAF flush.
		if (index === -1) scheduleRender();
		else scheduleNodeUpdate(node.id);
	}

	function handleRun(run) {
		state.run = run || {};
		updateChrome();
		var status = (run && run.status) || "idle";
		var running = status === "running";

		// A plain send throws while the host is busy, so the composer locks.
		chat.setBusy(running);
		els.chatRunState.dataset.state = running ? "running" : status === "settled" ? "settled" : "idle";
		els.chatRunText.textContent = running ? "生成中" : status === "settled" ? "已结算" : "空闲";

		var rootCard = els.tree.querySelector(".root-card");
		if (rootCard) {
			rootCard.dataset.status = running ? "running" : "pending";
		}
	}

	// ------------------------------------------------------------ context usage

	/** Fractions at which the line stops being purely informational. */
	var USAGE_WARN = 0.75;
	var USAGE_CRITICAL = 0.92;

	/** Exact counts keep a thousands separator, as the reference row does. */
	function formatExact(value) {
		return (Number(value) || 0).toLocaleString("en-US");
	}

	/**
	 * Compact units, matching the reference row: raw below 1k, one decimal up to
	 * 10k, whole thousands up to 1M, one decimal of millions above that.
	 */
	function formatCompact(value) {
		var n = Number(value) || 0;
		if (n < 1000) return String(n);
		if (n < 10000) return (n / 1000).toFixed(1) + "k";
		if (n < 1000000) return Math.round(n / 1000) + "k";
		return (n / 1000000).toFixed(1) + "M";
	}

	function formatSeconds(ms) {
		if (typeof ms !== "number" || !isFinite(ms) || ms < 0) return null;
		return (ms / 1000).toFixed(1) + "s";
	}

	function handleUsage(usage) {
		if (!usage) return;
		state.usage = usage;
		renderUsage();
	}

	/** Compose the metric line: throughput first, context window last. */
	function renderUsage() {
		var usage = state.usage || {};
		var used = Number(usage.used) || 0;
		var limit = Number(usage.limit) || 0;
		var turn = usage.turn || null;

		var ratio = limit > 0 ? Math.min(1, used / limit) : 0;
		var level = "ok";
		if (limit > 0 && ratio >= USAGE_CRITICAL) level = "critical";
		else if (limit > 0 && ratio >= USAGE_WARN) level = "warn";
		els.usageBar.dataset.level = level;

		var parts = [];

		if (turn && typeof turn.rate === "number") parts.push(turn.rate.toFixed(1) + " tok/s");

		var ttft = turn ? formatSeconds(turn.ttftMs) : null;
		if (ttft) parts.push("首字 " + ttft);

		if (turn && turn.output > 0) {
			var generation = formatSeconds(turn.generationMs);
			parts.push("输出 " + formatExact(turn.output) + " tok" + (generation ? " / 生成 " + generation : ""));
		}

		if (typeof usage.recentRate === "number") parts.push("均值 " + usage.recentRate.toFixed(1));
		if (usage.sessionOutput > 0) parts.push("累计 " + formatCompact(usage.sessionOutput) + " tok");

		// The context reading is what the previous iteration added, and it stays:
		// "approaching the ceiling" is the only actionable signal on this line.
		if (limit > 0) {
			parts.push("上下文 " + formatCompact(used) + "/" + formatCompact(limit));
			if (level === "critical") parts.push("即将溢出，建议 /compact");
			else if (level === "warn") parts.push("接近上限");
		} else if (used > 0) {
			parts.push("上下文 " + formatCompact(used));
		}

		els.usageText.textContent = parts.length ? parts.join(" · ") : "等待首轮回复";
		els.usageClock.textContent = usage.at ? formatClock(usage.at) : "--:--:--";
	}

	/** Last frame sequence seen, for gap detection. */
	var lastSeq = 0;
	var resyncing = false;

	/**
	 * The hub drops frames for a slow reader rather than blocking its event loop,
	 * so a sequence gap means we are out of sync. Pull the full state instead of
	 * drifting silently until the next reconnect.
	 */
	function resync() {
		if (resyncing) return;
		resyncing = true;

		global
			.fetch("/api/snapshot", {
				headers: { "X-Orchestra-Token": token },
			})
			.then(function (response) {
				return response.ok ? response.json() : null;
			})
			.then(function (payload) {
				if (payload) handleSnapshot(payload);
			})
			.catch(function () {
				// Stay quiet: the next frame triggers another attempt.
			})
			.then(function () {
				resyncing = false;
			});
	}

	function dispatch(frame) {
		if (!frame || !frame.type) return;

		if (typeof frame.seq === "number") {
			if (frame.type === "snapshot") {
				// A snapshot re-anchors the sequence — after a reconnect or a
				// gateway restart the counter may legitimately move backwards.
				lastSeq = frame.seq;
			} else if (lastSeq !== 0) {
				// Frames buffered between subscribe and snapshot are replayed
				// after it; the snapshot already carries their effects, so
				// anything not ahead of lastSeq is a stale duplicate.
				if (frame.seq <= lastSeq) return;
				if (frame.seq !== lastSeq + 1) {
					lastSeq = frame.seq;
					resync();
					return;
				}
				lastSeq = frame.seq;
			} else {
				lastSeq = frame.seq;
			}
		}

		switch (frame.type) {
			case "snapshot":
				handleSnapshot(frame.payload || {});
				break;
			case "node":
				handleNode(frame.payload);
				break;
			case "run":
				handleRun(frame.payload);
				break;
			case "conversation_history":
				chat.replace(frame.payload || []);
				break;
			case "conversation":
				chat.upsert(frame.payload);
				break;
			case "action_ack":
				handleActionAck(frame.payload);
				break;
			case "profiles":
				profiles.apply(frame.payload || {});
				break;
			case "usage":
				handleUsage(frame.payload);
				break;
			default:
				break;
		}
	}

	function handleActionAck(payload) {
		if (!payload || payload.ok) return;
		// The matching local echo is retired and its text returned to the composer.
		chat.failPending("发送失败：" + (payload.error || "未知原因"));
	}

	// The composer hands us raw text; the gateway relays it to the extension,
	// which calls pi.sendUserMessage on the host. The message is echoed
	// locally right away so a slow host never looks like a dropped send.
	//
	// Mutations carry the token in the header only: the gateway rejects a
	// query-string token on anything but a read-only GET.
	chat.onSend = function (text) {
		chat.beginPending(text);

		global
			.fetch("/api/send", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Orchestra-Token": token
				},
				body: JSON.stringify({ text: text }),
			})
			.then(function (response) {
				if (!response.ok) throw new Error("HTTP " + response.status);
			})
			.catch(function () {
				chat.failPending("发送失败：编排网关未响应。");
			});
	};

	// ------------------------------------------------------------- mode switch

	var MODE_LABELS = { chat: "对话", orchestration: "编排" };
	/** Matches the .view cross-fade duration in liquid-glass.css. */
	var SWITCH_FADE_MS = 240;
	var switching = false;

	function setMode(mode) {
		if (switching || !MODE_LABELS[mode]) return;
		if (els.viewChat.dataset.active === (mode === "chat" ? "true" : "false") &&
			els.viewOrchestration.dataset.active === (mode === "chat" ? "false" : "true")) {
			return;
		}

		switching = true;
		els.modeSwitch.setAttribute("aria-busy", "true");

		// Both views stay mounted in the same grid cell, so this only flips
		// visibility. No data reload, no re-render — the tree's scroll offset,
		// its selected node, the chat scroll position, and any composer draft
		// all survive the switch untouched.
		els.viewOrchestration.dataset.active = mode === "orchestration" ? "true" : "false";
		els.viewChat.dataset.active = mode === "chat" ? "true" : "false";

		var target = mode === "chat" ? "orchestration" : "chat";
		els.modeSwitch.dataset.target = target;
		els.modeLabel.textContent = MODE_LABELS[target];
		els.modeSwitch.setAttribute("aria-label", "切换到" + MODE_LABELS[target] + "模式");

		// Release the double-click guard once the fade has settled.
		global.setTimeout(function () {
			switching = false;
			els.modeSwitch.removeAttribute("aria-busy");
		}, SWITCH_FADE_MS);
	}

	els.modeSwitch.addEventListener("click", function () {
		setMode(els.modeSwitch.dataset.target);
	});

	var source = null;
	var authCheckTimer = 0;

	/**
	 * EventSource cannot see HTTP status codes. When the stream drops, a quick
	 * snapshot probe tells a 401 (gateway restarted with a fresh token — the
	 * tab can never recover by itself) apart from ordinary network loss, which
	 * EventSource retry handles on its own.
	 */
	function scheduleAuthCheck() {
		if (authCheckTimer) return;
		authCheckTimer = global.setTimeout(function () {
			authCheckTimer = 0;
			global
				.fetch("/api/snapshot", {
					headers: { "X-Orchestra-Token": token },
				})
				.then(function (response) {
					if (response.status !== 401) return;
					if (source) {
						source.close();
						source = null;
					}
					setLive("down", "会话已失效，请重新运行 /orchestra 打开新面板");
				})
				.catch(function () {
					// Gateway unreachable: keep the EventSource retry loop going.
				});
		}, 2000);
	}

	function connect() {
		setLive("connecting", "连接中");

		source = new EventSource("/events?t=" + encodeURIComponent(token));

		source.onopen = function () {
			setLive("live", "实时");
		};

		source.onmessage = function (event) {
			var frame;
			try {
				frame = JSON.parse(event.data);
			} catch (error) {
				return;
			}
			dispatch(frame);
		};

		// EventSource retries on its own; only surface that there is a gap.
		source.onerror = function () {
			setLive("down", "重连中");
			scheduleAuthCheck();
		};
	}

	// ---------------------------------------------------------------- inspector

	/**
	 * Change signature of the inspector content. Progress frames for the
	 * selected node arrive many times per second; without the gate each one
	 * would rebuild the whole panel (args JSON, up to 200 agent rows).
	 */
	var inspectorSignature = null;

	function inspectorKey(node) {
		var agentShape = "";
		if (node.agents && node.agents.length) {
			agentShape = node.agents
				.map(function (agent) {
					return (agent.status || "") + ":" + (agent.tokens || 0);
				})
				.join(",");
		}
		return [
			node.id,
			node.label || "",
			node.toolName || "",
			node.mode || "",
			node.status || "",
			node.durationMs || 0,
			node.summary || "",
			node.text || "",
			node.tokens ? (node.tokens.input || 0) + "/" + (node.tokens.output || 0) : "",
			node.progress ? tree.progressKey(node) : "",
			agentShape
		].join("|");
	}

	function renderInspector(force) {
		var node = selectedId ? nodeIndex.get(selectedId) : null;
		var signature = node ? inspectorKey(node) : "";

		if (!force && signature === inspectorSignature) return;
		inspectorSignature = signature;

		els.inspector.textContent = "";

		if (!node) {
			els.inspector.appendChild(
				el("p", "inspector-hint", "选择左侧任一节点查看参数、子代理明细与耗时。")
			);
			return;
		}

		var head = el("div", "insp-section");
		head.appendChild(el("h1", "insp-title", node.label || node.toolName));

		var badges = el("div", "insp-badges");
		badges.appendChild(el("span", "pill", node.toolName || "tool"));
		if (node.mode) badges.appendChild(el("span", "mode-chip", node.mode));
		badges.appendChild(el("span", "pill", statusText(node.status)));
		if (node.orchestration) badges.appendChild(el("span", "pill", "编排节点"));
		head.appendChild(badges);
		els.inspector.appendChild(head);

		var facts = section("概况");
		var list = el("dl", "kv");
		var duration = node.durationMs || (node.endedAt && node.startedAt ? node.endedAt - node.startedAt : 0);

		appendAll(list, define("开始时间", formatClock(node.startedAt)));
		appendAll(list, define("耗时", tree.formatDuration(duration) || "—"));
		appendAll(
			list,
			define(
				"Token",
				node.tokens ? (node.tokens.input || 0) + " / " + (node.tokens.output || 0) : "—"
			)
		);
		if (node.agents && node.agents.length) {
			appendAll(list, define("子代理", node.agents.length + " 个"));
		}
		if (node.progress && node.progress.phase) {
			appendAll(list, define("阶段", node.progress.phase));
		}
		facts.appendChild(list);
		els.inspector.appendChild(facts);

		if (node.progress) {
			var bar = section("进度");
			var ratio = node.progress.total ? node.progress.completed / node.progress.total : 0;
			var track = el("div", "bar");
			var fill = el("span");
			fill.style.width = Math.max(0, Math.min(100, ratio * 100)).toFixed(1) + "%";
			track.appendChild(fill);
			bar.appendChild(track);

			var counters = el("div", "node-meta-row");
			counters.appendChild(el("span", "pill", node.progress.completed + "/" + node.progress.total));
			if (node.progress.running) counters.appendChild(el("span", "pill", "运行 " + node.progress.running));
			if (node.progress.queued) counters.appendChild(el("span", "pill", "排队 " + node.progress.queued));
			if (node.progress.failures) {
				var failPill = el("span", "pill", "失败 " + node.progress.failures);
				failPill.dataset.tone = "fail";
				counters.appendChild(failPill);
			}
			if (node.progress.cacheHits) counters.appendChild(el("span", "pill", "缓存 " + node.progress.cacheHits));
			bar.appendChild(counters);
			els.inspector.appendChild(bar);
		}

		if (node.summary || node.text) {
			var brief = section("任务摘要");
			brief.appendChild(el("p", "inspector-hint", node.summary || node.text));
			els.inspector.appendChild(brief);
		}

		if (node.agents && node.agents.length) {
			var agents = section("子代理明细");
			var listBox = el("div", "agent-list");

			node.agents.forEach(function (agent) {
				var row = el("div", "agent-row");
				var pip = el("span", "agent-pip");
				pip.dataset.status = (agent.status || "pending").toLowerCase();
				row.appendChild(pip);
				row.appendChild(el("span", "agent-name", agent.summary || agent.label));
				row.appendChild(el("span", "agent-tokens", agent.tokens ? tree.formatTokens(agent.tokens) : ""));
				listBox.appendChild(row);
			});

			agents.appendChild(listBox);
			els.inspector.appendChild(agents);
		}

		if (node.args && Object.keys(node.args).length) {
			var args = section("调用参数（已脱敏）");
			args.appendChild(el("pre", "code-block", JSON.stringify(node.args, null, 2)));
			els.inspector.appendChild(args);
		}
	}

	function appendAll(parent, nodes) {
		nodes.forEach(function (node) {
			parent.appendChild(node);
		});
	}

	function statusText(status) {
		var table = {
			pending: "等待中",
			running: "运行中",
			done: "已完成",
			failed: "已失败",
			cancelled: "已取消"
		};
		return table[status] || status || "未知";
	}

	function formatClock(timestamp) {
		if (!timestamp) return "—";
		var date = new Date(timestamp);
		var pad = function (value) {
			return String(value).padStart(2, "0");
		};
		return pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds());
	}

	// -------------------------------------------------------------- interaction

	els.tree.addEventListener("click", function (event) {
		var card = event.target.closest ? event.target.closest(".node-card[data-node-id]") : null;
		if (!card) return;

		var id = card.dataset.nodeId;
		selectedId = selectedId === id ? null : id;

		Array.prototype.forEach.call(els.tree.querySelectorAll(".node-card[data-selected]"), function (other) {
			delete other.dataset.selected;
		});
		if (selectedId) card.dataset.selected = "true";

		renderInspector();
	});

	els.filterOrchestration.addEventListener("change", function () {
		options.onlyOrchestration = els.filterOrchestration.checked;
		scheduleRender();
	});

	els.collapse.addEventListener("click", function () {
		options.collapseDone = !options.collapseDone;
		els.collapse.textContent = options.collapseDone ? "显示已完成" : "折叠已完成";
		scheduleRender();
	});

	// Running nodes need a live elapsed counter; touching only the time label
	// keeps hover state and scroll position intact. Skipped entirely when the
	// last computed stats show nothing is running.
	global.setInterval(function () {
		if (!lastStats.running) return;

		var running = els.tree.querySelectorAll('.node-card[data-status="running"][data-node-id]');
		Array.prototype.forEach.call(running, function (card) {
			var node = nodeIndex.get(card.dataset.nodeId);
			if (!node || !node.startedAt) return;
			var slot = card.querySelector(".node-time");
			if (slot) slot.textContent = tree.formatDuration(Date.now() - node.startedAt);
		});
	}, 1000);

	updateChrome();
	renderUsage();
	connect();
})(window);
