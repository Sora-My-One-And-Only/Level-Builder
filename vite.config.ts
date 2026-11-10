import { defineConfig } from 'vite';

// Same variable the Bridge / CLI / MCP server read, so a custom port only has to be set once
const bridgePort = Number(process.env.LEVELFORGE_PORT || 4399);

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    open: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${bridgePort}`,
        changeOrigin: true,
      },
      '/ws': {
        target: `ws://127.0.0.1:${bridgePort}`,
        ws: true,
      },
    },
  },
  build: {
    // three.js is ~85% of the bundle and changes only on dependency upgrades: keep it in its own
    // long-cacheable chunk so app updates don't force users to re-download it
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three';
        },
      },
    },
  },
});
