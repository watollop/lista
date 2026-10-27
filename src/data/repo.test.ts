import 'fake-indexeddb/auto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRepo } from './repo';
import type { Backup, ParsedLine, RemoteItem, Task } from '../types';

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

const newRepo = () => createRepo('test-' + crypto.randomUUID());

afterEach(() => {
  vi.useRealTimers();
});

describe('addParsed', () => {
  it('crea entidades y deduplica por clave normalizada', async () => {
    const r = newRepo();
    const [t] = await r.addParsed([line('Comprar pan', { topics: ['Aura', 'aura'], people: ['Ana'] })]);
    expect(t.topics).toEqual(['aura']);
    expect(t.people).toEqual(['ana']);
    await r.addParsed([line('Otra', { topics: ['AURA'] })]);
    const topics = await r.listTopics();
    expect(topics).toHaveLength(1);
    expect(topics[0].name).toBe('Aura');
    expect(topics[0].key).toBe('aura');
  });

  it('resucita una entidad borrada conservando su nombre', async () => {
    const r = newRepo();
    await r.addParsed([line('x', { topics: ['Casa'] })]);
    const b = await r.exportBackup();
    expect(b.topics).toHaveLength(1);
    // borrar la tarea no borra el tema; forzamos borrado de tema vía importación replace vacía
    await r.importBackup({ ...b, topics: [], tasks: [], people: [], filters: [] }, 'replace');
    expect(await r.listTopics()).toHaveLength(0);
    await r.addParsed([line('y', { topics: ['casa'] })]);
    const topics = await r.listTopics();
    expect(topics).toHaveLength(1);
    expect(topics[0].name).toBe('Casa');
  });

  it('subtarea cuelga de la última no-subtarea del lote', async () => {
    const r = newRepo();
    const [a, sub1, b, sub2] = await r.addParsed([
      line('A'),
      line('sub1', { isSubtask: true }),
      line('B'),
      line('sub2', { isSubtask: true }),
    ]);
    expect(a.parentId).toBeNull();
    expect(sub1.parentId).toBe(a.id);
    expect(b.parentId).toBeNull();
    expect(sub2.parentId).toBe(b.id);
  });

  it('subtarea sin padre en el lote usa defaultParentId', async () => {
    const r = newRepo();
    const [parent] = await r.addParsed([line('P')]);
    const [sub] = await r.addParsed([line('s', { isSubtask: true })], parent.id);
    expect(sub.parentId).toBe(parent.id);
  });

  it('defaultParentId que es subtarea usa su padre (un solo nivel)', async () => {
    const r = newRepo();
    const [parent] = await r.addParsed([line('P')]);
    const [sub] = await r.addParsed([line('s', { isSubtask: true })], parent.id);
    const [sub2] = await r.addParsed([line('s2', { isSubtask: true })], sub.id);
    expect(sub2.parentId).toBe(parent.id);
  });

  it('sin padre, una subtarea es tarea normal; líneas vacías se omiten', async () => {
    const r = newRepo();
    const created = await r.addParsed([line('   '), line('solo', { isSubtask: true })]);
    expect(created).toHaveLength(1);
    expect(created[0].parentId).toBeNull();
    expect(await r.listTasks()).toHaveLength(1);
  });

  it('order crece dentro del mismo grupo', async () => {
    const r = newRepo();
    const [a, b] = await r.addParsed([line('a'), line('b')]);
    expect(b.order).toBeGreaterThan(a.order);
  });
});

describe('replaceParsed / updateTask', () => {
  it('reemplaza campos pero conserva parentId, done y order', async () => {
    const r = newRepo();
    const [parent] = await r.addParsed([line('P')]);
    const [t] = await r.addParsed([line('viejo', { isSubtask: true })], parent.id);
    const updated = await r.replaceParsed(t.id, line('nuevo', { topics: ['Foo'], due: '2026-11-01', priority: 2 }));
    expect(updated.title).toBe('nuevo');
    expect(updated.topics).toEqual(['foo']);
    expect(updated.due).toBe('2026-11-01');
    expect(updated.priority).toBe(2);
    expect(updated.parentId).toBe(parent.id);
    expect(updated.order).toBe(t.order);
    expect(updated.dirty).toBe(1);
  });

  it('updateTask lanza si no existe', async () => {
    const r = newRepo();
    await expect(r.updateTask('nope', { title: 'x' })).rejects.toThrow();
  });
});

describe('toggleDone', () => {
  it('completar una recurrente crea la siguiente ocurrencia', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 27, 10));
    const r = newRepo();
    const [t] = await r.addParsed([
      line('regar', { due: '2026-10-20', recurrence: { unit: 'week', every: 1 } }),
    ]);
    const { task, spawned } = await r.toggleDone(t.id);
    expect(task.done).toBe(1);
    expect(task.doneAt).toBe(task.updatedAt);
    expect(task.nextId).toBe(spawned!.id);
    expect(spawned!.due).toBe('2026-11-03');
    expect(spawned!.done).toBe(0);
    expect(spawned!.title).toBe('regar');
    expect(spawned!.recurrence).toEqual({ unit: 'week', every: 1 });
    expect(spawned!.id).not.toBe(t.id);
    expect(await r.listTasks()).toHaveLength(2);
  });

  it('reabrir elimina la ocurrencia generada si no se ha tocado', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 27, 10));
    const r = newRepo();
    const [t] = await r.addParsed([line('diaria', { due: '2026-10-27', recurrence: { unit: 'day', every: 1 } })]);
    await r.toggleDone(t.id);
    const reopened = await r.toggleDone(t.id);
    expect(reopened.spawned).toBeNull();
    expect(reopened.task.done).toBe(0);
    expect(reopened.task.doneAt).toBeNull();
    expect(reopened.task.nextId).toBeNull();
    const tasks = await r.listTasks();
    expect(tasks.map((x) => x.id)).toEqual([t.id]);
  });

  it('reabrir conserva la ocurrencia si fue editada', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 27, 10));
    const r = newRepo();
    const [t] = await r.addParsed([line('diaria', { due: '2026-10-27', recurrence: { unit: 'day', every: 1 } })]);
    const { spawned } = await r.toggleDone(t.id);
    await r.updateTask(spawned!.id, { title: 'editada' });
    await r.toggleDone(t.id);
    const tasks = await r.listTasks();
    expect(tasks.map((x) => x.id)).toContain(spawned!.id);
  });

  it('completar una no recurrente no crea nada', async () => {
    const r = newRepo();
    const [t] = await r.addParsed([line('simple')]);
    const { spawned } = await r.toggleDone(t.id);
    expect(spawned).toBeNull();
  });
});

describe('deleteTask / restoreTask', () => {
  it('borra y restaura tarea con sus subtareas', async () => {
    const r = newRepo();
    const [p, s1, s2] = await r.addParsed([line('P'), line('s1', { isSubtask: true }), line('s2', { isSubtask: true })]);
    await r.deleteTask(p.id);
    expect(await r.listTasks()).toHaveLength(0);
    await r.restoreTask(p.id);
    const ids = (await r.listTasks()).map((t) => t.id).sort();
    expect(ids).toEqual([p.id, s1.id, s2.id].sort());
  });

  it('no restaura subtareas borradas en una operación anterior', async () => {
    const r = newRepo();
    const [p, s1, s2] = await r.addParsed([line('P'), line('s1', { isSubtask: true }), line('s2', { isSubtask: true })]);
    await r.deleteTask(s1.id);
    await r.deleteTask(p.id);
    await r.restoreTask(p.id);
    const ids = (await r.listTasks()).map((t) => t.id).sort();
    expect(ids).toEqual([p.id, s2.id].sort());
    expect(ids).not.toContain(s1.id);
  });
});

describe('moveTask', () => {
  it('mueve antes de un hermano y al final', async () => {
    const r = newRepo();
    const [a, b, c] = await r.addParsed([line('a'), line('b'), line('c')]);
    await r.moveTask(c.id, a.id);
    let titles = (await r.listTasks()).sort((x, y) => x.order - y.order).map((t) => t.title);
    expect(titles).toEqual(['c', 'a', 'b']);
    await r.moveTask(c.id, null);
    titles = (await r.listTasks()).sort((x, y) => x.order - y.order).map((t) => t.title);
    expect(titles).toEqual(['a', 'b', 'c']);
    await r.moveTask(c.id, b.id);
    titles = (await r.listTasks()).sort((x, y) => x.order - y.order).map((t) => t.title);
    expect(titles).toEqual(['a', 'c', 'b']);
  });
});

describe('filters', () => {
  it('guarda, lista por orden y borra', async () => {
    const r = newRepo();
    const f1 = await r.saveFilter('Hoy', { topics: [], people: [], dates: ['today'], priorities: [], status: 'open', text: '' });
    const f2 = await r.saveFilter('Alta', { topics: [], people: [], dates: [], priorities: [1], status: 'open', text: '' });
    expect(f2.order).toBeGreaterThan(f1.order);
    expect((await r.listFilters()).map((f) => f.name)).toEqual(['Hoy', 'Alta']);
    await r.deleteFilter(f1.id);
    expect((await r.listFilters()).map((f) => f.name)).toEqual(['Alta']);
  });
});

describe('pendingChanges / markPushed', () => {
  it('marca subido solo si updatedAt no cambió', async () => {
    const r = newRepo();
    const [t] = await r.addParsed([line('x', { topics: ['k'] })]);
    const pending = await r.pendingChanges();
    expect(pending.map((p) => p.kind).sort()).toEqual(['task', 'topic']);
    const taskItem = pending.find((p) => p.kind === 'task')!;
    expect(taskItem.id).toBe(t.id);
    expect(taskItem.updated_at).toBe(t.updatedAt);
    expect('dirty' in taskItem.data).toBe(false);

    // edición después de leer: debe seguir dirty
    await r.updateTask(t.id, { title: 'editada' });
    await r.markPushed(pending);
    const still = await r.pendingChanges();
    expect(still.find((p) => p.kind === 'task')).toBeDefined();
    expect(still.find((p) => p.kind === 'topic')).toBeUndefined();

    // subir la versión actual la limpia
    await r.markPushed(still);
    expect(await r.pendingChanges()).toHaveLength(0);
  });

  it('markPushed no notifica', async () => {
    const r = newRepo();
    await r.addParsed([line('x')]);
    const cb = vi.fn();
    r.subscribe(cb);
    await r.markPushed(await r.pendingChanges());
    expect(cb).not.toHaveBeenCalled();
  });

  it('los borrados pendientes aparecen como deleted', async () => {
    const r = newRepo();
    const [t] = await r.addParsed([line('x')]);
    await r.markPushed(await r.pendingChanges());
    await r.deleteTask(t.id);
    const pending = await r.pendingChanges();
    expect(pending).toHaveLength(1);
    expect(pending[0].deleted).toBe(true);
  });
});

describe('applyRemote', () => {
  it('LWW: remoto más nuevo sobrescribe, más viejo se ignora', async () => {
    const r = newRepo();
    const [t] = await r.addParsed([line('local')]);
    const newer: RemoteItem = {
      kind: 'task',
      id: t.id,
      data: { ...t, title: 'remoto nuevo' },
      updated_at: t.updatedAt + 1000,
      deleted: false,
    };
    await r.applyRemote([newer]);
    let [got] = await r.listTasks();
    expect(got.title).toBe('remoto nuevo');
    expect(got.updatedAt).toBe(t.updatedAt + 1000);
    expect(got.dirty).toBe(0);

    const older: RemoteItem = { ...newer, data: { ...t, title: 'viejo' }, updated_at: t.updatedAt };
    await r.applyRemote([older]);
    [got] = await r.listTasks();
    expect(got.title).toBe('remoto nuevo');
  });

  it('LWW: edición local más nueva gana y sigue dirty', async () => {
    const r = newRepo();
    const [t] = await r.addParsed([line('local')]);
    await r.updateTask(t.id, { title: 'local nueva' });
    const remote: RemoteItem = { kind: 'task', id: t.id, data: { ...t, title: 'remota' }, updated_at: t.updatedAt, deleted: false };
    await r.applyRemote([remote]);
    const [got] = await r.listTasks();
    expect(got.title).toBe('local nueva');
    expect(got.dirty).toBe(1);
  });

  it('no notifica si nada cambia; sí si escribe', async () => {
    const r = newRepo();
    const [t] = await r.addParsed([line('x')]);
    const cb = vi.fn();
    r.subscribe(cb);
    await r.applyRemote([{ kind: 'task', id: t.id, data: t, updated_at: t.updatedAt, deleted: false }]);
    expect(cb).not.toHaveBeenCalled();
    await r.applyRemote([{ kind: 'task', id: t.id, data: { ...t, title: 'r' }, updated_at: t.updatedAt + 5, deleted: false }]);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('aplica entidades remotas borradas', async () => {
    const r = newRepo();
    await r.applyRemote([
      {
        kind: 'topic',
        id: 'casa',
        data: { key: 'casa', name: 'Casa', updatedAt: 5, deleted: 0 },
        updated_at: 5,
        deleted: true,
      },
    ]);
    expect(await r.listTopics()).toHaveLength(0);
  });
});

describe('export / import', () => {
  it('exporta solo registros vivos y valida la copia', async () => {
    const r = newRepo();
    const [a, b] = await r.addParsed([line('a', { topics: ['t'] }), line('b')]);
    await r.deleteTask(b.id);
    const bk = await r.exportBackup();
    expect(bk.app).toBe('lista');
    expect(bk.version).toBe(1);
    expect(bk.tasks.map((t) => t.id)).toEqual([a.id]);
    await expect(r.importBackup({ ...bk, app: 'otra' as 'lista' }, 'merge')).rejects.toThrow('Copia de seguridad no válida');
  });

  it('merge: solo entra lo más nuevo y queda dirty', async () => {
    const src = newRepo();
    const dst = newRepo();
    const [t] = await src.addParsed([line('origen')]);
    const bk = await src.exportBackup();
    await dst.importBackup(bk, 'merge');
    const [got] = await dst.listTasks();
    expect(got.title).toBe('origen');
    expect(got.dirty).toBe(1);
    expect(got.updatedAt).toBe(t.updatedAt);

    // importar otra vez la misma copia no cambia nada
    const cb = vi.fn();
    dst.subscribe(cb);
    await dst.importBackup(bk, 'merge');
    expect(await dst.listTasks()).toHaveLength(1);
    expect(cb).toHaveBeenCalledTimes(1); // notifica una vez por importación
  });

  it('merge no sobrescribe un registro local más nuevo', async () => {
    const r = newRepo();
    const [t] = await r.addParsed([line('local')]);
    const bk: Backup = { ...(await r.exportBackup()), tasks: [{ ...t, title: 'vieja', updatedAt: t.updatedAt - 1 } as Task] };
    await r.importBackup(bk, 'merge');
    expect((await r.listTasks())[0].title).toBe('local');
  });

  it('replace: borra lo local (tombstones dirty) y carga la copia', async () => {
    const src = newRepo();
    const dst = newRepo();
    await src.addParsed([line('de la copia', { topics: ['x'] })]);
    await dst.addParsed([line('local que desaparece')]);
    await dst.importBackup(await src.exportBackup(), 'replace');
    const tasks = await dst.listTasks();
    expect(tasks.map((t) => t.title)).toEqual(['de la copia']);
    expect(tasks[0].dirty).toBe(1);
    expect((await dst.listTopics()).map((t) => t.key)).toEqual(['x']);
    // los tombstones de la copia anterior quedan pendientes de subir
    const pending = await dst.pendingChanges();
    expect(pending.some((p) => p.deleted && p.kind === 'task')).toBe(true);
  });
});

describe('meta, clearAll, subscribe', () => {
  it('getMeta/setMeta', async () => {
    const r = newRepo();
    expect(await r.getMeta('x')).toBeUndefined();
    await r.setMeta('x', { a: 1 });
    expect(await r.getMeta<{ a: number }>('x')).toEqual({ a: 1 });
  });

  it('clearAll vacía todo y notifica', async () => {
    const r = newRepo();
    await r.addParsed([line('a', { topics: ['t'] })]);
    const cb = vi.fn();
    r.subscribe(cb);
    await r.clearAll();
    expect(await r.listTasks()).toHaveLength(0);
    expect(await r.listTopics()).toHaveLength(0);
    expect(cb).toHaveBeenCalled();
  });

  it('subscribe / unsubscribe', async () => {
    const r = newRepo();
    const cb = vi.fn();
    const off = r.subscribe(cb);
    await r.addParsed([line('a')]);
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    await r.addParsed([line('b')]);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('escrituras en el mismo ms tienen updatedAt estrictamente crecientes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 27, 10));
    const r = newRepo();
    const [t] = await r.addParsed([line('a')]);
    const u1 = (await r.updateTask(t.id, { title: 'b' })).updatedAt;
    const u2 = (await r.updateTask(t.id, { title: 'c' })).updatedAt;
    expect(u1).toBeGreaterThan(t.updatedAt);
    expect(u2).toBeGreaterThan(u1);
  });
});
