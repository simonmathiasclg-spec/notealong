"""Plain-language messages for processing failures, shared by the local job queue (jobs.py) and the
online worker (cloud/worker.py)."""
from __future__ import annotations


class StepStopped(Exception):
    pass


class StepTimeout(Exception):
    pass


def friendly_error(e: Exception) -> str:
    text = str(e)
    low = text.lower()
    if isinstance(e, StepStopped):
        return "Stopped. Press retry to continue from where it left off."
    if isinstance(e, StepTimeout):
        return "This step made no progress for a long time, so it was stopped. Retry; if it happens again, try a shorter file or close other apps."
    if "out of memory" in low or "oom" in low or "mps backend" in low and "memory" in low:
        return "The computer ran out of memory while processing. Close other apps and try again."
    if "drm" in low or "protected" in low or "encrypted" in low:
        return "This file is copy-protected (for example a download from Apple Music or Spotify) and cannot be read. Use a file you own as an MP3, M4A, WAV or FLAC, or a recording."
    if "invalid data found" in low or "moov atom" in low or "could not be read" in low:
        return "The audio in this file could not be read. It may be damaged or still downloading. Try exporting it again as MP3, M4A or WAV."
    if "ffmpeg" in low or "ffprobe" in low:
        return "The audio could not be read. Make sure ffmpeg is installed and the file is a valid MP3, WAV, M4A or FLAC."
    if "download" in low or "urlopen" in low or "connection" in low or "http" in low:
        return "A model file could not be downloaded. Check your internet connection and retry."
    if "no module named" in low:
        return f"A Python package is missing ({text}). Re-run the setup steps in the README."
    return f"Something went wrong: {text[:300]}"
