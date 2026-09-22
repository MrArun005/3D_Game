# How GTA gets its look — research notes and what they mean for Halstead Bay

Date: 2026-09-05. Sources (scraped, full text under `.firecrawl/`):
Adrian Courrèges "GTA V Graphics Study" parts 1–3 (RenderDoc captures of
the PC build), Simon Schreibt "GTA V – Underestimated Glow", Digital Foundry's
GTA 6 analyses (Extended Look, "how the visuals evolve over GTA 5 Enhanced",
the Ferris-wheel reflection piece), plus the HN / forum discussion threads.

## 1. GTA V frame, in order (PC, DX11, 2015)

| Pass | What GTA V does | Numbers |
| --- | --- | --- |
| Environment cubemap | Re-rendered EVERY frame from the low-LOD world only (no cars, no people), then folded into a dual-paraboloid map | 6 × 128×128 HDR, ~30 draws per face |
| Culling + LOD | Compute shader decides draw / LOD per object; whole districts exist as one ~2500-tri single-texture mesh | |
| G-buffer | Deferred, 5 MRTs, all RGBA8: diffuse (+stipple mask), normal, specular (intensity / gloss / fresnel, A = blurred shadow), irradiance (sun, 2nd light, **emissive in B**, skin/plant mask), reversed log depth + stencil IDs | ~1900 draws of 4155 total |
| LOD cross-fade | Screen-door stipple `(x+y)%2`, healed by a later smoothing pass | |
| Shadows | 4-cascade CSM in one atlas, dithered sampling, sun+cloud shadow resolved to screen, depth-aware blur, 1/8-res early-out for lit pixels | 1024×4096, ~1000 draws |
| Planar reflection | Scene upside-down, water and mirrors only | 240×120, ~650 draws |
| SSAO | Half-res, noisy, two depth-aware blur passes | |
| Lighting | One full-screen combine, then **each local light drawn one by one** as a deformed octahedron volume; pixel shader lights from depth + normal + gloss | HDR RGB16F |
| Skin | Screen-space SSS gated by stencil + mask | |
| Water | Planar reflection + half-res refraction (depth-tinted blue, caustics) + bump normals, Fresnel | |
| Atmosphere | Half-res ray-marched light-shaft map against the sun shadow map, then fog; sky = one dome draw with noise textures; clouds = horizon ring mesh | clouds 2048×512 |
| Transparents | Forward, heavy particle instancing | 11 draws |
| Exposure | Average luminance to 1×1 via compute, temporal adaptation (dark→bright faster than bright→dark) | 1/4-res input |
| Bloom | Bright pass with threshold **derived from exposure**, downsample+blur to 1/16, upsample to 1/2 | |
| Tone map | Hable / Uncharted 2 filmic, **per channel** (a pure red never burns white); sRGB in the same pass | |
| Lens | FXAA, then lens distortion with chromatic aberration; sun: 12 rotated streak quads + 70 flare sprites along sun→centre, scaled by aperture; anamorphic streak sprites on headlights facing the camera; DoF from a signed CoC map | |

## 2. The night look specifically

- **Glow is layered, not one effect.** Bloom is ordinary blur-and-add, but the
  emissive inputs are genuinely > 1.0. On top, every small light carries
  **two glare billboards** that counter-rotate (the shimmer) and shrink/grow
  with viewing angle. They are what keeps a distant street lamp visible;
  real volumetric cones (Watch Dogs) pop out at range.
- **White cores are painted into the texture**, not produced by the
  pipeline. The per-channel tone mapper keeps a saturated tube saturated.
- **Every distant light is a 32×32 sprite quad**, instanced by the tens of
  thousands, depth-tested. Distant headlights are two moving sprites on the
  road graph; the car streams in later.
- **Wet-road headlight and lamp reflections are NOT reflections.** The
  cubemap contains no cars. They are the **specular highlight of the
  deferred point/spot light on a high-gloss wet surface**. Two things are
  needed: low roughness when wet, and the light itself being a real light.
- Emissive lives in its own G-buffer channel, so bloom is fed by emissive
  only, never by bright albedo.
- Anamorphic blue streak sprites appear only on very bright sources facing
  the camera (headlights).
- Rockstar's own night knobs (timecycle, per weather × hour × region):
  directional/moon mult, artificial exterior down/up intensity, exposure,
  bloom. Night is DARK by default; modders raise the moon to 4 and admit it
  looks wrong ("at night you can't see far").

## 3. GTA 6 (2026) — what changed

- Ray-traced diffuse GI everywhere, with visible stochastic noise on base
  PS5; RT reflections with SSR fallback and planar for mirrors; shadows still
  shadow maps with variable penumbra. Full PBR authored roughness variation
  (dusty cars, rough concrete). Strand hair, real SSS skin, huge crowds.
- Base PS5: ~1440p internal, spatial upscale, locked 30 fps. Cinematic
  letterbox, saturated Miami colour, neon Vice City over a wide bay.
- Lesson for us: the leap from V to VI is GI and materials, not more
  post-processing. Nothing there is reachable in a browser at 60 fps; the
  V-era tricks above are.

## 4. Where Halstead Bay stands against this

Already matched (see CLAUDE.md for the knobs):

- Deferred-style MRT with a dedicated **emissive target feeding bloom**
  (`core/grade.js`), GTAO, CSM with three cascades (`renderer.js:GatedCSM`),
  filmic tone map, SMAA, in-canvas grade with saturation + split tone.
- Real point lights on the nearest lamp heads and kanban
  (`game/lighting.js`, 6 + 4 spots), wet tarmac drops roughness and the
  asphalt normal fades with rain, so headlights already produce the GTA
  wet-road highlight (seen tonight: tokyo-night17.jpg).
- Render bundles do what GTA's compute culling does for CPU cost; far
  stand-ins do what its single-mesh districts do.
- Sky dome with a drawn sun disc; fog; rain darkens dome and fog.

Gaps, in the order they would change the frame most:

1. **DONE 2026-09-05 (`world/glare.js`).** Glare billboards on every light (two counter-rotating quads, size by
   view angle, atlas texture with a painted streak pattern). We have
   `beamPool` cones and lamp caps, but no sprite glare, so distant lamps and
   headlights vanish instead of twinkling. One instanced quad pool per chunk;
   the sign heads and lamp caps already exist as positions (`headsByChunk`).
2. **DONE 2026-09-05 lamps, 2026-09-12 far headlights (`world/farTraffic.js`, 220 phantom cars, one draw).** Distant light sprites. Beyond the 3×3 ring, traffic and lamps stop
   existing. A 32×32 sprite per lamp head and two per far car along the
   road graph is the cheapest thing GTA does and the reason its city reads
   as alive to the horizon. Our far stand-ins carry masts and beacons; the
   street level has nothing.
3. **MEASURED 2026-09-08 — per-channel tone mapping. Not the culprit at 2.0,
   and the real problem is hue-dependent.** Ported three r185's
   `agxToneMapping` (three.webgpu.js:41562, matrices and the contrast
   polynomial verbatim) and ran it on paper. A pure (2, 0, 0) comes out
   (0.943, 0.226, 0.154) — 100% saturation in, **84% out**. It does NOT go
   white, so the "haze" at bloom 1.35 was the bloom, not the tone curve.

   What it does do is desaturate **harder the brighter you push**, and by very
   different amounts per hue (day exposure 1.05):

   | input | output | sat in → out |
   | --- | --- | --- |
   | red (2,0,0) | (0.943, 0.226, 0.154) | 100% → **84%** |
   | red (4,0,0) | (1.000, 0.382, 0.282) | 100% → 72% |
   | red (8,0,0) | (1.000, 0.560, 0.445) | 100% → **55%** |
   | magenta (2,0,2) | (0.838, 0.364, 0.795) | 100% → 57% |
   | cyan (0,2,2) | (0.441, 0.766, 0.764) | 100% → **41%** |
   | sodium (2,1.2,0.3) | (0.774, 0.635, 0.416) | 85% → 46% |

   Two things follow. **Brightness is bought with saturation** — a tube at 8.0
   keeps barely half its colour, so reach for bloom and the glare sprite to
   make a sign read bright, not for emissive intensity. And **cyan pays more
   than twice what red pays** (41% vs 84% at the same 2.0). The Tokyo palette
   is six-in-ten magenta/cyan, which is precisely the pair AgX flattens most,
   so a cyan tube needs a LOWER intensity than a red one to read as the same
   colour — the instinct to brighten it makes it whiter. Night exposure 1.15
   changes these by under two points, so the day/night pair is not the issue.
   Painting the white core into the sign atlas is still the GTA way and still
   worth doing; it just is not a fix for a problem the curve is causing.

   **The governing rule, measured: AgX retention is a function of BRIGHTNESS,
   not of chroma.** One sky hue (0.63, 0.80, 1.00) swept by value — source
   saturation constant at 37% throughout:

   | source | value | on screen | screen sat | kept |
   | --- | --- | --- | --- | --- |
   | (161,204,255) | 255 | (166,187,205) | 19.0% | **52%** |
   | (132,168,210) | 210 | (146,168,189) | 22.8% | 61% |
   | (107,136,170) | 170 | (124,147,169) | 26.6% | 72% |
   | (82,104,130) | 130 | (98,120,141) | 30.5% | 83% |
   | (57,72,90) | 90 | (66,85,104) | 36.5% | **100%** |

   So **you cannot have a colour that is both bright and saturated** through
   this curve — that is AgX doing its job, rolling highlights to neutral so
   they never clip with a hue shift. Two consequences worth holding on to:

   - **The noon sky can only be so blue.** A bright horizon keeps ~half its
     chroma; the zenith keeps 92% because it is dark. Solving the gradient for
     a target on-screen saturation produces a *dark slate* sky (#898b8d at the
     horizon) — correct arithmetic, wrong picture. The honest ceiling for a
     bright noon sky is what the current stops give, and reaching past it means
     changing the tone curve or the exposure, not the texture.
   - **It is the same lever as the neon.** A tube at 8.0 keeps half its colour
     for exactly this reason: it is bright, not because it is red. Brightness
     is always paid for in chroma here.
4. **DONE 2026-09-12 (`bloomThresholdFor`, T*ref/exposure, night 0.85 unchanged).** Exposure-derived bloom threshold rather than a fixed 0.85: night
   exposure 1.15 with a fixed threshold is why the day/night bloom retune is
   a manual pair of numbers.
5. **DONE 2026-09-12 (`world/streaks.js`).** Anamorphic streak sprite on headlights within ~20° of the camera.
   Cheap, and it is the single most recognisable GTA-night signature.
6. **Light-shaft map** (half-res ray march against the sun shadow) for dusk;
   ours is a fog colour only.
7. **Planar water reflection at 240×120** — ours is a cubemap; a tiny
   upside-down scene pass for the bay would put the Vice-City skyline in the
   water. ~650 draws in GTA; ours would be bundled shells only.
8. Not worth chasing: RTGI, RT reflections, strand hair, SSS (GTA 6 only,
   30 fps on a PS5).

## 5. Numbers to hold ourselves to

GTA V ships ~4155 draws / 88 render targets per frame on a 2015 PC at 60 fps.
Our budget is 1400 draws (bundled draws replay cheaply) and 4.0M triangles;
tonight's measurements: kingsway-corner 1404 draws (793 bundled) / 3.56M,
the Tokyo interior street 1481 draws / 3.5M. The glare and distant-sprite
pools above are one instanced draw each per chunk.
