import type { Plugin } from 'vite';

type FsLike = {
  readFileSync(file: string, encoding: 'utf8'): string;
  writeFileSync(file: string, data: string): void;
};

// Sin @types/node en el proyecto: el módulo fs se obtiene en runtime (Node >= 22.3).
function loadFs(): FsLike {
  const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  const fs = proc?.getBuiltinModule?.('node:fs') as FsLike | undefined;
  if (!fs) throw new Error('lista-csp: se requiere Node >= 22.3 (process.getBuiltinModule)');
  return fs;
}

async function sha256(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return `'sha256-${btoa(String.fromCharCode(...digest))}'`;
}

// Sustituye __CSP__ en dist/_headers por una Content-Security-Policy con los hashes del
// <script> y <style> en línea de index.html (cambian si se edita index.html).
export function cspPlugin(): Plugin {
  let outDir = 'dist';
  return {
    name: 'lista-csp',
    apply: 'build',
    configResolved(config) {
      outDir = `${config.root}/${config.build.outDir}`;
    },
    async writeBundle() {
      const fs = loadFs();
      const html = fs.readFileSync(`${outDir}/index.html`, 'utf8');
      const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
      const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
      const csp = [
        "default-src 'self'",
        `script-src 'self' ${(await Promise.all(scripts.map(sha256))).join(' ')}`.trim(),
        `style-src 'self' ${(await Promise.all(styles.map(sha256))).join(' ')}`.trim(),
        "img-src 'self' data:",
        "connect-src 'self' https://*.supabase.co",
        "manifest-src 'self'",
        "worker-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join('; ');
      const file = `${outDir}/_headers`;
      const headers = fs.readFileSync(file, 'utf8');
      if (!headers.includes('__CSP__')) throw new Error('lista-csp: falta __CSP__ en public/_headers');
      fs.writeFileSync(file, headers.replace('__CSP__', csp));
    },
  };
}
