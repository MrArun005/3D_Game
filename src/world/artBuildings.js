/**
 * The self-built building styles, wired into the city.
 *
 * Five modules in world/buildings/ (warehouse, glassTower, officeMidrise,
 * loft, brickRow) author a building in code from the reference boards and the
 * visual brief, the way
 * world/tokyo.js does for Little Tokyo -- no Kenney, no kit. This file is the
 * dispatcher districtWorld talks to:
 *
 *   styleFor(block, footprint, roll)  which style a footprint gets, or null
 *                                     to keep the kit / procedural massing
 *   buildArt(style, seed, hw, hd, h, opts)  the module's build() (artKit contract)
 *   artMaterial(key)                  ONE cached material per artKit MAT_KEY;
 *                                     districtWorld merges the chunk's parts
 *                                     per key into one mesh each (<= 8 draws)
 *   ART_CAP[style]                    the half-footprint the style was drawn
 *                                     for; districtWorld clips bigger plots to
 *                                     it and keeps the street face in place
 *
 * Where each style lands is the brief's table (docs/VISUAL-BRIEF.md), one
 * entry per district x block type in MAP below:
 *   brickRow       the historic/residential brick rows -- OLD QUARTER (row and
 *                  mid; the HERO BLOCK, so nearly every footprint takes one and
 *                  the quarter reads as one place), MARROW HILL and ASHMOOR rows
 *   loft           modern mixed-use over bars and shops: VELLERY ROW (nightlife)
 *                  row and mid, THE FLATS (retail) row -- NOT the historic quarter
 *   officeMidrise  mid blocks in the 'modern' districts: KINGSWAY, THE FLATS
 *   glassTower     KINGSWAY tower blocks (planner heights there are 58-133 m,
 *                  so the "h >= 40" rule in the brief is always true)
 *   warehouse      yard blocks in STEELGATE, HARBOUR POINT, NORTHLINE and the
 *                  period yards of MARROW HILL and ASHMOOR
 * Little Tokyo never gets one (tokyo.js builds it). The roll is a hash of the
 * footprint's world position (districtWorld passes it in) against the share in
 * MAP, so the same seed gives the same city; ?noart turns the styles off,
 * ?artall gives every eligible footprint one for checking. The shares are tuned
 * against a district-wide census run in node over the real district file
 * (2026-09-12): the hero block is bought by holding the other rows down.
 */
import * as THREE from 'three';
import * as warehouse from './buildings/warehouse.js';
import * as glassTower from './buildings/glassTower.js';
import * as officeMidrise from './buildings/officeMidrise.js';
import * as loft from './buildings/loft.js';
import * as brickRow from './buildings/brickRow.js';
import { tokyoMaterial } from './tokyo.js';

export const STYLES = { warehouse, glassTower, officeMidrise, loft, brickRow };

/* Half-footprint the module is happy with, [along the building's local X, along
   its local Z]. Per artKit's faces(): +X IS THE STREET FACE, so the FIRST number
   is half the DEPTH back from the kerb and the SECOND is half the FRONTAGE along
   the street. districtWorld clips a bigger plot to this and slides the building
   back up to the street edge. Triangle budget and proportions measured in node:
   warehouse 22x20 -> ~1,950 tris, glassTower 20x20 -> ~4,500, officeMidrise
   16x16 -> ~2,150, loft 6x11 -> ~2,500. brickRow is a party-wall terrace, so
   its cap is shallow and long: 24 m deep, up to 56 m of frontage. Note that in
   the OLD QUARTER it never bites: re-measured over the district file
   (2026-09-12) the 506 built footprints there run 6.9-18.8 m on BOTH axes,
   median 9.2 m of frontage x 9.5 m deep, and 0 of 506 are clipped. So the cap
   is a guard, not a shaper -- the terrace length is whatever the planner's
   footprint is, and a run of houses only reads as a run where the planner
   happens to have drawn a long plot. Industrial yards run 83-197 m a side and a
   few KINGSWAY towers sit on 98 m plots; those ARE clipped and keep the street
   edge. */
export const ART_CAP = { warehouse: [22, 20], glassTower: [20, 20], officeMidrise: [16, 16], loft: [6, 11], brickRow: [12, 28] };

/* district -> block type -> [style, share of footprints that take it].
   OLD QUARTER is the HERO BLOCK: 0.86 on purpose -- a brick quarter with one
   building in ten authored reads as noise, and consistency is the whole point
   of a hero block. It buys that with the rest of the city. Census over the real
   district file (node, 2026-09-12; the same harness reproduces the previous
   mapping's 379 buildings / 572,846 tris exactly, so the numbers are comparable.
   RE-MEASURED at review time -- brickRow.js grew after the first pass, so the
   per-building mean moved 1,078 -> 1,207 and every brickRow row below with it.
   Re-run the census after any change to a style module; these are that module's
   numbers, not this file's):

     OLD QUARTER  brickRow 506   610,568      MARROW HILL brickRow  38   44,758
     THE FLATS    office   102   127,278      ASHMOOR     brickRow  26   32,424
     VELLERY ROW  loft      19    35,212      THE FLATS   loft       7   10,818
     KINGSWAY     office    21    31,468      KINGSWAY    glassTwr   9   22,184
     warehouses (5 districts) 28  51,444
     TOTAL 756 buildings / 966,154 triangles

   That total is district-wide and only ~9 chunks are ever resident, so the
   number hard rule 1 actually wants is the worst 256 m ring, and it is in the
   OLD QUARTER: the worst single chunk goes 20,088 -> 126,166 triangles and the
   worst 3x3 ring 105,962 -> 517,192 (+411k) against a 4.0 M frame budget. Draws
   do not move -- the per-chunk merge is by material key, so it is <= 8 art
   meshes a chunk either way (measured: median 7, max 8 over the 90 chunks that
   carry any). The ring figure is unverified in a browser; measure it before
   raising anything.

   The hero block alone is 63% of the district total, which is why MARROW HILL,
   ASHMOOR, VELLERY ROW and THE FLATS rows sit at 0.03-0.04 instead of the
   0.30-0.35 their districts want: 1,630 eligible row footprints in MARROW HILL
   + ASHMOOR at 0.35 would have been another 568k on its own. Raise them when
   the budget does (brief step 7, "only then scale across the city"); do NOT buy
   them by thinning OLD QUARTER. Two of those three are also a language
   mismatch to settle first: ASHMOOR's brief is "inter-war semis, cream render,
   red tile" and MARROW HILL's is "terraces climbing the hill, GABLE ends",
   where brickRow is a flat-parapet Victorian terrace. VELLERY ROW is the one
   the brief literally calls "narrow party-wall rows" and it went DOWN (loft
   0.09 -> 0.03) to pay for the hero block. */
/* One measured caveat on the OLD QUARTER 'mid' entry: brickRow clamps itself to
   3-5 storeys, and the planner's OLD QUARTER mids ask for 13.4-23.9 m, so those
   35 footprints build SHORTER than planned (median -2.8 m, worst -8.2 m) and
   stand beside un-retargeted 24 m massing boxes in the same block. The rows go
   the other way -- the 3-storey floor over-builds the shortest plots by up to
   4.5 m (median +2.3). Both are brickRow's clamps; if the skyline reads wrong,
   widen them there rather than dropping 'mid' from the hero block. */
const MAP = {
  'OLD QUARTER':   { row: ['brickRow', 1.0], mid: ['brickRow', 1.0] },   // 0.86 until 2026-09-24: the one plot in seven left as a massing box was the "old building" in the compact city
  'MARROW HILL':   { row: ['brickRow', 0.04], yard: ['warehouse', 0.7] },
  ASHMOOR:         { row: ['brickRow', 0.03], yard: ['warehouse', 0.7] },
  'VELLERY ROW':   { row: ['loft', 0.03], mid: ['loft', 0.03] },
  'THE FLATS':     { row: ['loft', 0.03], mid: ['officeMidrise', 0.35] },
  KINGSWAY:        { mid: ['officeMidrise', 0.35], tower: ['glassTower', 0.45] },
  /* Image 11 is the floor: walk-ups, shop rooms, kanban. Glass towers as the
     default (0.70 on row/mid/tower) turned the street into an office canyon
     and hid tokyo.js. Towers only, and few — skyline punctuation, not the kerb. */
  'LITTLE TOKYO':  { tower: ['glassTower', 0.18] },
  STEELGATE:       { yard: ['warehouse', 0.7] },
  'HARBOUR POINT': { yard: ['warehouse', 0.7] },
  NORTHLINE:       { yard: ['warehouse', 0.7] },
};

const flag = (name) => typeof location !== 'undefined' && new URLSearchParams(location.search).has(name);

export function styleFor(block, fp, roll) {
  if (fp.w < 6 || fp.d < 6 || flag('noart')) return null;
  const hit = MAP[block.district]?.[block.type];
  if (!hit) return null;
  return flag('artall') || roll < hit[1] ? hit[0] : null;
}

export const buildArt = (style, seed, hw, hd, h, opts) => STYLES[style].build(seed, hw, hd, h, opts);   // opts: per-style extras (glassTower { rgb })

/* One material per key, shared by every chunk. The textured keys wear the
   library sets (public/textures/library.json) with vertexColors on so a
   part's hex tints them; the parts pass near-white unless they mean a tint.
   `tile` is the set's metres per repeat (library.json, except brick_red which
   tools/asphalt-textures.py regenerates at 2 m per tile); the parts' UVs
   are in metres (artKit boxM/quadM), so repeat = 1/tile. */
const LIBRARY = { brick: ['brick_red', 2], concrete: ['concrete_precast', 2.4], plaster: ['plaster_worn', 2], metal: ['metal_painted', 1], timber: ['timber_bare', 1] };
const MATS = new Map();
let loader = null;
function tex(path, srgb, tile) {
  const t = (loader ??= new THREE.TextureLoader()).load(path);   // same recipe as assets.js loadPBR
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / tile, 1 / tile);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}
export function artMaterial(key) {
  if (MATS.has(key)) return MATS.get(key);
  let m;
  if (key === 'emit') m = tokyoMaterial();   // the Tokyo emissive: `emit` attribute x emissiveIntensity, night-faded by setTokyoNight
  /* Glass, with BODY. This went to 0x0c0e11 at metalness 0.92 / roughness 0.05
     to kill a navy tint, and overshot: a near-black metal is a pure mirror with
     no surface of its own, so a vertical facade reflected the dark street
     opposite and came out BLACK. The only thing left visible was the ~35% of
     panes that are lit, which read as rectangles floating in holes -- Arun:
     "why do we have gaps in building glasses".
     A real curtain wall is not a mirror. It is a dark glass with its own
     reflectance: it holds the sky at a grazing angle and goes quieter face-on,
     but never to nothing. Neutral (the navy is still gone), metalness back to
     0.6 so the surface keeps some of itself, roughness 0.08, and the
     environment strong at 2.4 so a sunset still lands in it. */
  else if (key === 'glass') m = new THREE.MeshStandardMaterial({ color: 0x171b21, roughness: 0.08, metalness: 0.60, envMapIntensity: 2.4, vertexColors: true });
  else if (key === 'dark') m = new THREE.MeshStandardMaterial({ color: 0x1e2226, roughness: 0.75, vertexColors: true });
  else {
    const [name, tile] = LIBRARY[key];
    const orm = tex(`/textures/${name}_orm.png`, false, tile);
    m = new THREE.MeshStandardMaterial({
      map: tex(`/textures/${name}_albedo.png`, true, tile), normalMap: tex(`/textures/${name}_normal.png`, false, tile),
      aoMap: orm, roughnessMap: orm, metalnessMap: orm, roughness: 1, metalness: 0, vertexColors: true,
    });
  }
  m.name = `art_${key}`;
  MATS.set(key, m);
  return m;
}
