import { useEffect, useState } from 'preact/hooks';
import type { Entity, Repo, SavedFilter, Sync, SyncState, Task } from '../types';
import { todayISO } from '../lib/date';

export interface Data {
  tasks: Task[];
  topics: Entity[];
  people: Entity[];
  filters: SavedFilter[];
  ready: boolean;
}

/** Carga todo y recarga en cada escritura (local, remota o de otra pestaña). */
export function useData(repo: Repo): Data {
  const [data, setData] = useState<Data>({ tasks: [], topics: [], people: [], filters: [], ready: false });
  useEffect(() => {
    let alive = true;
    let queued = false;
    const load = async () => {
      if (queued) return;
      queued = true;
      await Promise.resolve();
      queued = false;
      const [tasks, topics, people, filters] = await Promise.all([
        repo.listTasks(), repo.listTopics(), repo.listPeople(), repo.listFilters(),
      ]);
      if (alive) setData({ tasks, topics, people, filters, ready: true });
    };
    load();
    const off = repo.subscribe(load);
    return () => { alive = false; off(); };
  }, [repo]);
  return data;
}

/** Fecha de hoy, se actualiza al volver a la app y a medianoche. */
export function useToday(): string {
  const [today, setToday] = useState(todayISO());
  useEffect(() => {
    const check = () => setToday(todayISO());
    const id = setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', check); };
  }, []);
  return today;
}

export function useSyncState(sync: Sync): SyncState {
  const [s, setS] = useState(sync.getState());
  useEffect(() => {
    const off = sync.subscribe(setS);
    setS(sync.getState()); // por si cambió entre el primer render y la suscripción
    return off;
  }, [sync]);
  return s;
}

/** Pantalla ancha (escritorio grande): filtros en barra lateral. */
export function useWide(query = '(min-width: 1200px)'): boolean {
  const [wide, setWide] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return wide;
}

/**
 * iOS: mantiene la caja de captura pegada al borde de arriba del teclado usando visualViewport.
 * Al hacer scroll con el teclado abierto, iOS desplaza el visual viewport y los `fixed` se quedan atrás
 * (la caja desaparecía bajo el teclado), así que mientras hay teclado se recoloca en cada fotograma.
 */
export function useKeyboardInset(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement.style;
    let frame = 0;
    let isOpen = false;
    const update = () => {
      // Solo hay teclado si hay un campo de texto enfocado. Durante el rebote de iOS al pasarse del
      // principio o del final, offsetTop sale negativo y sin esta guarda parecía un teclado abierto.
      const el = document.activeElement;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
      const kb = typing && window.innerHeight - vv.height > 80 ? window.innerHeight - vv.height : 0;
      root.setProperty('--kb', `${Math.round(kb)}px`);
      // Borde inferior del visual viewport (en coordenadas del layout): ahí se ancla la caja.
      root.setProperty('--vv-bottom', `${Math.round(Math.max(0, vv.offsetTop) + vv.height)}px`);
      if (kb > 0 !== isOpen) { isOpen = kb > 0; setOpen(isOpen); }
      cancelAnimationFrame(frame);
      if (isOpen) frame = requestAnimationFrame(update);
    };
    const afterFocus = () => setTimeout(update, 0); // activeElement aún no está actualizado en focusout
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    document.addEventListener('focusin', afterFocus);
    document.addEventListener('focusout', afterFocus);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      document.removeEventListener('focusin', afterFocus);
      document.removeEventListener('focusout', afterFocus);
    };
  }, []);
  return open;
}
