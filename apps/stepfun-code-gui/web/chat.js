/**
 * Chat view renderer.
 *
 * Owns message DOM only. Streaming updates mutate the existing bubble instead of
 * rebuilding the list, so the log never flickers and the scroll position holds.
 * Bubbles are keyed by message id, which keeps updates O(1).
 */
(function (global) {
	"use strict";

	var MAX_RENDERED = 400;
	/** Distance from the bottom, in px, still treated as "pinned". */
	var PIN_THRESHOLD = 72;

	var list = document.getElementById("chat-log");
	var empty = document.getElementById("chat-empty");
	var form = document.getElementById("composer");
	var input = document.getElementById("composer-input");
	var sendButton = document.getElementById("composer-send");
	var bottomButton = document.getElementById("btn-chat-bottom");

	var bubbles = new Map();
	var order = [];
	var busy = false;
	var enabled = true;
	var pinned = true;

	/**
	 * Locally echoed sends awaiting the host's replay of the same turn. The
	 * first-in pending resolves first because user messages are echoed in
	 * order; text matching is only a fast path (the host may expand templates).
	 */
	var pendings = [];

	function el(tag, className, text) {
		var node = document.createElement(tag);
		if (className) node.className = className;
		if (text !== undefined && text !== null && text !== "") node.textContent = String(text);
		return node;
	}

	// ---------------------------------------------------------------- scrolling

	function atBottom() {
		return list.scrollHeight - list.scrollTop - list.clientHeight < PIN_THRESHOLD;
	}

	function scrollToBottom(smooth) {
		list.scrollTo({ top: list.scrollHeight, behavior: smooth ? "smooth" : "auto" });
		pinned = true;
		bottomButton.disabled = true;
	}

	function refreshPinned() {
		pinned = atBottom();
		bottomButton.disabled = pinned;
	}

	// ------------------------------------------------------------------ bubbles

	function createBubble(message) {
		var bubble = el("div", "msg");
		bubble.dataset.role = message.role || "assistant";
		bubble.dataset.messageId = message.id || "";
		return bubble;
	}

	function updateBubble(bubble, message) {
		var text = typeof message.text === "string" ? message.text : "";
		if (bubble.textContent !== text) bubble.textContent = text;
		bubble.dataset.streaming = message.streaming ? "true" : "false";
		return bubble;
	}

	function trim() {
		while (order.length > MAX_RENDERED) {
			var droppedId = order.shift();
			var dropped = bubbles.get(droppedId);
			if (dropped) dropped.remove();
			bubbles.delete(droppedId);
		}
	}

	function refreshEmpty() {
		empty.hidden = order.length > 0;
	}

	// -------------------------------------------------------------------- api

	/** Full rebuild, used for the session history replay and on reconnect. */
	function replace(messages) {
		list.textContent = "";
		bubbles.clear();
		order.length = 0;
		pendings.length = 0;

		(messages || []).forEach(function (message) {
			if (!message || !message.id) return;
			var bubble = updateBubble(createBubble(message), message);
			bubbles.set(message.id, bubble);
			order.push(message.id);
			list.appendChild(bubble);
		});

		trim();
		refreshEmpty();
		scrollToBottom(false);
	}

	/** Insert or update one message, preserving scroll intent. */
	function upsert(message) {
		if (!message || !message.id) return;

		var wasPinned = pinned || atBottom();

		// A user turn arriving from the host resolves the local echo of the
		// same send. Match by text first, fall back to FIFO — the host may
		// have expanded templates, but the order still holds.
		if (message.role === "user") resolvePending(message.text);

		var bubble = bubbles.get(message.id);

		if (bubble) {
			updateBubble(bubble, message);
		} else {
			bubble = updateBubble(createBubble(message), message);
			bubbles.set(message.id, bubble);
			order.push(message.id);
			list.appendChild(bubble);
			trim();
			refreshEmpty();
		}

		if (wasPinned) scrollToBottom(false);
		else refreshPinned();
	}

	function clear() {
		list.textContent = "";
		bubbles.clear();
		order.length = 0;
		pendings.length = 0;
		refreshEmpty();
		pinned = true;
		scrollToBottom(false);
	}

	// ------------------------------------------------------------ local echo

	function dropPendingBubble(entry) {
		var bubble = bubbles.get(entry.id);
		if (bubble) bubble.remove();
		bubbles.delete(entry.id);
		var at = order.indexOf(entry.id);
		if (at !== -1) order.splice(at, 1);
	}

	/** Echo a sent message locally so it is visible before the host replays it. */
	function beginPending(text) {
		var bubble = el("div", "msg", text);
		bubble.dataset.role = "user";
		bubble.dataset.pending = "true";

		var id = "pending-" + Date.now() + "-" + order.length;
		bubbles.set(id, bubble);
		order.push(id);
		list.appendChild(bubble);
		trim();
		refreshEmpty();
		scrollToBottom(false);

		var entry = { id: id, text: text };
		pendings.push(entry);
		return entry;
	}

	/** Retire the local echo once the host's own copy is on screen. */
	function resolvePending(text) {
		if (!pendings.length) return;

		var index = -1;
		for (var i = 0; i < pendings.length; i += 1) {
			if (pendings[i].text === text) {
				index = i;
				break;
			}
		}
		var entry = index >= 0 ? pendings.splice(index, 1)[0] : pendings.shift();
		dropPendingBubble(entry);
		refreshEmpty();
	}

	/** A send failed: drop the echo, put the text back in the composer. */
	function failPending(errorText) {
		var entry = pendings.shift();
		if (entry) {
			dropPendingBubble(entry);
			refreshEmpty();
			input.value = entry.text;
			autoGrow();
		}
		refreshSendState();
		showError(errorText || "发送失败。");
	}

	/** Surface a local failure (a rejected send) as a distinct bubble. */
	function showError(text) {
		var bubble = el("div", "msg", text);
		bubble.dataset.role = "assistant";
		bubble.dataset.failed = "true";

		// Errors join the same bookkeeping as real messages. Otherwise the
		// empty-state hint would render alongside them (it counts `order`), and
		// repeated failures would append bubbles that trim() never reclaims.
		var id = "error-" + Date.now() + "-" + order.length;
		bubbles.set(id, bubble);
		order.push(id);
		list.appendChild(bubble);

		trim();
		refreshEmpty();
		scrollToBottom(false);
	}

	function setBusy(value) {
		busy = Boolean(value);
		// Busy no longer locks the composer: the extension queues busy-time
		// sends as followUp, so the send stays available — just labelled.
		sendButton.title = busy ? "生成中，发送的消息将排队送达" : "";
		refreshSendState();
	}

	function setEnabled(value) {
		enabled = Boolean(value);
		refreshSendState();
	}

	// ------------------------------------------------------------------ composer

	function autoGrow() {
		input.style.height = "auto";
		input.style.height = Math.min(input.scrollHeight, 168) + "px";
	}

	function refreshSendState() {
		sendButton.disabled = input.value.trim().length === 0 || !enabled;
		input.disabled = !enabled;
	}

	function submit() {
		var text = input.value.trim();
		if (!text || !enabled) return;

		var hook = global.OrchestraChat.onSend;
		if (typeof hook !== "function") return;

		hook(text);

		input.value = "";
		autoGrow();
		refreshSendState();
	}

	input.addEventListener("input", function () {
		autoGrow();
		refreshSendState();
	});

	input.addEventListener("keydown", function (event) {
		// isComposing: never hijack Enter while an IME candidate list is open.
		if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			submit();
		}
	});

	form.addEventListener("submit", function (event) {
		event.preventDefault();
		submit();
	});

	list.addEventListener(
		"scroll",
		function () {
			refreshPinned();
		},
		{ passive: true }
	);

	bottomButton.addEventListener("click", function () {
		scrollToBottom(true);
	});

	autoGrow();
	refreshSendState();
	refreshEmpty();

	global.OrchestraChat = {
		replace: replace,
		upsert: upsert,
		clear: clear,
		showError: showError,
		beginPending: beginPending,
		failPending: failPending,
		setBusy: setBusy,
		setEnabled: setEnabled,
		/** Assigned by app.js. */
		onSend: null,
	};
})(window);
