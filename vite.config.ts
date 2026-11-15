import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Built into app/ (committed), so start.command and GitHub Pages serve it without a build step.
// base './' keeps every URL relative: the same build works at /web-pak/ on Pages, at / on Vercel
// and on localhost.
export default defineConfig({
  base: './',
  resolve: {
    alias: [
      // brotli-wasm's default browser entry needs a bundler wasm plugin; its plain web build doesn't
      { find: /^brotli-wasm$/, replacement: fileURLToPath(new URL('./node_modules/brotli-wasm/index.web.js', import.meta.url)) },
    ],
  },
  optimizeDeps: { exclude: ['7z-wasm', '@bokuweb/zstd-wasm', 'brotli-wasm'] },
  worker: { format: 'es' },
  build: { outDir: 'app', emptyOutDir: true, target: 'es2022', assetsInlineLimit: 0, chunkSizeWarningLimit: 2000 },
  server: { port: 5193 },
  preview: { port: 5194 },
});
