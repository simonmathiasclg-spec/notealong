"""Internal accuracy testing only. Build an answer key for an uploaded song from several instrumental
(sax) covers: what the players agree on, on the upload's own timeline.

    .venv/bin/python scripts/accuracy/answer_key.py <song_id> ../test-recordings/youtube/*.m4a \
        --out ../test-recordings/<song_id>-answer-key.json

For every cover (prepared by prepare_covers.py: <id>/f0.npz with the lead instrument's pitch):
  1. key: the cover's chroma is compared with the upload's at all 12 transpositions; the best one is
     the cover's key difference, undone on its notes.
  2. timeline: chroma features of the cover and the upload (both full mixes, so the backing aligns with
     the backing) are aligned with dynamic time warping; the warping path maps cover time to song time.
  3. notes: the lead pitch is cut into notes where it settles on a new semitone or where the level dips
     (a tongued repeat); each note's pitch is the median of its stable middle.
  4. octave: one octave shift per cover so the notes sit in the singer's register.
Then the covers' notes are clustered: notes from different covers with the same pitch whose starts
fall within 120 ms of each other. A cluster played by at least half the covers becomes an answer-key
note (start and end are the medians); flourishes played by one or two players drop out.
Nothing here ships: the recordings and the key stay in the gitignored test-recordings/ folder.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from notealong.pipeline.audio import load_mono  # noqa: E402

HOP = 0.01          # f0 frames
F0_NAME = "f0_fcpe.npz"   # which pitch track of the covers to use (prepare_covers.py --tracker)
CHROMA_HOP = 0.05   # alignment frames
SR = 22050


def chroma(path: Path, hop_s: float = CHROMA_HOP) -> np.ndarray:
    import librosa
    y, sr = load_mono(path, sr=SR)
    hop = int(round(hop_s * sr))
    c = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop, bins_per_octave=36) + 1e-3   # silence: a flat, not a zero, vector
    c = c / np.linalg.norm(c, axis=0, keepdims=True)
    return c.astype(np.float32)


# steps of (cover, song) frames with their weights: the path's slope stays between 1/2 and 2, so a whole
# cover can never be squeezed into a small part of the song (or stretched over all of it)
STEPS = np.array([[1, 1], [1, 2], [2, 1]])
WEIGHTS_ADD = np.array([0.0, 0.0, 0.0])
WEIGHTS_MUL = np.array([1.0, 1.0, 1.0])


def _dtw(cov: np.ndarray, song: np.ndarray):
    import librosa
    return librosa.sequence.dtw(X=cov, Y=song, metric="cosine", subseq=True, backtrack=True,
                                step_sizes_sigma=STEPS, weights_add=WEIGHTS_ADD, weights_mul=WEIGHTS_MUL)


def best_shift(cov_path: Path, song_path: Path) -> tuple[int, list[float]]:
    """Semitones the cover sits above the song: the transposition whose alignment costs least (coarse grid)."""
    cc, sc = chroma(cov_path, 0.2), chroma(song_path, 0.2)
    costs = []
    for k in range(12):
        D, _ = _dtw(np.roll(cc, -k, axis=0), sc)
        costs.append(float(D[-1, :].min() / cc.shape[1]))
    k = int(np.argmin(costs))
    return (k - 12 if k > 6 else k), costs


def dtw_map(cov: np.ndarray, song: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Warping path (cover frame, song frame) as two time arrays in seconds, one song time per cover time."""
    D, wp = _dtw(cov, song)
    wp = wp[::-1]
    tc, ts = wp[:, 0] * CHROMA_HOP, wp[:, 1] * CHROMA_HOP
    uc, idx = np.unique(tc, return_inverse=True)
    us = np.bincount(idx, weights=ts) / np.bincount(idx)
    return uc, us


def segment(midi: np.ndarray, per: np.ndarray, db: np.ndarray) -> list[dict]:
    """Notes from a clean monophonic pitch track (a sax): start at a new stable semitone or after a level dip."""
    from scipy.ndimage import median_filter
    voiced = (per > 0.5) & (db > np.percentile(db[per > 0.5], 10) if (per > 0.5).any() else per > 0.5)
    m = median_filter(np.where(voiced, midi, 0), size=5)
    notes, cur = [], None
    smooth_db = median_filter(db, size=3)
    for i in range(len(m)):
        if not voiced[i] or m[i] <= 0:
            if cur and i - cur["i0"] >= 6:
                notes.append(cur)
            cur = None
            continue
        st = int(round(m[i]))
        dip = i >= 4 and smooth_db[i] - smooth_db[max(0, i - 4):i].min() > 6 and smooth_db[max(0, i - 4):i].min() < smooth_db[i - 6:i - 4].max() - 6 if i >= 6 else False
        if cur is None:
            cur = {"i0": i, "i1": i, "st": st, "vals": [m[i]]}
            continue
        # a new semitone that holds for 50 ms, or a re-attack after a level dip
        if (st != cur["st"] and all(int(round(x)) == st for x in m[i:i + 5])) or dip:
            if i - cur["i0"] >= 6:
                notes.append(cur)
            cur = {"i0": i, "i1": i, "st": st, "vals": [m[i]]}
        else:
            cur["i1"] = i
            cur["vals"].append(m[i])
    if cur and cur["i1"] - cur["i0"] >= 6:
        notes.append(cur)
    out = []
    for n in notes:
        v = np.array(n["vals"])
        core = v[len(v) // 5: max(len(v) // 5 + 1, 4 * len(v) // 5)]          # the stable middle, not the scoop
        out.append({"start": n["i0"] * HOP, "end": (n["i1"] + 1) * HOP, "midi": int(round(float(np.median(core))))})
    return out


def _agree(a: list[dict], b: list[dict], tol: float = 0.3, shift: int = 0) -> float:
    """Share of a's notes that b also plays (same pitch class, start within tol)."""
    if not a:
        return 0.0
    starts = np.array([m["start"] for m in b])
    pcs = np.array([m["midi"] % 12 for m in b])
    hit = 0
    for n in a:
        i0, i1 = np.searchsorted(starts, n["start"] - tol), np.searchsorted(starts, n["start"] + tol)
        if ((pcs[i0:i1] - (n["midi"] - shift)) % 12 == 0).any():
            hit += 1
    return hit / len(a)


def _cover_notes(cov: Path, song_c: np.ndarray, k: int, register: float):
    d = cov.with_suffix("")
    z = np.load(d / F0_NAME)
    tc, ts = dtw_map(np.roll(chroma(cov), -k, axis=0), song_c)
    notes = segment(z["midi"], z["periodicity"], z["db"])
    for n in notes:
        n["midi"] -= k
        n["start"] = float(np.interp(n["start"], tc, ts))
        n["end"] = float(np.interp(n["end"], tc, ts))
    notes = sorted((n for n in notes if n["end"] - n["start"] >= 0.05), key=lambda n: n["start"])
    med = float(np.median([n["midi"] for n in notes])) if notes else register
    octave = int(round((register - med) / 12.0)) * 12
    for n in notes:
        n["midi"] += octave
    slope = float(np.polyfit(tc, ts, 1)[0])
    return notes, {"octave": octave, "tempo_ratio": round(slope, 3), "maps": [round(float(ts[0]), 1), round(float(ts[-1]), 1)], "stem": str(z["stem"])}


def build(song_dir: Path, covers: list[Path], quorum: float = 0.5, tol: float = 0.2, min_agree: float = 0.5) -> dict:
    song_mix = song_dir / "original.mp3"
    if not song_mix.exists():
        song_mix = next(song_dir.glob("original.*"))
    song_c = chroma(song_mix)
    song = json.loads((song_dir / "song.json").read_text())
    register = float(np.median([n["midi"] for n in song["notes"]])) if song["notes"] else 60.0
    per_cover = {}
    # 1. each cover on the song's timeline, its key from the chroma alignment cost
    for cov in covers:
        k, costs = best_shift(cov, song_mix)
        notes, info = _cover_notes(cov, song_c, k, register)
        sc = sorted(costs)
        per_cover[cov.stem] = {"path": cov, "shift": k, "key_from": "chroma", "key_margin": round(sc[1] / sc[0], 3), "notes": notes, **info}
        print(f"{cov.stem}: key {k:+d} from chroma, {len(notes)} notes, tempo ratio {info['tempo_ratio']}, maps {info['maps']} s", flush=True)
    # 2. the pair of covers that agree best is the anchor; every other cover's key is re-checked against it
    ids = list(per_cover)
    pair = max(((a, b) for a in ids for b in ids if a < b),
               key=lambda ab: _agree(per_cover[ab[0]]["notes"], per_cover[ab[1]]["notes"]) + _agree(per_cover[ab[1]]["notes"], per_cover[ab[0]]["notes"]))
    anchor = sorted(per_cover[pair[0]]["notes"] + per_cover[pair[1]]["notes"], key=lambda n: n["start"])
    print(f"anchor pair: {pair[0]} and {pair[1]}", flush=True)
    for cid in ids:
        if cid in pair:
            per_cover[cid]["agreement_with_anchor"] = round(_agree(per_cover[cid]["notes"], per_cover[pair[1] if cid == pair[0] else pair[0]]["notes"]), 3)
            continue
        c = per_cover[cid]
        scores = {sh: _agree(c["notes"], anchor, shift=sh) for sh in range(-6, 6)}
        best = max(scores, key=scores.get)
        if best != 0 and scores[best] > scores[0] + 0.1:
            k = c["shift"] + best
            notes, info = _cover_notes(c["path"], song_c, k, register)
            c.update({"shift": k, "key_from": "notes", "notes": notes, **info})
            print(f"{cid}: key corrected to {k:+d} by note agreement ({scores[0]:.2f} -> {scores[best]:.2f})", flush=True)
        c["agreement_with_anchor"] = round(_agree(c["notes"], anchor), 3)
    used = [cid for cid in ids if per_cover[cid]["agreement_with_anchor"] >= min_agree]
    for cid in ids:
        per_cover[cid]["used"] = cid in used
        print(f"{cid}: agreement with the anchor {per_cover[cid]['agreement_with_anchor']:.2f}{'' if cid in used else '  (left out)'}", flush=True)

    # 3. cluster the used covers' notes: same pitch class, starts within tol, one note per cover
    allnotes = sorted(((n["start"], n["end"], n["midi"], c) for c in used for n in per_cover[c]["notes"]))
    taken = set()
    key_notes = []
    n_cov = len(used)
    need = max(2, int(np.ceil(quorum * n_cov)))
    for i, (s0, e0, m0, c0) in enumerate(allnotes):
        if i in taken:
            continue
        members = {c0: (s0, e0, m0)}
        idxs = [i]
        for j in range(i + 1, len(allnotes)):
            s2, e2, m2, c2 = allnotes[j]
            if s2 - s0 > tol:
                break
            if j in taken or c2 in members or (m2 - m0) % 12:
                continue
            members[c2] = (s2, e2, m2)
            idxs.append(j)
        if len(members) >= need:
            taken.update(idxs)
            mids = [v[2] for v in members.values()]
            vals, counts = np.unique(mids, return_counts=True)
            top = vals[counts == counts.max()]
            midi = int(top[np.argmin(np.abs(top - register))])
            starts = [v[0] for v in members.values()]
            ends = [v[1] for v in members.values()]
            key_notes.append({"start": round(float(np.median(starts)), 3), "end": round(float(np.median(ends)), 3), "midi": midi,
                              "agreement": round(len(members) / n_cov, 2), "start_spread_ms": round(1000 * float(np.std(starts)))})
    key_notes.sort(key=lambda n: n["start"])
    clean = []
    for n in key_notes:
        if clean and n["start"] < clean[-1]["end"] - 0.03:
            prev = clean[-1]
            if n["start"] - prev["start"] < 0.1:             # the same moment twice: keep the better-agreed one
                if n["agreement"] > prev["agreement"]:
                    clean[-1] = n
                continue
            prev["end"] = n["start"]                          # the next note starts: the previous one ends
        clean.append(n)
    return {"song_id": song_dir.name, "quorum": quorum, "tolerance_s": tol, "anchor": list(pair), "used": used,
            "covers": {c: {k: v for k, v in d.items() if k not in ("notes", "path")} | {"n_notes": len(d["notes"])} for c, d in per_cover.items()},
            "notes": clean, "cover_notes": {c: d["notes"] for c, d in per_cover.items()}}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("song_id")
    ap.add_argument("covers", nargs="+")
    ap.add_argument("--out", required=True)
    ap.add_argument("--quorum", type=float, default=0.5)
    ap.add_argument("--library", default=None, help="the folder that holds the song (default: the app's library)")
    ap.add_argument("--tracker", choices=("crepe", "crepetiny", "fcpe"), default="crepe")
    a = ap.parse_args()
    global F0_NAME
    F0_NAME = f"f0_{a.tracker}.npz"
    song_dir = Path(a.library) / a.song_id if a.library else ROOT.parent / "library" / a.song_id
    key = build(song_dir, [Path(c) for c in a.covers], a.quorum)
    Path(a.out).write_text(json.dumps(key, indent=1))
    ag = [n["agreement"] for n in key["notes"]]
    print(f"answer key: {len(key['notes'])} notes from {len(key['used'])} covers, agreement median {np.median(ag):.2f}, "
          f"{sum(1 for x in ag if x >= 0.99)} played by all of them, {sum(1 for n in key['notes'] if n['end'] - n['start'] >= 0.5)} held 0.5 s or longer")
    return 0


if __name__ == "__main__":
    sys.exit(main())
