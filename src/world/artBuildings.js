/**
 * The self-built building styles, wired into the city.
 *
 * Four modules in world/buildings/ (warehouse, glassTower, officeMidrise,
 * loft) author a building in code from Arun's reference boards, the way
 * world/tokyo.js does for Little Tokyo -- no Kenney, no kit. This file is the
 * dispatcher districtWorld talks to:
 *
 *   styleFor(block, footprint, roll)  which style a footprint gets, or null
 *                                     to keep the kit / procedural massing
 *   buildArt(style, seed, hw, hd, h)  the module's build() (artKit contract)
 *   artMaterial(key)                  ONE cached material per artKit MAT_KEY;
 *                                     districtWorld merges the chunk's parts
 *                                     per key into one mesh each (<= 8 draws)
 *   ART_CAP[style]                    the half-footprint the style was drawn
 *                                     for; districtWorld clips bigger plots to
 *                                     it and keeps the street face in place
 *
 * Where each style lands (block type x district; see districtWorld's
 * DISTRICT_FORM for the district characters):
 *   warehouse      yard blocks in the industrial districts (STEELGATE,
 *                  HARBOUR POINT, NORTHLINE) and the period yards
 *   glassTower     KINGSWAY tower blocks (planner heights there are 58-133 m,
 *                  so the "h >= 40" rule in the brief is always true)
 *   officeMidrise  mid blocks in the 'modern' districts: KINGSWAY, THE FLATS
 *   loft           row blocks in the residential period districts: OLD
 *                  QUARTER, VELLERY ROW, ASHMOOR, MARROW HILL
 * Little Tokyo never gets one (tokyo.js builds it). The roll is a hash of the
 * footprint's world position (districtWorld passes it in) against SHARE, so
 * the same seed gives the same city; ?noart turns the styles off, ?artall
 * gives every eligible footprint one for checking. The shares are tuned so
 * the whole district's art buildings stay near 600k triangles (measured in
 * node over the real district file, 2026-09-12 -- the lofts are the volume:
 * 2,500 eligible row footprints).
 */
import * as THREE from 'three';
import * as warehouse from './buildings/warehouse.js';
import * as glassTower from './buildings/glassTower.js';
import * as officeMidrise from './buildings/officeMidrise.js';
import * as loft from './buildings/loft.js';
import { tokyoMaterial } from './tokyo.js';

export const STYLES = { warehouse, glassTower, officeMidrise, loft };

/* Half-footprint the module is happy with (triangle budget and proportions
   measured in node: warehouse 22x20 -> ~1,950 tris, glassTower 20x20 -> ~4,500,
   officeMidrise 16x16 -> ~2,150, loft 6x11 -> ~2,500). Industrial yards run
   83-197 m a side and a few KINGSWAY towers sit on 98 m plots; those are
   clipped to the cap and the building keeps the street edge. */
export const ART_CAP = { warehouse: [22, 20], glassTower: [20, 20], officeMidrise: [16, 16], loft: [6, 11] };
const SHARE = { warehouse: 0.7, glassTower: 0.45, officeMidrise: 0.35, loft: 0.09 };
const INDUSTRIAL = new Set(['STEELGATE', 'HARBOUR POINT', 'NORTHLINE', 'MARROW HILL', 'ASHMOOR']);
const MODERN_MID = new Set(['KINGSWAY', 'THE FLATS']);
const LOFT_ROW = new Set(['OLD QUARTER', 'VELLERY ROW', 'ASHMOOR', 'MARROW HILL']);

const flag = (name) => typeof location !== 'undefined' && new URLSearchParams(location.search).has(name);

export function styleFor(block, fp, roll) {
  if (block.district === 'LITTLE TOKYO' || fp.w < 6 || fp.d < 6 || flag('noart')) return null;
  const d = block.district, t = block.type;
  const style = t === 'yard' && INDUSTRIAL.has(d) ? 'warehouse'
              : t === 'tower' && d === 'KINGSWAY' ? 'glassTower'
              : t === 'mid' && MODERN_MID.has(d) ? 'officeMidrise'
              : t === 'row' && LOFT_ROW.has(d) ? 'loft' : null;
  if (!style) return null;
  return flag('artall') || roll < SHARE[style] ? style : null;
}

export const buildArt = (style, seed, hw, hd, h) => STYLES[style].build(seed, hw, hd, h);

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
  else if (key === 'glass') m = new THREE.MeshStandardMaterial({ color: 0x0f1a2a, roughness: 0.12, metalness: 0.55, envMapIntensity: 1.4, vertexColors: true });
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
