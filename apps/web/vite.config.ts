import { defineConfig } from 'vite';
import path from 'node:path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@rp/shared': path.resolve(__dirname, '../../packages/shared/src/types/index.ts'),
      '@rp/scheduler': path.resolve(__dirname, '../../packages/scheduler/src/index.ts'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    fs: {
      // allow importing from monorepo root/packages during dev
      allow: [path.resolve(__dirname, '..', '..')]
    },
    proxy: {
      '/api': 'http://127.0.0.1:4000'
    }
  }
});
