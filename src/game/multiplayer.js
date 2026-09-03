import * as THREE from 'three';
import { joinRoom, selfId } from 'trystero/nostr';
import { buildStuntGeometries, buildMaterials } from '../vehicle/model.js';

/**
 * Play with a friend, over a link.
 *
 * Peer-to-peer over public relays, so there is no server of ours to run: the
 * room is just a string in the URL. Open ?room=whatever, send that URL to
 * someone, and you are both in the same city.
 *
 * What travels is only the things you cannot recompute: where each player's
 * car is and what it is doing. Traffic, pedestrians, signals and police stay
 * local and identical because they are already derived from the same district
 * file and the same clock -- syncing 96 pedestrians would cost far more than
 * it would add, and it is not what makes racing a friend fun.
 *
 * Packets are sent at a fixed 15Hz and every remote car is drawn one interval
 * BEHIND the newest packet it has, interpolating between the last two. That
 * one-frame-of-latency trade is what turns a teleporting box into a car.
 */

const APP_ID = 'halstead-bay-v1';
const SEND_HZ = 15;
const BUFFER_MS = 1000 / SEND_HZ;      // how far behind live we render peers

export class Multiplayer {
  constructor(scene, roomId) {
    this.scene = scene;
    this.roomId = roomId;
    this.peers = new Map();            // id -> { mesh, buf: [{t,...}] }
    this.selfId = selfId;
    this.connected = 0;
    this.seed = hashSeed(roomId);      // both ends generate the same course
    this.acc = 0;

    this.geo = buildStuntGeometries();
    this.mats = buildMaterials();

    this.room = joinRoom({ appId: APP_ID }, roomId);

    /* Trystero 0.25 returns an ACTION OBJECT, not the old [send, get] tuple,
       and peer callbacks are assigned rather than called. Destructuring the
       old shape threw "object is not iterable" and killed the join silently. */
    this.state = this.room.makeAction('s');
    this.raceAction = this.room.makeAction('race');
    this.chatAction = this.room.makeAction('chat');
    this.lastChatSendTime = 0;

    this.state.onMessage = (data, ctx) => {
      const id = ctx?.peerId ?? ctx;
      const p = this.#peer(id);
      p.buf.push({ t: performance.now(), ...data });
      if (p.buf.length > 6) p.buf.shift();
    };
    this.raceAction.onMessage = (msg) => { if (this.onRace) this.onRace(msg); };

    this.chatAction.onMessage = (data, ctx) => {
      // Untrusted payload verification
      if (!data || typeof data !== 'object') return;
      if (typeof data.text !== 'string') return;
      const clean = data.text.trim().slice(0, 120);
      if (!clean) return;

      const id = ctx?.peerId ?? ctx ?? 'PEER';
      const tag = String(id).slice(0, 4).toUpperCase();
      if (this.onChatMessage) {
        this.onChatMessage(clean, tag, 'PEER');
      }
    };

    this.room.onPeerJoin = (id) => {
      this.connected = Object.keys(this.room.getPeers()).length;
      if (this.onChatMessage) {
        const tag = String(id).slice(0, 4).toUpperCase();
        this.onChatMessage(`Player [${tag}] joined the city.`, null, 'SYSTEM');
      }
    };
    this.room.onPeerLeave = (id) => {
      const p = this.peers.get(id);
      if (p) { this.scene.remove(p.mesh); this.peers.delete(id); }
      this.connected = Object.keys(this.room.getPeers()).length;
      if (this.onChatMessage) {
        const tag = String(id).slice(0, 4).toUpperCase();
        this.onChatMessage(`Player [${tag}] left the city.`, null, 'SYSTEM');
      }
    };
  }

  /**
   * Broadcast a chat message to all peers with flood control and length capping.
   */
  sendChat(text) {
    if (!text || typeof text !== 'string') return;
    const clean = text.trim().slice(0, 120);
    if (!clean) return;

    const now = performance.now();
    if (now - this.lastChatSendTime < 500) return; // rate limit 500ms
    this.lastChatSendTime = now;

    this.chatAction.send({ text: clean });
  }

  #peer(id) {
    let p = this.peers.get(id);
    if (p) return p;
    // a peer looks like a traffic car, painted from a hash of their id so it
    // is stable between sessions and different from yours
    const mesh = new THREE.Mesh(this.geo.sedan.body, this.mats.stunt.clone());
    mesh.material.color.setHSL((hashSeed(id) % 360) / 360, 0.55, 0.45);
    mesh.castShadow = true;
    mesh.add(new THREE.Mesh(this.geo.sedan.glass, this.mats.glass));
    mesh.add(new THREE.Mesh(this.geo.sedan.occupant,
      new THREE.MeshStandardMaterial({ color: 0x2c3a4e, roughness: 0.85 })));
    const tag = makeTag(id.slice(0, 4).toUpperCase());
    tag.position.y = 2.3;
    mesh.add(tag);
    this.scene.add(mesh);
    p = { mesh, buf: [] };
    this.peers.set(id, p);
    return p;
  }

  /** Where every other player is right now, for the minimap. */
  others() {
    const out = [];
    for (const p of this.peers.values()) {
      const m = p.mesh;
      if (m.visible) out.push({ x: m.position.x, z: m.position.z });
    }
    return out;
  }

  update(car, dt) {
    this.acc += dt;
    if (this.acc >= 1 / SEND_HZ) {
      this.acc = 0;
      this.state.send({
        x: +car.x.toFixed(2), z: +car.z.toFixed(2), y: +(car.y || 0).toFixed(2),
        w: +car.yaw.toFixed(3), s: +car.steer.toFixed(2),
        b: car.brake > 0.3 ? 1 : 0,
      });
    }

    // draw everyone one packet-interval in the past, between their last two
    const now = performance.now() - BUFFER_MS;
    for (const p of this.peers.values()) {
      const b = p.buf;
      if (b.length < 2) { p.mesh.visible = b.length > 0; if (b.length) apply(p.mesh, b[0], b[0], 0); continue; }
      let i = b.length - 1;
      while (i > 0 && b[i - 1].t > now) i--;
      const a = b[Math.max(0, i - 1)], c = b[i];
      const span = Math.max(1, c.t - a.t);
      const k = Math.max(0, Math.min(1, (now - a.t) / span));
      p.mesh.visible = true;
      apply(p.mesh, a, c, k);
    }
  }

  /** Tell the other side something about the race. */
  race(msg) { this.raceAction.send(msg); }

  leave() {
    for (const p of this.peers.values()) this.scene.remove(p.mesh);
    this.peers.clear();
    this.room.leave();
  }
}

function apply(mesh, a, c, k) {
  mesh.position.set(a.x + (c.x - a.x) * k, a.y + (c.y - a.y) * k, a.z + (c.z - a.z) * k);
  // shortest way round, or a car crossing the +/-PI seam spins the long way
  let d = c.w - a.w;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  mesh.rotation.y = a.w + d * k;
}

/** A readable name plate that always faces the camera. */
function makeTag(text) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(10,14,20,0.72)';
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#ffd98a';
  g.font = '700 34px ui-sans-serif,system-ui,sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, toneMapped: false }));
  s.scale.set(2.6, 0.65, 1);
  return s;
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** The room in the URL, or null for single player. */
export function roomFromUrl() {
  return new URLSearchParams(location.search).get('room');
}

/** Make one up and put it in the address bar without reloading. */
export function createRoom() {
  const id = Math.random().toString(36).slice(2, 8);
  const u = new URL(location.href);
  u.searchParams.set('room', id);
  history.replaceState(null, '', u);
  return id;
}
