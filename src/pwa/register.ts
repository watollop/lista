const UPDATE_INTERVAL_MS = 30 * 60 * 1000;

/** Evento en window cuando hay una versión nueva esperando a recargar (la UI ofrece «Recargar»). */
export const UPDATE_READY_EVENT = 'lista:update-ready';

let registration: ServiceWorkerRegistration | undefined;

/** ¿La lista de precache del SW incluye el script que está ejecutando esta página? Entonces ya es la misma build. */
export function precacheHas(precache: unknown, scope: string, scriptUrl: string | undefined): boolean {
  if (!Array.isArray(precache) || !scriptUrl) return false;
  const path = new URL(scriptUrl, scope).pathname;
  return precache.some((f) => typeof f === 'string' && new URL(f, scope).pathname === path);
}

/** Pregunta al SW que controla la página qué ficheros sirve. null si no responde (SW antiguo) en 2 s. */
function askPrecache(sw: ServiceWorker): Promise<unknown> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 2000);
    channel.port1.onmessage = (e) => { clearTimeout(timer); resolve(e.data); };
    sw.postMessage('PRECACHE', [channel.port2]);
  });
}

/** El script principal de esta página (en producción, assets/index-<hash>.js). */
const entryScript = () => document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src;

// Registra el SW (solo en producción) y gestiona las actualizaciones sin
// recargar a mitad de escritura: si la pestaña está oculta se recarga ya;
// si está visible se espera al siguiente paso a segundo plano.
export function registerSW(): void {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;

  // Debe leerse antes de registrar: si había controlador, es una actualización.
  const hadController = navigator.serviceWorker.controller !== null;
  let reloading = false;
  let reloadPending = false;

  const reloadNow = () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  };

  navigator.serviceWorker.addEventListener('controllerchange', async () => {
    if (!hadController) return; // primera instalación: no recargar
    // La navegación va por red: tras publicar, la página ya suele cargar la build nueva y el SW nuevo
    // toma el control justo después. Si este SW sirve la misma build que se está ejecutando, no hay nada que recargar.
    const sw = navigator.serviceWorker.controller;
    if (sw && precacheHas(await askPrecache(sw), registration?.scope ?? location.href, entryScript())) return;
    if (document.visibilityState === 'hidden') reloadNow();
    else {
      reloadPending = true;
      window.dispatchEvent(new Event(UPDATE_READY_EVENT)); // en un ordenador la pestaña puede seguir visible horas
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (reloadPending) reloadNow();
    } else {
      registration?.update().catch(() => {});
    }
  });

  const start = async () => {
    try {
      registration = await navigator.serviceWorker.register('./sw.js', {
        scope: './',
        updateViaCache: 'none',
      });
    } catch (err) {
      console.warn('[pwa] registro del service worker fallido', err);
      return;
    }
    window.setInterval(() => {
      registration?.update().catch(() => {});
    }, UPDATE_INTERVAL_MS);
  };

  if (document.readyState === 'complete') void start();
  else window.addEventListener('load', () => void start(), { once: true });
}

// Pide almacenamiento persistente (evita que el SO borre los datos locales).
export async function requestPersistence(): Promise<boolean> {
  try {
    const storage = navigator.storage;
    if (!storage?.persist) return false;
    if (storage.persisted && (await storage.persisted())) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}
