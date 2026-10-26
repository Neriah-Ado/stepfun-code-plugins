/**
 * Performance mode.
 *
 * The liquid-glass look spends GPU on three continuous fronts: the animated
 * aurora blobs, backdrop-filter sampling, and pointer-tracked tilt/highlight.
 * On modest hardware — or when the tab is merely sitting in the background —
 * that cost buys nothing. This module owns the switch:
 *
 * - html.perf-lite   static aurora, no backdrop-filter, no continuous
 *                    animations, pointer effects skipped (see glass.js)
 * - html.perf-paused tab hidden → every continuous animation parked
 *
 * The choice persists in localStorage. With no stored choice, low-end devices
 * and prefers-reduced-motion default to lite; everyone else gets full effects.
 * The toggle in the topbar (#perf-toggle) is wired here so no other module has
 * to know this one exists.
 */
(function (global) {
	"use strict";

	var STORAGE_KEY = "step-orchestra:perf-lite";

	var toggleButton = document.getElementById("perf-toggle");
	var toggleLabel = document.getElementById("perf-toggle-label");

	var media = global.matchMedia;
	var reducedMotion = media ? media("(prefers-reduced-motion: reduce)").matches : false;
	var cores = global.navigator && global.navigator.hardwareConcurrency;
	var memory = global.navigator && global.navigator.deviceMemory;
	// Conservative floor: 4 cores or 4 GB is where the blur layers start to
	// cost more than they look. Unknown values fall through to full effects.
	var lowEnd = (typeof cores === "number" && cores > 0 && cores <= 4) ||
		(typeof memory === "number" && memory > 0 && memory <= 4);

	function stored() {
		try {
			return global.localStorage.getItem(STORAGE_KEY);
		} catch {
			// Storage can be blocked (file://, privacy modes); treat as unset.
			return null;
		}
	}

	function persist(lite) {
		try {
			global.localStorage.setItem(STORAGE_KEY, lite ? "1" : "0");
		} catch {
			// Non-fatal: the mode still applies for this session.
		}
	}

	function apply(lite) {
		api.lite = lite;
		global.document.documentElement.classList.toggle("perf-lite", lite);
		if (toggleButton) {
			toggleButton.setAttribute("aria-pressed", lite ? "true" : "false");
			toggleButton.dataset.state = lite ? "lite" : "full";
			toggleButton.title = lite
				? "省电模式已开启:已关闭毛玻璃与动效。点击恢复完整视觉。"
				: "省电模式:关闭毛玻璃与动效,降低 GPU/电池占用。";
		}
		if (toggleLabel) toggleLabel.textContent = lite ? "省电" : "性能";
	}

	function set(lite) {
		apply(lite);
		persist(lite);
	}

	var api = {
		lite: false,
		set: set,
		toggle: function () {
			set(!api.lite);
		},
	};

	// First visit: pick a default from the device, don't persist it — the next
	// device (or an upgraded one) should get its own honest default.
	var remembered = stored();
	apply(remembered === null ? reducedMotion || lowEnd : remembered === "1");

	if (toggleButton) {
		toggleButton.addEventListener("click", function () {
			api.toggle();
		});
	}

	// A hidden tab cannot show animation; parking the continuous ones stops the
	// compositor from burning battery on an invisible aurora.
	global.document.addEventListener("visibilitychange", function () {
		global.document.documentElement.classList.toggle("perf-paused", global.document.hidden);
	});

	global.OrchestraPerf = api;
})(window);
