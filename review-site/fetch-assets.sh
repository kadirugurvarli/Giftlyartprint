#!/usr/bin/env bash
# Downloads the source images listed in tools/images.py into assets/img/ (max 1200px wide).
# Needs outbound access to cdn.shopify.com. Run from the review-site folder.
set -euo pipefail
cd "$(dirname "$0")"
python3 -I - <<'PY'
import subprocess, sys, pathlib
sys.path.insert(0, "tools")
import images
out = pathlib.Path("assets/img"); out.mkdir(parents=True, exist_ok=True)
fail = 0
for key, (name, url, w, h, kind) in images.IMAGES.items():
    sep = "&" if "?" in url else "?"
    r = subprocess.run(["curl", "-fsS", "-m", "60", "-o", str(out/name), f"{url}{sep}width=1200"])
    print(("ok   " if r.returncode == 0 else "FAIL ") + name)
    fail += r.returncode != 0
sys.exit(1 if fail else 0)
PY
