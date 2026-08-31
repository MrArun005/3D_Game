/**
 * Preset swatches.
 *
 * A skin entry is the *bright-tail target* the face repaint aims at, not a flat
 * fill: the painted brows, lashes and lips survive because only the gain that
 * lands bare skin on this colour is applied.
 */
export const SKIN = [
  { id: 'porcelain', hex: 0xf3d9c8 },
  { id: 'fair',      hex: 0xe9c3a6 },
  { id: 'olive',     hex: 0xcfa077 },
  { id: 'tan',       hex: 0xa8734c },
  { id: 'brown',     hex: 0x7d4f31 },
  { id: 'deep',      hex: 0x4e2f1e },
];

export const HAIR = [
  { id: 'black',    hex: 0x1c1a19 },
  { id: 'darkbrown',hex: 0x3b2a20 },
  { id: 'brown',    hex: 0x6b4630 },
  { id: 'auburn',   hex: 0x8c4426 },
  { id: 'blonde',   hex: 0xc9a267 },
  { id: 'platinum', hex: 0xded3bd },
  { id: 'grey',     hex: 0x9a9691 },
];

export const EYE = [
  { id: 'brown', hex: 0x5a3a22 },
  { id: 'hazel', hex: 0x8a6b34 },
  { id: 'amber', hex: 0xb07b2a },
  { id: 'green', hex: 0x4d7a45 },
  { id: 'blue',  hex: 0x4a7a9b },
  { id: 'grey',  hex: 0x7f8a90 },
];

/**
 * Face "structure". These are expression shapes held at a constant value — the
 * rig has no bone or morph for nose width or cheekbone height, so this is an
 * approximation and is labelled as one in the UI.
 */
export const FACE_PRESETS = {
  neutral:  {},
  strong:   { browDownLeft: 0.35, browDownRight: 0.35, mouthShrugUpper: 0.15, jawForward: 0.30 },
  soft:     { browInnerUp: 0.25, cheekPuff: 0.22, mouthShrugLower: 0.18 },
  gaunt:    { cheekSquintLeft: 0.45, cheekSquintRight: 0.45, noseSneerLeft: 0.15, noseSneerRight: 0.15 },
  wide:     { cheekPuff: 0.55, jawForward: 0.15 },
  surprised:{ browInnerUp: 0.7, browOuterUpLeft: 0.6, browOuterUpRight: 0.6, eyeWideLeft: 0.5, eyeWideRight: 0.5, jawOpen: 0.25 },
};

export const BUILD_PRESETS = {
  average: {},
  tall:    { height: 1.06, legs: 1.04 },
  short:   { height: 0.93 },
  broad:   { shoulders: 1.12, chest: 1.08, arms: 1.05 },
  slight:  { shoulders: 0.92, chest: 0.94, arms: 0.96 },
  bighead: { head: 1.12 },
};
