# StepFun Code-GUI

**v2.0.0** · **English** · [简体中文](README.md)

[![License: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A5%2022-339933.svg)](package.json)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](#quick-start)

An orchestration visualisation panel for Step Code. `subagent` and `workflow` runs
executing in the terminal are rendered live in the browser as a liquid-glass interface.

> The internal package name is `step-orchestra`; the repository and product name is StepFun Code-GUI.

---

## Features

- **Live orchestration topology** — Host events rebuild the `tool_call` / `tool_update` / `tool_result` topology, with node states covering pending / running / done / failed / cancelled.
- **Fan-out mode inference** — Argument shape distinguishes single / parallel / chain (`agent` / `tasks` / `chain`) without an explicit `mode` field; the mode badge and task summary appear directly on the card.
- **Subagent detail and aggregate metrics** — The inspector shows subagent rows, progress, and redacted arguments; the topbar totals running / done / failed / orchestration counts and token spend.
- **Conversation view and seamless switching** — History replay, 80 ms frame-coalesced streaming bubbles, and bottom-pinned scrolling; orchestration ↔ conversation switching never unmounts the DOM, so scroll position, selection, and drafts survive.
- **Multi-account API profile hot-swap** — Credentials stay in the gateway and the browser sees only a `keyHint` mask; `registerProvider` takes effect without a restart, and 401 / 403 responses mark the active profile red with a reason.
- **Single-line token usage metric** — `tok/s`, time to first token, output / generation time, average, cumulative usage, and context occupancy; at ≥75% / ≥92% the whole line changes colour and adds a warning.
- **Liquid-glass visuals** — A `backdrop-filter` refraction base, 142° glass body, pointer-following highlight, ≤4.5° parallax tilt, and SVG displacement filters, with a `prefers-reduced-motion` fallback.
- **Zero-command startup and performance mode** — Double-click `start.bat` / `start.command` to build and launch the gateway; `npm run demo` previews the panel without Step Code; performance mode cuts GPU load in one click and engages automatically on low-end devices and background tabs.

---

## Quick start

**Option 1 (recommended, zero terminal):**

| Platform | Action |
|---|---|
| Windows | double-click `start.bat` |
| macOS | double-click `start.command` (same as `start.sh`), or run `./start.sh` |
| Any platform with Node ≥ 22 | run `npm start` from the repo root |

The launcher does the rest: it locates (or builds with Go) the gateway binary, starts
the gateway, and opens the panel in your default browser. The first run spends
10–30 seconds building; every run after that opens instantly.

**Option 2 (demo mode, no Step Code required):**

```bash
npm run demo        # equivalent to node start.mjs --demo
```

Replays a complete scenario (a parallel workflow fan-out, a subagent chain, live chat
and usage metrics) so the panel can be evaluated in isolation; the 38/38 assertion
report prints and the gateway stays up for browsing.

**Option 3 (developers, manual build):**

```bash
npm run build       # equivalent to go build, handling the Windows .exe suffix automatically
```

> The gateway is a standard-library-only Go program (~7 MB with
> `-trimpath -ldflags "-s -w"`); building needs only the Go toolchain and nothing else
> needs anything beyond Node ≥ 22.

---

## Installation

Install the extension into Step Code:

```bash
step install /absolute/path/to/step-orchestra
step list
```

Once installed, run `/orchestra` inside Step Code to print the panel address:

```text
[step-orchestra] panel: http://127.0.0.1:47810/#t=<token>
```

The token sits in the URL **fragment** (`#t=`), so it is never sent to the server and never
leaks through `Referer`. On load, `web/token.js` rewrites the address bar back to
`http://127.0.0.1:47810/` with `history.replaceState` and keeps the token for the tab in
`sessionStorage`, so a refresh still works and a copied URL carries no secret.
**Query-string addresses used by v2.0.0 and earlier no longer work** — rerun `/orchestra`
for the new URL.

The gateway starts automatically when the extension loads and exits when the session ends;
no further configuration is required.

**No manual build needed.** If the extension starts and finds the gateway binary missing,
it builds one in the background with the Go toolchain (first run only, ~10–30 s; the log
asks you to run `/orchestra` again once done). Events queue in memory during the build and
replay afterwards, so the panel's first paint stays complete. Users who ran
`start.bat` / `npm start` once before installing never see that wait at all.
Set `STEP_ORCHESTRA_AUTOBUILD=0` to opt out.

### Package structure

`package.json` declares its entry point via `"pi": { "extensions": ["extensions/index.ts"] }`
(matching the official `with-deps` example; a **top-level** `extensions` field is not recognised by the host).

`step install` records the source in `~/.stepcode/config.toml`:

```toml
# StepCode configuration
packages = [ "E:\\Project\\...\\step-orchestra" ]
```

> The official documentation describes `~/.stepcode/agent/settings.json`, but 0.1.1
> was observed writing to `~/.stepcode/config.toml`. Treat `step list` as authoritative.

Installation can also be bypassed with `step -e <entry path>` for temporary loading.

---

## Usage and commands

| Command | Purpose |
|---|---|
| `npm start` | One-click startup: locate or build the gateway, launch it, and open the panel in your default browser |
| `npm run demo` | Replay the built-in scenario without installing Step Code |
| `npm run build` | Build the gateway binary only |
| `npm test` | Run the aggregate test suite (go vet / go test / module graph / payload parsing / stacking / launcher / end-to-end) |
| `step install <path>` | Install the extension into Step Code |
| `step -e <entry path>` | Load the extension temporarily, bypassing installation |
| `/orchestra` | Print the panel address from Step Code and start the gateway |

Minimal example:

```bash
npm start
```

The browser opens the panel automatically. With the extension installed, run `/orchestra`
inside Step Code to print a tokenised panel address (the token changes on every run).

---

## Configuration

### API profile switching

Switch between multiple accounts' coding plans without restarting.

#### Configuration storage

| Item | Decision |
|---|---|
| Location | `~/.stepcode/agent/step-orchestra/profiles.json` (written by the gateway) |
| Permissions | Directory `0700`, file `0600`; **neither bit has any effect on Windows**, where readability by other local accounts is governed by the ACL on `%USERPROFILE%` |
| Atomicity | Written to `.tmp` then renamed, so a crash cannot truncate the original |
| Format | `{ version, activeId, profiles: [{ id, name, provider, apiKey, baseUrl?, addedAt }] }` |
| Encryption | **None.** The same approach as `.netrc` and `~/.aws/credentials`: plaintext plus file permissions |
| Browser | **Never sees plaintext.** The list endpoint returns only `keyHint` (for example `sk-m…7890`) |

> **Windows permissions (A-03)**: `os.WriteFile(..., 0o600)` and `MkdirAll(..., 0o700)` only map
> to the read-only attribute on Windows; they create no ACL entries. The confidentiality of
> `profiles.json` therefore depends on the inherited ACL of `%USERPROFILE%\.stepcode\` (by
> default readable only by the current user and their administrators group). To tighten it
> explicitly:
>
> ```bat
> icacls "%USERPROFILE%\.stepcode\agent\step-orchestra" /inheritance:r /grant:r "%USERNAME%":(OI)(CI)F
> ```
>
> This project deliberately avoids platform credential stores (DPAPI / Keychain / libsecret) to
> stay dependency-free; for a stronger guarantee, keep keys in the OS credential manager and
> activate them in the panel only temporarily.

Plaintext is held by the gateway rather than in browser localStorage because localStorage is
fully readable by same-origin scripts, and the panel itself runs on localhost. Placing a key
in the browser would be equivalent to handing it to any injected script.

#### How switching takes effect immediately

Step Code resolves credentials through the model registry. The documentation states that
`registerProvider`, when called after the initial load phase, **takes effect immediately
without `/reload`**; the config form also overrides only the fields it receives, leaving the
model catalogue intact.

```text
click to switch → POST /api/profiles/activate → gateway writes activeId
                → stdout emits action{apply_profile, profile}
                → extension calls pi.registerProvider(provider, { apiKey })
                → the next request uses the new credential
```

Because only `apiKey` (and optionally `baseUrl`) is passed, that provider's model list is not reset.

#### Detecting invalid credentials

Rather than probing the endpoint, the extension **observes real traffic**: it subscribes to
`after_provider_response` and, on 401 / 403, broadcasts `profile_status`. The panel then marks
the active profile in red with the reason. This produces no extra requests and no extra billing.

Static validation on the form side: name and provider are required; a key is required when
creating; keys shorter than 12 characters are flagged as "unusual length".

#### Interaction design

| Element | Behaviour |
|---|---|
| Trigger | Right side of the topbar, between metrics and the conversation switch; shows a status dot, account name, and masked key |
| Status dot | Green for usable; grey for missing key; amber for unusual length; red for a rejected credential (with a breathing animation) |
| Expanding | Click opens a glass popover, syncing `aria-expanded` and rotating the caret |
| Closing | Click outside, press Esc, or click again |
| List row | Name + a "Current" badge + provider / mask / baseUrl + status description; the active row cannot be re-clicked |
| Inline actions | Edit and delete; deletion goes through a native `confirm` |
| Hover / press | Consistent with the mode switch: lifts 1 px / `scale(0.978)` |
| Editing | Leaving the key blank keeps the stored value (merged server-side), so the browser never has to round-trip a secret it was never given |

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `STEP_ORCHESTRA_PORT` | No | Starting gateway port, default `47810`; conflicts resolve by incrementing (up to 12 attempts) |
| `STEP_ORCHESTRA_BIN` | No | Overrides the gateway binary path (default: locate or build automatically) |
| `STEP_ORCHESTRA_WEB` | No | Panel static directory; only the repository's `web/` is served, and any other path is ignored with a log line |
| `STEP_ORCHESTRA_AUTOBUILD` | No | Set to `0` to disable the extension's first-run auto-build; enabled by default |

---

## Architecture

**Rationale.** Step Code's UI layer is `pi-tui`, which renders terminal characters differentially.
Extensions have no public API for injecting custom graphical components, and a terminal
cannot express real blur or refraction. Given that constraint, the system is divided
across four processes by responsibility:

| Layer | Responsibility |
|---|---|
| TypeScript extension | Normalises host events into JSONL and writes them to a child process's stdin; contains no business logic |
| Go gateway | Reconstructs topology and maintains state, pushed over SSE |
| Browser panel | Carries all graphical rendering and animation |
| Reverse channel | Returns commands via the gateway's stdout, used to send messages and apply credentials |

![Architecture](docs/architecture.svg)

The principal benefit of this split is change isolation: host API adjustments affect only
the `extensions/` directory, and the panel can be developed and debugged independently of Step Code.

### Event contract

The extension subscribes to the following host events (`pi.on(event, handler)`);
field definitions defer to `extensions/types.ts`.

| Host event | Purpose |
|---|---|
| `session_start` | Session metadata (ID / cwd / model) |
| `agent_start` / `agent_end` / `agent_settled` | Turn and overall settlement |
| `tool_call` | Node creation; `subagent` / `workflow` are flagged as orchestration nodes and their mode extracted |
| `tool_execution_update` | **Primary source of orchestration progress.** The payload sits under `event.partialResult` on 0.1.1 and `event.details` on 0.84.x; both are parsed |
| `tool_result` | Terminal node state, duration, token usage |
| `message_start` / `message_update` / `message_end` | Conversation stream: `assistantMessageEvent.text_delta` accumulates into a streaming bubble |
| `session_shutdown` | Shut the gateway down |

`message_update` fires once per token; only `assistantMessageEvent.type === "text_delta"`
increments are consumed. Thinking and tool-call deltas are not forwarded, as they already
surface as tool nodes.

#### Upstream resilience

`extensions/progress.ts` maintains an **alias table** for each counter field
(for example `running` covers `running` / `runningCount` / `active` / `activeCount`) and
descends up to three levels through wrappers such as `partialResult`, `progress`,
`workflowProgress`, `snapshot`, and `details`. A renamed host field degrades to a
**partial read** rather than a blank panel.

Observed differences between upstream versions:

| Item | 0.1.1 | 0.84.x |
|---|---|---|
| Progress payload field | `event.partialResult` | `event.details` |
| `subagent` tool | Provided by an example extension; arguments are `{agent\|tasks\|chain}` | Built in, with an additional `workflow` tool |
| Install config location | `~/.stepcode/config.toml` | Documented as `settings.json` |
| Package entry declaration | `"pi": { "extensions": [...] }` | — |

`inferMode()` therefore derives the fan-out mode from **argument shape**: a `chain` array
means chain, a `tasks` array means parallel, and `agent` or `task` means single.
It does not depend on an explicit `mode` field.

### Security design

| Item | Measure |
|---|---|
| Network exposure | Bound to `127.0.0.1` only; port conflicts resolve by incrementing (up to 12 attempts). The `Host` header must also name `127.0.0.1` / `localhost`, defeating DNS rebinding |
| Authentication | A 24-byte random token per run; every data endpoint validates it using constant-time comparison |
| Token transport | The token lives only in the URL fragment (`#t=`), which is stripped from the address bar and history as soon as it is read. Read-only GETs may also use the query string; `POST` / `DELETE` accept **only** the `X-Orchestra-Token` header, so a token leaked from a URL cannot authorize a mutation |
| Cross-site write protection | `POST` / `DELETE` validate `Origin`: absent means a local CLI (the token header still applies), present must equal the request `Host` exactly — anything else is 403 |
| Static assets | Untokened (so the first paint costs one request) but restricted to the repository's `web/`: a `STEP_ORCHESTRA_WEB` pointing elsewhere is ignored with a log line, so an arbitrary directory is never exposed over loopback |
| Credential leakage | Arguments pass through `redact.ts`: values under `key` / `token` / `secret` / `password` / `authorization` / `cookie` are replaced wholesale with `***` |
| Payload growth | Strings truncate at 2048 characters, at most 24 keys per level, recursion depth capped at 4 |
| Injection | The front end writes host data exclusively through `textContent`; `innerHTML` is used only for static icon paths declared in-file |
| Data at rest | The gateway writes no browsing data; the token lives only in the extension process memory and the browser tab's `sessionStorage` |
| First auto-build | When the binary is missing, the extension/launcher runs the local Go build on **repository source**: no network, no shell, no argument concatenation. It is equivalent to "installing means executing this repository" — an install trust model (see Known limitations) |

### Conversation mode and view switching

The panel hosts two views: **Orchestration** (tool and subagent topology) and
**Conversation** (interaction with the agent). Both remain mounted within the same grid
cell; switching only toggles visibility.

#### The switch control

| Item | Design |
|---|---|
| Position | Right end of the topbar, immediately left of the connection indicator; a global view control, not owned by either panel column |
| Label | Shows the **target mode**: "Conversation" while in the orchestration view, "Orchestration" while in the conversation view |
| Icon | Follows the label — a speech bubble when the target is conversation, a node graph when the target is orchestration; switched in CSS via `data-target`, without replacing DOM |
| Hover | Lifts 1 px, border turns accent purple, glass highlight strengthens (240 ms) |
| Press | `scale(0.972)`, transition compressed to 90 ms |
| Focus | `:focus-visible` 2 px purple ring; keyboard reachable |
| Mid-transition | `aria-busy="true"` with `pointer-events: none`, suppressing repeated activation within the 240 ms window |
| Disabled | Switching is blocked while the event stream is down (`opacity: .45`, `cursor: not-allowed`, no hover feedback) |

#### Why switching does not stutter, flicker, or shift

| Risk | Handling |
|---|---|
| Layout shift | Both views overlap in the same `grid-area: stage` cell, so container size is constant |
| Rebuild flicker | Views are **never unmounted**; switching only changes `opacity` and `visibility` |
| Lost scroll | The DOM survives, so scroll positions in both the tree and the conversation are preserved |
| Lost selection | The selected node is a DOM attribute and is unaffected by switching |
| Lost draft | The input's DOM survives; both content and caret position persist |
| Data reload | Switching issues **no requests**; SSE keeps writing to both views |
| Animation races | The 240 ms `aria-busy` window suppresses repeat activation; `prefers-reduced-motion` reduces transitions to 0.01 ms |

#### Conversation data flow

```text
input box ──POST /api/send──▶ gateway ──one JSON line on stdout──▶ extension ──pi.sendUserMessage()──▶ host
host ──message_start/update/end──▶ extension (accumulates text_delta) ──▶ gateway ──SSE──▶ bubble updates in place
```

This reverse channel is the only downstream path in the system: stdin carries upstream
events, stdout carries downstream commands.

The send button's disabled state is a compound condition: empty input, or a downed event
stream. **Sending while the agent is busy is allowed**: the extension downgrades
automatically to `deliverAs: "followUp"` and queues the message. The message first appears
locally as a translucent "pending" bubble and is replaced in place when the host replays it;
on failure the original text returns to the input box.

Message bubbles reuse DOM keyed by id, and streaming updates touch only the text node
rather than rebuilding the list. Scrolling uses a bottom-pinning strategy (auto-follow
within 72 px of the bottom, otherwise a "Back to bottom" button appears) so that scrolling
back through history is not interrupted.

### Token usage display

A single line of metric text between the conversation log and the composer, modelled on the
reply footer of
[`Neriah-Ado/stepfun-usage-monitor`](https://github.com/Neriah-Ado/stepfun-usage-monitor).

```text
537.3 tok/s · 首字 3.0s · 输出 223 tok / 生成 0.4s · 均值 494.9 · 累计 51.3k tok · 上下文 168k/200k · 接近上限 · 10:23:04
```

| Item | Design |
|---|---|
| Form | **A single plain-text line**, monospaced, separated by mid-dots; no progress bar and no panel background of its own |
| Position | Between the conversation log and the composer, belonging to the input area |
| Timing | On `message_end`; values move only when a response lands, so there is no polling and no per-token churn |
| Number rules | **Two tracks**: exact values use thousands separators (`2,762`); cumulative values use compact units — raw below 1k, one decimal from 1k to 10k (`9.8k`), whole thousands from 10k to 1M (`51k`), one decimal of millions at or above 1M (`73.8M`) |
| Clock | Right-aligned and monospaced; excluded from text truncation |
| ≥75% / ≥92% | The whole line turns amber / red and appends "approaching limit" / "about to overflow, consider /compact" |

#### How throughput is computed

The only clock available to the extension layer is the event arrival timestamp, hence:

```text
TTFT             = arrival of first text_delta − message_start
generation time  = last text_delta − first text_delta
tok/s            = this turn's output tokens ÷ generation time × 1000
```

Two deliberate safeguards: generation windows shorter than 200 ms or longer than 1 h are
excluded from the moving average (they are noise, not throughput); and when only a single
delta arrives, `generationMs` is reported as `null` rather than 0, avoiding an anomalous
division in the front end. TTFT includes IPC latency and therefore reads high, which is
acceptable for a gauge.

#### Why the context-window field is retained

The reference project reports **throughput**, whereas the context window is **remaining
headroom** — different semantics. The implementation therefore merges the two: the form and
number rules follow the reference, the fields are predominantly throughput-oriented, and the
context window with its warning is retained, because "approaching the limit" is the only
actionable signal on that line.

### Performance mode

The liquid-glass look spends GPU continuously on three fronts — the animated aurora,
`backdrop-filter` sampling, and pointer-driven tilt/highlight. On modest hardware, or in a
background tab, that cost buys nothing. V2.0 adds a one-click reduction:

| Item | Design |
|---|---|
| Toggle | "Performance" button in the topbar; while active it reads "Eco" and turns amber |
| What is reduced | Aurora freezes into a static gradient; all `backdrop-filter` disabled (opaque gradients keep contrast); entrance/breathing/pulse animations off; `glass.js` skips all pointer tracking (including the per-move `getBoundingClientRect`) |
| Automatic default | On first visit with no stored choice: `prefers-reduced-motion`, ≤ 4 logical cores, or ≤ 4 GB memory default to eco mode |
| Persistence | Manual toggles are stored in `localStorage` (key `step-orchestra:perf-lite`); automatic defaults are not, so a different device gets its own honest default |
| Background idle | Hidden tabs park the continuous animations (`html.perf-paused`) and resume on return |
| Nothing lost | Status colouring (running/done/failed rails; breathing becomes a static ring) is fully preserved, as is hierarchy and readability |

### Liquid glass implementation

| Layer | Technique |
|---|---|
| Refraction base | `backdrop-filter: blur(22px) saturate(175%)` |
| Glass body | 142° white gradient + 1 px specular border + four-way `inset` shadow simulating thickness |
| Specular highlight | `radial-gradient` following `--gx` / `--gy`, written by `glass.js` |
| Depth | Cards follow `--rx` / `--ry` for a parallax tilt of at most 4.5° |
| Liquid deformation | The empty-state halo applies SVG `feTurbulence` and `feDisplacementMap` |
| Performance guards | Pointer events coalesced via rAF; node entrance animation uses `backwards` rather than `both` (the latter locks `transform` and breaks hover); `contain: layout paint`; the topbar "Performance" toggle reduces load in one click (see previous section) |
| GPU guards | `backdrop-filter` is kept only on large surfaces such as the topbar and the two panels, never on node cards (per-card background sampling is the main cost at scale); the running-node "breathing" animation drives only a dedicated overlay's `opacity` instead of repainting `box-shadow` every frame; cards carry no permanent `will-change` |
| Degradation | Without `backdrop-filter` support, panels fall back to high-opacity solid colour; `prefers-reduced-motion` disables all animation |

> True refraction requires distorting the content behind the glass, and CSS cannot apply a
> displacement filter to `backdrop`. The impression of refraction is therefore produced by
> highlight, inner shadow, and tilt working together; SVG displacement filters appear only on
> decorative elements to avoid distorting text.

### Project structure

```text
step-orchestra/
├── start.mjs            # One-click launcher: locate/build the gateway, run, open the browser
├── start.bat            #   Windows double-click entry
├── start.sh             #   macOS / Linux entry (start.command carries the same content)
├── extensions/          # Step Code extension (TypeScript, ESM, Node ≥ 22)
│   ├── index.ts         #   Entry: event subscription and forwarding
│   ├── bridge.ts        #   Go child-process lifecycle + reverse channel + auto-build when missing
│   ├── conversation.ts  #   Conversation mirror: replay / streaming / sending
│   ├── metrics.ts       #   Turn timing and throughput
│   ├── profiles.ts      #   Credential application: registerProvider hot swap
│   ├── progress.ts      #   Defensive WorkflowProgress parsing
│   ├── redact.ts        #   Redaction and truncation
│   └── types.ts         #   Wire protocol
├── gateway/             # Go gateway (standard library, zero third-party dependencies)
│   ├── main.go          #   stdin reader + HTTP/SSE + REST endpoints
│   ├── state.go         #   Topology state machine
│   ├── state_test.go    #   State machine unit tests (new in V2.0)
│   ├── conversation.go  #   Conversation log (bounded, indexed by id)
│   ├── profiles.go      #   Credential store (atomic writes, masked projection)
│   └── hub.go           #   SSE broadcast
├── web/                 # Browser panel (no build step, plain HTML/CSS/JS)
│   ├── perf.js          #   Performance mode: auto-detect / persist / background idle (new in V2.0)
│   ├── token.js         #   Panel token bootstrap: read URL fragment, clean the address bar, sessionStorage
│   ├── liquid-glass.css #   Design system + view stack + switch + profile popover + perf-lite
│   ├── glass.js         #   Pointer highlight / parallax tilt (skipped in performance mode)
│   ├── tree.js          #   Orchestration tree rendering (incremental reuse)
│   ├── chat.js          #   Conversation view (bubble reuse + bottom pinning)
│   ├── profiles.js      #   API profile picker
│   └── app.js           #   SSE client + mode switching + inspector
├── docs/
│   └── architecture.svg #   Architecture diagram
└── tools/
    ├── mock-feed.mjs    # End-to-end verification (orchestration, chat, reverse channel, credentials, usage)
    ├── test-progress.mjs# Host payload parsing regression
    ├── test-launcher.mjs# Launcher unit regression (new in V2.0)
    ├── test-token.mjs   # Panel token bootstrap regression (fragment / address bar / sessionStorage)
    ├── test-extension-import.mjs # Extension module-graph smoke test (new in V2.0)
    ├── run-all-tests.mjs# Aggregated entry, supports --rounds (new in V2.0)
    └── check-layers.mjs # Static stacking-order check
```

Front-end debugging loop: run `npm run demo` (or `node tools/mock-feed.mjs --serve`), edit
files, and refresh the browser — no build step is required.

---

## Verification status

Aggregated entry: `npm test` (or `node tools/run-all-tests.mjs --rounds 3` for a multi-round soak).

| Item | Status |
|---|---|
| Extension loaded and executed by Step Code | Verified (`step -e` and automatic discovery) |
| Automatic discovery (`step install` → `config.toml`) | Verified (`step list`) |
| Extension lifecycle hooks | Verified (gateway exits cleanly after `session_shutdown`, no orphan processes) |
| Port conflict fallback | Verified (47810 in use, falls through to 47811) |
| Gateway ↔ front-end link (orchestration / chat / reverse channel / credentials / usage) | `tools/mock-feed.mjs` **38/38** assertions (including read/write auth, cross-site Origin, static assets) |
| Host payload parsing | `tools/test-progress.mjs` 11/11 assertions |
| Gateway state machine (lifecycle / eviction / placeholder / sequence / stats) | `gateway/state_test.go`, 6 `go test` groups (new in V2.0) |
| Launcher decision logic (platform naming / flags / candidate resolution / fragment URL scraping) | `tools/test-launcher.mjs` 8/8 assertions (new in V2.0) |
| Panel token bootstrap (fragment parsing / address-bar cleanup / sessionStorage fallback) | `tools/test-token.mjs` 6/6 assertions |
| Extension module graph loads, export surface holds | `tools/test-extension-import.mjs` (new in V2.0) |
| Credential persistence to disk | Verified; `profiles.json` written and contains the key |
| Plaintext key never reaches the browser | Verified; response bodies contain no plaintext |
| Profile popover stacking order | `tools/check-layers.mjs` 11/11 (the script was confirmed to catch the original defect) |
| Reverse-channel authentication (no token rejected) | Verified, returns 401 |
| Performance mode (toggle / persistence / background idle) | New in V2.0, verified in-browser and via scripts |
| Real agent event stream (tool_call / messages) | **Not verified** — requires signing in and running a real task |
| `registerProvider` hot swap actually taking effect | **Not verified** — requires signing in and observing the next request |

### Reproducing the stacking-order check

```bash
node tools/check-layers.mjs      # static analysis, 11 assertions
```

The criterion is purely static: **a descendant can never cross the stacking context root it
belongs to**. Verifying the single invariant "`.topbar`'s z-index is strictly greater than
`.stage`'s" is therefore sufficient to guarantee that the profile popover nested inside
`.topbar` cannot be occluded by the content area. The script was validated in reverse during
the fix — reverting `z-index` to `2` immediately drops it to 9/11 with a non-zero exit code.

To confirm manually: click the "Configuration" button in the topbar; the popover should fully
cover the orchestration tree and conversation area. It should behave identically after
narrowing the window below 1080 px (where `.stage` collapses to a single column).

---

## Known limitations

- **The real agent event stream is unverified.** `~/.stepcode/auth.json` is empty (not signed in),
  and step does not establish a real session outside a TTY, so `session_start` and tool events
  never fired. Signing in and issuing one `subagent` call closes this gap.
- **Interface shape is calibrated against 0.1.1.** On 0.84.x, `partialResult` becomes `details`,
  and `subagent` may become a built-in tool alongside a new `workflow`. The parsing layer already
  accommodates both.
- **Subagent detail is aggregated.** Subagents run in separate processes, so the main process
  cannot observe their internal tool calls; the panel can only show the agent rows the host
  provides in its progress snapshot.
- **Fan-out is one level deep.** This is a Step Code constraint, so the tree is at most two levels.
- **The first build needs the Go toolchain.** Binaries are not distributed in the repository
  (`bin/` is not committed); both the extension and the launcher build automatically, but Go
  (https://go.dev/dl) must still be installed on the machine.
- **The first build is an install trust model.** It only executes repository source (no network,
  no shell, no argument concatenation), but installing the repository is equivalent to executing
  its source locally — install only trusted sources.
- **Ports are confined to 47810–47821.** If all are taken, startup fails and `/orchestra`
  reports the reason.

---

## Troubleshooting

| Symptom | Resolution |
|---|---|
| `/orchestra` reports a missing binary / Go unavailable | Run `start.bat` (or `npm start`) once; or install Go and run `/orchestra` again to trigger the auto-build |
| start.bat closes instantly | Node.js ≥ 22 is not installed; install it from https://nodejs.org and retry |
| Panel is stuck on "connecting" | Check that the `#t=` fragment is intact; the token changes on every run. The address bar drops `#t=` after load — that is expected |
| Using an old query-string address | Query-string addresses from v2.0.0 and earlier are dead; rerun `/orchestra` and open the new `#t=` URL |
| Panel shows "session expired" | The gateway restarted with a fresh token; rerun `/orchestra` and open the newly printed address |
| No nodes appear | Confirm the run uses `subagent` / `workflow`; ordinary tool calls require turning off the "orchestration only" filter |
| Port already in use | Override the starting port with `STEP_ORCHESTRA_PORT=50000`, or `npm start -- --port 50000` |
| Custom gateway path | Override with `STEP_ORCHESTRA_BIN=/path/to/gateway` |
| Disable the auto-build | Set `STEP_ORCHESTRA_AUTOBUILD=0` |

---

## Release notes

| Version | Theme | Release notes |
|---|---|---|
| v2.0.0 | One-click startup, performance mode, and multi-round reliability verification | [docs/releases/v2.0.0.md](docs/releases/v2.0.0.md) |
| v1.5.0 | Stability, concurrency correctness, and rendering performance fixes | [docs/releases/v1.5.0.md](docs/releases/v1.5.0.md) |
| v1.0.0 | First public release | [docs/releases/v1.0.0.md](docs/releases/v1.0.0.md) |

See [CHANGELOG.md](CHANGELOG.md) for version-by-version changes.

---

## License

This project is licensed under the **GNU Affero General Public License v3
(AGPL-3.0-only)**. The full licence text is in [LICENSE](LICENSE).

© 2026 Neriah

### Restrictions and requirements

| Mode of use | Requirement |
|---|---|
| Running it yourself (including internally in production) | None |
| Distributing the software or a modified version | Provide the complete corresponding source under AGPL-3.0; retain copyright and licence notices; state the changes and their dates |
| Distributing modifications | The modifications are themselves bound by AGPL-3.0 |
| Providing it as a network service | Offer all remote users a prominent way to obtain the corresponding source (section 13) |
| Integrating into another program | If the result is a derivative work, the whole work must be licensed under AGPL-3.0 |
| Commercial use | Permitted, without waiving any requirement above |

- Copyright and licence notices may not be removed or circumvented;
- Derivative works may not be relicensed under more permissive terms;
- No further restrictions conflicting with this licence may be imposed (GPLv3 section 10);
- On violation the licence terminates automatically and must be reinstated by the copyright holder (section 8).

Documentation style: [DOCS-STYLE](https://github.com/Neriah-Ado/Neriah-Ado/blob/main/docs/DOCS-STYLE.md)
