import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { createRepo } from './repo';
import { ListaDB } from './db';
import { MAIN_LIST, type ListItem, type ParsedLine, type RemoteItem, type Repo, type Task, type TodoList } from '../types';

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
    list: null,
    ...extra,
  };
}

/** Repo con base de datos nueva; el nombre permite leer los registros crudos (con tombstones). */
function repoNamed(): { name: string; r: Repo } {
  const name = 'test-' + crypto.randomUUID();
  return { name, r: createRepo(name) };
}

async function rawTasks(name: string): Promise<Task[]> {
  const d = new ListaDB(name);
  try {
    return await d.tasks.toArray();
  } finally {
    d.close();
  }
}

async function rawLists(name: string): Promise<TodoList[]> {
  const d = new ListaDB(name);
  try {
    return await d.lists.toArray();
  } finally {
    d.close();
  }
}

/** Crea una lista propia y la marca como compartida (sin tareas). Devuelve su id. */
async function sharedList(r: Repo, name: string, lk = 'LK'): Promise<string> {
  const list = await r.createList(name);
  await r.markShared(list.id, lk);
  return list.id;
}

async function listOf(r: Repo, id: string): Promise<TodoList> {
  return (await r.listLists()).find((l) => l.id === id)!;
}

/** Tarea tal como llega de una lista compartida: sin dirty. */
function taskItem(id: string, title: string, updatedAt: number, extra: Partial<Task> = {}, deleted = false): ListItem {
  const data: Omit<Task, 'dirty'> = {
    id, title, topics: [], people: [], due: null, priority: null, recurrence: null, parentId: null,
    done: 0, doneAt: null, nextId: null, order: 1, createdAt: 1, updatedAt, deleted: deleted ? 1 : 0,
    listId: null, ...extra,
  };
  return { kind: 'task', id, data, updated_at: updatedAt, deleted };
}

describe('mover entre espacios (personal ↔ compartida)', () => {
  it('personal → compartida: copia la familia con ids nuevos y deja tombstones de los originales', async () => {
    const { name, r } = repoNamed();
    const casa = await sharedList(r, 'Casa');
    const [padre, hijo] = await r.addParsed([line('Padre'), line('Hijo', { isSubtask: true })]);
    const { id } = await r.moveToList(padre.id, casa);
    expect(id).not.toBe(padre.id);
    const live = await r.listTasks();
    expect(live).toHaveLength(2);
    const copyPadre = live.find((t) => t.id === id)!;
    expect(copyPadre).toMatchObject({ title: 'Padre', listId: casa, parentId: null, dirty: 1 });
    const copyHijo = live.find((t) => t.title === 'Hijo')!;
    expect(copyHijo).toMatchObject({ listId: casa, parentId: id, dirty: 1 });
    expect(copyHijo.id).not.toBe(hijo.id);
    const raw = await rawTasks(name);
    expect(raw.find((t) => t.id === padre.id)).toMatchObject({ deleted: 1, dirty: 1, listId: null });
    expect(raw.find((t) => t.id === hijo.id)).toMatchObject({ deleted: 1, dirty: 1, listId: null });
  });

  it('compartida → personal: el tombstone del original conserva el listId de origen', async () => {
    const { name, r } = repoNamed();
    const casa = await sharedList(r, 'Casa');
    const [padre, hijo] = await r.addParsed([line('Padre'), line('Hijo', { isSubtask: true })], null, casa);
    const { id } = await r.moveToList(padre.id, MAIN_LIST);
    const live = await r.listTasks();
    expect(live.map((t) => t.listId ?? null)).toEqual([null, null]);
    expect(live.find((t) => t.title === 'Hijo')).toMatchObject({ parentId: id });
    const raw = await rawTasks(name);
    expect(raw.find((t) => t.id === padre.id)).toMatchObject({ deleted: 1, listId: casa, dirty: 1 });
    expect(raw.find((t) => t.id === hijo.id)).toMatchObject({ deleted: 1, listId: casa, dirty: 1 });
  });

  it('no copia las subtareas borradas', async () => {
    const { name, r } = repoNamed();
    const casa = await sharedList(r, 'Casa');
    const [padre, hijo] = await r.addParsed([line('Padre'), line('Hijo', { isSubtask: true }), line('Otra', { isSubtask: true })]);
    await r.deleteTask(hijo.id);
    await r.moveToList(padre.id, casa);
    const inCasa = (await rawTasks(name)).filter((t) => t.listId === casa);
    expect(inCasa.map((t) => t.title).sort()).toEqual(['Otra', 'Padre']);
    expect(inCasa.every((t) => t.deleted === 0)).toBe(true);
    expect((await rawTasks(name)).find((t) => t.id === hijo.id)).toMatchObject({ deleted: 1, listId: null });
  });

  it('remapea nextId dentro de la familia y lo deja en null si apunta fuera', async () => {
    const { r } = repoNamed();
    const casa = await sharedList(r, 'Casa');
    const [padre, hijo] = await r.addParsed([line('Padre'), line('Hijo', { isSubtask: true })]);
    await r.updateTask(padre.id, { nextId: hijo.id });
    await r.updateTask(hijo.id, { nextId: 'fuera' });
    await r.moveToList(padre.id, casa);
    const live = await r.listTasks();
    const copyPadre = live.find((t) => t.title === 'Padre')!;
    const copyHijo = live.find((t) => t.title === 'Hijo')!;
    expect(copyPadre.nextId).toBe(copyHijo.id);
    expect(copyHijo.nextId).toBeNull();
  });

  it('mover a la misma lista no cambia ids ni deja tombstones', async () => {
    const { name, r } = repoNamed();
    const compra = await r.createList('Compra');
    const [padre, hijo] = await r.addParsed([line('Padre'), line('Hijo', { isSubtask: true })]);
    const res = await r.moveToList(padre.id, compra.id);
    expect(res.id).toBe(padre.id);
    const raw = await rawTasks(name);
    expect(raw.map((t) => t.id).sort()).toEqual([padre.id, hijo.id].sort());
    expect(raw.every((t) => t.deleted === 0 && t.listId === compra.id)).toBe(true);
  });

  it('deshacer un cruce entre espacios lleva la familia de vuelta con ids nuevos', async () => {
    const { r } = repoNamed();
    const casa = await sharedList(r, 'Casa');
    const [padre, hijo] = await r.addParsed([line('Padre'), line('Hijo', { isSubtask: true })]);
    const { id, undo } = await r.moveToList(padre.id, casa);
    await undo();
    const live = await r.listTasks();
    expect(live.map((t) => t.title).sort()).toEqual(['Hijo', 'Padre']);
    expect(live.every((t) => (t.listId ?? null) === null)).toBe(true);
    const padreVuelto = live.find((t) => t.title === 'Padre')!;
    expect(padreVuelto.id).not.toBe(padre.id);
    expect(padreVuelto.id).not.toBe(id);
    expect(live.find((t) => t.title === 'Hijo')!.parentId).toBe(padreVuelto.id);
    expect(live.find((t) => t.title === 'Hijo')!.id).not.toBe(hijo.id);
  });

  it('replaceParsed con /lista hacia una compartida aplica la edición a la copia nueva', async () => {
    const { r } = repoNamed();
    const casa = await sharedList(r, 'Casa');
    const [padre, hijo] = await r.addParsed([line('Padre'), line('Hijo', { isSubtask: true })]);
    const edited = await r.replaceParsed(padre.id, line('Padre editado', { list: 'casa' }));
    expect(edited).toMatchObject({ title: 'Padre editado', listId: casa, parentId: null, deleted: 0 });
    expect(edited.id).not.toBe(padre.id);
    const live = await r.listTasks();
    expect(live.find((t) => t.title === 'Hijo')).toMatchObject({ listId: casa, parentId: edited.id });
    expect(live.find((t) => t.id === hijo.id)).toBeUndefined();
  });

  it('replaceParsed sobre una subtarea con /lista compartida devuelve la copia de la subtarea', async () => {
    const { r } = repoNamed();
    const casa = await sharedList(r, 'Casa');
    const [padre, hijo] = await r.addParsed([line('Padre'), line('Hijo', { isSubtask: true })]);
    const edited = await r.replaceParsed(hijo.id, line('Hijo editado', { list: 'casa' }));
    expect(edited).toMatchObject({ title: 'Hijo editado', listId: casa });
    const live = await r.listTasks();
    expect(live.find((t) => t.title === 'Padre')).toMatchObject({ listId: casa, id: expect.any(String) });
    expect(live.find((t) => t.id === edited.id)?.parentId).toBe(live.find((t) => t.title === 'Padre')!.id);
    expect(padre.id).not.toBe(edited.id);
  });
});

describe('reconcileFamilies entre espacios', () => {
  it('una subtarea remota en otro espacio que su principal se desvincula en vez de moverse', async () => {
    const { r } = repoNamed();
    const casa = await sharedList(r, 'Casa');
    const [padre, hijo] = await r.addParsed([line('Padre'), line('Hijo', { isSubtask: true })]);
    await r.markPushed(await r.pendingChanges());
    const { dirty: _d, ...cdata } = hijo as Task & { dirty?: number };
    const remoto: RemoteItem = {
      kind: 'task', id: hijo.id, data: { ...cdata, listId: casa }, updated_at: hijo.updatedAt + 1000, deleted: false,
    };
    await r.applyRemote([remoto]);
    const sub = (await r.listTasks()).find((t) => t.id === hijo.id)!;
    expect(sub).toMatchObject({ parentId: null, listId: casa });
    expect((await r.listTasks()).find((t) => t.id === padre.id)).toMatchObject({ listId: null });
    expect((await r.pendingChanges()).find((p) => p.kind === 'task' && p.id === hijo.id)?.data)
      .toMatchObject({ parentId: null, listId: casa });
  });
});

describe('compartir una lista existente (markShared)', () => {
  it('copia las tareas vivas (también completadas) y deja originales y tombstones con listId null', async () => {
    const { name, r } = repoNamed();
    const casa = await r.createList('Casa');
    const [a, b] = await r.addParsed([line('A'), line('B', { isSubtask: true })], null, casa.id);
    const [c] = await r.addParsed([line('C')], null, casa.id);
    await r.toggleDone(c.id);
    const [d] = await r.addParsed([line('D')], null, casa.id);
    await r.deleteTask(d.id);
    await r.markPushed(await r.pendingChanges());
    const dAntes = (await rawTasks(name)).find((t) => t.id === d.id)!;

    expect(await r.markShared(casa.id, 'LK1')).toBe(3);

    const live = await r.listTasks();
    expect(live).toHaveLength(3);
    expect(live.every((t) => t.listId === casa.id)).toBe(true);
    const copyA = live.find((t) => t.title === 'A')!;
    expect(copyA).toMatchObject({ listId: casa.id, dirty: 1, parentId: null });
    expect(copyA.id).not.toBe(a.id);
    expect(live.find((t) => t.title === 'B')).toMatchObject({ parentId: copyA.id });
    expect(live.find((t) => t.title === 'C')).toMatchObject({ done: 1 });

    const raw = await rawTasks(name);
    expect(raw.find((t) => t.id === a.id)).toMatchObject({ deleted: 1, listId: null, dirty: 1 });
    expect(raw.find((t) => t.id === b.id)).toMatchObject({ deleted: 1, listId: null, dirty: 1 });
    expect(raw.find((t) => t.id === c.id)).toMatchObject({ deleted: 1, listId: null, dirty: 1 });
    expect(raw.find((t) => t.id === d.id)).toMatchObject({
      deleted: 1, listId: null, dirty: dAntes.dirty, updatedAt: dAntes.updatedAt,
    });
    expect((await listOf(r, casa.id)).shared).toMatchObject({ lk: 'LK1' });
  });

  it('lanza error con la principal, una lista inexistente o ya compartida', async () => {
    const { r } = repoNamed();
    const casa = await r.createList('Casa');
    await expect(r.markShared(MAIN_LIST, 'x')).rejects.toThrow('principal');
    await expect(r.markShared('no-existe', 'x')).rejects.toThrow('Lista no encontrada');
    await r.markShared(casa.id, 'LK1');
    await expect(r.markShared(casa.id, 'LK2')).rejects.toThrow('ya está compartida');
  });
});

describe('renombrar y borrar listas compartidas', () => {
  it('renombrar una compartida sube su nameAt', async () => {
    const { r } = repoNamed();
    const casa = await sharedList(r, 'Casa');
    const antes = (await listOf(r, casa)).shared!.nameAt;
    await r.renameList(casa, 'Hogar');
    const despues = await listOf(r, casa);
    expect(despues.name).toBe('Hogar');
    expect(despues.shared!.nameAt).toBeGreaterThan(antes);
    expect(despues.shared!.lk).toBe('LK');
  });

  it('borrar una compartida lanza error y no toca nada', async () => {
    const { r } = repoNamed();
    const casa = await sharedList(r, 'Casa');
    await r.addParsed([line('t')], null, casa);
    await expect(r.deleteList(casa)).rejects.toThrow('Para dejar una lista compartida, sal de ella.');
    expect((await r.listLists()).map((l) => l.id)).toContain(casa);
    expect(await r.listTasks()).toHaveLength(1);
  });
});

describe('unirse a una lista compartida (joinShared)', () => {
  it('crea la lista con nameAt 0 y dirty; repetir con la misma lista no escribe nada', async () => {
    const { r } = repoNamed();
    const pareja = await r.joinShared('P1', 'LKP', '  Pareja ');
    expect(pareja).toMatchObject({ id: 'P1', name: 'Pareja', shared: { lk: 'LKP', nameAt: 0 }, dirty: 1, deleted: 0 });
    await r.markPushed(await r.pendingChanges());
    const otra = await r.joinShared('P1', 'OTRA_LK', 'Otro');
    expect(otra).toMatchObject({ name: 'Pareja', shared: { lk: 'LKP' }, dirty: 0 });
    expect(await r.pendingChanges()).toEqual([]);
  });

  it('admite un nombre repetido y uno vacío se llama Lista', async () => {
    const { r } = repoNamed();
    await r.createList('Compra');
    await r.joinShared('P2', 'LK', 'Compra');
    await r.joinShared('P3', 'LK', '   ');
    const names = (await r.listLists()).map((l) => l.name);
    expect(names.filter((n) => n === 'Compra')).toHaveLength(2);
    expect(names).toContain('Lista');
  });
});

describe('aplicar registros de una lista compartida (applyShared)', () => {
  it('tareas: LWW, listId forzado, parentId ajeno a null, tombstones y no pisar otro espacio', async () => {
    const { name, r } = repoNamed();
    await r.joinShared('S', 'LK', 'Casa');
    const [mio] = await r.addParsed([line('mio')]);
    await r.markPushed(await r.pendingChanges());

    await r.applyShared('S', [taskItem('t1', 'Uno', 1000)]);
    expect(await r.pendingChanges()).toEqual([]);
    expect((await r.listTasks()).find((t) => t.id === 't1')).toMatchObject({ title: 'Uno', listId: 'S', dirty: 0 });

    await r.applyShared('S', [taskItem('t1', 'Vieja', 500)]);
    expect((await r.listTasks()).find((t) => t.id === 't1')?.title).toBe('Uno');
    await r.applyShared('S', [taskItem('t1', 'Nueva', 2000, { listId: 'otra' })]);
    expect((await r.listTasks()).find((t) => t.id === 't1')).toMatchObject({ title: 'Nueva', listId: 'S' });

    // parentId que no es de esta lista se quita; uno de la misma lista (en la base o en el lote) se conserva
    await r.applyShared('S', [
      taskItem('t2', 'Suelta', 1000, { parentId: 'no-existe' }),
      taskItem('t3', 'Hija', 1000, { parentId: 't1' }),
      taskItem('t4', 'Hija del lote', 1000, { parentId: 't5' }),
      taskItem('t5', 'Padre del lote', 1000),
    ]);
    const byId = Object.fromEntries((await r.listTasks()).map((t) => [t.id, t]));
    expect(byId.t2.parentId).toBeNull();
    expect(byId.t3.parentId).toBe('t1');
    expect(byId.t4.parentId).toBe('t5');

    // nunca pisa una tarea personal con el mismo id
    await r.applyShared('S', [taskItem(mio.id, 'Robada', 9999)]);
    expect((await rawTasks(name)).find((t) => t.id === mio.id)).toMatchObject({ title: 'mio', listId: null });

    // tombstone aplicado
    await r.applyShared('S', [taskItem('t1', 'Uno', 4000, {}, true)]);
    expect((await r.listTasks()).some((t) => t.id === 't1')).toBe(false);
    expect((await rawTasks(name)).find((t) => t.id === 't1')).toMatchObject({ deleted: 1, dirty: 0 });
    expect(await r.pendingChanges()).toEqual([]);
  });

  it('temas y personas: se crean si no hay viva, el nombre local se conserva y los tombstones se ignoran', async () => {
    const { r } = repoNamed();
    await r.joinShared('S', 'LK', 'Casa');
    await r.addParsed([line('x', { people: ['Luis'] })]);
    await r.markPushed(await r.pendingChanges());
    const entity = (kind: 'topic' | 'person', key: string, name: string, deleted = false): ListItem => ({
      kind, id: key, data: { key, name, updatedAt: 1000, deleted: deleted ? 1 : 0 }, updated_at: 1000, deleted,
    });
    await r.applyShared('S', [
      entity('topic', 'hogar', 'Hogar'),
      entity('person', 'ana', 'Ana', true),
      entity('person', 'luis', 'Luis Remoto'),
    ]);
    await r.applyShared('S', [entity('topic', 'hogar', 'Otro nombre')]);
    expect((await r.listTopics()).map((t) => t.name)).toEqual(['Hogar']);
    expect((await r.listPeople()).map((p) => p.name)).toEqual(['Luis']);
    expect(await r.pendingChanges()).toEqual([]);
  });

  it('meta: el nombre cambia solo con una versión mayor que nameAt, sin tocar updatedAt ni dirty', async () => {
    const { r } = repoNamed();
    const joined = await r.joinShared('S', 'LK', 'Casa');
    await r.markPushed(await r.pendingChanges());
    const meta = (name: string, at: number): ListItem => ({
      kind: 'meta', id: 'list', data: { name }, updated_at: at, deleted: false,
    });

    await r.applyShared('S', [meta('Nuevo', 1000)]);
    let l = await listOf(r, 'S');
    expect(l).toMatchObject({ name: 'Nuevo', dirty: 0, updatedAt: joined.updatedAt });
    expect(l.shared).toMatchObject({ nameAt: 1000 });

    await r.applyShared('S', [meta('Viejo', 999)]);
    await r.applyShared('S', [meta('Igual', 1000)]);
    await r.applyShared('S', [meta('   ', 2000)]);
    expect((await listOf(r, 'S')).name).toBe('Nuevo');

    await r.applyShared('S', [meta('Otro', 3000)]);
    l = await listOf(r, 'S');
    expect(l).toMatchObject({ name: 'Otro', dirty: 0, updatedAt: joined.updatedAt });
    expect(await r.pendingChanges()).toEqual([]);
  });
});

describe('salir de una lista compartida (purgeShared)', () => {
  it('borra físicamente sus tareas, deja la lista como tombstone sin LK y quita el cursor', async () => {
    const { name, r } = repoNamed();
    await r.joinShared('S', 'LK', 'Casa');
    await r.addParsed([line('en casa')], null, 'S');
    const [borrada] = await r.addParsed([line('borrada')], null, 'S');
    await r.deleteTask(borrada.id);
    const [mio] = await r.addParsed([line('mio')]);
    await r.setMeta('sync.cursor.list:S', 123);
    await r.markPushed(await r.pendingChanges());

    expect(await r.purgeShared('S')).toBe('Casa');

    const raw = await rawTasks(name);
    expect(raw.some((t) => t.listId === 'S')).toBe(false);
    expect(raw.find((t) => t.id === mio.id)).toMatchObject({ title: 'mio', dirty: 0 });
    expect((await rawLists(name)).find((l) => l.id === 'S')).toMatchObject({
      deleted: 1, dirty: 1, shared: null, name: '',
    });
    expect(await r.getMeta('sync.cursor.list:S')).toBeUndefined();
    expect(await r.pendingChanges()).toEqual([
      expect.objectContaining({ kind: 'list', id: 'S', deleted: true }),
    ]);
    expect(await r.purgeShared('no-existe')).toBeNull();
  });
});

describe('sync de listas del espacio personal (applyRemote)', () => {
  it('el nombre lo gana el nameAt mayor cuando el remoto es compartido', async () => {
    const { r } = repoNamed();
    await r.joinShared('S', 'LK', 'Casa');
    await r.markPushed(await r.pendingChanges());
    const futuro = Date.now() + 1e6;
    await r.applyRemote([{
      kind: 'list', id: 'S',
      data: { id: 'S', name: 'Remota', order: 1, updatedAt: futuro, deleted: 0, shared: { lk: 'LK', nameAt: 50 } },
      updated_at: futuro, deleted: false,
    }]);
    expect(await listOf(r, 'S')).toMatchObject({
      name: 'Remota', shared: { lk: 'LK', nameAt: 50 }, updatedAt: futuro, dirty: 0,
    });
  });

  it('si el nombre local es más nuevo que el remoto, se conserva', async () => {
    const { r } = repoNamed();
    const casa = await sharedList(r, 'Casa');
    await r.renameList(casa, 'Local');
    await r.markPushed(await r.pendingChanges());
    const local = await listOf(r, casa);
    const futuro = Date.now() + 2e6;
    await r.applyRemote([{
      kind: 'list', id: casa,
      data: { id: casa, name: 'Vieja', order: 1, updatedAt: futuro, deleted: 0, shared: { lk: 'LK', nameAt: 0 } },
      updated_at: futuro, deleted: false,
    }]);
    expect(await listOf(r, casa)).toMatchObject({
      name: 'Local', shared: { lk: 'LK', nameAt: local.shared!.nameAt }, updatedAt: futuro, dirty: 0,
    });
  });

  it('un tombstone remoto de una lista que aquí era compartida borra sus tareas en local, sin dirty', async () => {
    const { name, r } = repoNamed();
    await r.joinShared('S', 'LK', 'Casa');
    await r.addParsed([line('en casa')], null, 'S');
    await r.addParsed([line('mio')]);
    await r.setMeta('sync.cursor.list:S', 5);
    await r.markPushed(await r.pendingChanges());
    const futuro = Date.now() + 1e6;
    await r.applyRemote([{
      kind: 'list', id: 'S',
      data: { id: 'S', name: '', order: 1, updatedAt: futuro, deleted: 1, shared: null },
      updated_at: futuro, deleted: true,
    }]);
    expect((await rawTasks(name)).some((t) => t.listId === 'S')).toBe(false);
    expect((await r.listTasks()).map((t) => t.title)).toEqual(['mio']);
    expect(await r.getMeta('sync.cursor.list:S')).toBeUndefined();
    expect(await r.pendingChanges()).toEqual([]);
  });
});
