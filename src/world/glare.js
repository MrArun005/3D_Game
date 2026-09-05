/**
 * Glare sprites on every light head -- the GTA V trick (Schreibt, "Underestimated
 * Glow"; see docs/GTA-VISUALS-RESEARCH.md). Bloom alone dies with distance: a
 * lamp 200 m away is one bright pixel and blurs to nothing. GTA puts two
 * counter-rotating glare billboards on every small light, so distant lamps
 * stay visible and shimmer. Here: ONE Points object per chunk (one draw), a
 * point at every lamp head and kanban, sized in metres with attenuation, an
 * additive SpriteNodeMaterial (an instanced THREE.Sprite: WebGPU draws Points
 * at one pixel, so sized point sprites are impossible) whose colour node samples a streak texture
 * twice at opposite rotations (the shimmer) over a soft disc. Routed into the
 * emissive target so the core also blooms. Fades in with the night through
 * one shared uniform (`setGlareNight`).
 */
import * as THREE from 'three';
import { uv, texture, uniform, time, float, vec2, vec3, vec4, instancedBufferAttribute, sin, cos, smoothstep, length, cameraPosition, select, abs, max } from 'three/tsl';
import { glow } from '../core/additive.js';

const glareNight = uniform(0);
export function setGlareNight(k) { glareNight.value = Math.max(0, Math.min(1, k)); }
/* The detailed ring: far sprites inside it collapse to nothing, because the
   chunk there carries its own (depth-pulled) glare on the real lamp head. */
const ringCentre = uniform(vec3(0, 0, 0)), ringR = uniform(1e9);
export function setGlareRing(x, z, r) { ringCentre.value.set(x, 0, z); ringR.value = r; }

let TEX = null;

/* 128^2: six thin streaks through the centre with a soft falloff. The disc is
   done in the shader (length of the uv), so the texture only carries streaks. */
function streakTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 128, 128);
  g.translate(64, 64);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) {
    const grad = g.createLinearGradient(-64, 0, 64, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(0.5, 'rgba(255,255,255,0.9)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.rotate(Math.PI / 6);
    g.fillRect(-64, i % 2 ? -1.2 : -0.7, 128, i % 2 ? 2.4 : 1.4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function glareMaterial(posAttr, colAttr, phAttr, far = false) {
  TEX ??= streakTexture();
  const m = new THREE.SpriteNodeMaterial({
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false,
  });
  const pos = instancedBufferAttribute(posAttr), colour = instancedBufferAttribute(colAttr), ph = instancedBufferAttribute(phAttr);
  if (far) {
    /* The far set covers the WHOLE district; inside the detailed ring the chunk's
       own sprite takes over, so these scale to zero there (a uniform, no matrix
       rewrites -- unlike #cullFar's stand-ins). No depth pull: no head to hide in. */
    const d = pos.sub(ringCentre);
    const inside = max(abs(d.x), abs(d.z)).lessThan(ringR);
    m.positionNode = pos;
    m.scaleNode = select(inside, vec2(0), vec2(2.6));
  } else {
    /* The head position is the CENTRE of the lamp cap / kanban it belongs to, so a
       plain depth test loses the sprite inside its own head. Pull it 0.8 m toward
       the camera: still hidden by a building in front, never by the head itself. */
    m.positionNode = pos.add(cameraPosition.sub(pos).normalize().mul(0.8));
    m.scaleNode = vec2(3.6);   // metres (size attenuation is the sprite's own perspective)
  }
  const c = uv().sub(0.5);
  const rot = (ang) => vec2(c.x.mul(cos(ang)).sub(c.y.mul(sin(ang))), c.x.mul(sin(ang)).add(c.y.mul(cos(ang)))).add(0.5);
  const a = time.mul(0.45).add(ph);
  const streaks = texture(TEX, rot(a)).r.add(texture(TEX, rot(a.negate().mul(1.3))).r).mul(0.5);
  const disc = smoothstep(float(0.5), float(0.05), length(c));          // soft halo, 1 at the centre
  const core = smoothstep(float(0.16), float(0.0), length(c));          // hot centre, blooms
  const sh = disc.mul(disc).mul(0.7).add(streaks.mul(0.9)).add(core.mul(1.2));
  const col = colour.mul(sh).mul(glareNight);
  m.colorNode = vec4(col, 1);   // additive: colour is the whole contribution
  /* NOT additive()'s zero-normal guard: on a quad a zero normal reads as full
     occlusion to GTAO and the sprite draws as a black square (seen 2026-09-05;
     the rule in core/additive.js). glow() keeps the real normal and routes the
     output into the emissive target so the hot core blooms. */
  glow(m, 0.6);
  return m;
}

/**
 * An instanced Sprite for one chunk (or, `far`, for the whole district's lamps). `heads`: [{x,y,z,colour?}] world positions;
 * lamp heads without a colour glow sodium. Returns null for an empty list
 * (a zero-count buffer is a WebGPU error, see districtWorld's inst guard).
 */
export function buildGlare(heads, seed = 1, far = false) {
  if (!heads.length) return null;
  const n = heads.length;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), ph = new Float32Array(n);
  const c = new THREE.Color();
  heads.forEach((h, i) => {
    pos[i * 3] = h.x; pos[i * 3 + 1] = h.y; pos[i * 3 + 2] = h.z;
    c.setHex(h.colour ?? 0xffb060);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    ph[i] = ((seed * 7919 + i * 104729) % 628) / 100;
  });
  const posAttr = new THREE.InstancedBufferAttribute(pos, 3), colAttr = new THREE.InstancedBufferAttribute(col, 3), phAttr = new THREE.InstancedBufferAttribute(ph, 1);
  const sp = new THREE.Sprite(glareMaterial(posAttr, colAttr, phAttr, far));
  sp.count = n;
  sp.frustumCulled = false;      // bundle contents are culled as a chunk
  sp.renderOrder = 3;
  return sp;
}
