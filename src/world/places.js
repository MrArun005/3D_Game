import * as THREE from 'three';

/**
 * The 99 places the planner named.
 *
 * Every one of them -- the fuel stops, the pubs, the police stations, the
 * impound -- has been sitting in the export unused. A city where nothing is
 * anything in particular is scenery; these are what turn a block into a
 * destination, and they are what a mission system will hang off later.
 *
 * Each is a lit totem sign on a post, colour-coded by type, turned to face
 * the nearest road. Fuel gets a forecourt canopy, because a petrol station
 * you can recognise at 60km/h is worth eight extra boxes.
 */

const TYPE = {
  fuel:    { colour: 0xff7a1e, canopy: true },
  garage:  { colour: 0xffb020 },
  impound: { colour: 0xd8452c },
  dealer:  { colour: 0x30c8ff },
  police:  { colour: 0x2f6dff },
  fire:    { colour: 0xe02020 },
  hosp:    { colour: 0xff4d6a },
  club:    { colour: 0xd63cff },
  pub:     { colour: 0xffa63c },
  diner:   { colour: 0xff5f3c },
  cinema:  { colour: 0xffd23c },
  hotel:   { colour: 0x3cd6c0 },
  bank:    { colour: 0x38d17a },
  store:   { colour: 0x5ce06a },
  market:  { colour: 0x9ad63c },
  gym:     { colour: 0x00e0b0 },
  station: { colour: 0xa0a8b4 },
  rail:    { colour: 0xa0a8b4 },
  ferry:   { colour: 0x4ab4e0 },
  depot:   { colour: 0x8c94a0 },
};
const FALLBACK = { colour: 0xc8ccd2 };

const POST_H = 5.4;

export function buildPlaces(scene, district, day = true) {
  const group = new THREE.Group();
  const posts = [], panels = [], panelCol = [], canopies = [], pillars = [];
  const c = new THREE.Color();

  for (const p of district.places) {
    const spec = TYPE[p.type] ?? FALLBACK;

    // face the nearest road, so a sign is never edge-on to the street it serves
    const yaw = bearingToRoad(district, p.x, p.y);

    posts.push(M(p.x, 0, p.y, yaw, 0.16, POST_H, 0.16));
    panels.push(M(p.x, POST_H - 1.5, p.y, yaw, 0.22, 1.5, 3.4));
    panelCol.push(spec.colour);

    if (spec.canopy) {
      // 12 x 8 forecourt roof on four legs, set back off the sign
      const bx = p.x + Math.cos(yaw) * 9, bz = p.y - Math.sin(yaw) * 9;
      canopies.push(M(bx, 5.0, bz, yaw, 8.5, 0.55, 12.5));
      for (const [ox, oz] of [[-3.4, -5], [-3.4, 5], [3.4, -5], [3.4, 5]]) {
        const wx = bx + Math.cos(yaw) * ox + Math.sin(yaw) * oz;
        const wz = bz - Math.sin(yaw) * ox + Math.cos(yaw) * oz;
        pillars.push(M(wx, 0, wz, yaw, 0.34, 5.0, 0.34));
      }
    }
  }

  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const inst = (list, mat, colours, shadow) => {
    if (!list.length) return;
    const m = new THREE.InstancedMesh(box, mat, list.length);
    list.forEach((mm, i) => m.setMatrixAt(i, mm));
    m.instanceMatrix.needsUpdate = true;
    if (colours) {
      colours.forEach((hex, i) => m.setColorAt(i, c.setHex(hex)));
      m.instanceColor.needsUpdate = true;
    }
    m.frustumCulled = false;
    m.castShadow = !!shadow;
    group.add(m);
  };

  const steel = new THREE.MeshLambertMaterial({ color: day ? 0x6e7480 : 0x2a3038 });
  inst(posts, steel, null, true);
  inst(pillars, steel, null, true);
  inst(canopies, new THREE.MeshLambertMaterial({ color: day ? 0xe8e6df : 0x3a4048 }), null, true);
  /* The sign face is emissive so it reads in both worlds: full strength at
     night when it is the only light on the block, knocked back at noon where
     a glowing panel would look like a bug. */
  inst(panels, new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: 0xffffff, emissiveIntensity: day ? 0.35 : 1.9,
    roughness: 0.5, metalness: 0,
  }), panelCol);

  scene.add(group);
  return group;
}

/** Yaw that points from the place toward the nearest carriageway. */
function bearingToRoad(district, x, z) {
  let best = null, bx = 0, bz = 0;
  for (let a = 0; a < 16; a++) {
    const th = (a / 16) * Math.PI * 2;
    for (let r = 8; r <= 64; r += 8) {
      const px = x + Math.cos(th) * r, pz = z + Math.sin(th) * r;
      if (district.roadDepth(px, pz) > 0) continue;      // not tarmac
      if (best === null || r < best) { best = r; bx = px; bz = pz; }
      break;
    }
  }
  return best === null ? 0 : Math.atan2(-(bz - z), bx - x);
}

const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
function M(x, y, z, yaw, sx, sy, sz) {
  _e.set(0, yaw, 0);
  return new THREE.Matrix4().compose(
    _v.set(x, y, z), _q.setFromEuler(_e), _s.set(sx, sy, sz),
  );
}
