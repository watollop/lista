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

/** iOS: mantiene la caja de captura por encima del teclado usando visualViewport. */
export function useKeyboardInset(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--kb', `${Math.round(kb)}px`);
      setOpen(kb > 80);
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update); };
  }, []);
  return open;
}
