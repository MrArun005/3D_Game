import { defineConfig } from 'vite';

export default defineConfig({
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
  /* Split vendor code from game code (2026-09-22). One 1.86 MB chunk meant any
     one-line game change re-downloaded three.js too; a separate `three` chunk
     stays cached across deploys, and the browser parses the chunks in
     parallel. `three` is ~1.3 MB on its own, so the warning limit is set to
     what it honestly is rather than silenced. */
  build: {
    target: 'es2022', outDir: 'dist', sourcemap: true,
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/examples')) return 'three-addons';
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/trystero')) return 'net';
        },
      },
    },
  },
});
