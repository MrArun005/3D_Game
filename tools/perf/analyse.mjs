import fs from 'fs';
const { frames, total } = JSON.parse(fs.readFileSync(process.argv[2]));
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const seg = (name, fr) => { if (!fr.length) return; const js = fr.map((f) => f.js); const avg = (k) => (fr.reduce((s, f) => s + (f[k] || 0), 0) / fr.length); console.log(`${name}: n=${fr.length} js ms median ${q(js, .5)} p95 ${q(js, .95)} p99 ${q(js, .99)} worst ${Math.max(...js)} | per frame: draws ${avg('draws').toFixed(0)} bufferUploads ${avg('buf').toFixed(0)} (${(avg('bufBytes') / 1e6).toFixed(2)} MB) texUploads ${avg('tex').toFixed(1)} links ${avg('link').toFixed(2)} fboBinds ${avg('fbo').toFixed(0)} timers ${avg('timers').toFixed(1)} ms`); };
seg('idle at spawn (5x5 ring loaded)', frames.filter((f) => f.i < 0));
const drv = frames.filter((f) => f.i >= 3); seg('driving', drv);
const med = q(drv.map((f) => f.js), .5);
console.log('\nframes > 1.5x median or with links/chunk events:');
let prevC = null, prevCell = null, prevB = null;
for (const f of frames) { const cell = Math.floor(f.x / 256) + ',' + Math.floor(f.z / 256); const ev = []; if (prevCell && cell !== prevCell) ev.push('BORDER ' + prevCell + '->' + cell); if (prevC !== null && f.chunks !== prevC) ev.push(`chunks ${prevC}->${f.chunks}`); if (f.building !== prevB) ev.push('building ' + f.building); if (f.link) ev.push('links ' + f.link);
  if (ev.length || f.js > med * 1.5) console.log(`  f${f.i} js ${f.js} x ${f.x?.toFixed(0)} z ${f.z?.toFixed(0)} v ${f.v?.toFixed(1)} q ${f.queue} buf ${f.buf}/${(f.bufBytes / 1e6).toFixed(1)}MB tex ${f.tex} del ${f.del} draws ${f.draws} ${ev.join('; ')} | ${(f.top || []).slice(0, 5).map(([k, v]) => k.slice(0, 34) + ' ' + v).join(', ')}`);
  prevC = f.chunks; prevCell = cell; prevB = f.building; }
const last = frames[frames.length - 1]; console.log('\nworstSlice', JSON.stringify(last.worst), 'chunkMs', JSON.stringify(last.chunkMs), 'finite all:', frames.every((f) => f.fin));
const sum = total.reduce((s, [, v]) => s + v, 0); console.log('\nTOP SELF TIME over whole capture (ms, % of sampled):'); for (const [k, v] of total.slice(0, 45)) console.log('  ' + v.toFixed(0).padStart(7) + ' ' + (100 * v / sum).toFixed(1).padStart(5) + '%  ' + k);
