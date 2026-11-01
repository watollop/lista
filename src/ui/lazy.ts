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

export interface Lazy<P> {
  (props: P): ComponentChild;
  /** Empieza la carga del chunk (sin renderizar). Idempotente. */
  preload(): void;
}

/**
 * Componente con carga diferida (Preact sin compat no trae lazy). Mientras el chunk no ha llegado no pinta nada;
 * al llegar se renderiza. Si la carga falla, se reintenta la próxima vez que se pida.
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
      get().then((c) => { if (alive) setLoaded(() => c); }, () => { /* sin vista; se reintenta al volver a pedirla */ });
      return () => { alive = false; };
    }, []);
    return loaded ? h(loaded, props) : null;
  };
  Component.preload = () => { get().catch(() => { /* se reintenta al renderizar */ }); };
  return Component;
}
