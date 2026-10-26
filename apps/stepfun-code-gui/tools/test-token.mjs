#!/usr/bin/env node
/**
 * Panel token bootstrap regression.
 *
 * web/token.js is the only place that reads the panel URL fragment. It runs in
 * a browser, so these checks evaluate the file against a fake `window`: the
 * parsing rules, the address-bar cleanup, and the per-tab sessionStorage
 * fallback are all pinned here without needing a DOM.
 *
 * Usage: node tools/test-token.mjs
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(HERE, "..", "web", "token.js"), "utf8");

/** Evaluate token.js against a minimal browser-ish global object. */
function boot({ hash = "", storage = new Map(), replaceStateThrows = false } = {}) {
	const replaced = [];
	const window = {
		location: { hash, pathname: "/", search: "" },
		history: {
			replaceState(state, title, url) {
				if (replaceStateThrows) throw new Error("blocked");
				replaced.push(url);
				// Model the browser: the fragment is gone after replacement.
				window.location.hash = "";
			},
		},
		sessionStorage: {
			getItem: (key) => (storage.has(key) ? storage.get(key) : null),
			setItem: (key, value) => storage.set(key, String(value)),
		},
	};
	// token.js ends with `})(window);` — provide `window` as the parameter.
	new Function("window", `${SOURCE}\nreturn window;`)(window);
	return { window, replaced, storage };
}

const checks = [];
const check = (name, fn) => {
	try {
		fn();
		checks.push({ name, passed: true });
	} catch (error) {
		checks.push({ name, passed: false, detail: error.message });
	}
};

check("fragment token is parsed and exposed", () => {
	const { window } = boot({ hash: "#t=0123456789abcdef" });
	assert.equal(window.OrchestraToken, "0123456789abcdef");
	assert.equal(window.OrchestraTokenFromHash("#t=ab-cd_ef"), "ab-cd_ef");
});

check("fragment is stripped from the address bar", () => {
	const { replaced, window } = boot({ hash: "#t=0123456789abcdef" });
	assert.deepEqual(replaced, ["/"]);
	assert.equal(window.location.hash, "");
});

check("missing or malformed fragment yields no token", () => {
	assert.equal(boot({ hash: "" }).window.OrchestraToken, "");
	assert.equal(boot({ hash: "#" }).window.OrchestraToken, "");
	assert.equal(boot({ hash: "#other=1" }).window.OrchestraToken, "");
	assert.equal(boot().window.OrchestraTokenFromHash(undefined), "");
	assert.equal(boot().window.OrchestraTokenFromHash(null), "");
});

check("token survives a refresh via sessionStorage", () => {
	const storage = new Map();
	const first = boot({ hash: "#t=feedface", storage });
	assert.equal(first.window.OrchestraToken, "feedface");
	// A reload has no fragment left, same-tab storage still holds the token.
	const second = boot({ hash: "", storage });
	assert.equal(second.window.OrchestraToken, "feedface");
	// A fresh tab (empty storage) gets nothing.
	assert.equal(boot({ hash: "" }).window.OrchestraToken, "");
});

check("a new fragment replaces the stored token", () => {
	const storage = new Map();
	boot({ hash: "#t=oldtoken", storage });
	const next = boot({ hash: "#t=newtoken", storage });
	assert.equal(next.window.OrchestraToken, "newtoken");
	assert.equal(storage.get("step-orchestra:token"), "newtoken");
});

check("history.replaceState failure does not drop the token", () => {
	const { window } = boot({ hash: "#t=abc123", replaceStateThrows: true });
	assert.equal(window.OrchestraToken, "abc123");
});

let failed = 0;
for (const item of checks) {
	if (!item.passed) failed += 1;
	const detail = item.detail ? "  (" + String(item.detail).slice(0, 120) + ")" : "";
	console.log(`[token] ${item.passed ? "PASS" : "FAIL"}  ${item.name}${detail}`);
}
console.log(`[token] ${checks.length - failed}/${checks.length} checks passed`);

process.exit(failed > 0 ? 1 : 0);
