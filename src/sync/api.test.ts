import { describe, it, expect, vi, afterEach } from 'vitest';
import type { EncRow, KeyRowData, PairingRow, RemoteItem } from '../types';
import type { Session, SyncConfig } from './auth';
import {
  HttpError,
  createPairing,
  deleteAllEnc,
  deleteExpiredPairings,
  deleteItems,
  deleteKeyRow,
  deletePairing,
  fetchKeyRow,
  getPairing,
  listPendingPairings,
  pushItems,
  putKeyRow,
  updateKeyRow,
  updatePairing,
} from './api';

const CFG: SyncConfig = { url: 'https://test.supabase.co', anonKey: 'anon-key' };
const SESSION: Session = {
  accessToken: 'tok-123',
  refreshToken: 'rt',
  expiresAt: Date.parse('2026-10-29T12:00:00Z'),
  userId: 'user-42',
  email: 'ana@example.com',
};
const NOW_ISO = '2026-10-29T12:00:00.000Z';

const KEY_DATA: KeyRowData = { v: 1, keyId: 'abc123', recovery: null };
const OTHER_KEY_DATA: KeyRowData = { v: 1, keyId: 'zzz999', recovery: { iv: 'iv', wrapped: 'w' } };

// ---------- fetch falso que registra cada petición ----------

interface Call {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: any;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function empty(status = 204): Response {
  return new Response(null, { status });
}

function fakeFetch(respond: (c: Call) => Response | Promise<Response> = () => empty()) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const call: Call = {
      url,
      method: (init?.method ?? 'GET').toUpperCase(),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    };
    calls.push(call);
    return respond(call);
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

function expectAuth(c: Call): void {
  expect(c.headers.apikey).toBe(CFG.anonKey);
  expect(c.headers.Authorization).toBe(`Bearer ${SESSION.accessToken}`);
}

/** Servidor minimo para la fila marcador: un POST guarda solo si no hay fila (ignore-duplicates). */
function keyServer(initial?: KeyRowData) {
  let stored: KeyRowData | undefined = initial;
  return fakeFetch((c) => {
    if (c.method === 'POST') {
      if (!stored) stored = c.body[0].data;
      return empty(201);
    }
    if (c.method === 'GET') return json(stored ? [{ data: stored }] : []);
    return empty(204);
  });
}

afterEach(() => {
  vi.useRealTimers();
});

// ---------- pushItems (tipo ampliado) ----------

describe('pushItems con filas cifradas', () => {
  it('sube filas enc junto con registros en claro', async () => {
    const enc: EncRow = { kind: 'enc', id: 'h1', data: { v: 1, iv: 'iv', ct: 'ct' }, updated_at: 5, deleted: false };
    const plain: RemoteItem = { kind: 'setting', id: 'appearance', data: {} as any, updated_at: 6, deleted: false };
    const f = fakeFetch();

    await pushItems(CFG, SESSION, [enc, plain], f.fetch);

    expect(f.calls).toHaveLength(1);
    const c = f.calls[0];
    expect(c.method).toBe('POST');
    expect(c.url.pathname).toBe('/rest/v1/items');
    expect(c.url.searchParams.get('on_conflict')).toBe('user_id,kind,id');
    expect(c.headers.Prefer).toBe('resolution=merge-duplicates,return=minimal');
    expectAuth(c);
    expect(c.body).toEqual([
      { user_id: SESSION.userId, kind: 'enc', id: 'h1', data: enc.data, updated_at: 5, deleted: false },
      { user_id: SESSION.userId, kind: 'setting', id: 'appearance', data: {}, updated_at: 6, deleted: false },
    ]);
  });
});

// ---------- fila marcador ----------

describe('fetchKeyRow', () => {
  it('devuelve null si no hay filas', async () => {
    const f = fakeFetch(() => json([]));

    expect(await fetchKeyRow(CFG, SESSION, f.fetch)).toBeNull();

    const c = f.calls[0];
    expect(c.method).toBe('GET');
    expect(c.url.pathname).toBe('/rest/v1/items');
    expect(c.url.searchParams.get('select')).toBe('data');
    expect(c.url.searchParams.get('kind')).toBe('eq.key');
    expect(c.url.searchParams.get('id')).toBe('eq.dk');
    expectAuth(c);
  });

  it('devuelve la data de la fila', async () => {
    const f = fakeFetch(() => json([{ data: KEY_DATA }]));

    expect(await fetchKeyRow(CFG, SESSION, f.fetch)).toEqual(KEY_DATA);
  });

  it('lanza HttpError con el status si el servidor responde 400', async () => {
    const f = fakeFetch(() => json({ message: 'column "data" does not exist' }, 400));

    const err = await fetchKeyRow(CFG, SESSION, f.fetch).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(400);
    expect(err.message).toBe('column "data" does not exist');
  });
});

describe('putKeyRow', () => {
  it('inserta la fila marcador con ignore-duplicates y la devuelve', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse(NOW_ISO));
    const f = keyServer();

    const stored = await putKeyRow(CFG, SESSION, KEY_DATA, f.fetch);

    expect(stored).toEqual(KEY_DATA);
    const post = f.calls[0];
    expect(post.method).toBe('POST');
    expect(post.url.pathname).toBe('/rest/v1/items');
    expect(post.url.searchParams.get('on_conflict')).toBe('user_id,kind,id');
    expect(post.headers.Prefer).toBe('resolution=ignore-duplicates,return=minimal');
    expectAuth(post);
    expect(post.body).toEqual([
      {
        user_id: SESSION.userId,
        kind: 'key',
        id: 'dk',
        data: KEY_DATA,
        updated_at: Date.parse(NOW_ISO),
        deleted: false,
      },
    ]);
    // Tras el insert se relee la fila del servidor.
    expect(f.calls[1].method).toBe('GET');
  });

  it('devuelve la fila existente del servidor si ya había otra (de otro dispositivo)', async () => {
    const f = keyServer(OTHER_KEY_DATA);

    const stored = await putKeyRow(CFG, SESSION, KEY_DATA, f.fetch);

    expect(stored).toEqual(OTHER_KEY_DATA);
  });

  it('lanza Error si tras el insert no hay fila', async () => {
    const f = fakeFetch((c) => (c.method === 'POST' ? empty(201) : json([])));

    await expect(putKeyRow(CFG, SESSION, KEY_DATA, f.fetch)).rejects.toThrow(Error);
  });

  it('lanza HttpError si el insert falla', async () => {
    const f = fakeFetch(() => json({ message: 'new row violates row-level security policy' }, 403));

    const err = await putKeyRow(CFG, SESSION, KEY_DATA, f.fetch).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(403);
  });
});

describe('updateKeyRow', () => {
  it('hace PATCH de la fila marcador con la nueva data y updated_at', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse(NOW_ISO));
    const f = fakeFetch();

    await updateKeyRow(CFG, SESSION, KEY_DATA, f.fetch);

    const c = f.calls[0];
    expect(c.method).toBe('PATCH');
    expect(c.url.pathname).toBe('/rest/v1/items');
    expect(c.url.searchParams.get('kind')).toBe('eq.key');
    expect(c.url.searchParams.get('id')).toBe('eq.dk');
    expectAuth(c);
    expect(c.body).toEqual({ data: KEY_DATA, updated_at: Date.parse(NOW_ISO) });
  });

  it('lanza HttpError si falla', async () => {
    const f = fakeFetch(() => json({ message: 'boom' }, 500));

    const err = await updateKeyRow(CFG, SESSION, KEY_DATA, f.fetch).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(500);
  });
});

describe('deleteKeyRow', () => {
  it('hace DELETE de la fila marcador', async () => {
    const f = fakeFetch();

    await deleteKeyRow(CFG, SESSION, f.fetch);

    const c = f.calls[0];
    expect(c.method).toBe('DELETE');
    expect(c.url.pathname).toBe('/rest/v1/items');
    expect(c.url.searchParams.get('kind')).toBe('eq.key');
    expect(c.url.searchParams.get('id')).toBe('eq.dk');
    expect(c.headers.Prefer).toBe('return=minimal');
    expectAuth(c);
  });
});

// ---------- borrados ----------

describe('deleteItems', () => {
  it('no hace ninguna petición con ids vacío', async () => {
    const f = fakeFetch();

    await deleteItems(CFG, SESSION, 'topic', [], f.fetch);

    expect(f.calls).toHaveLength(0);
  });

  it('codifica ids con espacios, comas y comillas dentro de in.(...)', async () => {
    const f = fakeFetch();

    await deleteItems(CFG, SESSION, 'topic', ['tema con espacio', 'a,b', 'c"d'], f.fetch);

    expect(f.calls).toHaveLength(1);
    const c = f.calls[0];
    expect(c.method).toBe('DELETE');
    expect(c.url.pathname).toBe('/rest/v1/items');
    expect(c.url.searchParams.get('kind')).toBe('eq.topic');
    // Tras decodificar la URL, cada id va entre comillas dobles y las comillas internas se escapan.
    expect(c.url.searchParams.get('id')).toBe('in.("tema con espacio","a,b","c\\"d")');
    expect(c.headers.Prefer).toBe('return=minimal');
    expectAuth(c);
  });

  it('hace lotes de 100 ids: 250 ids son 3 peticiones (100, 100, 50)', async () => {
    const f = fakeFetch();
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);

    await deleteItems(CFG, SESSION, 'person', ids, f.fetch);

    expect(f.calls).toHaveLength(3);
    const counts = f.calls.map((c) => (c.url.searchParams.get('id') ?? '').split(',').length);
    expect(counts).toEqual([100, 100, 50]);
    expect(f.calls[0].url.searchParams.get('id')).toBe(
      `in.(${ids.slice(0, 100).map((id) => `"${id}"`).join(',')})`,
    );
    expect(f.calls[2].url.searchParams.get('id')).toBe(
      `in.(${ids.slice(200).map((id) => `"${id}"`).join(',')})`,
    );
  });

  it('lanza HttpError con el status si falla un lote', async () => {
    const f = fakeFetch(() => json({ message: 'bad request' }, 400));

    const err = await deleteItems(CFG, SESSION, 'topic', ['x'], f.fetch).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(400);
    expect(err.message).toBe('bad request');
  });
});

describe('deleteAllEnc', () => {
  it('borra las filas enc del usuario actual', async () => {
    const f = fakeFetch();

    await deleteAllEnc(CFG, SESSION, f.fetch);

    const c = f.calls[0];
    expect(c.method).toBe('DELETE');
    expect(c.url.pathname).toBe('/rest/v1/items');
    expect(c.url.searchParams.get('kind')).toBe('eq.enc');
    expect(c.url.searchParams.get('user_id')).toBe(`eq.${SESSION.userId}`);
    expectAuth(c);
  });
});

// ---------- pairings ----------

const PAIRING: PairingRow = {
  id: 'p-1',
  pk_b: 'pkb',
  commit_b: 'cb',
  n_b: null,
  pk_a: null,
  n_a: null,
  wrapped_dk: null,
  created_at: NOW_ISO,
  expires_at: '2026-10-29T12:10:00.000Z',
};

describe('pairings', () => {
  it('createPairing hace POST con return=representation y devuelve la fila', async () => {
    const f = fakeFetch(() => json([PAIRING], 201));

    const row = await createPairing(CFG, SESSION, { pk_b: 'pkb', commit_b: 'cb' }, f.fetch);

    expect(row).toEqual(PAIRING);
    const c = f.calls[0];
    expect(c.method).toBe('POST');
    expect(c.url.pathname).toBe('/rest/v1/pairings');
    expect(c.headers.Prefer).toBe('return=representation');
    expect(c.body).toEqual({ pk_b: 'pkb', commit_b: 'cb' });
    expectAuth(c);
  });

  it('createPairing lanza Error si no devuelve fila', async () => {
    const f = fakeFetch(() => json([], 201));

    await expect(createPairing(CFG, SESSION, { pk_b: 'a', commit_b: 'b' }, f.fetch)).rejects.toThrow(Error);
  });

  it('getPairing filtra por id y devuelve null si no existe', async () => {
    const f = fakeFetch((c) => json(c.url.searchParams.get('id') === 'eq.p-1' ? [PAIRING] : []));

    expect(await getPairing(CFG, SESSION, 'p-1', f.fetch)).toEqual(PAIRING);
    expect(await getPairing(CFG, SESSION, 'nope', f.fetch)).toBeNull();

    const c = f.calls[0];
    expect(c.method).toBe('GET');
    expect(c.url.pathname).toBe('/rest/v1/pairings');
    expect(c.url.searchParams.get('select')).toBe('*');
    expectAuth(c);
  });

  it('updatePairing hace PATCH por id con el patch', async () => {
    const f = fakeFetch();

    await updatePairing(CFG, SESSION, 'p-1', { pk_a: 'pka', n_a: 'na' }, f.fetch);

    const c = f.calls[0];
    expect(c.method).toBe('PATCH');
    expect(c.url.pathname).toBe('/rest/v1/pairings');
    expect(c.url.searchParams.get('id')).toBe('eq.p-1');
    expect(c.body).toEqual({ pk_a: 'pka', n_a: 'na' });
    expectAuth(c);
  });

  it('deletePairing hace DELETE por id', async () => {
    const f = fakeFetch();

    await deletePairing(CFG, SESSION, 'p-1', f.fetch);

    const c = f.calls[0];
    expect(c.method).toBe('DELETE');
    expect(c.url.pathname).toBe('/rest/v1/pairings');
    expect(c.url.searchParams.get('id')).toBe('eq.p-1');
    expectAuth(c);
  });

  it('listPendingPairings pide las no caducadas, más recientes primero', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse(NOW_ISO));
    const f = fakeFetch(() => json([PAIRING]));

    expect(await listPendingPairings(CFG, SESSION, f.fetch)).toEqual([PAIRING]);

    const c = f.calls[0];
    expect(c.method).toBe('GET');
    expect(c.url.pathname).toBe('/rest/v1/pairings');
    expect(c.url.searchParams.get('expires_at')).toBe(`gt.${NOW_ISO}`);
    expect(c.url.searchParams.get('order')).toBe('created_at.desc');
    expectAuth(c);
  });

  it('deleteExpiredPairings borra las caducadas', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse(NOW_ISO));
    const f = fakeFetch();

    await deleteExpiredPairings(CFG, SESSION, f.fetch);

    const c = f.calls[0];
    expect(c.method).toBe('DELETE');
    expect(c.url.pathname).toBe('/rest/v1/pairings');
    expect(c.url.searchParams.get('expires_at')).toBe(`lt.${NOW_ISO}`);
    expectAuth(c);
  });

  it('las funciones de pairings lanzan HttpError con el status', async () => {
    const f = fakeFetch(() => json({ message: 'JWT expired' }, 401));

    const errors = await Promise.all([
      createPairing(CFG, SESSION, { pk_b: 'a', commit_b: 'b' }, f.fetch).catch((e) => e),
      getPairing(CFG, SESSION, 'p-1', f.fetch).catch((e) => e),
      updatePairing(CFG, SESSION, 'p-1', {}, f.fetch).catch((e) => e),
      deletePairing(CFG, SESSION, 'p-1', f.fetch).catch((e) => e),
      listPendingPairings(CFG, SESSION, f.fetch).catch((e) => e),
      deleteExpiredPairings(CFG, SESSION, f.fetch).catch((e) => e),
    ]);

    for (const err of errors) {
      expect(err).toBeInstanceOf(HttpError);
      expect(err.status).toBe(401);
    }
  });
});
