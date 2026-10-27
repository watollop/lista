const UPDATE_INTERVAL_MS = 30 * 60 * 1000;

let registration: ServiceWorkerRegistration | undefined;

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

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // primera instalación: no recargar
    if (document.visibilityState === 'hidden') reloadNow();
    else reloadPending = true;
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
