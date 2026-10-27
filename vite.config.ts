import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { swPlugin } from './scripts/sw-plugin.ts';

export default defineConfig({
  base: './',
  plugins: [preact(), swPlugin()],
  build: { target: 'es2020', assetsInlineLimit: 0 },
});
