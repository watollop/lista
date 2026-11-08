// Listas compartidas de punta a punta (docs/plan-listas.md §4.4 y §4.5): varios usuarios y dispositivos reales
// (repo + sync) contra un Supabase falso con la misma semántica que la migración.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { ParsedLine, Repo, TodoList } from '../types';
import { MAIN_LIST } from '../types';
import { createRepo } from '../data/repo';
import { createSync } from './index';
import { FAKE_CFG, FakeSupabase } from './fakeSupabase';
import { InviteRejectedError, SharingUnavailableError, createSharedList } from './listapi';
import { PENDING_SHARE_KEY } from './shared';
import { exportLk, generateLk } from './listcrypto';

const BASE_TS = Date.parse('2026-11-08T10:00:00Z');
const ORIGIN = 'https://lista.test';

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
  userId: string;
}

function device(server: FakeSupabase, email: string): Device {
  const repo = createRepo(`shared-test-${crypto.randomUUID()}`);
  const storage = memStorage();
  const session = server.session(email, BASE_TS);
  storage.setItem('lista.session', JSON.stringify(session));
  const sync = createSync(repo, FAKE_CFG, {
    fetch: server.fetch,
    storage,
    now: () => server.now,
    origin: ORIGIN,
  });
  return { repo, sync, userId: session.userId };
}

/** Otro dispositivo de la misma cuenta, ya enlazado: copia la DK (lo que hace el enlace entre dispositivos). */
async function linkedDevice(server: FakeSupabase, email: string, from: Device): Promise<Device> {
  const d = device(server, email);
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
  for (const d of ds) await d.sync.syncNow();
}

function expectSynced(d: Device): void {
  const st = d.sync.getState();
  expect(st.status, JSON.stringify(st)).toBe('idle');
}

/** Ana con una lista «Compra» (leche con tema, pan hecho, subtarea) y una tarea personal; Bea con su cuenta. */
async function setup() {
  const server = new FakeSupabase(BASE_TS);
  server.addUser('ana@test.io', 'Ana');
  server.addUser('bea@test.io', 'Bea');
  server.addUser('carl@test.io', 'Carl');
  const ana = device(server, 'ana@test.io');
  const bea = device(server, 'bea@test.io');
  await syncAll(ana, bea); // activa el cifrado de las dos cuentas

  const compra = await ana.repo.createList('Compra');
  const [leche, , pan] = await ana.repo.addParsed(
    [line('Leche entera', { topics: ['super'] }), line('Desnatada', { isSubtask: true }), line('Pan de pueblo')],
    null,
    compra.id,
  );
  await ana.repo.toggleDone(pan.id);
  await ana.repo.addParsed([line('Secreto personal')]);
  await ana.sync.syncNow();
  return { server, ana, bea, compra, leche };
}

describe('listas compartidas: compartir y unirse', () => {
  it('Bea se une con el enlace y ve la lista, sus tareas (también las hechas), subtareas y temas', async () => {
    const { server, ana, bea, compra } = await setup();

    const { link } = await ana.sync.shareList(compra.id);
    expect(link.startsWith(`${ORIGIN}/#unirse=`)).toBe(true);
    expectSynced(ana);
    expect(server.membersOf(compra.id)).toEqual([{ userId: ana.userId, role: 'owner' }]);

    const joined = await bea.sync.joinList(link);
    expect(joined).toEqual({ listId: compra.id, name: 'Compra' });
    expectSynced(bea);

    const list = await listNamed(bea, 'Compra');
    expect(list?.shared?.lk).toBeTruthy();
    expect(await titles(bea, compra.id)).toEqual(['Desnatada', 'Leche entera', 'Pan de pueblo']);
    const tasks = await bea.repo.listTasks();
    const leche = tasks.find((t) => t.title === 'Leche entera')!;
    expect(tasks.find((t) => t.title === 'Desnatada')!.parentId).toBe(leche.id);
    expect(tasks.find((t) => t.title === 'Pan de pueblo')!.done).toBe(1);
    expect((await bea.repo.listTopics()).map((e) => e.key)).toContain('super');

    // Lo personal de Ana no llega nunca a Bea.
    expect(await titles(bea)).not.toContain('Secreto personal');
    // Ana sigue viendo sus tareas una sola vez (copias con id nuevo, originales borrados).
    expect(await titles(ana, compra.id)).toEqual(['Desnatada', 'Leche entera', 'Pan de pueblo']);
  });

  it('el servidor no ve ningún título, nombre de lista ni tema en claro', async () => {
    const { server, ana, bea, compra } = await setup();
    const { link } = await ana.sync.shareList(compra.id);
    await bea.sync.joinList(link);
    await bea.repo.addParsed([line('Huevos camperos')], null, compra.id);
    await syncAll(bea, ana);
    const text = server.serverText();
    for (const secret of ['Leche entera', 'Pan de pueblo', 'Huevos camperos', 'Secreto personal', 'Compra', 'super']) {
      expect(text.includes(secret), secret).toBe(false);
    }
  });

  it('un enlace sirve una sola vez', async () => {
    const { server, ana, bea, compra } = await setup();
    const carl = device(server, 'carl@test.io');
    await carl.sync.syncNow();
    const { link } = await ana.sync.shareList(compra.id);
    await bea.sync.joinList(link);
    const err = await carl.sync.joinList(link).catch((e) => e);
    expect(err).toBeInstanceOf(InviteRejectedError);
    expect((err as InviteRejectedError).code).toBe('invite_used');
    expect(await listNamed(carl, 'Compra')).toBeUndefined();
  });

  it('un enlace mal formado se rechaza sin llamar al servidor', async () => {
    const { bea } = await setup();
    await expect(bea.sync.joinList('https://lista.test/#unirse=nada')).rejects.toThrow(/no es válido|isn’t valid/);
  });
});

describe('listas compartidas: varios dispositivos y casos raros', () => {
  it('el otro dispositivo de Ana, que ya tenía las tareas, acaba con una sola copia de cada una', async () => {
    const { server, ana, bea, compra } = await setup();
    const ana2 = await linkedDevice(server, 'ana@test.io', ana);
    await ana2.sync.syncNow();
    expect(await titles(ana2, compra.id)).toEqual(['Desnatada', 'Leche entera', 'Pan de pueblo']);

    const { link } = await ana.sync.shareList(compra.id);
    await bea.sync.joinList(link);
    await ana2.sync.syncNow();
    expectSynced(ana2);
    expect(await titles(ana2, compra.id)).toEqual(['Desnatada', 'Leche entera', 'Pan de pueblo']);
    expect((await listNamed(ana2, 'Compra'))?.shared?.lk).toBeTruthy();
    // Y lo que añade ahora desde ese dispositivo llega a Bea.
    await ana2.repo.addParsed([line('Café')], null, compra.id);
    await syncAll(ana2, bea);
    expect(await titles(bea, compra.id)).toContain('Café');
  });

  it('el segundo dispositivo de Bea recibe la lista a la que se unió en el primero', async () => {
    const { server, ana, bea, compra } = await setup();
    const { link } = await ana.sync.shareList(compra.id);
    await bea.sync.joinList(link);
    const bea2 = await linkedDevice(server, 'bea@test.io', bea);
    await bea2.sync.syncNow();
    expectSynced(bea2);
    expect(await titles(bea2, compra.id)).toEqual(['Desnatada', 'Leche entera', 'Pan de pueblo']);
    await bea2.repo.addParsed([line('Yogures')], null, compra.id);
    await syncAll(bea2, ana);
    expect(await titles(ana, compra.id)).toContain('Yogures');
  });

  it('Bea puede unirse aunque ya tenga una lista propia con el mismo nombre', async () => {
    const { ana, bea, compra } = await setup();
    const suya = await bea.repo.createList('Compra');
    await bea.repo.addParsed([line('Mía')], null, suya.id);
    const { link } = await ana.sync.shareList(compra.id);
    await bea.sync.joinList(link);
    const names = (await bea.repo.listLists()).filter((l) => l.name === 'Compra');
    expect(names).toHaveLength(2);
    expect(await titles(bea, suya.id)).toEqual(['Mía']);
    expect(await titles(bea, compra.id)).toEqual(['Desnatada', 'Leche entera', 'Pan de pueblo']);
  });

  it('un «compartir» que se cortó tras crear la lista en el servidor se termina en el siguiente sync', async () => {
    const { server, ana, bea, compra } = await setup();
    const lk = await exportLk(await generateLk());
    await ana.repo.setMeta(PENDING_SHARE_KEY, { listId: compra.id, lk });
    const session = server.session('ana@test.io', BASE_TS);
    await createSharedList(FAKE_CFG, session, compra.id, server.fetch); // y aquí se cerró la app
    await ana.sync.syncNow();
    expectSynced(ana);
    expect((await listNamed(ana, 'Compra'))?.shared?.lk).toBe(lk);
    expect(await ana.repo.getMeta(PENDING_SHARE_KEY)).toBeNull();
    // Ya se puede invitar.
    const { link } = await ana.sync.createInvite(compra.id);
    await bea.sync.joinList(link);
    expect(await titles(bea, compra.id)).toEqual(['Desnatada', 'Leche entera', 'Pan de pueblo']);
  });
});

describe('listas compartidas: cambios entre miembros', () => {
  async function shared() {
    const ctx = await setup();
    const { link } = await ctx.ana.sync.shareList(ctx.compra.id);
    await ctx.bea.sync.joinList(link);
    return ctx;
  }

  it('lo que añade, completa o borra uno lo ve el otro', async () => {
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
  });

  it('renombrar la lista llega a todos y no retrocede', async () => {
    const { server, ana, bea, compra } = await shared();
    const ana2 = await linkedDevice(server, 'ana@test.io', ana);
    await ana2.sync.syncNow();
    expect((await ana2.repo.listLists()).find((l) => l.id === compra.id)?.name).toBe('Compra');

    await bea.repo.renameList(compra.id, 'Súper');
    await syncAll(bea, ana, ana2, ana, ana2);
    for (const d of [ana, ana2, bea]) {
      expect((await d.repo.listLists()).find((l) => l.id === compra.id)?.name).toBe('Súper');
    }
  });

  it('el otro dispositivo de Ana recibe la lista compartida sin duplicados', async () => {
    const { server, ana, bea, compra } = await shared();
    const ana2 = await linkedDevice(server, 'ana@test.io', ana);
    await ana2.sync.syncNow();
    expectSynced(ana2);
    expect(await titles(ana2, compra.id)).toEqual(['Desnatada', 'Leche entera', 'Pan de pueblo']);
    await ana2.repo.addParsed([line('Fruta')], null, compra.id);
    await syncAll(ana2, bea);
    expect(await titles(bea, compra.id)).toContain('Fruta');
  });

  it('mover una tarea a Personal la quita para Bea y no la duplica en ningún dispositivo de Ana', async () => {
    const { server, ana, bea, compra } = await shared();
    const ana2 = await linkedDevice(server, 'ana@test.io', ana);
    await ana2.sync.syncNow();

    const pan = (await ana.repo.listTasks()).find((t) => t.title === 'Pan de pueblo')!;
    await ana.repo.moveToList(pan.id, MAIN_LIST);
    await syncAll(ana, bea, ana2);

    expect(await titles(bea, compra.id)).toEqual(['Desnatada', 'Leche entera']);
    for (const d of [ana, ana2]) {
      expect((await titles(d)).filter((t) => t === 'Pan de pueblo')).toHaveLength(1);
      expect(await titles(d, MAIN_LIST)).toContain('Pan de pueblo');
    }
  });

  it('mover una tarea personal a la lista compartida la lleva a Bea', async () => {
    const { ana, bea, compra } = await shared();
    const secreto = (await ana.repo.listTasks()).find((t) => t.title === 'Secreto personal')!;
    await ana.repo.moveToList(secreto.id, compra.id);
    await syncAll(ana, bea);
    expect(await titles(bea, compra.id)).toContain('Secreto personal');
    expect((await titles(ana)).filter((t) => t === 'Secreto personal')).toHaveLength(1);
  });
});

describe('listas compartidas: salir, quitar y borrar', () => {
  async function shared() {
    const ctx = await setup();
    const { link } = await ctx.ana.sync.shareList(ctx.compra.id);
    await ctx.bea.sync.joinList(link);
    return ctx;
  }

  it('Bea sale: la lista desaparece de su dispositivo y sigue para Ana', async () => {
    const { server, ana, bea, compra } = await shared();
    await bea.sync.leaveList(compra.id);
    expect(await listNamed(bea, 'Compra')).toBeUndefined();
    expect(await titles(bea, compra.id)).toEqual([]);
    await ana.sync.syncNow();
    expect(await titles(ana, compra.id)).toEqual(['Desnatada', 'Leche entera', 'Pan de pueblo']);
    expect(server.membersOf(compra.id)).toEqual([{ userId: ana.userId, role: 'owner' }]);
  });

  it('Ana quita a Bea: en su siguiente sync Bea pierde la lista y se le avisa', async () => {
    const { ana, bea, compra } = await shared();
    await ana.sync.removeMember(compra.id, bea.userId);
    await bea.sync.syncNow();
    expectSynced(bea);
    expect(await listNamed(bea, 'Compra')).toBeUndefined();
    expect(await titles(bea, compra.id)).toEqual([]);
    expect(await bea.sync.takeLostLists()).toEqual(['Compra']);
    expect(await bea.sync.takeLostLists()).toEqual([]);
    // Ana conserva todo.
    await ana.sync.syncNow();
    expect(await titles(ana, compra.id)).toHaveLength(3);
  });

  it('Bea no puede quitar a Ana ni borrar la lista para todos', async () => {
    const { ana, bea, compra } = await shared();
    await expect(bea.sync.removeMember(compra.id, ana.userId)).rejects.toThrow();
    await expect(bea.sync.deleteSharedList(compra.id)).rejects.toThrow();
    expect(await listNamed(bea, 'Compra')).toBeDefined();
  });

  it('Ana borra la lista para todos: desaparece en todos los dispositivos', async () => {
    const { server, ana, bea, compra } = await shared();
    const ana2 = await linkedDevice(server, 'ana@test.io', ana);
    await ana2.sync.syncNow();
    await ana.sync.deleteSharedList(compra.id);
    await syncAll(bea, ana2);
    for (const d of [ana, ana2, bea]) {
      expect(await listNamed(d, 'Compra')).toBeUndefined();
      expect(await titles(d, compra.id)).toEqual([]);
    }
    expect(server.hasList(compra.id)).toBe(false);
    // Lo personal de Ana sigue ahí.
    expect(await titles(ana2)).toContain('Secreto personal');
  });

  it('si Ana sale, la lista pasa a Bea con todo', async () => {
    const { server, ana, bea, compra } = await shared();
    await ana.sync.leaveList(compra.id);
    expect(server.membersOf(compra.id)).toEqual([{ userId: bea.userId, role: 'owner' }]);
    await bea.sync.syncNow();
    expect(await titles(bea, compra.id)).toEqual(['Desnatada', 'Leche entera', 'Pan de pueblo']);
    expect((await bea.sync.memberships()).find((m) => m.list_id === compra.id)?.role).toBe('owner');
  });

  it('los miembros se ven con su nombre y email', async () => {
    const { ana, compra } = await shared();
    const members = await ana.sync.listMembers(compra.id);
    expect(members.map((m) => [m.email, m.name, m.role])).toEqual([
      ['ana@test.io', 'Ana', 'owner'],
      ['bea@test.io', 'Bea', 'member'],
    ]);
  });
});

describe('listas compartidas: servidor sin la migración', () => {
  it('lo personal sincroniza igual y compartir avisa', async () => {
    const server = new FakeSupabase(BASE_TS);
    server.sharing = false;
    server.addUser('ana@test.io');
    const ana = device(server, 'ana@test.io');
    await ana.sync.syncNow();
    const compra = await ana.repo.createList('Compra');
    await ana.repo.addParsed([line('Leche')], null, compra.id);
    await ana.sync.syncNow();
    expectSynced(ana);
    expect(server.itemsOf(ana.userId).length).toBeGreaterThan(0);
    await expect(ana.sync.shareList(compra.id)).rejects.toBeInstanceOf(SharingUnavailableError);
    // La lista sigue siendo suya, sin compartir y con su tarea.
    expect((await listNamed(ana, 'Compra'))?.shared ?? null).toBeNull();
    expect(await titles(ana, compra.id)).toEqual(['Leche']);
  });
});
