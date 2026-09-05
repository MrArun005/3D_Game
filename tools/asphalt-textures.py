"""Regenerate the asphalt PBR set (albedo / normal / orm, 512^2, tileable).

The first set was the library's generic dot pattern: fine for brick and
render, but on a wet road every dot mirrored as a cobble. Real asphalt is a
fine grain with faint low-frequency patching and sparse pale aggregate --
almost no relief. Seeded, so the same texture every run.
  python3 tools/asphalt-textures.py
"""
import numpy as np
from PIL import Image

N = 512
rng = np.random.default_rng(7)

def tile_noise(freq, octaves=1):
    """Tileable value noise: random grid of `freq` cells, bilinear, wrapped."""
    out = np.zeros((N, N))
    amp = 1.0
    for o in range(octaves):
        f = freq * (2 ** o)
        g = rng.random((f, f))
        ys = np.linspace(0, f, N, endpoint=False); xs = ys
        y0 = np.floor(ys).astype(int); x0 = np.floor(xs).astype(int)
        fy = (ys - y0)[:, None]; fx = (xs - x0)[None, :]
        fy = fy * fy * (3 - 2 * fy); fx = fx * fx * (3 - 2 * fx)
        y1 = (y0 + 1) % f; x1 = (x0 + 1) % f
        a = g[y0][:, x0]; b = g[y0][:, x1]; c = g[y1][:, x0]; d = g[y1][:, x1]
        out += amp * ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy)
        amp *= 0.5
    return out

grain = rng.random((N, N))                     # per-texel aggregate grain
patch = tile_noise(4, 3)                       # low-frequency wear patches
mid = tile_noise(32, 2)                        # mid-frequency mottling
specks = (rng.random((N, N)) > 0.985)          # sparse pale stones

# height: mostly flat, grain-dominated, a little mottling; the specks stand proud
h = 0.55 * grain + 0.30 * mid + 0.15 * patch + specks * 0.6
h = (h - h.min()) / (h.max() - h.min())

# albedo: charcoal, lighter on the worn patches and where a stone shows
base = 0.075 + 0.03 * (patch - 0.5) + 0.02 * (mid - 0.5) + 0.03 * (grain - 0.5)   # ~0.07 linear: real asphalt albedo
base = base + specks * 0.18
alb = np.clip(base, 0, 1) ** (1 / 2.2)         # store sRGB
alb = np.dstack([alb, alb * 0.99, alb * 0.97])
Image.fromarray((alb * 255).astype(np.uint8), 'RGB').save('public/textures/asphalt_albedo.png')

# normal from height, wrapped gradients, low amplitude (asphalt is nearly flat)
amp = 0.9
dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * amp
dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * amp
nz = np.ones_like(h)
ln = np.sqrt(dx * dx + dy * dy + 1)
nrm = np.dstack([-dx / ln, dy / ln, nz / ln]) * 0.5 + 0.5
Image.fromarray((nrm * 255).astype(np.uint8), 'RGB').save('public/textures/asphalt_normal.png')

# orm: ao flat, roughness high with low-frequency variation, the stones a touch smoother, metal 0
rough = np.clip(0.84 + 0.08 * (patch - 0.5) + 0.04 * (grain - 0.5) - specks * 0.15, 0, 1)
orm = np.dstack([np.ones_like(h), rough, np.zeros_like(h)])
Image.fromarray((orm * 255).astype(np.uint8), 'RGB').save('public/textures/asphalt_orm.png')
print('asphalt set written')

# ---- kerb stone: the same dot placeholder, replaced by a granite -- pale grey, fine grain, faint mineral flecks, flat
kg = rng.random((N, N)); kp = tile_noise(6, 2); km = tile_noise(48, 1)
flecks = rng.random((N, N)) > 0.992
kh = 0.5 * kg + 0.3 * km + 0.2 * kp
kbase = 0.30 + 0.05 * (kp - 0.5) + 0.03 * (km - 0.5) + 0.04 * (kg - 0.5) - flecks * 0.12
kalb = np.clip(kbase, 0, 1) ** (1 / 2.2)
kalb = np.dstack([kalb, kalb, kalb * 0.98])
Image.fromarray((kalb * 255).astype(np.uint8), 'RGB').save('public/textures/kerb_stone_albedo.png')
kdx = (np.roll(kh, -1, 1) - np.roll(kh, 1, 1)) * 0.5; kdy = (np.roll(kh, -1, 0) - np.roll(kh, 1, 0)) * 0.5
kl = np.sqrt(kdx * kdx + kdy * kdy + 1)
knrm = np.dstack([-kdx / kl, kdy / kl, 1 / kl]) * 0.5 + 0.5
Image.fromarray((knrm * 255).astype(np.uint8), 'RGB').save('public/textures/kerb_stone_normal.png')
krough = np.clip(0.72 + 0.06 * (kp - 0.5) + 0.03 * (kg - 0.5), 0, 1)
Image.fromarray((np.dstack([np.ones_like(kh), krough, np.zeros_like(kh)]) * 255).astype(np.uint8), 'RGB').save('public/textures/kerb_stone_orm.png')
print('kerb set written')
