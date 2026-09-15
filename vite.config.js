import { defineConfig } from 'vite';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

/* What ships is what the game can load. public/ also holds things the game
   never asks for, and Vite copies the whole folder: the two avatar wardrobe
   GLBs (22 MB, ?me=6/7 only, and unlicensed dev fixtures per NOTICE.md -- do
   not ship), and concept paintings. Measured 2026-09-16: dist 185 -> ~152 MB
   with these gone and the source map off. Everything else in public/ is
   referenced by manifest.json, textures/library.json or a loader path in src/;
   the next 80 MB is the Sketchfab cars and props themselves, which is a
   compression job (KTX2 / meshopt), not a pruning one. */
const DIST_PRUNE = ['models/avatar', 'concept_docklands.jpg', 'concept_vibrant_boulevard.jpg'];
const pruneDist = () => ({
  name: 'prune-dist',
  apply: 'build',
  closeBundle() { for (const f of DIST_PRUNE) rmSync(join('dist', f), { recursive: true, force: true }); },
});

export default defineConfig({
  plugins: [pruneDist()],
  /* Tier 0.3: the whole app builds against three/webgpu.
     `three/webgpu` is a SEPARATE module identity from `three` -- classes from
     one are not instanceof the other -- so there is no way to run both side
     by side behind a flag. An exact-match alias is the migration: every
     `import ... from 'three'` in src/ and in three's own examples/jsm
     resolves to the node-based build, and WebGPURenderer falls back to a
     WebGL2 backend on its own where WebGPU is unavailable.
     The regex matters: a plain string alias would also rewrite
     'three/examples/...' and 'three/tsl'. */
  resolve: { alias: [{ find: /^three$/, replacement: 'three/webgpu' }] },
  /* Pre-bundle every three entry the app touches. Vite's dep optimizer
     otherwise DISCOVERS them while the page loads -- each examples/jsm file is
     its own entry under the alias -- re-bundles, and reloads the page; with a
     dozen such entries added in one day that became a reload loop at the boot
     screen (2026-09-03). Listing them here means one bundle at server start
     and no mid-load reloads. Add any new 'three/...' import path to this list. */
  optimizeDeps: {
    include: [
      'three/webgpu', 'three/tsl',
      'three/examples/jsm/loaders/GLTFLoader.js',
      'three/examples/jsm/loaders/OBJLoader.js',
      'three/examples/jsm/loaders/MTLLoader.js',
      'three/examples/jsm/utils/BufferGeometryUtils.js',
      'three/examples/jsm/utils/SkeletonUtils.js',
      'three/examples/jsm/libs/meshopt_decoder.module.js',
      'three/examples/jsm/csm/CSMShadowNode.js',
      'three/examples/jsm/tsl/display/BloomNode.js',
      'three/examples/jsm/tsl/display/GTAONode.js',
      'three/examples/jsm/tsl/display/DenoiseNode.js',
      'three/examples/jsm/tsl/display/SMAANode.js',
    ],
    holdUntilCrawlEnd: true,
  },
  server: { port: 5173, open: false, warmup: { clientFiles: ['./src/main.js'] } },
  build: { target: 'es2022', outDir: 'dist', sourcemap: false },   // was 'hidden', which still WRITES the 9.5 MB map into dist/assets; nothing reads it
});
