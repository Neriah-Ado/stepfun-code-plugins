# AGENTS.md — dsh-redqueen-splash

A DeepSeek Harness (dsh) **bundle** that plays a Resident Evil Red Queen style boot splash in the desktop app and in `dsh web`, re-themes the interface through design tokens, and replaces the brand marks. Read this before installing, configuring, removing, or changing it. Reply to the user in their language (the owner writes Chinese). User-facing installation, configuration and licensing live in [README.md](README.md); this file is the agent-facing runbook, and implementation details live in [docs/development.md](docs/development.md).

## Facts

| Item | Value |
| --- | --- |
| Package / bundle name | `dsh-redqueen-splash` |
| Plugin entry id | `redqueen-splash` |
| Version | see `package.json` |
| Install source (local) | absolute path of this repository root — the directory containing this file. Get it with `pwd`; it may contain spaces. Prefer this when you are working inside a clone. |
| Install source (remote) | `github:Neriah-Ado/dsh-resident-theme`. Prefer pinning a ref: `github:Neriah-Ado/dsh-resident-theme#<40-char-commit-sha>` (a release tag also works, but tags can be moved). Never install from a fork or an unverified URL. |
| DSH peer dependencies | `@deepseek-ai/schemastery` (optional) → never request or grant a version exemption for anything else |
| Install scripts | none → never pass `approvedBuilds` |
| Takes effect | on the next app launch; the splash plays once per launch |

## Install with the `plugin_manager` tool (inside dsh)

1. Call `plugin_manager` with `{ "action": "list_bundles" }`. Look for `dsh-redqueen-splash`.
   - Present and enabled → already installed. Tell the user and stop.
   - Present but disabled → call `{ "action": "set_bundle", "target": "dsh-redqueen-splash", "enabled": true }`, then go to step 3.
2. Call `{ "action": "install_bundle", "target": "<source>" }`, where `<source>` is the absolute repository path when you are inside a clone. Pass paths exactly, spaces included, without quotes. The bundle is enabled by default.
3. Tell the user to fully quit DeepSeek Harness (⌘Q on macOS, close on Windows) and reopen it to see the splash.

Each call asks the user for approval; that is expected. If `plugin_manager` is not available in this session, do not edit profile files by hand. Tell the user to either switch the session to the **Creator** preset or install from the sidebar: **插件 → 添加插件**, paste the repository path, then **立即启用** and restart.

Remote installs run bundle JavaScript inside the Harness web UI, which shares the UI's session capabilities. Pin a commit SHA (or a release tag) when installing from GitHub, and do not install from a fork or an unverified URL. The brand markup is allowlist-validated before injection (`lib/index.js`), but the splash script and client half are trusted code: the pin is the real trust boundary.

## Install from a shell (other coding agents)

Run this only if the user asks for a terminal install. The desktop app must be fully quit first, because it holds the profile.

```bash
dsh plugin --profile desktop add "<absolute repository path>"
```

- Web app (`dsh web`): stop it, then run `dsh plugin --profile web add "<source>"` and start `dsh web` again. dsh calls the `pnpm` on PATH; if it is missing, tell the user rather than installing it.
- The error `Open DeepSeek Harness Desktop once to initialize its profile, then fully quit it` means the app has never run, or it is still running.
- A successful install adds `dsh-redqueen-splash` to `dsh.profile.bundles` in `~/.dsh/profiles/desktop/package.json` (or `web`). That file is the read-only way to verify the install.

## Configure

Prefer the UI: the config page (sidebar **插件** → this plugin → **配置**) or the `/redqueen` command; both save through dsh settings. The page saves each change immediately (text fields on blur or Enter), its single **恢复默认** button resets every changed field at once, and **预览开屏** plays the current settings.

The canonical option table (17 keys, defaults and allowed values) lives in [README.md](README.md#配置); do not duplicate it here. If a config file edit is unavoidable, append an override to `~/.dsh/profiles/desktop/cordis.patch.yml` (web: `profiles/web/`) and keep the existing content. The override replaces the whole `config` block; omitted keys fall back to their defaults. Restart the app afterwards.

```yaml
- id: redqueen-splash
  config:
    exit: iris
    duration: 5000
```

## Uninstall

Use `plugin_manager` `{ "action": "remove_bundle", "target": "dsh-redqueen-splash" }`. From a shell, with the app quit, run `dsh plugin --profile desktop remove dsh-redqueen-splash`. Either way, restart the app afterwards. To pause the splash without uninstalling, use `set_bundle` with `"enabled": false`.

## Never

- Modify anything inside the installed DeepSeek Harness app bundle (signed, integrity-checked).
- Hand-edit `~/.dsh/profiles/*/package.json` or `pnpm-workspace.yaml`.
- Grant version exemptions, or pass `approvedBuilds`.
- Install the remote bundle unpinned for someone else's profile; pin a commit or release tag instead.

## Development

Implementation details, injection constraints, splash internals, preview and test instructions live in [docs/development.md](docs/development.md). Read it before changing `lib/`, `scripts/` or `cordis.patch.yml`; keep `CHANGELOG.md` updated under `[未发布]`.
