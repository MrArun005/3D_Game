/**
 * Kit preview. `npm run dev`, then open /tools/preview/.
 *
 * Drag to orbit, scroll to zoom. Everything in view is assembled from the
 * catalogue in public/models/manifest.json by the rules in scenes.mjs — that
 * file is the reference for how districtWorld should consume the kit.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadManifest, makeRenderer, lightScene, human, ground } from './lib.mjs';
import { building, street, park, harbour } from './scenes.mjs';

const CAMS = {
  block:    { span: 60, pos: [-26, 5.2, 3.2], look: [22, 6.5, -1],   fov: 58 },
  street:   { span: 46, pos: [-15, 2.6, 11],  look: [16, 2.4, 2],    fov: 55 },
  building: { span: 40, pos: [16, 10, 30],    look: [0, 9.5, 0],     fov: 38 },
  park:     { span: 62, pos: [26, 14, 32],    look: [-2, 2.5, -2],   fov: 48 },
  harbour:  { span: 78, pos: [40, 20, 34],    look: [-6, 3, -14],    fov: 46 },
};

const renderer = makeRenderer(innerWidth, innerHeight);
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const manifest = await loadManifest('/models');
const stats = document.getElementById('stats');
let scene, cam, controls, night = false, current = 'block';

async function build(which) {
  current = which;
  const c = CAMS[which];
  scene = new THREE.Scene();
  lightScene(scene, renderer, { span: c.span, night });

  if (which === 'building') {
    scene.add(ground(70, 0x64676c));
    scene.add(await building(manifest, { bays: 5, storeys: 5, style: 'period', seed: 7 }));
  } else if (which === 'street') {
    scene.add(await street(manifest, { length: 46, seed: 3 }));
  } else if (which === 'block') {
    scene.add(await street(manifest, { length: 60, seed: 3 }));
    const a = await building(manifest, { bays: 6, storeys: 4, style: 'period', seed: 7 });
    a.position.set(-11, 0.24, -9.6); scene.add(a);
    const b = await building(manifest, { bays: 4, storeys: 6, style: 'modern', seed: 21 });
    b.position.set(11, 0.24, -9.6); scene.add(b);
    const d = await building(manifest, { bays: 6, storeys: 3, style: 'industrial', seed: 44 });
    d.position.set(0, 0.24, 9.6); d.rotation.y = Math.PI; scene.add(d);
  } else if (which === 'park') {
    scene.add(await park(manifest));
  } else {
    scene.add(await harbour(manifest));
  }

  // people, because scale is the first thing to get wrong
  const y = which === 'harbour' ? 1.8 : which === 'park' ? 0 : 0.24;
  for (const [x, z, col] of [[-3, 7.9, 0xd8642f], [5.5, 8.4, 0x2f6ad8], [14, -8.2, 0x3fae6a]]) {
    const p = human(col); p.position.set(x, y, z); scene.add(p);
  }

  cam = new THREE.PerspectiveCamera(c.fov, innerWidth / innerHeight, 0.3, 900);
  cam.position.set(...c.pos);
  controls = new OrbitControls(cam, renderer.domElement);
  controls.target.set(...c.look);
  controls.enableDamping = true;
  controls.update();
}

document.querySelectorAll('button[data-s]').forEach((b) => {
  b.onclick = async () => {
    document.querySelectorAll('button[data-s]').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    await build(b.dataset.s);
  };
});
document.getElementById('night').onclick = async (e) => {
  night = !night; e.target.classList.toggle('on', night); await build(current);
};
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  if (cam) { cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); }
});

await build('block');
document.querySelector('button[data-s="block"]').classList.add('on');

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, cam);
  const i = renderer.info.render;
  stats.textContent = `${i.calls} draws · ${(i.triangles / 1000).toFixed(1)}k tris`;
});
