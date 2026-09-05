// tools/record-tour.mjs -- records a captioned feature tour to video/*.webm and
// writes report.json (per scene: console errors + facts from the ?debug hooks).
//
//   npm run build && npx vite preview --port 4173 &      # the PRODUCTION build: the dev
//                                                         # server's HMR reloads mid-tour
//   cd tools && npm i playwright && EXE="<Chrome for Testing binary>" node record-tour.mjs
//   ffmpeg -ss 20 -i video/*.webm -vf scale=1024:-2 -c:v libx264 -crf 27 tour.mp4
//
// Headed (headless: false): the headless screencast stalls on the WebGPU canvas
// and repeats frames for tens of seconds. EXE points Playwright at an installed
// Chrome for Testing when the library's own build is not downloaded.
// Records a feature tour of Halstead Bay from the preview server into a webm,
// one scene after another, and writes report.json: per scene, the console
// errors seen and a few facts read from the game's ?debug hooks.
import { chromium } from 'playwright';
import fs from 'node:fs';

const EXE = process.env.EXE;
const URL = 'http://localhost:4173/?debug';
const browser = await chromium.launch({ headless: false, executablePath: EXE, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: 'video', size: { width: 1280, height: 720 } } });
const page = await ctx.newPage();

const report = { scenes: [] };
let scene = null;
page.on('console', (m) => { if (m.type() === 'error' && scene) scene.errors.push(m.text().slice(0, 240)); });
page.on('pageerror', (e) => { if (scene) scene.errors.push('pageerror: ' + String(e).slice(0, 240)); });

const t0 = Date.now();
const wait = (ms) => page.waitForTimeout(ms);
const key = (code) => page.keyboard.press(code);
const hold = async (code, ms) => { await page.keyboard.down(code); await wait(ms); await page.keyboard.up(code); };
const ev = (fn, arg) => page.evaluate(fn, arg).catch((e) => ({ evalError: String(e).slice(0, 200) }));
async function begin(name) {
  if (scene) scene.end = (Date.now() - t0) / 1000;
  scene = { name, start: (Date.now() - t0) / 1000, errors: [], facts: {} };
  report.scenes.push(scene);
  await ev((n) => {
    let d = document.getElementById('rec-cap');
    if (!d) { d = document.createElement('div'); d.id = 'rec-cap'; d.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:99999;font:700 22px/1.2 ui-sans-serif,sans-serif;color:#fff;background:rgba(0,0,0,.55);padding:8px 16px;border-radius:10px;letter-spacing:.5px;pointer-events:none'; document.body.appendChild(d); }
    d.textContent = n;
  }, name);
  console.log(`[${scene.start.toFixed(1)}s] ${name}`);
}
const fact = async (k, fn) => { scene.facts[k] = await ev(fn); };

// ---- boot
await begin('Halstead Bay · boot');
await page.goto(URL);
await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 120000 }).catch(() => {});
await wait(1000);
await page.mouse.click(640, 360);
await wait(2500);
await fact('stats', () => document.getElementById('stats')?.textContent?.slice(0, 120));

// ---- 1 drive through Little Tokyo
await begin('Little Tokyo · driving, horn (I), camera (C)');
await hold('KeyW', 5000);
await key('KeyI'); await wait(800); await key('KeyI');
await hold('KeyW', 3000);
await key('KeyC'); await wait(2500); await key('KeyC'); await wait(2500); await key('KeyC'); await wait(1500);
await fact('car', () => { const c = window.__car(); return { x: Math.round(c.x), z: Math.round(c.z), kmh: Math.round((c.fwdSpeed || 0) * 3.6) }; });

// ---- 2 night + rain
await begin('Night · neon, kanban, lanterns, wires');
await ev(() => { window.__time(22.5); });
await hold('KeyW', 6000);
await key('KeyC'); await wait(3000);
await begin('Rain spell · wet road, fog, lightning');
await ev(() => { window.__rain(true); });
await hold('KeyW', 5000); await hold('KeyA', 800); await hold('KeyW', 5000);
await hold('KeyS', 1500);

// ---- 3 on foot, weapons
await begin('On foot · pistol, SMG, rifle, shotgun, sniper');
await key('KeyF'); await wait(2500);
for (const [k, label] of [['Digit1', 'pistol'], ['Digit2', 'smg'], ['Digit3', 'rifle'], ['Digit4', 'shotgun']]) {
  await ev((kind) => { window.__buyWeapon?.(kind, 0); }, label);
  await key(k); await wait(700);
  for (let i = 0; i < 3; i++) { await key('KeyE'); await wait(260); }
  await wait(700);
}
await ev(() => { window.__buyWeapon?.('sniper', 0); });
await key('Digit6'); await wait(800);
await ev(() => { window.__aim(true); }); await wait(1800);
await key('KeyE'); await wait(1400); await key('KeyE'); await wait(1400);
await ev(() => { window.__aim(false); });
await fact('dbg', () => window.__dbg());
await begin('Grenade (5, E) · fireball, scorch, smoke');
await ev(() => { window.__buyGrenades?.(0); });
await key('Digit5'); await wait(600); await key('KeyE'); await wait(4500);

// ---- 4 wanted levels
await begin('1 star · officers come to arrest, not to shoot');
await ev(() => { window.__wanted(1); });
await wait(9000);
await fact('police', () => window.__police());
await begin('3 stars · PIT rams, drive-bys, tyres shot out');
await key('Digit1'); await wait(300);
await key('KeyF'); await wait(2500);
await ev(() => { window.__wanted(3.2); });
await hold('KeyW', 6000); await hold('KeyD', 600); await hold('KeyW', 6000);
await fact('police', () => window.__police());
await begin('4 stars · SWAT, rooftop marksmen, roadblock');
await ev(() => { window.__wanted(4.2); });
await hold('KeyW', 4000); await hold('KeyS', 2500);
await key('KeyF'); await wait(2000);
await wait(6000);
await fact('police', () => window.__police());
await begin('5 stars · helicopter door gun, sniper on the roof');
await ev(() => { window.__wanted(5); });
await wait(9000);

// ---- 5 evasion
await begin('Evasion · break line of sight, the search ring (Tab)');
await ev(() => { const c = window.__car(); window.__warp?.(c.x + 260, c.z + 40, 0); window.__wanted(2.4); });
await wait(1500);
await key('Tab'); await wait(6000); await key('Tab');
await wait(6000);
await fact('wanted', () => window.__dbg());

// ---- 6 garage respray, phone, map, radio
await begin("Garage · repair = Pay 'n' Spray below 3 stars (B, N)");
await key('KeyF'); await wait(2000);
await ev(() => { window.__wanted(2); });
await key('KeyB'); await wait(1500); await key('KeyN'); await wait(2500); await key('KeyB'); await wait(500);
await begin('Phone (M) · missions, services, Ammu-Nation');
await key('KeyM'); await wait(4000); await key('KeyM'); await wait(500);
await begin('Radio (L) · six generative stations, DJ bumpers');
await key('KeyL'); await wait(2500); await key('KeyL'); await wait(2500); await key('KeyL'); await wait(1500);
await begin('City map (Tab) · Little Tokyo tint, legend');
await key('Tab'); await wait(4000); await key('Tab');

// ---- 7 range, hold-out
await begin('Range · six boards, the far row slides');
await key('KeyF'); await wait(2000);
await ev(() => { const o = window.onFoot; window.__modes?.startRange(o.x, o.z, o.camYaw); window.__buyWeapon?.('rifle', 0); });
await key('Digit3'); await wait(500);
for (let i = 0; i < 10; i++) { await key('KeyE'); await wait(350); }
await wait(2000);
await ev(() => { window.__modes?.stop(); });
await begin('Hold-out · waves, score');
await ev(() => { window.__modes?.startHoldout(); });
await wait(12000);
await ev(() => { window.__modes?.stop(); window.__wanted(0); });

// ---- 8 idle cinematic, photo preset
await begin('Idle cinematic · 20 s still: the camera orbits, the HUD fades');
await ev(() => { window.__rain(false); window.__time(17.5); });
await key('KeyF'); await wait(1500);
await wait(24000);
await begin('Photo preset little-tokyo');
await ev(() => { window.photo?.goto?.('little-tokyo'); });
await wait(4000);
await fact('line', () => (window.photo?.line ? window.photo.line() : null));

scene.end = (Date.now() - t0) / 1000;
report.total = scene.end;
fs.writeFileSync('report.json', JSON.stringify(report, null, 2));
await ctx.close(); await browser.close();
console.log('done', report.total.toFixed(1), 's');
