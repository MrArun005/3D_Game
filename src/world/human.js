import * as THREE from 'three';
import { groundHeightAt } from './metrics.js';

/**
 * A standing human, built as real meshes (not a sprite, not six boxes).
 * Photoreal albedo maps live in /textures/human/. Origin is the soles,
 * facing +X like the car. About 1.72 m tall.
 */
function tex(url, repeat = 1) {
  const t = new THREE.TextureLoader().load(url);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat !== 1) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
  }
  return t;
}

function std(map, extras = {}) {
  return new THREE.MeshStandardMaterial({
    map, roughness: 0.62, metalness: 0, envMapIntensity: 0.45, ...extras,
  });
}

function limb(rTop, rBot, len, segs = 10) {
  const g = new THREE.CylinderGeometry(rTop, rBot, len, segs);
  g.translate(0, -len / 2, 0);          // joint at the origin, mass hangs down
  return g;
}

export function buildHuman() {
  const skinMap = tex('/textures/human/skin.jpg', 2);
  const coatMap = tex('/textures/human/coat.jpg', 2.2);
  const jeanMap = tex('/textures/human/denim.jpg', 2.4);
  const bootMap = tex('/textures/human/leather.jpg', 1.6);
  const hairMap = tex('/textures/human/hair.jpg', 1);
  const faceMap = tex('/textures/human/face.jpg', 1);

  const skin = std(skinMap, { roughness: 0.48, envMapIntensity: 0.25 });
  const coat = std(coatMap, { roughness: 0.58, envMapIntensity: 0.55 });
  const jeans = std(jeanMap, { roughness: 0.72 });
  const boot = std(bootMap, { roughness: 0.4, envMapIntensity: 0.5 });
  const hair = std(hairMap, { roughness: 0.35, envMapIntensity: 0.4 });
  const faceMat = std(faceMap, { roughness: 0.42, envMapIntensity: 0.2 });

  const root = new THREE.Group();
  const mesh = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    root.add(m);
    return m;
  };

  // --- feet & legs -------------------------------------------------------
  mesh(new THREE.BoxGeometry(0.11, 0.09, 0.26), boot, 0, 0.05, 0.10);
  mesh(new THREE.BoxGeometry(0.11, 0.09, 0.26), boot, 0, 0.05, -0.10);
  const thigh = limb(0.075, 0.065, 0.40, 12);
  const shin = limb(0.062, 0.048, 0.38, 12);
  mesh(thigh, jeans, 0, 0.86, 0.09);
  mesh(thigh.clone(), jeans, 0, 0.86, -0.09);
  mesh(shin, jeans, 0, 0.46, 0.09);
  mesh(shin.clone(), jeans, 0, 0.46, -0.09);

  // hips
  mesh(new THREE.SphereGeometry(0.12, 12, 10), jeans, 0, 0.88, 0)
    .scale.set(1.15, 0.7, 1.55);

  // --- coat (lathed around Y, then a little flattened) -------------------
  const coatProfile = [
    [0.16, 0.90], [0.20, 0.98], [0.22, 1.12], [0.23, 1.28],
    [0.24, 1.38], [0.22, 1.44], [0.14, 1.48],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const coatGeo = new THREE.LatheGeometry(coatProfile, 20);
  const coatMesh = mesh(coatGeo, coat, 0, 0, 0);
  coatMesh.scale.set(1.05, 1, 0.78);

  // collar
  mesh(new THREE.TorusGeometry(0.09, 0.025, 8, 16), coat, 0.04, 1.47, 0, Math.PI / 2, 0, 0)
    .scale.set(1.1, 0.8, 1);

  // --- arms (sleeves + hands) --------------------------------------------
  const upper = limb(0.055, 0.048, 0.30, 10);
  const lower = limb(0.048, 0.042, 0.28, 10);
  const hand = new THREE.SphereGeometry(0.042, 10, 8);
  for (const s of [1, -1]) {
    mesh(upper.clone(), coat, 0, 1.36, s * 0.20, 0.18, 0, s * 0.12);
    mesh(lower.clone(), coat, 0, 1.07, s * 0.23, 0.12, 0, s * 0.08);
    mesh(hand.clone(), skin, 0, 0.80, s * 0.25);
  }

  // --- neck, skull, face, hair -------------------------------------------
  mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.10, 12), skin, 0, 1.50, 0);
  mesh(new THREE.SphereGeometry(0.108, 28, 22), skin, 0.01, 1.61, 0)
    .scale.set(0.92, 1.05, 0.88);

  // front hemisphere carries the portrait; +X is the face
  const faceGeo = new THREE.SphereGeometry(0.107, 24, 18, -0.72, 1.44, 0.45, 1.7);
  const face = new THREE.Mesh(faceGeo, faceMat);
  face.position.set(0.012, 1.605, 0);
  face.scale.set(0.92, 1.04, 0.88);
  face.castShadow = true;
  root.add(face);

  const hairCap = new THREE.SphereGeometry(0.114, 20, 16, 0, Math.PI * 2, 0, 1.15);
  const hairMesh = mesh(hairCap, hair, 0.0, 1.655, 0);
  hairMesh.scale.set(0.95, 0.72, 0.92);
  hairMesh.rotation.z = -0.08;

  // a couple of wet strands at the nape
  mesh(new THREE.CapsuleGeometry(0.018, 0.16, 4, 6), hair, -0.02, 1.42, 0.07, 0.4, 0, 0.2);
  mesh(new THREE.CapsuleGeometry(0.018, 0.16, 4, 6), hair, -0.02, 1.42, -0.07, 0.4, 0, -0.2);

  root.userData = { breathe: 0 };
  return {
    root,
    place(x, z, yaw = 0) {
      root.position.set(x, groundHeightAt(x, z), z);
      root.rotation.y = -yaw + Math.PI / 2;   // yaw 0 looks +X, same as the car
    },
    update(dt) {
      root.userData.breathe += dt;
      const b = Math.sin(root.userData.breathe * 1.7) * 0.008;
      coatMesh.scale.y = 1 + b;
    },
  };
}
