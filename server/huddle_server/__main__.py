"""Huddle Server command line.

  huddle-server serve                         run the server (env: HUDDLE_DATA_DIR, HUDDLE_HOST, HUDDLE_PORT, HUDDLE_TLS_DIR, …)
  huddle-server user add <email>              create a dashboard account (password prompted)
  huddle-server user list
  huddle-server client add <name>             create a client key (printed once)
  huddle-server client list
  huddle-server models pull <candidate-id>    download a model without the dashboard (e.g. whisper:large-v3-turbo)
  huddle-server models list
  huddle-server fingerprint                   SHA-256 of the self-signed certificate
"""
from __future__ import annotations

import argparse
import getpass
import logging
import sys
import time

from .config import ServerConfig, apply_engine_env


def _logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s", stream=sys.stderr)
    logging.getLogger("httpx").setLevel(logging.WARNING)


def cmd_serve(args) -> int:
    import uvicorn
    _logging()
    cfg = ServerConfig()
    if args.port:
        cfg.port = args.port
    uvicorn.run("huddle_server.app:app", host=cfg.host, port=cfg.port, log_level="info", access_log=False,
                proxy_headers=True, forwarded_allow_ips="*", timeout_keep_alive=75)
    return 0


def _db():
    from .db import ServerDB
    cfg = ServerConfig()
    cfg.ensure_dirs()
    return cfg, ServerDB(cfg.db_path)


def cmd_user(args) -> int:
    from . import auth
    _cfg, db = _db()
    if args.action == "list":
        for r in db.query("SELECT email, totp_enabled, created_at FROM users ORDER BY id"):
            print(f"{r['email']:40s} {'2FA' if r['totp_enabled'] else '   '}  {time.strftime('%Y-%m-%d', time.localtime(r['created_at']))}")
        return 0
    pw = args.password or getpass.getpass("Password (min. 10 characters): ")
    try:
        # the first account is the admin; later ones are users (promote them in the dashboard)
        u = auth.create_user(db, args.email, pw, role="admin" if auth.user_count(db) == 0 or args.admin else "user",
                             name=args.name or args.email.split("@")[0])
    except auth.AuthError as e:
        print(e, file=sys.stderr)
        return 1
    print(f"Account created: {u.email}")
    return 0


def cmd_client(args) -> int:
    from . import clients
    _cfg, db = _db()
    if args.action == "list":
        for c in clients.list_clients(db):
            print(f"{c.id:3d}  {c.name:30s} {c.prefix}…  {'revoked' if c.revoked else ''}")
        return 0
    admin = db.one("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")
    if not admin:
        print("Create an account first (huddle-server user add <email>)", file=sys.stderr)
        return 1
    c = clients.create(db, args.name, int(admin["id"]))
    print(f"Client key for “{c.name}” (shown once):\n\n  {c.key}\n")
    return 0


def cmd_models(args) -> int:
    from huddle_engine.context import EngineContext
    from huddle_engine.resolver import LLM_CANDIDATES, WHISPER_CANDIDATES, ResolverContext, candidates_for
    _logging()
    cfg = ServerConfig()
    cfg.ensure_dirs()
    apply_engine_env(cfg)
    ctx = EngineContext(start_jobs=False)
    ctx.registry.full_scan()
    if args.action == "list":
        rc = ResolverContext(ctx.registry, ctx.settings(), ctx.hardware.get("memoryBytes"))
        installed = {m.name for m in ctx.registry.models()}
        for c in candidates_for(rc):
            mark = "✓" if any(c.url == n or n.endswith(c.url) for n in installed) else " "
            print(f"{mark} {c.id:32s} {c.name:34s} {c.size_bytes / 1e9:5.1f} GB  {'recommended' if c.recommended else ''}")
        print("\ninstalled:")
        for m in ctx.registry.models():
            print(f"  {m.task:13s} {m.name}")
        return 0
    cand = next((c for c in WHISPER_CANDIDATES + LLM_CANDIDATES if c.id == args.candidate), None)
    if not cand and args.candidate.startswith("ollama:"):
        from huddle_engine.schemas import DownloadCandidate
        name = args.candidate.split(":", 1)[1]
        cand = DownloadCandidate(id=args.candidate, name=name, task="llm", purpose="Meeting summaries", size_bytes=0,
                                 source="ollama", url=name, license="see Ollama library")
    if not cand:
        print(f"Unknown model id {args.candidate!r}; see `huddle-server models list`", file=sys.stderr)
        return 1
    ctx.downloads.start(cand)
    last = -1
    while True:
        p = next((d for d in ctx.downloads.list() if d.id == cand.id), None)
        if not p:
            break
        pct = int(p.received_bytes * 100 / p.total_bytes) if p.total_bytes else -1
        if pct != last:
            print(f"\r{cand.name}: {pct if pct >= 0 else '?'}%", end="", file=sys.stderr, flush=True)
            last = pct
        if p.state in ("done", "failed", "cancelled"):
            print(f"\n{p.state}{': ' + p.error if p.error else ''}", file=sys.stderr)
            return 0 if p.state == "done" else 1
        time.sleep(1)
    return 0


def cmd_fingerprint(args) -> int:
    from . import certs
    cfg = ServerConfig()
    if not cfg.tls_dir:
        print("HUDDLE_TLS_DIR is not set", file=sys.stderr)
        return 1
    cert, _ = certs.ensure(cfg.tls_dir, cfg.name)
    print(certs.fingerprint(cert))
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="huddle-server", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sp = sub.add_parser("serve"); sp.add_argument("--port", type=int); sp.set_defaults(func=cmd_serve)
    sp = sub.add_parser("user"); sp.add_argument("action", choices=["add", "list"]); sp.add_argument("email", nargs="?")
    sp.add_argument("--password"); sp.add_argument("--name"); sp.add_argument("--admin", action="store_true"); sp.set_defaults(func=cmd_user)
    sp = sub.add_parser("client"); sp.add_argument("action", choices=["add", "list"]); sp.add_argument("name", nargs="?", default="Client")
    sp.set_defaults(func=cmd_client)
    sp = sub.add_parser("models"); sp.add_argument("action", choices=["pull", "list"]); sp.add_argument("candidate", nargs="?")
    sp.set_defaults(func=cmd_models)
    sp = sub.add_parser("fingerprint"); sp.set_defaults(func=cmd_fingerprint)
    args = p.parse_args(argv)
    if args.cmd == "user" and args.action == "add" and not args.email:
        p.error("user add needs an e-mail address")
    if args.cmd == "models" and args.action == "pull" and not args.candidate:
        p.error("models pull needs a model id")
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
