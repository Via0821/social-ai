#!/usr/bin/env python3
"""Normalize SOCIAL's free-form .env into strict KEY=VALUE form.

Never prints a secret value. Classifies each token by *shape* only and
asserts each guess against a strict pattern before accepting it.

Security policy (see docs/SECURITY.md):
  - The Gmail password is deliberately NOT carried into the working .env.
    Google access must use OAuth2 (project spec section 15).
"""
from __future__ import annotations

import re
import shutil
import sys
from pathlib import Path

RE_OPENAI = re.compile(r"^sk-[A-Za-z0-9_\-]{20,}$")
RE_EMAIL = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")
RE_LINE_ID = re.compile(r"^\d{10}$")
RE_LINE_SECRET = re.compile(r"^[a-f0-9]{32}$")


def classify(token: str) -> str | None:
    if RE_OPENAI.match(token):
        return "OPENAI_API_KEY"
    if RE_EMAIL.match(token):
        return "GOOGLE_ACCOUNT_EMAIL"
    if RE_LINE_ID.match(token):
        return "LINE_CHANNEL_ID"
    if RE_LINE_SECRET.match(token):
        return "LINE_CHANNEL_SECRET"
    return None


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    src = root / ".env"
    backup = root / ".env.original"

    if not src.exists():
        print("ERROR: .env not found")
        return 1

    raw = src.read_text(encoding="utf-8", errors="replace")

    found: dict[str, str] = {}
    unclassified: list[tuple[int, int]] = []  # (line_no, token_len)

    for lineno, line in enumerate(raw.splitlines(), 1):
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        m = re.match(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$", line)
        if m:
            found.setdefault(m.group(1), m.group(2).strip().strip("'\""))
            continue
        for token in s.split():
            key = classify(token)
            if key:
                if key not in found:
                    found[key] = token
            elif len(token) >= 8 and not token.isalpha():
                unclassified.append((lineno, len(token)))

    if not backup.exists():
        shutil.copy2(src, backup)
        backup.chmod(0o600)
        print(f"Backed up original -> {backup.name} (chmod 600, gitignored)")

    order = [
        ("OPENAI_API_KEY", "OpenAI API key (client-provided)"),
        ("LINE_CHANNEL_ID", "LINE Messaging API channel ID"),
        ("LINE_CHANNEL_SECRET", "LINE Messaging API channel secret"),
        ("GOOGLE_ACCOUNT_EMAIL", "Google account to authorize via OAuth2 (NOT a secret)"),
    ]

    lines = [
        "# ============================================================",
        "# SOCIAL — environment configuration",
        "# Managed file. chmod 600. NEVER commit (see .gitignore).",
        "# Original client-supplied file preserved as .env.original",
        "# ============================================================",
        "",
        "# --- LLM provider ---",
    ]
    for key, comment in order:
        if key == "LINE_CHANNEL_ID":
            lines += ["", "# --- LINE Messaging API ---"]
        if key == "GOOGLE_ACCOUNT_EMAIL":
            lines += ["", "# --- Google (OAuth2 only; password auth is prohibited) ---"]
        if key in found:
            lines.append(f"# {comment}")
            lines.append(f"{key}={found[key]}")
        else:
            lines.append(f"# {comment}")
            lines.append(f"# {key}=   # NOT YET PROVIDED")

    lines += [
        "",
        "# --- Still required for the LINE phase (request from client) ---",
        "# LINE_CHANNEL_ACCESS_TOKEN=   # long-lived token from LINE Developers console",
        "# LINE_OWNER_USER_ID=          # owner's LINE userId (U...), for the allowlist",
        "",
        "# --- Optional: future provider switch ---",
        "# ANTHROPIC_API_KEY=",
        "",
    ]

    src.write_text("\n".join(lines) + "\n", encoding="utf-8")
    src.chmod(0o600)

    print("\nNormalized .env written (chmod 600). Detected keys:")
    for key, _ in order:
        mark = "OK  " if key in found else "MISS"
        print(f"  [{mark}] {key}")
    print("  [SKIP] Gmail password — intentionally excluded (OAuth2 policy, spec s.15)")
    if unclassified:
        print("\nUnclassified secret-shaped tokens (left only in .env.original):")
        for ln, length in unclassified:
            print(f"  line {ln}: len={length}")
    print("\nNo secret values were printed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
