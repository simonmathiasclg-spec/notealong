"""Original abstract cover art, one SVG per song, generated from a seed so the
set looks like one collection. No photos, no album art: soft overlapping
shapes on a two-tone ground, with a hue family chosen from the song's mood."""
from __future__ import annotations

import hashlib
import math

# Hue families by genre keep the shelf varied but coherent.
HUE_BY_GENRE = {
    "Children's": 38, "Celebration": 18, "Christmas": 352, "Hymn": 212, "Spiritual": 262, "Folk": 150,
    "Classical": 230, "Latin": 24, "Lullaby": 290, "Pop": 330, "Rock": 10, "Indie": 196, "Jazz": 46,
    "Gospel": 262, "Country": 90, "Reggae": 120, "Electronic": 250, "Hip-Hop": 300, "RNB": 318, "Blues": 206,
    "Metal": 0, "Patriotic": 220, "Sea shanty": 190, "Lied": 240, "Parlour": 20,
}


def _rng(seed: str):
    h = hashlib.sha256(seed.encode()).digest()
    i = [0]

    def nxt() -> float:
        v = h[i[0] % len(h)] / 255.0
        i[0] += 1
        return v
    return nxt


def hsl(h: float, s: float, l: float, a: float = 1.0) -> str:
    return f"hsl({h % 360:.0f} {s:.0f}% {l:.0f}% / {a:.2f})" if a < 1 else f"hsl({h % 360:.0f} {s:.0f}% {l:.0f}%)"


def cover_hues(song_id: str, genre: str = "Folk") -> tuple[int, int]:
    """(base hue, accent hue) of a song's cover, 0..359. The app tints the player with the base hue."""
    r = _rng(song_id)
    base = HUE_BY_GENRE.get(genre, 200) + (r() - 0.5) * 24
    accent = base + 150 + (r() - 0.5) * 60
    return int(base) % 360, int(accent) % 360


def cover_svg(song_id: str, genre: str = "Folk", title: str = "", size: int = 600) -> str:
    from xml.sax.saxutils import quoteattr
    title = quoteattr(title)[1:-1]     # "&", "<" and quotes must not break the SVG
    r = _rng(song_id)
    base = HUE_BY_GENRE.get(genre, 200) + (r() - 0.5) * 24
    accent = base + 150 + (r() - 0.5) * 60
    S = size
    g = f'<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{hsl(base, 48, 20)}"/><stop offset="1" stop-color="{hsl(base + 24, 42, 12)}"/></linearGradient>'
    shapes = []
    n = 3 + int(r() * 2)
    for k in range(n):
        cx, cy = S * (0.15 + r() * 0.7), S * (0.15 + r() * 0.7)
        rad = S * (0.22 + r() * 0.32)
        hue = base + (r() - 0.5) * 40 if k % 2 == 0 else accent
        light = 55 + r() * 20
        shapes.append(
            f'<radialGradient id="r{k}" cx="{cx:.0f}" cy="{cy:.0f}" r="{rad:.0f}" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" stop-color="{hsl(hue, 70, light, 0.95)}"/><stop offset="0.55" stop-color="{hsl(hue, 70, light, 0.55)}"/>'
            f'<stop offset="1" stop-color="{hsl(hue, 70, light, 0)}"/></radialGradient>'
            f'<circle cx="{cx:.0f}" cy="{cy:.0f}" r="{rad:.0f}" fill="url(#r{k})"/>'
        )
    # one deliberate line: an arc, the "melody" motif shared by every cover
    y0 = S * (0.35 + r() * 0.35)
    amp = S * (0.06 + r() * 0.1)
    freq = 1 + int(r() * 2)
    pts = []
    for i in range(0, 41):
        x = S * i / 40
        y = y0 + math.sin((i / 40) * math.pi * 2 * freq + r() * 0.3) * amp
        pts.append(f"{x:.0f},{y:.0f}")
    line = f'<polyline points="{" ".join(pts)}" fill="none" stroke="{hsl(accent, 60, 88, 0.85)}" stroke-width="{S * 0.012:.1f}" stroke-linecap="round" stroke-linejoin="round"/>'
    grain = ('<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>'
             '<feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 0.12"/></feComponentTransfer></filter>')
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}" role="img" aria-label="{title}">'
        f'<defs>{g}{grain}{"".join(s for s in shapes if s.startswith("<radialGradient"))}</defs>'
        f'<rect width="{S}" height="{S}" fill="url(#g)"/>'
        f'{"".join(s[s.index("</radialGradient>") + len("</radialGradient>"):] for s in shapes)}'
        f'{line}<rect width="{S}" height="{S}" filter="url(#n)" opacity="0.6"/></svg>'
    )
