// Film 2, "Why everyone survived": Spark, a loading spark, walks through the
// physics and decisions of Flight 1549 over the same 3D world.
// Shots, speech bubbles and diagrams, shared by the page and tools/audio-lesson.mjs.
import { lerp, clamp, STRIKE_FT, DITCH_FT } from './timeline.js';

const linear = (a, b) => (u) => a + (b - a) * u;
export const LESSON_SHOTS = [
  { name: 'intro',   cam: 'title',  dur: 7,  ft: () => 0 },
  { name: 'glide',   cam: 'mayday', dur: 11, ft: linear(150, 186) },
  { name: 'options', cam: 'map',    dur: 13, ft: () => 165 },
  { name: 'apu',     cam: 'tail',   dur: 9,  ft: linear(STRIKE_FT + 2, STRIKE_FT + 12) },
  { name: 'river',   cam: 'river',  dur: 10, ft: linear(282, 331) },
  { name: 'ditch',   cam: 'ditch',  dur: 12, ft: (u) => u < 0.45 ? lerp(333, DITCH_FT - 0.4, u / 0.45) : lerp(DITCH_FT - 0.4, 362, (u - 0.45) / 0.55) },
  { name: 'rescue',  cam: 'evac',   dur: 10, ft: linear(375, 640) },
  { name: 'lessons', cam: 'end',    dur: 10, ft: linear(640, 780) },
];
{
  let t = 0;
  for (const s of LESSON_SHOTS) { s.start = t; t += s.dur; }
}
export const LESSON_DURATION = LESSON_SHOTS.reduce((a, s) => a + s.dur, 0);

export function lessonShotAt(v) {
  let s = LESSON_SHOTS[0];
  for (const x of LESSON_SHOTS) if (v >= x.start) s = x;
  const u = clamp((v - s.start) / s.dur, 0, 1);
  return { shot: s, u, local: v - s.start, ft: s.ft(u) };
}

// What Spark says. a/b are seconds inside the shot.
export const BUBBLES = [
  { shot: 'intro', a: 2.6, b: 6.8, text: 'Hi, I’m Spark! Let’s work out why every single person survived Flight 1549.' },
  { shot: 'glide', a: 0.4, b: 5.3, text: 'Both engines are gone. So what keeps a 70-tonne airliner in the sky?' },
  { shot: 'glide', a: 5.5, b: 10.9, text: 'Its wings! With no thrust it becomes a glider, trading height for distance: about 17 m forward for every 1 m down.' },
  { shot: 'options', a: 0.4, b: 6.2, text: 'From about 3,000 ft that is roughly 15 km of glide in still air. But every turn burns height.' },
  { shot: 'options', a: 6.4, b: 12.9, text: 'LaGuardia meant a U-turn; Teterboro was further. Simulator tests later showed LaGuardia only worked if the turn began at once, with no time to think.' },
  { shot: 'apu', a: 0.4, b: 8.9, text: 'Seconds after the strike, the captain started the APU, a small engine in the tail. It kept the electrics and the flight computers’ protections alive.' },
  { shot: 'river', a: 0.4, b: 9.8, text: 'Why the Hudson? It is long and straight, with no bridges downstream of the GWB, and it is busy with boats that can help fast.' },
  { shot: 'ditch', a: 0.4, b: 5.2, text: 'Landing on water is all about attitude: wings level, nose up about 9.5°, as slow as possible, about 125 knots.' },
  { shot: 'ditch', a: 6.6, b: 11.9, text: 'Nose up, the tail meets the water first. Level wings keep either tip from digging in and cartwheeling the aircraft.' },
  { shot: 'rescue', a: 0.4, b: 9.8, text: 'The crew got everyone out onto the wings and rafts. Ferries arrived within about four minutes. All 155 were rescued.' },
];
// Diagrams / cards, same timing convention.
export const PANELS = [
  { shot: 'glide', a: 5.6, b: 10.9, id: 'd-glide' },
  { shot: 'ditch', a: 0.4, b: 5.4, id: 'd-attitude' },
  { shot: 'lessons', a: 0.3, b: 9.7, id: 'd-lessons' },
];
for (const list of [BUBBLES, PANELS]) for (const c of list) {
  const s = LESSON_SHOTS.find((x) => x.name === c.shot);
  c.t0 = s.start + c.a; c.t1 = s.start + c.b;
}
export const TYPE_RATE = 34;   // characters per second while Spark talks
export const talkEnd = (c) => c.t0 + c.text.length / TYPE_RATE;
