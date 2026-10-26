/**
 * Applies credential profiles to the host's provider registry.
 *
 * Step Code resolves provider credentials through the model registry, and a
 * `registerProvider` call made after the initial load phase takes effect
 * immediately — no `/reload`, no process restart. The config form only
 * overrides the fields it receives, so models and other provider settings
 * survive a credential swap.
 */
import type { ApiProfile } from "./types.ts";

/**
 * The host surface this module needs, declared structurally so the extension
 * keeps zero build-time dependency on private @step-harness packages.
 */
export interface ProfileHost {
	registerProvider?(name: string, config: Record<string, unknown>): void;
}

export interface ProfileApplyResult {
	ok: boolean;
	error?: string;
}

export function applyProfile(host: ProfileHost, profile: ApiProfile): ProfileApplyResult {
	if (!profile.provider) {
		return { ok: false, error: "配置缺少 provider 字段" };
	}
	if (!profile.apiKey) {
		return { ok: false, error: "配置缺少 API 密钥" };
	}
	if (typeof host.registerProvider !== "function") {
		return { ok: false, error: "当前宿主未暴露 registerProvider" };
	}

	// Only the credential (and an optional endpoint override) is passed, which
	// keeps the existing model catalogue intact.
	const config: Record<string, unknown> = { apiKey: profile.apiKey };
	if (profile.baseUrl) config.baseUrl = profile.baseUrl;

	try {
		host.registerProvider(profile.provider, config);
		return { ok: true };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}
