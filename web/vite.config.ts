import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev server proxies the tRPC endpoint to the agent-server ui-http-server (port 3004,
// Stage-1 task 3). The proxy only engages on request, so `pnpm dev` boots even before
// 3004 exists. In production the SPA is served same-origin by agent-server, so the
// relative `/trpc` URL resolves without a proxy.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/trpc': {
        target: 'http://127.0.0.1:3004',
        changeOrigin: true,
      },
    },
  },
});
