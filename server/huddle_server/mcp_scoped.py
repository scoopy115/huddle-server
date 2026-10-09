"""MCP on the server, scoped per token. The same tools the desktop's MCP offers, but every
answer is limited to the recordings the token's client may see (its own uploads, or everything
when an admin gave the client scope `all`). Mounted at /mcp; bearer token `hmt_…`.

The scope travels in a context variable set by the auth middleware; the MCP transport runs
tool calls in tasks spawned inside that request, which inherit it."""
from __future__ import annotations

import contextvars
import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from huddle_engine.services import action_items as ai_svc
from huddle_engine.services import meetings as ms
from huddle_engine.services import search as search_svc
from huddle_engine.services import transcripts

try:  # mcp >= 2
    from mcp.server.mcpserver import MCPServer as FastMCP
except ImportError:  # pragma: no cover
    from mcp.server.fastmcp import FastMCP


@dataclass
class Scope:
    client_id: int
    client_name: str
    visible: set[str] | None     # None = everything


current_scope: contextvars.ContextVar[Scope | None] = contextvars.ContextVar("huddle_mcp_scope", default=None)


class Denied(Exception):
    pass


def _scope() -> Scope:
    s = current_scope.get()
    if s is None:
        raise Denied("No scope")
    return s


def _check(meeting_id: str) -> None:
    s = _scope()
    if s.visible is not None and meeting_id not in s.visible:
        raise Denied("This recording is outside the token's scope")


def _fmt(sec: float | None) -> str:
    if sec is None:
        return ""
    m, s = divmod(int(sec), 60)
    h, m = divmod(m, 60)
    return f"{h:d}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def _date(ts: float | None) -> str | None:
    return datetime.fromtimestamp(ts).astimezone().isoformat(timespec="minutes") if ts else None


def build(engine_db) -> FastMCP:
    db = engine_db
    mcp = FastMCP("Huddle Server", instructions=(
        "Meeting memory on a self-hosted Huddle Server, limited to the recordings this token may see. "
        "Use search_transcripts / search_meetings to find relevant moments, then get_transcript_context for the "
        "surrounding lines. Every hit carries meetingId, segmentId and timestamps so answers can cite evidence. "
        "Avoid fetching whole transcripts unless the user asks for one."))

    def _brief(m) -> dict[str, Any]:
        return {"meetingId": m.id, "title": m.title, "date": _date(m.started_at), "durationMin": round((m.duration_sec or 0) / 60, 1),
                "status": m.status, "language": m.language, "participants": m.participants,
                "openActionItems": m.open_action_count, "summaryPreview": m.summary_preview}

    @mcp.tool()
    def list_meetings(query: str | None = None, limit: int = 50) -> list[dict]:
        """Recordings this token may see, newest first; optional title filter."""
        s = _scope()
        out = [m for m in ms.list_meetings(db, limit=max(limit, 1) * 4 if s.visible is not None else limit, query=query)
               if s.visible is None or m.id in s.visible]
        return [_brief(m) for m in out[:limit]]

    @mcp.tool()
    def get_meeting(meeting_id: str) -> dict:
        """Header, participants, summary, topics or interview questions, decisions and action items (no transcript)."""
        _check(meeting_id)
        d = ms.get_detail(db, meeting_id)
        if not d:
            return {"error": "meeting not found"}
        return {**_brief(d.meeting),
                "speakers": [{"id": s.id, "name": s.display_name or s.speaker_name or s.label, "talkTimeSec": round(s.talk_time_sec)} for s in d.speakers],
                "summary": d.summary.summary if d.summary else None, "mode": d.meeting.mode,
                "topics": [{"title": t.title, "summary": t.summary} for t in d.topics],
                "questions": [{"question": q.question, "answer": q.answer, "askedBy": q.asked_by, "answeredBy": q.answered_by,
                               "timestamp": _fmt(q.evidence_start), "segmentId": q.segment_id} for q in d.questions],
                "decisions": [{"text": x.text, "timestamp": _fmt(x.evidence_start), "segmentId": x.segment_id} for x in d.decisions],
                "actionItems": [{"id": a.id, "text": a.text, "owner": a.owner, "dueDate": a.due_date, "done": a.done,
                                 "timestamp": _fmt(a.evidence_start), "segmentId": a.segment_id} for a in d.action_items]}

    @mcp.tool()
    def get_summary(meeting_id: str) -> dict:
        """Narrative summary of one meeting."""
        _check(meeting_id)
        s = ms.get_summary(db, meeting_id)
        return {"meetingId": meeting_id, "summary": s.summary if s else None}

    @mcp.tool()
    def get_transcript(meeting_id: str, start_sec: float | None = None, end_sec: float | None = None, max_segments: int = 400) -> list[dict]:
        """Speaker-labelled transcript. Prefer a time window (start_sec/end_sec) over the whole thing."""
        _check(meeting_id)
        segs = transcripts.segments(db, meeting_id)
        if start_sec is not None:
            segs = [s for s in segs if s.end >= start_sec]
        if end_sec is not None:
            segs = [s for s in segs if s.start <= end_sec]
        return [{"segmentId": s.id, "timestamp": _fmt(s.start), "start": s.start, "end": s.end, "speaker": s.speaker_name, "text": s.text}
                for s in segs[:max_segments]]

    @mcp.tool()
    def get_transcript_context(segment_id: int, before: int = 4, after: int = 4) -> list[dict]:
        """Transcript lines around a segment (use after search_transcripts)."""
        rows = transcripts.segment_window(db, segment_id, before=before, after=after)
        if rows:
            _check(rows[0].meeting_id)
        return [{"segmentId": s.id, "meetingId": s.meeting_id, "timestamp": _fmt(s.start), "start": s.start, "end": s.end,
                 "speaker": s.speaker_name, "text": s.text} for s in rows]

    @mcp.tool()
    def search_transcripts(query: str, limit: int = 20, meeting_id: str | None = None) -> list[dict]:
        """Full-text search across the transcripts this token may see (or one meeting). Cite-able hits."""
        s = _scope()
        if meeting_id:
            _check(meeting_id)
        hits = search_svc.search(db, query, limit=limit if s.visible is None else limit * 4, meeting_id=meeting_id)
        hits = [h for h in hits if s.visible is None or h.meeting_id in s.visible][:limit]
        return [{"meetingId": h.meeting_id, "meetingTitle": h.meeting_title, "date": _date(h.meeting_started_at), "speaker": h.speaker_name,
                 "timestamp": _fmt(h.start), "start": h.start, "end": h.end, "segmentId": h.segment_id, "text": h.text, "snippet": h.snippet}
                for h in hits]

    @mcp.tool()
    def search_meetings(query: str, limit: int = 10) -> list[dict]:
        """Meetings ranked by how much they discuss the query."""
        s = _scope()
        out = [c for c in search_svc.search_meetings(db, query, limit=limit if s.visible is None else limit * 4)
               if s.visible is None or c.get("meetingId") in s.visible][:limit]
        for c in out:
            c["date"] = _date(c.pop("startedAt", None))
        return out

    @mcp.tool()
    def get_open_action_items(owner: str | None = None, limit: int = 100) -> list[dict]:
        """Open action items across the recordings this token may see, optionally for one owner."""
        s = _scope()
        items = [a for a in ai_svc.list_all(db, open_only=True, owner=owner, limit=limit if s.visible is None else limit * 4)
                 if s.visible is None or a.meeting_id in s.visible][:limit]
        return [{"id": a.id, "text": a.text, "owner": a.owner, "dueDate": a.due_date, "meetingId": a.meeting_id,
                 "meetingTitle": a.meeting_title, "meetingDate": _date(a.meeting_started_at), "timestamp": _fmt(a.evidence_start),
                 "segmentId": a.segment_id} for a in items]

    return mcp


def tool_error(e: Exception) -> str:
    return json.dumps({"error": str(e)})
