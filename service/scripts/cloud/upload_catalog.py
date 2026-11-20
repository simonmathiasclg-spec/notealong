"""Uploads the built-in catalog (public domain and Creative Commons songs) to the online version's public
`catalog` bucket: index.json, search-index.json, and each song's song.json, backing.mp3, vocals.mp3 and
cover.webp. Only files that changed since the last upload are sent (a manifest of hashes is kept there too).

    cd service && .venv/bin/python scripts/cloud/upload_catalog.py [--env ../.env.cloud] [--dry-run]

Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (from the env file or the environment).
Only catalog/ is read: songs whose licence is not public domain or Creative Commons are refused, and nothing
from test-recordings/ (internal testing material) can be uploaded.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "service"))

from notealong import searchindex  # noqa: E402
from notealong.catalog import store as catalog_store  # noqa: E402
from notealong.cloud.supa import Supa  # noqa: E402
from notealong.config import CATALOG_DIR  # noqa: E402

FILES = {"song.json": "application/json", "backing.mp3": "audio/mpeg", "vocals.mp3": "audio/mpeg", "cover.webp": "image/webp"}
FORBIDDEN = (ROOT / "test-recordings").resolve()


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"'))


def sha(data: bytes) -> str:
    return hashlib.sha1(data).hexdigest()


def safe(path: Path) -> Path:
    p = path.resolve()
    if FORBIDDEN in p.parents or p == FORBIDDEN or CATALOG_DIR.resolve() not in p.parents:
        raise SystemExit(f"refusing to upload {p}: only files inside catalog/ may go online")
    return p


def put(supa, bucket: str, key: str, data: bytes, ctype: str, cache_seconds: int, tries: int = 5) -> None:
    """One upload, tried again after a dropped connection (a long upload over home internet sometimes is)."""
    import time
    for i in range(tries):
        try:
            supa.upload(bucket, key, data, ctype, cache_seconds=cache_seconds)
            return
        except Exception as e:  # noqa: BLE001
            if i == tries - 1:
                raise
            print(f"  {key}: {type(e).__name__}, trying again", flush=True)
            time.sleep(2 * (i + 1))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", default=str(ROOT / ".env.cloud"))
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    load_env(Path(a.env))
    index = catalog_store.load_index()
    songs = []
    for s in index["songs"]:
        kind = (s.get("source") or {}).get("kind")
        if kind not in ("traditional", "cc"):
            raise SystemExit(f"{s['id']}: licence kind {kind!r} is not public domain or Creative Commons; not uploading")
        songs.append(s)
    supa = None if a.dry_run else Supa()
    try:
        manifest = {} if supa is None else json.loads(supa.download("catalog", "manifest.json"))
    except Exception:  # noqa: BLE001  (first upload)
        manifest = {}
    sent = skipped = total = 0
    for s in songs:
        for name, ctype in FILES.items():
            p = CATALOG_DIR / s["id"] / name
            if not p.exists():
                continue
            data = safe(p).read_bytes()
            key = f"{s['id']}/{name}"
            total += len(data)
            h = sha(data)
            if manifest.get(key) == h:
                skipped += 1
                continue
            if supa:
                put(supa, "catalog", key, data, ctype, cache_seconds=86400)
            manifest[key] = h
            sent += 1
        print(f"{s['id']}: ok", flush=True)
        if supa and sent and sent % 40 == 0:      # keep what is done, so a stopped run carries on from here
            put(supa, "catalog", "manifest.json", json.dumps(manifest).encode(), "application/json", cache_seconds=60)
    public_index = {**index, "songs": songs}
    extras = {
        "index.json": json.dumps(public_index, ensure_ascii=False).encode(),
        "search-index.json": json.dumps({"songs": searchindex.catalog_rows()}, ensure_ascii=False).encode(),
    }
    for name, data in extras.items():
        if supa:
            put(supa, "catalog", name, data, "application/json", cache_seconds=300)
    if supa:
        put(supa, "catalog", "manifest.json", json.dumps(manifest).encode(), "application/json", cache_seconds=60)
    print(f"{len(songs)} songs, {total / 1e6:.0f} MB in all: {sent} files sent, {skipped} unchanged"
          + (" (dry run: nothing sent)" if a.dry_run else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
