import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * The elevated metro. Two lines follow the two longest arterials on a
 * viaduct 12.5 m up, offset to one side of the carriageway so the piers land
 * on the pavement edge: deck, piers every 18 m, two rails, a station platform
 * with a roof every ~350 m. One merged mesh per line for concrete, one for
 * steel. A three-car subway train (Kenney Train Kit, CC0) runs each line end
 * to end at 15 m/s, pauses 6 s at stations and turns back at the ends.
 */
const DECK_Y = 12.5, PIER_EVERY = 18, STATION_EVERY = 350, SPEED = 15, DWELL = 6;
/* Trains per line. With one train on a 3 km line a spot on the viaduct saw a
   train every four minutes, which reads as an empty flyover; four spaced
   evenly bring that under a minute. Each is two carriages. */
const TRAINS = 4, CARS = 2;
const TRAIN = '/models/vendor/kenney/train/';

export class Metro {
  constructor(scene, district, assets) {
    this.scene = scene; this.district = district;
    this.lines = [];
    const roads = (district.data?.roads || []).filter((r) => r.class === 'arterial' && r.points.length >= 3);
    const withLen = roads.map((r) => ({ r, len: r.points.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - r.points[i][0], p[1] - r.points[i][1]), 0) }))
      .sort((a, b) => b.len - a.len);
    const concrete = new THREE.MeshStandardMaterial({ color: 0x9a978f, roughness: 0.85 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.45, metalness: 0.6 });
    for (const { r, len } of withLen) {
      if (len < 150) continue;
      if (this.lines.length >= 4) break;
      this.lines.push(this.#build(r, len, concrete, steel));
    }
    this.#loadTrains();
  }

  #build(road, len, concrete, steel) {
    const half = road.width / 2 + 4.5;               // viaduct centreline: just off the carriageway
    const pts = [], cum = [0];
    for (let i = 0; i < road.points.length - 1; i++) {
      const a = road.points[i], b = road.points[i + 1];
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
      const nx = -dz / L, nz = dx / L;
      pts.push([a[0] + nx * half, a[1] + nz * half]);
      if (i === road.points.length - 2) pts.push([b[0] + nx * half, b[1] + nz * half]);
      cum.push(cum[cum.length - 1] + L);
    }
    const conc = [], stl = [];
    const box = (w, h, d, x, y, z, yaw) => { const g = new THREE.BoxGeometry(w, h, d); g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1))); return g; };
    const stations = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz), yaw = Math.atan2(-dz, dx), mx = (ax + bx) / 2, mz = (az + bz) / 2;
      conc.push(box(L, 0.9, 4.2, mx, DECK_Y, mz, yaw));                       // deck
      conc.push(box(L, 0.6, 0.3, mx, DECK_Y + 0.7, mz + 0, yaw));              // parapet (centre; cheap)
      for (const side of [-1, 1]) stl.push(box(L, 0.16, 0.12, mx + Math.sin(yaw) * side * 0.72, DECK_Y + 0.55, mz + Math.cos(yaw) * side * 0.72, yaw));   // rails
      for (let t = PIER_EVERY / 2; t < L; t += PIER_EVERY) {
        const px = ax + dx / L * t, pz = az + dz / L * t;
        const gy = this.district.elevationAt(px, pz);
        conc.push(box(1.3, DECK_Y - gy, 1.3, px, gy + (DECK_Y - gy) / 2, pz, yaw));
      }
    }
    // stations along the arc length
    for (let s = STATION_EVERY * 0.6; s < len - 60; s += STATION_EVERY) {
      const p = this.#at(pts, cum, s), q = this.#at(pts, cum, s + 1);
      const yaw = Math.atan2(-(q.z - p.z), q.x - p.x);
      conc.push(box(40, 0.5, 3.0, p.x + Math.sin(yaw) * 3.4, DECK_Y + 0.5, p.z + Math.cos(yaw) * 3.4, yaw));   // platform beside the track
      conc.push(box(40, 0.3, 4.5, p.x + Math.sin(yaw) * 3.0, DECK_Y + 5.2, p.z + Math.cos(yaw) * 3.0, yaw));   // roof
      for (const t of [-18, 0, 18]) stl.push(box(0.3, 4.6, 0.3, p.x + Math.cos(yaw) * t + Math.sin(yaw) * 4.6, DECK_Y + 2.8, p.z - Math.sin(yaw) * t + Math.cos(yaw) * 4.6, yaw));
      stations.push(s);
    }
    const mk = (parts, mat) => { const g = mergeGeometries(parts, false); const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; this.scene.add(m); return m; };
    mk(conc, concrete); mk(stl, steel);
    const trains = [];
    for (let i = 0; i < TRAINS; i++) trains.push({ s: 40 + (len - 80) * (i + 0.5) / TRAINS, dir: i % 2 ? -1 : 1, dwell: 0, cars: [] });
    return { pts, cum, len, stations, trains };
  }

  #at(pts, cum, s) {
    s = Math.max(0, Math.min(cum[cum.length - 1], s));
    let i = 0; while (i < cum.length - 2 && cum[i + 1] < s) i++;
    const t = (s - cum[i]) / ((cum[i + 1] - cum[i]) || 1);
    return { x: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, z: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t };
  }

  async #loadTrains() {
    const loader = new GLTFLoader();
    const gltf = await new Promise((res, rej) => loader.load('/models/metro/train_ride.glb', res, undefined, rej)).catch(() => null);
    let template = null;
    if (gltf) {
      const STATION_PARTS = [
        'station', 'platform', 'track', 'rail', 'waiting', 'pillar', 'plane',
        'trash', 'shed', 'celing', 'drain', 'post'
      ];
      gltf.scene.traverse((o) => {
        const name = (o.name || '').toLowerCase();
        // the train's own 'top rails' and 'back platform' carry the station words too
        if (!name.includes('train') && STATION_PARTS.some((p) => name.includes(p))) {
          o.visible = false;
        } else if (o.isMesh) {
          o.castShadow = false;
          o.receiveShadow = true;
          o.frustumCulled = false;
          if (o.material) {
            o.material.envMapIntensity = 1.3;
            if (o.material.emissive || o.material.emissiveMap) {
              o.material.emissiveIntensity = 2.4;
            }
          }
        }
      });
      const box = new THREE.Box3();
      gltf.scene.traverse((o) => {
        if (o.isMesh && o.visible) box.expandByObject(o);
      });
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const len = Math.max(size.x, size.z);
      const s = len > 0 ? 14 / len : 1;
      template = new THREE.Group();
      gltf.scene.position.set(-center.x, -box.min.y, -center.z);
      template.add(gltf.scene);
      template.scale.setScalar(s);
    }

    for (const line of this.lines) for (const tr of line.trains) {
      for (let i = 0; i < CARS; i++) {
        const car = template ? template.clone(true) : new THREE.Mesh(new THREE.BoxGeometry(14, 3.8, 3.2), new THREE.MeshStandardMaterial({ color: 0xd8dde4 }));
        this.scene.add(car);
        tr.cars.push(car);
      }
    }
  }

  update(dt) {
    for (const line of this.lines) for (const l of line.trains) {
      const { pts, cum, len, stations } = line;
      if (l.dwell > 0) { l.dwell -= dt; } else {
        const before = l.s;
        l.s += l.dir * SPEED * dt;
        if (l.s > len - 40 || l.s < 40) { l.dir *= -1; l.s = Math.max(40, Math.min(len - 40, l.s)); l.dwell = DWELL; }
        for (const st of stations) if ((before - st) * (l.s - st) <= 0 && before !== l.s) { l.dwell = DWELL; l.s = st; }
      }
      l.cars.forEach((car, i) => {
        const s = l.s - l.dir * i * 14.8;
        const p = this.#at(pts, cum, s), q = this.#at(pts, cum, s + l.dir * 2);
        car.position.set(p.x, DECK_Y + 0.65, p.z);
        car.rotation.y = Math.atan2(-(q.z - p.z), q.x - p.x) + Math.PI / 2;
      });
    }
  }
}
