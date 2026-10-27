import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4000,
    modulePreload: { polyfill: false },
    rolldownOptions: {
      output: {
        // one self-contained bundle: simplest to host anywhere
        codeSplitting: false,
        entryFileNames: 'assets/skysong.js',
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
});
