// Whiteboard story 1: "Flight 1549: how an airliner became a glider".
// Everything is timed in seconds. Shared by the page and tools/audio.mjs.
import * as I from './ink.js';

export const FPS = 30;
export const WIPES = [8, 20, 34, 50, 62, 72];   // the eraser sweeps the board at these times
export const WIPE_DUR = 0.9;
export const DURATION = 84.5;

// Board items: shapes and writing. t0 = start, dur = how long the marker takes.
export const ITEMS = [];
const S = (t0, dur, shape) => ITEMS.push({ kind: 'shape', t0, dur, shape });
const T = (t0, dur, text, x, y, size = 40, color = 'black', align = 'center') =>
  ITEMS.push({ kind: 'text', t0, dur, text, x, y, size, color: I.COLORS[color], align });
// A shape that slides along a path after it is drawn (the little glider).
const MOVER = [];

// 1 · title
T(1.2, 1.6, 'FLIGHT 1549', 640, 200, 88, 'red');
T(3.0, 2.0, 'How an airliner became a glider', 640, 290, 48, 'blue');
S(5.0, 0.6, I.line([330, 322], [950, 322], 'blue', 5));
T(5.4, 1.2, '15 January 2009 · New York', 640, 380, 30, 'black');

// 2 · the strike
S(9.0, 2.4, I.airliner(700, 300, 1.3));
T(11.4, 1.2, '15:27 · 2,800 ft', 700, 130, 40);
[[1040, 220], [1110, 250], [1000, 270], [1160, 300], [1070, 310]].forEach(([x, y], i) => S(12.3 + i * 0.16, 0.25, I.goose(x, y)));
S(13.3, 0.5, I.arrow([[1010, 300], [870, 338]], 'orange', 5));
S(14.0, 0.4, I.burst(716, 344, 58, 'orange', 6));
T(14.5, 1.4, 'BOTH ENGINES: NO THRUST', 985, 480, 36, 'red');

// 3 · the glide
S(21.0, 0.8, I.line([420, 80], [420, 350], 'grey', 4));
S(21.8, 0.9, I.line([420, 350], [1190, 350], 'black', 5));
S(22.8, 1.5, I.line([420, 80], [1190, 350], 'orange', 7));
T(24.4, 0.8, '≈ 930 m', 440, 230, 38, 'black', 'left');
T(24.9, 0.6, '(3,000 ft)', 440, 266, 26, 'grey', 'left');
T(25.3, 0.8, '≈ 15 km', 1060, 400, 38);
T(26.0, 1.0, '17 : 1', 930, 180, 76, 'red');
MOVER.push({ t0: 24.3, t1: 33.5, from: [420, 80], to: [1190, 350], k: 0.36 });

// 4 · the options
const vriver = (x) => { const p = []; for (let y = 90; y <= 570; y += 8) p.push([x + Math.sin(y / 70) * 10, y]); return p; };
S(35.0, 0.6, I.poly(vriver(565), 'blue', 4));
S(35.6, 0.6, I.poly(vriver(640), 'blue', 4));
S(36.2, 0.8, I.poly([[660, 170], [745, 120], [770, 560], [690, 560], [660, 170]], 'grey', 4));
T(36.9, 0.6, 'Manhattan', 800, 540, 24, 'grey', 'left');
S(37.2, 0.5, I.rect(990, 190, 110, 70, 'black', 4));
T(37.6, 0.7, 'LaGuardia', 1045, 180, 30);
S(38.2, 0.5, I.rect(150, 200, 110, 70, 'black', 4));
T(38.6, 0.7, 'Teterboro', 205, 190, 30);
S(39.2, 0.3, I.ellipse(602, 132, 14, 14, 'black', 5));
T(39.4, 0.4, '1549', 602, 104, 26, 'black');
S(39.9, 0.8, I.curve([615, 128], [900, 20], [1030, 188], 'red', 5));
S(40.8, 0.8, I.curve([588, 128], [400, 110], [262, 225], 'orange', 5));
S(41.7, 0.6, I.arrow([[602, 150], [602, 500]], 'green', 6));
S(43.0, 0.4, I.cross(1045, 225, 34));
T(43.4, 0.9, 'too late to turn', 1045, 312, 28, 'red');
S(44.6, 0.4, I.cross(205, 235, 34));
T(45.0, 0.7, 'too far', 205, 322, 28, 'red');
S(46.2, 0.4, I.check(650, 450, 32));
T(46.6, 1.2, 'long · flat · boats', 602, 610, 30, 'green');

// 5 · the ditching
S(51.0, 1.2, I.wave(150, 1130, 440, 7, 60, 'blue', 5));
S(52.2, 2.2, I.airliner(660, 385, 1.4, -0.166));
S(54.4, 0.6, I.line([280, 408], [1060, 408], 'grey', 3));
S(54.9, 0.5, I.ellipse(420, 408, 300, 300, 'red', 4, -0.166, 0));
T(55.2, 0.5, '9.5°', 732, 448, 30, 'red', 'left');
T(55.8, 0.8, '• wings level', 180, 150, 34, 'black', 'left');
T(56.6, 0.8, '• nose up about 9.5°', 180, 200, 34, 'black', 'left');
T(57.4, 0.8, '• about 125 knots', 180, 250, 34, 'black', 'left');
T(58.2, 0.8, '• tail touches first', 180, 300, 34, 'black', 'left');

// 6 · the rescue
S(63.0, 1.0, I.wave(150, 1130, 440, 7, 60, 'blue', 5));
S(63.8, 1.5, I.airliner(640, 405, 0.8));
[560, 585, 610, 690, 715].forEach((x, i) => S(65.3 + i * 0.1, 0.12, I.ellipse(x, 400, 5, 5, 'orange', 5)));
S(65.9, 0.6, I.boat(330, 430, 1.1));
S(66.5, 0.6, I.boat(960, 430, 1.1));
S(67.1, 0.6, I.boat(470, 480, 0.8, 'red'));
T(67.6, 1.4, '155 / 155 rescued', 640, 200, 64, 'green');
S(69.1, 0.4, I.check(960, 180, 34));

// 7 · the lessons
T(73.0, 1.0, 'LESSONS', 640, 130, 64, 'red');
[200, 290, 380].forEach((y, i) => S(74.2 + i * 0.3, 0.35, I.checkbox(330, y, 40)));
T(75.2, 1.2, 'Fly the plane first', 400, 232, 40, 'black', 'left');
S(76.5, 0.35, I.check(350, 218, 22));
T(76.9, 1.3, 'Teamwork and checklists', 400, 322, 40, 'black', 'left');
S(78.3, 0.35, I.check(350, 308, 22));
T(78.7, 1.3, 'Pick the best option you have', 400, 412, 40, 'black', 'left');
S(80.1, 0.35, I.check(350, 398, 22));

export { MOVER };
export const sceneOf = (t) => WIPES.filter((w) => w <= t).length;
for (const it of ITEMS) it.scene = sceneOf(it.t0);
for (const m of MOVER) m.scene = sceneOf(m.t0);

// What the critter says. Typed at TYPE_RATE characters a second.
export const TYPE_RATE = 30;
export const BUBBLES = [
  { t0: 5.8, t1: 7.9, text: 'Let’s draw it out!' },
  { t0: 16.0, t1: 19.8, text: 'Uh-oh. Geese went into both engines!' },
  { t0: 27.4, t1: 33.8, text: 'The wings still work! Every metre of height buys about 17 metres forward.' },
  { t0: 47.8, t1: 49.8, text: 'Pick the best option you have!' },
  { t0: 59.0, t1: 61.8, text: 'Level, nose up, slow... splash!' },
  { t0: 69.6, t1: 71.8, text: 'Everyone made it home!' },
  { t0: 80.6, t1: 83.4, text: 'See you in the next story!' },
];

// The critter: where it stands, when it walks, hops and points.
export const WALKS = [
  { t0: 0.0, t1: 2.2, x0: -140, x1: 190 },
  { t0: 20.9, t1: 21.8, x0: 190, x1: 150 },
  { t0: 34.9, t1: 35.8, x0: 150, x1: 110 },
  { t0: 50.9, t1: 51.8, x0: 110, x1: 150 },
  { t0: 81.8, t1: 84.2, x0: 150, x1: 1450 },
];
export const HOPS = [14.0, 14.45, 16.3, 26.1, 46.4, 69.2, 69.65, 70.1, 80.2];
export const POINTS = [{ t0: 27.0, t1: 33.6 }, { t0: 42.2, t1: 47.4 }, { t0: 55.8, t1: 58.9 }];
export const critterX = (t) => {
  let x = WALKS[0].x0;
  for (const w of WALKS) {
    if (t >= w.t1) x = w.x1;
    else if (t >= w.t0) return { x: w.x0 + (w.x1 - w.x0) * (t - w.t0) / (w.t1 - w.t0), walking: true, dir: Math.sign(w.x1 - w.x0) };
  }
  return { x, walking: false, dir: 1 };
};
