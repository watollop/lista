// Service worker de Lista. Texto plano (sin imports).
// scripts/sw-plugin.ts sustituye VERSION y PRECACHE al compilar.
const VERSION = __SW_VERSION__;
const PRECACHE = __SW_PRECACHE__;
const CACHE = `lista-${VERSION}`;
const SCOPE_URL = self.registration ? self.registration.scope : self.location.href;
// La raíz, no index.html: Cloudflare Pages redirige /index.html → / y una respuesta
// redirigida no se puede servir a una navegación (el navegador da error).
const INDEX_URL = SCOPE_URL;
const ASSET_PATH_PREFIXES = [
  new URL('assets/', SCOPE_URL).pathname,
  new URL('icons/', SCOPE_URL).pathname,
];
const NAV_TIMEOUT_MS = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(PRECACHE);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Se conserva la caché de la versión anterior (la última que hubo) para las pestañas que siguen abiertas
    // con ella: si piden un chunk diferido (dictado, Ajustes…) lo encuentran aunque ya no esté en el servidor.
    const keys = (await caches.keys()).filter((key) => key.startsWith('lista-') && key !== CACHE);
    const previous = keys[keys.length - 1]; // caches.keys() devuelve el orden de creación
    await Promise.all(keys.filter((key) => key !== previous).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  // La página pregunta qué build sirve este SW: si ya está ejecutando esa misma, no hace falta avisar de nada.
  if (event.data === 'PRECACHE' && event.ports[0]) event.ports[0].postMessage(PRECACHE);
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Ignorar cualquier origen cruzado (Supabase, etc.).
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(event));
    return;
  }

  event.respondWith(handleCacheFirst(event, url));
});

// Red primero (sin caché HTTP) con timeout; si falla, index.html cacheado.
async function handleNavigation(event) {
  const cache = await caches.open(CACHE);
  try {
    const response = await withTimeout(
      fetch(INDEX_URL, { cache: 'no-store' }),
      NAV_TIMEOUT_MS,
    );
    const clean = await unredirect(response);
    if (clean.ok) {
      event.waitUntil(cache.put(INDEX_URL, clean.clone()));
    }
    return clean;
  } catch (err) {
    const cached = await cache.match(INDEX_URL);
    if (cached) return unredirect(cached);
    throw err;
  }
}

// Caché primero; si no está, red. Solo se guardan assets/ e icons/.
// Se busca en todas las cachés de Lista: una pestaña abierta con la versión anterior aún puede pedir sus chunks.
async function handleCacheFirst(event, url) {
  const cache = await caches.open(CACHE);
  const cached = await caches.match(event.request);
  if (cached) return cached;

  const response = await fetch(event.request);
  const asset = ASSET_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
  // Un asset que ya no existe (otro despliegue) le llega como la página HTML de reserva: ni se guarda ni se da por bueno.
  if (asset && (response.headers.get('content-type') || '').includes('text/html')) {
    return new Response('', { status: 404, statusText: 'Not Found' });
  }
  if (asset && response.ok && response.type === 'basic') {
    event.waitUntil(cache.put(event.request, response.clone()));
  }
  return response;
}

// Copia sin la marca "redirected" (si el servidor redirigió por el camino).
async function unredirect(response) {
  if (!response.redirected) return response;
  return new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}
