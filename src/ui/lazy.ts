import { h, type ComponentChild, type ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';

/** Ejecuta fn cuando el navegador esté ocioso; sin requestIdleCallback (Safari), tras unos segundos. */
export function whenIdle(fn: () => void): () => void {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, o: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(fn, { timeout: 5000 });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = setTimeout(fn, 3000);
  return () => clearTimeout(id);
}

const RELOAD_KEY = 'lista.chunkReload';

/**
 * No se pudo bajar una vista que el usuario acaba de pedir: casi siempre es una pestaña con una versión anterior
 * cuyo chunk ya no está en el servidor. Recargar trae la versión nueva (los datos están en IndexedDB).
 * Como mucho una vez por minuto, para no entrar en bucle si el fallo es otro (sin conexión, por ejemplo).
 */
function reloadForNewVersion() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return; // sin red recargar no arregla nada
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch { return; }
  location.reload();
}

export interface Lazy<P> {
  (props: P): ComponentChild;
  /** Empieza la carga del chunk (sin renderizar). Idempotente. */
  preload(): void;
}

/**
 * Componente con carga diferida (Preact sin compat no trae lazy). Mientras el chunk no ha llegado no pinta nada;
 * al llegar se renderiza. Si la carga falla al pedir la vista, se recarga la página (ver reloadForNewVersion).
 */
export function lazy<P extends object>(load: () => Promise<ComponentType<P>>): Lazy<P> {
  let ready: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;
  const get = (): Promise<ComponentType<P>> => {
    pending ??= load().then(
      (component) => (ready = component),
      (error: unknown) => { pending = null; throw error; },
    );
    return pending;
  };
  const Component = (props: P) => {
    const [loaded, setLoaded] = useState<ComponentType<P> | null>(() => ready); // función: useState no la invocaría
    useEffect(() => {
      if (loaded) return;
      let alive = true;
      get().then((c) => { if (alive) setLoaded(() => c); }, () => { if (alive) reloadForNewVersion(); });
      return () => { alive = false; };
    }, []);
    return loaded ? h(loaded, props) : null;
  };
  Component.preload = () => { get().catch(() => { /* se reintenta al renderizar */ }); };
  return Component;
}
