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
  server: { port: 5173, open: false },
  build: { target: 'es2022', outDir: 'dist', sourcemap: true },
});
