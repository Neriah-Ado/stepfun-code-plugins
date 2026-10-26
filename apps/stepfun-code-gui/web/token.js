/**
 * Panel token bootstrap.
 *
 * The gateway prints the panel address with the bearer token in the URL
 * fragment (`http://127.0.0.1:<port>/#t=<token>`). A fragment is never sent to
 * a server, never appears in a Referer, and is not restored as a query string,
 * so it keeps the token out of access logs, terminal history and outbound
 * requests.
 *
 * This module reads the fragment exactly once, replaces the address bar with a
 * clean URL, and keeps the token for the tab in sessionStorage so a refresh
 * does not strand the panel with an empty token. app.js and profiles.js both
 * consume `window.OrchestraToken`; they run after this file.
 *
 * `tokenFromHash` is exposed so tools/test-token.mjs can pin the parsing rules
 * without a DOM.
 */
(function (global) {
	"use strict";

	var STORAGE_KEY = "step-orchestra:token";

	/** Parse `#t=<token>` (or a bare `t=<token>` payload) into the token. */
	function tokenFromHash(hash) {
		if (typeof hash !== "string" || hash === "") return "";

		var payload = hash.charAt(0) === "#" ? hash.slice(1) : hash;
		try {
			return new URLSearchParams(payload).get("t") || "";
		} catch (error) {
			return "";
		}
	}

	function storage() {
		try {
			return global.sessionStorage || null;
		} catch (error) {
			// Storage can be blocked by policy; the in-memory token still works.
			return null;
		}
	}

	function read() {
		var token = tokenFromHash(global.location ? global.location.hash : "");
		var store = storage();

		if (token) {
			if (store) {
				try {
					store.setItem(STORAGE_KEY, token);
				} catch (error) {
					// Quota/private mode: a reload will simply need a fresh URL.
				}
			}

			// Strip the secret from the address bar and from the history entry
			// as soon as it has been read.
			try {
				global.history.replaceState(
					null,
					"",
					global.location.pathname + global.location.search
				);
			} catch (error) {
				// replaceState throws in some embedded contexts; the token is live.
			}
			return token;
		}

		if (!store) return "";
		try {
			return store.getItem(STORAGE_KEY) || "";
		} catch (error) {
			return "";
		}
	}

	global.OrchestraToken = read();
	global.OrchestraTokenFromHash = tokenFromHash;
})(window);
