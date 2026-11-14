"""Melody Lab: one line per answer key (covers used, lines kept, notes scored)."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import KEYS, SONGS  # noqa: E402

ok = 0
for s in SONGS:
    f = KEYS / f"{s['slug']}.json"
    if not f.exists():
        print(f"{s['slug']:<28} no key yet")
        continue
    k = json.loads(f.read_text())
    cov = k.get("covers", {})
    best = sorted((round(v.get("singer_match", 0), 2) for v in cov.values()), reverse=True)[:4]
    hi = sum(1 for ln in k.get("lines", []) if ln["confidence"] == "high")
    ok += not k.get("dropped")
    print(f"{s['slug']:<28} covers {len(k.get('covers_used', []))}/{len(cov)}  singer match {best}  lines {k.get('scored_lines', 0)}/{len(k.get('lines', []))} ({hi} high)  "
          f"notes {k.get('scored_notes', 0)}  {'DROPPED: ' + k['dropped'] if k.get('dropped') else ''}")
print(ok, "songs with a key")
