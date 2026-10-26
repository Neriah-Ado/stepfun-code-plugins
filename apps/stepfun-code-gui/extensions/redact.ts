/**
 * Argument sanitisation.
 *
 * Tool arguments routinely contain credentials (`Authorization` headers, API
 * keys in bash commands, tokens in curl invocations) and multi-megabyte file
 * bodies. Everything crossing the process boundary is clipped and scrubbed
 * first, so the gateway and the browser never see raw secrets.
 */

/**
 * Keys whose values are replaced wholesale. Matching is two-tier to avoid the
 * substring false positives a bare `/key|auth/i` produces ("metaKey",
 * "keyCode", "author"): high-signal tokens match anywhere inside the key once
 * separators/casing are normalized, while weak tokens ("key", "auth") only
 * match a standalone key name.
 */
const STRONG_TOKEN =
	/token|secret|passw|credential|authorization|cookie|bearer|apikey|signature/i;
const WEAK_EXACT = /^(key|auth|pwd|passwd)$/i;

function isSensitiveKey(raw: string): boolean {
	const normalized = raw.replace(/[^a-z0-9]+/gi, "");
	return STRONG_TOKEN.test(normalized) || WEAK_EXACT.test(normalized);
}

/** Per-string ceiling, in characters. */
const MAX_STRING = 2048;
/** Recursion ceiling for nested structures. */
const MAX_DEPTH = 4;
/** Key/array ceiling per level. */
const MAX_ENTRIES = 24;

function clip(value: string): string {
	if (value.length <= MAX_STRING) return value;
	const dropped = value.length - MAX_STRING;
	return `${value.slice(0, MAX_STRING)}…[+${dropped} chars]`;
}

function walk(value: unknown, depth: number): unknown {
	if (value === null || value === undefined) return value;

	switch (typeof value) {
		case "string":
			return clip(value);
		case "number":
		case "boolean":
			return value;
		case "bigint":
			return String(value);
		case "function":
		case "symbol":
			return `[${typeof value}]`;
		default:
			break;
	}

	if (depth >= MAX_DEPTH) return "[depth limit]";

	if (Array.isArray(value)) {
		const head = value.slice(0, MAX_ENTRIES).map((item) => walk(item, depth + 1));
		if (value.length > MAX_ENTRIES) head.push(`…[+${value.length - MAX_ENTRIES} items]`);
		return head;
	}

	const source = value as Record<string, unknown>;
	const out: Record<string, unknown> = {};
	let seen = 0;

	for (const key of Object.keys(source)) {
		if (seen >= MAX_ENTRIES) {
			out["…"] = "[more keys omitted]";
			break;
		}
		out[key] = isSensitiveKey(key) ? "***" : walk(source[key], depth + 1);
		seen += 1;
	}
	return out;
}

/** Scrub and clip tool arguments, always returning a plain object. */
export function redactArgs(input: unknown): Record<string, unknown> {
	const cleaned = walk(input, 0);
	if (cleaned !== null && typeof cleaned === "object" && !Array.isArray(cleaned)) {
		return cleaned as Record<string, unknown>;
	}
	return { value: cleaned };
}

/**
 * Collapse a free-form task description into a single short line, matching the
 * host's own "up to 200 characters, whitespace-normalised" labelling rule.
 */
export function digestSummary(value: unknown, max = 200): string {
	if (typeof value !== "string") return "";
	return value.replace(/\s+/g, " ").trim().slice(0, max);
}

/** First non-empty trimmed string among the candidates. */
export function firstString(...candidates: unknown[]): string {
	for (const candidate of candidates) {
		if (typeof candidate === "string" && candidate.trim().length > 0) {
			return candidate.trim();
		}
	}
	return "";
}
