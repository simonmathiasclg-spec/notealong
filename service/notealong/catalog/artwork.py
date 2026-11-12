"""Cover art that feels photographed: light through leaves, low sun in a corridor, a red sun over a dune,
out-of-focus city lights, a backlit curtain, pool caustics, dusk haze. Everything is drawn from a seed (no
photos), toned with a film-like gradient map, then given a light leak, halation, vignette and film grain.

`render_cover(song_id, genre)` returns a PIL image; `cover_colors(image)` the three colours the app uses for a
song's surfaces (deep, mid, glow). One cover takes about a quarter of a second."""
from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter

N = 480            # working size; the cover is drawn here and enlarged before the grain goes on
OUT = 960          # saved size (square)


# ---- palettes: gradient maps from shadow to light, like a toned film print ------------------------------------
@dataclass(frozen=True)
class Palette:
    name: str
    stops: tuple[tuple[float, str], ...]
    leak: str          # colour of the light leak and halation
    scenes: tuple[str, ...]


PALETTES: dict[str, Palette] = {p.name: p for p in [
    Palette("fern", ((0, "#060b05"), (.3, "#14290f"), (.58, "#3d6a1f"), (.82, "#97b83a"), (1, "#e6ef9a")), "#f2c96b", ("foliage", "foliage", "haze")),
    Palette("ember", ((0, "#0b0302"), (.32, "#3a0d04"), (.6, "#a3330b"), (.84, "#ef7a24"), (1, "#ffd08a")), "#ff7a2e", ("beams", "beams", "sun")),
    Palette("amber", ((0, "#0d0703"), (.3, "#3a1d07"), (.6, "#a5600f"), (.85, "#f0b13d"), (1, "#fff0b8")), "#ffb347", ("beams", "haze", "foliage")),
    Palette("crimson", ((0, "#0c0202"), (.35, "#4a0806"), (.62, "#b8180f"), (.85, "#f04a2b"), (1, "#ffb08a")), "#ff5a36", ("sun", "sun", "bokeh")),
    Palette("tide", ((0, "#02080b"), (.32, "#062a33"), (.6, "#0f6a72"), (.84, "#4cc1b4"), (1, "#d8fff0")), "#7fe0d0", ("water", "water", "bokeh")),
    Palette("plum", ((0, "#08030a"), (.32, "#2a0a2f"), (.6, "#6d1f63"), (.84, "#d1588f"), (1, "#ffc3d6")), "#ff7aa8", ("bokeh", "sheer", "bokeh")),
    Palette("ochre", ((0, "#0a0803"), (.3, "#2b240a"), (.6, "#7a6a1c"), (.84, "#c9b44a"), (1, "#f6eab0")), "#f5c35a", ("haze", "foliage", "sheer")),
    Palette("ink", ((0, "#020309"), (.32, "#0a1338"), (.6, "#23408e"), (.84, "#6f96e0"), (1, "#e2ecff")), "#9db8ff", ("bokeh", "water", "sheer")),
    Palette("rose", ((0, "#0c0606"), (.32, "#3a1a1a"), (.6, "#94504a"), (.84, "#e0a08a"), (1, "#fff0e2")), "#ffb08a", ("sheer", "haze", "sheer")),
    Palette("smoke", ((0, "#070605"), (.32, "#24201c"), (.6, "#5f5850"), (.84, "#b3aa9c"), (1, "#f5efe4")), "#e8c9a0", ("sheer", "beams", "haze")),
]}

# a genre leans towards a few palettes so the shelf stays varied but each corner of it has a mood
GENRE_PALETTES = {
    "Children's": ("amber", "fern", "ochre"), "Celebration": ("ember", "amber", "crimson"), "Christmas": ("crimson", "fern", "amber"),
    "Hymn": ("ink", "smoke", "amber"), "Spiritual": ("plum", "ink", "ember"), "Folk": ("fern", "ochre", "smoke", "amber"),
    "Classical": ("ink", "smoke", "rose"), "Latin": ("ember", "crimson", "amber"), "Lullaby": ("plum", "ink", "rose"),
    "Pop": ("plum", "crimson", "tide", "rose"), "Rock": ("crimson", "smoke", "ember"), "Indie": ("tide", "fern", "rose", "ochre"),
    "Jazz": ("amber", "ink", "ember"), "Gospel": ("amber", "plum"), "Country": ("ochre", "amber", "fern"), "Reggae": ("fern", "amber"),
    "Electronic": ("ink", "tide", "plum"), "Hip-Hop": ("crimson", "plum", "smoke"), "RNB": ("plum", "rose", "ember"),
    "Blues": ("ink", "tide", "smoke"), "Metal": ("smoke", "crimson"), "Patriotic": ("ink", "crimson", "smoke"),
    "Sea shanty": ("tide", "ink", "smoke"), "Lied": ("rose", "smoke", "ink"), "Parlour": ("rose", "amber", "smoke"),
}


class Rng:
    def __init__(self, seed: str) -> None:
        self.g = np.random.default_rng(int.from_bytes(hashlib.sha256(seed.encode()).digest()[:8], "big"))

    def u(self, a: float = 0.0, b: float = 1.0) -> float:
        return float(self.g.uniform(a, b))

    def pick(self, seq):
        return seq[int(self.g.integers(len(seq)))]


def _hex(c: str) -> np.ndarray:
    c = c.lstrip("#")
    return np.array([int(c[i:i + 2], 16) / 255 for i in (0, 2, 4)], dtype=np.float32)


def _gradient_map(L: np.ndarray, stops) -> np.ndarray:
    xs = np.array([s[0] for s in stops], dtype=np.float32)
    cols = np.stack([_hex(s[1]) for s in stops])
    out = np.empty(L.shape + (3,), dtype=np.float32)
    for k in range(3):
        out[..., k] = np.interp(L, xs, cols[:, k])
    return out


def _norm(a: np.ndarray) -> np.ndarray:
    lo, hi = float(a.min()), float(a.max())
    return (a - lo) / (hi - lo + 1e-6)


def _field(r: Rng, sigma: float) -> np.ndarray:
    """Smooth random field 0..1 (clouds of light and shade)."""
    return _norm(gaussian_filter(r.g.standard_normal((N, N)).astype(np.float32), sigma, mode="wrap"))


def _grid():
    y, x = np.mgrid[0:N, 0:N].astype(np.float32) / N
    return x, y


def _draw(shapes, blur: float, size: int = N) -> np.ndarray:
    """Draw (polygon, value) pairs on a black canvas and soften them."""
    im = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(im)
    for poly, v in shapes:
        d.polygon(poly, fill=int(max(0, min(1, v)) * 255))
    a = np.asarray(im, dtype=np.float32) / 255
    return gaussian_filter(a, blur) if blur > 0 else a


def _leaf(cx, cy, length, width, angle):
    pts = []
    for i in range(24):
        t = i / 24 * 2 * math.pi
        # a leaf: an ellipse pinched at both ends
        px, py = math.cos(t) * length, math.sin(t) * width * (1 - 0.35 * abs(math.cos(t)))
        pts.append((cx + px * math.cos(angle) - py * math.sin(angle), cy + px * math.sin(angle) + py * math.cos(angle)))
    return pts


# ---- scenes: each returns a light field 0..1 ------------------------------------------------------------------
def scene_foliage(r: Rng) -> np.ndarray:
    """Backlit leaves on a few branches, photographed out of focus, against darker foliage behind."""
    x, y = _grid()
    sx, sy = r.u(0.25, 0.75), r.u(0.2, 0.6)                     # where the sun comes through
    base = 0.16 + 0.16 * _field(r, 80) + 0.2 * np.exp(-((x - sx) ** 2 + (y - sy) ** 2) / 0.2)
    lit, near = [], []
    for _ in range(int(r.u(3, 5))):                               # branches crossing the frame
        bx, by = r.u(0.05, 0.95), r.u(0.05, 0.95)
        ang = math.atan2(0.5 - by, 0.5 - bx) + r.u(-1.2, 1.2)      # mostly into the frame
        step = r.u(0.05, 0.09)
        for k in range(int(r.u(6, 11))):
            px = (bx + math.cos(ang) * step * k) * N
            py = (by + math.sin(ang) * step * k) * N
            side = 1 if k % 2 else -1
            la = ang + side * r.u(0.4, 0.9)
            ln, wd = r.u(26, 58), r.u(12, 24)
            cx, cy = px + math.cos(la) * ln * 0.9, py + math.sin(la) * ln * 0.9
            d2 = ((cx / N - sx) ** 2 + (cy / N - sy) ** 2)
            lit.append((_leaf(cx, cy, ln, wd, la), float(np.clip(1.1 - d2 * 2.2, 0.25, 1.0)) * r.u(0.7, 1.0)))
    for _ in range(int(r.u(4, 8))):                               # very close leaves, dark and soft
        cx, cy = r.u(-0.1, 1.1) * N, r.u(-0.1, 1.1) * N
        near.append((_leaf(cx, cy, r.u(90, 160), r.u(35, 60), r.u(0, math.pi)), r.u(0.6, 1.0)))
    leaves = _draw(lit, r.u(4.5, 8))
    glow = gaussian_filter(leaves, 24)
    shade = _draw(near, r.u(16, 24))
    L = base + 0.72 * leaves * (0.75 + 0.35 * _field(r, 20)) + 0.35 * glow
    return np.clip(L * (1 - 0.55 * shade), 0, 1.2)


def scene_beams(r: Rng) -> np.ndarray:
    """Low sun through a window, its panes thrown across a wall and the floor of a dim room or corridor."""
    x, y = _grid()
    floor_y = r.u(0.55, 0.72)
    L = 0.07 + 0.1 * _field(r, 70) + 0.08 * gaussian_filter((y > floor_y).astype(np.float32), 6)
    fx = r.u(0.25, 0.75)                                           # a bright opening at the far end
    L += 0.3 * np.exp(-(((x - fx) / 0.1) ** 2 + ((y - floor_y + 0.12) / 0.2) ** 2))
    # the window: a skewed quad split into panes by its frame
    cx, cy = r.u(0.3, 0.7), r.u(0.45, 0.75)
    w, h = r.u(0.4, 0.7), r.u(0.3, 0.5)
    skew, slant = r.u(-0.9, 0.9), r.u(-0.35, 0.35)
    cols, rows = r.pick([(2, 2), (3, 2), (2, 3), (4, 2)])
    bar = r.u(0.012, 0.025)
    panes = []
    for i in range(cols):
        for j in range(rows):
            u0, u1 = i / cols + bar, (i + 1) / cols - bar
            v0, v1 = j / rows + bar, (j + 1) / rows - bar

            def P(u, v):
                px = cx + (u - 0.5) * w + (v - 0.5) * h * skew
                py = cy + (v - 0.5) * h + (u - 0.5) * w * slant
                return (px * N, py * N)
            panes.append(([P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)], r.u(0.75, 0.95)))
    sun = _draw(panes, r.u(4, 7))
    L += 0.55 * sun * (0.8 + 0.3 * _field(r, 16)) + 0.4 * gaussian_filter(sun, 26)                # and the glow it throws around itself
    # dust in the air: a soft shaft from the top corner towards the window light
    side = 0.0 if cx > 0.5 else 1.0
    shaft = _draw([([(side * N, -0.05 * N), ((side + (0.12 if side == 0 else -0.12)) * N, -0.05 * N),
                     ((cx + w / 2) * N, (cy + h / 2) * N), ((cx - w / 2) * N, (cy - h / 2) * N)], 1.0)], 18)
    L += 0.18 * shaft * (0.5 + 0.5 * _field(r, 12))
    return np.clip(L, 0, 1.2)


def scene_sun(r: Rng) -> np.ndarray:
    x, y = _grid()
    cx, cy, R = r.u(0.3, 0.7), r.u(0.3, 0.5), r.u(0.2, 0.34)
    d = np.sqrt((x - cx) ** 2 + (y - cy) ** 2)
    L = 0.14 + 0.12 * _field(r, 80) + 0.18 * (1 - y)
    disc = np.clip((R - d) / 0.008, 0, 1)
    L = L * (1 - disc) + disc * (0.68 + 0.1 * _field(r, 40))
    L += 0.32 * np.exp(-(d / (R * 1.35)) ** 2)
    bands = gaussian_filter(r.g.standard_normal((N, N)).astype(np.float32), (6, 120))
    L *= 1 - 0.18 * _norm(bands) * disc
    # a dark dune or a hill line in front of it: a smooth random profile
    h0 = r.u(0.64, 0.8)
    prof = gaussian_filter(r.g.standard_normal(N * 3).astype(np.float32), r.u(30, 60))[N:2 * N]
    prof = (prof - prof.mean()) / (np.abs(prof).max() + 1e-6)
    ridge = h0 + r.u(0.04, 0.09) * prof[None, :] + 0.05 * np.sin(x * math.pi * r.u(0.6, 1.4) + r.u(0, 6.28))
    ground = gaussian_filter((y > ridge).astype(np.float32), 1.5)
    return np.clip(L * (1 - 0.88 * ground) + 0.05 * ground * _field(r, 8), 0, 1.2)


def scene_bokeh(r: Rng) -> np.ndarray:
    x, y = _grid()
    L = 0.05 + 0.12 * _field(r, 90)
    acc = np.zeros((N, N), np.float32)
    band = r.u(0.35, 0.7)                                          # the lights sit along a street-like band
    for layer, (count, rad, blur) in enumerate([(14, (30, 70), 10), (32, (10, 30), 3), (30, (3, 9), 1.2)]):
        im = Image.new("L", (N, N), 0)
        dr = ImageDraw.Draw(im)
        for _ in range(count):
            cx, cy = r.u(-0.05, 1.05) * N, r.g.normal(band, 0.18 + 0.1 * layer) * N
            rr = r.u(*rad)
            dr.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=int(r.u(0.25, 1.0) * 255))
        acc += gaussian_filter(np.asarray(im, np.float32) / 255, blur) * (0.55 if layer == 0 else 0.8)
    return np.clip(L + acc, 0, 1.2)


def scene_sheer(r: Rng) -> np.ndarray:
    x, y = _grid()
    folds = np.zeros((N, N), np.float32)
    for _ in range(5):
        f, ph, sw = r.u(4, 16), r.u(0, 6.28), r.u(0.2, 1.2)
        folds += np.sin((x + 0.03 * np.sin(y * math.pi * sw * 2 + ph)) * math.pi * f + ph) / 5
    folds = _norm(folds)
    side = r.u(0.0, 1.0)
    window = np.exp(-((x - side) / r.u(0.25, 0.45)) ** 2)        # backlight from a window behind the curtain
    L = 0.1 + 0.55 * window * (0.55 + 0.45 * folds) + 0.12 * folds + 0.1 * _field(r, 50)
    L += 0.25 * np.exp(-(((x - side) / 0.1) ** 2 + ((y - r.u(0.2, 0.5)) / 0.25) ** 2))
    return np.clip(gaussian_filter(L, 2.5), 0, 1.2)


def scene_water(r: Rng) -> np.ndarray:
    """Light on the floor of a pool: bright threads that thicken where the waves cross, one layer in focus and one not."""
    x, y = _grid()

    def threads(scale: float, k: float) -> np.ndarray:
        wx = x + 0.05 * (_field(r, 28) - 0.5)
        wy = y + 0.05 * (_field(r, 28) - 0.5)
        c = np.zeros((N, N), np.float32)
        for _ in range(4):
            a, f, ph = r.u(0, math.pi), r.u(9, 18) * scale, r.u(0, 6.28)
            c += np.sin((wx * math.cos(a) + wy * math.sin(a)) * f + ph)
        return np.exp(-np.abs(c) * k)
    near = gaussian_filter(threads(1.0, r.u(2.2, 3.2)), 2.2) * (0.3 + 0.9 * _field(r, 35))
    far = gaussian_filter(threads(0.6, 2.0), 9)
    depth = 0.16 + 0.22 * (1 - y) + 0.14 * _field(r, 80)
    return np.clip(depth + 0.62 * near + 0.3 * far, 0, 1.2)


def scene_haze(r: Rng) -> np.ndarray:
    """Dusk over a field: a bright, hazy horizon behind tall grass that is out of focus."""
    x, y = _grid()
    hz = r.u(0.5, 0.66)
    sky = 0.2 + 0.5 * np.exp(-((y - hz) / 0.25) ** 2) + 0.12 * _field(r, 70)
    sx = r.u(0.2, 0.8)
    sky += 0.55 * np.exp(-(((x - sx) / 0.2) ** 2 + ((y - hz) / 0.13) ** 2))
    im = Image.new("L", (N, N), 0)
    d = ImageDraw.Draw(im)
    for _ in range(int(r.u(140, 220))):                           # grass blades, darker towards the bottom
        bx = r.u(-0.05, 1.05) * N
        top = (hz + r.g.normal(0.04, 0.06)) * N
        lean = r.u(-0.06, 0.06) * N
        width = r.u(1.2, 4.5)
        d.line([(bx, N * 1.02), (bx + lean * 0.5, (top + N) / 2), (bx + lean, top)], fill=int(r.u(150, 255)), width=int(width))
    blades = gaussian_filter(np.asarray(im, np.float32) / 255, r.u(2.5, 5))
    ground = gaussian_filter((y > hz + 0.12).astype(np.float32), 14)
    L = sky * (1 - 0.8 * np.clip(blades + 0.7 * ground, 0, 1))
    return np.clip(L, 0, 1.2)


SCENES = {"foliage": scene_foliage, "beams": scene_beams, "sun": scene_sun, "bokeh": scene_bokeh,
          "sheer": scene_sheer, "water": scene_water, "haze": scene_haze}


def choose(song_id: str, genre: str = "Folk") -> tuple[Palette, str]:
    r = Rng("pal:" + song_id)
    pal = PALETTES[r.pick(GENRE_PALETTES.get(genre, ("tide", "ember", "fern", "plum")))]
    return pal, r.pick(pal.scenes)


def render_cover(song_id: str, genre: str = "Folk", size: int = OUT, palette: str | None = None, scene: str | None = None) -> Image.Image:
    pal, sc = choose(song_id, genre)
    if palette:
        pal = PALETTES[palette]
    sc = scene or sc
    r = Rng(f"{sc}:{song_id}")
    L = SCENES[sc](r)
    L = np.clip(L, 0, 1.15) ** r.u(0.9, 1.15)
    img = _gradient_map(np.clip(L, 0, 1), pal.stops)
    x, y = _grid()
    leak = _hex(pal.leak)
    # light leak from one edge (film fogged at the end of a roll)
    ex, ey = r.pick([(0, r.u(0, 1)), (1, r.u(0, 1)), (r.u(0, 1), 0), (r.u(0, 1), 1)])
    fog = np.exp(-((x - ex) ** 2 + (y - ey) ** 2) / r.u(0.04, 0.12)) * r.u(0.35, 0.7)
    img = 1 - (1 - img) * (1 - fog[..., None] * leak)
    # halation: the brightest parts bleed a warm glow
    hot = gaussian_filter(np.clip(L - 0.72, 0, 1), 14)
    img = img + hot[..., None] * leak * 0.55
    # vignette
    v = 1 - 0.42 * (((x - 0.5) ** 2 + (y - 0.5) ** 2) / 0.5) ** 1.2
    img = np.clip(img * v[..., None], 0, 1)
    im = Image.fromarray((img * 255).astype(np.uint8)).resize((size, size), Image.Resampling.BICUBIC)
    # film grain at full size: monochrome, strongest in the mid-tones, very slightly soft
    a = np.asarray(im, np.float32) / 255
    lum = a.mean(axis=2, keepdims=True)
    g = gaussian_filter(r.g.standard_normal((size, size)).astype(np.float32), 0.55)[..., None]
    a = np.clip(a + g * 0.05 * (0.35 + lum * (1 - lum) * 2.6), 0, 1)
    return Image.fromarray((a * 255).astype(np.uint8))


def cover_colors(im: Image.Image) -> dict[str, str]:
    """deep: the shadows (backdrops and surfaces); mid: the body of the picture; glow: its light (the "now" colour
    is derived from it in the app)."""
    a = np.asarray(im.resize((96, 96)), np.float32).reshape(-1, 3)
    lum = a[:, 0] * 0.2126 + a[:, 1] * 0.7152 + a[:, 2] * 0.0722     # (not a @ w: Accelerate warns spuriously)
    order = np.argsort(lum)
    n = len(order)

    def mean(lo, hi):
        c = a[order[int(n * lo):int(n * hi)]].mean(axis=0)
        return "#" + "".join(f"{int(round(v)):02x}" for v in c)
    return {"deep": mean(0.05, 0.35), "mid": mean(0.45, 0.8), "glow": mean(0.94, 1.0)}


def save_cover(song_id: str, genre: str, path, size: int = OUT) -> dict[str, str]:
    im = render_cover(song_id, genre, size)
    im.save(path, "WEBP", quality=80, method=6)
    return cover_colors(im)
