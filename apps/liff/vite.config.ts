import preact from '@preact/preset-vite';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [preact()],
  // GitHub Pages のサブパス（/リポジトリ名/）でも動くよう相対パスにする
  base: './',
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        join: resolve(__dirname, 'join.html'),
      },
    },
  },
});
