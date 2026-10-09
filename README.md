# Huddle Server

Process your Huddle recordings on a machine of your own — a home server, a NAS, a VPS — instead
of on the laptop that recorded them. The Huddle app sends the audio over TLS, the server
transcribes, separates speakers and (with an AI model) writes the notes, and the result lands back
in the app like any other meeting. Transcripts and notes stay on the server too, searchable from the
dashboard and from AI tools over MCP.

Huddle Server is something you host yourself. There is no hosted version.

## Install

Linux or macOS with Docker:

```bash
curl -fsSL https://raw.githubusercontent.com/scoopy115/huddle-server/main/install.sh | sh
```

The installer asks for a name, an optional public domain and two ports, writes `~/huddle-server/.env`
and starts the containers. Then:

1. Open the dashboard (`https://<host>:8443`) and create the admin account. Turn on two-factor
   authentication under Account.
2. Models → download a transcription model. With the `ai` profile (`docker compose --profile ai up -d`)
   you can also download an AI model for the notes; without one, the Huddle app writes the notes on
   the Mac after the server returns the transcript.
3. Clients → New client key. Paste the server address and the key in Huddle under Settings → Server.

Without a domain the server uses its own certificate. Huddle shows its SHA-256 fingerprint on first
contact; compare it with the one on the dashboard's Overview page and confirm. With `HUDDLE_DOMAIN`
set, Caddy fetches a Let's Encrypt certificate and nothing needs confirming.

### Ports

| Port (default) | What | Forward it? |
|---|---|---|
| 443 | Client API (`/v1`) and MCP (`/mcp`) | Yes, this is what the Huddle app connects to |
| 8443 | Dashboard | Only when you need the dashboard from outside your network |
| 80 | Let's Encrypt challenge | Only with a domain |

Change them in `.env` (`HUDDLE_PORT`, `HUDDLE_DASHBOARD_PORT`, `HUDDLE_HTTP_PORT`).

### Without Docker

```bash
pip install "huddle-engine @ git+https://github.com/scoopy115/huddle.git#subdirectory=engine"
pip install "huddle-server @ git+https://github.com/scoopy115/huddle-server.git#subdirectory=server"
HUDDLE_DATA_DIR=~/huddle-data HUDDLE_TLS_DIR=~/huddle-data/certs huddle-server serve
```

This runs on `http://0.0.0.0:48731` without TLS; put your own reverse proxy in front, or use the
Docker setup. On an Apple Silicon Mac the bare install uses MLX (Metal) for transcription.

`huddle-server --help` lists the CLI: create accounts and client keys, pull models, print the
certificate fingerprint. Accounts made on the CLI are admins when they are the first account.

## Accounts, clients and what they may see

- **Admin** — created at first start. Admins see everything: all meetings, settings, models,
  users. Everyone else is a **user**.
- **Users** join through an invitation link (Users → Invite) or, when you switch registration to
  *open*, by creating an account that an admin then approves.
- **Clients** are devices with a key (a Mac running Huddle, later a phone). Every account makes its
  own client keys. A client has a *scope*: it sees its **own** recordings, or — when an admin says
  so — **all** recordings on the server. The dashboard shows an account the recordings of its
  clients, and everything when one of its clients has scope *all*. Only the account that sent a
  recording (or an admin) can delete it.
- **MCP tokens** are made per client, from the Huddle app (`/v1/mcp-tokens`) or the dashboard
  (Clients → tokens). A token sees exactly what its client sees. The endpoint is `/mcp` on the
  client port (streamable HTTP, `Authorization: Bearer hmt_…`). Revoking a client silences its
  tokens.

Typical setups: one person, several devices → give the devices scope *all*. Hosting for friends →
leave everyone on *own*; nobody sees anyone else's recordings, not even over MCP.

### What is locked down

- `/engine/*` (the engine's full API: settings, models, every meeting) is admin-only. Users get
  `/api/meetings`, `/api/search` and `/api/clients`, filtered by what they may see.
- Dashboard sessions are HttpOnly cookies; every state change needs the `X-Requested-With`
  header (CSRF). Login and registration are throttled per address and per e-mail. Passwords are
  argon2id; TOTP is optional and recommended for admins.
- Public endpoints before login reveal only the server name and the certificate fingerprint.
  Clients and tokens are hashed at rest and shown once.
- Uploads are capped (`HUDDLE_MAX_UPLOAD_MB`, default 2048) and recording ids are validated.
- Responses carry a strict Content-Security-Policy, `X-Frame-Options: DENY` and `Cache-Control:
  no-store` on API paths. The API documentation endpoints are disabled.

## How it works

- The server embeds the [Huddle engine](https://github.com/scoopy115/huddle/tree/main/engine), the
  same Python package the desktop app runs as a sidecar. Processing, storage, retention and MCP are
  the engine's; the server adds accounts, client keys, the dashboard and the upload API.
- The desktop prepares the audio (16 kHz mono) and uploads it FLAC-compressed. The server runs the
  normal pipeline. The desktop polls, then imports the result: transcript, speakers with their voice
  embeddings, and the notes when the server wrote them. Known-voice recognition runs on the Mac,
  because the voices live there.
- Audio retention (days, storage cap) is set in the dashboard; transcripts and notes are kept.
- `/v1` is authenticated with a client key (`hsk_…`, one per device, revocable) and scoped per
  client. `/mcp` takes MCP tokens (`hmt_…`) with the same scope. The dashboard uses a session
  cookie; two-factor authentication is TOTP.

## Development

```bash
scripts/fetch-engine.sh            # copies ../Huddle/engine (or clones it) into vendor/engine
cd server && python3.11 -m venv .venv.nosync && .venv.nosync/bin/pip install -e ../vendor/engine -e ".[dev]"
.venv.nosync/bin/python -m pytest
cd ../dashboard && npm install && npm run build      # → server/huddle_server/static
HUDDLE_DATA_DIR=/tmp/hs HUDDLE_TLS_DIR=/tmp/hs/certs HUDDLE_INSECURE_COOKIES=1 ../server/.venv.nosync/bin/huddle-server serve
```

`npm run dev` in `dashboard/` serves the UI on :5180 and proxies the API to :48731.

Docker image: `scripts/fetch-engine.sh && docker build -t huddle-server:local .`
(`HUDDLE_IMAGE=huddle-server:local docker compose up -d`). The GitHub workflow publishes
`ghcr.io/scoopy115/huddle-server` for amd64 and arm64 on every push to `main` and on `v*` tags.

## Roadmap

- Recording from the browser (the dashboard as a recorder on any device).
- iPhone companion that records and sends to the server.
- CUDA image.

MIT. Huddle is a product of Dylan Kiesebrink.
