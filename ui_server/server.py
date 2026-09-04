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


# Fetched by the OS, not the page, and therefore WITHOUT the session cookie:
# iOS asks for apple-touch-icon and the manifest's icons on its own when the
# site is added to the home screen. Behind auth they answered 303 to the login
# HTML, which iOS cannot read as an image — so it fell back to generating a
# letter tile, and the owner got a black square with "S" instead of the mark.
#
# These are fixed branding files and the service worker. They carry nothing
# private. User content stays behind auth: /api/file/* is deliberately absent.
PUBLIC_PATHS = frozenset({
    "/login",
    "/manifest.webmanifest",
    "/sw.js",
    "/icon-192.png",
    "/icon-512.png",
    "/icon-maskable-512.png",
    "/apple-touch-icon.png",
})


@app.middleware("http")
async def require_auth(request: Request, call_next):
    if not _auth_required() or request.url.path in PUBLIC_PATHS:
        return await call_next(request)

    if _token_valid(request.cookies.get(COOKIE_NAME, "")):
        response = await call_next(request)
        # Cloudflare caches by file extension at the edge and will happily
        # serve a cached .png to an unauthenticated stranger who has the URL —
        # verified in the wild as cf-cache-status: HIT on a request carrying
        # no cookie, while the origin itself correctly answered 401. Anything
        # behind the passphrase must therefore forbid shared caching.
        response.headers["Cache-Control"] = "private, no-store, max-age=0"
        return response

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


# Running turns, so a client disconnect can kill the subprocess. Without
# this, pressing Stop only closed the browser's stream while Hermes kept
# working — burning API budget on an answer nobody would see.
_ACTIVE_RUNS: dict[str, asyncio.subprocess.Process] = {}


async def _run_turn(message: str, run_id: str | None = None) -> AsyncIterator[bytes]:
    """Run one Hermes turn, streaming progress then the final reply."""
    started = time.monotonic()
    yield _sse("start", {"at": started})

    proc = await asyncio.create_subprocess_exec(
        str(HERMES_BIN), "-z", message, "--continue", UI_SESSION,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=str(PROJECT_ROOT),
    )
    if run_id:
        _ACTIVE_RUNS[run_id] = proc

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
                cleaned, attachments = _extract_attachments(text)
                await queue.put(
                    _sse("message", {"text": cleaned, "attachments": attachments})
                )
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
        if run_id:
            _ACTIVE_RUNS.pop(run_id, None)
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
    run_id = (body.get("run_id") or "").strip() or None
    if not message:
        raise HTTPException(400, "message is required")
    return StreamingResponse(
        _run_turn(message, run_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/chat/stop")
async def stop_chat(request: Request) -> JSONResponse:
    """Kill a turn the owner asked to stop."""
    run_id = ((await request.json()).get("run_id") or "").strip()
    proc = _ACTIVE_RUNS.pop(run_id, None)
    if proc is None:
        return JSONResponse({"stopped": False})
    if proc.returncode is None:
        proc.kill()
    return JSONResponse({"stopped": True})


# --------------------------------------------------------------------------
# Voice fast path (TALK)
#
# Measured: a spoken turn cost ~10.4s end to end, and 6.2s of that was one
# `hermes -z` invocation — of which only ~1.6s was the model. The rest was
# Hermes starting up from scratch on every single turn.
#
# So TALK talks to OpenAI directly, with SOCIAL's persona and memory injected
# as context. Anything actually needing Hermes — a web search, a stock quote,
# a spreadsheet, or writing something to memory — is escalated back to the
# normal path, so no capability is lost, only the startup cost.
# --------------------------------------------------------------------------

SOUL_FILE = HERMES_HOME / "SOUL.md"
TALK_MODEL = os.environ.get("SOCIAL_TALK_MODEL", "gpt-5.2")
TALK_HISTORY_TURNS = 12

# Rolling context for the spoken conversation. Kept in memory: it is the
# short-term thread, while anything worth keeping goes to Hermes' memory.
_talk_history: list[dict[str, str]] = []

_persona_cache: dict[str, object] = {"key": None, "text": ""}


def _persona() -> str:
    """SOUL.md plus curated memory, rebuilt only when a file changes."""
    files = [SOUL_FILE, *(path for path, _ in MEMORY_STORES.values())]
    key = tuple(f.stat().st_mtime_ns if f.exists() else 0 for f in files)
    if _persona_cache["key"] == key:
        return str(_persona_cache["text"])

    parts = []
    if SOUL_FILE.exists():
        parts.append(SOUL_FILE.read_text(encoding="utf-8").strip())

    for store, (path, label) in MEMORY_STORES.items():
        entries = _read_entries(path)
        if entries:
            parts.append(f"## {label}（記憶）\n" + "\n".join(f"- {e}" for e in entries))

    parts.append(
        "## いま音声で話しています（最重要）\n"
        "- 相手はスマホを持って目の前で待っている。**1〜2文で答える。**\n"
        "- 記号・箇条書き・URLは読み上げに向かない。話し言葉で答える。\n"
        "- 挨拶・雑談・言い換え・記憶の確認は、そのまま即答する。\n"
        "- 検索・株価・スプレッドシート・ファイル、または記憶への保存が必要なときは、"
        "答えを作らず escalate 関数を呼ぶこと。"
    )
    text = "\n\n".join(parts)
    _persona_cache.update({"key": key, "text": text})
    return text


ESCALATE_TOOL = {
    "type": "function",
    "function": {
        "name": "escalate",
        "description": (
            "Web検索・株価・スプレッドシート・ファイル操作・記憶への保存など、"
            "自分だけでは答えられない依頼を、道具を持つ本体に引き継ぐ。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "reason": {"type": "string", "description": "何が必要か（短く）"},
            },
            "required": ["reason"],
        },
    },
}

# Split on Japanese and Latin sentence enders. Speaking can begin as soon as
# the first one lands instead of waiting for the whole answer.
_SENTENCE_END = re.compile(r"(?<=[。．！？!?\n])")


@app.post("/api/talk")
async def talk(request: Request) -> StreamingResponse:
    body = await request.json()
    said = (body.get("message") or "").strip()
    if not said:
        raise HTTPException(400, "message is required")
    run_id = (body.get("run_id") or "").strip() or None
    return StreamingResponse(
        _talk_turn(said, run_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _talk_turn(said: str, run_id: str | None) -> AsyncIterator[bytes]:
    import httpx

    started = time.monotonic()
    yield _sse("start", {})

    messages = [{"role": "system", "content": _persona()},
                *_talk_history[-TALK_HISTORY_TURNS:],
                {"role": "user", "content": said}]

    spoken = ""
    pending = ""
    escalating = False

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream(
                "POST", "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {_openai_key()}"},
                json={"model": TALK_MODEL, "messages": messages,
                      "tools": [ESCALATE_TOOL], "stream": True},
            ) as response:
                if response.status_code != 200:
                    await response.aread()
                    raise RuntimeError(f"chat failed: {response.status_code}")

                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    payload = line[6:].strip()
                    if payload == "[DONE]":
                        break
                    try:
                        delta = json.loads(payload)["choices"][0]["delta"]
                    except Exception:
                        continue

                    if delta.get("tool_calls"):
                        escalating = True
                        break

                    piece = delta.get("content") or ""
                    if not piece:
                        continue
                    spoken += piece
                    pending += piece
                    # Raw fragments as well as sentences: the chat screen
                    # renders these as they land, so text appears the way it
                    # does in ChatGPT instead of after a silent wait.
                    yield _sse("delta", {"text": piece})

                    # Emit complete sentences as they form, so the client can
                    # start speaking the first one while the rest is written.
                    parts = _SENTENCE_END.split(pending)
                    if len(parts) > 1:
                        for sentence in parts[:-1]:
                            if sentence.strip():
                                yield _sse("sentence", {"text": sentence.strip()})
                        pending = parts[-1]

        if escalating:
            # Hand the whole turn to Hermes, which owns the tools and memory.
            yield _sse("escalating", {})
            async for frame in _run_turn(said, run_id):
                if frame.startswith(b"event: message\n"):
                    try:
                        text = json.loads(frame.split(b"data: ", 1)[1].decode())
                        answer = (text.get("text") or "").strip()
                    except Exception:
                        answer = ""
                    if answer:
                        _remember_turn(said, answer)
                        # Escalated turns arrive whole, so replay them in
                        # chunks — the reader still sees text appear rather
                        # than a long pause then a wall of it.
                        for chunk in _SENTENCE_END.split(answer):
                            if chunk:
                                yield _sse("delta", {"text": chunk})
                        for sentence in filter(None,
                                               (s.strip() for s in _SENTENCE_END.split(answer))):
                            yield _sse("sentence", {"text": sentence})
                        yield _sse("message", {"text": answer,
                                               "attachments": text.get("attachments", [])})
                elif frame.startswith(b"event: error\n"):
                    yield frame
            yield _sse("done", {"elapsed": round(time.monotonic() - started, 1),
                                "escalated": True})
            return

        if pending.strip():
            yield _sse("sentence", {"text": pending.strip()})

        answer = spoken.strip()
        if answer:
            _remember_turn(said, answer)
        yield _sse("message", {"text": answer, "attachments": []})

    except Exception as exc:  # noqa: BLE001
        log.exception("talk turn failed")
        yield _sse("error", {"message": _sanitize(str(exc)) or "応答できませんでした。"})

    yield _sse("done", {"elapsed": round(time.monotonic() - started, 1),
                        "escalated": False})


def _remember_turn(said: str, answer: str) -> None:
    _talk_history.extend([{"role": "user", "content": said},
                          {"role": "assistant", "content": answer}])
    del _talk_history[: max(0, len(_talk_history) - TALK_HISTORY_TURNS * 2)]


# --------------------------------------------------------------------------
# Attachments
#
# Files are written under HERMES_HOME so the agent can reach them by path —
# Hermes' vision, transcription and file tools all take local paths. Names are
# regenerated rather than trusted, so an uploaded name cannot escape the
# directory or overwrite anything.
# --------------------------------------------------------------------------

UPLOAD_DIR = HERMES_HOME / "uploads"
MAX_UPLOAD_BYTES = 25 * 1024 * 1024

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".heic"}
AUDIO_EXT = {".mp3", ".m4a", ".wav", ".webm", ".ogg", ".oga", ".flac", ".aac"}


def _kind_for(suffix: str) -> str:
    if suffix in IMAGE_EXT:
        return "image"
    if suffix in AUDIO_EXT:
        return "audio"
    return "file"


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)) -> JSONResponse:
    data = await file.read()
    if not data:
        raise HTTPException(400, "空のファイルです")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "ファイルが大きすぎます（上限25MB）")

    suffix = Path(file.filename or "").suffix.lower()[:12]
    if not re.fullmatch(r"\.[a-z0-9]{1,10}", suffix or ""):
        suffix = ""
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    dest = UPLOAD_DIR / f"{int(time.time())}_{secrets.token_hex(6)}{suffix}"
    dest.write_bytes(data)
    dest.chmod(0o600)

    return JSONResponse({
        "path": str(dest),
        "name": file.filename or dest.name,
        "kind": _kind_for(suffix),
        "size": len(data),
    })


# --------------------------------------------------------------------------
# Image generation
#
# Hermes' built-in image tool routes through fal.ai and needs FAL_KEY — a
# second paid vendor. The owner's OpenAI account already carries gpt-image-*,
# so generate there instead: no new subscription, no new credential.
# --------------------------------------------------------------------------

GENERATED_DIR = HERMES_HOME / "generated"


@app.post("/api/image/generate")
async def generate_image(request: Request) -> JSONResponse:
    import httpx
    body = await request.json()
    prompt = (body.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(400, "prompt is required")

    async with httpx.AsyncClient(timeout=300) as client:
        r = await client.post(
            "https://api.openai.com/v1/images/generations",
            headers={"Authorization": f"Bearer {_openai_key()}"},
            json={
                "model": os.environ.get("SOCIAL_IMAGE_MODEL", "gpt-image-1"),
                "prompt": prompt,
                "size": body.get("size", "1024x1024"),
                "n": 1,
            },
        )
    if r.status_code != 200:
        log.error("image generation failed: %s", r.status_code)
        raise HTTPException(502, "画像を生成できませんでした。")

    item = (r.json().get("data") or [{}])[0]
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    dest = GENERATED_DIR / f"{int(time.time())}_{secrets.token_hex(6)}.png"

    if item.get("b64_json"):
        import base64
        dest.write_bytes(base64.b64decode(item["b64_json"]))
    elif item.get("url"):
        async with httpx.AsyncClient(timeout=120) as client:
            dest.write_bytes((await client.get(item["url"])).content)
    else:
        raise HTTPException(502, "画像データが返りませんでした。")

    return JSONResponse({"url": f"/api/image/{dest.name}", "path": str(dest)})


# Files SOCIAL produced or the owner uploaded. Only these two directories are
# ever served, and only by bare filename, so this cannot become a general file
# reader for the server.
_SERVABLE_DIRS = (GENERATED_DIR, UPLOAD_DIR)
_SAFE_NAME = re.compile(r"[A-Za-z0-9._-]{1,128}")
_MIME = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp",
    ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav",
    ".webm": "audio/webm", ".ogg": "audio/ogg", ".pdf": "application/pdf",
}


def _resolve_servable(name: str) -> Path | None:
    if not _SAFE_NAME.fullmatch(name) or ".." in name:
        return None
    for directory in _SERVABLE_DIRS:
        candidate = directory / name
        try:
            resolved = candidate.resolve(strict=True)
        except OSError:
            continue
        # resolve() defeats symlinks pointing outside the directory.
        if resolved.parent == directory.resolve() and resolved.is_file():
            return resolved
    return None


@app.get("/api/file/{name}")
async def get_file(name: str, download: int = 0) -> FileResponse:
    path = _resolve_servable(name)
    if path is None:
        raise HTTPException(404, "not found")
    headers = (
        {"Content-Disposition": f'attachment; filename="{path.name}"'}
        if download else {}
    )
    return FileResponse(
        path,
        media_type=_MIME.get(path.suffix.lower(), "application/octet-stream"),
        headers=headers,
    )


@app.get("/api/image/{name}")
async def get_image(name: str) -> FileResponse:
    """Kept for links already sitting in the owner's saved chat history."""
    return await get_file(name)


# A reply may name a file SOCIAL produced — either as Hermes' MEDIA: tag or
# as a bare path, which is what the agent does when it calls
# scripts/generate-image.sh. Printing that path to a browser is useless: the
# file lives on the VPS. Turn any such mention into a URL the page can render
# and the owner can download, and strip the raw path from the text.
_MEDIA_TAG = re.compile(r"MEDIA:\s*(\S+)")
_BARE_PATH = re.compile(r"(?:/[\w.\-]+)*/(?:generated|uploads)/([A-Za-z0-9._-]+)")


def _extract_attachments(text: str) -> tuple[str, list[dict]]:
    found: list[dict] = []
    seen: set[str] = set()

    def _add(name: str) -> bool:
        path = _resolve_servable(name)
        if path is None or name in seen:
            return False
        seen.add(name)
        found.append({
            "name": name,
            "url": f"/api/file/{name}",
            "download_url": f"/api/file/{name}?download=1",
            "kind": _kind_for(path.suffix.lower()),
        })
        return True

    for raw in _MEDIA_TAG.findall(text):
        _add(Path(raw).name)
    for name in _BARE_PATH.findall(text):
        _add(name)

    cleaned = _MEDIA_TAG.sub("", text)
    cleaned = _BARE_PATH.sub("", cleaned)
    # Tidy the wording left behind once the path is gone.
    cleaned = re.sub(r"[：:]\s*$", "", cleaned.strip(), flags=re.M)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    if found and not cleaned:
        cleaned = "画像を作成しました。"
    return cleaned, found


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


# Voices the owner can pick from. Labelled by how they actually sound in
# Japanese rather than by OpenAI's internal names, which mean nothing here.
VOICES = [
    {"id": "alloy",   "label": "標準",         "note": "落ち着いた中性的な声"},
    {"id": "echo",    "label": "男性",         "note": "低めで落ち着いた声"},
    {"id": "onyx",    "label": "男性（低め）", "note": "さらに低く重みのある声"},
    {"id": "nova",    "label": "女性",         "note": "明るくはっきりした声"},
    {"id": "shimmer", "label": "女性（柔らか）", "note": "やわらかく穏やかな声"},
    {"id": "fable",   "label": "語り",         "note": "抑揚のある語り口"},
]
_VOICE_IDS = {v["id"] for v in VOICES}
VOICE_SETTINGS_FILE = HERMES_HOME / "voice_settings.json"


def _voice_settings() -> dict:
    try:
        data = json.loads(VOICE_SETTINGS_FILE.read_text(encoding="utf-8"))
    except Exception:
        data = {}
    voice = data.get("voice")
    speed = data.get("speed")
    return {
        "voice": voice if voice in _VOICE_IDS else "alloy",
        # OpenAI accepts 0.25–4.0; clamp to a range that stays intelligible.
        "speed": min(max(float(speed), 0.6), 1.6) if isinstance(speed, (int, float)) else 1.0,
    }


@app.get("/api/voice/settings")
async def get_voice_settings() -> JSONResponse:
    return JSONResponse({"voices": VOICES, **_voice_settings()})


@app.put("/api/voice/settings")
async def put_voice_settings(request: Request) -> JSONResponse:
    body = await request.json()
    current = _voice_settings()
    voice = body.get("voice", current["voice"])
    speed = body.get("speed", current["speed"])
    if voice not in _VOICE_IDS:
        raise HTTPException(400, "unknown voice")
    try:
        speed = min(max(float(speed), 0.6), 1.6)
    except (TypeError, ValueError):
        raise HTTPException(400, "speed must be a number")

    VOICE_SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    VOICE_SETTINGS_FILE.write_text(
        json.dumps({"voice": voice, "speed": speed}), encoding="utf-8"
    )
    return JSONResponse({"voices": VOICES, "voice": voice, "speed": speed})


@app.post("/api/voice/speak")
async def speak(request: Request) -> Response:
    import httpx
    body = await request.json()
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(400, "text is required")
    settings = _voice_settings()
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(
            "https://api.openai.com/v1/audio/speech",
            headers={"Authorization": f"Bearer {_openai_key()}"},
            json={"model": "gpt-4o-mini-tts",
                  "voice": settings["voice"],
                  "speed": settings["speed"],
                  "input": text[:4000], "response_format": "mp3"},
        )
    if r.status_code != 200:
        log.error("tts failed: %s", r.status_code)
        raise HTTPException(502, "音声を生成できませんでした。")
    return Response(content=r.content, media_type="audio/mpeg")


# --------------------------------------------------------------------------
# Status + static SPA
# --------------------------------------------------------------------------

# A configured key is not a working one. The account ran out of credit on
# 2026-08-30 and every feature stopped, while a key-presence check still
# reported "connected" — exactly the wrong thing to show someone wondering
# why nothing answers. So probe a real billed call, and cache it: this runs
# on every CONNECTIONS view and must not add cost or latency of its own.
_OPENAI_HEALTH: dict[str, object] = {"at": 0.0, "ok": False, "detail": ""}
_OPENAI_HEALTH_TTL = 300


async def _openai_health() -> tuple[bool, str]:
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        return False, "未設定"

    if time.time() - float(_OPENAI_HEALTH["at"]) < _OPENAI_HEALTH_TTL:
        return bool(_OPENAI_HEALTH["ok"]), str(_OPENAI_HEALTH["detail"])

    import httpx
    ok, detail = False, "確認できませんでした"
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {key}"},
                # 16, not 1: reasoning models spend tokens thinking before
                # they emit anything, so a cap of 1 returns 400 "output limit
                # reached" on a perfectly healthy account.
                json={"model": os.environ.get("SOCIAL_HEALTH_MODEL", "gpt-5-nano"),
                      "messages": [{"role": "user", "content": "."}],
                      "max_completion_tokens": 16},
            )
        body = r.json() if r.content else {}
        error = body.get("error") or {}
        message = str(error.get("message") or "")

        if r.status_code == 200:
            ok, detail = True, "GPT / 音声 / 画像"
        elif "max_tokens" in message or "output limit" in message:
            # The request was authorised and billed — it only ran out of room
            # to answer. That is proof of health, not a failure.
            ok, detail = True, "GPT / 音声 / 画像"
        else:
            code = error.get("code", "")
            detail = {
                "credit_balance_exhausted":
                    "⚠ 残高切れです。チャージが必要です",
                "insufficient_quota":
                    "⚠ 利用枠を使い切っています",
                "invalid_api_key": "⚠ APIキーが無効です",
                "rate_limit_exceeded": "一時的に混雑しています",
            }.get(code, f"⚠ 利用できません（{code or r.status_code}）")
            _ = message  # kept for the branch above
    except Exception:
        detail = "接続を確認できませんでした"

    _OPENAI_HEALTH.update({"at": time.time(), "ok": ok, "detail": detail})
    return ok, detail


@app.get("/api/connections")
async def connections() -> JSONResponse:
    """What SOCIAL is wired up to, for the CONNECTIONS screen.

    Reports only whether each integration is configured — never a key, an id,
    or a token. Designed to grow as integrations are added.
    """
    token_file = HERMES_HOME / "google_token.json"
    google_ok = token_file.exists()
    google_detail = ""
    if google_ok:
        try:
            scopes = json.loads(token_file.read_text()).get("scopes") or []
            google_detail = (
                "スプレッドシートの閲覧のみ"
                if any(s.endswith("spreadsheets.readonly") for s in scopes)
                else f"{len(scopes)}件の権限"
            )
        except Exception:
            google_detail = "設定済み"

    openai_ok, openai_detail = await _openai_health()

    items = [
        {"id": "openai", "name": "OpenAI", "label": "会話・音声・画像生成",
         "connected": openai_ok, "detail": openai_detail},
        {"id": "line", "name": "LINE", "label": "スマートフォンからの会話",
         "connected": bool(os.environ.get("LINE_CHANNEL_ACCESS_TOKEN")
                           and os.environ.get("LINE_OWNER_USER_ID")),
         "detail": "オーナー専用（他の人は利用できません）"},
        {"id": "google_sheets", "name": "Google スプレッドシート",
         "label": "表の読み取り・要約",
         "connected": google_ok, "detail": google_detail or "未接続"},
        {"id": "web", "name": "Web検索", "label": "最新情報の取得",
         "connected": True, "detail": "追加の契約なしで利用中"},
        {"id": "market", "name": "株価・市場データ", "label": "指数・銘柄の取得",
         "connected": True, "detail": "Yahoo Finance（読み取りのみ）"},
        {"id": "brief", "name": "デイリーブリーフ", "label": "平日朝8:00の自動配信",
         "connected": bool(os.environ.get("LINE_OWNER_USER_ID")),
         "detail": "LINEと専用画面に配信"},
    ]
    return JSONResponse({"items": items})


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
