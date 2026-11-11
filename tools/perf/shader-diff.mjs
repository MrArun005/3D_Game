import fs from 'fs'; import crypto from 'crypto';
const L = JSON.parse(fs.readFileSync(process.argv[2] || 'h-links.json')).filter((l) => l.fs);
const h = (s) => crypto.createHash('md5').update(s).digest('hex').slice(0, 8);
console.log('crossing programs:', L.length, 'distinct VS:', new Set(L.map((l) => h(l.vs))).size, 'distinct FS:', new Set(L.map((l) => h(l.fs))).size, 'distinct pairs:', new Set(L.map((l) => h(l.vs) + h(l.fs))).size);
const pairs = new Map(); for (const l of L) { const k = h(l.vs) + h(l.fs); (pairs.get(k) || pairs.set(k, []).get(k)).push(l); }
console.log('pair multiplicity (same shaders linked again):', [...pairs.values()].map((a) => a.length).sort((a, b) => b - a).join(','));
// what distinguishes FS within the biggest attr group
const g = L.filter((l) => l.attrs === 'position,normal,nodeAttribute1' && l.outs === 3); const uniq = [...new Map(g.map((l) => [h(l.fs), l])).values()];
console.log('group pos,normal,nodeAttribute1 MRT: programs', g.length, 'distinct FS', uniq.length, 'FS lengths', uniq.map((l) => l.fsLen).join(','));
if (uniq.length > 1) { const a = uniq[0].fs.split('\n'), b = uniq[1].fs.split('\n'); const sb = new Set(b), sa = new Set(a); console.log('--- lines only in A (first 12):'); console.log(a.filter((x) => !sb.has(x)).slice(0, 12).map((x) => x.slice(0, 220)).join('\n')); console.log('--- lines only in B (first 12):'); console.log(b.filter((x) => !sa.has(x)).slice(0, 12).map((x) => x.slice(0, 220)).join('\n')); }
const vsu = [...new Map(g.map((l) => [h(l.vs), l])).values()]; console.log('distinct VS in group', vsu.length); if (vsu.length > 1) { const a = vsu[0].vs.split('\n'), b = vsu[1].vs.split('\n'); const sb = new Set(b), sa = new Set(a); console.log('VS only in A:', a.filter((x) => !sb.has(x)).slice(0, 6).map((x) => x.slice(0, 200)).join('\n')); console.log('VS only in B:', b.filter((x) => !sa.has(x)).slice(0, 6).map((x) => x.slice(0, 200)).join('\n')); }
console.log('--- uniform/sampler names in first FS of group:'); console.log([...new Set([...uniq[0].fs.matchAll(/uniform\s+\w+\s+(\w+)/g)].map((m) => m[1]))].slice(0, 40).join(', '));
console.log('--- VS attribute use:', (uniq[0].vs.match(/nodeAttribute1[^;\n]{0,120}/g) || []).slice(0, 4).join(' || '));
fs.writeFileSync('fsA.glsl', uniq[0].fs); if (uniq[1]) fs.writeFileSync('fsB.glsl', uniq[1].fs);
