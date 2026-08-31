/**
 * Humanoid skeleton and procedural skinning.
 *
 * Joint names follow the **Mixamo convention** deliberately. Mixamo's free
 * animation library is authored on exactly this hierarchy in a T-pose, so a
 * clip downloaded from there retargets onto this rig with no bone mapping —
 * which is the whole reason the rest pose here is a T-pose rather than the
 * A-pose that would be slightly easier to model.
 *
 * Skinning is computed, not painted: each vertex takes the two nearest bone
 * SEGMENTS (not joint points — a point test puts the whole forearm on the
 * elbow) and blends by inverse distance with a falloff. That gives clean
 * single-bone interiors and a smooth band across every joint.
 */

/** Rest pose for a 1.75 m reference figure. Everything scales from here. */
export const REST = [
  // name,                    parent,               x,     y,     z
  ['Hips',                    null,                 0,     0.980, 0],
  ['Spine',                   'Hips',               0,     1.075, 0],
  ['Spine1',                  'Spine',              0,     1.190, 0],
  ['Spine2',                  'Spine1',             0,     1.310, 0],
  ['Neck',                    'Spine2',             0,     1.455, 0],
  ['Head',                    'Neck',               0,     1.545, 0],
  ['HeadTop_End',             'Head',               0,     1.750, 0],

  ['LeftShoulder',            'Spine2',             0.045, 1.415, 0],
  ['LeftArm',                 'LeftShoulder',       0.175, 1.415, 0],
  ['LeftForeArm',             'LeftArm',            0.455, 1.415, 0],
  ['LeftHand',                'LeftForeArm',        0.715, 1.415, 0],
  ['LeftHand_End',            'LeftHand',           0.895, 1.415, 0],

  ['RightShoulder',           'Spine2',            -0.045, 1.415, 0],
  ['RightArm',                'RightShoulder',     -0.175, 1.415, 0],
  ['RightForeArm',            'RightArm',          -0.455, 1.415, 0],
  ['RightHand',               'RightForeArm',      -0.715, 1.415, 0],
  ['RightHand_End',           'RightHand',         -0.895, 1.415, 0],

  ['LeftUpLeg',               'Hips',               0.092, 0.940, 0],
  ['LeftLeg',                 'LeftUpLeg',          0.098, 0.520, 0],
  ['LeftFoot',                'LeftLeg',            0.100, 0.085, 0],
  ['LeftToeBase',             'LeftFoot',           0.100, 0.022, 0.105],
  ['LeftToe_End',             'LeftToeBase',        0.100, 0.020, 0.185],

  ['RightUpLeg',              'Hips',              -0.092, 0.940, 0],
  ['RightLeg',                'RightUpLeg',        -0.098, 0.520, 0],
  ['RightFoot',               'RightLeg',          -0.100, 0.085, 0],
  ['RightToeBase',            'RightFoot',         -0.100, 0.022, 0.105],
  ['RightToe_End',            'RightToeBase',      -0.100, 0.020, 0.185],
];

export const PREFIX = 'mixamorig:';

/**
 * Bone segments that actually deform geometry. An End joint terminates a chain
 * and is not a segment, but it defines where the last real bone points.
 */
const SEGMENTS = [
  ['Hips', 'Spine'], ['Spine', 'Spine1'], ['Spine1', 'Spine2'], ['Spine2', 'Neck'],
  ['Neck', 'Head'], ['Head', 'HeadTop_End'],
  ['LeftShoulder', 'LeftArm'], ['LeftArm', 'LeftForeArm'],
  ['LeftForeArm', 'LeftHand'], ['LeftHand', 'LeftHand_End'],
  ['RightShoulder', 'RightArm'], ['RightArm', 'RightForeArm'],
  ['RightForeArm', 'RightHand'], ['RightHand', 'RightHand_End'],
  ['LeftUpLeg', 'LeftLeg'], ['LeftLeg', 'LeftFoot'], ['LeftFoot', 'LeftToeBase'],
  ['RightUpLeg', 'RightLeg'], ['RightLeg', 'RightFoot'], ['RightFoot', 'RightToeBase'],
];

/** The bone a segment drives — the segment's own start joint. */
const segmentBone = ([a]) => a;

export class Rig {
  /** @param {(name:string, p:number[]) => number[]} place moves a rest joint */
  constructor(place = (_, p) => p) {
    this.order = REST.map(([n]) => n);
    this.parent = Object.fromEntries(REST.map(([n, p]) => [n, p]));
    this.world = {};
    for (const [name, , x, y, z] of REST) this.world[name] = place(name, [x, y, z]);
    this.index = Object.fromEntries(this.order.map((n, i) => [n, i]));
  }

  /** Local translation relative to the parent — what the glTF node carries. */
  local(name) {
    const p = this.parent[name];
    const w = this.world[name];
    if (!p) return [...w];
    const q = this.world[p];
    return [w[0] - q[0], w[1] - q[1], w[2] - q[2]];
  }

  /**
   * Weights for one vertex: the two nearest bone segments, inverse-distance
   * blended. `stiff` biases toward a single bone, which keeps a forearm from
   * picking up shoulder influence.
   */
  weigh(p, { stiff = 3.2, maxInfluence = 2 } = {}) {
    const scored = [];
    for (const seg of SEGMENTS) {
      const a = this.world[seg[0]], b = this.world[seg[1]];
      scored.push({ bone: segmentBone(seg), d: distToSegment(p, a, b) });
    }
    scored.sort((x, y) => x.d - y.d);
    const take = scored.slice(0, maxInfluence);
    const w = take.map((s) => 1 / Math.pow(Math.max(s.d, 0.004), stiff));
    const sum = w.reduce((a, b) => a + b, 0) || 1;
    const joints = [0, 0, 0, 0], weights = [0, 0, 0, 0];
    take.forEach((s, i) => { joints[i] = this.index[s.bone]; weights[i] = w[i] / sum; });
    return { joints, weights };
  }

  /** Rest-pose inverse bind matrices. The rest pose is translation only, so
   *  each one is just a translation by the negated world position. */
  inverseBind() {
    const out = new Float32Array(this.order.length * 16);
    this.order.forEach((n, i) => {
      const [x, y, z] = this.world[n];
      // column-major identity with -translation in the last column
      out.set([1,0,0,0, 0,1,0,0, 0,0,1,0, -x,-y,-z,1], i * 16);
    });
    return out;
  }
}

function distToSegment(p, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 0 ? (apx * abx + apy * aby + apz * abz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(apx - abx * t, apy - aby * t, apz - abz * t);
}
