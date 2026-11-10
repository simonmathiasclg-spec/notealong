"""Which machine a job needs (shared by the worker, the dispatcher and the Modal app; no heavy imports)."""
from __future__ import annotations


def needs_gpu(job: dict) -> bool:
    """Separating the voice and reading the words want a GPU; everything else runs on a CPU machine."""
    if job.get("kind") != "process":
        return False
    p = job.get("params") or {}
    return bool(p.get("new") or p.get("retry") or {"stems", "lyrics"} & set(p.get("steps") or ["stems"]))
