#!/usr/bin/env bash
# Put the Huddle engine source in vendor/engine for the Docker build.
#   scripts/fetch-engine.sh                 # from ../Huddle/engine when it exists, else from GitHub
#   scripts/fetch-engine.sh --git [ref]     # always from GitHub (default ref: main)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="${HUDDLE_REPO:-https://github.com/scoopy115/huddle.git}"
# A private Huddle repository: pass a token (HUDDLE_REPO_TOKEN) and it is woven into the clone URL.
if [ -n "${HUDDLE_REPO_TOKEN:-}" ]; then REPO="$(printf '%s' "$REPO" | sed "s#https://#https://x-access-token:${HUDDLE_REPO_TOKEN}@#")"; fi
MODE="${1:-auto}"
REF="${2:-main}"
rm -rf "$ROOT/vendor/engine"
mkdir -p "$ROOT/vendor"
if [ "$MODE" != "--git" ] && [ -d "$ROOT/../Huddle/engine/huddle_engine" ]; then
  echo "engine ← ../Huddle/engine"
  rsync -a --delete --exclude '.venv*' --exclude 'dist.nosync' --exclude 'build.nosync' --exclude '__pycache__' \
    --exclude '*.spec' --exclude '*.egg-info' --exclude '.pytest_cache' "$ROOT/../Huddle/engine/" "$ROOT/vendor/engine/"
else
  echo "engine ← $REPO@$REF (engine/)"
  tmp="$(mktemp -d)"
  git clone --depth 1 --filter=blob:none --sparse --branch "$REF" "$REPO" "$tmp" >/dev/null 2>&1
  git -C "$tmp" sparse-checkout set engine >/dev/null
  mv "$tmp/engine" "$ROOT/vendor/engine"
  rm -rf "$tmp"
fi
grep -m1 '^version' "$ROOT/vendor/engine/pyproject.toml"
