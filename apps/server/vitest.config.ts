import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    pool: 'forks',
    sequence: {
      concurrent: false,
    },
    // Server integration tests boot a Fastify instance + push Prisma schema per
    // file. 20s is a comfortable buffer for the slowest file.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    silent: true,
  },
  // Mirror the workspace-alias config from tsconfig-paths so Vite's resolver
  // can find @rp/* packages at source level (they don't have built dist/).
  resolve: {
    alias: {
      '@rp/shared': resolve(__dirname, '../../packages/shared/src/types/index.ts'),
      '@rp/scheduler': resolve(__dirname, '../../packages/scheduler/src/index.ts'),
    },
  },
});
