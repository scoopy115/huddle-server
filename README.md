<p align="center">
  <img src="assets/huddle-logo.svg" alt="Huddle" width="220">
</p>

# Huddle Server: Your Meetings, Processed on Your Own Machine

![Docker](https://img.shields.io/badge/Docker-Compose-2496ED.svg?logo=docker&logoColor=white)
![Platforms](https://img.shields.io/badge/Linux-x86__64%20%7C%20arm64-black.svg?logo=linux&logoColor=white)
![Status](https://img.shields.io/badge/Status-Active-success)
![License](https://img.shields.io/badge/License-MIT-blue.svg)

**Huddle Server** is the self-hosted companion to [Huddle](https://github.com/scoopy115/huddle).
Run it on a home server, a NAS or a VPS. Huddle sends a recording over, the server does the
transcription, the speakers and the notes, and the meeting appears in Huddle as usual. Nothing
leaves hardware you control.

---

## 🚀 Key Features

### 📡 Processing for Huddle
* **Offload the heavy work** from the computer that recorded.
* **One key per device**, revocable at any time.
* **The result lands in Huddle** like any other meeting.

### 🖥️ Huddle in the browser
* **Record** with the microphone of any device, or import an audio file.
* **The full experience:** meetings with player and transcript, speakers, projects, action items,
  search, Ask and Refine.

### 👥 Accounts
* **Admin and users:** invite people with a link, or let them sign up and approve them.
* **Who sees what:** a client sees its own recordings unless an admin opens up everything.
  Projects and known voices stay with the account that made them.
* **Two-factor authentication.**

### 🤖 Works with your AI tools
* **MCP** for Claude Code, Claude Desktop, Cursor and others, with a token per client.

### 🔒 Private by design
* No telemetry, no analytics, no external services.
* Audio retention and a storage cap; transcripts and notes are kept.

---

## 📦 Install

Requirements: Linux or macOS with Docker, 8 GB of RAM (16 GB with an AI model), a few GB of disk
for the models.

```bash
curl -fsSL https://raw.githubusercontent.com/scoopy115/huddle-server/main/install.sh | sh
```

Then open **http://\<host\>:48731**, create the admin account and follow the setup. Under
**Clients** you make the key that connects Huddle (Settings → Server).

By hand: copy [`docker-compose.yml`](docker-compose.yml) and [`.env.example`](.env.example)
(as `.env`) into a folder and run `docker compose up -d`.

**TLS:** put your own reverse proxy in front, or set `COMPOSE_PROFILES=tls` in `.env` for the
built-in one (Let's Encrypt with `HUDDLE_DOMAIN`, otherwise a certificate Huddle asks you to
confirm once).

**Update:** `docker compose pull && docker compose up -d`.

---

## 🧑‍💻 Development

Requirements: Python 3.11, Node 20+, the [Huddle](https://github.com/scoopy115/huddle)
repository next to this one (the engine lives there).

```bash
scripts/fetch-engine.sh
cd server && python3.11 -m venv .venv.nosync && .venv.nosync/bin/pip install -e ../vendor/engine -e ".[dev]"
.venv.nosync/bin/python -m pytest
cd ../dashboard && npm install && npm run build:server
HUDDLE_DATA_DIR=/tmp/hs ../server/.venv.nosync/bin/huddle-server serve     # http://localhost:48731
```

`npm run dev` in `dashboard/` serves the UI on :5180 and proxies the API to :48731.

Docker image: `scripts/fetch-engine.sh && docker build -t huddle-server:local .`. The GitHub
workflow publishes `ghcr.io/scoopy115/huddle-server` on every push to `main` and on `v*` tags.

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
