#!/usr/bin/env python3
"""
Publish a complete, self-restoring copy of the site's source alongside the site.

Why this exists
---------------
The site is deployed by uploading a directory. That means any future session
that wants to *change* something needs the whole source tree — and a scheduled
task starts in a fresh container with nothing in it. Without this, an automated
audit can only ever report; it can never fix.

This writes _source/bundle.json containing every source file the site is built
from. A fresh session can fetch that one URL, write the tree back to disk,
patch whatever needs patching, and redeploy. No git, no credentials, no
external service.

Deliberately excluded: data/*.json. Those are already served publicly at stable
URLs, they are the files most likely to be edited, and duplicating them here
would guarantee the two copies drift apart. The manifest points at them instead.

Run this before every deploy:
    python3 scripts/build-source-bundle.py
"""

import hashlib
import json
import os
import pathlib
import datetime

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "_source"
SITE = "https://bucky-greenlove-funding-toolkit.netlify.app"

# Everything needed to rebuild and redeploy, except the data files.
INCLUDE_SUFFIXES = {".html", ".css", ".js", ".mjs", ".toml", ".py", ".md"}
SKIP_DIRS = {"_source", "node_modules", ".git", ".netlify"}
SKIP_FILES = {"bundle.json"}

# Files that live at stable public URLs and are fetched separately.
EXTERNAL = {
    "data/programs.json": f"{SITE}/data/programs.json",
    "data/panels.json": f"{SITE}/data/panels.json",
}


def collect():
    files = {}
    for path in sorted(ROOT.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(ROOT).as_posix()
        if any(part in SKIP_DIRS for part in path.relative_to(ROOT).parts[:-1]):
            continue
        if path.name in SKIP_FILES:
            continue
        if rel.startswith("data/"):
            continue
        if path.suffix.lower() not in INCLUDE_SUFFIXES:
            continue
        try:
            files[rel] = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue  # binary — nothing binary is source here
    return files


def main():
    files = collect()
    OUT_DIR.mkdir(exist_ok=True)

    bundle = {
        "generated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "site": SITE,
        "netlifySiteId": "8a7c2094-9089-4187-8f30-e00b1888c474",
        "howToRestore": [
            "1. Fetch this file.",
            "2. For each entry in `files`, write the value to that relative path.",
            "3. Fetch each URL in `external` and write it to its key path.",
            "4. Make whatever change you came to make.",
            "5. Re-run scripts/build-source-bundle.py so this bundle stays current.",
            "6. Re-version the assets (see scripts/version-assets.py) so browsers pick up CSS/JS changes.",
            "7. Deploy: call the Netlify MCP deploy-site operation for netlifySiteId to get a fresh",
            "   proxy command, then run it from the rebuilt directory.",
        ],
        "external": EXTERNAL,
        "fileCount": len(files),
        "files": files,
    }
    bundle["checksum"] = hashlib.sha256(
        json.dumps(bundle["files"], sort_keys=True).encode()
    ).hexdigest()[:16]

    out = OUT_DIR / "bundle.json"
    out.write_text(json.dumps(bundle, indent=1), encoding="utf-8")

    kb = out.stat().st_size / 1024
    print(f"wrote {out.relative_to(ROOT)} — {len(files)} files, {kb:.0f} KB, checksum {bundle['checksum']}")
    for rel in sorted(files):
        print(f"  {rel}")


if __name__ == "__main__":
    main()
