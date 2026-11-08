import { describe, it, expect } from 'vitest';
import type { Session } from './auth';
import type { ListRow } from './listcrypto';
import { ANON_KEY, FAKE_CFG, FakeSupabase } from './fakeSupabase';
import { HttpError, deleteRemoteAccount, pullItems, pushItems } from './api';
import {
  InviteRejectedError,
  SharingUnavailableError,
  acceptInvite,
  createInvite,
  createSharedList,
  deleteSharedList,
  fetchListMembers,
  fetchMemberships,
  leaveList,
  pullListItems,
  pushListItems,
  removeMember,
} from './listapi';
import {
  createInviteSecret,
  decryptListItem,
  encryptListItem,
  generateLk,
  inviteKeys,
  inviteLink,
  parseInviteFragment,
  unwrapInvite,
  wrapInvite,
} from './listcrypto';

const DAY = 24 * 3600_000;

// ---------- utilidades ----------

/** Petición cruda al fake, con la misma cabecera apikey que el cliente. */
function raw(f: FakeSupabase, s: Session | null, path: string, opts: { method?: string; body?: unknown; prefer?: string } = {}) {
  const headers: Record<string, string> = { apikey: ANON_KEY, 'Content-Type': 'application/json' };
  if (s) headers.Authorization = `Bearer ${s.accessToken}`;
  if (opts.prefer) headers.Prefer = opts.prefer;
  return f.fetch(`${FAKE_CFG.url}/rest/v1/${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

/** Usuarios de prueba: ana (dueña), bea y carlos. */
function setup() {
  const f = new FakeSupabase();
  const ids = {
    ana: f.addUser('ana@test.io', 'Ana'),
    bea: f.addUser('bea@test.io', 'Bea'),
    carlos: f.addUser('carlos@test.io', 'Carlos'),
  };
  return { f, ids, ana: f.session('ana@test.io'), bea: f.session('bea@test.io'), carlos: f.session('carlos@test.io') };
}

/** Crea una invitación real: secreto aleatorio, claves derivadas, envoltura de la LK y fila en el servidor. */
async function makeInvite(f: FakeSupabase, owner: Session, listId: string, lk: CryptoKey, name = 'Compra') {
  const secret = createInviteSecret();
  const keys = await inviteKeys(secret);
  const id = crypto.randomUUID();
  const wrapped = await wrapInvite(keys.wrapKey, id, listId, { lk, name });
  await createInvite(FAKE_CFG, owner, { id, list_id: listId, token_hash: keys.authHash, wrapped }, f.fetch);
  return inviteLink('https://lista.test', id, secret);
}

/** Acepta un enlace de invitación como lo haría la app: fragmento -> claves -> accept_invite -> desenvoltura. */
async function accept(f: FakeSupabase, s: Session, link: string) {
  const frag = parseInviteFragment(link.slice(link.indexOf('#')));
  if (!frag) throw new Error('enlace mal formado en el test');
  const keys = await inviteKeys(frag.secret);
  const res = await acceptInvite(FAKE_CFG, s, frag.inviteId, keys.auth, f.fetch);
  const { lk, name } = await unwrapInvite(keys.wrapKey, frag.inviteId, res.list_id, res.wrapped);
  return { listId: res.list_id, lk, name };
}

/** Sube tareas cifradas con la LK de la lista. */
async function pushTasks(f: FakeSupabase, s: Session, lk: CryptoKey, listId: string, tasks: Array<{ id: string; title: string; updated_at: number; deleted?: boolean }>) {
  const rows = await Promise.all(
    tasks.map((t) =>
      encryptListItem(lk, listId, { kind: 'task', id: t.id, data: { title: t.title }, updated_at: t.updated_at, deleted: t.deleted ?? false }),
    ),
  );
  await pushListItems(FAKE_CFG, s, listId, rows, f.fetch);
}

/** Descarga y descifra una lista: título de cada tarea por id. */
async function readTasks(f: FakeSupabase, s: Session, lk: CryptoKey, listId: string): Promise<Record<string, string>> {
  const { rows } = await pullListItems(FAKE_CFG, s, listId, null, f.fetch);
  const out: Record<string, string> = {};
  for (const r of rows) {
    const it = await decryptListItem(lk, listId, r as ListRow);
    if (!it.deleted) out[it.id] = (it.data as { title: string }).title;
  }
  return out;
}

/** Ana crea una lista con una tarea y la LK de la lista. */
async function ownedList(f: FakeSupabase, ana: Session) {
  const listId = crypto.randomUUID();
  const lk = await generateLk();
  await createSharedList(FAKE_CFG, ana, listId, f.fetch);
  return { listId, lk };
}

// ---------- tests ----------

describe('FakeSupabase: flujo de listas compartidas con el cliente real', () => {
  it('create_list + accept_invite: el invitado recibe la clave y descifra lo que subió el owner', async () => {
    const { f, ids, ana, bea } = setup();
    const { listId, lk } = await ownedList(f, ana);
    expect(await createSharedList(FAKE_CFG, ana, listId, f.fetch)).toEqual({ created: false }); // ya era miembro

    await pushTasks(f, ana, lk, listId, [{ id: 't1', title: 'Leche secreta', updated_at: 1000 }]);
    const link = await makeInvite(f, ana, listId, lk, 'Compra');

    const joined = await accept(f, bea, link);
    expect(joined.listId).toBe(listId);
    expect(joined.name).toBe('Compra');
    expect(await readTasks(f, bea, joined.lk, listId)).toEqual({ t1: 'Leche secreta' });

    expect(f.membersOf(listId)).toEqual([
      { userId: ids.ana, role: 'owner' },
      { userId: ids.bea, role: 'member' },
    ]);
    const info = await fetchListMembers(FAKE_CFG, bea, listId, f.fetch);
    expect(info.map((m) => [m.email, m.role, m.name])).toEqual([
      ['ana@test.io', 'owner', 'Ana'],
      ['bea@test.io', 'member', 'Bea'],
    ]);
    expect(await fetchMemberships(FAKE_CFG, bea, f.fetch)).toEqual([
      expect.objectContaining({ list_id: listId, role: 'member' }),
    ]);
    // Nada en claro en el servidor: ni el título de la tarea, ni el nombre de la lista, ni el de la invitación.
    expect(f.serverText()).not.toContain('Leche secreta');
    expect(f.serverText()).not.toContain('Compra');
  });

  it('un no miembro no lee ni escribe la lista; DELETE sobre list_items no borra nada', async () => {
    const { f, ana, carlos } = setup();
    const { listId, lk } = await ownedList(f, ana);
    await pushTasks(f, ana, lk, listId, [{ id: 't1', title: 'x', updated_at: 1000 }]);

    expect(await pullListItems(FAKE_CFG, carlos, listId, null, f.fetch)).toEqual({ rows: [], cursor: null });
    expect(await fetchListMembers(FAKE_CFG, carlos, listId, f.fetch)).toEqual([]);
    expect(await (await raw(f, carlos, `list_members?list_id=eq.${listId}`)).json()).toEqual([]);

    const rows = await encryptListItem(lk, listId, { kind: 'task', id: 't2', data: { title: 'y' }, updated_at: 1, deleted: false });
    const err = await pushListItems(FAKE_CFG, carlos, listId, [rows], f.fetch).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(403);
    expect((err as HttpError).message).toContain('row-level security');

    const del = await raw(f, ana, `list_items?list_id=eq.${listId}`, { method: 'DELETE', prefer: 'return=representation' });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual([]);
    expect(f.listRows(listId).length).toBe(1);
  });

  it('LWW en list_items: gana el updated_at mayor, el igual reemplaza y el menor se descarta; synced_at crece', async () => {
    const { f, ana, bea } = setup();
    const { listId, lk } = await ownedList(f, ana);
    const link = await makeInvite(f, ana, listId, lk);
    const bob = await accept(f, bea, link);

    await pushTasks(f, ana, lk, listId, [{ id: 't1', title: 'v1', updated_at: 2000 }]);
    await pushTasks(f, bea, bob.lk, listId, [{ id: 't1', title: 'v2', updated_at: 3000 }]);
    await pushTasks(f, ana, lk, listId, [{ id: 't1', title: 'viejo', updated_at: 1500 }]); // descartado sin error
    expect(await readTasks(f, ana, lk, listId)).toEqual({ t1: 'v2' });

    await pushTasks(f, ana, lk, listId, [{ id: 't1', title: 'v2-igual', updated_at: 3000 }]); // igual: reemplaza
    expect(await readTasks(f, bea, bob.lk, listId)).toEqual({ t1: 'v2-igual' });

    const synced = f.listRows(listId).map((r) => String(r.synced_at));
    expect(new Set(synced).size).toBe(synced.length);
    expect([...synced].sort()).toEqual(synced); // ISO con microsegundos: el orden de texto es el temporal
  });

  it('paginación: el pull trae todas las filas en páginas de 500, por synced_at ascendente', async () => {
    const { f, ana } = setup();
    const { listId, lk } = await ownedList(f, ana);
    const tasks = Array.from({ length: 1203 }, (_, i) => ({ id: `t${i}`, title: `tarea ${i}`, updated_at: 1000 + i }));
    await pushTasks(f, ana, lk, listId, tasks);

    const page = await (await raw(f, ana, `list_items?select=id,synced_at&order=synced_at.asc&limit=2&list_id=eq.${listId}`)).json();
    expect(page.map((r: { id: string }) => r.id).length).toBe(2);
    expect(String(page[0].synced_at) < String(page[1].synced_at)).toBe(true);

    const { rows, cursor } = await pullListItems(FAKE_CFG, ana, listId, null, f.fetch);
    expect(rows.length).toBe(1203);
    expect(new Set(rows.map((r) => r.id)).size).toBe(1203);
    expect(cursor).not.toBeNull();
    expect((await pullListItems(FAKE_CFG, ana, listId, cursor, f.fetch)).rows).toEqual([]);
  });

  it('quitar a alguien: solo el owner puede; quien pierde el acceso deja de ver la lista', async () => {
    const { f, ids, ana, bea } = setup();
    const { listId, lk } = await ownedList(f, ana);
    await accept(f, bea, await makeInvite(f, ana, listId, lk));

    await expect(removeMember(FAKE_CFG, bea, listId, ids.ana, f.fetch)).rejects.toThrow(
      'Solo quien administra la lista puede quitar a alguien',
    );
    await removeMember(FAKE_CFG, ana, listId, ids.bea, f.fetch);
    expect(f.membersOf(listId)).toEqual([{ userId: ids.ana, role: 'owner' }]);
    expect(await pullListItems(FAKE_CFG, bea, listId, null, f.fetch)).toEqual({ rows: [], cursor: null });
  });

  it('salir como miembro borra las invitaciones sin usar que creó; las de otros siguen', async () => {
    const { f, ids, ana, bea } = setup();
    const { listId, lk } = await ownedList(f, ana);
    await accept(f, bea, await makeInvite(f, ana, listId, lk, 'de ana'));
    await makeInvite(f, bea, listId, lk, 'de bea');
    expect(f.invitesOf(listId).map((i) => i.created_by)).toEqual([ids.ana, ids.bea]);

    await leaveList(FAKE_CFG, bea, listId, f.fetch);
    expect(f.membersOf(listId)).toEqual([{ userId: ids.ana, role: 'owner' }]);
    expect(f.invitesOf(listId).map((i) => i.created_by)).toEqual([ids.ana]);
    expect(f.hasList(listId)).toBe(true);
  });

  it('el owner que sale pasa a ser owner el miembro más antiguo', async () => {
    const { f, ids, ana, bea, carlos } = setup();
    const { listId, lk } = await ownedList(f, ana);
    await accept(f, bea, await makeInvite(f, ana, listId, lk));
    f.advance(1000);
    await accept(f, carlos, await makeInvite(f, ana, listId, lk));

    await leaveList(FAKE_CFG, ana, listId, f.fetch);
    expect(f.membersOf(listId)).toEqual([
      { userId: ids.bea, role: 'owner' },
      { userId: ids.carlos, role: 'member' },
    ]);
  });

  it('empate de joined_at: el owner pasa al de menor user_id', async () => {
    const { f, ids, ana, bea, carlos } = setup();
    const { listId, lk } = await ownedList(f, ana);
    // Mismo instante (el reloj del fake no avanza): desempata user_id.
    await accept(f, carlos, await makeInvite(f, ana, listId, lk));
    await accept(f, bea, await makeInvite(f, ana, listId, lk));

    await leaveList(FAKE_CFG, ana, listId, f.fetch);
    expect(f.membersOf(listId)).toEqual([
      { userId: ids.bea, role: 'owner' }, // user-2 < user-3
      { userId: ids.carlos, role: 'member' },
    ]);
  });

  it('la última persona que sale borra la lista con todo su contenido', async () => {
    const { f, ana, bea } = setup();
    const { listId, lk } = await ownedList(f, ana);
    await accept(f, bea, await makeInvite(f, ana, listId, lk));
    await pushTasks(f, ana, lk, listId, [{ id: 't1', title: 'x', updated_at: 1 }]);
    await makeInvite(f, ana, listId, lk);

    await leaveList(FAKE_CFG, ana, listId, f.fetch);
    await leaveList(FAKE_CFG, bea, listId, f.fetch);
    expect(f.hasList(listId)).toBe(false);
    expect(f.listRows(listId)).toEqual([]);
    expect(f.invitesOf(listId)).toEqual([]);
    expect(f.membersOf(listId)).toEqual([]);
  });

  it('delete_account transfiere la propiedad, borra sus items y su sesión deja de valer', async () => {
    const { f, ids, ana, bea } = setup();
    const { listId, lk } = await ownedList(f, ana);
    await accept(f, bea, await makeInvite(f, ana, listId, lk));
    await pushItems(FAKE_CFG, ana, [{ kind: 'enc', id: 'abc', data: { v: 1, iv: 'a', ct: 'b' }, updated_at: 1, deleted: false } as never], f.fetch);
    expect(f.itemsOf(ids.ana).length).toBe(1);

    expect(await deleteRemoteAccount(FAKE_CFG, ana, f.fetch)).toEqual({ account: true });
    expect(f.membersOf(listId)).toEqual([{ userId: ids.bea, role: 'owner' }]);
    expect(f.itemsOf(ids.ana)).toEqual([]);
    expect(f.hasList(listId)).toBe(true);
    const err = await pullListItems(FAKE_CFG, ana, listId, null, f.fetch).catch((e: unknown) => e);
    expect((err as HttpError).status).toBe(401);
  });

  it('invitación caducada: invite_expired', async () => {
    const { f, ana, bea } = setup();
    const { listId, lk } = await ownedList(f, ana);
    const link = await makeInvite(f, ana, listId, lk);
    f.advance(8 * DAY);
    const err = await accept(f, bea, link).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InviteRejectedError);
    expect((err as InviteRejectedError).code).toBe('invite_expired');
  });

  it('invitación usada: invite_used para otro; el mismo que la usó repite sin error', async () => {
    const { f, ana, bea, carlos } = setup();
    const { listId, lk } = await ownedList(f, ana);
    const link = await makeInvite(f, ana, listId, lk);
    await accept(f, bea, link);

    const err = await accept(f, carlos, link).catch((e: unknown) => e);
    expect((err as InviteRejectedError).code).toBe('invite_used');
    const again = await accept(f, bea, link);
    expect(again.listId).toBe(listId);
  });

  it('secreto incorrecto o id desconocido: invite_invalid, aunque la invitación esté usada', async () => {
    const { f, ana, bea, carlos } = setup();
    const { listId, lk } = await ownedList(f, ana);
    const link = await makeInvite(f, ana, listId, lk);
    const frag = parseInviteFragment(link.slice(link.indexOf('#')))!;

    const wrongKeys = await inviteKeys(createInviteSecret());
    const e1 = await acceptInvite(FAKE_CFG, carlos, frag.inviteId, wrongKeys.auth, f.fetch).catch((e: unknown) => e);
    expect((e1 as InviteRejectedError).code).toBe('invite_invalid');

    const e2 = await acceptInvite(FAKE_CFG, carlos, crypto.randomUUID(), (await inviteKeys(frag.secret)).auth, f.fetch).catch(
      (e: unknown) => e,
    );
    expect((e2 as InviteRejectedError).code).toBe('invite_invalid');

    await accept(f, bea, link);
    const e3 = await acceptInvite(FAKE_CFG, carlos, frag.inviteId, wrongKeys.auth, f.fetch).catch((e: unknown) => e);
    expect((e3 as InviteRejectedError).code).toBe('invite_invalid'); // el secreto se mira antes que el uso
  });

  it('ya miembro por otra invitación: no gasta la nueva, que sirve para otra persona', async () => {
    const { f, ids, ana, bea, carlos } = setup();
    const { listId, lk } = await ownedList(f, ana);
    const first = await makeInvite(f, ana, listId, lk);
    const second = await makeInvite(f, ana, listId, lk);
    await accept(f, bea, first);
    expect((await accept(f, bea, second)).listId).toBe(listId);

    const unused = f.invitesOf(listId).find((i) => i.used_by == null);
    expect(unused).toBeDefined();
    await accept(f, carlos, second);
    expect(f.membersOf(listId).map((m) => m.userId)).toEqual([ids.ana, ids.bea, ids.carlos]);
  });

  it('list_full: a los 50 miembros, el siguiente recibe list_full', async () => {
    const f = new FakeSupabase();
    f.addUser('ana@test.io');
    const ana = f.session('ana@test.io');
    const { listId, lk } = await ownedList(f, ana);
    for (let i = 1; i <= 49; i++) {
      const email = `p${i}@test.io`;
      f.addUser(email);
      await accept(f, f.session(email), await makeInvite(f, ana, listId, lk));
    }
    expect(f.membersOf(listId).length).toBe(50);
    f.addUser('extra@test.io');
    const err = await accept(f, f.session('extra@test.io'), await makeInvite(f, ana, listId, lk)).catch((e: unknown) => e);
    expect((err as InviteRejectedError).code).toBe('list_full');
  });

  it('solo el owner puede borrar la lista para todos', async () => {
    const { f, ana, bea } = setup();
    const { listId, lk } = await ownedList(f, ana);
    await accept(f, bea, await makeInvite(f, ana, listId, lk));
    await expect(deleteSharedList(FAKE_CFG, bea, listId, f.fetch)).rejects.toThrow('Solo quien administra');
    await deleteSharedList(FAKE_CFG, ana, listId, f.fetch);
    expect(f.hasList(listId)).toBe(false);
    expect(f.membersOf(listId)).toEqual([]);
  });

  it('sharing = false: las listas dan SharingUnavailableError y items sigue funcionando', async () => {
    const { f, ana } = setup();
    f.sharing = false;
    const listId = crypto.randomUUID();
    await expect(createSharedList(FAKE_CFG, ana, listId, f.fetch)).rejects.toBeInstanceOf(SharingUnavailableError);
    await expect(fetchMemberships(FAKE_CFG, ana, f.fetch)).rejects.toBeInstanceOf(SharingUnavailableError);
    await expect(pullListItems(FAKE_CFG, ana, listId, null, f.fetch)).rejects.toBeInstanceOf(SharingUnavailableError);

    const body = await (await raw(f, ana, 'list_items?select=id')).json();
    expect(body).toMatchObject({ code: 'PGRST205' });
    const rpc = await raw(f, ana, 'rpc/create_list', { method: 'POST', body: { p_list: listId } });
    expect(rpc.status).toBe(404);
    expect(await rpc.json()).toMatchObject({ code: 'PGRST202' });

    await pushItems(FAKE_CFG, ana, [{ kind: 'enc', id: 'a', data: { v: 1 }, updated_at: 1, deleted: false } as never], f.fetch);
    const pulled = await pullItems(FAKE_CFG, ana, null, f.fetch);
    expect(pulled.items.map((i) => i.id)).toEqual(['a']);
  });
});

describe('FakeSupabase: sanity del servidor', () => {
  it('filtros PostgREST: in.(...), is.null, eq y select de columnas', async () => {
    const { f, ana, bea } = setup();
    const { listId, lk } = await ownedList(f, ana);
    const link = await makeInvite(f, ana, listId, lk);
    await makeInvite(f, ana, listId, lk);
    await accept(f, bea, link);

    const unused = await (await raw(f, ana, `list_invites?select=id,used_by&list_id=eq.${listId}&used_by=is.null`)).json();
    expect(unused.length).toBe(1);
    expect(Object.keys(unused[0]).sort()).toEqual(['id', 'used_by']);
    expect(unused[0].used_by).toBeNull();

    await pushItems(FAKE_CFG, ana, [
      { kind: 'enc', id: 'a', data: {}, updated_at: 1, deleted: false },
      { kind: 'enc', id: 'b,c', data: {}, updated_at: 1, deleted: false },
      { kind: 'enc', id: 'z', data: {}, updated_at: 1, deleted: false },
    ] as never, f.fetch);
    const ids2 = await (await raw(f, ana, `items?select=id&id=in.("a","b,c")`)).json();
    expect(ids2.map((r: { id: string }) => r.id).sort()).toEqual(['a', 'b,c']);
  });

  it('upserts LWW en items: un updated_at menor no cambia synced_at; igual o mayor sí; ignore-duplicates nunca pisa', async () => {
    const f = new FakeSupabase();
    f.addUser('ana@test.io');
    const ana = f.session('ana@test.io');
    const row = (updated_at: number, data: unknown = { n: updated_at }) => [{ user_id: ana.userId, kind: 'enc', id: 'x', data, updated_at, deleted: false }];
    const merge = 'resolution=merge-duplicates,return=minimal';

    await raw(f, ana, 'items?on_conflict=user_id,kind,id', { method: 'POST', body: row(5), prefer: merge });
    const s1 = (await (await raw(f, ana, 'items?select=synced_at&kind=eq.enc&id=eq.x')).json())[0].synced_at;
    expect(s1).toMatch(/\.\d{6}\+00:00$/);

    await raw(f, ana, 'items?on_conflict=user_id,kind,id', { method: 'POST', body: row(3, { n: 'viejo' }), prefer: merge });
    const same = await (await raw(f, ana, 'items?select=synced_at,updated_at,data&kind=eq.enc&id=eq.x')).json();
    expect(same[0]).toEqual({ synced_at: s1, updated_at: 5, data: { n: 5 } });

    await raw(f, ana, 'items?on_conflict=user_id,kind,id', { method: 'POST', body: row(5, { n: 'igual' }), prefer: merge });
    const s2 = (await (await raw(f, ana, 'items?select=synced_at&kind=eq.enc&id=eq.x')).json())[0].synced_at;
    expect(String(s2) > String(s1)).toBe(true);

    const ign = await raw(f, ana, 'items?on_conflict=user_id,kind,id', {
      method: 'POST',
      body: row(99, { n: 'ignorado' }),
      prefer: 'resolution=ignore-duplicates,return=minimal',
    });
    expect(ign.status).toBe(201);
    const after = await (await raw(f, ana, 'items?select=data&kind=eq.enc&id=eq.x')).json();
    expect(after[0].data).toEqual({ n: 'igual' });
  });

  it('list_items solo admite kind enc (400 23514) y RLS de insert da 403 con el mensaje de PostgreSQL', async () => {
    const { f, ana, carlos } = setup();
    const { listId } = await ownedList(f, ana);
    const bad = await raw(f, ana, 'list_items', {
      method: 'POST',
      body: [{ list_id: listId, kind: 'task', id: 'x', data: {}, updated_at: 1, deleted: false }],
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: '23514' });

    const denied = await raw(f, carlos, 'list_items', {
      method: 'POST',
      body: [{ list_id: listId, kind: 'enc', id: 'x', data: {}, updated_at: 1, deleted: false }],
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({
      code: '42501',
      message: 'new row violates row-level security policy for table "list_items"',
      details: null,
      hint: null,
    });
  });

  it('RPC create_list y accept_invite devuelven los códigos P0001 del SQL', async () => {
    const { f, ana, bea } = setup();
    const { listId, lk } = await ownedList(f, ana);
    const again = await raw(f, bea, 'rpc/create_list', { method: 'POST', body: { p_list: listId } });
    expect(await again.json()).toMatchObject({ code: 'P0001', message: 'list_exists' });
    expect(again.status).toBe(400);

    const link = await makeInvite(f, ana, listId, lk);
    const frag = parseInviteFragment(link.slice(link.indexOf('#')))!;
    const badHex = await raw(f, bea, 'rpc/accept_invite', { method: 'POST', body: { p_invite: frag.inviteId, p_auth: 'zz' } });
    expect(await badHex.json()).toMatchObject({ code: 'P0001', message: 'invite_invalid' });
  });

  it('create_list con token ausente: 401 como el resto de endpoints', async () => {
    const { f } = setup();
    const res = await raw(f, null, 'rpc/create_list', { method: 'POST', body: { p_list: crypto.randomUUID() } });
    expect(res.status).toBe(401);
  });

  it('el reloj controlable marca la caducidad de invitaciones y pairings', async () => {
    const f = new FakeSupabase(Date.parse('2026-11-08T10:00:00Z'));
    f.addUser('ana@test.io');
    const ana = f.session('ana@test.io');
    const listId = crypto.randomUUID();
    await createSharedList(FAKE_CFG, ana, listId, f.fetch);
    const lk = await generateLk();
    const link = await makeInvite(f, ana, listId, lk);
    const inv = f.invitesOf(listId)[0];
    expect(String(inv.expires_at).startsWith('2026-11-15T10:00:00.000000')).toBe(true);
    f.advance(8 * DAY);
    f.addUser('bea@test.io');
    const err = await accept(f, f.session('bea@test.io'), link).catch((e: unknown) => e);
    expect((err as InviteRejectedError).code).toBe('invite_expired');
  });
});
