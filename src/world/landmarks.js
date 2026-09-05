import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Landmarks: one-off set pieces the owner brought in (Sketchfab), placed on
 * the empty lot that fits them best in the district they belong to. Whole
 * textured models, drawn once, so a city of repeating kit gets a few places
 * you recognise: the gun shop, the supermarket, the street corner set.
 * Scaled by footprint fit (uniform), base on the kerb, faced to the block.
 * No collision yet: the hull collider only knows footprints from the file.
 */
const BASE = '/models/vendor/sketchfab/props/';
const LANDMARKS = [
  { file: 'gun-shop',    district: 'OLD QUARTER',  minW: 8,  name: "Schneider's Guns" },
  { file: 'supermarket', district: 'THE FLATS',    minW: 30, name: 'Flats Supermarket' },
  { file: 'street-set',  district: 'VELLERY ROW',  minW: 12, name: 'Vellery corner' },
  {
    file: '/models/vendor/kenney/commercial/building-skyscraper-d.glb',
    district: 'KINGSWAY',
    minW: 24,
    targetW: 28,
    name: 'Kingsway Apex Tower',
  },
  {
    file: '/models/vendor/kenney/industrial/water-tower.glb',
    district: 'STEELGATE',
    minW: 20,
    targetW: 22,
    name: 'Steelgate Waterworks & Silo',
  },
  {
    file: '/models/vendor/kenney/industrial/windmill.glb',
    district: 'HARBOUR POINT',
    minW: 20,
    targetW: 20,
    name: 'Harbour Point Turbine & Signal',
  },
];

export class Landmarks {
  constructor(scene, district) {
    this.scene = scene; this.district = district; this.placed = [];
    this.#buildTokyoArch();
    this.#buildHalsteadLiftBridge();
    this.#place();
  }

  async #place() {
    const loader = new GLTFLoader();
    const used = new Set();
    await Promise.all(LANDMARKS.map(async (lm) => {
      const lots = this.district.blocks.filter((b) => (b.type === 'lot' || b.type === 'vacant') && b.district === lm.district && !used.has(b) && Math.min(b.w, b.h) >= lm.minW)
        .sort((a, b) => Math.min(a.w, a.h) - Math.min(b.w, b.h));
      const lot = lots[0] ?? this.district.blocks.filter((b) => (b.type === 'lot' || b.type === 'vacant') && !used.has(b) && Math.min(b.w, b.h) >= lm.minW).sort((a, b) => Math.min(a.w, a.h) - Math.min(b.w, b.h))[0];
      if (!lot) { console.warn('landmark: no lot for', lm.file); return; }
      used.add(lot);
      const path = lm.file.startsWith('/') ? lm.file : BASE + lm.file + '.glb';
      let gltf; try { gltf = await new Promise((res, rej) => loader.load(path, res, undefined, rej)); } catch (e) { console.warn('landmark', lm.file, e.message); return; }
      const obj = gltf.scene;
      obj.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(obj), size = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
      const maxK = lm.maxScale ?? 1.6;
      const k = lm.targetW ? (lm.targetW / size.x) : Math.min((lot.w - 3) / size.x, (lot.h - 3) / size.z, maxK);        // fit the lot or scale to target dimension
      const wrap = new THREE.Group();
      obj.position.set(-c.x, -bb.min.y, -c.z);
      wrap.add(obj);
      wrap.scale.setScalar(k);
      wrap.position.set(lot.x, 0.15, lot.y);
      wrap.rotation.y = lot.angle;
      wrap.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.scene.add(wrap);
      this.placed.push({ ...lm, x: lot.x, z: lot.y, scale: k });
      console.info(`landmark ${lm.name} at ${lot.x | 0},${lot.y | 0} (${lm.district}) x${k.toFixed(2)}`);
    }));

    // Place high-detail scanned characters as street walkers / pedestrians
    const STREET_PEOPLE = [
      { file: '/models/characters/cowboy.glb', x: 28, z: 12, yaw: 0.4, name: 'Cowboy on Sidewalk' },
      { file: '/models/characters/navy_jacket.glb', x: 18, z: 15, yaw: -1.2, name: 'Navy Jacket Pedestrian' },
      { file: '/models/characters/cowboy.glb', x: -35, z: 25, yaw: 1.8, name: 'Cowboy at Corner' },
    ];
    for (const sp of STREET_PEOPLE) {
      try {
        const gltf = await new Promise((res, rej) => loader.load(sp.file, res, undefined, rej));
        const obj = gltf.scene;
        obj.updateMatrixWorld(true);
        const bb = new THREE.Box3().setFromObject(obj);
        const h = bb.max.y - bb.min.y || 1;
        const scale = 1.78 / h;
        obj.scale.setScalar(scale);
        obj.position.set(sp.x, -bb.min.y * scale + 0.15, sp.z);
        obj.rotation.y = sp.yaw;
        obj.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
        this.scene.add(obj);
        console.info(`street walker: ${sp.name} at ${sp.x},${sp.z}`);
      } catch (e) {
        console.warn('street walker', sp.file, e.message);
      }
    }
  }

  #buildTokyoArch() {
    const group = new THREE.Group();
    const vermilionMat = new THREE.MeshStandardMaterial({
      color: 0xcc1a24,
      roughness: 0.42,
      metalness: 0.1,
    });
    const darkWoodMat = new THREE.MeshStandardMaterial({
      color: 0x1c1816,
      roughness: 0.65,
      metalness: 0.05,
    });
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xf5b722,
      roughness: 0.28,
      metalness: 0.8,
    });

    // Two main vertical Torii columns spanning the street (27m clear span across Road 168)
    const span = 27.0;
    for (const s of [-span / 2, span / 2]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.82, 10.5, 14), vermilionMat);
      col.position.set(s, 5.25, 0);
      col.castShadow = true; col.receiveShadow = true;

      // Base stone footings on sidewalk
      const baseStone = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.2, 1.2, 14), darkWoodMat);
      baseStone.position.set(s, 0.6, 0);
      baseStone.receiveShadow = true;

      // Gold capital ring
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.25, 14), goldMat);
      ring.position.set(s, 8.8, 0);

      group.add(col, baseStone, ring);
    }

    // Lower crossbeam (Nuki)
    const nuki = new THREE.Mesh(new THREE.BoxGeometry(span + 2.4, 0.68, 0.85), vermilionMat);
    nuki.position.set(0, 7.8, 0);
    nuki.castShadow = true;
    group.add(nuki);

    // Upper crossbeam (Kasagi) with curved tips
    const kasagi = new THREE.Mesh(new THREE.BoxGeometry(span + 4.8, 0.95, 1.15), vermilionMat);
    kasagi.position.set(0, 9.8, 0);
    kasagi.castShadow = true;
    group.add(kasagi);

    // Top lintel cap
    const capRoof = new THREE.Mesh(new THREE.BoxGeometry(span + 5.5, 0.26, 1.45), darkWoodMat);
    capRoof.position.set(0, 10.35, 0);
    group.add(capRoof);

    // Center illuminated Tokyo Street neon sign
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0a0812';
    ctx.fillRect(0, 0, 1024, 256);
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 12;
    ctx.strokeRect(8, 8, 1008, 240);
    ctx.fillStyle = '#ff007f';
    ctx.fillRect(20, 20, 984, 12);
    ctx.font = '900 86px "Hiragino Kaku Gothic Pro", "Noto Sans JP", -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 24;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('新宿通り · TOKYO STREET · 歌舞伎町', 512, 142);
    const signTex = new THREE.CanvasTexture(canvas);
    signTex.colorSpace = THREE.SRGBColorSpace;

    const signMat = new THREE.MeshStandardMaterial({
      map: signTex,
      emissiveMap: signTex,
      emissive: 0xffffff,
      emissiveIntensity: 3.2,
      roughness: 0.2,
    });

    // Core board backing
    const signBoard = new THREE.Mesh(new THREE.BoxGeometry(9.6, 1.85, 0.32), darkWoodMat);
    signBoard.position.set(0, 8.8, 0);
    group.add(signBoard);

    // South-facing panel (seen by cars approaching from South / spawn looking North)
    const southPanel = new THREE.Mesh(new THREE.PlaneGeometry(9.4, 1.65), signMat);
    southPanel.position.set(0, 8.8, -0.17);
    southPanel.rotation.y = Math.PI;
    southPanel.scale.x = -1; // Keep text reading left-to-right from perspective of approaching driver
    group.add(southPanel);

    // North-facing panel (seen by cars driving South)
    const northPanel = new THREE.Mesh(new THREE.PlaneGeometry(9.4, 1.65), signMat);
    northPanel.position.set(0, 8.8, 0.17);
    group.add(northPanel);

    // Hanging lanterns with warm golden glow spaced across the avenue
    const lanternMat = new THREE.MeshStandardMaterial({
      color: 0xdd2211,
      emissive: 0xff4411,
      emissiveIntensity: 2.4,
      roughness: 0.35,
    });
    for (const lx of [-10.5, -6.5, -2.5, 2.5, 6.5, 10.5]) {
      const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.32, 0.72, 12), lanternMat);
      lantern.position.set(lx, 7.0, 0);
      group.add(lantern);
    }

    // Place across the main avenue (Road 168) at the entrance to Little Tokyo
    group.position.set(2356.5, 0, 1378.0);
    group.rotation.y = -0.03;
    this.scene.add(group);
    console.info('Tokyo Gateway Arch placed at 2356.5, 1378.0 across Tokyo Street (Road 168)');
  }

  #buildHalsteadLiftBridge() {
    const ax = 1939, az = 2317, bx = 1962, bz = 2698;
    const dx = bx - ax, dz = bz - az;
    const L = Math.hypot(dx, dz);
    const yaw = Math.atan2(dz, dx);
    const width = 26.0;
    const deckY = 7.6;

    const group = new THREE.Group();
    group.name = 'HalsteadLiftBridge';

    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x484f59,
      roughness: 0.42,
      metalness: 0.75,
    });
    const darkSteel = new THREE.MeshStandardMaterial({
      color: 0x272d36,
      roughness: 0.48,
      metalness: 0.82,
    });
    const pierMat = new THREE.MeshStandardMaterial({
      color: 0x7c7f86,
      roughness: 0.85,
      metalness: 0.12,
    });
    const beaconMat = new THREE.MeshStandardMaterial({
      color: 0xff1100,
      emissive: 0xff1100,
      emissiveIntensity: 3.8,
      roughness: 0.2,
    });
    const greenNavMat = new THREE.MeshStandardMaterial({
      color: 0x00ff66,
      emissive: 0x00ff66,
      emissiveIntensity: 3.2,
      roughness: 0.2,
    });
    const redNavMat = new THREE.MeshStandardMaterial({
      color: 0xff2200,
      emissive: 0xff2200,
      emissiveIntensity: 3.2,
      roughness: 0.2,
    });

    // 1. Dual Vertical Lift Towers flanking the navigation channel
    const towerPositions = [142, 238];
    const towerH = 34.0;
    const halfW = width / 2;

    for (const tPos of towerPositions) {
      const towerGroup = new THREE.Group();
      towerGroup.position.set(tPos, deckY, 0);

      // Deep concrete caisson footing under tower into riverbed
      for (const side of [-1, 1]) {
        const footing = new THREE.Mesh(new THREE.BoxGeometry(10.0, 11.6, 6.5), pierMat);
        footing.position.set(0, -5.8, side * (halfW + 1.2));
        footing.castShadow = true;
        footing.receiveShadow = true;
        towerGroup.add(footing);

        // River navigation hazard light on outer face of footing
        const navLight = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.4, 8), redNavMat);
        navLight.position.set(0, -1.8, side * (halfW + 4.5));
        towerGroup.add(navLight);
      }

      // Vertical steel columns on both sides of roadway (4 main columns per tower)
      for (const side of [-1, 1]) {
        const sideZ = side * (halfW + 1.2);
        for (const colX of [-3.8, 3.8]) {
          const col = new THREE.Mesh(new THREE.BoxGeometry(1.2, towerH, 1.2), steelMat);
          col.position.set(colX, towerH / 2, sideZ);
          col.castShadow = true;
          towerGroup.add(col);
        }

        // Side lattice cross-bracing (K-truss and X-braces between columns)
        for (let yLevel = 6; yLevel < towerH - 4; yLevel += 7) {
          const hBeam = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.55, 0.55), steelMat);
          hBeam.position.set(0, yLevel, sideZ);
          towerGroup.add(hBeam);

          const diag1 = new THREE.Mesh(new THREE.BoxGeometry(10.2, 0.35, 0.35), darkSteel);
          diag1.position.set(0, yLevel + 3.5, sideZ);
          diag1.rotation.z = Math.atan2(7.0, 7.6);
          towerGroup.add(diag1);

          const diag2 = new THREE.Mesh(new THREE.BoxGeometry(10.2, 0.35, 0.35), darkSteel);
          diag2.position.set(0, yLevel + 3.5, sideZ);
          diag2.rotation.z = -Math.atan2(7.0, 7.6);
          towerGroup.add(diag2);
        }

        // Tower top machinery penthouse
        const penthouse = new THREE.Mesh(new THREE.BoxGeometry(9.4, 3.2, 3.8), steelMat);
        penthouse.position.set(0, towerH + 1.6, sideZ);
        towerGroup.add(penthouse);

        // Counterweight sheaves (large cable pulley wheels)
        for (const sheaveX of [-2.6, 2.6]) {
          const sheave = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 0.45, 16), darkSteel);
          sheave.rotation.x = Math.PI / 2;
          sheave.position.set(sheaveX, towerH + 2.2, sideZ);
          towerGroup.add(sheave);
        }

        // Red aviation warning beacon on tower pinnacle
        const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), beaconMat);
        beacon.position.set(0, towerH + 4.2, sideZ);
        towerGroup.add(beacon);
      }

      // Overhead roadway portal crossbeam connecting the two towers (7.8m clearance above road)
      const portalBeam = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, width + 5.0), steelMat);
      portalBeam.position.set(0, 8.2, 0);
      portalBeam.castShadow = true;
      towerGroup.add(portalBeam);

      // Top overhead tie-strut across towers at Y = towerH
      const topTie = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.8, width + 5.0), steelMat);
      topTie.position.set(0, towerH, 0);
      towerGroup.add(topTie);

      // Overhead highway portal sign
      if (typeof document !== 'undefined') {
        const signCanvas = document.createElement('canvas');
        signCanvas.width = 1024; signCanvas.height = 256;
        const sctx = signCanvas.getContext('2d');
        sctx.fillStyle = '#0e1824';
        sctx.fillRect(0, 0, 1024, 256);
        sctx.strokeStyle = '#3fd2ff';
        sctx.lineWidth = 10;
        sctx.strokeRect(6, 6, 1012, 244);
        sctx.font = '900 62px system-ui, -apple-system, sans-serif';
        sctx.textAlign = 'center';
        sctx.textBaseline = 'middle';
        sctx.fillStyle = '#ffffff';
        sctx.shadowColor = '#00e5ff';
        sctx.shadowBlur = 18;
        sctx.fillText('HALSTEAD LIFT BRIDGE', 512, 90);
        sctx.font = '700 42px system-ui, -apple-system, sans-serif';
        sctx.fillStyle = '#39ffb0';
        sctx.shadowColor = '#39ffb0';
        sctx.shadowBlur = 12;
        sctx.fillText('VERTICAL CLEARANCE 7.6M · EST. 1928', 512, 168);

        const signTex = new THREE.CanvasTexture(signCanvas);
        signTex.colorSpace = THREE.SRGBColorSpace;
        const portalSignMat = new THREE.MeshStandardMaterial({
          map: signTex,
          emissiveMap: signTex,
          emissive: 0xffffff,
          emissiveIntensity: 2.4,
          roughness: 0.3,
        });

        for (const faceDir of [-1, 1]) {
          const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(16.0, 3.4), portalSignMat);
          signMesh.position.set(faceDir * 1.25, 8.2, 0);
          signMesh.rotation.y = faceDir > 0 ? Math.PI / 2 : -Math.PI / 2;
          towerGroup.add(signMesh);
        }
      }

      group.add(towerGroup);
    }

    // 2. Through-Truss framework along the river span (t = 68m to t = 312m)
    const trussStart = 68;
    const trussEnd = 312;
    const trussH = 5.2;
    const panelW = 8.0;

    for (let t = trussStart; t < trussEnd; t += panelW) {
      const segLen = Math.min(panelW, trussEnd - t);
      const segMid = t + segLen / 2;

      for (const side of [-1, 1]) {
        const sideZ = side * (halfW + 0.35);

        // Lower and upper chords (horizontal steel box beams)
        const topChord = new THREE.Mesh(new THREE.BoxGeometry(segLen, 0.45, 0.45), steelMat);
        topChord.position.set(segMid, deckY + trussH, sideZ);
        group.add(topChord);

        const bottomChord = new THREE.Mesh(new THREE.BoxGeometry(segLen, 0.45, 0.45), steelMat);
        bottomChord.position.set(segMid, deckY + 0.35, sideZ);
        group.add(bottomChord);

        // Vertical post
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, trussH, 0.4), steelMat);
        post.position.set(t, deckY + trussH / 2, sideZ);
        group.add(post);

        // Diagonal truss brace
        const diagLen = Math.hypot(segLen, trussH);
        const diag = new THREE.Mesh(new THREE.BoxGeometry(diagLen, 0.32, 0.32), darkSteel);
        diag.position.set(segMid, deckY + trussH / 2, sideZ);
        diag.rotation.z = (side > 0 ? 1 : -1) * Math.atan2(trussH, segLen);
        group.add(diag);
      }

      // Overhead sway frame struts across roadway every 16m
      if ((t - trussStart) % 16 < panelW) {
        const swayBeam = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, width + 0.7), steelMat);
        swayBeam.position.set(t, deckY + trussH, 0);
        group.add(swayBeam);
      }
    }

    // Center shipping navigation channel green beacon suspended from bridge center
    const centerSpanT = (towerPositions[0] + towerPositions[1]) / 2;
    const centerNavLight = new THREE.Mesh(new THREE.SphereGeometry(0.38, 10, 8), greenNavMat);
    centerNavLight.position.set(centerSpanT, deckY - 1.2, 0);
    group.add(centerNavLight);

    // Transform whole bridge group along Halstead Lift Bridge vector
    group.position.set(ax, 0, az);
    group.rotation.y = -yaw;
    this.scene.add(group);
    console.info('Halstead Lift Bridge 3D Architecture installed at', ax, az, 'length:', L);
  }
}
