#!/bin/sh
# Huddle Server installer (Linux / macOS with Docker).
#   curl -fsSL https://raw.githubusercontent.com/scoopy115/huddle-server/main/install.sh | sh
# Options via environment: HUDDLE_DIR (default ~/huddle-server), HUDDLE_DOMAIN, HUDDLE_PORT,
# HUDDLE_DASHBOARD_PORT, HUDDLE_SERVER_NAME, HUDDLE_AI=1 (also run the Ollama container).
set -eu

RAW="${HUDDLE_RAW:-https://raw.githubusercontent.com/scoopy115/huddle-server/main}"
DIR="${HUDDLE_DIR:-$HOME/huddle-server}"

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
ask() { # ask "Question" default
  if [ -t 0 ]; then printf '%s [%s]: ' "$1" "$2" >&2; read -r a || a=""; [ -n "$a" ] && printf '%s' "$a" || printf '%s' "$2"; else printf '%s' "$2"; fi
}

command -v docker >/dev/null 2>&1 || die "Docker is not installed. See https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is missing (docker compose)."

mkdir -p "$DIR/caddy"
cd "$DIR"
for f in docker-compose.yml caddy/Caddyfile.selfsigned caddy/Caddyfile.domain .env.example; do
  curl -fsSL "$RAW/$f" -o "$f" || die "could not download $f"
done

if [ ! -f .env ]; then
  cp .env.example .env
  NAME="${HUDDLE_SERVER_NAME:-$(ask 'Server name' 'Huddle Server')}"
  DOMAIN="${HUDDLE_DOMAIN:-$(ask 'Public domain (empty = self-signed certificate)' '')}"
  PORT="${HUDDLE_PORT:-$(ask 'Port for the Huddle app' '443')}"
  DPORT="${HUDDLE_DASHBOARD_PORT:-$(ask 'Port for the dashboard' '8443')}"
  AI="${HUDDLE_AI:-$(ask 'Run an AI model for notes on this machine? (y/n)' 'n')}"
  esc() { printf '%s' "$1" | sed 's/[&/\]/\\&/g'; }
  sed -i.bak "s/^HUDDLE_SERVER_NAME=.*/HUDDLE_SERVER_NAME=$(esc "$NAME")/; s/^HUDDLE_DOMAIN=.*/HUDDLE_DOMAIN=$(esc "$DOMAIN")/; s/^HUDDLE_PORT=.*/HUDDLE_PORT=$PORT/; s/^HUDDLE_DASHBOARD_PORT=.*/HUDDLE_DASHBOARD_PORT=$DPORT/" .env
  [ -n "$DOMAIN" ] && sed -i.bak "s/^HUDDLE_CADDYFILE=.*/HUDDLE_CADDYFILE=Caddyfile.domain/" .env
  rm -f .env.bak
  case "$AI" in y|Y|yes|1) printf 'COMPOSE_PROFILES=ai\n' >> .env ;; esac
fi

say "Starting Huddle Server in $DIR …"
docker compose pull --quiet 2>/dev/null || true
docker compose up -d

. ./.env
HOST="${HUDDLE_DOMAIN:-$(hostname -I 2>/dev/null | awk '{print $1}' || hostname)}"
[ -z "$HOST" ] && HOST="$(hostname)"
say ""
say "Huddle Server is starting."
say "  Dashboard : https://$HOST:${HUDDLE_DASHBOARD_PORT:-8443}   (create your account there)"
say "  App URL   : https://$HOST:${HUDDLE_PORT:-443}   (Huddle → Settings → Server)"
[ -z "${HUDDLE_DOMAIN:-}" ] && say "  The certificate is self-signed: your browser warns once; the Huddle app asks you to confirm the fingerprint shown in the dashboard."
say ""
say "Logs: cd $DIR && docker compose logs -f"
