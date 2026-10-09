"""Access to the embedded Huddle engine: its FastAPI app (mounted under /engine for the
dashboard), its context (database, jobs, downloads) and the capabilities it reports."""
from __future__ import annotations

from typing import Any

from huddle_engine import __version__ as engine_version
from huddle_engine.app import app as engine_app
from huddle_engine.app import ctx as engine_ctx
from huddle_engine.app import lifespan as engine_lifespan
from huddle_engine.resolver import ResolverContext, resolve_all


def resolver() -> ResolverContext:
    c = engine_ctx()
    return ResolverContext(registry=c.registry, settings=c.settings(), memory_bytes=c.hardware.get("memoryBytes"))


def capabilities() -> dict[str, Any]:
    """What this server can do right now, for /v1/ping and the overview."""
    res = {r.task: r for r in resolve_all(resolver())}
    tr, di, llm = res.get("transcription"), res.get("diarization"), res.get("llm")
    return {
        "transcription": tr.model.name if tr and tr.status == "ready" and tr.model else None,
        "diarization": bool(di and di.status in ("ready", "builtin")),
        "llm": llm.model.name if llm and llm.status == "ready" and llm.model else None,
    }


__all__ = ["capabilities", "engine_app", "engine_ctx", "engine_lifespan", "engine_version", "resolver"]
