import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { swPlugin } from './scripts/sw-plugin.ts';
import { cspPlugin } from './scripts/csp-plugin.ts';

export default defineConfig({
  base: './',
  plugins: [preact(), swPlugin(), cspPlugin()],
  build: { target: 'es2020', assetsInlineLimit: 0 },
});
