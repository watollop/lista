import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import type { EncRow, ParsedLine, Repo, RemoteItem } from '../types';
import { createRepo } from '../data/repo';
import { createSync } from './index';
import { pushItems } from './api';
import type { Session } from './auth';
import { generateDk, importDk, keyIdOf, remoteId } from './crypto';

const CFG = { url: 'https://enc.supabase.co', anonKey: 'anon-key' };
const BASE_TS = Date.parse('2026-10-27T10:00:00Z');

// ---------- servidor falso (GoTrue + PostgREST con filtros) ----------

interface Row {
  user_id: string;
  kind: string;
  id: string;
  data: unknown;
  updated_at: number;
  deleted: boolean;
  synced_at: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function headerOf(init: RequestInit | undefined, name: string): string | undefined {
  const h = init?.headers as Record<string, string> | undefined;
  return h?.[name];
}

/** Valores entre comillas de un filtro in.("a","b"). */
function inList(v: string): string[] {
  return [...v.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\(.)/g, '$1'));
}

/** Aplica los filtros kind=eq, id=eq|in y user_id=eq de la URL a una fila. */
function matches(row: Row, url: URL): boolean {
  for (const [k, v] of url.searchParams) {
    if (k === 'kind' && v.startsWith('eq.') && row.kind !== v.slice(3)) return false;
    if (k === 'user_id' && v.startsWith('eq.') && row.user_id !== v.slice(3)) return false;
    if (k === 'id') {
      if (v.startsWith('eq.') && row.id !== v.slice(3)) return false;
      if (v.startsWith('in.(') && !inList(v).includes(row.id)) return false;
    }
  }
  return true;
}

class FakeServer {
  users = new Map<string, { id: string; email: string; password: string }>();
  accessTokens = new Map<string, string>(); // token -> userId
  refreshTokens = new Map<string, { userId: string; email: string }>();
  rows = new Map<string, Row>(); // `${userId}|${kind}|${id}`
  offline = false;
  private tokenSeq = 0;
  private seq = 0;

  addUser(email: string, password: string): void {
    this.users.set(email, { id: `user-${this.users.size + 1}`, email, password });
  }

  /** Filas de un kind (todos los usuarios). */
  rowsOf(kind: string): Row[] {
    return [...this.rows.values()].filter((r) => r.kind === kind);
  }

  kinds(): Set<string> {
    return new Set([...this.rows.values()].map((r) => r.kind));
  }

  dump(): string {
    return JSON.stringify([...this.rows.values()]);
  }

  private issue(userId: string, email: string) {
    const access = `at-${++this.tokenSeq}`;
    const refresh = `rt-${this.tokenSeq}`;
    this.accessTokens.set(access, userId);
    this.refreshTokens.set(refresh, { userId, email });
    return {
      access_token: access,
      refresh_token: refresh,
      expires_in: 3600,
      token_type: 'bearer',
      user: { id: userId, email },
    };
  }

  private nextSynced(): string {
    this.seq++;
    return new Date(BASE_TS + this.seq * 1000).toISOString().replace('Z', '+00:00');
  }

  private userRows(uid: string): Row[] {
    return [...this.rows.values()].filter((r) => r.user_id === uid);
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (this.offline) throw new TypeError('Failed to fetch');
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(init.body as string) : undefined;

    if (headerOf(init, 'apikey') !== CFG.anonKey) return json({ message: 'Invalid API key' }, 401);

    if (url.pathname === '/auth/v1/token') {
      if (url.searchParams.get('grant_type') === 'password') {
        const u = this.users.get(body.email);
        if (!u || u.password !== body.password) {
          return json({ error: 'invalid_grant', error_description: 'Invalid login credentials' }, 400);
        }
        return json(this.issue(u.id, u.email));
      }
      const stored = this.refreshTokens.get(body.refresh_token);
      if (!stored) return json({ error_description: 'Invalid Refresh Token' }, 400);
      this.refreshTokens.delete(body.refresh_token);
      return json(this.issue(stored.userId, stored.email));
    }

    if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });

    if (url.pathname === '/rest/v1/items') {
      const token = headerOf(init, 'Authorization')?.replace('Bearer ', '') ?? '';
      const uid = this.accessTokens.get(token);
      if (!uid) return json({ message: 'JWT expired', code: 'PGRST303' }, 401);
      if (method === 'POST') return this.upsert(uid, body, headerOf(init, 'Prefer') ?? '');
      if (method === 'GET') return this.select(uid, url);
      if (method === 'PATCH') return this.patch(uid, url, body);
      if (method === 'DELETE') return this.remove(uid, url);
    }

    return json({ message: 'not found' }, 404);
  };

  /** Upsert por (user_id, kind, id). merge: LWW (no pisa si llega un updated_at menor). ignore: nunca pisa. */
  private upsert(uid: string, rows: Array<Omit<Row, 'synced_at'>>, prefer: string): Response {
    const ignore = prefer.includes('ignore-duplicates');
    for (const r of rows) {
      if (r.user_id !== uid) return json({ message: 'new row violates row-level security policy' }, 403);
      const key = `${uid}|${r.kind}|${r.id}`;
      const cur = this.rows.get(key);
      if (cur && (ignore || r.updated_at < cur.updated_at)) continue;
      this.rows.set(key, { ...r, user_id: uid, synced_at: this.nextSynced() });
    }
    return new Response(null, { status: 201 });
  }

  private select(uid: string, url: URL): Response {
    let list = this.userRows(uid).filter((r) => matches(r, url));
    const since = url.searchParams.get('synced_at');
    if (since) {
      const t = Date.parse(since.replace(/^gt\./, ''));
      list = list.filter((r) => Date.parse(r.synced_at) > t);
    }
    list.sort((a, b) => Date.parse(a.synced_at) - Date.parse(b.synced_at));
    const limit = Number(url.searchParams.get('limit') ?? 1000);
    return json(
      list.slice(0, limit).map(({ kind, id, data, updated_at, deleted, synced_at }) => ({
        kind,
        id,
        data,
        updated_at: String(updated_at),
        deleted,
        synced_at,
      })),
    );
  }

  /** Como el trigger LWW real: un UPDATE con updated_at menor que el guardado se descarta sin error. */
  private patch(uid: string, url: URL, body: { data?: unknown; updated_at?: number }): Response {
    const written: Row[] = [];
    for (const r of this.userRows(uid)) {
      if (!matches(r, url)) continue;
      if (body.updated_at !== undefined && body.updated_at < r.updated_at) continue;
      r.data = body.data ?? r.data;
      r.updated_at = body.updated_at ?? r.updated_at;
      r.synced_at = this.nextSynced();
      written.push(r);
    }
    return json(written); // Prefer: return=representation
  }

  private remove(uid: string, url: URL): Response {
    for (const r of this.userRows(uid)) {
      if (matches(r, url)) this.rows.delete(`${uid}|${r.kind}|${r.id}`);
    }
    return new Response(null, { status: 204 });
  }
}

// ---------- dispositivos ----------

function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

function makeClock(start = BASE_TS) {
  let t = start;
  return { now: () => t };
}

interface Device {
  repo: Repo;
  sync: ReturnType<typeof createSync>;
  storage: ReturnType<typeof memStorage>;
}

/** Dispositivo con su propia base IndexedDB (fake-indexeddb): dos de ellos son dos navegadores. */
function device(server: FakeServer, clock: ReturnType<typeof makeClock>): Device {
  const repo = createRepo(`enc-test-${crypto.randomUUID()}`);
  const storage = memStorage();
  const sync = createSync(repo, CFG, {
    fetch: server.fetch as unknown as typeof fetch,
    storage,
    now: clock.now,
  });
  return { repo, sync, storage };
}

function sessionOf(d: Device): Session {
  return JSON.parse(d.storage.getItem('lista.session')!) as Session;
}

async function dkOf(d: Device): Promise<CryptoKey> {
  const b64 = await d.repo.getMeta<string>(`dk:${sessionOf(d).userId}`);
  return importDk(b64!);
}

function line(title: string, extra: Partial<ParsedLine> = {}): ParsedLine {
  return {
    title,
    topics: [],
    people: [],
    due: null,
    period: null,
    priority: null,
    recurrence: null,
    isSubtask: false,
    tokens: [],
    ...extra,
  };
}

async function addTask(repo: Repo, title: string, topics: string[] = []) {
  const [t] = await repo.addParsed([line(title, { topics })]);
  return t;
}

async function titles(repo: Repo): Promise<string[]> {
  return (await repo.listTasks()).map((t) => t.title);
}

/** Inicia sesión en un dispositivo (la cuenta es la misma para todos). */
async function login(d: Device): Promise<void> {
  await d.sync.signIn('ana@test.io', 'secreto');
}

/** Dos dispositivos de la misma cuenta, sin sesión iniciada todavía. */
function twoDevices() {
  const server = new FakeServer();
  server.addUser('ana@test.io', 'secreto');
  const clock = makeClock();
  return { server, a: device(server, clock), b: device(server, clock) };
}

/** Un registro en claro que sube un cliente antiguo, con la sesión de un dispositivo. */
async function pushLegacy(server: FakeServer, d: Device, items: RemoteItem[] | EncRow[]): Promise<void> {
  await pushItems(CFG, sessionOf(d), items, server.fetch as unknown as typeof fetch);
}

// ---------- tests ----------

describe('cifrado: obligatorio', () => {
  it('1. el primer sync de una cuenta la cifra sin subir nada en claro, y recifra lo que ya había en claro', async () => {
    const { server, a } = twoDevices();
    // Cuenta con datos de una versión anterior de la app, sin fila key.
    server.rows.set('user-1|task|vieja', {
      user_id: 'user-1', kind: 'task', id: 'vieja',
      data: {
        id: 'vieja', title: 'Tarea en claro', topics: [], people: [], due: null, period: null,
        priority: null, recurrence: null, parentId: null, done: 0, doneAt: null, nextId: null,
        order: 1, createdAt: 100, updatedAt: 100, deleted: 0,
      },
      updated_at: 100, deleted: false, synced_at: new Date(BASE_TS).toISOString(),
    });
    expect(a.sync.encryption()).toBe('off');

    await login(a);
    await addTask(a.repo, 'Comprar pan');
    await a.sync.syncNow();

    expect(a.sync.encryption()).toBe('on');
    expect(server.kinds()).toEqual(new Set(['enc', 'key']));
    expect(server.dump()).not.toContain('Comprar pan');
    expect(server.dump()).not.toContain('Tarea en claro');
    expect((await titles(a.repo)).sort()).toEqual(['Comprar pan', 'Tarea en claro']);
  });
});

describe('cifrado: activación', () => {
  it('2. tras activar, el servidor solo tiene filas enc y key, sin títulos ni nombres; los tombstones se cifran', async () => {
    const { server, a } = twoDevices();
    await login(a);
    await addTask(a.repo, 'Comprar pan secreto', ['Familia Secreta']);
    const gone = await addTask(a.repo, 'Tarea borrada Zeta');
    await a.repo.deleteTask(gone.id);

    await a.sync.syncNow();

    const dump = server.dump();
    expect(dump).not.toContain('Comprar pan secreto');
    expect(dump).not.toContain('Familia Secreta');
    expect(dump).not.toContain('Tarea borrada Zeta');
    expect(server.kinds()).toEqual(new Set(['enc', 'key']));
    // tarea, tombstone y tema: tres filas cifradas, una de ellas borrada
    expect(server.rowsOf('enc')).toHaveLength(3);
    expect(server.rowsOf('enc').some((r) => r.deleted)).toBe(true);
    expect(a.sync.encryption()).toBe('on');
    expect(await titles(a.repo)).toEqual(['Comprar pan secreto']);
  });

  it('3. un dispositivo sin clave pasa a locked y no sube nada en claro', async () => {
    const { server, a, b } = twoDevices();
    await login(a);
    await addTask(a.repo, 'Previa de A');
    await a.sync.syncNow();

    await login(b);
    expect(b.sync.getState()).toMatchObject({ status: 'locked', email: 'ana@test.io' });
    expect(b.sync.encryption()).toBe('locked');

    await addTask(b.repo, 'Tarea de B');
    await b.sync.syncNow();

    expect(b.sync.getState().status).toBe('locked');
    expect(server.dump()).not.toContain('Tarea de B');
    expect(server.kinds()).toEqual(new Set(['enc', 'key']));
    expect((await b.repo.pendingChanges()).length).toBeGreaterThan(0); // sigue pendiente, sin subir
  });

  it('4. la clave de recuperación desbloquea B, y los cambios de B llegan a A cifrados', async () => {
    const { server, a, b } = twoDevices();
    await login(a);
    await addTask(a.repo, 'Lista A');
    await a.sync.syncNow();
    await a.sync.syncNow();
    const recovery = await a.sync.createRecoveryKey();

    await login(b);
    expect(b.sync.encryption()).toBe('locked');
    await b.sync.unlockWithRecovery(recovery);
    expect(b.sync.getState().status).toBe('idle');
    expect(b.sync.encryption()).toBe('on');
    expect(await titles(b.repo)).toEqual(['Lista A']);

    const [t] = await b.repo.listTasks();
    await b.repo.updateTask(t.id, { title: 'Editada en B' });
    await b.sync.syncNow();
    await a.sync.syncNow();

    expect(await titles(a.repo)).toEqual(['Editada en B']);
    expect(server.dump()).not.toContain('Editada en B');
  });

  it('5. adoptKey con la DK de A desbloquea B; con otra DK lanza Error', async () => {
    const { a, b } = twoDevices();
    await login(a);
    await addTask(a.repo, 'Compartida');
    await a.sync.syncNow();
    await a.sync.syncNow();

    await login(b);
    expect(b.sync.encryption()).toBe('locked');

    await expect(b.sync.adoptKey(await generateDk())).rejects.toThrow('La clave no corresponde a esta cuenta');
    expect(b.sync.encryption()).toBe('locked');

    await b.sync.adoptKey(await dkOf(a));
    expect(b.sync.getState().status).toBe('idle');
    expect(await titles(b.repo)).toEqual(['Compartida']);
  });

  it('6. una fila en claro de un dispositivo antiguo se aplica, se recifra y desaparece del servidor', async () => {
    const { server, a } = twoDevices();
    await login(a);
    await a.sync.syncNow();
    await a.sync.syncNow();

    await pushLegacy(server, a, [
      {
        kind: 'task',
        id: 'legacy-1',
        data: {
          id: 'legacy-1', title: 'Tarea antigua', topics: [], people: [], due: null, period: null,
          priority: null, recurrence: null, parentId: null, done: 0, doneAt: null, nextId: null,
          order: 1, createdAt: 100, updatedAt: 100, deleted: 0,
        },
        updated_at: 100,
        deleted: false,
      } as unknown as RemoteItem,
    ]);
    expect(server.rowsOf('task')).toHaveLength(1);

    await a.sync.syncNow();

    expect(await titles(a.repo)).toContain('Tarea antigua');
    expect(server.rowsOf('task')).toHaveLength(0);
    const dk = await dkOf(a);
    const expectedId = await remoteId(dk, 'task', 'legacy-1');
    expect(server.rowsOf('enc').map((r) => r.id)).toContain(expectedId);
    expect(a.sync.encryption()).toBe('on');
  });

  it('7. una fila enc corrupta se omite sin romper el sync', async () => {
    const { server, a, b } = twoDevices();
    await login(a);
    await addTask(a.repo, 'Valida');
    await a.sync.syncNow();
    await a.sync.syncNow();

    const corrupt: EncRow = {
      kind: 'enc',
      id: 'f'.repeat(64),
      data: { v: 1, iv: 'AAAAAAAAAAAAAAAA', ct: 'AAAA' },
      updated_at: 50,
      deleted: false,
    };
    await pushLegacy(server, a, [corrupt]);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await login(b);
    await b.sync.adoptKey(await dkOf(a));
    warn.mockRestore();

    expect(b.sync.getState().status).toBe('idle');
    expect(await titles(b.repo)).toEqual(['Valida']);
    expect(server.rows.get(`user-1|enc|${corrupt.id}`)).toBeDefined(); // el servidor no se toca
  });

  it('8. si la fila key desaparece, A la recrea con su DK y no sube nada en claro', async () => {
    const { server, a } = twoDevices();
    await login(a);
    await a.sync.syncNow();
    await a.sync.syncNow();

    server.rows.delete('user-1|key|dk');
    await addTask(a.repo, 'Nueva sin cifrar');
    await a.sync.syncNow();

    const keyRow = server.rows.get('user-1|key|dk');
    expect(keyRow).toBeDefined();
    expect((keyRow!.data as { keyId: string }).keyId).toBe(await keyIdOf(await dkOf(a)));
    expect(server.dump()).not.toContain('Nueva sin cifrar');
    expect(server.kinds()).toEqual(new Set(['enc', 'key']));
    expect(a.sync.encryption()).toBe('on');
  });

  it('9. resetEncryption en B bloqueado: B queda on con DK nueva y A pasa a locked', async () => {
    const { server, a, b } = twoDevices();
    await login(a);
    await a.sync.syncNow();
    await a.sync.syncNow();

    await login(b);
    expect(b.sync.encryption()).toBe('locked');
    await addTask(b.repo, 'Local de B');

    await b.sync.resetEncryption();

    expect(b.sync.encryption()).toBe('on');
    expect(b.sync.getState().status).toBe('idle');
    expect(server.dump()).not.toContain('Local de B');
    expect(server.kinds()).toEqual(new Set(['enc', 'key']));

    await a.sync.syncNow();
    expect(a.sync.getState().status).toBe('locked');
    expect(a.sync.encryption()).toBe('locked');
  });

  it('10. dos dispositivos con datos locales inician sesión a la vez: uno cifra, el otro queda locked sin subir nada', async () => {
    const { server, a, b } = twoDevices();
    await addTask(a.repo, 'Local de A');
    await addTask(b.repo, 'Local de B');

    await Promise.all([login(a), login(b)]);

    const states = [a.sync.encryption(), b.sync.encryption()].sort();
    expect(states).toEqual(['locked', 'on']);
    const [winner, loser] = a.sync.encryption() === 'on' ? [a, b] : [b, a];
    expect(loser.sync.getState().status).toBe('locked');
    expect(server.kinds()).toEqual(new Set(['enc', 'key']));
    expect(server.dump()).not.toContain('Local de');

    // Al enlazarse, lo local del que perdió sube cifrado y llega al otro.
    await loser.sync.adoptKey(await dkOf(winner));
    await winner.sync.syncNow();
    expect((await titles(winner.repo)).sort()).toEqual(['Local de A', 'Local de B']);
    expect(server.dump()).not.toContain('Local de');
  });
});

// La fila key se escribe con Date.now() del dispositivo y el trigger LWW descarta un updated_at menor.
describe('cifrado: reloj atrasado', () => {
  function clockSkew(ms: number): () => void {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + ms);
    return () => vi.useRealTimers();
  }

  it('12. la clave de recuperación se guarda aunque el reloj vaya por detrás de la fila key', async () => {
    const { a, b } = twoDevices();
    await login(a);
    await a.sync.syncNow();
    await a.sync.syncNow();

    const restore = clockSkew(-60_000);
    let recovery: string;
    try {
      recovery = await a.sync.createRecoveryKey();
    } finally {
      restore();
    }

    await login(b);
    await b.sync.unlockWithRecovery(recovery);
    expect(b.sync.encryption()).toBe('on');
  });

  it('13. resetEncryption con el reloj atrasado cambia la fila key y no deja la cuenta sin datos', async () => {
    const { server, a, b } = twoDevices();
    await login(a);
    await addTask(a.repo, 'De A');
    await a.sync.syncNow();
    await a.sync.syncNow();

    await login(b);
    await addTask(b.repo, 'Local de B');
    const restore = clockSkew(-60_000);
    try {
      await b.sync.resetEncryption();
    } finally {
      restore();
    }

    expect(b.sync.encryption()).toBe('on');
    expect((server.rows.get('user-1|key|dk')!.data as { keyId: string }).keyId).toBe(await keyIdOf(await dkOf(b)));
    expect(server.rowsOf('enc').length).toBeGreaterThan(0);
  });
});

describe('cifrado: datos locales', () => {
  it('11. clearAll limpia también las preferencias y la DK', async () => {
    const { a } = twoDevices();
    await login(a);
    await a.repo.setSetting('theme', 'dark');
    await a.repo.setMeta('dk:user-1', 'clave');

    await a.repo.clearAll();

    expect(await a.repo.getSetting('theme')).toBeUndefined();
    expect(await a.repo.getMeta('dk:user-1')).toBeUndefined();
  });
});

describe('cerrar sesión y cambiar de cuenta', () => {
  it('14. signOut borra las tareas y la clave del dispositivo; siguen en la cuenta', async () => {
    const { a } = twoDevices();
    await login(a);
    await addTask(a.repo, 'Comprar pan');
    await a.sync.syncNow();
    const key = await a.sync.createRecoveryKey();
    const userId = sessionOf(a).userId;

    await a.sync.signOut();

    expect(await titles(a.repo)).toEqual([]);
    expect(await a.repo.getMeta(`dk:${userId}`)).toBeUndefined();
    expect(a.storage.getItem('lista.session')).toBeNull();

    // Al volver a entrar el dispositivo está bloqueado; con la clave de recuperación recupera las tareas.
    await login(a);
    expect(a.sync.encryption()).toBe('locked');
    await a.sync.unlockWithRecovery(key);
    expect(await titles(a.repo)).toEqual(['Comprar pan']);
  });

  it('15. otra cuenta en el mismo dispositivo no recibe ni sube los datos que dejó la anterior', async () => {
    const { server, a } = twoDevices();
    server.addUser('bea@test.io', 'secreto');
    await login(a);
    await addTask(a.repo, 'Secreto de Ana');
    await a.sync.syncNow();
    // Una versión anterior cerraba sesión sin borrar: los datos de Ana siguen en el dispositivo.
    a.storage.removeItem('lista.session');
    const nueva = createSync(a.repo, CFG, { fetch: server.fetch as unknown as typeof fetch, storage: a.storage, now: makeClock().now });

    await nueva.signIn('bea@test.io', 'secreto');

    expect(await titles(a.repo)).toEqual([]);
    const bea = [...server.rows.values()].filter((r) => r.user_id === 'user-2');
    expect(bea.filter((r) => r.kind === 'enc')).toHaveLength(0);
    expect(server.dump()).not.toContain('Secreto de Ana');
  });

  it('16. lo apuntado sin cuenta pasa a la primera cuenta que entra', async () => {
    const { server, a } = twoDevices();
    await addTask(a.repo, 'Antes de entrar');

    await login(a);

    expect(await titles(a.repo)).toEqual(['Antes de entrar']);
    expect(server.rowsOf('enc')).toHaveLength(1);
  });

  it('17. signOutCheck pide clave de recuperación si este dispositivo tiene la única clave', async () => {
    const { a } = twoDevices();
    await login(a);
    await addTask(a.repo, 'Tarea');

    expect(await a.sync.signOutCheck()).toEqual({ pending: 0, recovery: false });
    await a.sync.createRecoveryKey();
    expect(await a.sync.signOutCheck()).toEqual({ pending: 0, recovery: true });
  });

  it('18. sin conexión, signOutCheck cuenta los cambios sin subir y no puede comprobar la clave', async () => {
    const { server, a } = twoDevices();
    await login(a);
    server.offline = true;
    await addTask(a.repo, 'Sin subir');

    expect(await a.sync.signOutCheck()).toEqual({ pending: 1, recovery: null });
  });

  it('19. un dispositivo bloqueado no pierde ninguna clave, pero sí avisa de sus cambios sin subir', async () => {
    const { a, b } = twoDevices();
    await login(a);
    await a.sync.syncNow();
    await login(b);
    await addTask(b.repo, 'Hecha en B');

    expect(await b.sync.signOutCheck()).toEqual({ pending: 1, recovery: true });
  });
});
