#!/usr/bin/env node
/**
 * Extension module graph smoke test.
 *
 * mock-feed and test-progress exercise redact.ts and progress.ts, but nothing
 * imports the heavier extension files. This test imports the full graph —
 * types.ts, conversation.ts, metrics.ts, profiles.ts, bridge.ts, index.ts — so
 * a syntax error or a broken export fails loudly in CI instead of the moment a
 * user installs the extension.
 *
 * Type stripping (native in Node ≥22.18/23+) is what makes importing the .ts
 * graph directly possible; that is the same assumption mock-feed.mjs already
 * makes when it imports redact.ts.
 *
 * Usage: node tools/test-extension-import.mjs
 */
import { strict as assert } from "node:assert";

const index = await import("../extensions/index.ts");
assert.equal(typeof index.default, "function", "index.ts must default-export a factory");

const { Bridge } = await import("../extensions/bridge.ts");
assert.equal(typeof Bridge, "function", "bridge.ts must export the Bridge class");

const bridge = new Bridge();
// Public surface the rest of the system relies on.
for (const method of ["start", "send", "onAction", "onRestart", "getPanelUrl", "getFailureReason", "dispose"]) {
	assert.equal(typeof bridge[method], "function", `Bridge.${method} missing`);
}
// Idempotency contract: dispose twice must not throw.
bridge.dispose();
bridge.dispose();

const { createTurnTracker } = await import("../extensions/metrics.ts");
const tracker = createTurnTracker();
tracker.begin();
tracker.markDelta();
const turn = tracker.finish(120);
assert.ok(turn && turn.output === 120, "turn tracker should close a measured turn");

console.log("[ext-import] PASS  extension module graph loads and exports hold");
