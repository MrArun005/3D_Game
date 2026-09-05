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
/* DECK_Y was 12.5: lower reads closer to the street and bridge decks are 7.6, so it clears.
   DWELL was 6 s: Arun wants trains always moving and always in view, so short stops,
   six trains a line, and one waiting at the spawn platform on boot. */
const DECK_Y = 10.5, PIER_EVERY = 18, STATION_EVERY = 350, SPEED = 15, DWELL = 3;
/* Trains per line. With one train on a 3 km line a spot on the viaduct saw a
   train every four minutes, which reads as an empty flyover; four spaced
   evenly bring that under a minute. Each is two carriages. */
const TRAINS = 6, CARS = 2;
const TRAIN = '/models/vendor/kenney/train/';

export class Metro {
  constructor(scene, district, assets) {
    this.scene = scene; this.district = district;
    this.lines = [];
    this.stationXZ = [];   // every platform, for the spawn and the map
    /* Lines: the two longest arterials, plus every road that carries one of
       the ten bridges (Arun, 2026-09-03: "metros on every flyover"). A road
       carries a bridge when the span's midpoint and both ends lie on it. */
    const polyLen = (pts) => pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
    const segD = (p, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz); };
    const polyD = (p, pts) => Math.min(...pts.slice(1).map((q, i) => segD(p, pts[i], q)));
    const carries = (r, br) => { const a = br.points[0], b = br.points.at(-1), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; return polyD(mid, r.points) < 8 && polyD(a, r.points) < 12 && polyD(b, r.points) < 12; };
    const all = (district.data?.roads || []).filter((r) => r.points.length >= 2 && r.class !== 'ramp' && r.class !== 'freeway');
    const bridged = new Set(all.filter((r) => (district.data?.bridges || []).some((br) => carries(r, br))));
    const roads = all.filter((r) => (r.class === 'arterial' && r.points.length >= 3) || bridged.has(r));
    const withLen = roads.map((r) => ({ r, len: polyLen(r.points), bridged: bridged.has(r) }))
      .sort((a, b) => b.len - a.len);
    const concrete = new THREE.MeshStandardMaterial({ color: 0x9a978f, roughness: 0.85 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.45, metalness: 0.6 });
    let plain = 0;
    for (const { r, len, bridged: onBridge } of withLen) {
      if (len < 150) continue;
      if (!onBridge && plain >= 2) continue;   // two long arterials, then only bridge-carrying roads
      if (!onBridge) plain++;
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
      // Skip station platforms and roofs on bridges or elevated ramps to prevent floating box clutter
      if (this.district.elevationAt(p.x, p.z) > 0.5) continue;
      const yaw = Math.atan2(-(q.z - p.z), q.x - p.x);
      conc.push(box(40, 0.5, 3.0, p.x + Math.sin(yaw) * 3.4, DECK_Y + 0.5, p.z + Math.cos(yaw) * 3.4, yaw));   // platform beside the track
      conc.push(box(40, 0.3, 4.5, p.x + Math.sin(yaw) * 3.0, DECK_Y + 5.2, p.z + Math.cos(yaw) * 3.0, yaw));   // roof
      for (const t of [-18, 0, 18]) stl.push(box(0.3, 4.6, 0.3, p.x + Math.cos(yaw) * t + Math.sin(yaw) * 4.6, DECK_Y + 2.8, p.z - Math.sin(yaw) * t + Math.cos(yaw) * 4.6, yaw));
      stations.push(s);
      this.stationXZ.push({ x: p.x, z: p.z });
    }
    const mk = (parts, mat) => { const g = mergeGeometries(parts, false); g.computeBoundingSphere(); const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; m.frustumCulled = true; this.scene.add(m); return m; };
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
    const gltf = await new Promise((res, rej) => loader.load('/models/metro/train_ride.glb?v=4', res, undefined, rej)).catch(() => null);
    let template = null;
    if (gltf) {
      const STATION_PARTS = [
        'station', 'platform', 'track', 'rail', 'waiting', 'pillar', 'plane',
        'trash', 'shed', 'celing', 'drain', 'post'
      ];
      gltf.scene.traverse((o) => {
        const name = (o.name || '').toLowerCase();
        if (STATION_PARTS.some((p) => name.includes(p))) {   // 'back platform' etc. are station pieces even when their material is the train's
          o.visible = false;
        }
      });
      gltf.scene.updateMatrixWorld(true);

      const box = new THREE.Box3();
      gltf.scene.traverse((o) => {
        if (o.isMesh && o.visible) box.expandByObject(o);
      });
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const len = Math.max(size.x, size.z);
      const s = len > 0 ? 22 / len : 1;   // 22 m carriages (Arun: bigger); 14 read as a toy, 18 still small beside the towers

      const offsetMatrix = new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z);
      const byMaterial = new Map();
      gltf.scene.traverse((o) => {
        if (!o.isMesh || !o.visible || !o.material) return;
        let list = byMaterial.get(o.material);
        if (!list) byMaterial.set(o.material, (list = []));
        const worldM = o.matrixWorld.clone().premultiply(offsetMatrix);
        const g = o.geometry.clone().applyMatrix4(worldM);
        const keep = new THREE.BufferGeometry();
        for (const k of ['position', 'normal', 'uv']) {
          if (g.attributes[k]) keep.setAttribute(k, g.attributes[k]);
        }
        if (g.index) keep.setIndex(g.index);
        list.push(keep.index ? keep.toNonIndexed() : keep);
      });

      template = new THREE.Group();
      for (const [mat, geos] of byMaterial) {
        const merged = mergeGeometries(geos, false);
        for (const g of geos) g.dispose();
        if (!merged) continue;
        merged.computeBoundingSphere();
        if (mat) {
          mat.envMapIntensity = 1.0;
          if (mat.emissive || mat.emissiveMap) mat.emissiveIntensity = 0.5;
        }
        const m = new THREE.Mesh(merged, mat);
        m.castShadow = false;
        m.receiveShadow = true;
        m.frustumCulled = true;
        template.add(m);
      }
      template.scale.setScalar(s);
    }

    const lodTemplate = this.#createBoxLod();

    for (const line of this.lines) for (const tr of line.trains) {
      for (let i = 0; i < CARS; i++) {
        const carGroup = new THREE.Group();
        const high = template ? template.clone(true) : lodTemplate.clone(true);
        const lod = lodTemplate.clone(true);
        lod.visible = false;
        carGroup.add(high);
        carGroup.add(lod);
        carGroup.userData = { high, lod };
        this.scene.add(carGroup);
        tr.cars.push(carGroup);
      }
    }
  }

  #createBoxLod() {
    const lodGroup = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd0d5dd, roughness: 0.35, metalness: 0.7 });
    const windowMat = new THREE.MeshStandardMaterial({ color: 0x111822, roughness: 0.2, metalness: 0.8 });
    const underMat = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.8, metalness: 0.5 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x889098, roughness: 0.7 });

    // Subway car body: width X=3.1, height Y=3.2, length Z=21.8
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.1, 3.2, 21.8), bodyMat);
    body.position.y = 2.0;
    body.receiveShadow = true;
    lodGroup.add(body);

    // Windows band: slightly wider X=3.16 to avoid z-fighting, height Y=1.0, length Z=20.5
    const win = new THREE.Mesh(new THREE.BoxGeometry(3.16, 1.0, 20.5), windowMat);
    win.position.y = 2.4;
    lodGroup.add(win);

    // Undercarriage: X=2.6, Y=0.7, Z=19.0
    const under = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.7, 19.0), underMat);
    under.position.y = 0.4;
    lodGroup.add(under);

    // Roof AC pods
    const ac1 = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.35, 4.0), roofMat);
    ac1.position.set(0, 3.75, 4.5);
    const ac2 = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.35, 4.0), roofMat);
    ac2.position.set(0, 3.75, -4.5);
    lodGroup.add(ac1);
    lodGroup.add(ac2);

    return lodGroup;
  }

  /** Nearest platform to a point, or null before any line was built. */
  nearestStation(x, z) {
    let best = null, bd = Infinity, line = null, s = 0;
    for (const l of this.lines) for (let i = 0; i < l.stations.length; i++) {
      const p = this.#at(l.pts, l.cum, l.stations[i]);
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) { bd = d; best = { x: p.x, z: p.z }; line = l; s = l.stations[i]; }
    }
    // park that line's nearest train at the platform, so the first frame has a train in it
    if (line) { const tr = line.trains.reduce((a, t) => Math.abs(t.s - s) < Math.abs(a.s - s) ? t : a); tr.s = s; tr.dwell = DWELL * 2; }
    return best;
  }

  update(dt, camPos = null) {
    for (const line of this.lines) for (const l of line.trains) {
      const { pts, cum, len, stations } = line;
      if (l.dwell > 0) { l.dwell -= dt; } else {
        const before = l.s;
        l.s += l.dir * SPEED * dt;
        if (l.s > len - 40 || l.s < 40) { l.dir *= -1; l.s = Math.max(40, Math.min(len - 40, l.s)); l.dwell = DWELL; }
        for (const st of stations) if ((before - st) * (l.s - st) <= 0 && before !== l.s) { l.dwell = DWELL; l.s = st; }
      }
      l.cars.forEach((car, i) => {
        const s = l.s - l.dir * i * 22.8;
        const p = this.#at(pts, cum, s), q = this.#at(pts, cum, s + l.dir * 2);
        car.position.set(p.x, DECK_Y + 0.65, p.z);
        car.rotation.y = Math.atan2(-(q.z - p.z), q.x - p.x) + Math.PI / 2;

        if (camPos) {
          const dx = p.x - camPos.x, dz = p.z - camPos.z;
          const dist2 = dx * dx + dz * dz;
          if (dist2 > 400 * 400) {
            car.visible = false;
          } else {
            car.visible = true;
            const useLod = dist2 > 150 * 150;
            if (car.userData?.high && car.userData?.lod) {
              car.userData.high.visible = !useLod;
              car.userData.lod.visible = useLod;
            }
          }
        }
      });
    }
  }
}
