import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ParsedLine, PairingRow, Repo } from '../types';
import { createRepo } from '../data/repo';
import { createSync } from './index';

const CFG = { url: 'https://link.supabase.co', anonKey: 'anon-key' };
const LINK_POLL_MS = 2_000;
const LINK_CHECK_MS = 5_000;
const PAIRING_TTL_MS = 10 * 60_000;
const REJECTED_MSG = 'El otro dispositivo rechazó el enlace o la petición caducó.';
const EXPIRED_MSG = 'Nadie respondió a tiempo: la petición caducó. Vuelve a intentarlo con el otro dispositivo abierto.';

// ---------- servidor falso (GoTrue + items + pairings con filtros) ----------

interface Row {
  user_id: string;
  kind: string;
  id: string;
  data: unknown;
  updated_at: number;
  deleted: boolean;
  synced_at: string;
}

interface PairingDb extends PairingRow {
  user_id: string;
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

/** Aplica los filtros kind=eq, id=eq|in y user_id=eq de la URL a una fila de items. */
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

/** Filtros de pairings: id=eq y expires_at=gt|lt (comparados en tiempo real, igual que el cliente). */
function pairingMatches(row: PairingDb, url: URL): boolean {
  for (const [k, v] of url.searchParams) {
    if (k === 'id' && v.startsWith('eq.') && row.id !== v.slice(3)) return false;
    if (k === 'expires_at') {
      const op = v.slice(0, 3);
      const t = Date.parse(v.slice(3));
      const e = Date.parse(row.expires_at);
      if (op === 'gt.' && !(e > t)) return false;
      if (op === 'lt.' && !(e < t)) return false;
    }
  }
  return true;
}

function stripUser({ user_id: _uid, ...rest }: PairingDb): PairingRow {
  return rest;
}

class FakeServer {
  users = new Map<string, { id: string; email: string; password: string }>();
  accessTokens = new Map<string, string>(); // token -> userId
  refreshTokens = new Map<string, { userId: string; email: string }>();
  rows = new Map<string, Row>(); // `${userId}|${kind}|${id}`
  pairings = new Map<string, PairingDb>(); // por id, en orden de creación
  pairingsDown = false; // si true, /rest/v1/pairings responde 500
  private tokenSeq = 0;
  private seq = 0;

  addUser(email: string, password: string): void {
    this.users.set(email, { id: `user-${this.users.size + 1}`, email, password });
  }

  rowsOf(kind: string): Row[] {
    return [...this.rows.values()].filter((r) => r.kind === kind);
  }

  kinds(): Set<string> {
    return new Set([...this.rows.values()].map((r) => r.kind));
  }

  pairingRows(): PairingDb[] {
    return [...this.pairings.values()];
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
    return new Date(Date.now() + this.seq).toISOString().replace('Z', '+00:00');
  }

  private userRows(uid: string): Row[] {
    return [...this.rows.values()].filter((r) => r.user_id === uid);
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
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

    const token = headerOf(init, 'Authorization')?.replace('Bearer ', '') ?? '';
    const uid = this.accessTokens.get(token);

    if (url.pathname === '/rest/v1/items') {
      if (!uid) return json({ message: 'JWT expired', code: 'PGRST303' }, 401);
      if (method === 'POST') return this.upsert(uid, body, headerOf(init, 'Prefer') ?? '');
      if (method === 'GET') return this.select(uid, url);
      if (method === 'PATCH') return this.patch(uid, url, body);
      if (method === 'DELETE') return this.remove(uid, url);
    }

    if (url.pathname === '/rest/v1/pairings') {
      if (!uid) return json({ message: 'JWT expired', code: 'PGRST303' }, 401);
      if (this.pairingsDown) return json({ message: 'pairings unavailable' }, 500);
      if (method === 'POST') return this.insertPairing(uid, body);
      if (method === 'GET') return this.selectPairings(uid, url);
      if (method === 'PATCH') return this.patchPairings(uid, url, body);
      if (method === 'DELETE') return this.removePairings(uid, url);
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

  /** POST /pairings con Prefer return=representation: devuelve la fila con id y caducidad a 10 min. */
  private insertPairing(uid: string, body: { pk_b: string; commit_b: string }): Response {
    const t = Date.now();
    const row: PairingDb = {
      id: crypto.randomUUID(),
      user_id: uid,
      pk_b: body.pk_b,
      commit_b: body.commit_b,
      n_b: null,
      pk_a: null,
      n_a: null,
      wrapped_dk: null,
      created_at: new Date(t).toISOString(),
      expires_at: new Date(t + PAIRING_TTL_MS).toISOString(),
    };
    this.pairings.set(row.id, row);
    return json([stripUser(row)], 201);
  }

  /** GET /pairings: filas del usuario, más recientes primero (created_at.desc). */
  private selectPairings(uid: string, url: URL): Response {
    const mine = [...this.pairings.values()].filter((r) => r.user_id === uid && pairingMatches(r, url));
    return json(mine.reverse().map(stripUser));
  }

  private patchPairings(uid: string, url: URL, body: Partial<PairingRow>): Response {
    for (const r of this.pairings.values()) {
      if (r.user_id === uid && pairingMatches(r, url)) Object.assign(r, body);
    }
    return new Response(null, { status: 204 });
  }

  private removePairings(uid: string, url: URL): Response {
    for (const r of [...this.pairings.values()]) {
      if (r.user_id === uid && pairingMatches(r, url)) this.pairings.delete(r.id);
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

interface Device {
  repo: Repo;
  sync: ReturnType<typeof createSync>;
  storage: ReturnType<typeof memStorage>;
}

/** Dispositivo con su propia base IndexedDB. El reloj es el real: el servidor falso también usa Date.now(). */
function device(server: FakeServer): Device {
  const repo = createRepo(`link-test-${crypto.randomUUID()}`);
  const storage = memStorage();
  const sync = createSync(repo, CFG, {
    fetch: server.fetch as unknown as typeof fetch,
    storage,
    now: () => Date.now(),
  });
  return { repo, sync, storage };
}

function line(title: string): ParsedLine {
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
  };
}

async function addTask(repo: Repo, title: string) {
  const [t] = await repo.addParsed([line(title)]);
  return t;
}

async function titles(repo: Repo): Promise<string[]> {
  return (await repo.listTasks()).map((t) => t.title);
}

/**
 * Dispositivo A activado (con una tarea) y dispositivo B de la misma cuenta, bloqueado.
 */
async function encryptedPair() {
  const server = new FakeServer();
  server.addUser('ana@test.io', 'secreto');
  const a = device(server);
  await a.sync.signIn('ana@test.io', 'secreto');
  await addTask(a.repo, 'Tarea de A');
  await a.sync.enableEncryption();
  const b = device(server);
  await b.sync.signIn('ana@test.io', 'secreto');
  expect(b.sync.encryption()).toBe('locked');
  return { server, a, b };
}

// ---------- tiempo ----------

/** Deja correr las peticiones falsas (setTimeout real; solo se falsean setInterval/clearInterval). */
async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

/** Avanza un ciclo de sondeo del enlace (2 s) y deja terminar lo que dispare. */
async function pollOnce(): Promise<void> {
  await vi.advanceTimersByTimeAsync(LINK_POLL_MS);
  await settle();
}

/** Sondea hasta que se cumpla la condición (máximo 20 ciclos). */
async function pollUntil(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 20 && !cond(); i++) await pollOnce();
}

describe('enlace de dispositivos', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('1. enlace completo: B pide, A responde, ambos ven el mismo código, A confirma y B queda desbloqueado', async () => {
    const { server, a, b } = await encryptedPair();

    await b.sync.startLink();
    expect(b.sync.link()).toEqual({ role: 'new', status: 'waiting' });
    expect(server.pairingRows()).toHaveLength(1);

    await a.sync.syncNow();
    expect(a.sync.link()).toEqual({ role: 'active', status: 'waiting' });

    await pollOnce(); // B revela nB
    await pollOnce(); // A lo ve y calcula el código
    expect(b.sync.link()).toMatchObject({ role: 'new', status: 'code', code: expect.stringMatching(/^\d{3} \d{3}$/) });
    expect(a.sync.link()).toMatchObject({ role: 'active', status: 'code' });
    expect((a.sync.link() as { code: string }).code).toBe((b.sync.link() as { code: string }).code);

    await a.sync.confirmLink();
    expect(a.sync.link()).toBeNull();

    await pollUntil(() => b.sync.encryption() === 'on');
    expect(b.sync.encryption()).toBe('on');
    expect(b.sync.getState().status).toBe('idle');
    expect(b.sync.link()).toBeNull();
    expect(await titles(b.repo)).toEqual(['Tarea de A']);
    expect(server.pairingRows()).toHaveLength(0);
  });

  it('2. B cancela durante la espera: la petición se borra y A no la ve', async () => {
    const { server, a, b } = await encryptedPair();

    await b.sync.startLink();
    await b.sync.cancelLink();

    expect(b.sync.link()).toBeNull();
    expect(server.pairingRows()).toHaveLength(0);
    await a.sync.syncNow();
    expect(a.sync.link()).toBeNull();
  });

  it('2b. B cancela después de que A respondió: A pasa a null en el siguiente sondeo', async () => {
    const { server, a, b } = await encryptedPair();

    await b.sync.startLink();
    await a.sync.syncNow();
    expect(a.sync.link()).toEqual({ role: 'active', status: 'waiting' });

    await b.sync.cancelLink();
    await pollOnce();

    expect(a.sync.link()).toBeNull();
    expect(b.sync.link()).toBeNull();
    expect(server.pairingRows()).toHaveLength(0);
  });

  it('3. A cancela con el código mostrado: B termina en error gone', async () => {
    const { server, a, b } = await encryptedPair();

    await b.sync.startLink();
    await a.sync.syncNow();
    await pollOnce();
    await pollOnce();
    expect(b.sync.link()).toMatchObject({ role: 'new', status: 'code' });
    expect(a.sync.link()).toMatchObject({ role: 'active', status: 'code' });

    await a.sync.cancelLink();
    expect(a.sync.link()).toBeNull();
    expect(server.pairingRows()).toHaveLength(0);

    await pollOnce();
    expect(b.sync.link()).toEqual({ role: 'new', status: 'error', message: REJECTED_MSG });
    expect(b.sync.encryption()).toBe('locked');
  });

  it('4. startLink en un dispositivo no bloqueado lanza Error', async () => {
    const { server, a } = await encryptedPair();

    await expect(a.sync.startLink()).rejects.toThrow(Error);
    await expect(a.sync.startLink()).rejects.toThrow('Solo un dispositivo bloqueado');
    expect(server.pairingRows()).toHaveLength(0);
    expect(a.sync.link()).toBeNull();
  });

  it('5. confirmLink sin código lanza Error', async () => {
    const { a, b } = await encryptedPair();

    await expect(b.sync.confirmLink()).rejects.toThrow(Error);

    await b.sync.startLink(); // esperando, todavía sin código
    await expect(b.sync.confirmLink()).rejects.toThrow(Error);

    await a.sync.syncNow(); // A responde, pero B aún no ha revelado nB
    await expect(a.sync.confirmLink()).rejects.toThrow('No hay ningún código que confirmar');
  });

  it('6. un fallo del servidor en pairings durante el sync de A no hace fallar el sync', async () => {
    const { server, a } = await encryptedPair();
    server.pairingsDown = true;
    await addTask(a.repo, 'Otra de A');

    await a.sync.syncNow();

    expect(a.sync.getState().status).toBe('idle');
    expect(a.sync.link()).toBeNull(); // comprobación en segundo plano: no se muestra un error que nadie pidió
    // la sincronización de datos sí ha ocurrido
    expect(server.dump()).not.toContain('Otra de A');
    expect(await titles(a.repo)).toContain('Otra de A');
  });

  it('7. una petición caducada se ignora: A no responde y B la da por gone', async () => {
    const { server, a, b } = await encryptedPair();

    await b.sync.startLink();
    const [row] = server.pairingRows();
    row.expires_at = new Date(Date.now() - 1_000).toISOString();

    await a.sync.syncNow();
    expect(a.sync.link()).toBeNull();
    expect(row.pk_a).toBeNull();

    await pollOnce();
    expect(b.sync.link()).toEqual({ role: 'new', status: 'error', message: EXPIRED_MSG });
  });

  it('8. con stop() no quedan intervalos activos', async () => {
    const { a, b } = await encryptedPair();
    a.sync.start();
    b.sync.start();
    await b.sync.startLink();
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    a.sync.stop();
    b.sync.stop();

    expect(vi.getTimerCount()).toBe(0);
    expect(b.sync.link()).toBeNull();
  });

  it('9. A detecta una petición nueva con su intervalo de 5 s, sin sincronizar', async () => {
    const { a, b } = await encryptedPair();
    a.sync.start();
    await settle();

    await b.sync.startLink();
    await vi.advanceTimersByTimeAsync(LINK_CHECK_MS);
    await settle();

    expect(a.sync.link()).toEqual({ role: 'active', status: 'waiting' });
    a.sync.stop();
    b.sync.stop();
  });

  it('10. cancelLink no lanza si la fila ya no existe', async () => {
    const { server, b } = await encryptedPair();
    await b.sync.startLink();
    server.pairings.clear();

    await expect(b.sync.cancelLink()).resolves.toBeUndefined();
    expect(b.sync.link()).toBeNull();
  });
});
