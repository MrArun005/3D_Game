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
2. **DONE 2026-09-05 (lamps; far headlights still open).** Distant light sprites. Beyond the 3×3 ring, traffic and lamps stop
   existing. A 32×32 sprite per lamp head and two per far car along the
   road graph is the cheapest thing GTA does and the reason its city reads
   as alive to the horizon. Our far stand-ins carry masts and beacons; the
   street level has nothing.
3. **Per-channel tone mapping.** Check what three's filmic node does to a
   pure (2, 0, 0) — if it desaturates toward white, the neon core goes
   white before it blooms, which is exactly the "haze" we fought at bloom
   1.35. Painting the white core into the sign atlas instead is the GTA way.
4. **Exposure-derived bloom threshold** rather than a fixed 0.85: night
   exposure 1.15 with a fixed threshold is why the day/night bloom retune is
   a manual pair of numbers.
5. **Anamorphic streak sprite** on headlights within ~20° of the camera.
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
