/**
 * Liquid-glass interaction layer.
 *
 * Tracks the pointer across every glass surface and writes two CSS custom
 * properties: --gx/--gy drive the specular highlight, --rx/--ry drive a subtle
 * parallax tilt on node cards. Work is coalesced into one rAF per frame and
 * skipped entirely when the user prefers reduced motion.
 */
(function () {
	"use strict";

	var TARGET_SELECTOR = ".glass, .node-card";
	var MAX_TILT_DEGREES = 4.5;

	var reducedMotion =
		window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

	var pending = null;
	var frameHandle = 0;

	function flush() {
		frameHandle = 0;

		var job = pending;
		pending = null;
		if (!job) return;

		var target = job.target;
		target.style.setProperty("--gx", job.x.toFixed(2) + "%");
		target.style.setProperty("--gy", job.y.toFixed(2) + "%");

		if (job.tilt) {
			target.style.setProperty("--rx", ((0.5 - job.ny) * MAX_TILT_DEGREES).toFixed(2) + "deg");
			target.style.setProperty("--ry", ((job.nx - 0.5) * MAX_TILT_DEGREES).toFixed(2) + "deg");
		}
	}

	function schedule(job) {
		pending = job;
		if (!frameHandle) frameHandle = window.requestAnimationFrame(flush);
	}

	function onPointerMove(event) {
		// Performance mode skips every pointer-driven effect, including the
		// getBoundingClientRect each move would otherwise pay for.
		if (global.OrchestraPerf && global.OrchestraPerf.lite) return;

		var target = event.target;
		if (!target || typeof target.closest !== "function") return;

		var surface = target.closest(TARGET_SELECTOR);
		if (!surface) return;

		var rect = surface.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return;

		var nx = (event.clientX - rect.left) / rect.width;
		var ny = (event.clientY - rect.top) / rect.height;

		schedule({
			target: surface,
			x: nx * 100,
			y: ny * 100,
			nx: nx,
			ny: ny,
			tilt: !reducedMotion && surface.classList.contains("node-card"),
		});
	}

	// Returning the card to rest is a variable reset, so the CSS transition
	// animates it back instead of snapping.
	function onPointerLeave(event) {
		if (global.OrchestraPerf && global.OrchestraPerf.lite) return;

		var target = event.target;
		if (!target || typeof target.closest !== "function") return;

		var surface = target.closest(".node-card");
		if (!surface) return;

		surface.style.removeProperty("--rx");
		surface.style.removeProperty("--ry");
	}

	document.addEventListener("pointermove", onPointerMove, { passive: true });
	document.addEventListener("pointerleave", onPointerLeave, true);
})();
