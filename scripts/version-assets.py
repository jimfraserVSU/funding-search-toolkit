#!/usr/bin/env python3
"""
Re-stamp assets/style.css and assets/app.js with a content-hash query string
in every HTML file.

Without this, a browser that already has the old stylesheet will keep using it
after a deploy, because the URL never changed. Run it after ANY change to the
CSS or JS, before deploying.

    python3 scripts/version-assets.py
"""

import glob
import hashlib
import os
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
os.chdir(ROOT)

css = hashlib.md5((ROOT / "assets/style.css").read_bytes()).hexdigest()[:8]
js = hashlib.md5((ROOT / "assets/app.js").read_bytes()).hexdigest()[:8]

changed = 0
for f in sorted(glob.glob("*.html")):
    s = original = pathlib.Path(f).read_text(encoding="utf-8")
    s = re.sub(r'href="assets/style\.css(\?v=[a-f0-9]+)?"', f'href="assets/style.css?v={css}"', s)
    s = re.sub(r'src="assets/app\.js(\?v=[a-f0-9]+)?"', f'src="assets/app.js?v={js}"', s)
    if s != original:
        pathlib.Path(f).write_text(s, encoding="utf-8")
        changed += 1

print(f"style.css -> v={css}")
print(f"app.js    -> v={js}")
print(f"{changed} HTML file(s) updated")
