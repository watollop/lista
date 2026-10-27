// Orquestación de la sincronización: sesión, push/pull y estado observable.
import type { RemoteItem, Repo, Sync, SyncState } from '../types';
import * as auth from './auth';
import type { Session, SessionStorage, SyncConfig } from './auth';
import { HttpError, pullItems, pushItems } from './api';

export type { SyncConfig } from './auth';

export interface SyncDeps {
  fetch?: typeof fetch;
  storage?: SessionStorage;
  now?: () => number;
}

const CURSOR_KEY = 'sync.cursor';
const LAST_SYNC_KEY = 'sync.lastSync';
const REFRESH_MARGIN_MS = 60_000;
const OVERLAP_MS = 5_000; // solapamiento del pull: los commits pueden llegar fuera de orden
const DEBOUNCE_MS = 1_500;
const INTERVAL_MS = 60_000;

/** Configuración desde VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (null si falta alguna). */
export function syncConfigFromEnv(): SyncConfig | null {
  const url = String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '');
  const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '');
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/** Error interno: la sesión ya no es válida y hay que volver a iniciar sesión. */
class SessionLost extends Error {}

function memoryStorage(): SessionStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

function defaultStorage(): SessionStorage {
  try {
    return localStorage;
  } catch {
    return memoryStorage();
  }
}

/** Retrocede OVERLAP_MS desde el cursor del servidor (con microsegundos) para no perder commits tardíos. */
function overlapSince(cursor: string): string {
  const ms = Date.parse(cursor.replace(/(\.\d{3})\d+/, '$1'));
  return Number.isNaN(ms) ? cursor : new Date(ms - OVERLAP_MS).toISOString();
}

function isOffline(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return e instanceof TypeError; // fetch lanza TypeError ante fallo de red
}

/** Errores de red se presentan como mensaje claro; el resto se conserva. */
function friendly(e: unknown): Error {
  if (e instanceof TypeError) return new Error('Sin conexión con el servidor');
  return e instanceof Error ? e : new Error(String(e));
}

export function createSync(repo: Repo, cfg: SyncConfig | null, deps: SyncDeps = {}): Sync {
  const listeners = new Set<(s: SyncState) => void>();
  const storage: SessionStorage = deps.storage ?? defaultStorage();
  const now = deps.now ?? Date.now;
  const fetchImpl: typeof fetch = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));

  let session: Session | null = null;
  let lastSync: number | null = null;
  let state: SyncState;
  // Incrementa en cada cambio de sesión (login/logout) para descartar resultados de syncs antiguos.
  let epoch = 0;

  if (!cfg) {
    state = { status: 'disabled' };
  } else {
    session = auth.loadSession(storage);
    state = session
      ? { status: 'idle', lastSync: null, email: session.email }
      : { status: 'signedOut' };
    void repo.getMeta<number>(LAST_SYNC_KEY).then(
      (v) => {
        if (lastSync === null && typeof v === 'number') {
          lastSync = v;
          if (state.status === 'idle') setState({ status: 'idle', lastSync, email: state.email });
        }
      },
      () => {},
    );
  }

  function setState(s: SyncState): void {
    state = s;
    for (const cb of [...listeners]) cb(s);
  }

  // ---------- sincronización ----------

  /** Refresca la sesión. Lanza SessionLost si el refresh token ya no sirve (400/401). */
  async function refreshSession(c: SyncConfig): Promise<void> {
    const current = session;
    if (!current) throw new SessionLost('Sesión cerrada');
    const myEpoch = epoch;
    try {
      const fresh = await auth.refresh(c, current.refreshToken, fetchImpl, now);
      if (epoch !== myEpoch) return;
      session = { ...fresh, email: fresh.email || current.email };
      auth.saveSession(storage, session);
    } catch (e) {
      if (e instanceof HttpError && (e.status === 400 || e.status === 401)) {
        if (epoch === myEpoch) {
          session = null;
          auth.clearSession(storage);
        }
        throw new SessionLost('Sesión caducada');
      }
      throw e;
    }
  }

  async function doSync(c: SyncConfig): Promise<void> {
    const s = session;
    if (!s) throw new SessionLost('Sesión cerrada');

    const pending = await repo.pendingChanges();
    if (pending.length > 0) {
      await pushItems(c, s, pending, fetchImpl);
      await repo.markPushed(pending);
    }

    const stored = await repo.getMeta<string>(CURSOR_KEY);
    const since = typeof stored === 'string' && stored ? overlapSince(stored) : null;
    const { items, cursor } = await pullItems(c, s, since, fetchImpl);
    if (items.length > 0) await repo.applyRemote(items as RemoteItem[]);
    if (cursor !== null) await repo.setMeta(CURSOR_KEY, cursor);
  }

  async function runOnce(): Promise<void> {
    const c = cfg;
    const s0 = session;
    if (!c || !s0) return;
    const myEpoch = epoch;
    const email = s0.email;
    setState({ status: 'syncing', email });

    try {
      if (s0.expiresAt - now() < REFRESH_MARGIN_MS) await refreshSession(c);
      try {
        await doSync(c);
      } catch (e) {
        if (!(e instanceof HttpError && e.status === 401)) throw e;
        await refreshSession(c); // un solo reintento tras 401
        await doSync(c);
      }
      if (epoch !== myEpoch) return;
      lastSync = now();
      await repo.setMeta(LAST_SYNC_KEY, lastSync);
      setState({ status: 'idle', lastSync, email });
    } catch (e) {
      if (epoch !== myEpoch) return;
      if (e instanceof SessionLost) {
        setState({ status: 'signedOut' });
      } else if (isOffline(e)) {
        setState({ status: 'offline', email });
      } else {
        setState({ status: 'error', message: e instanceof Error ? e.message : String(e), email });
      }
    }
  }

  let running: Promise<void> | null = null;
  let again = false;
  let changedDuringRun = false;

  function syncNow(): Promise<void> {
    if (!cfg) return Promise.resolve();
    if (!session) {
      if (state.status !== 'signedOut') setState({ status: 'signedOut' });
      return Promise.resolve();
    }
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          changedDuringRun = false;
          await runOnce();
          // Escrituras locales hechas mientras sincronizaba: si quedó algo pendiente, otra vuelta.
          // (applyRemote también notifica, pero deja dirty=0, así que no provoca bucles.)
          if (changedDuringRun && session && (await repo.pendingChanges()).length > 0) again = true;
        } while (again);
      } finally {
        running = null;
      }
    })();
    return running;
  }

  // ---------- sesión ----------

  async function adopt(s: Session): Promise<void> {
    epoch++;
    session = s;
    auth.saveSession(storage, s);
    await repo.setMeta(CURSOR_KEY, null); // login nuevo => pull completo
    setState({ status: 'idle', lastSync, email: s.email });
    await syncNow();
  }

  async function signIn(email: string, password: string): Promise<void> {
    const c = cfg;
    if (!c) throw new Error('Sincronización no configurada');
    let s: Session;
    try {
      s = await auth.signIn(c, email, password, fetchImpl, now);
    } catch (e) {
      throw friendly(e);
    }
    await adopt(s);
  }

  async function signUp(email: string, password: string): Promise<void> {
    const c = cfg;
    if (!c) throw new Error('Sincronización no configurada');
    let s: Session;
    try {
      s = await auth.signUp(c, email, password, fetchImpl, now);
    } catch (e) {
      throw friendly(e);
    }
    await adopt(s);
  }

  /** Vuelve a la app tras Google: URL actual sin hash ni query. */
  const redirectTarget = (): string => `${location.origin}${location.pathname}`;

  function googleEnabled(): Promise<boolean> {
    return cfg ? auth.googleEnabled(cfg, fetchImpl) : Promise.resolve(false);
  }

  function signInWithGoogle(): void {
    if (!cfg) return;
    location.assign(auth.googleAuthorizeUrl(cfg, redirectTarget()));
  }

  /** Si la página se abrió de vuelta de Google, adopta la sesión y limpia la URL. */
  async function handleRedirect(): Promise<void> {
    if (!cfg || typeof location === 'undefined' || !/access_token=|error_description=/.test(location.hash)) return;
    const hash = location.hash;
    history.replaceState(null, '', location.pathname); // Supabase repite el error también en ?error=…
    try {
      const s = await auth.sessionFromRedirect(cfg, hash, fetchImpl, now);
      if (s) await adopt(s);
    } catch (e) {
      setState({ status: 'signedOut', message: friendly(e).message });
    }
  }

  async function signOut(): Promise<void> {
    const c = cfg;
    if (!c) return;
    const old = session;
    epoch++;
    session = null;
    auth.clearSession(storage);
    setState({ status: 'signedOut' });
    if (old) await auth.signOut(c, old.accessToken, fetchImpl);
    await repo.setMeta(CURSOR_KEY, null);
  }

  // ---------- disparadores ----------

  let started = false;
  let unsubscribeRepo: (() => void) | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;

  const trigger = (): void => {
    void syncNow();
  };

  const onRepoChange = (): void => {
    if (running) {
      changedDuringRun = true; // se resuelve al terminar el sync en curso
      return;
    }
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      trigger();
    }, DEBOUNCE_MS);
  };

  const isVisible = (): boolean =>
    typeof document !== 'undefined' && document.visibilityState === 'visible';

  const onVisibility = (): void => {
    if (isVisible()) trigger();
  };

  const onTick = (): void => {
    if (isVisible()) trigger();
  };

  function start(): void {
    if (!cfg || started) return;
    started = true;
    unsubscribeRepo = repo.subscribe(onRepoChange);
    if (typeof window !== 'undefined') {
      window.addEventListener('online', trigger);
      window.addEventListener('focus', trigger);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }
    interval = setInterval(onTick, INTERVAL_MS);
    if (session) trigger();
    void handleRedirect();
  }

  function stop(): void {
    if (!started) return;
    started = false;
    unsubscribeRepo?.();
    unsubscribeRepo = null;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;
    if (interval) clearInterval(interval);
    interval = null;
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', trigger);
      window.removeEventListener('focus', trigger);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility);
    }
  }

  return {
    getState: () => state,
    subscribe(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    googleEnabled,
    signInWithGoogle,
    signIn,
    signUp,
    signOut,
    syncNow,
    start,
    stop,
  };
}
