// The shared world: renderer, sky, light, city, aircraft and effects, and a
// per-frame step that poses all of it for a flight time. Both films use it.
import * as THREE from 'three';
import { planeState, spool, clamp, LIFTOFF_FT, DITCH_FT } from './timeline.js';
import { skyTexture, SUN_DIR, softSprite } from './textures.js';
import { buildCity } from './city.js';
import { buildAircraft } from './aircraft.js';
import { Geese, Puffs, Spray, Foam, Flames, Evacuation, Ferries } from './effects.js';

export const W = 1280, H = 720;

export function createWorld({ preserve = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, preserveDrawingBuffer: preserve });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const sky = skyTexture();
  scene.background = sky;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(sky).texture;
  scene.environmentIntensity = 0.9;
  scene.fog = new THREE.FogExp2(0xc2ccd4, 0.000052);

  const sun = new THREE.DirectionalLight(0xfff0dc, 2.7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 1200 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xbcd3ec, 0x55544f, 0.35));

  const camera = new THREE.PerspectiveCamera(40, W / H, 0.3, 90000);

  const city = buildCity(scene);
  const plane = buildAircraft();
  scene.add(plane.root);
  const geese = new Geese(scene);
  const puffs = new Puffs(scene);
  const spray = new Spray(scene);
  const foam = new Foam(scene);
  const flames = new Flames(plane);
  const evac = new Evacuation(plane);
  const ferries = new Ferries(scene);

  // The path, drawn as a ribbon for map shots.
  const pathPts = [];
  for (let ft = LIFTOFF_FT; ft <= DITCH_FT; ft += 0.5) pathPts.push(planeState(ft).pos.clone());
  const PATH_SEG = 1200;
  const pathMesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pathPts), PATH_SEG, 26, 6), new THREE.MeshBasicMaterial({ color: 0xff4b3a, fog: false }));
  scene.add(pathMesh);
  const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: softSprite('rgba(255,90,60,1)'), depthTest: false, fog: false }));
  marker.scale.setScalar(420);
  scene.add(marker);

  // Fan rotation needs the integral of spool over flight time.
  function fanAngles(ft) {
    const a = [0, 0];
    const dt = 0.05;
    for (let t = 0; t < ft; t += dt) {
      a[0] += (1.5 + 30 * spool(t, -1)) * dt;
      a[1] += (1.5 + 30 * spool(t, 1)) * dt;
    }
    return a;
  }

  // Pose everything for flight time ft and draw from camera move c.
  // map: show the path ribbon up to pathTo (a flight time) and the marker.
  function draw(ft, c, { map = false, pathTo = ft } = {}) {
    const S = planeState(ft);
    plane.root.position.copy(S.pos);
    plane.root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(S.f, S.u, S.r));
    plane.update(ft, fanAngles(ft));
    city.update(ft);
    geese.update(ft);
    puffs.update(ft);
    spray.update(ft);
    foam.update(ft, S);
    flames.update(ft);
    evac.update(ft);
    ferries.update(ft);

    pathMesh.visible = map;
    marker.visible = map;
    if (map) {
      const k = clamp((pathTo - LIFTOFF_FT) / (DITCH_FT - LIFTOFF_FT), 0, 1);
      pathMesh.geometry.setDrawRange(0, Math.floor(k * PATH_SEG) * 6 * 6);
      marker.position.copy(S.pos);
    }
    camera.position.copy(c.pos);
    camera.up.copy(c.up || new THREE.Vector3(0, 1, 0));
    camera.fov = c.fov;
    camera.near = map ? 20 : 0.3;
    camera.updateProjectionMatrix();
    camera.lookAt(c.look);

    // Shadows follow whatever the camera is looking at, near the aircraft.
    const focus = S.pos.distanceTo(camera.position) < 400 ? S.pos : c.look;
    sun.target.position.copy(focus);
    sun.position.copy(focus).addScaledVector(SUN_DIR, 500);
    scene.fog.density = map ? 0.000028 : 0.000052;
    renderer.render(scene, camera);
    return S;
  }

  return { renderer, scene, camera, draw };
}

// Preview playback for a page: fits the stage, loops, space pauses, arrows skip.
export function preview(frame, duration, params) {
  const stage = document.getElementById('stage');
  const fit = () => { stage.style.transform = `scale(${Math.min(innerWidth / W, innerHeight / H)})`; };
  addEventListener('resize', fit); fit();
  let t0 = performance.now() - (parseFloat(params.get('t')) || 0) * 1000, paused = false, pv = 0;
  addEventListener('keydown', (e) => {
    if (e.code === 'Space') { paused = !paused; t0 = performance.now() - pv * 1000; }
    if (e.code === 'ArrowRight') t0 -= 5000;
    if (e.code === 'ArrowLeft') t0 += 5000;
  });
  const loop = () => {
    if (!paused) { pv = ((performance.now() - t0) / 1000) % duration; frame(pv); }
    requestAnimationFrame(loop);
  };
  loop();
}
