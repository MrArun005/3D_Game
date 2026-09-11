import * as THREE from 'three';
import { texSky } from '../world/textures.js';
import { DAY_SUN } from './renderer.js';
import { seed, rp, rr } from './rng.js';

/**
 * Sky dome plus a PMREM environment map built from a throwaway copy of it, so
 * car paint and glazing have a real horizon to reflect. Without this the paint
 * reads as flat plastic no matter how good the material is.
 */
export function createSky(scene, renderer, day = false) {
  const skyTex = texSky(day, day ? DAY_SUN : null);
  /* toTex() hands back RepeatWrapping on BOTH axes, which is right for a
     tiling surface and wrong for an equirectangular sky: wrapping V means the
     zenith row and the nadir row are neighbours, so every mip level blends
     deep blue into ground grey and the poles get a seam. Horizontal wrap is
     still wanted -- the sky is continuous around the compass. Anisotropy goes
     up too: this is one texture seen at the most grazing angles in the game,
     which is the other half of the reported moire. */
  skyTex.wrapS = THREE.RepeatWrapping;
  skyTex.wrapT = THREE.ClampToEdgeWrapping;
  skyTex.anisotropy = 16;                     // drivers clamp to their own max
  skyTex.generateMipmaps = true;
  skyTex.minFilter = THREE.LinearMipmapLinearFilter;
  skyTex.needsUpdate = true;

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(9000, 64, 32),   // must contain the mountain ring; 24 segments banded the sun glare
    new THREE.MeshBasicMaterial({
      map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false,
    }),
  );
  dome.renderOrder = -1;
  scene.add(dome);

  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(
    new THREE.SphereGeometry(100, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide }),
  ));
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshBasicMaterial({ color: day ? 0x23272e : 0x0d1015, side: THREE.DoubleSide }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.5;
  envScene.add(ground);

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  scene.environment = pmrem.fromScene(envScene, 0, 1, 200).texture;
  scene.environmentIntensity = day ? 0.85 : 0.85;   // clock.js owns this per hour; 0.85 by day since 2026-09-08 (was 1.15: half the flat fill)
  pmrem.dispose();

  // stars, only well clear of the afterglow
  seed(88);
  const N = 700, pos = new Float32Array(N * 3);
  let n = 0;
  while (n < N) {
    const u = rr(-1, 1);
    if (u < 0.45) continue;
    const th = rp() * 6.283;
    const s = Math.sqrt(1 - u * u);
    pos[n * 3] = Math.cos(th) * s * 8500;
    pos[n * 3 + 1] = u * 8500;
    pos[n * 3 + 2] = Math.sin(th) * s * 8500;
    n++;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const stars = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 1.7, sizeAttenuation: false, color: 0xc8d6f0,
    transparent: true, opacity: 0.5, depthWrite: false, fog: false,
  }));
  scene.add(stars);

  return { dome, stars };
}
