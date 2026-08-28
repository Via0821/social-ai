#!/usr/bin/env python3
"""Inspect .env structure WITHOUT revealing any secret value.

Emits only: line number, detected label, and a non-reversible fingerprint
(value length, character-class summary, and at most a 3-char prefix for
well-known public prefixes such as 'sk-').
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

PUBLIC_PREFIXES = ("sk-", "sk_", "xoxb-", "ghp_", "AIza")


def fingerprint(value: str) -> str:
    if not value:
        return "<empty>"
    n = len(value)
    classes = []
    if any(c.islower() for c in value):
        classes.append("a-z")
    if any(c.isupper() for c in value):
        classes.append("A-Z")
    if any(c.isdigit() for c in value):
        classes.append("0-9")
    if any(not c.isalnum() for c in value):
        classes.append("sym")
    prefix = ""
    for p in PUBLIC_PREFIXES:
        if value.startswith(p):
            prefix = f" prefix='{p}...'"
            break
    return f"len={n} chars=[{','.join(classes)}]{prefix}"


def main() -> int:
    path = Path(sys.argv[1] if len(sys.argv) > 1 else ".env")
    if not path.exists():
        print(f"MISSING: {path}")
        return 1

    raw = path.read_text(encoding="utf-8", errors="replace")
    print(f"File: {path}  ({len(raw)} bytes, {len(raw.splitlines())} lines)")
    print("-" * 62)

    for i, line in enumerate(raw.splitlines(), 1):
        stripped = line.strip()
        if not stripped:
            print(f"{i:2d}: <blank>")
            continue
        if stripped.startswith("#"):
            print(f"{i:2d}: <comment>")
            continue

        m = re.match(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$", line)
        if m:
            key, val = m.group(1), m.group(2).strip().strip("'\"")
            print(f"{i:2d}: KEY={key:<32} {fingerprint(val)}")
            continue

        # Free-form line: report only its shape.
        tokens = stripped.split()
        label_words = [t for t in tokens if t.isascii() and t.isalpha()]
        label = " ".join(label_words[:4]) if label_words else "<no label words>"
        longest = max(tokens, key=len) if tokens else ""
        print(
            f"{i:2d}: FREEFORM  words={len(tokens):<3} "
            f"label~'{label[:34]}'  longest-token: {fingerprint(longest)}"
        )

    print("-" * 62)
    print("No secret values were printed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
