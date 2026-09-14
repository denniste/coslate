import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/** Resolve an HTML entry relative to this config, whatever the cwd. */
const entry = (name: string): string => fileURLToPath(new URL(name, import.meta.url));

/**
 * The demo consumes the workspace packages through their built `dist` output,
 * exactly as an external application would. `pnpm dev` and `pnpm build` both
 * build `@coslate/core`, `@coslate/konva` and `@coslate/ui` first, so the demo
 * is a real integration test of the published artifacts rather than of the
 * sources.
 *
 * Two entries: `index.html` is the editor demo, `viewer.html` is the read-only
 * projection. A multi-page build (`rollupOptions.input`) is what makes
 * `dist/viewer.html` a real served URL rather than a dev-only route.
 */
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: entry('./index.html'),
        viewer: entry('./viewer.html'),
      },
    },
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
