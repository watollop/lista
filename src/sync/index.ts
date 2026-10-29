// Orquestación de la sincronización: sesión, push/pull, cifrado y estado observable.
import type {
  EncEnvelope,
  EncRow,
  EncryptionState,
  KeyRowData,
  LinkState,
  RemoteItem,
  Repo,
  Sync,
  SyncKind,
  SyncState,
} from '../types';
import * as auth from './auth';
import type { Session, SessionStorage, SyncConfig } from './auth';
import {
  HttpError,
  createPairing,
  deleteAllEnc,
  deleteExpiredPairings,
  deleteItems,
  deletePairing,
  deleteRemoteAccount,
  fetchKeyRow,
  getPairing,
  listPendingPairings,
  putKeyRow,
  pullItems,
  pushItems,
  updatePairing,
  updateKeyRow,
} from './api';
import {
  PairingError,
  answerPairing,
  confirmPairing,
  rejectPairing,
  startPairing,
  stepA,
  stepB,
} from './pairing';
import type { AState, BState, PairingTransport } from './pairing';
import {
  CorruptItemError,
  decryptItem,
  encryptItem,
  exportDk,
  generateDk,
  generateRecoveryKey,
  importDk,
  keyIdOf,
  unwrapWithRecovery,
  wrapWithRecovery,
} from './crypto';

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
// Refresco periódico adaptativo (solo con la app visible y sesión iniciada).
const TICK_MS = 10_000;
const POLL_ACTIVE_MS = 30_000; // con actividad reciente
const POLL_IDLE_MS = 120_000; // tras un rato sin cambios
const IDLE_AFTER_MS = 5 * 60_000;
// Enlace de dispositivos (docs/plan-cifrado.md §7): sondeo del enlace en curso y búsqueda de peticiones nuevas.
const LINK_POLL_MS = 2_000;
const LINK_CHECK_MS = 5_000;

// Claves de meta por usuario (ver docs/plan-cifrado.md §4).
const dkKey = (userId: string): string => `dk:${userId}`; // DK en base64
const migKey = (userId: string): string => `encmig:${userId}`; // true mientras la migración no esté verificada

/** Kinds que viajan en claro (versiones antiguas de la app o migración pendiente). */
const PLAIN_KINDS: readonly SyncKind[] = ['task', 'topic', 'person', 'filter', 'setting'];

const ALREADY_ELSEWHERE = 'El cifrado ya se activó en otro dispositivo. Enlaza este dispositivo.';

/** Protocolo de enlace en curso: B (dispositivo nuevo, 'new') o A (activado, 'active'). */
type LinkCtx = { role: 'new'; st: BState } | { role: 'active'; st: AState };

/** Cada cuánto refrescar según el tiempo transcurrido desde el último cambio (local o remoto). */
export const pollInterval = (sinceActivity: number): number =>
  sinceActivity < IDLE_AFTER_MS ? POLL_ACTIVE_MS : POLL_IDLE_MS;

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

const noop = (): void => {};

/** Fila key con forma válida; cualquier otra cosa cuenta como ausente. */
function validKeyRow(row: KeyRowData | null): KeyRowData | null {
  return row && row.v === 1 && typeof row.keyId === 'string' ? row : null;
}

export function createSync(repo: Repo, cfg: SyncConfig | null, deps: SyncDeps = {}): Sync {
  const listeners = new Set<(s: SyncState) => void>();
  const storage: SessionStorage = deps.storage ?? defaultStorage();
  const now = deps.now ?? Date.now;
  const fetchImpl: typeof fetch = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));

  let session: Session | null = null;
  let lastSync: number | null = null;
  let lastAttempt = 0; // último intento de sync (para el refresco periódico)
  let lastActivity = now(); // último cambio local o remoto, o vuelta a la app
  let state: SyncState;
  // Incrementa en cada cambio de sesión (login/logout) para descartar resultados de syncs antiguos.
  let epoch = 0;
  // Estado del cifrado según el último sync.
  let encState: EncryptionState = 'off';
  // Enlace de dispositivos: linkSt es lo que ve la UI; linkCtx, el protocolo interno.
  let linkSt: LinkState | null = null;
  let linkCtx: LinkCtx | null = null;
  let linkBusy = false; // un sondeo o una comprobación a la vez
  let linkTimer: ReturnType<typeof setInterval> | null = null;
  let linkCheckTimer: ReturnType<typeof setInterval> | null = null;

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

  /** Lee la fila key. Un 400 (SQL sin actualizar) cuenta como ausente. */
  function readKeyRow(c: SyncConfig, s: Session): Promise<KeyRowData | null> {
    return fetchKeyRow(c, s, fetchImpl).then(validKeyRow, (e: unknown) => {
      if (e instanceof HttpError && e.status === 400) return null;
      throw e;
    });
  }

  /** DK desde su valor guardado. Null si no hay, si no se puede importar o si no es la de la fila key dada. */
  async function dkFrom(raw: unknown, row: KeyRowData | null): Promise<CryptoKey | null> {
    if (typeof raw !== 'string' || !raw) return null;
    let dk: CryptoKey;
    try {
      dk = await importDk(raw);
    } catch {
      return null;
    }
    if (row && (await keyIdOf(dk)) !== row.keyId) return null;
    return dk;
  }

  /** DK local de este usuario (ver dkFrom). */
  async function loadDk(userId: string, row: KeyRowData | null): Promise<CryptoKey | null> {
    return dkFrom(await repo.getMeta<string>(dkKey(userId)), row);
  }

  /** Sube los pendientes cifrados. Lo que se sube es lo mismo que en claro, con otro envoltorio. */
  async function pushCipher(c: SyncConfig, s: Session, dk: CryptoKey): Promise<void> {
    const pending = await repo.pendingChanges();
    if (pending.length === 0) return;
    lastActivity = now();
    const rows: EncRow[] = [];
    for (const it of pending) rows.push(await encryptItem(dk, it));
    await pushItems(c, s, rows, fetchImpl);
    await repo.markPushed(pending); // con los originales: markPushed compara updatedAt
  }

  /** Aplica una bajada: descifra las filas 'enc' y aplica las que están en claro. Devuelve estas últimas. */
  async function ingest(dk: CryptoKey, items: RemoteItem[]): Promise<{ plain: RemoteItem[]; skipped: number }> {
    const toApply: RemoteItem[] = [];
    const plain: RemoteItem[] = [];
    let skipped = 0;
    for (const it of items) {
      const kind = it.kind as string;
      if (kind === 'key') continue;
      if (kind === 'enc') {
        const row: EncRow = {
          kind: 'enc',
          id: it.id,
          data: it.data as unknown as EncEnvelope,
          updated_at: it.updated_at,
          deleted: it.deleted,
        };
        try {
          toApply.push(await decryptItem(dk, row));
        } catch (e) {
          if (e instanceof CorruptItemError) skipped++; // no se aplica: nunca pisa el local
          else throw e;
        }
      } else if (PLAIN_KINDS.includes(it.kind)) {
        plain.push(it);
        toApply.push(it);
      }
    }
    if (toApply.length > 0) await repo.applyRemote(toApply);
    return { plain, skipped };
  }

  /** Borra del servidor las filas en claro ya recifradas, agrupadas por kind. */
  async function removePlain(c: SyncConfig, s: Session, plain: RemoteItem[]): Promise<void> {
    const byKind = new Map<SyncKind, string[]>();
    for (const it of plain) byKind.set(it.kind, [...(byKind.get(it.kind) ?? []), it.id]);
    for (const [kind, ids] of byKind) await deleteItems(c, s, kind, ids, fetchImpl);
  }

  /**
   * Un ciclo con cifrado: sube lo pendiente, baja desde `since` (null = completa) y aplica.
   * Si llegaron filas en claro (de un dispositivo antiguo), se marcan dirty, se suben cifradas y se borran.
   * Devuelve cuántas filas en claro llegaron.
   */
  async function syncCipher(c: SyncConfig, s: Session, dk: CryptoKey, since: string | null): Promise<number> {
    await pushCipher(c, s, dk);
    const { items, cursor } = await pullItems(c, s, since, fetchImpl);
    if (items.length > 0) lastActivity = now();
    const { plain, skipped } = await ingest(dk, items);
    if (skipped > 0) console.warn(`Sync: ${skipped} registro(s) cifrado(s) no válido(s), omitido(s)`);
    if (plain.length > 0) {
      await repo.markDirty(plain.map((it) => ({ kind: it.kind, id: it.id })));
      await pushCipher(c, s, dk);
      await removePlain(c, s, plain);
    }
    if (cursor !== null) await repo.setMeta(CURSOR_KEY, cursor);
    return plain.length;
  }

  /** Sincronización con cifrado. Devuelve 'locked' si este dispositivo no puede descifrar (no sube ni baja nada). */
  async function syncEncrypted(
    c: SyncConfig,
    s: Session,
    row: KeyRowData | null,
    dk0: CryptoKey | null,
    stored: unknown,
  ): Promise<'ok' | 'locked'> {
    let dk = dk0;
    if (!row && dk) {
      // Cifrado ya activado aquí pero sin fila key (p. ej. borrada): se recrea con la DK local. Nunca se sube en claro.
      const kid = await keyIdOf(dk);
      const stored = await putKeyRow(c, s, { v: 1, keyId: kid, recovery: null }, fetchImpl);
      if (stored.keyId !== kid) dk = null;
    }
    if (!dk) {
      encState = 'locked';
      return 'locked';
    }

    const migrating = (await repo.getMeta<boolean>(migKey(s.userId))) === true;
    encState = migrating ? 'migrating' : 'on';
    if (migrating) {
      // Migración: bajada completa (recifra y borra lo claro) y otra de verificación.
      await syncCipher(c, s, dk, null);
      const plainLeft = await syncCipher(c, s, dk, null);
      if (plainLeft === 0) {
        await repo.setMeta(migKey(s.userId), false); // migración verificada
        encState = 'on';
      }
    } else {
      const since = typeof stored === 'string' && stored ? overlapSince(stored) : null;
      await syncCipher(c, s, dk, since);
    }
    return 'ok';
  }

  async function doSync(c: SyncConfig): Promise<'ok' | 'locked'> {
    const s = session;
    if (!s) throw new SessionLost('Sesión cerrada');

    // Lecturas en paralelo: fila key, DK local, pendientes y cursor.
    const [row, rawDk, all, stored] = await Promise.all([
      readKeyRow(c, s),
      repo.getMeta<string>(dkKey(s.userId)),
      repo.pendingChanges(),
      repo.getMeta<string>(CURSOR_KEY),
    ]);
    const dk = rawDk ? await dkFrom(rawDk, row) : null;
    if (row || dk) return syncEncrypted(c, s, row, dk, stored);

    // Sin cifrado (cuenta sin fila key): el comportamiento de siempre.
    encState = 'off';
    const pending = all.filter((it) => it.kind !== 'setting');
    if (pending.length > 0) {
      lastActivity = now();
      await pushItems(c, s, pending, fetchImpl);
      await repo.markPushed(pending);
    }
    // Las preferencias van en su propia petición: si el servidor aún no tiene el tipo 'setting'
    // (hay que actualizar supabase/schema.sql), el 400 no debe impedir que sincronicen las tareas.
    const prefs = all.filter((it) => it.kind === 'setting');
    if (prefs.length > 0) {
      try {
        await pushItems(c, s, prefs, fetchImpl);
        await repo.markPushed(prefs);
      } catch (e) {
        if (!(e instanceof HttpError && e.status === 400)) throw e;
      }
    }

    const since = typeof stored === 'string' && stored ? overlapSince(stored) : null;
    const { items, cursor } = await pullItems(c, s, since, fetchImpl);
    if (items.length > 0) {
      lastActivity = now();
      await repo.applyRemote(items as RemoteItem[]);
    }
    if (cursor !== null) await repo.setMeta(CURSOR_KEY, cursor);
    return 'ok';
  }

  async function runOnce(): Promise<void> {
    const c = cfg;
    const s0 = session;
    if (!c || !s0) return;
    const myEpoch = epoch;
    const email = s0.email;
    lastAttempt = now();
    setState({ status: 'syncing', email });

    try {
      if (s0.expiresAt - now() < REFRESH_MARGIN_MS) await refreshSession(c);
      let outcome: 'ok' | 'locked';
      try {
        outcome = await doSync(c);
      } catch (e) {
        if (!(e instanceof HttpError && e.status === 401)) throw e;
        await refreshSession(c); // un solo reintento tras 401
        outcome = await doSync(c);
      }
      if (epoch !== myEpoch) return;
      if (outcome === 'locked') {
        setState({ status: 'locked', email });
        return;
      }
      // Lado activado: si hay una petición de enlace sin responder, se contesta. No hace fallar el sync.
      if (encState === 'on' || encState === 'migrating') await answerPendingLink();
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
  // Operación exclusiva en curso (activar, desbloquear, restablecer): mientras dure, no arranca ningún sync.
  let op: Promise<void> | null = null;

  /** Sync en bucle; si ya hay uno en marcha, pide otra vuelta y devuelve el que corre. No lanza. */
  function runSyncLoop(): Promise<void> {
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

  function syncNow(): Promise<void> {
    if (!cfg) return Promise.resolve();
    if (!session) {
      if (state.status !== 'signedOut') setState({ status: 'signedOut' });
      return Promise.resolve();
    }
    if (op) return op.then(noop, noop);
    return runSyncLoop();
  }

  /** Ejecuta una operación en exclusiva: espera al sync en curso y no deja arrancar otro hasta terminar. */
  function exclusive(fn: () => Promise<void>): Promise<void> {
    const prev = op;
    const p: Promise<void> = (async () => {
      if (prev) await prev.catch(noop);
      if (running) await running;
      try {
        await fn();
      } catch (e) {
        throw friendly(e);
      }
    })().finally(() => {
      if (op === p) op = null;
    });
    op = p;
    return p;
  }

  // ---------- cifrado ----------

  /** Guarda la DK de la cuenta tras comprobar que es la de la fila key, y sincroniza con bajada completa. */
  async function installDk(s: Session, row: KeyRowData, dk: CryptoKey): Promise<void> {
    if ((await keyIdOf(dk)) !== row.keyId) throw new Error('La clave no corresponde a esta cuenta');
    await repo.setMeta(dkKey(s.userId), await exportDk(dk));
    await repo.setMeta(CURSOR_KEY, null); // pull completo
    await runSyncLoop();
  }

  async function enableFn(): Promise<void> {
    const c = cfg;
    const s = session;
    if (!c || !s) throw new Error('Inicia sesión para activar el cifrado');
    // Sin sync previo: un sync en modo 'off' subiría en claro lo local antes de activar.
    if (encState === 'locked') throw new Error(ALREADY_ELSEWHERE);
    if (encState !== 'off') throw new Error('El cifrado ya está activado en esta cuenta.');

    // 1) Bajada completa en claro, para tener todo en local antes de cifrar.
    const pulled = await pullItems(c, s, null, fetchImpl);
    await repo.applyRemote(pulled.items.filter((it) => PLAIN_KINDS.includes(it.kind)));

    // 2) Generar la DK y crear la fila key. Si ya existe otra, este dispositivo no la toca.
    const dk = await generateDk();
    const kid = await keyIdOf(dk);
    const stored = await putKeyRow(c, s, { v: 1, keyId: kid, recovery: null }, fetchImpl);
    if (stored.keyId !== kid) {
      encState = 'locked';
      setState({ status: 'locked', email: s.email });
      throw new Error(ALREADY_ELSEWHERE);
    }

    // 3) Guardar la DK y la migración pendiente. 4) Todo pendiente de subir (incluidos tombstones).
    await repo.setMeta(dkKey(s.userId), await exportDk(dk));
    await repo.setMeta(migKey(s.userId), true);
    await repo.markAllDirty();

    // 5) Sync: sube todo cifrado y ejecuta la migración.
    encState = 'migrating';
    await runSyncLoop();
  }

  async function unlockFn(recoveryKey: string): Promise<void> {
    const c = cfg;
    const s = session;
    if (!c || !s) throw new Error('Inicia sesión primero');
    const row = await readKeyRow(c, s);
    if (!row || !row.recovery) throw new Error('Esta cuenta no tiene clave de recuperación');
    const dk = await unwrapWithRecovery(row.recovery, recoveryKey);
    await installDk(s, row, dk);
  }

  async function adoptFn(dk: CryptoKey): Promise<void> {
    const c = cfg;
    const s = session;
    if (!c || !s) throw new Error('Inicia sesión primero');
    const row = await readKeyRow(c, s);
    if (!row) throw new Error('Esta cuenta no tiene cifrado activado');
    await installDk(s, row, dk);
  }

  function adoptKey(dk: CryptoKey): Promise<void> {
    return exclusive(() => adoptFn(dk));
  }

  async function resetFn(): Promise<void> {
    const c = cfg;
    const s = session;
    if (!c || !s) throw new Error('Inicia sesión primero');
    if (encState !== 'locked' && encState !== 'on') throw new Error('El cifrado no está activo en esta cuenta.');

    // Nueva DK. Al cambiar la fila key, los demás dispositivos pasan a 'locked'.
    const dk = await generateDk();
    const kid = await keyIdOf(dk);
    await updateKeyRow(c, s, { v: 1, keyId: kid, recovery: null }, fetchImpl);
    await deleteAllEnc(c, s, fetchImpl);
    await repo.setMeta(dkKey(s.userId), await exportDk(dk));
    await repo.setMeta(migKey(s.userId), true);
    await repo.markAllDirty();
    await repo.setMeta(CURSOR_KEY, null);
    encState = 'migrating';
    await runSyncLoop();
  }

  async function createRecoveryKey(): Promise<string> {
    const c = cfg;
    const s = session;
    if (!c || !s) throw new Error('Inicia sesión primero');
    const row = await readKeyRow(c, s);
    if (!row) throw new Error('Activa primero el cifrado');
    const dk = await loadDk(s.userId, row);
    if (!dk) throw new Error('Este dispositivo no tiene la clave de cifrado. Enlázalo primero.');
    const key = generateRecoveryKey();
    const recovery = await wrapWithRecovery(dk, key);
    await updateKeyRow(c, s, { v: 1, keyId: row.keyId, recovery }, fetchImpl);
    return key;
  }

  // ---------- sesión ----------

  async function adopt(s: Session): Promise<void> {
    epoch++;
    dropLink();
    session = s;
    encState = 'off';
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
    dropLink();
    session = null;
    encState = 'off';
    auth.clearSession(storage);
    setState({ status: 'signedOut' });
    if (old) await auth.signOut(c, old.accessToken, fetchImpl);
    await repo.setMeta(CURSOR_KEY, null);
  }

  async function deleteAccount(): Promise<{ remote: 'none' | 'data' | 'account' }> {
    const c = cfg;
    const s = session;
    if (!c || !s) return { remote: 'none' };
    let res: { account: boolean };
    try {
      res = await deleteRemoteAccount(c, s, fetchImpl);
    } catch (e) {
      throw friendly(e);
    }
    // La cuenta ya no existe: se cierra la sesión solo en local.
    epoch++;
    dropLink();
    session = null;
    encState = 'off';
    auth.clearSession(storage);
    setState({ status: 'signedOut' });
    return { remote: res.account ? 'account' : 'data' };
  }

  // ---------- enlace de dispositivos (docs/plan-cifrado.md §4 y §7) ----------

  /** Cambia el estado del enlace y repinta a los suscriptores. */
  function setLink(l: LinkState | null): void {
    linkSt = l;
    setState({ ...state });
  }

  function stopLinkTimer(): void {
    if (linkTimer) clearInterval(linkTimer);
    linkTimer = null;
  }

  /** Corta el sondeo y descarta el protocolo, sin borrar la petición del servidor. */
  function dropLink(): void {
    stopLinkTimer();
    linkCtx = null;
    if (linkSt !== null) setLink(null);
  }

  /** Enlace en error: corta el sondeo y descarta el protocolo. */
  function failLink(role: 'new' | 'active', message: string): void {
    stopLinkTimer();
    linkCtx = null;
    setLink({ role, status: 'error', message });
  }

  function startLinkTimer(): void {
    stopLinkTimer();
    linkTimer = setInterval(() => void pollLink(), LINK_POLL_MS);
  }

  /** Transporte de pairings sobre la sesión actual. Una petición caducada según now() cuenta como ausente. */
  function pairingTransport(c: SyncConfig): PairingTransport {
    const current = (): Session => {
      if (!session) throw new SessionLost('Sesión cerrada');
      return session;
    };
    return {
      create: (row) => createPairing(c, current(), row, fetchImpl),
      get: async (id) => {
        const row = await getPairing(c, current(), id, fetchImpl);
        // Date.parse no admite microsegundos: se recortan a milisegundos.
        if (!row || Date.parse(row.expires_at.replace(/(\.\d{3})\d+/, '$1')) <= now()) return null;
        return row;
      },
      update: (id, patch) => updatePairing(c, current(), id, patch, fetchImpl),
      remove: (id) => deletePairing(c, current(), id, fetchImpl),
    };
  }

  /** Sondeo del enlace en curso (cada LINK_POLL_MS). Nunca se solapa con otro. */
  async function pollLink(): Promise<void> {
    const ctx = linkCtx;
    if (!ctx || linkBusy || !cfg) return;
    linkBusy = true;
    const myEpoch = epoch;
    const stale = (): boolean => epoch !== myEpoch || linkCtx !== ctx;
    try {
      const t = pairingTransport(cfg);
      if (ctx.role === 'new') {
        const r = await stepB(t, ctx.st);
        if (stale()) return;
        if (r.status === 'waiting') return;
        if (r.status === 'code') {
          if (linkSt?.status !== 'code') setLink({ role: 'new', status: 'code', code: r.code });
          return;
        }
        if (r.status === 'gone') {
          failLink('new', 'El enlace se canceló o caducó. Vuelve a intentarlo.');
          return;
        }
        // 'done': la DK ya está descifrada. adoptKey verifica el keyId y hace la bajada completa.
        stopLinkTimer();
        linkCtx = null;
        setLink(null);
        try {
          await adoptKey(r.dk);
        } catch (e) {
          if (epoch === myEpoch) setLink({ role: 'new', status: 'error', message: friendly(e).message });
        }
        return;
      }

      const r = await stepA(t, ctx.st);
      if (stale()) return;
      if (r.status === 'waiting') return;
      if (r.status === 'code') {
        if (linkSt?.status !== 'code') setLink({ role: 'active', status: 'code', code: r.code });
        return;
      }
      // 'gone': el dispositivo nuevo ha cancelado o caducado la petición.
      stopLinkTimer();
      linkCtx = null;
      setLink(null);
    } catch (e) {
      if (stale()) return;
      // Un PairingError es definitivo. Otros fallos (red) se reintentan en el siguiente tick.
      if (e instanceof PairingError) failLink(ctx.role, e.message);
    } finally {
      linkBusy = false;
    }
  }

  /**
   * Lado activado: si hay una petición nueva sin responder, la contesta. Nunca lanza. Es una comprobación en
   * segundo plano que el usuario no ha pedido: un fallo solo se registra y se reintenta en la siguiente.
   */
  async function answerPendingLink(): Promise<void> {
    const c = cfg;
    const s = session;
    if (!c || !s || linkCtx || linkBusy) return;
    linkBusy = true;
    const myEpoch = epoch;
    try {
      const rows = await listPendingPairings(c, s, fetchImpl);
      if (epoch !== myEpoch || linkCtx) return;
      const row = rows.find((r) => r.pk_a === null); // la más reciente sin responder (la lista ya viene ordenada)
      if (!row) return;
      const st = await answerPairing(pairingTransport(c), row);
      if (epoch !== myEpoch) return;
      linkCtx = { role: 'active', st };
      setLink({ role: 'active', status: 'waiting' });
      startLinkTimer();
    } catch (e) {
      console.warn('Enlace: no se pudieron comprobar las peticiones pendientes', e);
    } finally {
      linkBusy = false;
    }
  }

  /** Mientras el cifrado esté activo y no haya enlace en curso, busca peticiones nuevas cada LINK_CHECK_MS. */
  function onLinkCheck(): void {
    if (encState === 'on' && !linkCtx) void answerPendingLink();
  }

  /** Lado nuevo: pide el enlace a un dispositivo activado. Requiere sesión y el cifrado bloqueado. */
  async function startLinkFn(): Promise<void> {
    const c = cfg;
    const s = session;
    if (!c || !s) throw new Error('Inicia sesión primero');
    if (encState !== 'locked') throw new Error('Solo un dispositivo bloqueado puede pedir el enlace');
    if (linkCtx) throw new Error('Ya hay un enlace en curso');
    const myEpoch = epoch;
    try {
      await deleteExpiredPairings(c, s, fetchImpl);
      const st = await startPairing(pairingTransport(c));
      if (epoch !== myEpoch) return;
      linkCtx = { role: 'new', st };
      setLink({ role: 'new', status: 'waiting' });
      startLinkTimer();
    } catch (e) {
      throw friendly(e);
    }
  }

  /** Cancela el enlace en curso, en cualquiera de los dos lados, y borra la petición. No falla si ya no existe. */
  async function cancelLinkFn(): Promise<void> {
    const c = cfg;
    const ctx = linkCtx;
    stopLinkTimer();
    linkCtx = null;
    if (linkSt !== null) setLink(null);
    if (!ctx || !c) return;
    try {
      await rejectPairing(pairingTransport(c), ctx.st.id);
    } catch (e) {
      throw friendly(e);
    }
  }

  /** Lado activado: confirma que el código coincide y envía la DK cifrada al dispositivo nuevo. */
  async function confirmLinkFn(): Promise<void> {
    const c = cfg;
    const s = session;
    const ctx = linkCtx;
    if (!ctx || ctx.role !== 'active' || linkSt?.role !== 'active' || linkSt.status !== 'code') {
      throw new Error('No hay ningún código que confirmar');
    }
    if (!c || !s) throw new Error('Inicia sesión primero');
    const myEpoch = epoch;
    try {
      const row = await readKeyRow(c, s);
      const dk = await loadDk(s.userId, row);
      if (!dk) throw new Error('Este dispositivo no tiene la clave de cifrado');
      await confirmPairing(pairingTransport(c), ctx.st, dk);
    } catch (e) {
      throw friendly(e);
    }
    if (epoch !== myEpoch || linkCtx !== ctx) return;
    stopLinkTimer();
    linkCtx = null;
    setLink(null);
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
    lastActivity = now();
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
    if (!isVisible()) return;
    lastActivity = now();
    trigger();
  };

  const onTick = (): void => {
    if (isVisible() && session && now() - lastAttempt >= pollInterval(now() - lastActivity)) trigger();
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
    interval = setInterval(onTick, TICK_MS);
    linkCheckTimer = setInterval(onLinkCheck, LINK_CHECK_MS);
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
    if (linkCheckTimer) clearInterval(linkCheckTimer);
    linkCheckTimer = null;
    dropLink(); // el enlace en curso no sigue sin sondeo; la petición caduca sola en el servidor
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
    deleteAccount,
    syncNow,
    start,
    stop,
    encryption: () => encState,
    enableEncryption: () => exclusive(enableFn),
    createRecoveryKey,
    unlockWithRecovery: (recoveryKey) => exclusive(() => unlockFn(recoveryKey)),
    resetEncryption: () => exclusive(resetFn),
    adoptKey,
    link: () => linkSt,
    startLink: startLinkFn,
    cancelLink: cancelLinkFn,
    confirmLink: confirmLinkFn,
  };
}
