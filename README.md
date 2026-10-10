<p align="center">
  <img src="assets/huddle-logo.svg" alt="Huddle" width="220">
</p>

# Huddle Server: Your Meetings, Processed on Your Own Machine

![Docker](https://img.shields.io/badge/Docker-Compose-2496ED.svg?logo=docker&logoColor=white)
![Platforms](https://img.shields.io/badge/Linux-x86__64%20%7C%20arm64-black.svg?logo=linux&logoColor=white)
![Status](https://img.shields.io/badge/Status-Active-success)
![License](https://img.shields.io/badge/License-MIT-blue.svg)

**Huddle Server** is the self-hosted companion to [Huddle](https://github.com/scoopy115/huddle).
It runs on a machine of your own: a home server, a NAS, a VPS. Huddle sends a recording over,
the server transcribes it, separates the speakers and writes the notes, and the result lands
back on your computer. Nothing leaves hardware you control.

---

## 🚀 Key Features

### 📡 Processing for your Huddle apps
* **Offload the heavy work:** transcription, speaker separation and notes run on the server
  instead of the computer that recorded.
* **Per device:** every computer connects with its own client key, revocable at any time.
* **Results come back:** the meeting appears in Huddle as if it was processed there.

### 🖥️ A dashboard that is also a Huddle
* **Record in the browser:** the microphone of any device and, in Chrome and Edge, the audio of
  a tab or screen for online calls.
* **Everything from the app:** meetings with player and transcript, speakers you rename and let
  the server remember, projects, action items, search, Ask, Refine.
* **Import** an audio file and get the same treatment.

### 👥 Accounts
* **Admin and users:** the first account is the admin. Invite people with a link, or open
  registration and approve accounts yourself.
* **Who sees what:** a client sees its own recordings; an admin can let a client see everything.
  Projects and known voices belong to the account that made them.
* **Notes per client:** switch them off for a client and it gets transcripts only.
* **Two-factor authentication** with any authenticator app.

### 🤖 Works with your AI tools
* **MCP:** Claude Code, Claude Desktop, Cursor and other MCP clients search and read the
  meetings on the server, with a token per client that sees what the client sees.

### 🔒 Private by design
* No telemetry, no analytics, no external services. The only outbound traffic is the model
  downloads you start.
* Audio retention and a storage cap keep disk use in hand; transcripts and notes are kept.
* Keys and tokens are stored hashed.

---

## 📦 Install

Requirements: Linux or macOS with Docker and Docker Compose, 8 GB of RAM (16 GB with an AI
model), and a few GB of disk for the models you choose.

```bash
curl -fsSL https://raw.githubusercontent.com/scoopy115/huddle-server/main/install.sh | sh
```

The installer asks for a name and a port, writes `~/huddle-server/.env` and starts the server.
Then:

1. Open **http://\<host\>:48731**, create the admin account and follow the setup to download the
   models.
2. **Clients → New client key.** In Huddle: Settings → Server → the address and the key →
   Connect. From then on Huddle asks after each recording whether to process it here or on the
   server.

Prefer to do it by hand? Copy [`docker-compose.yml`](docker-compose.yml) and
[`.env.example`](.env.example) (as `.env`) into a folder and run `docker compose up -d`.

### TLS

The server speaks plain HTTP on one port; put the reverse proxy you already run in front of it.
Without one, the built-in proxy does it: set `COMPOSE_PROFILES=tls` and `HUDDLE_TLS_DIR=/certs`
in `.env`. With `HUDDLE_DOMAIN` it uses Let's Encrypt; without, its own certificate, which Huddle
asks you to confirm once.

### Updating

```bash
cd ~/huddle-server && docker compose pull && docker compose up -d
```

---

## 🧑‍💻 Development

Requirements: Python 3.11, Node 20+, the [Huddle](https://github.com/scoopy115/huddle)
repository checked out next to this one (the engine lives there).

```bash
scripts/fetch-engine.sh                      # ../Huddle/engine → vendor/engine (or clones it)
cd server && python3.11 -m venv .venv.nosync && .venv.nosync/bin/pip install -e ../vendor/engine -e ".[dev]"
.venv.nosync/bin/python -m pytest
cd ../dashboard && npm install && npm run build:server
HUDDLE_DATA_DIR=/tmp/hs ../server/.venv.nosync/bin/huddle-server serve     # http://localhost:48731
```

`npm run dev` in `dashboard/` serves the UI on :5180 and proxies the API to :48731.

Docker image: `scripts/fetch-engine.sh && docker build -t huddle-server:local .`, then
`HUDDLE_IMAGE=huddle-server:local docker compose up -d`. The GitHub workflow publishes
`ghcr.io/scoopy115/huddle-server` on every push to `main` and on `v*` tags.

---

## ❤️ Credits & Acknowledgment

Huddle Server stands on the same open-source work as Huddle:

* **Transcription:** [Whisper](https://github.com/openai/whisper) via [CTranslate2](https://github.com/OpenNMT/CTranslate2), [Parakeet](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)
* **Speaker separation:** [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) with the [pyannote](https://github.com/pyannote/pyannote-audio) segmentation model and NVIDIA's TitaNet embeddings
* **Notes:** [Ollama](https://ollama.com) running local models such as Qwen
* **Server:** [FastAPI](https://fastapi.tiangolo.com), [React](https://react.dev), [Tailwind CSS](https://tailwindcss.com), [Caddy](https://caddyserver.com)

Huddle is created by Dylan Kiesebrink with extensive assistance from **Claude Fable 5.1**
(Anthropic) as a co-pilot for architecture, implementation and debugging.

---

## 📄 License

Huddle Server is released under the [MIT License](LICENSE).
