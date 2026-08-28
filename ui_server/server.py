"""SOCIAL UI adapter — a thin bridge between the simple client UI and Hermes.

Why this exists (see docs/CUSTOM_UI.md):
  Hermes' dashboard drives chat through a PTY plus a TUI-coupled JSON-RPC
  sidecar; there is no stable HTTP chat API to build a client against. Its
  navigation is a hard-coded array (``BUILTIN_NAV_REST`` in ``web/src/App.tsx``),
  so its 19 developer pages cannot be hidden by configuration.

  This module therefore does the minimum to bridge that gap. It holds no
  business logic and no AI behaviour — every turn goes through the supported
  ``hermes`` CLI against the same HERMES_HOME as LINE, so memory, sessions and
  personality are identical across channels.

Binds to loopback only.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import time
from pathlib import Path
from typing import AsyncIterator

import hmac
import secrets
from hashlib import sha256

from fastapi import FastAPI, Form, HTTPException, Request, UploadFile, File
from fastapi.responses import (
    FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response,
    StreamingResponse,
)
from fastapi.staticfiles import StaticFiles

log = logging.getLogger("social-ui")

PROJECT_ROOT = Path(__file__).resolve().parents[1]
HERMES_HOME = PROJECT_ROOT / ".hermes"
HERMES_BIN = PROJECT_ROOT / "scripts" / "social-hermes"
BRIEF_DIR = HERMES_HOME / "briefs"
# Hermes' cron writes "local" deliveries here as <job_id>/<timestamp>.md with a
# metadata header. A scheduled brief must show up in the UI too, so both
# sources are read and the newest wins.
CRON_OUTPUT_DIR = HERMES_HOME / "cron" / "output"
UI_DIST = PROJECT_ROOT / "ui" / "dist"

# One named session backs the whole browser UI, so the conversation is
# continuous across page reloads — and shares memory with LINE.
UI_SESSION = "social-ui"

# A tool-using turn (web search across six topics) can legitimately run for
# many minutes. Keep this generous; the UI streams progress meanwhile.
TURN_TIMEOUT_S = int(os.environ.get("SOCIAL_UI_TURN_TIMEOUT", "1800"))

app = FastAPI(title="SOCIAL UI", docs_url=None, redoc_url=None, openapi_url=None)


# --------------------------------------------------------------------------
# Authentication
#
# One owner, one passphrase. A signed cookie keeps a device logged in for
# SOCIAL_UI_SESSION_DAYS (default 30) so the owner is not asked every visit —
# which also matters for the installed home-screen app, where a login screen
# on every launch would defeat the point.
#
# Auth is skipped entirely when SOCIAL_UI_PASSWORD is unset AND the bind is
# loopback, so local development needs no setup. Binding to anything other
# than loopback without a password is refused by scripts/start-ui.sh.
# --------------------------------------------------------------------------

COOKIE_NAME = "social_session"
SESSION_DAYS = int(os.environ.get("SOCIAL_UI_SESSION_DAYS", "30"))


def _password() -> str:
    return os.environ.get("SOCIAL_UI_PASSWORD", "").strip()


def _signing_key() -> bytes:
    """Derive the cookie key from the passphrase, salted per install.

    Changing the passphrase invalidates every existing session, which is the
    behaviour you want when a password is rotated.
    """
    salt_file = HERMES_HOME / "ui_session_salt"
    if not salt_file.exists():
        salt_file.parent.mkdir(parents=True, exist_ok=True)
        salt_file.write_text(secrets.token_hex(32), encoding="utf-8")
        salt_file.chmod(0o600)
    return sha256((salt_file.read_text().strip() + _password()).encode()).digest()


def _issue_token() -> str:
    expiry = int(time.time()) + SESSION_DAYS * 86400
    sig = hmac.new(_signing_key(), str(expiry).encode(), sha256).hexdigest()
    return f"{expiry}.{sig}"


def _token_valid(token: str) -> bool:
    try:
        raw_expiry, _, sig = token.partition(".")
        if not sig or int(raw_expiry) < time.time():
            return False
        expected = hmac.new(_signing_key(), raw_expiry.encode(), sha256).hexdigest()
        return hmac.compare_digest(sig, expected)
    except Exception:
        return False


def _auth_required() -> bool:
    return bool(_password())


@app.middleware("http")
async def require_auth(request: Request, call_next):
    if not _auth_required() or request.url.path in {"/login", "/manifest.webmanifest"}:
        return await call_next(request)

    if _token_valid(request.cookies.get(COOKIE_NAME, "")):
        return await call_next(request)

    if request.url.path.startswith("/api/"):
        return JSONResponse({"detail": "authentication required"}, status_code=401)
    return RedirectResponse("/login", status_code=303)


@app.middleware("http")
async def force_https(request: Request, call_next):
    """Redirect plain HTTP to HTTPS when served behind the tunnel.

    Cloudflare forwards the original scheme in X-Forwarded-Proto. Without
    this, typing the bare hostname reaches the login page over HTTP: the
    passphrase would be sent in clear text, and the session cookie — which
    carries Secure — could not be stored, so login would appear to fail for
    no visible reason.

    Only active when SOCIAL_UI_HTTPS is set, so loopback development over
    plain HTTP is unaffected.

    Registered AFTER require_auth on purpose: Starlette runs the most
    recently added middleware outermost, so this must come second to see the
    request before the auth redirect does. Registered first, the auth
    redirect fired one extra plaintext hop before the upgrade.
    """
    if os.environ.get("SOCIAL_UI_HTTPS", "").lower() in {"1", "true", "yes"}:
        if request.headers.get("x-forwarded-proto", "").lower() == "http":
            return RedirectResponse(
                str(request.url.replace(scheme="https")), status_code=301
            )
    return await call_next(request)


LOGIN_PAGE = """<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SOCIAL</title><link rel="manifest" href="/manifest.webmanifest">
<style>
*{box-sizing:border-box;margin:0}
body{min-height:100vh;display:grid;place-items:center;background:#f8fafc;
 font-family:"Hiragino Kaku Gothic ProN","Noto Sans JP",Meiryo,system-ui,sans-serif;
 color:#0f172a;padding:24px}
.box{width:100%;max-width:380px;text-align:center}
h1{font-size:28px;letter-spacing:.08em;margin-bottom:8px}
p{color:#64748b;margin-bottom:28px;line-height:1.8}
input{width:100%;padding:14px 16px;font-size:16px;border:1px solid #cbd5e1;
 border-radius:12px;margin-bottom:12px}
input:focus{outline:none;border-color:#0ea5e9;box-shadow:0 0 0 4px #e0f2fe}
button{width:100%;padding:14px;font-size:16px;font-weight:600;color:#fff;
 background:#0284c7;border:0;border-radius:12px;cursor:pointer}
button:hover{background:#0369a1}
.err{color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;
 border-radius:12px;padding:12px;margin-bottom:16px}
.note{margin-top:20px;font-size:13px;color:#94a3b8}
</style></head><body><div class="box">
<h1>SOCIAL</h1><p>合言葉を入力してください。</p>
__ERROR__
<form method="post" action="/login">
<input type="password" name="password" placeholder="合言葉" autofocus
       autocomplete="current-password" required>
<button type="submit">ログイン</button></form>
<p class="note">この端末では__DAYS__日間ログイン状態が保持されます。</p>
</div></body></html>"""


@app.get("/login")
async def login_page(request: Request) -> Response:
    if not _auth_required() or _token_valid(request.cookies.get(COOKIE_NAME, "")):
        return RedirectResponse("/", status_code=303)
    return HTMLResponse(
        LOGIN_PAGE.replace("__ERROR__", "").replace("__DAYS__", str(SESSION_DAYS))
    )


@app.post("/login")
async def login_submit(password: str = Form(...)) -> Response:
    # Constant-time compare so the endpoint does not leak the passphrase
    # length or prefix through timing.
    if not hmac.compare_digest(password, _password()):
        await asyncio.sleep(1)  # blunt the brute-force rate
        return HTMLResponse(
            LOGIN_PAGE.replace(
                "__ERROR__", '<div class="err">合言葉が違います。</div>'
            ).replace("__DAYS__", str(SESSION_DAYS)),
            status_code=401,
        )

    response = RedirectResponse("/", status_code=303)
    response.set_cookie(
        COOKIE_NAME, _issue_token(),
        max_age=SESSION_DAYS * 86400,
        httponly=True,
        samesite="lax",
        # Secure is set behind the HTTPS tunnel; on plain-HTTP loopback it
        # would stop the cookie being stored at all.
        secure=os.environ.get("SOCIAL_UI_HTTPS", "").lower() in {"1", "true", "yes"},
        path="/",
    )
    return response


@app.post("/api/logout")
async def logout() -> Response:
    response = JSONResponse({"ok": True})
    response.delete_cookie(COOKIE_NAME, path="/")
    return response


# --------------------------------------------------------------------------
# Chat
# --------------------------------------------------------------------------

def _sse(event: str, data: dict) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode()


async def _run_turn(message: str) -> AsyncIterator[bytes]:
    """Run one Hermes turn, streaming progress then the final reply."""
    started = time.monotonic()
    yield _sse("start", {"at": started})

    proc = await asyncio.create_subprocess_exec(
        str(HERMES_BIN), "-z", message, "--continue", UI_SESSION,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=str(PROJECT_ROOT),
    )

    # Tool-using turns are slow. A heartbeat keeps the UI showing
    # "考えています…" instead of looking hung.
    queue: asyncio.Queue[bytes | None] = asyncio.Queue()
    hb_task = asyncio.create_task(_pump_heartbeat(queue, started))

    async def wait_proc() -> None:
        try:
            out, err = await asyncio.wait_for(proc.communicate(), TURN_TIMEOUT_S)
            text = (out or b"").decode("utf-8", "replace").strip()
            if proc.returncode != 0 and not text:
                detail = (err or b"").decode("utf-8", "replace").strip()
                await queue.put(_sse("error", {
                    "message": _sanitize(detail) or "応答を取得できませんでした。",
                }))
            else:
                await queue.put(_sse("message", {"text": text}))
        except asyncio.TimeoutError:
            proc.kill()
            await queue.put(_sse("error", {"message": "時間内に応答できませんでした。"}))
        except Exception as exc:  # pragma: no cover - defensive
            log.exception("turn failed")
            await queue.put(_sse("error", {"message": _sanitize(str(exc))}))
        finally:
            await queue.put(None)

    proc_task = asyncio.create_task(wait_proc())
    try:
        while True:
            item = await queue.get()
            if item is None:
                break
            yield item
    finally:
        hb_task.cancel()
        proc_task.cancel()
        if proc.returncode is None:
            proc.kill()
    yield _sse("done", {"elapsed": round(time.monotonic() - started, 1)})


async def _pump_heartbeat(queue: asyncio.Queue, started: float) -> None:
    while True:
        await asyncio.sleep(5)
        await queue.put(_sse("progress", {"elapsed": round(time.monotonic() - started)}))


_SECRET_RE = re.compile(r"(sk-[A-Za-z0-9_\-]{8,}|Bearer\s+\S+|[A-Za-z0-9_\-]{32,})")


def _sanitize(text: str) -> str:
    """Never let a credential reach the browser via an error message."""
    return _SECRET_RE.sub("<redacted>", text or "")[:500]


@app.post("/api/chat")
async def chat(request: Request) -> StreamingResponse:
    body = await request.json()
    message = (body.get("message") or "").strip()
    if not message:
        raise HTTPException(400, "message is required")
    return StreamingResponse(
        _run_turn(message),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# --------------------------------------------------------------------------
# Memory
# --------------------------------------------------------------------------

# Hermes' built-in memory is two files, each a §-delimited list of entries
# (``ENTRY_DELIMITER = "\n§\n"`` in tools/memory_tool.py):
#   MEMORY.md — the agent's own notes (project facts, conventions)
#   USER.md   — what SOCIAL knows about the owner (preferences, habits)
# Both must be shown, or the owner sees an incomplete picture of what is
# remembered. Splitting on newlines would also break multiline entries.
ENTRY_DELIMITER = "\n§\n"
MEMORY_STORES = {
    "memory": (HERMES_HOME / "memories" / "MEMORY.md", "メモ"),
    "user": (HERMES_HOME / "memories" / "USER.md", "あなたのこと"),
}


def _read_entries(path: Path) -> list[str]:
    if not path.exists():
        return []
    raw = path.read_text(encoding="utf-8").strip()
    if not raw:
        return []
    return [e.strip() for e in raw.split(ENTRY_DELIMITER) if e.strip()]


def _write_entries(path: Path, entries: list[str]) -> None:
    path.write_text(
        (ENTRY_DELIMITER.join(entries) + "\n") if entries else "",
        encoding="utf-8",
    )


@app.get("/api/memory")
async def get_memory() -> JSONResponse:
    items = []
    for store, (path, label) in MEMORY_STORES.items():
        for idx, text in enumerate(_read_entries(path)):
            items.append({"id": f"{store}:{idx}", "store": store,
                          "label": label, "text": text})
    return JSONResponse({"items": items})


@app.delete("/api/memory/{item_id}")
async def delete_memory(item_id: str) -> JSONResponse:
    store, _, raw_idx = item_id.partition(":")
    if store not in MEMORY_STORES or not raw_idx.isdigit():
        raise HTTPException(400, "invalid id")

    path, _ = MEMORY_STORES[store]
    entries = _read_entries(path)
    idx = int(raw_idx)
    if idx >= len(entries):
        raise HTTPException(404, "no such entry")

    del entries[idx]
    _write_entries(path, entries)
    return JSONResponse({"ok": True})


# --------------------------------------------------------------------------
# Daily Brief
# --------------------------------------------------------------------------

def _extract_cron_response(raw: str) -> str:
    """Return just the agent's answer from a Hermes cron output document.

    Agent-mode jobs are written by cron/scheduler.py as:

        # Cron Job: <name>
        **Job ID:** ... **Run Time:** ... **Schedule:** ...
        ## Prompt
        <the entire prompt, including any skill files loaded with --skill>
        ## Response
        <the answer>

    The prompt section is large — attaching finance/stocks alone injects its
    whole SKILL.md — so anything short of splitting on "## Response" leaks
    documentation and the raw instructions into the reader's view.

    Script-mode (--no-agent) jobs use a "---" separator and no Response
    heading, so that shape is handled as a fallback.
    """
    prompt_at = raw.find("\n## Prompt\n")
    search_from = prompt_at + 1 if prompt_at != -1 else 0

    response_at = raw.find("\n## Response\n", search_from)
    if response_at != -1:
        return raw[response_at + len("\n## Response\n"):].strip()

    # Script mode: strip the metadata block above the first horizontal rule.
    _, sep, body = raw.partition("\n---\n")
    return (body if sep else raw).strip()


def _cron_output_date(stem: str) -> str:
    """Derive a display date from a cron output filename.

    Hermes names these "2026-08-25_08-04-03"; an older layout used
    "20260825_080403". Handle both rather than falling back to the raw stem,
    which surfaced as "最終更新: 2026-08-25_08-04-03" in the UI.
    """
    head = stem.split("_")[0]
    if len(head) == 10 and head[4] == "-" and head[7] == "-":
        return head                                   # already ISO
    if len(head) == 8 and head.isdigit():
        return f"{head[:4]}-{head[4:6]}-{head[6:8]}"
    return head or stem


@app.get("/api/brief")
async def get_brief() -> JSONResponse:
    """Newest brief from either source: a manual run, or the cron schedule."""
    candidates: list[tuple[float, str, str]] = []

    for f in BRIEF_DIR.glob("*.txt"):
        candidates.append((f.stat().st_mtime, f.read_text(encoding="utf-8"), f.stem))

    for f in CRON_OUTPUT_DIR.glob("*/*.md"):
        body = _extract_cron_response(f.read_text(encoding="utf-8"))
        if not body:
            continue          # silent run, or a job that produced nothing
        candidates.append((f.stat().st_mtime, body, _cron_output_date(f.stem)))

    if not candidates:
        return JSONResponse({"text": None, "date": None})

    _, text, date = max(candidates, key=lambda c: c[0])
    return JSONResponse({"text": text, "date": date})


@app.post("/api/brief/run")
async def run_brief() -> StreamingResponse:
    prompt_file = PROJECT_ROOT / "config" / "daily-brief-prompt.txt"
    if not prompt_file.exists():
        raise HTTPException(500, "daily-brief-prompt.txt missing")
    prompt = prompt_file.read_text(encoding="utf-8")

    async def run_and_save() -> AsyncIterator[bytes]:
        # Tee the stream: forward every frame to the browser, and persist the
        # finished brief so it is still there after a reload.
        async for frame in _run_turn(prompt):
            yield frame
            if frame.startswith(b"event: message\n"):
                try:
                    payload = json.loads(frame.split(b"data: ", 1)[1].decode())
                    text = (payload.get("text") or "").strip()
                    if text:
                        BRIEF_DIR.mkdir(parents=True, exist_ok=True)
                        dest = BRIEF_DIR / f"{time.strftime('%Y-%m-%d')}.txt"
                        dest.write_text(text, encoding="utf-8")
                except Exception:  # never let saving break the stream
                    log.exception("could not save brief")

    return StreamingResponse(
        run_and_save(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# --------------------------------------------------------------------------
# Voice
# --------------------------------------------------------------------------

def _openai_key() -> str:
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        raise HTTPException(503, "voice is not configured")
    return key


@app.post("/api/voice/transcribe")
async def transcribe(file: UploadFile = File(...)) -> JSONResponse:
    import httpx
    audio = await file.read()
    if not audio:
        raise HTTPException(400, "empty audio")
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(
            "https://api.openai.com/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {_openai_key()}"},
            files={"file": (file.filename or "audio.webm", audio,
                            file.content_type or "audio/webm")},
            data={"model": "gpt-4o-transcribe", "language": "ja"},
        )
    if r.status_code != 200:
        log.error("transcribe failed: %s", r.status_code)
        raise HTTPException(502, "音声を認識できませんでした。")
    return JSONResponse({"text": r.json().get("text", "")})


@app.post("/api/voice/speak")
async def speak(request: Request) -> Response:
    import httpx
    text = ((await request.json()).get("text") or "").strip()
    if not text:
        raise HTTPException(400, "text is required")
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(
            "https://api.openai.com/v1/audio/speech",
            headers={"Authorization": f"Bearer {_openai_key()}"},
            json={"model": "gpt-4o-mini-tts", "voice": "alloy",
                  "input": text[:4000], "response_format": "mp3"},
        )
    if r.status_code != 200:
        log.error("tts failed: %s", r.status_code)
        raise HTTPException(502, "音声を生成できませんでした。")
    return Response(content=r.content, media_type="audio/mpeg")


# --------------------------------------------------------------------------
# Status + static SPA
# --------------------------------------------------------------------------

@app.get("/api/status")
async def status() -> JSONResponse:
    gw = shutil.which("systemctl") is not None and os.system(
        "systemctl --user is-active --quiet hermes-gateway"
    ) == 0
    return JSONResponse({
        "ok": True,
        "voice": bool(os.environ.get("OPENAI_API_KEY")),
        "gateway": gw,
        "line": bool(os.environ.get("LINE_CHANNEL_ACCESS_TOKEN")),
    })


if UI_DIST.exists():
    app.mount("/assets", StaticFiles(directory=UI_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def spa(full_path: str) -> FileResponse:
        candidate = UI_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(UI_DIST / "index.html")
