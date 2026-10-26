#!/usr/bin/env sh
# StepFun Code-GUI one-click launcher (macOS / Linux).
# Double-click start.command on macOS, or run: ./start.sh
set -e

if ! command -v node >/dev/null 2>&1; then
	echo "[step-orchestra] Node.js not found - install Node.js 22+ from https://nodejs.org/"
	exit 1
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
exec node "$HERE/start.mjs" "$@"
