import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PropertyBinding } from 'three';
import { clipForSpeed, clipRate, aimAngles, blendTo, Roster, OFFICER_MODEL } from '../src/world/officerSkinned.js';

/** The glTF JSON chunk of the shipped model. */
function modelJson() {
  const path = 'public/models' + OFFICER_MODEL.replace('/models', '');
  const buf = fs.readFileSync(path);
  return { path, json: JSON.parse(buf.slice(20, 20 + buf.readUInt32LE(12)).toString('utf8')) };
}

/* What is NOT covered here: everything that needs a GPU or a GLB -- the bone
   override itself, the kit's placement on the bones, the material tint and the
   mixer. Those are the maintainer's play-test. What IS covered is the maths
   the officer is wrong-looking BECAUSE of when it is wrong: clip choice, aim
   angles, the blend ramp, the pool's bookkeeping, and that the base model is
   actually a rig (the file the brief named is not). */

test('clip choice follows the hero rule: the run clip above 2.4 m/s, played slower', () => {
  assert.equal(clipForSpeed(0), 'idle');
  assert.equal(clipForSpeed(0.3), 'idle');
  assert.equal(clipForSpeed(1.2), 'walk');
  assert.equal(clipForSpeed(2.4), 'walk');
  assert.equal(clipForSpeed(3.2), 'run');
  // the whole point of the rule: a 3.2 m/s jog is a SLOW run, not a fast walk
  const jog = clipRate(3.2, clipForSpeed(3.2));
  assert.ok(jog < 1 && jog > 0.55, `a jog should play the run clip below 1x, got ${jog}`);
  assert.ok(clipRate(3.2, 'walk') > 1.4, 'the walk clip would have to be sped up past 1.4x, which is the speed-walk');
});

test('clip rate is clamped and idle never changes pace', () => {
  assert.equal(clipRate(0, 'idle'), 1);
  assert.equal(clipRate(99, 'idle'), 1);
  assert.equal(clipRate(0.4, 'walk'), 0.55);
  assert.equal(clipRate(99, 'run'), 1.45);
  assert.ok(Math.abs(clipRate(5.2, 'run') - 1) < 1e-9, 'the run clip is authored for 5.2 m/s');
});

test('aim angles are signed in the officer\'s own frame', () => {
  // facing +X, target straight ahead
  let a = aimAngles(0, 1.3, 0, 10, 1.3, 0, 1, 0);
  assert.ok(Math.abs(a.yaw) < 1e-9);
  assert.ok(Math.abs(a.pitch) < 1e-9);
  assert.ok(Math.abs(a.dist - 10) < 1e-9);
  // facing +X, target at -Z is a +90 deg turn about +Y
  a = aimAngles(0, 1.3, 0, 0, 1.3, -10, 1, 0);
  assert.ok(Math.abs(a.yaw - Math.PI / 2) < 1e-6, `expected +pi/2, got ${a.yaw}`);
  // and +Z is the other way
  a = aimAngles(0, 1.3, 0, 0, 1.3, 10, 1, 0);
  assert.ok(Math.abs(a.yaw + Math.PI / 2) < 1e-6);
  // the same target from a body already turned to it is straight ahead again
  a = aimAngles(0, 1.3, 0, 0, 1.3, -10, 0, -1);
  assert.ok(Math.abs(a.yaw) < 1e-6);
  // a target above him pitches up, below pitches down, and behind still resolves
  assert.ok(aimAngles(0, 1.3, 0, 10, 6.3, 0, 1, 0).pitch > 0.4);
  assert.ok(aimAngles(0, 1.3, 0, 10, -3.7, 0, 1, 0).pitch < -0.4);
  assert.ok(Math.abs(Math.abs(aimAngles(0, 1.3, 0, -10, 1.3, 0, 1, 0).yaw) - Math.PI) < 1e-6);
});

test('the aim blends in over its ramp instead of snapping', () => {
  let w = 0;
  w = blendTo(w, 1, 1 / 60, 0.2);
  assert.ok(w > 0 && w < 0.15, `one frame should be a fraction of the way up, got ${w}`);
  for (let i = 0; i < 60; i++) w = blendTo(w, 1, 1 / 60, 0.2);   // a second later
  assert.ok(w > 0.99, `after a second the weapon is up, got ${w}`);
  for (let i = 0; i < 60; i++) w = blendTo(w, 0, 1 / 60, 0.2);
  assert.ok(w < 0.01, 'and it comes back down');
  assert.equal(blendTo(0, 1, 0.5, 0.2), 1, 'a frame longer than the ramp lands on the target, never past it');
  assert.equal(blendTo(0.3, 1, 0.016, 0), 1, 'a zero ramp is a snap, not a divide by zero');
});

test('the pool hands out each rig once and says no when it is full', () => {
  const r = new Roster(4);
  const taken = [r.take(), r.take(), r.take(), r.take()];
  assert.deepEqual(taken, [0, 1, 2, 3]);
  assert.equal(r.out, 4);
  assert.equal(r.take(), -1, 'a fifth officer keeps the primitive model');
  r.free(2);
  assert.equal(r.out, 3);
  assert.equal(r.take(), 2, 'the freed rig is the next one out');
  assert.equal(r.take(), -1);
  r.free(99); r.free(-1);                     // out of range is ignored, not a crash
  assert.equal(r.out, 4);
});

test('a pool of none never hands out a rig (?skinnedcops=0 stays on the primitives)', () => {
  const r = new Roster(0);
  assert.equal(r.size, 0);
  assert.equal(r.take(), -1);
});

test('the base model is actually a rig with the clips the officer plays', () => {
  /* The brief named navy_jacket.glb. It has no skin and no animations, so it
     can carry neither a mixer nor a bone override -- this asserts the file we
     did pick still does, so a re-ingest that flattens it fails here and not in
     the browser. */
  const { path, json } = modelJson();
  assert.ok((json.skins || []).length >= 1, `${path} carries no skin`);
  const names = (json.animations || []).map((a) => a.name.toLowerCase());
  for (const tail of ['idle', 'walk', 'run', 'death']) {
    assert.ok(names.some((n) => n.endsWith(tail)), `${path} has no ${tail} clip (has: ${names.join(',')})`);
  }
  const bones = new Set((json.nodes || []).map((n) => n.name));
  for (const b of ['Head', 'Torso', 'Hips', 'UpperArm.R', 'LowerArm.R', 'Palm.R', 'UpperArm.L', 'LowerArm.L']) {
    assert.ok(bones.has(b), `${path} has no ${b} bone`);
  }
});

test('the bone names the class looks up are what the loader actually makes of them', () => {
  /* The rig ships `UpperArm.R`; GLTFLoader runs every node name through
     PropertyBinding.sanitizeNodeName, which strips the dot, so the class reads
     `bones.UpperArmR` (character.js documents the same trap for the retarget
     map). Get this wrong and EVERY lookup is undefined, with no error anywhere:
     the officer just stands in his idle clip with the gun pointing nowhere. */
  const { json } = modelJson();
  const loaded = new Set((json.nodes || []).map((n) => PropertyBinding.sanitizeNodeName(n.name)));
  for (const b of ['Head', 'Torso', 'Hips', 'Neck',
                   'UpperArmR', 'LowerArmR', 'PalmR', 'UpperArmL', 'LowerArmL', 'PalmL']) {
    assert.ok(loaded.has(b), `no bone loads as ${b} (got: ${[...loaded].join(',')})`);
  }
});
