import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };
import preact from '@preact/preset-vite';
import { swPlugin } from './scripts/sw-plugin.ts';
import { cspPlugin } from './scripts/csp-plugin.ts';

// Versión, momento de compilación y commit: se muestran al pie de Ajustes para comprobar que se tiene lo último.
declare const process: { env: Record<string, string | undefined> }; // sin @types/node: solo se lee el entorno
// GitHub Actions define GITHUB_SHA; en local no hay commit y la etiqueta lo omite.
const commit = (process.env.GITHUB_SHA ?? '').slice(0, 7);

export default defineConfig({
  define: { __BUILD__: JSON.stringify({ version: pkg.version, time: new Date().toISOString(), commit }) },
  base: './',
  plugins: [preact(), swPlugin(), cspPlugin()],
  build: { target: 'es2020', assetsInlineLimit: 0 },
});
