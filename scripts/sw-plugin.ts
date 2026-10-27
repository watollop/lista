import type { Plugin } from 'vite';

// Ficheros de public/ que se precachean además de los de la build.
const PUBLIC_PRECACHE = [
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
  'icons/favicon.svg',
];

type FsLike = {
  readFileSync(file: string): Uint8Array;
  readFileSync(file: string, encoding: 'utf8'): string;
};

// Sin @types/node en el proyecto: el módulo fs se obtiene en runtime (Node >= 22.3).
function loadFs(): FsLike {
  const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  const fs = proc?.getBuiltinModule?.('node:fs') as FsLike | undefined;
  if (!fs) throw new Error('lista-sw: se requiere Node >= 22.3 (process.getBuiltinModule)');
  return fs;
}

const encoder = new TextEncoder();

// Genera dist/sw.js a partir de src/pwa/sw.js: sustituye la versión (hash del
// contenido de la build) y la lista de precache. Solo en build; en dev no hay SW.
export function swPlugin(): Plugin {
  let root = '.';
  let publicDir = 'public';

  return {
    name: 'lista-sw',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      publicDir = config.publicDir || 'public';
    },
    async generateBundle(_options, bundle) {
      const fs = loadFs();
      const files = new Map<string, Uint8Array>();

      for (const [name, item] of Object.entries(bundle)) {
        if (name.endsWith('.map')) continue; // los mapas no se precachean
        const content = item.type === 'chunk' ? item.code : item.source;
        files.set(name, typeof content === 'string' ? encoder.encode(content) : content);
      }
      // Vite 8 entrega publicDir absoluto; se admite también relativo a root.
      const pubRoot = publicDir.startsWith('/') ? publicDir : `${root}/${publicDir}`;
      for (const name of PUBLIC_PRECACHE) {
        files.set(name, fs.readFileSync(`${pubRoot}/${name}`));
      }

      const names = [...files.keys()].sort();
      const parts: Uint8Array[] = [];
      for (const name of names) {
        parts.push(encoder.encode(name), new Uint8Array([0]), files.get(name)!, new Uint8Array([0]));
      }
      const total = parts.reduce((n, p) => n + p.length, 0);
      const joined = new Uint8Array(total);
      let offset = 0;
      for (const p of parts) {
        joined.set(p, offset);
        offset += p.length;
      }
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', joined));
      const version = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);

      const precache = ['./', ...names]; // sin index.html: Cloudflare lo redirige (308) a ./

      const swSource = fs.readFileSync(`${root}/src/pwa/sw.js`, 'utf8');
      const source = swSource
        .replace('__SW_VERSION__', JSON.stringify(version))
        .replace('__SW_PRECACHE__', JSON.stringify(precache));

      if (/__SW_(VERSION|PRECACHE)__/.test(source)) {
        throw new Error('lista-sw: quedan placeholders sin sustituir en sw.js');
      }

      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
