"""Author the six placeholder city PBR sets (albedo / normal / orm, 512^2, tileable).

Everything in public/textures/ except asphalt, kerb_stone and brick_red was the
library's generic dot generator: a flat field of dots at a desaturated mean
(concrete_precast measured (129,129,127), timber_bare (98,86,71)). That is why
the city reads chalky and plastic -- no joints, no grain, no wear, so nothing
tells you how big a wall is or how old it is.

Same recipe as tools/asphalt-textures.py (numpy + PIL, seeded tileable value
noise, albedo stored sRGB from a believable LINEAR base). Each set is seeded on
its own so editing one does not reshuffle the others.

  python3 tools/city-textures.py

METRES PER TILE -- 512 px covers:

  concrete_precast  2.4 m   (artBuildings LIBRARY 2.4; joints on a 1.2 m grid)
  concrete_cast     2.0 m   (library.json tile 2; 150 mm shutter boards)
  plaster_worn      2.0 m   (artBuildings LIBRARY 2.0)
  metal_painted     1.0 m   (artBuildings LIBRARY 1.0; one sheet per tile)
  timber_bare       1.0 m   (artBuildings LIBRARY 1.0; seven 140 mm boards)
  pavement_slab     2.4 m   (districtWorld writes pavement UVs in units of
                             2.4 m -- #streetFurniture walkUv and roundedSlab;
                             4 x 4 slabs of 600 mm land exactly on the tile)

NOTE: library.json still says pavement_slab tile 1.8 for kit assets, which now
disagrees with the authored slab size. Set it to 2.4 when convenient; nothing
in the district streams the pavement through the catalogue today.

The albedo of each set is neutral-ish on purpose: artBuildings materials carry
vertexColors, so the map is MULTIPLIED by a per-building tint. A strongly
coloured map would fight it (brick is the deliberate exception).
"""
import numpy as np
from PIL import Image

N = 512
OUT = 'public/textures'
ys = np.arange(N)[:, None] * np.ones((1, N))          # row  (v, downward on a wall: three flips Y)
xs = np.ones((N, 1)) * np.arange(N)[None, :]          # col  (u)


def tile_noise(rng, freq, octaves=1):
    """Tileable value noise: random grid of `freq` cells, bilinear, wrapped."""
    out = np.zeros((N, N))
    amp = 1.0
    for o in range(octaves):
        f = freq * (2 ** o)
        g = rng.random((f, f))
        t = np.linspace(0, f, N, endpoint=False)
        y0 = np.floor(t).astype(int); x0 = y0
        fy = (t - y0)[:, None]; fx = (t - x0)[None, :]
        fy = fy * fy * (3 - 2 * fy); fx = fx * fx * (3 - 2 * fx)
        y1 = (y0 + 1) % f; x1 = (x0 + 1) % f
        a = g[y0][:, x0]; b = g[y0][:, x1]; c = g[y1][:, x0]; d = g[y1][:, x1]
        out += amp * ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy)
        amp *= 0.5
    return out


def blur(a, r):
    """Wrapped separable box blur -- the cheap cavity/AO source."""
    o = np.zeros_like(a)
    for d in range(-r, r + 1):
        o += np.roll(a, d, 0)
    o /= 2 * r + 1
    b = np.zeros_like(o)
    for d in range(-r, r + 1):
        b += np.roll(o, d, 1)
    return b / (2 * r + 1)


def smear(a, r):
    """Wrapped blur along v only -- drags noise into fibres that run with the grain."""
    o = np.zeros_like(a)
    for d in range(-r, r + 1):
        o += np.roll(a, d, 0)
    return o / (2 * r + 1)


def wrapd(a):
    """Signed wrapped delta in texels: -N/2 .. N/2."""
    return (a + N / 2) % N - N / 2


def blob(cx, cy, r, wobble=None, k=0.35):
    """Soft irregular disc, tileable. 1 at the centre, 0 outside."""
    d = np.hypot(wrapd(xs - cx), wrapd(ys - cy)) / r
    if wobble is not None:
        d = d + k * (wobble - 0.5)
    return np.clip(1 - d, 0, 1)


def streak(rng, y0, count, length, width):
    """`count` vertical runoff streaks starting at row y0 and fading downward."""
    m = np.zeros((N, N))
    for _ in range(count):
        cx = rng.random() * N
        w = width * (0.6 + rng.random())
        L = length * (0.5 + rng.random())
        prof = np.clip(1 - np.clip(ys - y0, 0, None) / L, 0, 1) ** 1.6
        prof = np.where(ys >= y0, prof, 0)
        m = np.maximum(m, prof * np.clip(1 - np.abs(wrapd(xs - cx)) / w, 0, 1) ** 0.7)
    return m


def scribble(rng, count, steps, step, wander, bias=None, pull=0.0, starts=None):
    """Random walks burnt into a mask -- cracks, splits, scratches. Wrapped.

    `bias` is a preferred heading in radians (0 = +u, pi/2 = +v, i.e. down the
    image) and `pull` how hard each step is dragged back to it: a split in
    timber runs WITH the grain, a scratch on a sheet runs along its arris, and
    both looked like worms before the bias existed.
    """
    m = np.zeros((N, N))
    for i in range(count):
        if starts is not None:
            x, y, a = starts[i % len(starts)]
            b = a if bias is None else bias    # a start on an edge biases ALONG that edge
        else:
            x, y = rng.random() * N, rng.random() * N
            b = bias
            a = rng.random() * 6.283 if bias is None else bias + (rng.random() - 0.5) * 0.5
        if rng.random() < 0.5 and b is not None:
            a += np.pi                                 # half run the other way
        for _ in range(steps):
            a += (rng.random() - 0.5) * wander
            if b is not None:
                tgt = b if abs(((a - b + np.pi) % 6.283) - np.pi) < np.pi / 2 else b + np.pi
                a += (tgt - a) * pull
            x = (x + np.cos(a) * step) % N
            y = (y + np.sin(a) * step) % N
            m[int(y), int(x)] = 1.0
    return m


def write(name, alb_lin, height, rough, ao=None, metal=None, nrm=1.0):
    """albedo (linear RGB -> sRGB), normal from wrapped height gradients, orm."""
    a = np.clip(alb_lin, 0, 1) ** (1 / 2.2)
    img = (a * 255).astype(np.uint8)
    Image.fromarray(img, 'RGB').save(f'{OUT}/{name}_albedo.png')

    h = (height - height.min()) / max(height.max() - height.min(), 1e-6)
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * nrm
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * nrm
    ln = np.sqrt(dx * dx + dy * dy + 1)
    Image.fromarray((((np.dstack([-dx / ln, dy / ln, 1 / ln]) * 0.5 + 0.5)) * 255).astype(np.uint8),
                    'RGB').save(f'{OUT}/{name}_normal.png')

    if ao is None:                      # cavity from the height itself: creases go dark
        ao = np.clip(0.55 + 0.55 * blur(h, 4), 0, 1)
    if metal is None:
        metal = np.zeros((N, N))
    Image.fromarray((np.dstack([np.clip(ao, 0, 1), np.clip(rough, 0.02, 1), np.clip(metal, 0, 1)]) * 255)
                    .astype(np.uint8), 'RGB').save(f'{OUT}/{name}_orm.png')
    print(f'{name:17s} 512^2  mean albedo {tuple(int(v) for v in img.reshape(-1, 3).mean(0))}'
          f'  linear {alb_lin.mean():.3f}')


# ---------------------------------------------------------------- concrete_precast (2.4 m)
# Panel joints on a 1.2 m grid = every 256 px; 16 mm joint ~ 3.4 px. Form ties
# in a 2 x 2 pattern per panel, chalky mottling, runoff below each horizontal joint.
def concrete_precast():
    rng = np.random.default_rng(11)
    P = N / 2                                          # 1.2 m panel
    jy = np.minimum(ys % P, P - (ys % P))
    jx = np.minimum(xs % P, P - (xs % P))
    joint = np.clip(np.minimum(jy, jx) / 3.4, 0, 1)    # 0 in the joint, 1 on the panel face
    chamfer = np.clip(np.minimum(jy, jx) / 9.0, 0, 1)  # panel arris, slightly rounded

    ties = np.zeros((N, N))
    for py in range(2):
        for px in range(2):
            for oy in (0.3, 0.72):
                for ox in (0.3, 0.72):
                    ties = np.maximum(ties, blob((px + ox) * P, (py + oy) * P, 5.5))
    tie_rust = np.clip(ties * 1.4 - 0.25, 0, 1)

    chalk = tile_noise(rng, 3, 4)                       # cement mottle
    fine = tile_noise(rng, 48, 2)
    grit = rng.random((N, N))
    run = np.maximum(streak(rng, 0, 7, 150, 9), streak(rng, P, 7, 150, 9))
    run = run * (0.5 + 0.9 * tile_noise(rng, 24, 1))    # streaks are not clean bands

    base = 0.255 + 0.070 * (chalk - 0.5) + 0.03 * (fine - 0.5) + 0.012 * (grit - 0.5)
    base = base * (1 - 0.42 * run) * (1 - 0.30 * (1 - joint))    # dark joint, dark runoff
    base = base * (1 - 0.38 * ties)
    r = base * 1.00; g = base * 0.995; b = base * 0.975
    r = r + tie_rust * 0.055; g = g + tie_rust * 0.022; b = b + tie_rust * 0.006

    h = 0.62 * chamfer + 0.10 * chalk + 0.06 * fine + 0.03 * grit - 0.22 * ties
    rough = np.clip(0.80 + 0.10 * (1 - joint) + 0.10 * run + 0.05 * (chalk - 0.5), 0, 1)
    ao = np.clip(0.40 + 0.62 * blur(chamfer, 3) - 0.25 * ties - 0.12 * run, 0, 1)
    write('concrete_precast', np.dstack([r, g, b]), h, rough, ao, nrm=2.2)


# ---------------------------------------------------------------- concrete_cast (2.0 m)
# In-situ concrete off 150 mm shutter boards = 38.4 px courses, each board its
# own tone; honeycomb (blowhole) patches where the pour did not compact; damp
# staining low down and under the board seams.
def concrete_cast():
    rng = np.random.default_rng(23)
    BH = N / 13.0                                      # 13 boards ~ 154 mm each
    row = np.floor(ys / BH).astype(int)
    seam = np.clip(np.minimum(ys % BH, BH - (ys % BH)) / 2.2, 0, 1)
    t = np.sin(row * 41.7 + 3.1) * 43758.5453
    tone = t - np.floor(t)                             # per-board tone
    cup = np.sin((ys % BH) / BH * np.pi) * 0.35        # each board bows a little

    wood = tile_noise(rng, 8, 1)                       # timber grain printed into the face
    mottle = tile_noise(rng, 4, 3)
    fine = rng.random((N, N))

    honey = np.zeros((N, N))
    wob = tile_noise(rng, 10, 2)
    for _ in range(4):
        honey = np.maximum(honey, blob(rng.random() * N, rng.random() * N, 22 + rng.random() * 26, wob, 0.7))
    pits = (rng.random((N, N)) > 0.84) * honey         # the blowholes themselves

    damp = tile_noise(rng, 3, 2)
    damp = np.clip(damp - 0.50, 0, 1) * 2.2
    damp = np.maximum(damp, streak(rng, N * 0.5, 5, 120, 13) * 0.8)
    # a 3-cell noise threshold is a DISC, and the tile is 2 m: it printed one
    # 12 cm blot every 2 m down a warehouse wall (measured: a 32 px block at 37%
    # of the tile mean). Break its edge on the mottle, the way the precast
    # runoff does, so it reads as a stain rather than a spot.
    damp = damp * (0.45 + 0.95 * tile_noise(rng, 20, 2))

    base = 0.275 + 0.085 * (tone - 0.5) + 0.055 * (mottle - 0.5) + 0.015 * (wood - 0.5) + 0.012 * (fine - 0.5)
    # the honeycomb patch is a DISC and the tile is 2 m: at 0.30/0.10 it printed a
    # dark spot every 2 m across a warehouse wall. Halved -- it reads as blowholes
    # in the pour, not as a stain.
    base = base * (1 - 0.30 * (1 - seam)) * (1 - 0.34 * damp) * (1 - 0.16 * pits) * (1 - 0.05 * honey)
    r = base * 1.00; g = base * 1.00; b = base * 0.985 + 0.004 * damp

    h = 0.45 * seam + cup * 0.25 + 0.10 * wood + 0.05 * fine - 0.45 * pits - 0.08 * honey
    rough = np.clip(0.82 + 0.10 * honey + 0.06 * damp + 0.05 * (mottle - 0.5) - 0.06 * seam, 0, 1)
    ao = np.clip(0.45 + 0.58 * blur(np.clip(h, 0, None), 3) - 0.35 * pits - 0.12 * honey, 0, 1)
    write('concrete_cast', np.dstack([r, g, b]), h, rough, ao, nrm=2.0)


# ---------------------------------------------------------------- plaster_worn (2.0 m)
# Cement render: trowel float texture, hairline crazing, two patched repairs in
# a slightly different tone, and one blown area where the render has spalled off
# and the brick behind shows through.
def plaster_worn():
    rng = np.random.default_rng(37)
    float_tex = tile_noise(rng, 12, 3)
    swirl = tile_noise(rng, 5, 2)
    fine = rng.random((N, N))

    # Crazing is HAIRLINE and local. 190 steps of 3.4 px ran 646 px -- longer
    # than the tile, so every crack crossed the whole wall and the 2 m tile read
    # as dried mud. A step under ~2 px also keeps the walk a line, not a dotted one.
    cracks = scribble(rng, 9, 55, 1.6, 0.30)           # crazing is nearly straight, not curly
    cracks = np.maximum(cracks, scribble(rng, 14, 16, 1.5, 0.45))   # short branches off it
    cracks = np.clip(blur(cracks, 1) * 2.2, 0, 1)

    # patched repairs: two rectangles, slightly greyer and smoother than the wall
    patch = np.zeros((N, N))
    for _ in range(2):
        px, py = rng.random() * N, rng.random() * N
        pw, ph = 70 + rng.random() * 90, 55 + rng.random() * 70
        m = (np.abs(wrapd(xs - px)) < pw / 2) & (np.abs(wrapd(ys - py)) < ph / 2)
        patch = np.maximum(patch, m * 1.0)
    patch = np.clip(blur(patch, 2) * 1.6, 0, 1)

    # spalled area: render gone, brick beneath (running bond at this 2.0 m scale)
    wob = tile_noise(rng, 9, 2)
    # ONE spall, and a small one. At 2 m per tile a 96 px blob is a 0.4 m disc of
    # fresh brick repeating every 2 m across every rendered wall in the city --
    # it read as a pink sticker, which is exactly what the play-test asked about.
    spall = blob(N * 0.68, N * 0.30, 46, wob, 1.1)
    spall_m = np.clip(spall * 3.0 - 0.75, 0, 1)        # hard-ish edge, feathered

    BW, BHt, J = 57.6, 19.2, 2.2                       # 225 x 75 mm at 2.0 m per tile
    brow = np.floor(ys / BHt).astype(int)
    off = (brow % 2) * (BW / 2)
    bcol = np.floor((xs + off) / BW).astype(int)
    inY = np.minimum(ys - brow * BHt, (brow + 1) * BHt - ys)
    inX = np.minimum((xs + off) - bcol * BW, (bcol + 1) * BW - (xs + off))
    mortar = np.clip(np.minimum(inY, inX) / (J / 2), 0, 1)
    bt = np.sin(brow * 12.9898 + bcol * 78.233) * 43758.5453
    bt = bt - np.floor(bt)
    bface = 0.21 + 0.07 * (bt - 0.5)
    # brick under a blown render is dusty and half-covered in the render's own
    # skim, not a fresh red face: pull the hue back toward the wall
    br = bface * 0.92; bg = bface * 0.66; bb = bface * 0.58
    mj = 0.24
    br = br * mortar + mj * (1 - mortar); bg = bg * mortar + mj * 0.97 * (1 - mortar); bb = bb * mortar + mj * 0.93 * (1 - mortar)

    grime = tile_noise(rng, 3, 2)
    base = 0.345 + 0.075 * (swirl - 0.5) + 0.045 * (float_tex - 0.5) + 0.012 * (fine - 0.5)
    base = base * (1 - 0.28 * grime * grime) * (1 - 0.45 * cracks)
    base = base + patch * (0.055 - 0.10 * (swirl - 0.5))     # the repair never matches
    r = base * 1.00; g = base * 0.985; b = base * 0.945

    r = r * (1 - spall_m) + br * spall_m
    g = g * (1 - spall_m) + bg * spall_m
    b = b * (1 - spall_m) + bb * spall_m

    h = (0.55 + 0.18 * float_tex + 0.10 * swirl + 0.04 * fine + 0.05 * patch) * (1 - spall_m) \
        + spall_m * (0.18 + 0.16 * mortar) - 0.30 * cracks
    rough = np.clip(0.88 + 0.06 * (float_tex - 0.5) - 0.10 * patch + 0.04 * grime, 0, 1)
    rough = rough * (1 - spall_m) + spall_m * 0.93
    ao = np.clip(0.55 + 0.50 * blur(h, 4) - 0.35 * cracks - 0.25 * spall_m, 0, 1)
    write('plaster_worn', np.dstack([r, g, b]), h, rough, ao, nrm=2.4)


# ---------------------------------------------------------------- metal_painted (1.0 m)
# One rolled sheet per tile: a returned edge all round, faint orange-peel in the
# paint, four fixings with rust blooms running down from them, and scratches to
# bare metal along the arrises.
def metal_painted():
    rng = np.random.default_rng(53)
    edge = np.minimum(np.minimum(xs, N - 1 - xs), np.minimum(ys, N - 1 - ys))
    rib = np.clip(edge / 9.0, 0, 1)                    # the sheet's folded return
    peel = tile_noise(rng, 40, 2)                      # orange-peel in the paint film
    roll = tile_noise(rng, 6, 1)                       # faint rolling direction
    fine = rng.random((N, N))

    fix = np.zeros((N, N))
    for fy in (0.12, 0.88):
        for fx in (0.12, 0.88):
            fix = np.maximum(fix, blob(fx * N, fy * N, 7.0))
    rust = np.zeros((N, N))
    wob = tile_noise(rng, 16, 2)
    for fy in (0.12, 0.88):
        for fx in (0.12, 0.88):
            rust = np.maximum(rust, blob(fx * N, fy * N, 40, wob, 0.9) ** 1.3)
            rust = np.maximum(rust, streak(rng, fy * N, 3, 130, 8) * 0.95 * blob(fx * N, fy * N, 150) ** 0.5)
    rust = np.clip(rust * 1.35, 0, 1)

    starts = []
    for _ in range(16):                                # along the four returned edges
        e = int(rng.integers(0, 4)); t = rng.random() * N; o = 3 + rng.random() * 22
        starts.append([(t, o, 0.0), (t, N - o, 0.0), (o, t, np.pi / 2), (N - o, t, np.pi / 2)][e])
    # pull=0 let a scratch that started on an arris wander across the whole face
    # as a bright, metalness-0.9 scribble. Each start already carries its edge's
    # heading; pull now drags the walk back to it, so scratches run ALONG the arris.
    scratch = scribble(rng, len(starts), 40, 2.6, 0.22, pull=0.35, starts=starts)
    scratch = np.maximum(scratch, scribble(rng, 6, 22, 3.0, 0.30))                # a few in the field
    scratch = np.clip(blur(scratch, 1) * 3.4, 0, 1)

    base = 0.265 + 0.035 * (roll - 0.5) + 0.02 * (peel - 0.5) + 0.008 * (fine - 0.5)
    base = base * (1 - 0.34 * (1 - rib))
    r = base * 0.96; g = base * 0.985; b = base * 1.00      # painted steel reads cool, not pink
    r = r * (1 - rust) + rust * (0.185 + 0.05 * (wob - 0.5))
    g = g * (1 - rust) + rust * (0.078 + 0.02 * (wob - 0.5))
    b = b * (1 - rust) + rust * (0.035)
    r = r * (1 - scratch) + scratch * 0.42; g = g * (1 - scratch) + scratch * 0.43; b = b * (1 - scratch) + scratch * 0.45

    h = 0.60 * rib + 0.10 * peel + 0.05 * roll - 0.15 * fix + 0.06 * rust
    rough = np.clip(0.42 + 0.06 * (peel - 0.5) + 0.45 * rust - 0.22 * scratch + 0.10 * (1 - rib), 0, 1)
    metal = np.clip(0.15 + 0.75 * scratch - 0.15 * rust, 0, 1)
    ao = np.clip(0.60 + 0.45 * blur(rib, 3) - 0.30 * fix - 0.10 * rust, 0, 1)
    write('metal_painted', np.dstack([r, g, b]), h, rough, ao, metal, nrm=2.6)


# ---------------------------------------------------------------- timber_bare (1.0 m)
# Seven sawn 140 mm boards per metre, run vertically (hoardings, fences, cladding):
# straight grain stretched along the board, knots with rings, split ends and
# checks along the grain, grey silvered weathering strongest at the edges.
def timber_bare():
    rng = np.random.default_rng(71)
    BWd = N / 7.0                                      # 7 boards -> 143 mm
    col = np.floor(xs / BWd).astype(int)
    gap = np.clip(np.minimum(xs % BWd, BWd - (xs % BWd)) / 2.5, 0, 1)
    t = np.sin(col * 27.3 + 1.7) * 43758.5453
    tone = t - np.floor(t)

    # grain: high frequency across the board, low along it
    g1 = tile_noise(rng, 64, 2)
    g2 = tile_noise(rng, 6, 2)
    grain = 0.5 + 0.5 * np.sin((xs * 0.85 + g2 * 9 + col * 13) * 0.9)   # straight sawn grain
    fibre = smear(rng.random((N, N)), 26)                               # long fibres up the board
    fibre = (fibre - fibre.min()) / (fibre.max() - fibre.min())
    grain = 0.40 * grain + 0.25 * g1 + 0.35 * fibre

    knots = np.zeros((N, N)); rings = np.zeros((N, N))
    for _ in range(5):
        kx = (rng.integers(0, 7) + 0.5) * BWd + (rng.random() - 0.5) * BWd * 0.4
        ky = rng.random() * N
        rr = np.hypot(wrapd(xs - kx) * 1.9, wrapd(ys - ky))
        knots = np.maximum(knots, np.clip(1 - rr / 11.0, 0, 1) ** 0.7)
        rings = np.maximum(rings, np.clip(1 - rr / 34.0, 0, 1) * (0.5 + 0.5 * np.sin(rr * 0.85)))

    checks = scribble(rng, 11, 110, 2.6, 0.22, bias=np.pi / 2, pull=0.30)   # splits run WITH the grain
    checks = np.clip(blur(checks, 1) * 2.8, 0, 1)
    ends = np.clip(1 - np.abs(wrapd(ys - N * 0.5)) / 10.0, 0, 1) * (rng.random((N, N)) > 0.55)
    checks = np.maximum(checks, np.clip(blur(ends, 1) * 2.0, 0, 1) * 0.7)

    weather = tile_noise(rng, 4, 3)                    # silvering
    silver = np.clip(0.35 + 0.85 * weather - 0.45 * gap, 0, 1)

    base = 0.125 + 0.040 * (tone - 0.5) + 0.055 * (grain - 0.5) + 0.030 * rings
    base = base * (1 - 0.62 * knots) * (1 - 0.45 * (1 - gap)) * (1 - 0.55 * checks)
    r = base * 1.00; g = base * 0.80; b = base * 0.60
    grey = base * (1.30)
    r = r * (1 - 0.55 * silver) + grey * 0.55 * silver
    g = g * (1 - 0.55 * silver) + grey * 0.53 * silver
    b = b * (1 - 0.55 * silver) + grey * 0.50 * silver

    h = 0.50 * gap + 0.30 * grain + 0.08 * rings - 0.32 * knots - 0.45 * checks
    rough = np.clip(0.88 + 0.08 * (1 - silver) * 0 + 0.06 * (grain - 0.5) + 0.05 * silver - 0.20 * knots, 0, 1)
    ao = np.clip(0.52 + 0.55 * blur(np.clip(h, 0, None), 3) - 0.30 * checks - 0.20 * knots, 0, 1)
    write('timber_bare', np.dstack([r, g, b]), h, rough, ao, nrm=2.4)


# ---------------------------------------------------------------- pavement_slab (2.4 m)
# 4 x 4 slabs of 600 mm. Dark 8 mm joints with sand and weed dirt, chipped
# corners, grime toward the joints, and one slab replaced by a tarmac patch --
# the reinstatement after a service dig, which is what a real pavement looks like.
def pavement_slab():
    rng = np.random.default_rng(89)
    S = N / 4.0                                        # 600 mm slab = 128 px
    sr = np.floor(ys / S).astype(int); sc = np.floor(xs / S).astype(int)
    jy = np.minimum(ys % S, S - (ys % S)); jx = np.minimum(xs % S, S - (xs % S))
    d = np.minimum(jy, jx)
    joint = np.clip(d / 1.8, 0, 1)                     # 8 mm joint
    arris = np.clip(d / 6.0, 0, 1)                     # slabs are slightly dished at the edge

    t = np.sin(sr * 12.9898 + sc * 78.233) * 43758.5453
    tone = t - np.floor(t)
    grit = rng.random((N, N))
    mott = tile_noise(rng, 24, 2)
    stain = tile_noise(rng, 4, 3)

    # chipped corners: a bite out of a few slab corners
    chip = np.zeros((N, N))
    wob = tile_noise(rng, 20, 2)
    for _ in range(7):
        cx = rng.integers(0, 5) * S; cy = rng.integers(0, 5) * S
        chip = np.maximum(chip, blob(cx, cy, 9 + rng.random() * 9, wob, 1.0))
    chip = np.clip(chip * 1.6 - 0.2, 0, 1)

    # NO tarmac reinstatement in the tile. It is the one feature on this map you
    # can name at a glance, and the tile is 2.4 m: it drew a dark square every
    # 2.4 m along every pavement in the city. A reinstatement is a one-off, so it
    # belongs in world/decals.js (KIND.PATCH) where it is placed, not repeated.
    # The per-slab tone, the chips, the joints and the stain carry the wear.
    patch = np.zeros((N, N))

    base = 0.245 + 0.060 * (tone - 0.5) + 0.03 * (mott - 0.5) + 0.012 * (grit - 0.5)
    base = base * (1 - 0.30 * stain) * (1 - 0.45 * (1 - joint)) * (1 - 0.45 * chip)
    r = base * 1.00; g = base * 0.995; b = base * 0.975

    h = 0.55 * arris + 0.10 * mott + 0.05 * grit - 0.40 * chip - 0.18 * patch
    rough = np.clip(0.86 + 0.08 * (1 - joint) + 0.06 * stain + 0.05 * chip, 0, 1)
    rough = rough * (1 - patch) + patch * 0.90
    ao = np.clip(0.42 + 0.62 * blur(arris, 3) - 0.30 * chip - 0.10 * stain, 0, 1)
    write('pavement_slab', np.dstack([r, g, b]), h, rough, ao, nrm=2.2)


def plastic_signage():
    """Printed advertising panel: the billboards, fascia boards and projecting
    signs all bind this. It shipped as a FLAT mid-grey (146-150 across the whole
    image), so a billboard in sun blew out to a white slab -- the one thing you
    could see from a street away in the Old Quarter. A sign is printed artwork,
    so give it artwork: bold colour fields, a light band where the paper is
    pasted, ink fade, a torn corner and the grime a board collects."""
    rng = np.random.default_rng(71)
    base = np.zeros((N, N, 3))
    # four colour fields, the way a poster is composed: a ground, a band, a block
    fields = [(0.62, 0.14, 0.12), (0.88, 0.72, 0.18), (0.10, 0.24, 0.46), (0.86, 0.84, 0.78)]
    ground = fields[0]
    base[:, :] = ground
    band0, band1 = int(N * 0.34), int(N * 0.56)
    base[band0:band1, :] = fields[3]                       # the white band the type sits on
    base[int(N * 0.60):int(N * 0.74), int(N * 0.08):int(N * 0.52)] = fields[2]
    base[int(N * 0.10):int(N * 0.26), int(N * 0.44):int(N * 0.92)] = fields[1]
    # type: dark bars on the white band, at two sizes, so it reads as words at 40 km/h
    for (y0, h0, x0, x1, n) in [(band0 + 14, 26, 24, N - 24, 7), (band0 + 62, 12, 24, int(N * 0.7), 9)]:
        edges = np.sort(rng.choice(np.arange(x0, x1), size=n * 2, replace=False))
        for i in range(0, len(edges) - 1, 2):
            base[y0:y0 + h0, edges[i]:edges[i + 1]] = (0.06, 0.06, 0.07)
    # ink fade and print mottle
    fade = tile_noise(rng, 3, 2)
    base *= (0.88 + 0.22 * fade)[:, :, None]
    # paste seams: two vertical joins where the sheets meet, slightly lighter
    for x in (int(N * 0.33), int(N * 0.67)):
        base[:, x - 1:x + 1] *= 1.08
    # a torn corner showing the board behind, and grime down the bottom edge
    tear = blob(N * 0.93, N * 0.06, N * 0.09, k=0.5)
    base = base * (1 - tear[:, :, None]) + np.array((0.30, 0.28, 0.26)) * tear[:, :, None]
    grime = np.clip((ys / N - 0.72) / 0.28, 0, 1) * (0.35 + 0.3 * tile_noise(rng, 6, 1))
    base *= (1 - 0.45 * grime)[:, :, None]
    height = 0.5 + 0.25 * fade - 0.5 * tear                 # nearly flat; the tear has an edge
    rough = np.clip(0.42 + 0.30 * grime + 0.25 * tear, 0, 1)  # printed vinyl is smooth, grime is not
    write('plastic_signage', base, height, rough, nrm=0.6)
    print('plastic_signage', tuple(int(v * 255) for v in (np.clip(base, 0, 1) ** (1 / 2.2)).reshape(-1, 3).mean(0)))


if __name__ == '__main__':
    concrete_precast()
    concrete_cast()
    plaster_worn()
    metal_painted()
    timber_bare()
    pavement_slab()
    plastic_signage()
