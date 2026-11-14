#!/usr/bin/env python3
"""Reject missing or stale browser renderers after a full build."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUNDLES = ("", "game", "siege", "viewer", "benchmark", "benchmark/animation",
           "viewer/reference")
for bundle in BUNDLES:
    folder = ROOT / "web" / bundle
    module = folder / "app.js"
    binary = folder / "app.wasm"
    if not module.is_file() or not binary.is_file():
        raise SystemExit(f"Missing browser bundle: {folder}")
    data = binary.read_bytes()
    if b"23 are required" in data or b"at least 23 WebGL2" in data:
        raise SystemExit(f"Stale 23-unit renderer: {binary}")
    if b"16 are required" not in data:
        raise SystemExit(f"Unrecognized renderer version: {binary}")
    print(f"ok: {binary.relative_to(ROOT)} supports the 16-unit budget")
