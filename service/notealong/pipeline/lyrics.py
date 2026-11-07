"""Step 4: lyrics with word timings from the vocals stem.

Two interchangeable backends produce the same structure:
  {"language": "en", "words": [{"text", "start", "end", "confidence"}], "segments": [[start, end], ...]}

- faster-whisper (default): fast on CPU, word timestamps built in.
- openai-whisper: reference implementation; accepts a local .pt checkpoint.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Callable

from ..config import WHISPER_BACKEND, WHISPER_DEVICE, WHISPER_MODEL, WHISPER_MODEL_PATH

Progress = Callable[[float], None]


def _clean_word(text: str) -> str:
    return text.strip()


def transcribe(vocals_path: Path, language: str | None = None, progress: Progress | None = None,
               backend: str | None = None, model_name: str | None = None) -> dict:
    backend = backend or WHISPER_BACKEND
    model_name = model_name or WHISPER_MODEL
    if backend == "openai-whisper":
        return _transcribe_openai(vocals_path, language, progress, model_name)
    return _transcribe_faster(vocals_path, language, progress, model_name)


def _transcribe_faster(path: Path, language: str | None, progress: Progress | None, model_name: str) -> dict:
    from faster_whisper import WhisperModel

    device = "cpu" if WHISPER_DEVICE == "auto" else WHISPER_DEVICE
    compute = "int8" if device == "cpu" else "float16"
    model = WhisperModel(model_name, device=device, compute_type=compute)
    segments, info = model.transcribe(
        str(path), language=language, word_timestamps=True, vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
        condition_on_previous_text=False, beam_size=5,
    )
    words, segs = [], []
    total = max(info.duration or 1.0, 1.0)
    for seg in segments:
        segs.append([seg.start, seg.end])
        for w in seg.words or []:
            words.append({"text": _clean_word(w.word), "start": w.start, "end": w.end,
                          "confidence": float(w.probability)})
        if progress:
            progress(min(0.99, seg.end / total))
    return {"language": info.language, "language_probability": float(info.language_probability or 0),
            "words": words, "segments": segs, "model": f"faster-whisper/{model_name}"}


def _transcribe_openai(path: Path, language: str | None, progress: Progress | None, model_name: str) -> dict:
    import torch
    import whisper

    device = "cpu" if WHISPER_DEVICE == "auto" else WHISPER_DEVICE
    target = WHISPER_MODEL_PATH or model_name
    model = whisper.load_model(target, device=device)
    heads = getattr(whisper, "_ALIGNMENT_HEADS", {}).get(model_name)
    if heads is not None:
        model.set_alignment_heads(heads)
    result = model.transcribe(str(path), language=language, word_timestamps=True,
                              condition_on_previous_text=False, fp16=torch.cuda.is_available(),
                              verbose=None)
    words, segs = [], []
    for seg in result.get("segments", []):
        segs.append([seg["start"], seg["end"]])
        for w in seg.get("words", []):
            words.append({"text": _clean_word(w["word"]), "start": float(w["start"]), "end": float(w["end"]),
                          "confidence": float(w.get("probability", 1.0))})
    if progress:
        progress(1.0)
    return {"language": result.get("language"), "language_probability": 1.0,
            "words": words, "segments": segs, "model": f"openai-whisper/{model_name}"}


_LETTERS = re.compile(r"[^\W\d_]")


def _fragment(text: str) -> bool:
    """A token that is not a word of its own: punctuation ("?", ","), or a piece the transcriber
    split off after an apostrophe or hyphen ("'on" in "qu'on", "-ce" in "Est-ce", "s" in "it's")."""
    return not _LETTERS.search(text) or text[0] in "'\u2019-"


def postprocess_words(words: list[dict], min_len: float = 0.05) -> list[dict]:
    """Sort, remove empties, glue split fragments back onto the word before them,
    fix inverted/overlapping timings, number the words."""
    out = []
    for w in sorted(words, key=lambda w: w["start"]):
        text = w["text"].strip()
        if not text:
            continue
        if out and _fragment(text) and float(w["start"]) - out[-1]["end"] < 0.6:
            prev = out[-1]
            prev["text"] = prev["text"] + text
            prev["end"] = max(prev["end"], round(float(w["end"]), 3))
            prev["confidence"] = round(min(prev["confidence"], float(w.get("confidence", 1.0))), 3)
            continue
        if not _LETTERS.search(text):
            continue                                      # stray punctuation with nothing before it
        start, end = float(w["start"]), float(w["end"])
        if out and start < out[-1]["end"]:
            start = out[-1]["end"]
        if end < start + min_len:
            end = start + min_len
        out.append({"text": text, "start": round(start, 3), "end": round(end, 3),
                    "confidence": round(float(w.get("confidence", 1.0)), 3)})
    for i, w in enumerate(out):
        w["id"] = f"w{i + 1}"
    return out
