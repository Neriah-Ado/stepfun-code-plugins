<img src="assets/icon.png" align="right" width="96" alt="zcode-tps-monitor icon">

# stepfun-usage-monitor — ZCode Token Rate Monitor

**v2.5.0** · [简体中文](README.md) | [English](README.en.md)

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A5%2022.5-brightgreen)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)
![Tests](https://img.shields.io/badge/tests-88%20pass-brightgreen)

**ZCode session-level token rate monitor** — the instant tok/s of the just-finished turn is shown automatically when each reply ends. It reads ZCode's usage database and other client tools' local session records directly: never model self-reporting, never estimation. It also ships a real-time dashboard, slash commands, MCP tools, and optional business-TPS monitoring.

This repository doubles as a ZCode local plugin marketplace (`tps-local-marketplace`); the plugin is `zcode-tps-monitor`, located in [`plugins/zcode-tps-monitor/`](plugins/zcode-tps-monitor/). See the [plugin README](plugins/zcode-tps-monitor/README.md) for internals and development notes. Naming: repository `stepfun-usage-monitor` / plugin `zcode-tps-monitor` / marketplace `tps-local-marketplace`. The repository was rebuilt from the v1.x "StepFun API token-usage local proxy" into a ZCode-native plugin after [shy3130/zcode-tps-monitor](https://github.com/shy3130/zcode-tps-monitor).

> **Upgrading from v1.x**: v1.x (≤ 1.5.11) counted API usage through a local reverse proxy (`127.0.0.1:8787`) and required pointing your client's Base URL at it. Since V2.0.0 the plugin reads ZCode's own usage database directly — **no client configuration changes, install and go**. The v1.x code remains in git history (tag `v1.5.10`). Users still on v1.x should upgrade and delete the old `~/.stepfun-usage-monitor/providers.json`, which stores API keys in plaintext.

## Features

- **Instant current-turn rate line (on by default)** — the moment a reply ends (Stop hook), one line is shown automatically: instant tok/s for the turn, time to first token (TTFT), output tokens, pure generation time, request segments / per-segment peak, recent sliding average, session cumulative output, and sampling time. Multi-segment turns (tool calls) are weighted by "total output / total pure generation time", excluding inter-segment waits.
- **Real-time dashboard** — `/dashboard` opens it; **SSE real-time push** instead of interval polling: it refreshes the moment a new sample arrives, and while idle the channel carries heartbeats only. Auto-exits after 3 idle hours. Liquid-glass surfaces by default, fully disableable.
- **Appearance customization** — theme (dark / light / follow system), UI and numeric fonts, base font size, overall scale, accent color, glass intensity; the "⚙ Appearance" drawer saves and applies instantly, and the same config drives the Windows overlay and the Electron client.
- **Multi-agent aggregation display (V2.5.0)** — source switcher bar, grouped cards per source (missing capabilities render as "—"), same-axis comparison curves (legend marks measured / estimated calibers), per-source session switcher; overlay `focusAgent` focus. Hidden entirely for single-source setups.
- **Slash commands** — `/tps` for an instant snapshot; `/tps 10` to sample for 10 seconds (2–30); `/tps-doctor` for environment self-checks.
- **MCP tools** — `tps_snapshot` / `tps_watch` for programmatic access by agents.
- **Electron desktop client (optional)** — dashboard main window, transparent always-on-top overlay, tray (with a focus-source submenu), autostart and auto-update; shares the same page and config as the browser dashboard.
- **Business TPS monitoring (optional)** — point `metrics_url` at a real metrics endpoint; built-in demo data is used when unconfigured. Independent of the token rate.
- **Low overhead** — hooks run one read-only connection with prepared statements (50ms per-read budget, over-budget reads reported by `/tps-doctor`); the canvas redraws only on new samples or resizes; the overlay polls every 2s and skips unchanged updates.

## Preview

One line of rate metrics is shown automatically when each reply ends — no manual action needed:

![token rate line effect](plugins/zcode-tps-monitor/docs/effect-token-rate.png)

| Field | Meaning |
|---|---|
| `537.3 tok/s` | Instant output rate for the turn (incl. thinking tokens; weighted for multi-segment turns) |
| `TTFT 3.0s` | Time to first token (first segment of the turn) |
| `output 223 tok / gen 0.4s` | Output tokens and pure generation time (excluding inter-segment tool waits) |
| `2 seg / peak 537.3` | Request segments in the turn and per-segment peak rate (multi-segment turns only) |
| `avg3 494.9` | Sliding average of the last few turns |
| `total 51.3k tok` | Cumulative output of the current session (independent counter) |
| `⏱ 10:23:04` | Sampling moment (reply end time) |

Number formatting: per-turn "output" uses exact thousands-separated numbers (e.g. `2,762 tok`); "total" uses compact units — raw below 1k, one decimal for 1k–10k (`9.8k`), rounded for 10k–1M (`51k`), one decimal M above 1M (`73.8M`).

## Installation

**Prerequisite**: Node.js ≥ 22.5 (for the built-in `node:sqlite`; same on Windows / macOS / Linux).

### Option 1: add the marketplace from GitHub (recommended)

In ZCode run:

```text
/plugin marketplace add Neriah-Ado/stepfun-usage-monitor
/plugin install zcode-tps-monitor@tps-local-marketplace
```

After installing, **restart the session** so the hooks register; the rate line then appears automatically at the end of every reply.

### Option 2: local directory

Clone the repository, then open **Settings → Plugin Management → Discover → +** in ZCode, choose "local directory" as the source and point it at the repository root.

### Option 3: scripts / dashboard only (no plugin install)

```bash
git clone https://github.com/Neriah-Ado/stepfun-usage-monitor.git
cd stepfun-usage-monitor/plugins/zcode-tps-monitor

node scripts/token-rate.mjs            # current rate (human-readable)
node scripts/token-rate.mjs --turn     # current-turn instant rate
node scripts/token-rate.mjs --json     # JSON output
node scripts/doctor.mjs                # environment self-check
node dashboard/server.mjs              # live dashboard (default 127.0.0.1:7423)
```

### Updating

```text
/plugin marketplace update tps-local-marketplace
```

Then reinstall/upgrade the plugin and restart the session so the hooks re-register.

### Desktop client (Electron, optional)

A **standalone distribution** next to the plugin (not part of the plugin marketplace; installing it or not never affects plugin functionality). It reuses the plugin's collection core, dashboard server and the same appearance config:

- **Direct download**: grab the installer for your platform from [Releases](https://github.com/Neriah-Ado/stepfun-usage-monitor/releases) — Windows NSIS (`Setup.exe`, plus a merged x64+arm64 build) / portable, macOS dmg, Linux AppImage (each x64 + arm64). Installed builds auto-update via `electron-updater`.
- **Dev run**:

  ```bash
  git clone https://github.com/Neriah-Ado/stepfun-usage-monitor.git
  cd stepfun-usage-monitor
  npm install
  npm run dev            # start Electron (first run downloads the binary)
  ```

- **Local build**:

  ```bash
  npm run icons          # regenerate icons (pure Node, no image dependencies)
  npm run dist:win       # Windows: NSIS installer (x64/arm64) + portable (x64)
  npm run dist:mac       # macOS: dmg (x64/arm64)
  npm run dist:linux     # Linux: AppImage (x64/arm64)
  ```

  Pushing a `v*` tag runs `.github/workflows/release.yml`, which runs the test suite first and attaches the three-platform artifacts to a GitHub Release.

**UI and controls**:

| Element | Behavior |
|---|---|
| Main window | Loads the **same** dashboard page as the browser; size / position / always-on-top remembered; **closing minimizes to tray**, the process stays alive |
| Header "📌" | Toggle main-window always-on-top |
| Header "▣" | Show / hide the overlay |
| Overlay | Transparent borderless always-on-top strip showing the current tok/s; draggable; hover expands TTFT / recent-N average / cumulative tokens and a sparkline |
| Overlay "📌" | Click-through toggle: clicks land on the window below while hover-expand still works |
| Tray menu | Show/hide overlay, open dashboard, **focus source (V2.5.0 submenu)**, main-window always-on-top, overlay click-through, autostart, quit |

> **Size note**: installers bundle the full Electron runtime, on the order of a hundred MB. If you only want a text strip on Windows without Electron, `dashboard/overlay.ps1` remains the zero-install single-file option.

> **Dependency isolation**: `electron` / `electron-builder` / `electron-updater` all live in the **workspace-level root `package.json`**, and every Electron line lives under `electron/`. The plugin directory keeps zero npm dependencies and unchanged behavior — `node --test` carries a dedicated assertion guarding exactly that.

## Usage

### Scenario quick reference

| Scenario | Action |
|---|---|
| Per-turn rate | Nothing to do — shown automatically when each reply ends |
| Instant snapshot | Type `/tps`; or `/tps 10` to sample for 10 seconds |
| Open the dashboard | Type `/dashboard`, or run `node dashboard/server.mjs` |
| Environment self-check | Rate line missing? Type `/tps-doctor` |
| Multi-agent display | Configure `providers` and the dashboard gains the switcher / cards / comparison view (see "Configuration") |
| Change the overlay source | Electron tray "聚焦数据源" submenu; or set `focusAgent` |
| Disable the current-turn line | Write `{"stopHookLine": false}` to `~/.zcode/tps-monitor.config.json`, restart the session |
| Disable all rate injection | Write `{"tokenRateLine": false}` to the same file, restart the session |
| Change the dashboard appearance | The "⚙ Appearance" drawer; or edit the `appearance` section of the config file |
| Windows text overlay | Run `dashboard/overlay.ps1`; for cross-platform use the Electron client |
| Programmatic access | MCP tools `tps_snapshot` / `tps_watch` |

Plugin-prefixed equivalents: `/zcode-tps-monitor:tps`, `/zcode-tps-monitor:tps-doctor`, `/zcode-tps-monitor:dashboard`.

### Command line (token-rate CLI)

```bash
node scripts/token-rate.mjs                    # aggregated snapshot (human-readable; per-source block when multi-source)
node scripts/token-rate.mjs --turn             # current-turn instant rate
node scripts/token-rate.mjs --json             # JSON (gains perProvider when multi-source)
node scripts/token-rate.mjs --agent claude-code   # one source only (fields degrade when unavailable)
node scripts/token-rate.mjs --session <id>     # one session (takes priority over ZCODE_SESSION_ID)
node scripts/token-rate.mjs --agents           # per-source probe results / formats / sessions / samples
```

### MCP tools

- `tps_snapshot`: instant snapshot (rate / TTFT / totals; multi-source adds `provider` / `sessionId` / `sources` / `agents`).
- `tps_watch`: sample for 2–30 seconds, returning average / peak.

## Configuration

Everything lives in `~/.zcode/tps-monitor.config.json`, **additive only** — old configs missing any field fall back to defaults:

| Field | Type | Default | Purpose |
|---|---|---|---|
| `stopHookLine` | bool | on | Stop-hook rate line switch |
| `tokenRateLine` | bool | on | Master rate-injection switch |
| `providers` | string[] | `["zcode"]` | Enabled data sources (see below) |
| `focusAgent` | string | `"zcode"` | Overlay focus source (`"all"` = aggregate; switchable from the Electron tray) |
| `appearance` | object | see below | Dashboard appearance (dashboard / overlay / Electron interoperate) |

### Appearance customization (appearance)

```json
{
  "appearance": {
    "theme": "dark",
    "fontFamily": "Segoe UI, Microsoft YaHei, system-ui, sans-serif",
    "monoFont": "Cascadia Mono, Consolas, monospace",
    "fontSize": 16,
    "fontScale": 1,
    "accentColor": "#4da3ff",
    "glassIntensity": 0.6,
    "fontUrl": ""
  }
}
```

| Field | Values | Default | Notes |
|---|---|---|---|
| `theme` | `dark` / `light` / `system` | `dark` | `system` follows the OS light/dark preference |
| `fontFamily` | CSS font stack | `Segoe UI, Microsoft YaHei, system-ui, sans-serif` | UI font |
| `monoFont` | CSS font stack | `Cascadia Mono, Consolas, monospace` | Numeric / clock font |
| `fontSize` | 12–24 | `16` | Base font size (px) |
| `fontScale` | 0.8–1.6 | `1` | Overall scale (root font size = fontSize × fontScale) |
| `accentColor` | `#hex` / `rgb(a)` / `hsl(a)` / common name | `#4da3ff` | Accent color (curves, buttons, highlights) |
| `glassIntensity` | 0–1 | `0.6` | Liquid glass strength; `0` disables it and restores solid panels |
| `fontUrl` | `http(s)://` / `file://` | empty | Optional web font; silently falls back to the system font on failure |

- Out-of-range numbers are clamped; illegal values (injection characters, invalid colors / protocols) reject the whole write without touching the stored config; a corrupt config file yields a repair hint instead of a silent overwrite.
- Easier still: adjust and save in the dashboard's "⚙ Appearance" drawer — changes apply immediately.
- The overlay `overlay.ps1` reads the same config (Acrylic is attempted when glass intensity > 0, falling back on failure); so do the Electron overlay and main window.

### Multi-agent data sources (providers)

| Value | Meaning |
|---|---|
| absent / `["zcode"]` | ZCode only, byte-identical to V2.3.0 (default) |
| `["claude-code"]` | Claude Code sessions only |
| `["zcode", "codex"]` | Two sources aggregated, merged by completion time |
| all five | Everything; clients that aren't installed are skipped without being read |

Unknown ids are dropped during normalization with a fallback to the default, so a typo can't stop the plugin from starting. The `TPS_PROVIDERS` environment variable (comma-separated) overrides the list at a lower priority than the config file. The switcher / cards / comparison view and their calibers are described under "Architecture" and "How it works".

### Overlay focus (focusAgent)

| Value | Meaning |
|---|---|
| `"zcode"` (default) | Overlay shows ZCode (identical to V2.4.0 on the default providers config) |
| `"claude-code"` etc. | Shows that client's rate with a source prefix; the Electron overlay shows a source tag |
| `"all"` | Aggregate every enabled source |

The Electron tray "聚焦数据源" submenu writes it live; overlay.ps1 reads it at startup. REST `GET /api/token-rate` also accepts optional `?agent=` / `?session=` scoping (unknown source → 400) for per-source scripts.

### Business TPS (optional)

Demo data is used by default; to monitor real business throughput, configure `metrics_url` under **Settings → Plugin Management → zcode-tps-monitor**, pointing at any endpoint that returns JSON. Field names are auto-matched (up to three nesting levels):

| Metric | Recognized field names |
|---|---|
| Throughput | `tps` / `qps` / `throughput` / `transactionsPerSecond` |
| Latency | `p50` / `p95` / `p99` (or `latency_p50`, etc.) |
| Error rate | `error_rate` / `errorRate` / `err_rate` |

Example response:

```json
{"data":{"tps":1240,"p50":11,"p95":28,"p99":46,"error_rate":0.05}}
```

> Note: when `metrics_url` is unset, the plugin's MCP server may fail to start in some clients because the manifest variable cannot be expanded (surfacing as `plugin_variable_missing: metrics_url` from `plugins validate`). Putting any value (even an empty string) in the plugin settings is enough; hooks, commands and the skill are unaffected.

### Environment variables

| Variable | Description |
|---|---|
| `ZCODE_USAGE_DB` | Override the usage database path (default `~/.zcode/cli/db/db.sqlite`) for non-standard installs |
| `TPS_PROVIDERS` | Override the enabled sources (comma-separated, e.g. `zcode,claude-code`); lower priority than the config file |
| `TPS_CLAUDE_CODE_HOME` / `TPS_CODEX_HOME` / `TPS_OPENCODE_HOME` / `TPS_CLINE_HOME` | Override the corresponding client's data root, defaulting to each client's official location |
| `TOKEN_RATE_WINDOW` / `TOKEN_RATE_HIST` | Statistics window (default 5) / chart history depth (default 60) |
| `TOKEN_RATE_MIN_MS` / `TOKEN_RATE_MAX_MS` | Valid-sample generation-time window (default 200ms – 1h) |
| `TPS_URL` | Business-TPS metrics endpoint (standalone dashboard / script mode) |

## Architecture and How It Works

### Overview

```text
                    ┌─────────────────────────────────────────────┐
                    │         Display layer (three isomorphic      │
                    │                   forms)                    │
                    │  Browser dashboard index.html ⇄ Electron    │
                    │      ▲ SSE/REST        main window (same page)│
                    │      │                          ▲ IPC        │
                    │  Windows overlay.ps1 ──REST──┐  Electron overlay│
                    └──────────────────────────────┼──────────────┘
                                                   │
┌──────────────────────────────────────────────────▼─────────────────────────┐
│  Communication   SSE /api/events (snapshot / token / history-append /      │
│                  sys / agents) · REST /api/token-rate · /api/metrics ·     │
│                  /api/config · /api/agents · MCP stdio · CLI               │
└──────────────────────────────────────────────────┬─────────────────────────┘
                                                   │ tokenRateQuery
┌──────────────────────────────────────────────────▼─────────────────────────┐
│  Aggregation   collect-core.mjs: aggregateRate / aggregateTurn /           │
│                agentStatus — single zcode source → original direct path    │
│                (isFastPath, zero overhead); multi-source → normalize →     │
│                merge by completion time (per-source fault isolation)       │
└──────┬───────────────┬───────────────┬───────────────┬─────────────┬──────┘
       │ Provider iface│               │               │             │
┌──────▼─────┐  ┌──────▼─────┐  ┌──────▼─────┐  ┌──────▼─────┐  ┌────▼───────┐
│   zcode    │  │claude-code │  │   codex    │  │  opencode  │  │   cline    │
│ db.sqlite  │  │   *.jsonl  │  │   *.jsonl  │  │  *.json    │  │   *.json   │
└────────────┘  └────────────┘  └────────────┘  └────────────┘  └────────────┘
        ▲ local files only, no network, no telemetry
        │
┌───────┴────────────────────────────────────────────────────────────────────┐
│  Hook hot path (always straight to the zcode usage DB — never the          │
│  aggregation layer, never JSONL)                                           │
│  SessionStart (record session) · UserPromptSubmit (inject previous turn)   │
│  Stop (current-turn rate line)                                             │
└────────────────────────────────────────────────────────────────────────────┘
```

### Layer responsibilities

| Layer | Location | Responsibility |
|---|---|---|
| Data | `scripts/lib/providers/` + `lib/usage-db.mjs` | One Provider per client tool implementing `detect()` / `listSessions()` / `currentSessionId()` / `getUsage()`; normalizes upstream field-name differences (`output_tokens` / `outputTokens` / `tokensOut` / `completion_tokens`…) into one record shape |
| Aggregation | `scripts/lib/collect-core.mjs` | `aggregateRate` / `aggregateTurn` / `agentStatus`: collect per `providers`, normalize, merge by completion time, build window / session / turn views; per-source try/catch fault isolation |
| Communication | `dashboard/server-core.mjs`, `mcp/tps-server.mjs`, `scripts/token-rate.mjs` | SSE incremental push, REST endpoints, stdio MCP, CLI; one 1s collection tick reads the DB once and fans out to every SSE client |
| Display | `dashboard/index.html`, `electron/`, `dashboard/overlay.ps1` | Browser dashboard (liquid glass + appearance drawer + multi-agent display), Electron main window / overlay / tray, Windows text overlay |
| Commands | `hooks/`, `commands/` | Three hooks deliver the zero-lag rate line; `/tps`, `/tps-doctor`, `/dashboard` slash commands |

### Sources and capability matrix

| ID | Client | Data location (default) | Format | Rate | TTFT | Session scope |
|---|---|---|---|---|---|---|
| `zcode` | ZCode | `~/.zcode/cli/db/db.sqlite` · `model_usage` table | sqlite | ✅ | ✅ | ✅ |
| `claude-code` | Claude Code | `~/.claude/projects/**/*.jsonl` | jsonl | ✅ | ❌ | ✅ |
| `codex` | Codex CLI | `~/.codex/sessions/**/rollout-*.jsonl` | jsonl | ✅ | ❌ | ✅ |
| `opencode` | OpenCode | `~/.local/share/opencode/storage/message/**/*.json` | json | ✅ | ❌ | ✅ |
| `cline` | Cline | `<editor globalStorage>/…/tasks/*/api_conversation_history.json` | json | ✅ | ❌ | ✅ |

- Each source's data root can be overridden by environment variable (`TPS_CLAUDE_CODE_HOME` / `TPS_CODEX_HOME` / `TPS_OPENCODE_HOME` / `TPS_CLINE_HOME`), defaulting to each client's official location; `ZCODE_USAGE_DB` keeps its existing meaning.
- Providers declare `capabilities` (`turnRate` / `ttft` / `sessionScope`); the UI and commands degrade by capability — **fields that were never recorded render as "—", never a fabricated number**.

### Repository layout

```text
marketplace.json                      Marketplace manifest (tps-local-marketplace → plugins/zcode-tps-monitor)
package.json                          Electron desktop-client workspace manifest (standalone distribution, not in the marketplace)
electron-builder.yml                  Three-platform packaging config (nsis / dmg / AppImage + GitHub Releases publishing)
.github/workflows/release.yml         Tag-triggered build pipeline (runs node --test first)
electron/                             Electron desktop client (isolated from the plugin core)
├─ main.mjs                           Main process: windows / tray (incl. focus-source submenu) / autostart / auto-update / IPC
├─ preload.cjs                        Preload: contextBridge + channel allowlist
├─ renderer/overlay.html              Overlay render layer (transparent / draggable / hover-expand / source tag)
├─ lib/                               Pure logic: overlay-payload / collect-loop / state-store
└─ build/make-icons.mjs               Pure-Node ICO / ICNS / PNG icon generation
plugins/zcode-tps-monitor/
├─ .zcode-plugin/plugin.json          Plugin manifest (V2.5.0, incl. userConfig.metrics_url)
├─ .claude-plugin/plugin.json         Claude-compatible manifest (same version)
├─ .mcp.json                          stdio MCP server definition (tps_snapshot / tps_watch)
├─ commands/                          /tps · /tps-doctor · /dashboard
├─ skills/zcode-tps-monitor/SKILL.md  Skill: auto-triggers on rate/TPS questions
├─ hooks/                             Hook hot path (always straight to the zcode usage DB)
│  ├─ hooks.json                      SessionStart / UserPromptSubmit / Stop registration
│  ├─ session-start.mjs               Session hint
│  ├─ prompt-submit.mjs               Previous-turn rate as model context
│  └─ stop.mjs                        Current-turn instant rate line
├─ scripts/
│  ├─ collect.mjs                     Business TPS collection (--watch N to sample)
│  ├─ token-rate.mjs                  Token rate CLI (--turn / --json / --agent / --session / --agents)
│  ├─ doctor.mjs                      Environment self-check (--json incl. perf and multi-agent source sections)
│  ├─ lib/collect-core.mjs            Aggregation layer (aggregateRate / aggregateTurn / agentStatus)
│  ├─ lib/config.mjs                  appearance / providers / focusAgent config read-write & validation
│  ├─ lib/usage-db.mjs                Usage-DB read-only access layer (prepared statements + index self-check)
│  ├─ lib/perf-log.mjs                Hook read-timing diagnostics (~/.zcode/tps-monitor.perf.log)
│  ├─ lib/providers/                  Multi-agent data sources (zero-dependency pure Node)
│  │  ├─ index.mjs                    Registry: ids / aliases / capability matrix / normalization / selection
│  │  ├─ common.mjs                   Normalization and view building (rate formula shared with usage-db)
│  │  ├─ zcode.mjs / claude-code.mjs / codex.mjs / opencode.mjs / cline.mjs
│  └─ lib/sse.mjs                     SSE wire format (events / heartbeat / retry)
├─ dashboard/
│  ├─ server.mjs                      Live dashboard server (default 127.0.0.1:7423, auto-exits after 3 idle hours)
│  ├─ server-core.mjs                 Dashboard server factory (reused by Electron on an ephemeral port; SSE/REST/agents)
│  ├─ index.html                      Dashboard page (EventSource partial updates + canvas dirty flag + liquid glass + appearance drawer + multi-agent display)
│  └─ overlay.ps1                     Windows desktop overlay (2s polling, focusAgent; lightweight alternative when Electron is absent)
└─ docs/effect-token-rate.png         Rate-line effect image

test/                                 88 tests across six files (token-rate / config / perf / desktop / providers / aggregate-view)
docs/releases/                        Bilingual release notes per version (Chinese + English)
assets/                               Repository icon (regenerate with node assets/generate-icon.mjs)
```

### Rate calculation: one formula

```text
Single request   tok/s = (output tokens + thinking tokens) ÷ pure generation time × 1000
                 pure generation time (zcode, measured) = completed_at − first_token_at
                 valid-sample window [200ms, 1h) (TOKEN_RATE_MIN_MS / TOKEN_RATE_MAX_MS);
                 out-of-window records count toward session totals but produce no rate
Multi-segment    rate = Σ(output+thinking) ÷ Σpure generation time — inter-segment
                 tool waits never count (Stop hook)
Window stats     recent-N average/peak, N = TOKEN_RATE_WINDOW (default 5); session
                 totals are window-independent
```

Every number comes from real token accumulations written by the client (output-side caliber, including thinking tokens) — never relayed through the model. Long multi-segment turns are weighted by total output / total pure generation time, so inter-segment waits (tool execution, human time) naturally don't count.

### Hook timeline: why there is no lag

```text
t0  user sends a message ─▶ UserPromptSubmit hook
    │  millisecond-scale DB read; the current turn hasn't happened yet, so only the
    │  PREVIOUS turn's rate is injected as pure model context (never quoted back)
t1  model starts writing……tool calls × N segments, each segment recorded to the usage DB
t2  reply ends ─▶ Stop hook
    │  scopes all requests of the turn by the latest turn_id (every segment triggered by
    │  one user message), short-retries (5×250ms) for the last write, computes
    │  "total output / total pure generation time", renders via systemMessage —
    │  no model relay, zero lag by construction
```

- **SessionStart**: records the current session ID and injects a usage hint.
- **Hot-path isolation**: the three hooks always talk straight to the zcode usage DB (prepared statements, one read-only connection, 50ms budget) — **never through the aggregation layer, never JSONL**. Even with all five sources configured, hook output is byte-identical to a zcode-only setup (guarded by a dedicated test).
- Hooks write the "last active session" to a state file that the dashboard / Electron follow.

### Multi-source aggregation: normalize → merge → degrade → isolate

1. **Normalization**: each Provider converts upstream records into one shape (four field groups: `tokens / time / model / turnKey`); field-name differences are contained inside the Provider.
2. **Merge**: multi-source records merge in descending completion order (ties broken by declaration order in `providers` for reproducibility), then flow through the same window / session statistics as single-source; window and cumulative statistics sum across sources.
3. **Capability degradation**: third-party sources record no first-token moment, so TTFT renders as `-` / "—" (`ttftMs` is `null`) — **an inter-request gap is never passed off as a first-token delay**. Generation-time calibers differ per source (below) and are **not comparable across sources**:

   | Source | Generation-time caliber | Notes |
   |---|---|---|
   | `zcode` | `completed_at - first_token_at` | Measured |
   | `claude-code` | Gap to the previous request | Gaps over 120s are treated as human thinking time and rejected |
   | `codex` | Interval between `token_count` events | Older builds report cumulative totals only; deltas are derived, with reset detection |
   | `opencode` | Client-recorded `created` / `completed` | The closest to a real measurement |
   | `cline` | Gap to the previous entry | Compared against any entry, not only ones carrying usage |

4. **Fault isolation**: a corrupt or re-formatted source affects only itself (a failure reason is recorded in the `sources` detail); the other sources keep reporting. Uninstalled clients are skipped at probe time — never read. JSONL parsing has per-line fault isolation; each source reads at most 20,000 records; a bad line only skips itself.
5. **Single-source fast path**: with the default `providers=["zcode"]` the `isFastPath` guard runs the original code path — the result is byte-identical to V2.3.0 (one extra `provider` field) — and multi-source overhead is only paid when multi-agent support is enabled.

### Real-time push: the SSE protocol

| Event | Payload | When |
|---|---|---|
| `snapshot` | full token history + system metrics + `perProvider` (multi-source) | connect / reconnect |
| `token` | latest / session + `provider` / `sessionId` + `perProvider` (multi-source) | new sample recorded |
| `history-append` | one history increment (carries `provider` when multi-source) | new sample recorded |
| `sys` | CPU / memory / uptime | every 5s |
| `agents` | enabled list + per-source probe + session list | source-list change; multi-source connect |

- Pure `node:http` (zero dependencies); a heartbeat comment line every 15s, auto-reconnect per `retry: 2000` with a fresh full snapshot.
- **Zero idle polling**: with no data changes the channel carries heartbeats only (zero data payload); the server's single 1s collection tick reads the DB once and fans out.
- Rendering updates per event type: the canvas uses a last-sample-timestamp dirty flag (with a DPR × size bitmap cache); text nodes are written only when their value changes.
- REST endpoints remain (`/api/token-rate`, `/api/metrics`) for third-party scripts and browsers without EventSource (which fall back to polling).

### Performance budget and self-checks

| Metric | Value |
|---|---|
| Hook per-read budget | 50ms (measured P95 ≈ 5ms on a 20k-row DB) |
| Periodic polling requests on an idle dashboard | 0 (15s heartbeat comment lines only) |
| Steady-state increment packet | < 1KB |
| Suggested-index effect | Full scans 6 → 0 |
| System-metrics cadence | 5s |
| Overlay poll interval | 2s (WPF updates skipped when unchanged) |

Each hook read is timed into `~/.zcode/tps-monitor.perf.log`; `/tps-doctor --json` surfaces the distribution / over-budget counts / DB file size / full-scan hints in its `perf` section, with suggested indexes (the plugin connects read-only and never creates them on your behalf):

```sql
CREATE INDEX IF NOT EXISTS idx_model_usage_session_completed ON model_usage(session_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_usage_status_completed ON model_usage(status, completed_at DESC);
```

## Verification and Testing

| Item | Status | Evidence |
|---|---|---|
| Unit tests | Measured | `node --test`, 88 tests (v2.5.0) |
| Environment self-check | Measured | `node scripts/doctor.mjs`; `--json` for programmatic use |
| Hook read budget | Measured | P95 ≈ 5ms on a 20k-row DB against a 50ms budget |
| Idle dashboard polling | Measured | 0 periodic requests, 15s heartbeat comment lines only |
| Multi-agent sources | Measured (test fixtures) | Five Providers, capability degradation and fault isolation; no live third-party client attached |
| Three-platform installers | Not verified in this document | Built by GitHub Actions on `v*` tags |

```bash
node --test                                              # test suite (number formatting / turn queries / appearance config / SSE & performance / multi-agent Providers / aggregation display / desktop client, 88 in total)
cd plugins/zcode-tps-monitor && node scripts/doctor.mjs  # environment self-check (--json includes the perf and multi-agent source sections)
```

Manual MCP smoke test (responses are `Content-Length` frames; bare JSON-line requests are also accepted):

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"manual","version":"0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node plugins/zcode-tps-monitor/mcp/tps-server.mjs
```

## Known Limitations

- **The plugin mechanism is ZCode-specific**: the rate line, slash commands and hooks only work inside ZCode sessions. Other clients can only be read as data sources. Workaround: add Claude Code / Codex / OpenCode / Cline to `providers` and inspect their local usage via `/tps` or the dashboard.
- **Third-party sources have no TTFT**: the four third-party clients record no first-token moment, so `ttftMs` is always `null` and the UI renders "—"; generation-time calibers are estimates and differ per client, so **cross-source numbers are not comparable**. Workaround: compare trends within one source only.
- **The rate line does not cover multiple sources**: the hook hot path always reads the zcode usage DB directly. Even with all five sources configured, the rate line still reflects ZCode only; multi-source data appears only in `/tps`, the dashboard, MCP and the CLI.
- **The Windows overlay is Windows-only**: `dashboard/overlay.ps1` depends on Windows APIs; macOS / Linux users need the Electron desktop client for an overlay, tray and autostart.
- **The Electron installer is large**: it bundles the full Electron runtime, on the order of a hundred MB. For a lightweight strip, use the single-file `overlay.ps1` (Windows only).
- **Unset `metrics_url` differs by client**: some clients fail to start because the manifest variable cannot be expanded (`plugin_variable_missing: metrics_url`). Workaround: put any value (even an empty string) in the plugin settings; hooks, commands and the skill are unaffected.
- **v1.x proxy usage is retired**: users who still need the old proxy must retrieve it from git history (tag `v1.5.10`); delete the old `providers.json`, which stores API keys in plaintext, after upgrading.

## FAQ

**Q: Can I use it in OpenCode / Codex / Claude Code or other tools?**

A: The plugin mechanism and hooks are ZCode-specific, so the rate line only appears inside ZCode sessions. But the **data source is not limited to ZCode**: add Claude Code, Codex, OpenCode and Cline to `providers` and `/tps`, the dashboard and MCP will read those clients' local session usage (calibers under "How it works · Multi-source aggregation"). When nothing is configured, only ZCode is read and behaviour is exactly as before; the business-TPS collector and dashboard are standalone programs that can run without ZCode.

**Q: Is the displayed rate accurate?**

A: The rate is computed from real token accumulations in the client's usage data, counting model output tokens (including thinking tokens). The line is sampled the instant a reply ends and reflects exactly that turn; multi-segment turns are weighted by "total output / total pure generation time", excluding inter-segment tool waits. ZCode's pure generation time is a measurement; the other clients record no first-token moment, so their durations use estimated calibers that differ per client (see the table in "How it works") and **are not comparable across sources**. Numbers may also differ slightly from other tools due to different counting windows.

**Q: The rate line suddenly disappeared?**

A: Run `/tps-doctor`. Common causes: Node below 22.5 (needs built-in `node:sqlite`), a schema change after a ZCode update, not restarting the session after a plugin upgrade (hooks register per session), or injection disabled in the config file.

**Q: Does the dashboard poll or push? How much resources does it use?**

A: SSE push (`GET /api/events`). While idle the channel carries one heartbeat comment line every 15 seconds and the page issues no periodic request at all; the server's single 1s collection tick reads the DB once and fans out to every SSE client. New samples update the DOM and canvas per event type (dirty-flag redraw), with steady-state increments under 1KB. Hook-side DB reads have a 50ms budget — the distribution and over-budget counts live in `/tps-doctor`'s perf section.

**Q: The grouped cards don't match the top summary card in multi-source mode?**

A: Expected. The cards and comparison curves reflect **each source's own current session** (session ids don't transfer across tools); the top summary card and the rate line follow ZCode's current session. The two are not comparable across sources — inherent to the multi-tool scenario.

**Q: Is macOS / Linux supported?**

A: Yes. Hooks, commands, the dashboard and MCP are all cross-platform Node; the usage database path resolves from the user home, overridable via `ZCODE_USAGE_DB`. Two desktop forms exist: `overlay.ps1` relies on Windows APIs and is Windows-only; the **Electron desktop client** has installers for all three platforms (NSIS / dmg / AppImage) giving macOS and Linux users the overlay, tray and autostart.

**Q: What's the relationship with v1.x stepfun-usage-monitor?**

A: Two generations of the same repository. v1.x counted model-API token usage through a local reverse proxy (`127.0.0.1:8787`) and required changing the client's Base URL; V2.0.0 was rebuilt as a ZCode plugin reading ZCode's own usage database with no client configuration changes. The v1.x proxy code remains in git history (tag `v1.5.10`).

**Q: How do I turn off the demo data?**

A: Demo data only affects the "business TPS" part (the token rate is always real); leaving `metrics_url` unconfigured is demo mode, and configuring it switches to the real data source automatically.

**Q: I don't like the liquid glass effect / want different fonts?**

A: In the dashboard's "⚙ Appearance" drawer, drag "glass intensity" to 0 to restore solid panels; theme, fonts, font size, scale and accent color all live in the same drawer and apply instantly. You can also edit the `appearance` section of `~/.zcode/tps-monitor.config.json` directly (fields under "Configuration").

## Documentation Map

| Document | Purpose |
|---|---|
| [CHANGELOG.md](CHANGELOG.md) | Version history, including the backfilled v1.x entries |
| [docs/releases/README.md](docs/releases/README.md) | Index of bilingual release notes |
| [plugins/zcode-tps-monitor/README.md](plugins/zcode-tps-monitor/README.md) | Plugin internals, development and test details |
| [LICENSE](LICENSE) / [LICENSE-MIT](LICENSE-MIT) | AGPL-3.0-only main license and upstream MIT license |

## License

[AGPL-3.0-only](LICENSE). The upstream MIT text and copyright notice are retained in [LICENSE-MIT](LICENSE-MIT), copyright © 2026 shy3130 (upstream author).

© 2026 Neriah. V2.1.0 appearance & liquid glass, V2.2.0 performance, V2.3.0 Electron desktop client, V2.4.0 multi-agent Provider data layer, V2.5.0 multi-agent aggregation display: Neriah-Ado.

Documentation style: [DOCS-STYLE](https://github.com/Neriah-Ado/Neriah-Ado/blob/main/docs/DOCS-STYLE.md)
