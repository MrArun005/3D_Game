import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Whole buildings from Kenney's City Kits (CC0): suburban houses, commercial
 * blocks and skyscrapers, industrial sheds. Where the district calls for
 * them, a footprint gets one of these -- scaled per axis onto the footprint,
 * height kept in proportion -- instead of the box massing, and the facade
 * modules, signs and roof clutter stay off it (it has its own). One merged
 * mesh per kit per chunk, drawn with the kit's palette texture.
 *
 * Kenney models are ~1 unit wide; a 13 m house is a x10 scale, which reads
 * fine at street level because the kit's detail is all silhouette.
 */
const BASE = '/models/vendor/kenney/';
const KITS = {
  suburban:   { files: 'abcdefghijklmnopqrstu'.split('').map((c) => `building-type-${c}`) },
  commercial: {
    files: [
      ...'abcdefghijklmn'.split('').map((c) => `building-${c}`),
      ...'abcdefghijklmn'.split('').map((c) => `low-detail-building-${c}`),
      'low-detail-building-wide-a',
      'low-detail-building-wide-b',
    ],
    tall: [...'abcde'].map((c) => `building-skyscraper-${c}`),
  },
  industrial: { files: [...'abcdefghijklmnopqrst'].map((c) => `building-${c}`) },
};
/** Which kit a district builds with, and how many of its footprints (0..1). */
export const KIT_DISTRICT = {
  NORTHLINE: ['suburban', 0.20], 'GREENFELL PARK': ['suburban', 0.25], 'MARROW HILL': ['suburban', 0.15],
  STEELGATE: ['industrial', 0.25], 'HARBOUR POINT': ['industrial', 0.45],   // docks: the sheds are the skyline
  'OLD QUARTER': ['commercial', 0.0], 'VELLERY ROW': ['commercial', 0.0], ASHMOOR: ['commercial', 0.0],
  KINGSWAY: ['commercial', 0.0], 'THE FLATS': ['commercial', 0.0], 'LITTLE TOKYO': ['commercial', 0.0],
};

/**
 * The kits some district actually builds with (a share above 0). Every
 * commercial share is 0.0 -- the downtown districts are box massing, art
 * buildings and Tokyo -- so the commercial kit's 35 GLBs (3.7 MB, 35 parses
 * and merges at boot) were loaded for nothing. Raise a share and that kit
 * loads again with no other change. The one commercial file a landmark uses
 * (building-skyscraper-d) is fetched by landmarks.js on its own. Pure; tested.
 */
export function kitsInUse(table = KIT_DISTRICT) {
  return [...new Set(Object.values(table).filter(([, share]) => share > 0).map(([kit]) => kit))];
}

const loader = new GLTFLoader();
const load = (url) => new Promise((res, rej) => loader.load(url, res, undefined, rej));

function bake(gltf) {
  gltf.scene.updateMatrixWorld(true);
  const parts = []; let map = null;
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    if (!map && o.material?.map) map = o.material.map;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    const keep = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'uv']) if (g.attributes[k]) keep.setAttribute(k, g.attributes[k]);
    if (g.index) keep.setIndex(g.index);
    parts.push(keep.index ? keep.toNonIndexed() : keep);
  });
  const geo = mergeGeometries(parts, false);
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  // base at y=0, centred on the footprint
  geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  geo.computeBoundingBox();
  const s = geo.boundingBox.getSize(new THREE.Vector3());
  return { geo, w: s.x, h: s.y, d: s.z, map };
}

/**
 * Generate emissive window glow and specular roughness maps from Kenney colormap textures.
 * Window panes emit light at dusk/night and reflect specular skylight during daytime,
 * while concrete/brick walls remain diffuse and unlit.
 */
function createKitPbrMaps(sourceMap) {
  if (typeof document === 'undefined' || !sourceMap?.image) return { emissiveMap: null, roughnessMap: null };
  const img = sourceMap.image;
  const w = img.width || 512, h = img.height || 512;
  const cvEmissive = document.createElement('canvas');
  cvEmissive.width = w; cvEmissive.height = h;
  const ctxE = cvEmissive.getContext('2d');

  const cvRough = document.createElement('canvas');
  cvRough.width = w; cvRough.height = h;
  const ctxR = cvRough.getContext('2d');

  try {
    ctxE.drawImage(img, 0, 0, w, h);
    const imgData = ctxE.getImageData(0, 0, w, h);
    const dataE = imgData.data;

    const roughData = ctxR.createImageData(w, h);
    const dataR = roughData.data;

    for (let i = 0; i < dataE.length; i += 4) {
      const r = dataE[i], g = dataE[i + 1], b = dataE[i + 2];
      const isCool = (b > 190 && b > r + 60 && g > 120);
      const isIce = (b >= 240 && g >= 220 && r >= 190 && b > r + 20);
      const isWarm = (r > 230 && g > 190 && b < 150);

      dataR[i + 3] = 255;

      if (isCool) {
        // Office tower cyan-blue window panes
        dataE[i] = 130;
        dataE[i + 1] = 195;
        dataE[i + 2] = 255;
        // Glass specular smoothness
        dataR[i] = dataR[i + 1] = dataR[i + 2] = 48;
      } else if (isIce) {
        // High-altitude pale blue glass
        dataE[i] = 190;
        dataE[i + 1] = 220;
        dataE[i + 2] = 255;
        dataR[i] = dataR[i + 1] = dataR[i + 2] = 40;
      } else if (isWarm) {
        // Cozy residential / commercial incandescent interior light
        dataE[i] = 255;
        dataE[i + 1] = 210;
        dataE[i + 2] = 120;
        dataR[i] = dataR[i + 1] = dataR[i + 2] = 55;
      } else {
        // Concrete, masonry, metal facades remain pitch black in emission
        dataE[i] = dataE[i + 1] = dataE[i + 2] = 0;
        // Concrete matte roughness
        dataR[i] = dataR[i + 1] = dataR[i + 2] = 200;
      }
    }
    ctxE.putImageData(imgData, 0, 0);
    ctxR.putImageData(roughData, 0, 0);

    const emissiveMap = new THREE.CanvasTexture(cvEmissive);
    emissiveMap.wrapS = emissiveMap.wrapT = THREE.RepeatWrapping;
    emissiveMap.colorSpace = THREE.SRGBColorSpace;
    emissiveMap.anisotropy = 4;

    const roughnessMap = new THREE.CanvasTexture(cvRough);
    roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
    roughnessMap.anisotropy = 4;

    return { emissiveMap, roughnessMap };
  } catch (err) {
    console.warn('Could not extract kit PBR maps:', err.message);
    return { emissiveMap: null, roughnessMap: null };
  }
}

export async function loadKitBuildings(assets) {
  const out = {};
  const inUse = new Set(kitsInUse());
  for (const [kit, def] of Object.entries(KITS)) {
    if (!inUse.has(kit)) continue;   // no district places it (kitsInUse)
    const files = [...def.files, ...(def.tall || [])];
    const results = await Promise.all(files.map((f) => load(`${BASE}${kit}/${f}.glb`).then(bake).catch((e) => { console.warn('kit building', kit, f, e.message); return null; })));
    const models = results.filter(Boolean);
    if (!models.length) continue;
    const map = models.find((m) => m.map)?.map;
    if (map) { map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; }
    const { emissiveMap, roughnessMap } = createKitPbrMaps(map);
    const mat = new THREE.MeshStandardMaterial({
      map: map || null,
      color: map ? 0xffffff : 0xb8b4aa,
      roughness: 0.75,
      metalness: 0.12,
      roughnessMap: roughnessMap || null,
      emissive: emissiveMap ? new THREE.Color(0xffffff) : new THREE.Color(0x000000),
      emissiveMap: emissiveMap || null,
      emissiveIntensity: 0.05,
    });
    mat.name = `kit_${kit}`;
    out[kit] = { models: models.map((m, i) => ({ ...m, tall: i >= def.files.length })), mat };
  }
  assets.kitBuildings = out;
  console.info(`kit buildings: ${Object.entries(out).map(([k, v]) => `${k} ${v.models.length}`).join(', ')}`);
  return out;
}

/** Pick a model for a footprint: tall ones for tower blocks, otherwise the closest aspect ratio. */
export function pickKitModel(kit, w, d, wantTall, r) {
  const pool = kit.models.filter((m) => !!m.tall === wantTall);
  const list = pool.length ? pool : kit.models;
  const aspect = w / d;
  const scored = list.map((m) => ({ m, s: Math.abs(Math.log((m.w / m.d) / aspect)) }))
    .sort((a, b) => a.s - b.s).slice(0, Math.max(1, Math.min(4, list.length)));
  return scored[Math.floor(r * scored.length)].m;
}
