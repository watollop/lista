import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ListInviteInfo, ListMemberInfo, ListMembership } from '../types';
import type { Session, SyncConfig } from './auth';
import type { ListRow } from './listcrypto';
import { HttpError } from './api';
import {
  InviteRejectedError,
  SharingUnavailableError,
  acceptInvite,
  b64urlToHex,
  createInvite,
  createSharedList,
  deleteInvite,
  deleteSharedList,
  fetchListMembers,
  fetchMemberships,
  leaveList,
  listPendingInvites,
  pullListItems,
  pushListItems,
  removeMember,
} from './listapi';

const CFG: SyncConfig = { url: 'https://test.supabase.co', anonKey: 'anon-key' };
const SESSION: Session = {
  accessToken: 'tok-123',
  refreshToken: 'rt',
  expiresAt: Date.parse('2026-10-29T12:00:00Z'),
  userId: 'user-42',
  email: 'ana@example.com',
};
const NOW_ISO = '2026-10-29T12:00:00.000Z';
const LIST_ID = '11111111-1111-4111-8111-111111111111';
const INVITE_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_USER = 'user-7';

// Clave de invitación de 32 bytes (0..31) en base64url sin relleno.
const AUTH_B64 = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const AUTH_HEX = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';

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

function row(i: number, syncedAt: string): Record<string, unknown> {
  return { kind: 'enc', id: `h${i}`, data: { v: 1, iv: 'iv', ct: 'ct' }, updated_at: String(i), deleted: false, synced_at: syncedAt };
}

afterEach(() => {
  vi.useRealTimers();
});

// ---------- b64urlToHex ----------

describe('b64urlToHex', () => {
  it('convierte 32 bytes 0..31 al hex esperado', () => {
    expect(b64urlToHex(AUTH_B64)).toBe(AUTH_HEX);
  });

  it('coincide con Buffer en una clave aleatoria de 32 bytes (ida y vuelta)', () => {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) bytes[i] = (i * 37 + 200) % 256;
    const b64url = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    expect(b64urlToHex(b64url)).toBe(hex);
  });

  it('rechaza caracteres no válidos', () => {
    expect(() => b64urlToHex(AUTH_B64.slice(0, 42) + '+')).toThrow();
    expect(() => b64urlToHex(AUTH_B64.slice(0, 42) + '=')).toThrow();
    expect(() => b64urlToHex('ab cd')).toThrow();
  });

  it('rechaza longitudes que no son de 32 bytes o imposibles', () => {
    expect(() => b64urlToHex('')).toThrow();
    expect(() => b64urlToHex('A')).toThrow();
    expect(() => b64urlToHex(AUTH_B64.slice(0, 40))).toThrow();
    expect(() => b64urlToHex(AUTH_B64 + 'AAAA')).toThrow();
  });
});

// ---------- createSharedList ----------

describe('createSharedList', () => {
  it('llama a rpc/create_list con p_list y devuelve created', async () => {
    const f = fakeFetch(() => json({ created: true }));

    expect(await createSharedList(CFG, SESSION, LIST_ID, f.fetch)).toEqual({ created: true });

    const c = f.calls[0];
    expect(c.method).toBe('POST');
    expect(c.url.pathname).toBe('/rest/v1/rpc/create_list');
    expect(c.body).toEqual({ p_list: LIST_ID });
    expectAuth(c);
  });

  it('devuelve created=false si ya existía', async () => {
    const f = fakeFetch(() => json({ created: false }));

    expect(await createSharedList(CFG, SESSION, LIST_ID, f.fetch)).toEqual({ created: false });
  });

  it('lanza SharingUnavailableError si responde 404', async () => {
    const f = fakeFetch(() => json({ code: 'PGRST202', message: 'Could not find the function' }, 404));

    const err = await createSharedList(CFG, SESSION, LIST_ID, f.fetch).catch((e) => e);
    expect(err).toBeInstanceOf(SharingUnavailableError);
    expect(err.name).toBe('SharingUnavailableError');
  });

  it('lanza HttpError con el mensaje del servidor en otros errores', async () => {
    const f = fakeFetch(() => json({ message: 'boom' }, 500));

    const err = await createSharedList(CFG, SESSION, LIST_ID, f.fetch).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(500);
    expect(err.message).toBe('boom');
  });
});

// ---------- fetchMemberships ----------

describe('fetchMemberships', () => {
  it('pide las membresías del usuario actual', async () => {
    const rows: ListMembership[] = [{ list_id: LIST_ID, role: 'owner', joined_at: NOW_ISO }];
    const f = fakeFetch(() => json(rows));

    expect(await fetchMemberships(CFG, SESSION, f.fetch)).toEqual(rows);

    const c = f.calls[0];
    expect(c.method).toBe('GET');
    expect(c.url.pathname).toBe('/rest/v1/list_members');
    expect(c.url.searchParams.get('select')).toBe('list_id,role,joined_at');
    expect(c.url.searchParams.get('user_id')).toBe(`eq.${SESSION.userId}`);
    expectAuth(c);
  });

  it('lanza SharingUnavailableError si responde 404', async () => {
    const f = fakeFetch(() => json({ code: 'PGRST205' }, 404));

    await expect(fetchMemberships(CFG, SESSION, f.fetch)).rejects.toBeInstanceOf(SharingUnavailableError);
  });
});

// ---------- pushListItems ----------

describe('pushListItems', () => {
  it('no hace ninguna petición si no hay filas', async () => {
    const f = fakeFetch();

    await pushListItems(CFG, SESSION, LIST_ID, [], f.fetch);

    expect(f.calls).toHaveLength(0);
  });

  it('sube una fila con list_id y los campos de la fila', async () => {
    const r: ListRow = { kind: 'enc', id: 'h1', data: { v: 1, iv: 'iv', ct: 'ct' }, updated_at: 5, deleted: false };
    const f = fakeFetch();

    await pushListItems(CFG, SESSION, LIST_ID, [r], f.fetch);

    expect(f.calls).toHaveLength(1);
    const c = f.calls[0];
    expect(c.method).toBe('POST');
    expect(c.url.pathname).toBe('/rest/v1/list_items');
    expect(c.url.searchParams.get('on_conflict')).toBe('list_id,kind,id');
    expect(c.headers.Prefer).toBe('resolution=merge-duplicates,return=minimal');
    expectAuth(c);
    expect(c.body).toEqual([
      { list_id: LIST_ID, kind: 'enc', id: 'h1', data: r.data, updated_at: 5, deleted: false },
    ]);
  });

  it('trocea en lotes de 200', async () => {
    const rows: ListRow[] = Array.from({ length: 450 }, (_, i) => ({
      kind: 'enc',
      id: `h${i}`,
      data: { v: 1, iv: 'iv', ct: 'ct' },
      updated_at: i,
      deleted: i % 2 === 0,
    }));
    const f = fakeFetch();

    await pushListItems(CFG, SESSION, LIST_ID, rows, f.fetch);

    expect(f.calls.map((c) => c.body.length)).toEqual([200, 200, 50]);
    expect(f.calls[1].body[0].id).toBe('h200');
    expect(f.calls[2].body[49].id).toBe('h449');
    expect(f.calls[2].body[49].deleted).toBe(false);
  });

  it('lanza SharingUnavailableError si responde 404', async () => {
    const f = fakeFetch(() => json({ code: 'PGRST205' }, 404));
    const r: ListRow = { kind: 'enc', id: 'h1', data: { v: 1, iv: 'iv', ct: 'ct' }, updated_at: 1, deleted: false };

    await expect(pushListItems(CFG, SESSION, LIST_ID, [r], f.fetch)).rejects.toBeInstanceOf(SharingUnavailableError);
  });
});

// ---------- pullListItems ----------

describe('pullListItems', () => {
  it('pagina en dos páginas y calcula el cursor de la última fila', async () => {
    const base = Date.parse('2026-10-29T12:00:00Z');
    const page1 = Array.from({ length: 500 }, (_, i) => row(i, new Date(base + i * 1000).toISOString()));
    const lastOfPage1 = page1[499].synced_at as string;
    const page2 = Array.from({ length: 3 }, (_, i) => row(500 + i, new Date(base + (500 + i) * 1000).toISOString()));
    const lastCursor = page2[2].synced_at as string;
    const pages = [page1, page2];
    const f = fakeFetch(() => json(pages.shift()));

    const out = await pullListItems(CFG, SESSION, LIST_ID, null, f.fetch);

    expect(out.rows).toHaveLength(503);
    expect(out.cursor).toBe(lastCursor);
    expect(out.rows[0]).toEqual({ kind: 'enc', id: 'h0', data: { v: 1, iv: 'iv', ct: 'ct' }, updated_at: 0, deleted: false });
    // Sin since: primera página sin filtro de synced_at; la segunda avanza con el cursor de la primera.
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0].url.searchParams.has('synced_at')).toBe(false);
    expect(f.calls[1].url.searchParams.get('synced_at')).toBe(`gt.${lastOfPage1}`);
    for (const c of f.calls) {
      expect(c.method).toBe('GET');
      expect(c.url.pathname).toBe('/rest/v1/list_items');
      expect(c.url.searchParams.get('select')).toBe('kind,id,data,updated_at,deleted,synced_at');
      expect(c.url.searchParams.get('order')).toBe('synced_at.asc');
      expect(c.url.searchParams.get('limit')).toBe('500');
      expect(c.url.searchParams.get('list_id')).toBe(`eq.${LIST_ID}`);
      expectAuth(c);
    }
  });

  it('usa since como filtro de synced_at en la primera petición', async () => {
    const f = fakeFetch(() => json([row(1, '2026-10-29T12:00:05.000Z')]));

    const out = await pullListItems(CFG, SESSION, LIST_ID, '2026-10-29T12:00:00.000Z', f.fetch);

    expect(f.calls[0].url.searchParams.get('synced_at')).toBe('gt.2026-10-29T12:00:00.000Z');
    expect(out.cursor).toBe('2026-10-29T12:00:05.000Z');
  });

  it('corta si el cursor no avanza aunque la página esté llena', async () => {
    const since = '2026-10-29T12:00:00.000Z';
    const page = Array.from({ length: 500 }, (_, i) => row(i, since));
    const f = fakeFetch(() => json(page));

    const out = await pullListItems(CFG, SESSION, LIST_ID, since, f.fetch);

    expect(f.calls).toHaveLength(1);
    expect(out.rows).toHaveLength(500);
    expect(out.cursor).toBe(since);
  });

  it('sin filas devuelve cursor null', async () => {
    const f = fakeFetch(() => json([]));

    expect(await pullListItems(CFG, SESSION, LIST_ID, null, f.fetch)).toEqual({ rows: [], cursor: null });
    expect(f.calls).toHaveLength(1);
  });

  it('convierte deleted a booleano estricto', async () => {
    const f = fakeFetch(() => json([{ ...row(1, NOW_ISO), deleted: 'x' }]));

    const out = await pullListItems(CFG, SESSION, LIST_ID, null, f.fetch);

    expect(out.rows[0].deleted).toBe(false);
    expect(out.rows[0]).not.toHaveProperty('synced_at');
  });

  it('lanza SharingUnavailableError si responde 404', async () => {
    const f = fakeFetch(() => json({ code: 'PGRST205' }, 404));

    await expect(pullListItems(CFG, SESSION, LIST_ID, null, f.fetch)).rejects.toBeInstanceOf(SharingUnavailableError);
  });
});

// ---------- invitaciones ----------

const INVITE_IN = { id: INVITE_ID, list_id: LIST_ID, token_hash: 'a'.repeat(64), wrapped: 'w-base64' };
const INVITE_ROW: ListInviteInfo = {
  id: INVITE_ID,
  list_id: LIST_ID,
  created_by: SESSION.userId,
  created_at: NOW_ISO,
  expires_at: '2026-11-05T12:00:00.000Z',
  used_by: null,
  used_at: null,
};

describe('createInvite', () => {
  it('inserta la invitación con return=representation y devuelve la fila', async () => {
    const f = fakeFetch(() => json([INVITE_ROW]));

    expect(await createInvite(CFG, SESSION, INVITE_IN, f.fetch)).toEqual(INVITE_ROW);

    const c = f.calls[0];
    expect(c.method).toBe('POST');
    expect(c.url.pathname).toBe('/rest/v1/list_invites');
    expect(c.url.searchParams.get('select')).toBe('id,list_id,created_by,created_at,expires_at,used_by,used_at');
    expect(c.headers.Prefer).toBe('return=representation');
    expectAuth(c);
    expect(c.body).toEqual(INVITE_IN);
  });

  it('no devuelve token_hash ni wrapped aunque el servidor los incluya', async () => {
    const f = fakeFetch(() => json([{ ...INVITE_ROW, token_hash: 'x', wrapped: 'y' }]));

    const out = await createInvite(CFG, SESSION, INVITE_IN, f.fetch);

    expect(out).not.toHaveProperty('token_hash');
    expect(out).not.toHaveProperty('wrapped');
  });

  it('lanza Error si el servidor no devuelve la fila', async () => {
    const f = fakeFetch(() => json([]));

    await expect(createInvite(CFG, SESSION, INVITE_IN, f.fetch)).rejects.toThrow();
  });
});

describe('listPendingInvites', () => {
  it('pide las invitaciones vigentes de la lista, más recientes primero', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse(NOW_ISO));
    const f = fakeFetch(() => json([INVITE_ROW]));

    expect(await listPendingInvites(CFG, SESSION, LIST_ID, f.fetch)).toEqual([INVITE_ROW]);

    const c = f.calls[0];
    expect(c.method).toBe('GET');
    expect(c.url.pathname).toBe('/rest/v1/list_invites');
    expect(c.url.searchParams.get('select')).toBe('id,list_id,created_by,created_at,expires_at,used_by,used_at');
    expect(c.url.searchParams.get('list_id')).toBe(`eq.${LIST_ID}`);
    expect(c.url.searchParams.get('used_by')).toBe('is.null');
    expect(c.url.searchParams.get('expires_at')).toBe(`gt.${NOW_ISO}`);
    expect(c.url.searchParams.get('order')).toBe('created_at.desc');
    expectAuth(c);
  });

  it('no deja pasar token_hash ni wrapped', async () => {
    const f = fakeFetch(() => json([{ ...INVITE_ROW, token_hash: 'x', wrapped: 'y' }]));

    const [out] = await listPendingInvites(CFG, SESSION, LIST_ID, f.fetch);

    expect(out).not.toHaveProperty('token_hash');
    expect(out).not.toHaveProperty('wrapped');
  });
});

describe('deleteInvite', () => {
  it('borra la invitación por id', async () => {
    const f = fakeFetch();

    await deleteInvite(CFG, SESSION, INVITE_ID, f.fetch);

    const c = f.calls[0];
    expect(c.method).toBe('DELETE');
    expect(c.url.pathname).toBe('/rest/v1/list_invites');
    expect(c.url.searchParams.get('id')).toBe(`eq.${INVITE_ID}`);
    expect(c.headers.Prefer).toBe('return=minimal');
    expectAuth(c);
  });
});

describe('acceptInvite', () => {
  it('convierte la clave a hex y devuelve list_id y wrapped', async () => {
    const f = fakeFetch(() => json({ list_id: LIST_ID, wrapped: 'w-base64' }));

    expect(await acceptInvite(CFG, SESSION, INVITE_ID, AUTH_B64, f.fetch)).toEqual({
      list_id: LIST_ID,
      wrapped: 'w-base64',
    });

    const c = f.calls[0];
    expect(c.method).toBe('POST');
    expect(c.url.pathname).toBe('/rest/v1/rpc/accept_invite');
    expect(c.body).toEqual({ p_invite: INVITE_ID, p_auth: AUTH_HEX });
    expectAuth(c);
  });

  it.each(['invite_invalid', 'invite_expired', 'invite_used', 'list_full'] as const)(
    'mapea el código %s a InviteRejectedError',
    async (code) => {
      const f = fakeFetch(() => json({ code: 'P0001', message: code }, 400));

      const err = await acceptInvite(CFG, SESSION, INVITE_ID, AUTH_B64, f.fetch).catch((e) => e);
      expect(err).toBeInstanceOf(InviteRejectedError);
      expect(err.name).toBe('InviteRejectedError');
      expect(err.code).toBe(code);
    },
  );

  it('lanza SharingUnavailableError si responde 404', async () => {
    const f = fakeFetch(() => json({ code: 'PGRST202', message: 'Could not find the function' }, 404));

    await expect(acceptInvite(CFG, SESSION, INVITE_ID, AUTH_B64, f.fetch)).rejects.toBeInstanceOf(
      SharingUnavailableError,
    );
  });

  it('otro 400 con mensaje desconocido lanza HttpError', async () => {
    const f = fakeFetch(() => json({ code: 'P0001', message: 'boom' }, 400));

    const err = await acceptInvite(CFG, SESSION, INVITE_ID, AUTH_B64, f.fetch).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).not.toBeInstanceOf(InviteRejectedError);
    expect(err.status).toBe(400);
    expect(err.message).toBe('boom');
  });

  it('una clave no válida falla antes de hacer ninguna petición', async () => {
    const f = fakeFetch();

    await expect(acceptInvite(CFG, SESSION, INVITE_ID, 'no valido!', f.fetch)).rejects.toThrow();
    expect(f.calls).toHaveLength(0);
  });
});

// ---------- miembros ----------

describe('fetchListMembers', () => {
  it('llama a rpc/list_members_info con p_list', async () => {
    const members: ListMemberInfo[] = [
      { user_id: SESSION.userId, role: 'owner', joined_at: NOW_ISO, email: 'ana@example.com', name: 'Ana' },
    ];
    const f = fakeFetch(() => json(members));

    expect(await fetchListMembers(CFG, SESSION, LIST_ID, f.fetch)).toEqual(members);

    const c = f.calls[0];
    expect(c.method).toBe('POST');
    expect(c.url.pathname).toBe('/rest/v1/rpc/list_members_info');
    expect(c.body).toEqual({ p_list: LIST_ID });
    expectAuth(c);
  });
});

describe('leaveList', () => {
  it('borra tu propia membresía', async () => {
    const f = fakeFetch();

    await leaveList(CFG, SESSION, LIST_ID, f.fetch);

    const c = f.calls[0];
    expect(c.method).toBe('DELETE');
    expect(c.url.pathname).toBe('/rest/v1/list_members');
    expect(c.url.searchParams.get('list_id')).toBe(`eq.${LIST_ID}`);
    expect(c.url.searchParams.get('user_id')).toBe(`eq.${SESSION.userId}`);
    expect(c.headers.Prefer).toBe('return=minimal');
    expectAuth(c);
  });
});

describe('removeMember', () => {
  it('borra la membresía de otra persona y acepta la respuesta con la fila', async () => {
    const f = fakeFetch(() => json([{ list_id: LIST_ID, user_id: OTHER_USER }]));

    await removeMember(CFG, SESSION, LIST_ID, OTHER_USER, f.fetch);

    const c = f.calls[0];
    expect(c.method).toBe('DELETE');
    expect(c.url.pathname).toBe('/rest/v1/list_members');
    expect(c.url.searchParams.get('list_id')).toBe(`eq.${LIST_ID}`);
    expect(c.url.searchParams.get('user_id')).toBe(`eq.${OTHER_USER}`);
    expect(c.headers.Prefer).toBe('return=representation');
    expectAuth(c);
  });

  it('lanza Error si RLS no devolvió ninguna fila (no eres propietario)', async () => {
    const f = fakeFetch(() => json([]));

    await expect(removeMember(CFG, SESSION, LIST_ID, OTHER_USER, f.fetch)).rejects.toThrow(
      'Solo quien administra la lista puede quitar a alguien',
    );
  });
});

describe('deleteSharedList', () => {
  it('borra la lista por id', async () => {
    const f = fakeFetch(() => json([{ id: LIST_ID }]));

    await deleteSharedList(CFG, SESSION, LIST_ID, f.fetch);

    const c = f.calls[0];
    expect(c.method).toBe('DELETE');
    expect(c.url.pathname).toBe('/rest/v1/lists');
    expect(c.url.searchParams.get('id')).toBe(`eq.${LIST_ID}`);
    expect(c.headers.Prefer).toBe('return=representation');
    expectAuth(c);
  });

  it('lanza Error si RLS no devolvió ninguna fila (no eres el creador)', async () => {
    const f = fakeFetch(() => json([]));

    await expect(deleteSharedList(CFG, SESSION, LIST_ID, f.fetch)).rejects.toThrow(
      'Solo quien administra la lista puede borrarla para todos',
    );
  });
});

// ---------- 404 en todas las funciones ----------

describe('servidor sin migración (404) en todas las funciones', () => {
  const run: Array<[string, (f: typeof fetch) => Promise<unknown>]> = [
    ['createSharedList', (f) => createSharedList(CFG, SESSION, LIST_ID, f)],
    ['fetchMemberships', (f) => fetchMemberships(CFG, SESSION, f)],
    ['pushListItems', (f) => pushListItems(CFG, SESSION, LIST_ID, [{ kind: 'enc', id: 'h', data: { v: 1, iv: 'i', ct: 'c' }, updated_at: 1, deleted: false }], f)],
    ['pullListItems', (f) => pullListItems(CFG, SESSION, LIST_ID, null, f)],
    ['createInvite', (f) => createInvite(CFG, SESSION, INVITE_IN, f)],
    ['listPendingInvites', (f) => listPendingInvites(CFG, SESSION, LIST_ID, f)],
    ['deleteInvite', (f) => deleteInvite(CFG, SESSION, INVITE_ID, f)],
    ['acceptInvite', (f) => acceptInvite(CFG, SESSION, INVITE_ID, AUTH_B64, f)],
    ['fetchListMembers', (f) => fetchListMembers(CFG, SESSION, LIST_ID, f)],
    ['leaveList', (f) => leaveList(CFG, SESSION, LIST_ID, f)],
    ['removeMember', (f) => removeMember(CFG, SESSION, LIST_ID, OTHER_USER, f)],
    ['deleteSharedList', (f) => deleteSharedList(CFG, SESSION, LIST_ID, f)],
  ];

  it.each(run)('%s lanza SharingUnavailableError', async (_name, call) => {
    const f = fakeFetch(() => json({ code: 'PGRST205', message: 'missing' }, 404));

    await expect(call(f.fetch)).rejects.toBeInstanceOf(SharingUnavailableError);
  });
});
