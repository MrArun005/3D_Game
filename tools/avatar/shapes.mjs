/**
 * The 63 blendshapes these avatars carry: Apple's 52 ARKit shapes plus the 11
 * Oculus/Meta visemes. Order matters — it is the primitive's target order, and
 * it is the fallback when a GLB ships no `extras.targetNames` (the female copy
 * does not, so three.js builds no morphTargetDictionary for it).
 */
export const SHAPES = [
  'mouthOpen','mouthSmile','eyesClosed','eyesLookUp','eyesLookDown',
  'eyeBlinkLeft','eyeSquintLeft','eyeWideLeft',
  'eyeBlinkRight','eyeSquintRight','eyeWideRight',
  'jawForward','jawLeft','jawRight','jawOpen',
  'mouthClose','mouthFunnel','mouthPucker','mouthLeft','mouthRight',
  'mouthSmileLeft','mouthSmileRight','mouthFrownLeft','mouthFrownRight',
  'mouthDimpleLeft','mouthDimpleRight','mouthStretchLeft','mouthStretchRight',
  'mouthRollLower','mouthRollUpper','mouthShrugLower','mouthShrugUpper',
  'mouthPressLeft','mouthPressRight','mouthLowerDownLeft','mouthLowerDownRight',
  'mouthUpperUpLeft','mouthUpperUpRight',
  'browDownLeft','browDownRight','browInnerUp','browOuterUpLeft','browOuterUpRight',
  'cheekPuff','cheekSquintLeft','cheekSquintRight',
  'noseSneerLeft','noseSneerRight',
  'viseme_sil','viseme_PP','viseme_FF','viseme_TH','viseme_DD','viseme_kk',
  'viseme_CH','viseme_SS','viseme_nn','viseme_RR',
  'viseme_aa','viseme_E','viseme_I','viseme_O','viseme_U',
];

/**
 * Shapes grouped for a UI. `structure` is a deliberate misuse: these are
 * expression shapes held at a constant value to fake bone structure the rig
 * does not have. Honest label — there is no nose-width or cheek-bone slider in
 * this data, so this is the closest thing available.
 */
export const GROUPS = {
  structure: ['browInnerUp','browOuterUpLeft','browOuterUpRight','browDownLeft','browDownRight',
              'cheekPuff','cheekSquintLeft','cheekSquintRight',
              'noseSneerLeft','noseSneerRight','jawForward','mouthShrugUpper','mouthShrugLower'],
  expression: ['mouthSmile','mouthOpen','jawOpen','mouthFunnel','mouthPucker',
               'mouthFrownLeft','mouthFrownRight','mouthDimpleLeft','mouthDimpleRight',
               'mouthPressLeft','mouthPressRight'],
  eyes: ['eyesClosed','eyeBlinkLeft','eyeBlinkRight','eyeSquintLeft','eyeSquintRight',
         'eyeWideLeft','eyeWideRight','eyesLookUp','eyesLookDown'],
  visemes: SHAPES.filter(s => s.startsWith('viseme_')),
};
