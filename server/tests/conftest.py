import os
import tempfile
from pathlib import Path

import pytest

_TMP = Path(tempfile.mkdtemp(prefix="huddle-server-test-"))
os.environ["HUDDLE_DATA_DIR"] = str(_TMP / "data")
os.environ["HUDDLE_TLS_DIR"] = str(_TMP / "certs")
os.environ["HUDDLE_INSECURE_COOKIES"] = "1"
os.environ["HUDDLE_SERVER_NAME"] = "Test Server"
os.environ["HUDDLE_NO_JOBS"] = ""   # jobs run (with fake stages)

from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture(scope="session")
def fake_stages():
    """Stand-ins for the ML stages: a two-line transcript with two speakers, notes from a 'server' model."""
    import json
    import time as _t

    from huddle_engine.jobs import stages as st

    def transcribing(ctx):
        with ctx.db.tx() as c:
            c.execute("DELETE FROM transcript_segments WHERE meeting_id = ?", (ctx.meeting_id,))
            c.execute("DELETE FROM meeting_speakers WHERE meeting_id = ?", (ctx.meeting_id,))
            a = c.execute("INSERT INTO meeting_speakers(meeting_id,label,embedding,embedding_model,color_index) VALUES (?,?,?,?,0)",
                          (ctx.meeting_id, "Speaker 1", json.dumps([1.0, 0.0]), "titanet-large")).lastrowid
            b = c.execute("INSERT INTO meeting_speakers(meeting_id,label,embedding,embedding_model,color_index) VALUES (?,?,?,?,1)",
                          (ctx.meeting_id, "Speaker 2", json.dumps([0.0, 1.0]), "titanet-large")).lastrowid
            c.execute("INSERT INTO transcript_segments(meeting_id,meeting_speaker_id,idx,start,\"end\",text,language) VALUES (?,?,0,0.0,1.0,'Hallo.','nl')", (ctx.meeting_id, a))
            c.execute("INSERT INTO transcript_segments(meeting_id,meeting_speaker_id,idx,start,\"end\",text,language) VALUES (?,?,1,1.0,2.0,'Dag.','nl')", (ctx.meeting_id, b))
            c.execute("UPDATE meetings SET language = 'nl' WHERE id = ?", (ctx.meeting_id,))
        return "2 segments"

    def summarizing(ctx):
        with ctx.db.tx() as c:
            c.execute("INSERT INTO summaries(meeting_id, summary, provider, model, created_at) VALUES (?,?,?,?,?)"
                      " ON CONFLICT(meeting_id) DO UPDATE SET summary=excluded.summary", (ctx.meeting_id, "Samenvatting.", "ollama", "qwen", _t.time()))
        return "ok"

    orig = dict(st.STAGE_FUNCS)
    st.STAGE_FUNCS.update({"transcribing": transcribing, "diarizing": lambda ctx: "kept", "summarizing": summarizing,
                           "identifying_speakers": lambda ctx: "none", "indexing": lambda ctx: "ok"})
    yield
    st.STAGE_FUNCS.update(orig)


@pytest.fixture(scope="session")
def client(fake_stages):
    from huddle_server.app import app
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def admin(client):
    """A logged-in dashboard session (cookie kept by the TestClient)."""
    r = client.post("/api/setup", json={"email": "dylan@example.com", "password": "correct horse battery"})
    assert r.status_code == 200, r.text
    return client
