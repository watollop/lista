// Listas compartidas contra un Supabase de verdad (Postgres + Auth + PostgREST con supabase/schema.sql).
// Comprueba que fakeSupabase.ts no se ha separado de la migración real. Se salta si no hay servidor:
//   supabase start  (en un proyecto con supabase/schema.sql como migración)
//   LISTA_SUPABASE_URL=http://127.0.0.1:54321 LISTA_SUPABASE_ANON=… LISTA_SUPABASE_SERVICE=… npm run test:supabase
// Usa cuentas nuevas con email y contraseña en cada ejecución; no sirve contra el proyecto de producción.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { ParsedLine, Repo, TodoList } from '../types';
import { MAIN_LIST } from '../types';
import { createRepo } from '../data/repo';
import type { Session } from './auth';
import { createSync } from './index';
import { InviteRejectedError } from './listapi';

const URL_ = process.env.LISTA_SUPABASE_URL ?? '';
const ANON = process.env.LISTA_SUPABASE_ANON ?? '';
const SERVICE = process.env.LISTA_SUPABASE_SERVICE ?? '';
const CFG = { url: URL_, anonKey: ANON };
const ORIGIN = 'https://lista.test';
const RUN = Date.now().toString(36);
const PASSWORD = `pw-${RUN}-Lista!`;

function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

async function admin(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${URL_}${path}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', ...init.headers },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

let seq = 0;
/** Cuenta nueva (confirmada) con nombre en los metadatos, como las de Google. Devuelve su email. */
async function addUser(name: string): Promise<string> {
  const email = `${name.toLowerCase()}-${RUN}-${++seq}@test.io`;
  await admin('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: name } }),
  });
  return email;
}

async function signIn(email: string): Promise<Session> {
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const b = await res.json();
  if (!res.ok) throw new Error(`login ${email}: ${JSON.stringify(b)}`);
  return {
    accessToken: b.access_token,
    refreshToken: b.refresh_token,
    expiresAt: Date.now() + b.expires_in * 1000,
    userId: b.user.id,
    email,
  };
}

interface Device {
  repo: Repo;
  sync: ReturnType<typeof createSync>;
  userId: string;
  email: string;
}

async function device(email: string): Promise<Device> {
  const repo = createRepo(`shared-sb-${crypto.randomUUID()}`);
  const storage = memStorage();
  const session = await signIn(email);
  storage.setItem('lista.session', JSON.stringify(session));
  const sync = createSync(repo, CFG, { fetch: globalThis.fetch, storage, origin: ORIGIN });
  return { repo, sync, userId: session.userId, email };
}

/** Otro dispositivo de la misma cuenta, ya enlazado: copia la DK (lo que hace el enlace entre dispositivos). */
async function linkedDevice(from: Device): Promise<Device> {
  const d = await device(from.email);
  const key = `dk:${from.userId}`;
  await d.repo.setMeta(key, await from.repo.getMeta(key));
  return d;
}

function line(title: string, extra: Partial<ParsedLine> = {}): ParsedLine {
  return {
    title, topics: [], people: [], due: null, period: null, priority: null, recurrence: null,
    isSubtask: false, tokens: [], list: null, ...extra,
  };
}

async function titles(d: Device, listId?: string): Promise<string[]> {
  const ts = await d.repo.listTasks();
  return ts
    .filter((t) => listId === undefined || (t.listId ?? MAIN_LIST) === listId)
    .map((t) => t.title)
    .sort();
}

async function listNamed(d: Device, name: string): Promise<TodoList | undefined> {
  return (await d.repo.listLists()).find((l) => l.name === name);
}

async function syncAll(...ds: Device[]): Promise<void> {
  for (const d of ds) {
    await d.sync.syncNow();
    const st = d.sync.getState();
    expect(st.status, `${d.email}: ${JSON.stringify(st)}`).toBe('idle');
  }
}

async function membersOf(listId: string): Promise<Array<{ userId: string; role: string }>> {
  const rows = await admin(`/rest/v1/list_members?list_id=eq.${listId}&select=user_id,role&order=joined_at,user_id`);
  return rows.map((r: any) => ({ userId: r.user_id, role: r.role }));
}

async function serverText(): Promise<string> {
  const parts = await Promise.all(
    ['items', 'lists', 'list_members', 'list_items', 'list_invites'].map((t) => admin(`/rest/v1/${t}?select=*`)),
  );
  return JSON.stringify(parts);
}

async function setup() {
  const [anaEmail, beaEmail] = [await addUser('Ana'), await addUser('Bea')];
  const ana = await device(anaEmail);
  const bea = await device(beaEmail);
  await syncAll(ana, bea); // activa el cifrado de las dos cuentas

  const compra = await ana.repo.createList('Compra');
  await ana.repo.addParsed(
    [line('Leche entera', { topics: ['super'] }), line('Desnatada', { isSubtask: true }), line('Pan de pueblo')],
    null,
    compra.id,
  );
  const pan = (await ana.repo.listTasks()).find((t) => t.title === 'Pan de pueblo')!;
  await ana.repo.toggleDone(pan.id);
  await ana.repo.addParsed([line('Secreto personal')]);
  await syncAll(ana);
  return { ana, bea, compra };
}

async function shared() {
  const ctx = await setup();
  const { link } = await ctx.ana.sync.shareList(ctx.compra.id);
  await ctx.bea.sync.joinList(link);
  return { ...ctx, link };
}

const ALL = ['Desnatada', 'Leche entera', 'Pan de pueblo'];

describe.skipIf(!URL_ || !ANON || !SERVICE)('listas compartidas contra Supabase real', () => {
  it('compartir y unirse: Bea ve tareas, subtareas, hechas y temas; nada en claro en el servidor', async () => {
    const { ana, bea, compra } = await shared();
    expect(await membersOf(compra.id)).toEqual([
      { userId: ana.userId, role: 'owner' },
      { userId: bea.userId, role: 'member' },
    ]);
    const tasks = await bea.repo.listTasks();
    const leche = tasks.find((t) => t.title === 'Leche entera')!;
    expect(tasks.find((t) => t.title === 'Desnatada')!.parentId).toBe(leche.id);
    expect(tasks.find((t) => t.title === 'Pan de pueblo')!.done).toBe(1);
    expect((await bea.repo.listTopics()).map((e) => e.key)).toContain('super');
    expect(await titles(bea)).not.toContain('Secreto personal');
    expect(await titles(ana, compra.id)).toEqual(ALL);

    await bea.repo.addParsed([line('Huevos camperos')], null, compra.id);
    await syncAll(bea, ana);
    const text = await serverText();
    for (const secret of ['Leche entera', 'Pan de pueblo', 'Huevos camperos', 'Secreto personal', 'Compra', 'super']) {
      expect(text.includes(secret), secret).toBe(false);
    }
  });

  it('un enlace sirve una sola vez', async () => {
    const { compra, link } = await shared();
    const carl = await device(await addUser('Carl'));
    await syncAll(carl);
    const err = await carl.sync.joinList(link).catch((e) => e);
    expect(err).toBeInstanceOf(InviteRejectedError);
    expect((err as InviteRejectedError).code).toBe('invite_used');
    expect(await titles(carl, compra.id)).toEqual([]);
  });

  it('segundos dispositivos: el de Ana no duplica y el de Bea recibe la lista', async () => {
    const { ana, bea, compra } = await setup();
    const ana2 = await linkedDevice(ana);
    await syncAll(ana2);
    const { link } = await ana.sync.shareList(compra.id);
    await bea.sync.joinList(link);
    const bea2 = await linkedDevice(bea);
    await syncAll(ana2, bea2);
    expect(await titles(ana2, compra.id)).toEqual(ALL);
    expect(await titles(bea2, compra.id)).toEqual(ALL);
    await ana2.repo.addParsed([line('Café')], null, compra.id);
    await bea2.repo.addParsed([line('Yogures')], null, compra.id);
    await syncAll(ana2, bea2, ana, bea, ana2);
    for (const d of [ana, ana2, bea, bea2]) expect(await titles(d, compra.id)).toEqual([...ALL, 'Café', 'Yogures'].sort());
  });

  it('cambios entre miembros: añadir, completar, borrar, renombrar y mover', async () => {
    const { ana, bea, compra } = await shared();
    await bea.repo.addParsed([line('Huevos camperos')], null, compra.id);
    await syncAll(bea, ana);
    expect(await titles(ana, compra.id)).toContain('Huevos camperos');

    const leche = (await ana.repo.listTasks()).find((t) => t.title === 'Leche entera')!;
    await ana.repo.toggleDone(leche.id);
    const huevos = (await ana.repo.listTasks()).find((t) => t.title === 'Huevos camperos')!;
    await ana.repo.deleteTask(huevos.id);
    await syncAll(ana, bea);
    const beaTasks = await bea.repo.listTasks();
    expect(beaTasks.find((t) => t.title === 'Leche entera')!.done).toBe(1);
    expect(beaTasks.some((t) => t.title === 'Huevos camperos')).toBe(false);

    await bea.repo.renameList(compra.id, 'Súper');
    await syncAll(bea, ana);
    expect((await ana.repo.listLists()).find((l) => l.id === compra.id)?.name).toBe('Súper');

    const pan = (await ana.repo.listTasks()).find((t) => t.title === 'Pan de pueblo')!;
    await ana.repo.moveToList(pan.id, MAIN_LIST);
    const secreto = (await ana.repo.listTasks()).find((t) => t.title === 'Secreto personal')!;
    await ana.repo.moveToList(secreto.id, compra.id);
    await syncAll(ana, bea);
    expect(await titles(bea, compra.id)).toEqual(['Desnatada', 'Leche entera', 'Secreto personal']);
    expect(await titles(ana)).toEqual(['Desnatada', 'Leche entera', 'Pan de pueblo', 'Secreto personal']);
  });

  it('miembros con nombre y email; Bea no puede quitar a Ana ni borrar para todos', async () => {
    const { ana, bea, compra } = await shared();
    const members = await ana.sync.listMembers(compra.id);
    expect(members.map((m) => [m.email, m.name, m.role])).toEqual([
      [ana.email, 'Ana', 'owner'],
      [bea.email, 'Bea', 'member'],
    ]);
    await expect(bea.sync.removeMember(compra.id, ana.userId)).rejects.toThrow();
    await expect(bea.sync.deleteSharedList(compra.id)).rejects.toThrow();
    expect(await membersOf(compra.id)).toHaveLength(2);
  });

  it('Ana invita a Carl y lo quita; Bea sale; la lista sigue para Ana', async () => {
    const { ana, bea, compra } = await shared();
    const carl = await device(await addUser('Carl'));
    await syncAll(carl);
    const { link } = await ana.sync.createInvite(compra.id);
    await carl.sync.joinList(link);
    expect(await titles(carl, compra.id)).toEqual(ALL);

    await ana.sync.removeMember(compra.id, carl.userId);
    await syncAll(carl);
    expect(await listNamed(carl, 'Compra')).toBeUndefined();
    expect(await titles(carl, compra.id)).toEqual([]);
    expect(await carl.sync.takeLostLists()).toEqual(['Compra']);

    await bea.sync.leaveList(compra.id);
    expect(await listNamed(bea, 'Compra')).toBeUndefined();
    await syncAll(ana);
    expect(await titles(ana, compra.id)).toEqual(ALL);
    expect(await membersOf(compra.id)).toEqual([{ userId: ana.userId, role: 'owner' }]);
  });

  it('Ana borra la lista para todos: desaparece en todos los dispositivos y en el servidor', async () => {
    const { ana, bea, compra } = await shared();
    const ana2 = await linkedDevice(ana);
    await syncAll(ana2);
    await ana.sync.deleteSharedList(compra.id);
    await syncAll(bea, ana2);
    for (const d of [ana, ana2, bea]) {
      expect(await listNamed(d, 'Compra')).toBeUndefined();
      expect(await titles(d, compra.id)).toEqual([]);
    }
    expect(await admin(`/rest/v1/lists?id=eq.${compra.id}&select=id`)).toEqual([]);
    expect(await admin(`/rest/v1/list_items?list_id=eq.${compra.id}&select=id`)).toEqual([]);
    expect(await titles(ana2)).toContain('Secreto personal');
  });

  it('si Ana sale o borra su cuenta, la lista pasa a Bea con todo', async () => {
    const { ana, bea, compra } = await shared();
    await ana.sync.leaveList(compra.id);
    expect(await membersOf(compra.id)).toEqual([{ userId: bea.userId, role: 'owner' }]);
    await syncAll(bea);
    expect(await titles(bea, compra.id)).toEqual(ALL);
    expect((await bea.sync.memberships()).find((m) => m.list_id === compra.id)?.role).toBe('owner');

    // Bea invita a Carl y luego borra su cuenta: Carl hereda la lista.
    const carl = await device(await addUser('Carl'));
    await syncAll(carl);
    const { link } = await bea.sync.createInvite(compra.id);
    await carl.sync.joinList(link);
    expect(await bea.sync.deleteAccount()).toEqual({ remote: 'account' });
    expect(await membersOf(compra.id)).toEqual([{ userId: carl.userId, role: 'owner' }]);
    await syncAll(carl);
    expect(await titles(carl, compra.id)).toEqual(ALL);
  });
});
