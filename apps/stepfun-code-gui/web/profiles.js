/**
 * API credential picker.
 *
 * The browser never receives a plaintext key. The roster arrives pre-masked and
 * keys only travel one way — from the input field to the gateway. Activation is
 * a POST after which the gateway pushes the credential into the host's provider
 * registry, which takes effect on the next request.
 */
(function (global) {
	"use strict";

	var picker = document.getElementById("account-picker");
	var popover = document.getElementById("account-popover");
	var dot = document.getElementById("account-dot");
	var nameEl = document.getElementById("account-name");
	var keyEl = document.getElementById("account-key");
	var listEl = document.getElementById("profile-list");
	var errorEl = document.getElementById("account-error");
	var newButton = document.getElementById("account-new");
	var form = document.getElementById("profile-form");

	var fields = {
		name: document.getElementById("pf-name"),
		provider: document.getElementById("pf-provider"),
		key: document.getElementById("pf-key"),
		baseUrl: document.getElementById("pf-baseurl"),
		cancel: document.getElementById("pf-cancel"),
	};

	// Bootstrapped by token.js from the URL fragment; mutations send it as a
	// header because the gateway only honours a query token on read-only GETs.
	var token = global.OrchestraToken || "";

	var profiles = [];
	var activeId = null;
	var lastError = "";
	var editingId = null;

	/** Min length before a key is treated as plausibly complete. */
	var MIN_KEY_LENGTH = 12;

	function el(tag, className, text) {
		var node = document.createElement(tag);
		if (className) node.className = className;
		if (text !== undefined && text !== null && text !== "") node.textContent = String(text);
		return node;
	}

	/** Read-only requests may carry the token in the query string. */
	function readUrl(path) {
		return path + (path.indexOf("?") === -1 ? "?" : "&") + "t=" + encodeURIComponent(token);
	}

	function setError(message) {
		if (!message) {
			errorEl.hidden = true;
			errorEl.textContent = "";
			return;
		}
		errorEl.textContent = message;
		errorEl.hidden = false;
	}

	// ------------------------------------------------------------------ render

	function findActive() {
		for (var index = 0; index < profiles.length; index += 1) {
			if (profiles[index].id === activeId) return profiles[index];
		}
		return null;
	}

	function renderHeader() {
		var active = findActive();

		if (!active) {
			nameEl.textContent = "未配置账户";
			keyEl.textContent = profiles.length ? "未选择" : "点击配置";
			dot.dataset.state = "missing";
			return;
		}

		nameEl.textContent = active.name || active.provider || "未命名";
		keyEl.textContent = active.keyHint || "未设置密钥";
		dot.dataset.state = lastError ? "rejected" : active.state;
	}

	function describe(profile) {
		var parts = [profile.provider || "未知 provider"];
		if (profile.keyHint) parts.push(profile.keyHint);
		if (profile.baseUrl) parts.push(profile.baseUrl);

		if (profile.state === "missing") parts.push("· 缺少密钥");
		else if (profile.state === "suspicious") parts.push("· 密钥长度异常");
		else if (profile.active && lastError) parts.push("· " + lastError);

		return parts.join("  ");
	}

	function iconButton(label, pathData, danger, handler) {
		var button = el("button", "icon-btn");
		button.type = "button";
		button.setAttribute("aria-label", label);
		button.title = label;
		if (danger) button.dataset.danger = "true";
		button.addEventListener("click", function (event) {
			event.stopPropagation();
			handler();
		});

		var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("viewBox", "0 0 24 24");
		svg.setAttribute("aria-hidden", "true");

		var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
		path.setAttribute("d", pathData);
		path.setAttribute("fill", "none");
		svg.appendChild(path);
		button.appendChild(svg);

		return button;
	}

	function renderItem(profile) {
		var usable = profile.state !== "missing";
		var item = el("div", "profile-item");
		item.setAttribute("role", "button");
		item.dataset.active = profile.active ? "true" : "false";

		var actionable = usable && !profile.active;
		item.tabIndex = actionable ? 0 : -1;
		item.setAttribute("aria-disabled", actionable ? "false" : "true");

		if (actionable) {
			item.addEventListener("click", function () {
				activate(profile.id);
			});
			item.addEventListener("keydown", function (event) {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					activate(profile.id);
				}
			});
		}

		var pip = el("span", "account-dot");
		pip.dataset.state = profile.active && lastError ? "rejected" : profile.state;
		item.appendChild(pip);

		var body = el("div", "profile-body");
		var nameRow = el("div", "profile-name");
		nameRow.appendChild(el("span", null, profile.name || profile.provider || "未命名"));
		if (profile.active) nameRow.appendChild(el("span", "profile-current", "当前"));
		body.appendChild(nameRow);

		var meta = el("div", "profile-meta");
		meta.dataset.state = profile.state;
		meta.textContent = describe(profile);
		body.appendChild(meta);
		item.appendChild(body);

		var actions = el("div", "profile-actions");
		actions.appendChild(
			iconButton("编辑", "M4 20h4l10-10-4-4L4 16zM13.5 6.5l4 4", false, function () {
				openForm(profile);
			})
		);
		actions.appendChild(
			iconButton("删除", "M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12", true, function () {
				remove(profile);
			})
		);
		item.appendChild(actions);

		return item;
	}

	function renderList() {
		listEl.textContent = "";

		if (!profiles.length) {
			listEl.appendChild(el("p", "profile-empty", "还没有配置。点击「新增」填入 API 密钥。"));
			return;
		}

		profiles.forEach(function (profile) {
			listEl.appendChild(renderItem(profile));
		});
	}

	function apply(payload) {
		profiles = Array.isArray(payload.profiles) ? payload.profiles : [];
		activeId = payload.activeId || null;
		lastError = payload.lastError || "";

		renderHeader();
		renderList();

		// Clear a stale banner too: a later successful request must be able to
		// take an earlier "credential rejected" message off the screen.
		setError(lastError);
	}

	function refresh() {
		return global
			.fetch(readUrl("/api/profiles"), { headers: { "X-Orchestra-Token": token } })
			.then(function (response) {
				return response.ok ? response.json() : null;
			})
			.then(function (payload) {
				if (payload) apply(payload);
			})
			.catch(function () {
				// Offline: keep whatever roster is already on screen.
			});
	}

	// ----------------------------------------------------------------- actions

	function activate(id) {
		setError("");

		global
			.fetch("/api/profiles/activate", {
				method: "POST",
				headers: { "Content-Type": "application/json", "X-Orchestra-Token": token },
				body: JSON.stringify({ id: id }),
			})
			.then(function (response) {
				if (response.ok) return refresh();
				return response.text().then(function (text) {
					setError("切换失败：" + (text.trim() || "HTTP " + response.status));
				});
			})
			.catch(function () {
				setError("切换失败：网关未响应。");
			});
	}

	function remove(profile) {
		var label = profile.name || profile.provider || "该配置";
		if (!global.confirm("删除配置「" + label + "」？此操作不可撤销。")) return;

		global
			.fetch("/api/profiles?id=" + encodeURIComponent(profile.id), {
				method: "DELETE",
				headers: { "X-Orchestra-Token": token },
			})
			.then(function (response) {
				if (response.ok) return refresh();
				return response.text().then(function (text) {
					setError("删除失败：" + (text.trim() || "HTTP " + response.status));
				});
			})
			.catch(function () {
				setError("删除失败：网关未响应。");
			});
	}

	// -------------------------------------------------------------------- form

	function clearValidity() {
		Object.keys(fields).forEach(function (name) {
			if (fields[name] && fields[name].dataset) delete fields[name].dataset.invalid;
		});
	}

	function openForm(profile) {
		editingId = profile ? profile.id : null;

		fields.name.value = profile ? profile.name || "" : "";
		fields.provider.value = profile ? profile.provider || "" : "";
		fields.key.value = "";
		fields.baseUrl.value = profile ? profile.baseUrl || "" : "";

		// Editing leaves the key blank: the server keeps the stored secret, so the
		// browser is never asked to hold a value it was never given.
		fields.key.placeholder =
			profile && profile.keyHint ? "留空则保留现有密钥（" + profile.keyHint + "）" : "sk-...";

		clearValidity();
		setError("");
		form.hidden = false;
		fields.name.focus();
	}

	function closeForm() {
		editingId = null;
		form.hidden = true;
		form.reset();
		clearValidity();
	}

	function validate(payload) {
		var problems = [];

		if (!payload.name) problems.push("请填写名称。");
		if (!payload.provider) problems.push("请填写 provider。");
		if (!editingId && !payload.apiKey) problems.push("请填写 API 密钥。");
		if (payload.apiKey && payload.apiKey.length < MIN_KEY_LENGTH) {
			problems.push("密钥长度异常，请确认是否完整粘贴。");
		}

		return problems;
	}

	function markValidity() {
		clearValidity();
		if (!fields.name.value.trim()) fields.name.dataset.invalid = "true";
		if (!fields.provider.value.trim()) fields.provider.dataset.invalid = "true";

		var key = fields.key.value.trim();
		if (!editingId && !key) fields.key.dataset.invalid = "true";
		else if (key && key.length < MIN_KEY_LENGTH) fields.key.dataset.invalid = "true";
	}

	function submitForm(event) {
		event.preventDefault();

		var payload = {
			id: editingId || "",
			name: fields.name.value.trim(),
			provider: fields.provider.value.trim(),
			apiKey: fields.key.value.trim(),
			baseUrl: fields.baseUrl.value.trim(),
		};

		var problems = validate(payload);
		markValidity();
		if (problems.length) {
			setError(problems[0]);
			return;
		}

		setError("");

		global
			.fetch("/api/profiles", {
				method: "POST",
				headers: { "Content-Type": "application/json", "X-Orchestra-Token": token },
				body: JSON.stringify(payload),
			})
			.then(function (response) {
				if (!response.ok) {
					return response.text().then(function (text) {
						setError("保存失败：" + (text.trim() || "HTTP " + response.status));
					});
				}
				closeForm();
				return refresh();
			})
			.catch(function () {
				setError("保存失败：网关未响应。");
			});
	}

	// --------------------------------------------------------------- popover

	function togglePopover(open) {
		var next = typeof open === "boolean" ? open : popover.hidden;

		popover.hidden = !next;
		picker.setAttribute("aria-expanded", next ? "true" : "false");

		if (next) {
			setError("");
			refresh();
			return;
		}
		closeForm();
	}

	picker.addEventListener("click", function (event) {
		event.stopPropagation();
		togglePopover();
	});

	document.addEventListener("click", function (event) {
		if (popover.hidden) return;
		if (popover.contains(event.target) || picker.contains(event.target)) return;
		togglePopover(false);
	});

	document.addEventListener("keydown", function (event) {
		if (event.key === "Escape" && !popover.hidden) togglePopover(false);
	});

	newButton.addEventListener("click", function () {
		openForm(null);
	});

	fields.cancel.addEventListener("click", closeForm);
	form.addEventListener("submit", submitForm);

	form.addEventListener("input", function () {
		clearValidity();
		setError("");
	});

	renderHeader();

	global.OrchestraProfiles = {
		apply: apply,
		refresh: refresh,
		setError: setError,
	};
})(window);
