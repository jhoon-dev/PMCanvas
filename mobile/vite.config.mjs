import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  resolve: {
    alias: [
      {
        find: /^buffer$/,
        replacement: fileURLToPath(new URL('./node_modules/buffer/index.js', import.meta.url)),
      },
    ],
  },
  server: { fs: { allow: ['..'] } },
  build: { target: 'es2022' },
});
