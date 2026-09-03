import * as THREE from 'three';

/**
 * Crazy City Airspace:
 * 1. Dual Hollywood / Gotham Skyscraper Searchlights sweeping the sky
 * 2. Giant Illuminated Megacity Advertising Airship / Blimp
 */
export class Airspace {
  constructor(scene) {
    this.scene = scene;
    this.searchlights = [];
    this.blimp = null;
    this.tickerCanvas = null;
    this.tickerCtx = null;
    this.tickerTex = null;

    this.#buildSearchlights();
    this.#buildBlimp();
    console.info('airspace: 9 draws (2 searchlights, blimp hull, cabin, 4 fins, 2 tickers)');
  }

  #buildSearchlights() {
    // 2 skyscraper rooftops with massive searchlights
    const ROOF_SPOTS = [
      { x: 45, y: 75, z: -35 },
      { x: -55, y: 82, z: 45 },
    ];

    const beamGeo = new THREE.CylinderGeometry(0.4, 6.5, 120, 16, 1, true);
    beamGeo.translate(0, 60, 0);

    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x90d5ff,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    for (let i = 0; i < ROOF_SPOTS.length; i++) {
      const p = ROOF_SPOTS[i];
      const pivot = new THREE.Group();
      pivot.position.set(p.x, p.y, p.z);

      const beam = new THREE.Mesh(beamGeo, beamMat);
      pivot.add(beam);
      this.scene.add(pivot);

      this.searchlights.push({ pivot, phase: i * Math.PI, speed: 0.6 + i * 0.2 });
    }
  }

  #buildBlimp() {
    const group = new THREE.Group();
    group.position.set(0, 95, 0); // 95m up in the air

    // Hull: elongated spheroid
    const hullGeo = new THREE.SphereGeometry(12, 24, 16);
    hullGeo.scale(1.0, 1.0, 3.2); // 76m long airship

    const hullMat = new THREE.MeshStandardMaterial({
      color: 0x1a2130,
      roughness: 0.35,
      metalness: 0.2,
    });
    const hull = new THREE.Mesh(hullGeo, hullMat);
    group.add(hull);

    // Gondola cabin underneath
    const cabinGeo = new THREE.BoxGeometry(4, 2.5, 14);
    cabinGeo.translate(0, -12, 0);
    const cabinMat = new THREE.MeshStandardMaterial({ color: 0x333b4d });
    const cabin = new THREE.Mesh(cabinGeo, cabinMat);
    group.add(cabin);

    // Tail fins
    const finGeo = new THREE.BoxGeometry(0.4, 9, 7);
    const finMat = new THREE.MeshStandardMaterial({ color: 0xff3344 });
    const finTop = new THREE.Mesh(finGeo, finMat);
    finTop.position.set(0, 8, -32);
    const finBottom = new THREE.Mesh(finGeo, finMat);
    finBottom.position.set(0, -8, -32);
    const finLeft = new THREE.Mesh(finGeo, finMat);
    finLeft.rotation.z = Math.PI / 2;
    finLeft.position.set(8, 0, -32);
    const finRight = new THREE.Mesh(finGeo, finMat);
    finRight.rotation.z = Math.PI / 2;
    finRight.position.set(-8, 0, -32);
    group.add(finTop, finBottom, finLeft, finRight);

    // Scrolling LED Ticker along both sides of the blimp
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.tickerCanvas = canvas;
    this.tickerCtx = ctx;
    this.tickerTex = tex;

    const tickerMat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    const tickerGeo = new THREE.PlaneGeometry(42, 6);
    const tickerLeft = new THREE.Mesh(tickerGeo, tickerMat);
    tickerLeft.position.set(12.2, 0, 0);
    tickerLeft.rotation.y = Math.PI / 2;

    const tickerRight = new THREE.Mesh(tickerGeo, tickerMat);
    tickerRight.position.set(-12.2, 0, 0);
    tickerRight.rotation.y = -Math.PI / 2;

    group.add(tickerLeft, tickerRight);

    // Red/Green navigation strobe lights
    const strobeLight = new THREE.PointLight(0xff0033, 2.5, 30, 2);
    strobeLight.position.set(0, -14, 0);
    group.add(strobeLight);
    this.blimpStrobe = strobeLight;

    this.blimp = group;
    this.scene.add(group);
  }

  update(dt, time) {
    // 1. Sweep searchlights
    for (const sl of this.searchlights) {
      const a = time * sl.speed + sl.phase;
      sl.pivot.rotation.x = 0.4 + Math.sin(a * 0.7) * 0.35;
      sl.pivot.rotation.z = Math.cos(a) * 0.55;
    }

    // 2. Fly blimp in broad lazy circle above city
    if (this.blimp) {
      const blimpSpeed = 0.04;
      const r = 240;
      const theta = time * blimpSpeed;
      this.blimp.position.x = Math.cos(theta) * r;
      this.blimp.position.z = Math.sin(theta) * r;
      this.blimp.rotation.y = -theta + Math.PI / 2;

      // Strobe beacon blink
      if (this.blimpStrobe) {
        this.blimpStrobe.intensity = (Math.floor(time * 2) % 2 === 0) ? 3.0 : 0.2;
      }
    }

    // 3. Update LED ticker message
    if (this.tickerCanvas && this.tickerCtx && this.tickerTex) {
      const ctx = this.tickerCtx;
      const w = this.tickerCanvas.width, h = this.tickerCanvas.height;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = '#ffb300';
      ctx.font = '900 48px sans-serif';
      ctx.shadowColor = '#ff6600';
      ctx.shadowBlur = 16;

      const msg = "★ WELCOME TO HALSTEAD BAY ★ CRIME RATE: HIGH ★ WATCH THE SKIES ★ ENJOY NIGHTFALL DRIVE ★ ";
      const textW = ctx.measureText(msg).width;
      const offset = (time * 140) % textW;
      ctx.fillText(msg, -offset, 80);
      ctx.fillText(msg, -offset + textW, 80);
      this.tickerTex.needsUpdate = true;
    }
  }
}
