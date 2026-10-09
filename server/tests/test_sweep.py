"""Every route, called without credentials: nothing but the public handful may answer 2xx."""
from fastapi.routing import APIRoute

PUBLIC = {("GET", "/health"), ("GET", "/api/setup"), ("GET", "/api/info"), ("GET", "/api/auth/me"), ("POST", "/api/auth/logout")}


def test_unauthenticated_sweep(admin):
    from huddle_server.app import app
    anon = type(admin)(admin.app)          # fresh cookie jar
    leaks = []
    for r in app.routes:
        if not isinstance(r, APIRoute):
            continue
        path = r.path.replace("{meeting_id}", "x").replace("{rid}", "x").replace("{client_id}", "1").replace("{token_id}", "1")
        path = path.replace("{user_id}", "1").replace("{invite_id}", "1").replace("{project_id}", "x").replace("{segment_id}", "1")
        path = path.replace("{item_id}", "1").replace("{speaker_id}", "1").replace("{source_id}", "1").replace("{target_id}", "1")
        path = path.replace("{stage}", "summarizing").replace("{token}", "x").replace("{path:path}", "index.html")
        for method in r.methods:
            if method in ("HEAD", "OPTIONS") or (method, path) in PUBLIC or path.startswith("/{") or path == "/index.html":
                continue
            resp = anon.request(method, path, headers={"X-Requested-With": "huddle"})
            if resp.status_code < 400:
                leaks.append((method, path, resp.status_code))
    assert not leaks, leaks
    # the engine's whole API sits behind the admin session too
    assert anon.get("/engine/settings").status_code == 401 and anon.get("/engine/meetings").status_code == 401
