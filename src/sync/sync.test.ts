import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRepo } from '../data/repo';
import type { RemoteItem, Repo, SyncState } from '../types';
import { createSync, pollInterval } from './index';

const CFG = { url: 'https://test.supabase.co', anonKey: 'anon-key' };
const BASE_TS = Date.parse('2026-10-27T10:00:00Z');

// ---------- servidor falso (GoTrue + PostgREST minimos) ----------

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

class FakeServer {
  users = new Map<string, { id: string; email: string; password: string }>();
  accessTokens = new Map<string, string>(); // token -> userId
  refreshTokens = new Map<string, { userId: string; email: string }>();
  rows = new Map<string, Row>();
  expiresIn = 3600;
  offline = false;
  failWritesWith: number | null = null; // fuerza un error HTTP en los upserts
  refreshCalls = 0;
  private tokenSeq = 0;
  private seq = 0;

  addUser(email: string, password: string): void {
    this.users.set(email, { id: `user-${this.users.size + 1}`, email, password });
  }

  revokeAccess(): void {
    this.accessTokens.clear();
  }

  private issue(userId: string, email: string) {
    const access = `at-${++this.tokenSeq}`;
    const refresh = `rt-${this.tokenSeq}`;
    this.accessTokens.set(access, userId);
    this.refreshTokens.set(refresh, { userId, email });
    return {
      access_token: access,
      refresh_token: refresh,
      expires_in: this.expiresIn,
      token_type: 'bearer',
      user: { id: userId, email },
    };
  }

  private nextSynced(): string {
    this.seq++;
    return new Date(BASE_TS + this.seq * 1000).toISOString().replace('Z', '+00:00');
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
      this.refreshCalls++;
      const stored = this.refreshTokens.get(body.refresh_token);
      if (!stored) return json({ error_description: 'Invalid Refresh Token: Refresh Token Not Found' }, 400);
      this.refreshTokens.delete(body.refresh_token); // rotación
      return json(this.issue(stored.userId, stored.email));
    }

    if (url.pathname === '/auth/v1/signup') {
      const id = `user-${this.users.size + 1}`;
      this.users.set(body.email, { id, email: body.email, password: body.password });
      return json({ id, email: body.email }); // sin access_token: confirmación pendiente
    }

    if (url.pathname === '/auth/v1/logout') {
      const token = headerOf(init, 'Authorization')?.replace('Bearer ', '') ?? '';
      this.accessTokens.delete(token);
      return new Response(null, { status: 204 });
    }

    if (url.pathname === '/rest/v1/items') {
      const token = headerOf(init, 'Authorization')?.replace('Bearer ', '') ?? '';
      const uid = this.accessTokens.get(token);
      if (!uid) return json({ message: 'JWT expired', code: 'PGRST303' }, 401);
      if (method === 'POST' && this.failWritesWith) return json({ message: 'boom' }, this.failWritesWith);
      return method === 'POST' ? this.upsert(uid, body) : this.select(uid, url);
    }

    return json({ message: 'not found' }, 404);
  };

  private upsert(uid: string, rows: Array<Omit<Row, 'synced_at'>>): Response {
    for (const r of rows) {
      if (r.user_id !== uid) return json({ message: 'new row violates row-level security policy' }, 403);
      const key = `${uid}|${r.kind}|${r.id}`;
      const cur = this.rows.get(key);
      if (cur && r.updated_at < cur.updated_at) continue; // trigger items_lww: se descarta
      this.rows.set(key, { ...r, user_id: uid, synced_at: this.nextSynced() });
    }
    return new Response(null, { status: 201 });
  }

  private select(uid: string, url: URL): Response {
    let list = [...this.rows.values()].filter((r) => r.user_id === uid);
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
        updated_at: String(updated_at), // PostgREST puede devolver bigint como string
        deleted,
        synced_at,
      })),
    );
  }
}

// ---------- repo falso ----------

function makeRepo() {
  const items = new Map<string, { item: RemoteItem; dirty: boolean }>();
  const meta = new Map<string, unknown>();
  const listeners = new Set<() => void>();
  const notify = () => [...listeners].forEach((cb) => cb());
  const key = (it: { kind: string; id: string }) => `${it.kind}|${it.id}`;

  const pendingChanges = vi.fn(async () =>
    [...items.values()].filter((v) => v.dirty).map((v) => v.item),
  );

  const repo = {
    pendingChanges,
    markPushed: async (list: RemoteItem[]) => {
      for (const it of list) {
        const cur = items.get(key(it));
        if (cur && cur.item.updated_at === it.updated_at) cur.dirty = false;
      }
    },
    applyRemote: async (list: RemoteItem[]) => {
      for (const it of list) {
        const cur = items.get(key(it));
        if (!cur || it.updated_at > cur.item.updated_at) items.set(key(it), { item: it, dirty: false });
      }
      notify();
    },
    getMeta: async (k: string) => meta.get(k),
    setMeta: async (k: string, v: unknown) => {
      meta.set(k, v);
    },
    subscribe: (cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };

  /** Escritura local: pone el registro como pendiente (dirty). */
  const write = (kind: 'task' | 'topic' | 'person' | 'filter', id: string, title: string, updatedAt: number) => {
    items.set(`${kind}|${id}`, {
      item: { kind, id, data: { id, title } as unknown as RemoteItem['data'], updated_at: updatedAt, deleted: false },
      dirty: true,
    });
    notify();
  };

  const title = (kind: string, id: string): string | undefined =>
    (items.get(`${kind}|${id}`)?.item.data as unknown as { title: string } | undefined)?.title;

  return { repo: repo as unknown as Repo, fake: repo, pendingChanges, meta, items, write, title, count: () => items.size };
}

function memStorage() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

function makeClock(start = BASE_TS) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

function device(server: FakeServer, clock: ReturnType<typeof makeClock>) {
  const r = makeRepo();
  const storage = memStorage();
  const sync = createSync(r.repo, CFG, {
    fetch: server.fetch as unknown as typeof fetch,
    storage,
    now: clock.now,
    unencrypted: true, // estos tests miran el transporte con filas legibles; el cifrado, en encryption.test.ts
  });
  return { ...r, sync, storage };
}

function sessionFromStorage(storage: ReturnType<typeof memStorage>) {
  const raw = storage.getItem('lista.session');
  return raw ? (JSON.parse(raw) as { accessToken: string; refreshToken: string; expiresAt: number }) : null;
}

// Margen holgado: cada sync encadena varias promesas (fila key, pendientes, push, pull) antes de terminar.
async function flushMicrotasks(n = 100) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

// ---------- tests ----------

describe('sync: sin configuración', () => {
  it('cfg null => disabled, métodos no-op, signIn rechaza', async () => {
    const r = makeRepo();
    const sync = createSync(r.repo, null, { storage: memStorage() });
    expect(sync.getState()).toEqual({ status: 'disabled' });
    await expect(sync.syncNow()).resolves.toBeUndefined();
    sync.start();
    sync.stop();
    await expect(sync.signIn('a@b.c', 'x')).rejects.toThrow();
    expect(sync.getState()).toEqual({ status: 'disabled' });
    expect(r.pendingChanges).not.toHaveBeenCalled();
  });

  describe('sync: color secundario entre repositorios reales', () => {
    const writeColor = (repo: Repo, color: string, initialize = false) => repo.setSetting(
      'appearance', { theme: 'system', look: 'classic', subtaskColor: color }, initialize ? 'initialize' : undefined,
    );
    const readColor = async (repo: Repo) => {
      const setting = await repo.getSetting<{ subtaskColor: string }>('appearance');
      if (!setting) return undefined;
      return { value: setting.value.subtaskColor, updatedAt: setting.updatedAt,
        dirty: (await repo.pendingChanges()).some((item) => item.kind === 'setting' && item.id === 'appearance') ? 1 : 0 };
    };
    function persistentDevice(server: FakeServer) {
      const repo = createRepo('color-sync-' + crypto.randomUUID());
      const storage = memStorage();
      const sync = createSync(repo, CFG, { fetch: server.fetch, storage, unencrypted: true });
      return { repo, sync, storage };
    }

    it('sincroniza ambos sentidos y recupera la elección tras recargar', async () => {
      const server = new FakeServer();
      server.addUser('ana@test.io', 'secreto');
      const mobile = persistentDevice(server);
      const web = persistentDevice(server);
      await mobile.sync.signIn('ana@test.io', 'secreto');
      await web.sync.signIn('ana@test.io', 'secreto');
      await writeColor(mobile.repo, '#3689cc');
      await mobile.sync.syncNow();
      await web.sync.syncNow();
      expect(await readColor(web.repo)).toMatchObject({ value: '#3689cc', dirty: 0 });
      await writeColor(web.repo, '#7849ce');
      await web.sync.syncNow();
      await mobile.sync.syncNow();
      expect(await readColor(mobile.repo)).toMatchObject({ value: '#7849ce', dirty: 0 });
      const reloaded = persistentDevice(server);
      await reloaded.sync.signIn('ana@test.io', 'secreto');
      expect(await readColor(reloaded.repo)).toMatchObject({ value: '#7849ce', dirty: 0 });
      expect(await mobile.repo.listTasks()).toEqual([]);
      expect(await web.repo.listFilters()).toEqual([]);
    });

    it('reintenta sin conexión y conserva la selección más reciente frente a un envío antiguo', async () => {
      const server = new FakeServer();
      server.addUser('ana@test.io', 'secreto');
      const mobile = persistentDevice(server);
      const web = persistentDevice(server);
      await mobile.sync.signIn('ana@test.io', 'secreto');
      await web.sync.signIn('ana@test.io', 'secreto');
      server.offline = true;
      await writeColor(mobile.repo, '#3689cc');
      await mobile.sync.syncNow();
      expect(mobile.sync.getState().status).toBe('offline');
      expect(await readColor(mobile.repo)).toMatchObject({ dirty: 1 });
      await writeColor(web.repo, '#58a676');
      server.offline = false;
      await web.sync.syncNow();
      await mobile.sync.syncNow();
      expect(await readColor(mobile.repo)).toMatchObject({ value: '#58a676', dirty: 0 });
      await web.sync.syncNow();
      expect(await readColor(web.repo)).toMatchObject({ value: '#58a676', dirty: 0 });
    });

    it('la migración local antigua no sobrescribe la preferencia ya sincronizada', async () => {
      const server = new FakeServer();
      server.addUser('ana@test.io', 'secreto');
      const web = persistentDevice(server);
      await web.sync.signIn('ana@test.io', 'secreto');
      await writeColor(web.repo, '#e68b45');
      await web.sync.syncNow();
      const mobile = persistentDevice(server);
      await writeColor(mobile.repo, '#db729f', true);
      await mobile.sync.signIn('ana@test.io', 'secreto');
      expect(await readColor(mobile.repo)).toMatchObject({ value: '#e68b45', dirty: 0 });
    });

    it('las preferencias quedan aisladas por cuenta igual que las tareas', async () => {
      const server = new FakeServer();
      server.addUser('ana@test.io', 'secreto');
      server.addUser('bea@test.io', 'secreto');
      const a = persistentDevice(server);
      const b = persistentDevice(server);
      await a.sync.signIn('ana@test.io', 'secreto');
      await writeColor(a.repo, '#7849ce');
      await a.sync.syncNow();
      await b.sync.signIn('bea@test.io', 'secreto');
      expect(await readColor(b.repo)).toBeUndefined();
      await writeColor(b.repo, '#58a676');
      await b.sync.syncNow();
      await a.sync.syncNow();
      expect(await readColor(a.repo)).toMatchObject({ value: '#7849ce' });
    });

    it('converge cuando dos dispositivos migran colores antiguos distintos con versión cero', async () => {
      const server = new FakeServer();
      server.addUser('ana@test.io', 'secreto');
      const a = persistentDevice(server);
      const b = persistentDevice(server);
      await writeColor(a.repo, '#3689cc', true);
      await writeColor(b.repo, '#58a676', true);
      await a.sync.signIn('ana@test.io', 'secreto');
      await b.sync.signIn('ana@test.io', 'secreto');
      await a.sync.syncNow();
      await b.sync.syncNow();
      expect(await readColor(a.repo)).toMatchObject({ value: '#58a676', updatedAt: 0, dirty: 0 });
      expect(await readColor(b.repo)).toMatchObject({ value: '#58a676', updatedAt: 0, dirty: 0 });
    });

    it('una sesión v1 actualizada recupera el color que su cursor ya había saltado', async () => {
      const server = new FakeServer();
      server.addUser('ana@test.io', 'secreto');
      const web = persistentDevice(server);
      await web.sync.signIn('ana@test.io', 'secreto');
      await writeColor(web.repo, '#7849ce');
      await web.sync.syncNow();
      const name = 'color-upgrade-' + crypto.randomUUID();
      const old = new Dexie(name);
      old.version(1).stores({
        tasks: 'id, parentId, dirty, updatedAt', topics: 'key, dirty', people: 'key, dirty',
        filters: 'id, dirty', meta: 'key',
      });
      await old.table('meta').put({ key: 'sync.cursor', value: new Date(BASE_TS + 864e5).toISOString() });
      old.close();
      const repo = createRepo(name);
      await writeColor(repo, '#db729f', true);
      const sync = createSync(repo, CFG, { fetch: server.fetch, storage: web.storage, unencrypted: true });
      await sync.syncNow();
      await sync.syncNow();
      expect(sync.getState().status).toBe('idle');
      expect(await readColor(repo)).toMatchObject({ value: '#7849ce', dirty: 0 });
    });

    it.each(['setting', 'unknown'])('un registro remoto no válido se muestra como error y no avanza el cursor: %s', async (kind) => {
      const server = new FakeServer();
      server.addUser('ana@test.io', 'secreto');
      const device = persistentDevice(server);
      await device.sync.signIn('ana@test.io', 'secreto');
      const cursor = await device.repo.getMeta('sync.cursor');
      const row: Row = {
        user_id: 'user-1', kind, id: 'appearance',
        data: { key: 'wrong', value: {}, updatedAt: 1, deleted: 0 },
        updated_at: 1, deleted: false, synced_at: new Date(BASE_TS + 1000).toISOString(),
      };
      server.rows.set('user-1|setting|appearance', row);
      await device.sync.syncNow();
      expect(device.sync.getState().status).toBe('error');
      expect(await device.repo.getMeta('sync.cursor')).toBe(cursor);
      expect(await readColor(device.repo)).toBeUndefined();
      row.kind = 'setting';
      row.data = { key: 'appearance', value: { theme: 'system', look: 'classic', subtaskColor: '#7849ce' }, updatedAt: 1, deleted: 0 };
      await device.sync.syncNow();
      expect(device.sync.getState().status).toBe('idle');
      expect(await readColor(device.repo)).toMatchObject({ value: '#7849ce', dirty: 0 });
    });
  });
});

describe('sync: sesión', () => {
  it('signIn persiste la sesión y deja el estado en idle', async () => {
    const server = new FakeServer();
    server.addUser('ana@test.io', 'secreto');
    const clock = makeClock();
    const d = device(server, clock);

    await d.sync.signIn('ana@test.io', 'secreto');

    const state = d.sync.getState();
    expect(state.status).toBe('idle');
    expect(state).toMatchObject({ email: 'ana@test.io' });
    const s = sessionFromStorage(d.storage);
    expect(s?.accessToken).toMatch(/^at-/);
    expect(s?.refreshToken).toMatch(/^rt-/);
  });

  it('contraseña incorrecta => mensaje en castellano y estado signedOut', async () => {
    const server = new FakeServer();
    server.addUser('ana@test.io', 'secreto');
    const d = device(server, makeClock());

    await expect(d.sync.signIn('ana@test.io', 'mal')).rejects.toThrow('Email o contraseña incorrectos');
    expect(d.sync.getState()).toEqual({ status: 'signedOut' });
    expect(d.storage.getItem('lista.session')).toBeNull();
  });

  it('signUp sin confirmación inmediata => mensaje para revisar el email', async () => {
    const server = new FakeServer();
    const d = device(server, makeClock());
    await expect(d.sync.signUp('nuevo@test.io', 'secreto')).rejects.toThrow(
      'Revisa tu email para confirmar la cuenta y luego inicia sesión',
    );
    expect(d.sync.getState()).toEqual({ status: 'signedOut' });
  });

  it('signOut conserva los datos locales y reinicia el cursor', async () => {
    const server = new FakeServer();
    server.addUser('ana@test.io', 'secreto');
    const d = device(server, makeClock());
    await d.sync.signIn('ana@test.io', 'secreto');
    d.write('task', 't1', 'Comprar pan', 100);
    await d.sync.syncNow();
    expect(typeof (await d.repo.getMeta('sync.cursor'))).toBe('string');

    await d.sync.signOut();

    expect(d.sync.getState()).toEqual({ status: 'signedOut' });
    expect(d.storage.getItem('lista.session')).toBeNull();
    expect(d.title('task', 't1')).toBe('Comprar pan');
    expect(await d.repo.getMeta('sync.cursor')).toBeNull();
  });
});

describe('sync: push y pull', () => {
  it('syncNow sube lo pendiente y lo marca como subido', async () => {
    const server = new FakeServer();
    server.addUser('ana@test.io', 'secreto');
    const d = device(server, makeClock());
    await d.sync.signIn('ana@test.io', 'secreto');

    d.write('task', 't1', 'Llamar', 100);
    d.write('topic', 'casa', 'casa', 100);
    await d.sync.syncNow();

    expect(server.rows.size).toBe(2);
    const row = [...server.rows.values()].find((r) => r.id === 't1');
    expect(row).toMatchObject({ kind: 'task', updated_at: 100, deleted: false });
    expect(await d.pendingChanges()).toEqual([]);
    expect(d.sync.getState()).toMatchObject({ status: 'idle' });
    expect(typeof (d.sync.getState() as { lastSync: number }).lastSync).toBe('number');
  });

  it('pull trae registros remotos al repo y guarda el cursor', async () => {
    const server = new FakeServer();
    server.addUser('ana@test.io', 'secreto');
    const clock = makeClock();
    const a = device(server, clock);
    const b = device(server, clock);
    await a.sync.signIn('ana@test.io', 'secreto');
    await b.sync.signIn('ana@test.io', 'secreto');

    a.write('person', 'juan', 'Juan', 100);
    await a.sync.syncNow();
    await b.sync.syncNow();

    expect(b.title('person', 'juan')).toBe('Juan');
    expect(b.items.get('person|juan')?.dirty).toBe(false);
    expect(typeof (await b.repo.getMeta('sync.cursor'))).toBe('string');
  });

  it('dos dispositivos convergen y LWW conserva la escritura más reciente', async () => {
    const server = new FakeServer();
    server.addUser('ana@test.io', 'secreto');
    const clock = makeClock();
    const a = device(server, clock);
    const b = device(server, clock);
    await a.sync.signIn('ana@test.io', 'secreto');
    await b.sync.signIn('ana@test.io', 'secreto');

    a.write('task', 't1', 'A-1', 100);
    await a.sync.syncNow();
    await b.sync.syncNow();
    expect(b.title('task', 't1')).toBe('A-1');

    // B edita después (updated_at 200) y sube.
    b.write('task', 't1', 'B-200', 200);
    await b.sync.syncNow();

    // A edita offline con una marca anterior (150): el servidor debe conservar la de B.
    a.write('task', 't1', 'A-150', 150);
    await a.sync.syncNow();

    expect([...server.rows.values()].find((r) => r.id === 't1')?.data).toEqual({ id: 't1', title: 'B-200' });
    expect(a.title('task', 't1')).toBe('B-200');
    expect(b.title('task', 't1')).toBe('B-200');
  });

  it('pagina el pull y trocea el push (más de 500 registros)', async () => {
    const server = new FakeServer();
    server.addUser('ana@test.io', 'secreto');
    const clock = makeClock();
    const a = device(server, clock);
    const b = device(server, clock);
    await a.sync.signIn('ana@test.io', 'secreto');
    await b.sync.signIn('ana@test.io', 'secreto');

    for (let i = 0; i < 620; i++) a.write('task', `t${i}`, `Tarea ${i}`, 100 + i);
    await a.sync.syncNow();
    expect(server.rows.size).toBe(620);
    expect(a.sync.getState().status).toBe('idle');

    await b.sync.syncNow();
    expect(b.count()).toBe(620);
  });
});

describe('sync: tokens', () => {
  it('refresca el token cuando está a punto de caducar', async () => {
    const server = new FakeServer();
    server.addUser('ana@test.io', 'secreto');
    const clock = makeClock();
    const d = device(server, clock);
    await d.sync.signIn('ana@test.io', 'secreto');
    const before = sessionFromStorage(d.storage)!;

    clock.advance(3600_000 - 30_000); // quedan 30 s
    d.write('task', 't1', 'Caduca', 100);
    await d.sync.syncNow();

    expect(server.refreshCalls).toBe(1);
    const after = sessionFromStorage(d.storage)!;
    expect(after.accessToken).not.toBe(before.accessToken);
    expect(after.refreshToken).not.toBe(before.refreshToken);
    expect(server.rows.size).toBe(1);
  });

  it('401 => refresca una vez y reintenta', async () => {
    const server = new FakeServer();
    server.addUser('ana@test.io', 'secreto');
    const d = device(server, makeClock());
    await d.sync.signIn('ana@test.io', 'secreto');

    server.revokeAccess(); // el access token ya no es válido en el servidor
    d.write('task', 't1', 'Reintento', 100);
    await d.sync.syncNow();

    expect(server.refreshCalls).toBe(1);
    expect(d.sync.getState().status).toBe('idle');
    expect(server.rows.size).toBe(1);
  });

  it('refresh rechazado (400) => signedOut y sesión borrada', async () => {
    const server = new FakeServer();
    server.addUser('ana@test.io', 'secreto');
    const d = device(server, makeClock());
    await d.sync.signIn('ana@test.io', 'secreto');

    server.revokeAccess();
    server.refreshTokens.clear();
    d.write('task', 't1', 'Sin sesión', 100);
    await d.sync.syncNow();

    expect(d.sync.getState()).toEqual({ status: 'signedOut' });
    expect(d.storage.getItem('lista.session')).toBeNull();
  });
});

describe('sync: errores de red', () => {
  it('fallo de red => offline', async () => {
    const server = new FakeServer();
    server.addUser('ana@test.io', 'secreto');
    const d = device(server, makeClock());
    await d.sync.signIn('ana@test.io', 'secreto');

    server.offline = true;
    d.write('task', 't1', 'Sin red', 100);
    await d.sync.syncNow();
    expect(d.sync.getState()).toMatchObject({ status: 'offline' });

    server.offline = false;
    await d.sync.syncNow();
    expect(d.sync.getState()).toMatchObject({ status: 'idle' });
    expect(server.rows.size).toBe(1);
  });

  it('error de servidor no relacionado => error con mensaje', async () => {
    const server = new FakeServer();
    server.addUser('ana@test.io', 'secreto');
    const d = device(server, makeClock());
    await d.sync.signIn('ana@test.io', 'secreto');

    server.failWritesWith = 500;
    d.write('task', 't1', 'Error', 100);
    await d.sync.syncNow();
    expect(d.sync.getState()).toMatchObject({ status: 'error', message: 'boom' });
  });
});

describe('sync: concurrencia', () => {
  it('varias llamadas concurrentes ejecutan a lo sumo dos syncs', async () => {
    const server = new FakeServer();
    server.addUser('ana@test.io', 'secreto');
    const d = device(server, makeClock());
    await d.sync.signIn('ana@test.io', 'secreto');
    const base = d.pendingChanges.mock.calls.length;

    await Promise.all([d.sync.syncNow(), d.sync.syncNow(), d.sync.syncNow(), d.sync.syncNow()]);

    expect(d.pendingChanges.mock.calls.length - base).toBe(2);
    expect(d.sync.getState().status).toBe('idle');
  });

  it('debounce de cambios locales y nada tras stop (start/stop)', async () => {
    vi.useFakeTimers();
    const server = new FakeServer();
    server.addUser('ana@test.io', 'secreto');
    const d = device(server, makeClock());
    await d.sync.signIn('ana@test.io', 'secreto');
    let runs = 0;
    d.sync.subscribe((s: SyncState) => { if (s.status === 'syncing') runs++; });
    d.sync.start();
    await flushMicrotasks();
    const base = runs;

    d.write('task', 't1', 'Debounce', 100);
    await vi.advanceTimersByTimeAsync(1000);
    expect(runs).toBe(base); // aún dentro del debounce
    await vi.advanceTimersByTimeAsync(600);
    await flushMicrotasks();
    expect(runs).toBe(base + 1); // una sola vuelta: lo que notifica el propio sync no provoca otra
    expect(server.rows.size).toBe(1);

    d.sync.stop();
    d.write('task', 't2', 'Tras stop', 200);
    await vi.advanceTimersByTimeAsync(5000);
    expect(runs).toBe(base + 1);
  });

  it('una escritura local durante un sync se sube en cuanto termina', async () => {
    const server = new FakeServer();
    server.addUser('ana@test.io', 'secreto');
    const d = device(server, makeClock());
    await d.sync.signIn('ana@test.io', 'secreto');
    d.sync.start();
    d.write('task', 't1', 'Primera', 100);
    const p = d.sync.syncNow();
    d.write('task', 't2', 'Durante el sync', 200); // llega con el sync ya en marcha
    await p;
    await flushMicrotasks();
    expect(server.rows.size).toBe(2);
    d.sync.stop();
  });
});

describe('sync: estado', () => {
  it('subscribe recibe los cambios de estado', async () => {
    const server = new FakeServer();
    server.addUser('ana@test.io', 'secreto');
    const d = device(server, makeClock());
    const seen: string[] = [];
    const unsub = d.sync.subscribe((s: SyncState) => seen.push(s.status));
    await d.sync.signIn('ana@test.io', 'secreto');
    unsub();
    expect(seen).toContain('idle');
    expect(seen).toContain('syncing');
  });
});

describe('refresco periódico', () => {
  it('30 s con actividad reciente, 2 min tras 5 min sin cambios', () => {
    expect(pollInterval(0)).toBe(30_000);
    expect(pollInterval(4 * 60_000)).toBe(30_000);
    expect(pollInterval(5 * 60_000)).toBe(120_000);
    expect(pollInterval(60 * 60_000)).toBe(120_000);
  });
});
