// Writes dist/offline.json: every file the game can fetch, for the SAVE
// OFFLINE button (2026-09-24). Runs after `vite build` (npm run build).
// Left out: the NC Sketchfab bodies and RPM avatar fixtures (dev-only, not
// ours to redistribute), concept art, notices, source maps.
import { readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
const DIST = 'dist';
const SKIP = [/^models\/vendor\/sketchfab\//, /^models\/avatar\//, /^concept_/, /\.md$/i, /\.map$/, /^offline\.json$/, /^_headers$/, /^sw\.js$/];
const files = [];
let bytes = 0;
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name), st = statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    const rel = relative(DIST, p).split('\\').join('/');
    if (SKIP.some((r) => r.test(rel))) continue;
    // a library PNG with a KTX2 twin is only the fallback (catalogue.js loads the KTX2): ~12 MB not worth an offline copy
    const twin = rel.match(/^textures\/([^/]+)\.png$/);
    if (twin && existsSync(join(DIST, 'textures', 'ktx2', twin[1] + '.ktx2'))) continue;
    files.push('/' + rel); bytes += st.size;
  }
})(DIST);
const version = Date.now().toString(36);
writeFileSync(join(DIST, 'offline.json'), JSON.stringify({ version, bytes, files }));
console.log(`offline.json: ${files.length} files, ${(bytes / 1e6).toFixed(1)} MB, version ${version}`);
