#!/usr/bin/env node
/**
 * Stacking-order regression check.
 *
 * Guards the bug where the account popover painted underneath the content
 * panel. Root cause: `.topbar` and `.stage` were positioned siblings with equal
 * z-index, so the later DOM node won; and because `.glass` applies
 * `backdrop-filter`, `.topbar` is its own stacking context, so the popover's
 * z-index could not escape it.
 *
 * The relationship is statically decidable — a descendant can never outrank its
 * own stacking context root — so this check reads the real CSS and HTML and
 * fails loudly if the invariant is broken again.
 *
 * Usage: node tools/check-layers.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const css = readFileSync(resolve(ROOT, "web", "liquid-glass.css"), "utf8");
const html = readFileSync(resolve(ROOT, "web", "index.html"), "utf8");

/** Parse flat `selector { ... }` blocks into a property map per selector. */
function parseRules(source) {
	const rules = new Map();
	const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "");

	const pattern = /([^{}]+)\{([^{}]*)\}/g;
	let match;
	while ((match = pattern.exec(stripped)) !== null) {
		const selector = match[1].trim().replace(/\s+/g, " ");
		if (!selector || selector.startsWith("@")) continue;

		const props = {};
		for (const line of match[2].split(";")) {
			const colon = line.indexOf(":");
			if (colon === -1) continue;
			props[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
		}

		// Later rules win, mirroring the cascade for equal specificity.
		rules.set(selector, { ...(rules.get(selector) ?? {}), ...props });
	}
	return rules;
}

const rules = parseRules(css);

function prop(selector, name) {
	return rules.get(selector)?.[name];
}

function zIndexOf(selector) {
	const raw = prop(selector, "z-index");
	if (raw === undefined || raw === "auto") return null;
	const value = Number.parseInt(raw, 10);
	return Number.isNaN(value) ? null : value;
}

/** Properties that force an element to open a new stacking context. */
const CONTEXT_PROPERTIES = [
	"transform",
	"filter",
	"backdrop-filter",
	"perspective",
	"isolation",
	"opacity",
	"contain",
	"will-change",
];

function createsStackingContext(selector) {
	const position = prop(selector, "position");
	if (position && position !== "static") {
		const z = prop(selector, "z-index");
		if (z !== undefined && z !== "auto") return true;
	}

	for (const property of CONTEXT_PROPERTIES) {
		const value = prop(selector, property);
		if (!value || value === "none") continue;

		if (property === "opacity") {
			if (Number.parseFloat(value) < 1) return true;
			continue;
		}
		if (property === "isolation") {
			if (value === "isolate") return true;
			continue;
		}
		if (property === "will-change") {
			if (/transform|opacity|filter/.test(value)) return true;
			continue;
		}
		if (property === "contain") {
			if (/paint|layout/.test(value)) return true;
			continue;
		}
		return true;
	}
	return false;
}

const checks = [];
const check = (name, passed, detail) => checks.push({ name, passed, detail });

// --- document structure -----------------------------------------------------

const topbarAt = html.indexOf('class="topbar');
const stageAt = html.indexOf('class="stage');
const popoverAt = html.indexOf('class="account-popover');
const headerCloseAt = html.indexOf("</header>");

check("topbar is a positioned element", prop(".topbar", "position") === "relative", prop(".topbar", "position"));
check("stage is a positioned element", prop(".stage", "position") === "relative", prop(".stage", "position"));
check(
	"topbar opens its own stacking context",
	createsStackingContext(".topbar"),
	"positioned + z-index, plus backdrop-filter"
);
check("stage opens its own stacking context", createsStackingContext(".stage"), "positioned + z-index");
check(
	"topbar precedes stage in the DOM",
	topbarAt !== -1 && stageAt !== -1 && topbarAt < stageAt,
	`topbar@${topbarAt} stage@${stageAt}`
);
check(
	"popover is nested inside the topbar",
	popoverAt !== -1 && headerCloseAt !== -1 && popoverAt < headerCloseAt,
	`popover@${popoverAt} </header>@${headerCloseAt}`
);

// --- the regression itself --------------------------------------------------

const topbarZ = zIndexOf(".topbar");
const stageZ = zIndexOf(".stage");
const popoverZ = zIndexOf(".account-popover");

check(
	"topbar outranks stage (equal z-index would let the later DOM node win)",
	topbarZ !== null && stageZ !== null && topbarZ > stageZ,
	`topbar=${topbarZ} stage=${stageZ}`
);
check(
	"popover is absolutely positioned with an explicit z-index",
	prop(".account-popover", "position") === "absolute" && popoverZ !== null,
	`position=${prop(".account-popover", "position")} z=${popoverZ}`
);
check("popover z-index is positive", popoverZ !== null && popoverZ > 0, String(popoverZ));

// --- forward guard ----------------------------------------------------------

const rivals = [];
for (const [selector, props] of rules.entries()) {
	if (selector === ".topbar") continue;
	// Descendants cannot escape their parent's context, so only flat
	// (top-level) selectors can compete with the topbar.
	if (selector.includes(" ") || selector.includes(">")) continue;

	const raw = props["z-index"];
	if (!raw) continue;

	const value = Number.parseInt(raw, 10);
	if (!Number.isNaN(value) && topbarZ !== null && value >= topbarZ) {
		rivals.push(`${selector}=${value}`);
	}
}
check("no top-level layer competes with the topbar", rivals.length === 0, rivals.join(", ") || "none");

const auroraZ = zIndexOf(".aurora");
check(
	"aurora stays behind the stage",
	auroraZ !== null && stageZ !== null && auroraZ < stageZ,
	`aurora=${auroraZ} stage=${stageZ}`
);

// --- report -----------------------------------------------------------------

let failed = 0;
for (const item of checks) {
	if (!item.passed) failed += 1;
	const detail = item.detail ? `  (${item.detail})` : "";
	console.log(`[layers] ${item.passed ? "PASS" : "FAIL"}  ${item.name}${detail}`);
}
console.log(`[layers] ${checks.length - failed}/${checks.length} checks passed`);

process.exit(failed > 0 ? 1 : 0);
