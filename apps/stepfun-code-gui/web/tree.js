/**
 * Orchestration tree renderer.
 *
 * Owns DOM construction only. Every value originating from the host is written
 * with textContent; innerHTML is used exclusively for the static icon paths
 * declared in this file, never for host data.
 */
(function (global) {
	"use strict";

	var SVG_NS = "http://www.w3.org/2000/svg";
	var RING_RADIUS = 11;
	var RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
	var MAX_LEAVES_RENDERED = 120;

	var STATUS_TEXT = {
		pending: "等待中",
		running: "运行中",
		done: "已完成",
		failed: "已失败",
		cancelled: "已取消"
	};

	/** Static markup constants, never built from host data. */
	var ICON_PATHS = {
		subagent:
			'<circle cx="12" cy="6" r="2.3"></circle>' +
			'<circle cx="6.4" cy="18" r="2.3"></circle>' +
			'<circle cx="17.6" cy="18" r="2.3"></circle>' +
			'<path d="M12 8.3 7.4 15.8M12 8.3l4.6 7.5M8.7 18h6.6"></path>',
		workflow:
			'<rect x="3" y="3.5" width="7" height="6" rx="2"></rect>' +
			'<rect x="14" y="3.5" width="7" height="6" rx="2"></rect>' +
			'<rect x="8.5" y="14.5" width="7" height="6" rx="2"></rect>' +
			'<path d="M6.5 9.5v2.5h11V9.5M12 12v2.5"></path>',
		read: '<path d="M5 4.5h9l5 5v10H5z"></path><path d="M14 4.5v5h5"></path>',
		write: '<path d="M5 4.5h9l5 5v10H5z"></path><path d="M14 4.5v5h5"></path>',
		edit: '<path d="M4 20h4l10-10-4-4L4 16z"></path><path d="M13.5 6.5l4 4"></path>',
		bash: '<path d="M5 7l5 5-5 5"></path><path d="M13 17h6"></path>',
		grep: '<circle cx="11" cy="11" r="5.5"></circle><path d="M15.2 15.2 20 20"></path>',
		find: '<circle cx="11" cy="11" r="5.5"></circle><path d="M15.2 15.2 20 20"></path>',
		ls: '<path d="M4 6.5h6l1.6 2H20v9.5H4z"></path>',
		default: '<circle cx="12" cy="12" r="7"></circle><path d="M12 8.5v4l2.6 1.6"></path>'
	};

	var ROOT_KEY = "__root__";
	/** nodeId -> { branch, card, leaves, leafCards: Map } */
	var cache = new Map();

	// ------------------------------------------------------------------ utils

	function el(tag, className, text) {
		var node = document.createElement(tag);
		if (className) node.className = className;
		if (text !== undefined && text !== null && text !== "") node.textContent = String(text);
		return node;
	}

	function svgEl(tag, attrs) {
		var node = document.createElementNS(SVG_NS, tag);
		if (attrs) {
			Object.keys(attrs).forEach(function (key) {
				node.setAttribute(key, String(attrs[key]));
			});
		}
		return node;
	}

	/**
	 * Own-property lookup. Tool names and statuses arrive from the host, and a
	 * plain `table[key]` would happily resolve `constructor` or `__proto__` to
	 * something truthy from the prototype chain.
	 */
	function lookup(table, key, fallback) {
		return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : fallback;
	}

	function iconNode(toolName) {
		var svg = svgEl("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" });
		svg.innerHTML = lookup(ICON_PATHS, toolName, ICON_PATHS.default);
		return svg;
	}

	function formatDuration(ms) {
		if (typeof ms !== "number" || !isFinite(ms) || ms <= 0) return "";
		if (ms < 1000) return Math.round(ms) + "ms";
		if (ms < 60000) return (ms / 1000).toFixed(1) + "s";
		var minutes = Math.floor(ms / 60000);
		var seconds = Math.round((ms % 60000) / 1000);
		return minutes + "m" + seconds + "s";
	}

	/**
	 * Compact token units, shared with the metric line under the composer so the
	 * same number never renders two different ways. Raw below 1k, one decimal to
	 * 10k, whole thousands to 1M, one decimal of millions above that.
	 */
	function formatTokens(value) {
		var n = Number(value) || 0;
		if (n < 1000) return String(n);
		if (n < 10000) return (n / 1000).toFixed(1) + "k";
		if (n < 1000000) return Math.round(n / 1000) + "k";
		return (n / 1000000).toFixed(1) + "M";
	}

	/** Cheap change key for the meta row; avoids JSON on a per-frame path. */
	function progressKey(node) {
		var progress = node.progress;
		var head = progress
			? [
					progress.running,
					progress.queued,
					progress.completed,
					progress.total,
					progress.failures,
					progress.cacheHits,
					progress.cancellations,
					progress.tokenSpend,
					progress.phase,
				].join("|")
			: "";

		var duration = node.durationMs || (node.endedAt && node.startedAt ? node.endedAt - node.startedAt : 0);
		var tokens = node.tokens ? (node.tokens.input || 0) + (node.tokens.output || 0) : 0;

		return head + "#" + duration + "#" + tokens;
	}

	function ratioOf(node) {
		var progress = node.progress;
		if (!progress || !progress.total) return null;
		return Math.max(0, Math.min(1, progress.completed / progress.total));
	}

	function progressRing(ratio) {
		var svg = svgEl("svg", { class: "ring", viewBox: "0 0 26 26", "aria-hidden": "true" });
		svg.appendChild(svgEl("circle", { class: "ring-track", cx: 13, cy: 13, r: RING_RADIUS }));

		var fill = svgEl("circle", { class: "ring-fill", cx: 13, cy: 13, r: RING_RADIUS });
		fill.setAttribute("stroke-dasharray", RING_CIRCUMFERENCE.toFixed(2));
		fill.setAttribute("stroke-dashoffset", (RING_CIRCUMFERENCE * (1 - ratio)).toFixed(2));
		svg.appendChild(fill);

		return svg;
	}

	// ------------------------------------------------------------- card parts

	function progressPills(node) {
		var progress = node.progress;
		if (!progress) return null;

		var row = el("div", "node-meta-row");

		if (progress.running) row.appendChild(el("span", "pill", "运行 " + progress.running));
		if (progress.queued) row.appendChild(el("span", "pill", "排队 " + progress.queued));
		if (progress.total) row.appendChild(el("span", "pill", progress.completed + "/" + progress.total));
		if (progress.failures) {
			row.appendChild(el("span", "pill", "失败 " + progress.failures)).dataset.tone = "fail";
		}
		if (progress.cacheHits) row.appendChild(el("span", "pill", "缓存 " + progress.cacheHits));
		if (progress.tokenSpend) row.appendChild(el("span", "pill", formatTokens(progress.tokenSpend) + " tok"));

		return row.childNodes.length ? row : null;
	}

	// ---------------------------------------------------------------- node card

	function buildCard(node) {
		var card = el(node.orchestration ? "button" : "div", "node-card");
		if (node.orchestration) card.type = "button";
		card.setAttribute("role", "treeitem");
		card.dataset.nodeId = node.id;

		card.appendChild(el("span", "node-rail")).setAttribute("aria-hidden", "true");
		card.appendChild(el("span", "card-glow")).setAttribute("aria-hidden", "true");

		var iconBox = el("span", "node-icon");
		iconBox.appendChild(iconNode(node.toolName));
		card.appendChild(iconBox);

		var body = el("div", "node-body");
		body.appendChild(el("div", "node-top")).appendChild(el("span", "node-label"));

		// The mode chip lives outside the top row so updates never reorder nodes.
		var sub = el("div", "node-sub");
		body.appendChild(sub);

		var meta = el("div", "node-meta-row");
		body.appendChild(meta);
		card.appendChild(body);

		var right = el("div", "node-right");
		right.appendChild(el("span", "node-time"));
		card.appendChild(right);

		return card;
	}

	function updateCard(card, node) {
		card.dataset.status = node.status || "pending";
		card.dataset.orchestration = node.orchestration ? "true" : "false";

		card.querySelector(".node-label").textContent = node.label || node.toolName || "工具";

		var top = card.querySelector(".node-top");
		var chip = top.querySelector(".mode-chip");
		if (node.mode) {
			if (!chip) {
				chip = el("span", "mode-chip");
				top.appendChild(chip);
			}
			chip.textContent = node.mode;
		} else if (chip) {
			chip.remove();
		}

		var subText = node.summary || node.text || lookup(STATUS_TEXT, node.status, "");
		var sub = card.querySelector(".node-sub");
		if (sub.textContent !== subText) sub.textContent = subText;

		// Meta pills: rebuild only when the snapshot actually changed.
		var meta = card.querySelector(".node-meta-row");
		var signature = progressKey(node);
		if (meta.dataset.signature !== signature) {
			meta.dataset.signature = signature;
			meta.textContent = "";

			var pills = progressPills(node);
			if (pills) {
				while (pills.firstChild) meta.appendChild(pills.firstChild);
			}

			var duration = node.durationMs || (node.endedAt && node.startedAt ? node.endedAt - node.startedAt : 0);
			var durationText = formatDuration(duration);
			if (durationText) meta.appendChild(el("span", "pill", durationText));

			var tokenTotal = node.tokens ? (node.tokens.input || 0) + (node.tokens.output || 0) : 0;
			if (tokenTotal) meta.appendChild(el("span", "pill", formatTokens(tokenTotal) + " tok"));
		}

		// The right slot updates in place: rebuilding the ring SVG every frame
		// would discard its stroke-dashoffset transition, so the offset is set
		// on the existing element and only presence is managed here.
		var right = card.querySelector(".node-right");
		var ratio = ratioOf(node);
		var wantRing = ratio !== null && node.status === "running";
		var ring = right.querySelector(".ring");

		if (wantRing && !ring) {
			right.insertBefore(progressRing(ratio), right.firstChild);
		} else if (wantRing && ring) {
			ring.querySelector(".ring-fill").setAttribute(
				"stroke-dashoffset",
				(RING_CIRCUMFERENCE * (1 - ratio)).toFixed(2)
			);
		} else if (!wantRing && ring) {
			ring.remove();
		}

		var time = node.status === "running" && node.startedAt ? Date.now() - node.startedAt : node.durationMs;
		var timeEl = right.querySelector(".node-time");
		if (!timeEl) {
			timeEl = el("span", "node-time");
			right.appendChild(timeEl);
		}
		timeEl.textContent = formatDuration(time);
	}

	// --------------------------------------------------------------- leaf card

	function buildLeaf(agent) {
		var card = el("div", "node-card leaf");
		card.dataset.leaf = "true";
		card.setAttribute("role", "treeitem");

		card.appendChild(el("span", "node-rail")).setAttribute("aria-hidden", "true");
		card.appendChild(el("span", "card-glow")).setAttribute("aria-hidden", "true");

		var pip = el("span", "agent-pip");
		card.appendChild(pip);

		var body = el("div", "node-body");
		body.appendChild(el("div", "node-top")).appendChild(el("span", "node-label"));
		body.appendChild(el("div", "node-sub"));
		card.appendChild(body);

		var right = el("div", "node-right");
		right.appendChild(el("span", "node-time"));
		card.appendChild(right);

		return card;
	}

	function updateLeaf(card, agent) {
		var status = (agent.status || "pending").toLowerCase();
		card.dataset.status = status;

		card.querySelector(".agent-pip").dataset.status = status;
		card.querySelector(".node-label").textContent = agent.label || "agent";

		var sub = card.querySelector(".node-sub");
		var subText = agent.summary || lookup(STATUS_TEXT, status, "");
		if (sub.textContent !== subText) sub.textContent = subText;

		card.querySelector(".node-time").textContent = agent.tokens ? formatTokens(agent.tokens) + " tok" : "";
	}

	// ----------------------------------------------------------------- branches

	function ensureBranch(node) {
		var entry = cache.get(node.id);
		if (!entry) {
			entry = { branch: el("div", "branch"), card: null, leaves: null, leafCards: new Map() };
			cache.set(node.id, entry);
		}
		if (!entry.card) {
			entry.card = buildCard(node);
			entry.branch.appendChild(entry.card);
		}
		return entry;
	}

	function syncLeaves(entry, agents) {
		var list = (agents || []).slice(0, MAX_LEAVES_RENDERED);
		if (!list.length) {
			if (entry.leaves) {
				entry.leaves.remove();
				entry.leaves = null;
			}
			entry.leafCards.clear();
			return;
		}

		if (!entry.leaves) {
			entry.leaves = el("div", "leaves");
			entry.branch.appendChild(entry.leaves);
		}

		var seen = new Set();
		list.forEach(function (agent, index) {
			var key = agent.id || agent.label + "#" + index;
			seen.add(key);

			var card = entry.leafCards.get(key);
			if (!card) {
				card = buildLeaf(agent);
				entry.leafCards.set(key, card);
			}
			updateLeaf(card, agent);

			// Only touch the DOM when the card is not already at its position:
			// re-appending an attached element cancels and restarts its CSS
			// animation, so an unconditional appendChild would make the whole
			// agent grid blink on every progress frame.
			if (entry.leaves.children[index] !== card) {
				entry.leaves.insertBefore(card, entry.leaves.children[index] || null);
			}
		});

		entry.leafCards.forEach(function (card, key) {
			if (!seen.has(key)) {
				card.remove();
				entry.leafCards.delete(key);
			}
		});
	}

	function rootEntry() {
		var entry = cache.get(ROOT_KEY);
		if (!entry) {
			entry = { branch: el("div", "branch root-branch"), card: null, leaves: null, leafCards: new Map() };
			cache.set(ROOT_KEY, entry);
		}
		if (!entry.card) {
			var card = el("div", "node-card root-card");
			card.setAttribute("role", "treeitem");
			card.appendChild(el("span", "node-rail")).setAttribute("aria-hidden", "true");
			card.appendChild(el("span", "card-glow")).setAttribute("aria-hidden", "true");

			var iconBox = el("span", "node-icon");
			iconBox.appendChild(iconNode("default"));
			card.appendChild(iconBox);

			var body = el("div", "node-body");
			body.appendChild(el("div", "node-top")).appendChild(el("span", "node-label", "主代理"));
			body.appendChild(el("div", "node-sub"));
			body.appendChild(el("div", "node-meta-row"));
			card.appendChild(body);

			var right = el("div", "node-right");
			right.appendChild(el("span", "node-time"));
			card.appendChild(right);

			entry.card = card;
			entry.branch.appendChild(card);
		}
		return entry;
	}

	function updateRoot(state, visibleCount, totalCount) {
		var entry = rootEntry();
		var card = entry.card;
		var session = state.session || {};
		var run = state.run || {};

		var status = run.status === "running" ? "running" : run.status === "settled" ? "done" : "pending";
		card.dataset.status = status;

		card.querySelector(".node-sub").textContent = session.cwd || "等待会话";

		var meta = card.querySelector(".node-meta-row");
		meta.textContent = "";
		meta.appendChild(el("span", "pill", visibleCount + "/" + totalCount + " 节点"));
		if (session.model) meta.appendChild(el("span", "pill", session.model));

		return entry;
	}

	// ------------------------------------------------------------------- public

	function shouldShow(node, options) {
		if (options.onlyOrchestration && !node.orchestration) return false;
		if (
			options.collapseDone &&
			!node.orchestration &&
			(node.status === "done" || node.status === "cancelled")
		) {
			return false;
		}
		return true;
	}

	/**
	 * Full structural render, done incrementally: cached branches are moved
	 * only when their position actually changed, so surviving cards keep their
	 * animation state and only genuinely new nodes play the entrance.
	 */
	function render(container, state, options) {
		var nodes = state.nodes || [];
		var visible = nodes.filter(function (node) {
			return shouldShow(node, options);
		});

		var scrollTop = container.scrollTop;
		var seen = new Set();

		var root = updateRoot(state, visible.length, nodes.length).branch;
		if (container.firstChild !== root) {
			container.insertBefore(root, container.firstChild);
		}

		var position = 1;
		visible.forEach(function (node) {
			var entry = ensureBranch(node);
			updateCard(entry.card, node);
			syncLeaves(entry, node.agents);
			if (container.children[position] !== entry.branch) {
				container.insertBefore(entry.branch, container.children[position] || null);
			}
			position += 1;
			seen.add(node.id);
		});

		while (container.children.length > position) {
			container.removeChild(container.lastChild);
		}
		container.scrollTop = scrollTop;

		cache.forEach(function (entry, key) {
			if (key !== ROOT_KEY && !seen.has(key)) cache.delete(key);
		});
	}

	/** In-place update for a single node. Falls back to a structural render. */
	function upsert(container, state, options, node) {
		if (!shouldShow(node, options)) {
			render(container, state, options);
			return;
		}

		var entry = cache.get(node.id);
		if (!entry || !entry.card || !entry.card.isConnected) {
			render(container, state, options);
			return;
		}

		updateCard(entry.card, node);
		syncLeaves(entry, node.agents);
		updateRoot(state, countVisible(state, options), (state.nodes || []).length);
	}

	function countVisible(state, options) {
		return (state.nodes || []).filter(function (node) {
			return shouldShow(node, options);
		}).length;
	}

	function reset() {
		cache.clear();
	}

	global.OrchestraTree = {
		render: render,
		upsert: upsert,
		reset: reset,
		formatTokens: formatTokens,
		formatDuration: formatDuration,
		progressKey: progressKey,
		visibleCount: countVisible
	};
})(window);
