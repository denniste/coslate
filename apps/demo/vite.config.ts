import { defineConfig } from 'vite';

/**
 * The demo consumes the workspace packages through their built `dist` output,
 * exactly as an external application would. `pnpm dev` and `pnpm build` both
 * build `@coslate/core` and `@coslate/konva` first, so the demo is a real
 * integration test of the published artifacts rather than of the sources.
 */
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
  },
  server: {
    port: 5173,
    // Dev is allowed to fall back to the next free port (Vite prints the real
    // URL). Preview stays strict: the e2e suite drives a fixed port.
    strictPort: false,
  },
  preview: {
    port: 4321,
    strictPort: true,
  },
});
