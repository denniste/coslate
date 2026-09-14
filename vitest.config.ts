import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolveSrc = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Tests run against package *sources*, so `pnpm test` needs no prior build.
      '@coslate/core': resolveSrc('./packages/core/src/index.ts'),
      '@coslate/konva': resolveSrc('./packages/konva/src/index.ts'),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    reporters: ['verbose'],
  },
});
