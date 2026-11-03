"""What the current user may do. There are no accounts yet: everyone is on the
"local" plan and every limit is off. When accounts and payments arrive, this is
the one place to change: `current()` reads the signed-in user's plan and
`check_upload_allowed()` enforces it. Catalog songs are always free.

Planned: free plan = 3 uploads, subscribers unlimited (NOTEALONG_FREE_UPLOADS
lets you try the limit today)."""
from __future__ import annotations

import os

from . import library

FREE_UPLOAD_LIMIT = int(os.environ["NOTEALONG_FREE_UPLOADS"]) if os.environ.get("NOTEALONG_FREE_UPLOADS") else None


class UploadLimitReached(Exception):
    pass


def current() -> dict:
    used = len(library.list_songs())
    limit = FREE_UPLOAD_LIMIT
    return {
        "plan": "local" if limit is None else "free",
        "uploads": {"used": used, "limit": limit, "remaining": None if limit is None else max(0, limit - used)},
        "catalog": "free",
    }


def check_upload_allowed() -> None:
    e = current()
    if e["uploads"]["limit"] is not None and e["uploads"]["remaining"] <= 0:
        raise UploadLimitReached(f"The free plan includes {e['uploads']['limit']} of your own songs. Built-in songs are always free.")
