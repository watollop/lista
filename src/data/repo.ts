import type { Table } from 'dexie';
import type {
  Backup,
  Entity,
  EntityKind,
  Filter,
  ID,
  ListItem,
  ParsedLine,
  RemoteItem,
  Repo,
  SavedFilter,
  Setting,
  SyncKind,
  SyncRec,
  Task,
  TodoList,
} from '../types';
import { MAIN_LIST } from '../types';
import { listKey, normalizeKey } from '../lib/text';
import { nextOccurrence } from '../lib/recurrence';
import { addDays, diffDays, todayISO } from '../lib/date';
import { retagTitle } from '../parser/retag';
import { ListaDB } from './db';
import { tr } from '../i18n';

/** Reloj monotónico: dos escrituras en el mismo ms reciben valores estrictamente crecientes. */
let lastStamp = 0;
function stamp(after = 0): number {
  const now = Math.max(Date.now(), after + 1);
  lastStamp = now <= lastStamp ? lastStamp + 1 : now;
  return lastStamp;
}

const live = <T extends SyncRec>(rows: T[]): T[] => rows.filter((r) => r.deleted === 0);

/** Lista principal por defecto. No tiene registro hasta que se renombra: así no se sincroniza un nombre por defecto. */
function defaultMainList(): TodoList {
  return { id: MAIN_LIST, name: tr('Personal', 'Personal'), order: 0, updatedAt: 0, deleted: 0, dirty: 0 };
}

/** listId tal y como se guarda en una tarea: null para la principal. */
const storedListId = (listId: ID | null | undefined): ID | null => (!listId || listId === MAIN_LIST ? null : listId);

/** Máximo order entre hermanos vivos + 1. */
function nextOrder(rows: Task[], parentId: ID | null): number {
  let max = 0;
  for (const t of rows) if (t.deleted === 0 && t.parentId === parentId && t.order > max) max = t.order;
  return max + 1;
}

/** Crea o resucita las entidades de los nombres dados; devuelve las claves deduplicadas. */
async function ensureEntities(tbl: Table<Entity, string>, names: string[], now: number): Promise<string[]> {
  const keys: string[] = [];
  for (const name of names) {
    const key = normalizeKey(name);
    if (!key) continue;
    if (!keys.includes(key)) keys.push(key);
    const existing = await tbl.get(key);
    if (!existing) {
      await tbl.put({ key, name: name.trim(), updatedAt: now, deleted: 0, dirty: 1 });
    } else if (existing.deleted === 1) {
      await tbl.put({ ...existing, deleted: 0, updatedAt: now, dirty: 1 });
    }
  }
  return keys;
}

/** Campos de una línea parseada que se guardan en la tarea. */
function fieldsFromLine(line: ParsedLine) {
  return {
    title: line.title.trim(),
    due: line.due,
    period: line.due ? line.period ?? null : null,
    priority: line.priority,
    recurrence: line.recurrence,
  };
}

/** Sustituye `key` por `newKey` (sin duplicados, conserva orden); con newKey null la quita. */
function swapKeys(keys: string[], key: string, newKey: string | null): string[] {
  if (newKey === null) return keys.filter((k) => k !== key);
  return [...new Set(keys.map((k) => (k === key ? newKey : k)))];
}

/** Versión nueva de una tarea viva que contiene la clave; null si no la contiene o no cambia. */
function retagTask(
  t: Task,
  kind: EntityKind,
  key: string,
  newKey: string | null,
  to: string | null,
  now: number,
): Task | null {
  if (t.deleted === 1) return null;
  const keys = kind === 'topic' ? t.topics : t.people;
  if (!keys.includes(key)) return null;
  const title = retagTitle(t.title, kind === 'topic' ? '#' : '@', key, to);
  if (newKey === key && title === t.title) return null;
  const nextKeys = swapKeys(keys, key, newKey);
  return kind === 'topic'
    ? { ...t, topics: nextKeys, title, updatedAt: now, dirty: 1 }
    : { ...t, people: nextKeys, title, updatedAt: now, dirty: 1 };
}

/** Versión nueva de un filtro vivo que contiene la clave; null si no la contiene o no cambia. */
function retagFilter(f: SavedFilter, kind: EntityKind, key: string, newKey: string | null, now: number): SavedFilter | null {
  if (f.deleted === 1 || newKey === key) return null;
  const keys = kind === 'topic' ? f.filter.topics : f.filter.people;
  if (!keys.includes(key)) return null;
  const nextKeys = swapKeys(keys, key, newKey);
  const filter: Filter = kind === 'topic' ? { ...f.filter, topics: nextKeys } : { ...f.filter, people: nextKeys };
  return { ...f, filter, updatedAt: now, dirty: 1 };
}

async function markOne<R extends SyncRec>(tbl: Table<R, string>, id: string, updatedAt: number): Promise<void> {
  const rec = await tbl.get(id);
  if (rec && rec.updatedAt === updatedAt && rec.dirty === 1) {
    await tbl.put({ ...rec, dirty: 0 as const });
  }
}

async function applyOne<R extends SyncRec>(tbl: Table<R, string>, item: RemoteItem): Promise<boolean> {
  const local = await tbl.get(item.id);
  if (local && item.updated_at <= local.updatedAt) return false;
  const rec = {
    ...item.data,
    updatedAt: item.updated_at,
    deleted: item.deleted ? 1 : 0,
    dirty: 0,
  } as unknown as R;
  await tbl.put(rec);
  return true;
}

/** Borra los tombstones sincronizados (dirty=0) y anteriores a `cutoff`. Nunca toca los pendientes de subir. */
async function purgeOne<R extends SyncRec>(tbl: Table<R, string>, cutoff: number): Promise<number> {
  const keys = await tbl.where('deleted').equals(1)
    .filter((r) => r.dirty === 0 && r.updatedAt < cutoff)
    .primaryKeys();
  await tbl.bulkDelete(keys);
  return keys.length;
}

/** Resultado de moveFamily. ids: id resultante de cada miembro vivo copiado (solo entre espacios distintos);
 *  prev: listas anteriores de los que cambiaron (mismo espacio); cross: si hubo copia con ids nuevos. */
interface FamilyMove {
  ids: Map<ID, ID>;
  prev: { id: ID; listId: ID | null }[];
  cross: boolean;
  changed: boolean;
}

export function createRepo(dbName = 'lista'): Repo {
  const db = new ListaDB(dbName);
  const subs = new Set<() => void>();
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(`lista-${dbName}`) : null;

  const emit = () => {
    for (const cb of [...subs]) cb();
  };
  const notify = () => {
    emit();
    channel?.postMessage(1);
  };
  if (channel) channel.onmessage = () => emit();

  const allTables = [db.tasks, db.topics, db.people, db.filters, db.settings, db.lists] as const;
  const tableOf = (kind: EntityKind) => (kind === 'topic' ? db.topics : db.people);

  const childrenOf = async (id: ID) => live(await db.tasks.where('parentId').equals(id).toArray());

  async function changeDone(task: Task, done: 0 | 1, now: number, spawnRecurrence = true): Promise<{ task: Task; spawned: Task | null }> {
    if (task.done === done) return { task, spawned: null };
    let spawned: Task | null = null;
    let nextId = task.nextId;
    if (done && task.recurrence && !nextId && spawnRecurrence) {
      const rec = { ...task.recurrence };
      if ((rec.unit === 'month' || rec.unit === 'year') && !rec.monthDay && task.due) rec.monthDay = +task.due.slice(8);
      const due = nextOccurrence(rec, task.due, todayISO());
      spawned = {
        ...task, id: crypto.randomUUID(), due, recurrence: rec, done: 0, doneAt: null, nextId: null,
        order: nextOrder(await db.tasks.toArray(), task.parentId),
        createdAt: now, updatedAt: now, dirty: 1,
      };
      await db.tasks.put(spawned);
      const shift = task.due ? diffDays(task.due, due) : 0;
      const children = await childrenOf(task.id);
      if (children.length) {
        const parentId = spawned.id;
        await db.tasks.bulkPut(children.map((child) => ({
          ...child, id: crypto.randomUUID(), parentId,
          due: child.due && shift ? addDays(child.due, shift) : child.due,
          done: 0 as const, doneAt: null, nextId: null, createdAt: now, updatedAt: now, dirty: 1 as const,
        })));
      }
      nextId = spawned.id;
    } else if (!done && nextId) {
      const next = await db.tasks.get(nextId);
      const children = await db.tasks.where('parentId').equals(nextId).toArray();
      // Solo deshacemos la familia generada si nadie ha editado, añadido o borrado una subtarea.
      if (next && !next.deleted && !next.done && next.updatedAt === next.createdAt &&
        children.every((c) => !c.deleted && !c.done && c.updatedAt === c.createdAt && c.createdAt === next.createdAt)) {
        await db.tasks.bulkPut([next, ...children].map((t) => ({ ...t, deleted: 1 as const, dirty: 1 as const, updatedAt: now })));
      }
      nextId = null;
    }
    const saved: Task = { ...task, done, doneAt: done ? now : null, nextId, updatedAt: now, dirty: 1 };
    await db.tasks.put(saved);
    return { task: saved, spawned };
  }

  async function reconcileParent(id: ID | null, now: number) {
    if (!id) return null;
    const parent = await db.tasks.get(id);
    if (!parent || parent.deleted) return null;
    const children = await childrenOf(id);
    if (!children.length) return null;
    const done = children.every((c) => c.done) ? 1 : 0;
    if (parent.done === done) return null;
    return changeDone(parent, done, now);
  }

  /** Listas vivas: la principal primero (con su nombre por defecto si no tiene registro) y luego por order. */
  async function liveListsSorted(): Promise<TodoList[]> {
    const stored = await db.lists.get(MAIN_LIST);
    const main = stored && stored.deleted === 0 ? stored : defaultMainList();
    const others = live(await db.lists.toArray()).filter((l) => l.id !== MAIN_LIST).sort((a, b) => a.order - b.order);
    return [main, ...others];
  }

  /** Nombre limpio de una lista. Lanza si está vacío o si su clave ya es la de otra lista viva (exceptId se excluye). */
  async function checkListName(raw: string, exceptId: ID): Promise<string> {
    const name = raw.trim();
    const key = listKey(name);
    if (!name || !key) throw new Error(tr('Escribe un nombre para la lista.', 'Write a name for the list.'));
    const other = (await liveListsSorted()).find((l) => l.id !== exceptId && listKey(l.name) === key);
    if (other) throw new Error(tr(`Ya hay una lista «${other.name}».`, `There’s already a list “${other.name}”.`));
    return name;
  }

  /** Espacio de una lista: la propia id si está viva y compartida; 'personal' en cualquier otro caso (también la
   *  principal y null). Una tarea está en el espacio de su lista (docs/plan-listas.md §4.4). */
  async function spaceOfList(listId: ID | null): Promise<ID | 'personal'> {
    if (!listId || listId === MAIN_LIST) return 'personal';
    const list = await db.lists.get(listId);
    return list && list.deleted === 0 && list.shared ? listId : 'personal';
  }

  /** Pone la familia de `top` (la tarea y todas sus subtareas, también las borradas: si se deshace su borrado,
   *  vuelven a la lista de su principal) en la lista `target` (null = principal).
   *  Mismo espacio: solo cambia listId. Espacios distintos: copia las vivas con id nuevo en el destino (parentId y
   *  nextId remapeados dentro de la familia) y deja tombstones de los originales, que conservan su listId para
   *  subir a su espacio de origen. Las subtareas borradas no se copian. */
  async function moveFamily(top: Task, target: ID | null, now: number): Promise<FamilyMove> {
    const family = [top, ...(await db.tasks.where('parentId').equals(top.id).toArray())];
    const from = await spaceOfList(top.listId ?? null);
    const to = await spaceOfList(target);
    if (from === to) {
      const moves = family.filter((t) => (t.listId ?? null) !== target);
      if (!moves.length) return { ids: new Map(), prev: [], cross: false, changed: false };
      await db.tasks.bulkPut(moves.map((t) => ({ ...t, listId: target, updatedAt: now, dirty: 1 as const })));
      return {
        ids: new Map(),
        prev: moves.map((t) => ({ id: t.id, listId: t.listId ?? null })),
        cross: false,
        changed: true,
      };
    }
    const alive = family.filter((t) => t.deleted === 0);
    if (!alive.length) return { ids: new Map(), prev: [], cross: false, changed: false };
    const ids = new Map<ID, ID>(alive.map((t) => [t.id, crypto.randomUUID()] as const));
    const copies: Task[] = alive.map((t) => ({
      ...t,
      id: ids.get(t.id)!,
      listId: target,
      parentId: t.parentId && ids.has(t.parentId) ? ids.get(t.parentId)! : null,
      nextId: t.nextId && ids.has(t.nextId) ? ids.get(t.nextId)! : null,
      updatedAt: now,
      dirty: 1 as const,
    }));
    const originals: Task[] = alive.map((t) => ({ ...t, deleted: 1 as const, updatedAt: now, dirty: 1 as const }));
    await db.tasks.bulkPut([...copies, ...originals]);
    return { ids, prev: [], cross: true, changed: true };
  }

  async function reconcileFamilies(): Promise<void> {
    const rows = await db.tasks.toArray();
    const now = stamp(rows.reduce((max, t) => Math.max(max, t.updatedAt), 0));
    // Una subtarea va siempre en la lista de su principal: un remoto de otro dispositivo puede haberlas separado.
    // Gana la principal (la familia se mueve entera en moveToList). Si la principal está en otro espacio, la
    // subtarea se desvincula en vez de moverla: así una tarea personal nunca acaba en una lista compartida.
    const liveRows = live(rows);
    const tops = new Map(liveRows.filter((t) => t.parentId === null).map((t) => [t.id, t] as const));
    const spaces = new Map<ID | null, ID | 'personal'>();
    const spaceOf = async (listId: ID | null | undefined): Promise<ID | 'personal'> => {
      const key = listId ?? null;
      if (!spaces.has(key)) spaces.set(key, await spaceOfList(key));
      return spaces.get(key)!;
    };
    const misplaced: Task[] = [];
    for (const t of liveRows) {
      const top = t.parentId === null ? undefined : tops.get(t.parentId);
      if (!top) continue;
      if ((await spaceOf(t.listId)) !== (await spaceOf(top.listId))) {
        misplaced.push({ ...t, parentId: null, updatedAt: now, dirty: 1 });
      } else if ((t.listId ?? null) !== (top.listId ?? null)) {
        misplaced.push({ ...t, listId: top.listId ?? null, updatedAt: now, dirty: 1 });
      }
    }
    if (misplaced.length) await db.tasks.bulkPut(misplaced);
    const parents = new Set(liveRows.map((t) => t.parentId).filter((id) => id !== null));
    for (const id of parents) await reconcileParent(id, now);
  }

  /** Sustituye la clave en tareas y filtros vivos que la contienen. Devuelve nº de tareas cambiadas y sus versiones anteriores. */
  async function retagAll(kind: EntityKind, key: string, newKey: string | null, to: string | null, now: number) {
    const oldTasks: Task[] = [];
    const newTasks: Task[] = [];
    for (const t of await db.tasks.toArray()) {
      const next = retagTask(t, kind, key, newKey, to, now);
      if (next) {
        oldTasks.push(t);
        newTasks.push(next);
      }
    }
    const oldFilters: SavedFilter[] = [];
    const newFilters: SavedFilter[] = [];
    for (const f of await db.filters.toArray()) {
      const next = retagFilter(f, kind, key, newKey, now);
      if (next) {
        oldFilters.push(f);
        newFilters.push(next);
      }
    }
    if (newTasks.length) await db.tasks.bulkPut(newTasks);
    if (newFilters.length) await db.filters.bulkPut(newFilters);
    return { tasks: newTasks.length, before: { tasks: oldTasks, filters: oldFilters } };
  }

  const repo: Repo = {
    async listTasks() {
      return db.tasks.where('deleted').equals(0).toArray();
    },

    async listTopics() {
      return (await db.topics.where('deleted').equals(0).toArray()).sort((a, b) => a.name.localeCompare(b.name, 'es'));
    },

    async listPeople() {
      return (await db.people.where('deleted').equals(0).toArray()).sort((a, b) => a.name.localeCompare(b.name, 'es'));
    },

    async listFilters() {
      return (await db.filters.where('deleted').equals(0).toArray()).sort((a, b) => a.order - b.order);
    },

    async addParsed(lines, defaultParentId = null, listId) {
      const created = await db.transaction('rw', allTables, async () => {
        const now = stamp();
        const lists = await liveListsSorted();
        if (listId && !lists.some((l) => l.id === listId)) throw new Error(tr('Lista no encontrada', 'List not found'));
        // Clave de cada lista viva (la principal, con su nombre efectivo) → id
        const idByKey = new Map<string, ID>();
        for (const l of lists) if (!idByKey.has(listKey(l.name))) idByKey.set(listKey(l.name), l.id);
        const rows = await db.tasks.toArray();
        let defaultParent: ID | null = null;
        if (defaultParentId) {
          const p = rows.find((t) => t.id === defaultParentId && t.deleted === 0);
          if (!p) throw new Error(tr('La tarea principal ya no existe.', 'The parent task no longer exists.'));
          defaultParent = p.parentId ?? p.id;
          if (!rows.some((t) => t.id === defaultParent && !t.deleted)) throw new Error(tr('La tarea principal ya no existe.', 'The parent task no longer exists.'));
        }
        const out: Task[] = [];
        let lastTop: ID | null = null;
        for (const line of lines) {
          const fields = fieldsFromLine(line);
          if (!fields.title) continue;
          const parentId: ID | null = line.isSubtask ? (lastTop ?? defaultParent) : null;
          // Lista de una principal: la indicada con /nombre, si no la del lote, si no la principal.
          // Una subtarea va siempre en la lista de su principal.
          const fromLine = line.list ? idByKey.get(line.list) : undefined;
          const taskListId = parentId
            ? (rows.find((t) => t.id === parentId)?.listId ?? null)
            : storedListId(fromLine ?? listId);
          const topics = await ensureEntities(db.topics, line.topics, now);
          const people = await ensureEntities(db.people, line.people, now);
          const task: Task = {
            id: crypto.randomUUID(),
            ...fields,
            topics,
            people,
            parentId,
            listId: taskListId,
            done: 0,
            doneAt: null,
            nextId: null,
            order: nextOrder(rows, parentId),
            createdAt: now,
            updatedAt: now,
            deleted: 0,
            dirty: 1,
          };
          await db.tasks.put(task);
          rows.push(task);
          out.push(task);
          if (!line.isSubtask) lastTop = task.id;
        }
        for (const id of new Set(out.map((t) => t.parentId))) await reconcileParent(id, now);
        return out;
      });
      if (created.length) notify();
      return created;
    },

    async replaceParsed(id, line) {
      const updated = await db.transaction('rw', allTables, async () => {
        const now = stamp();
        const task = await db.tasks.get(id);
        if (!task || task.deleted === 1) throw new Error(tr('Tarea no encontrada', 'Task not found'));
        const fields = fieldsFromLine(line);
        if (!fields.title) throw new Error(tr('El título no puede estar vacío', 'The title can’t be empty'));
        const topics = await ensureEntities(db.topics, line.topics, now);
        const people = await ensureEntities(db.people, line.people, now);
        // Lista escrita con /nombre distinta de la actual: la familia entera se mueve a ella. Sin lista, no cambia.
        // Entre espacios distintos la tarea editada es una copia nueva: se edita esa.
        let targetId = id;
        if (line.list) {
          const target = (await liveListsSorted()).find((l) => listKey(l.name) === line.list);
          const top = task.parentId ? await db.tasks.get(task.parentId) : undefined;
          if (target) {
            const moved = await moveFamily(top && top.deleted === 0 ? top : task, storedListId(target.id), now);
            targetId = moved.ids.get(id) ?? id;
          }
        }
        const current = (await db.tasks.get(targetId)) ?? task;
        const next: Task = { ...current, ...fields, topics, people, updatedAt: now, dirty: 1 };
        await db.tasks.put(next);
        return next;
      });
      notify();
      return updated;
    },

    async updateTask(id, patch) {
      const updated = await db.transaction('rw', db.tasks, async () => {
        const now = stamp();
        const task = await db.tasks.get(id);
        if (!task) throw new Error(tr('Tarea no encontrada', 'Task not found'));
        const next: Task = { ...task, ...patch, id: task.id, updatedAt: now, dirty: 1 };
        await db.tasks.put(next);
        return next;
      });
      notify();
      return updated;
    },

    async toggleDone(id) {
      const result = await db.transaction('rw', db.tasks, async () => {
        const now = stamp();
        const task = await db.tasks.get(id);
        if (!task || task.deleted === 1) throw new Error(tr('Tarea no encontrada', 'Task not found'));
        const children = await childrenOf(id);
        const done = task.done ? 0 : 1;
        const changes: { before: Task; after: Task }[] = [];
        // Cerrar el grupo no debe generar nuevas subtareas pendientes dentro de una tarea completada.
        for (const child of children) {
          const saved = await changeDone(child, done, now, false);
          if (child.done !== saved.task.done) changes.push({ before: child, after: saved.task });
        }
        const result = await changeDone(task, done, now);
        changes.push({ before: task, after: result.task });
        const parentBefore = task.parentId ? await db.tasks.get(task.parentId) : undefined;
        const parent = await reconcileParent(task.parentId, now);
        if (parentBefore && parent) changes.push({ before: parentBefore, after: parent.task });
        const undo = done ? async () => {
          await db.transaction('rw', db.tasks, async () => {
            const now = stamp();
            for (const { before, after } of changes) {
              const current = await db.tasks.get(before.id);
              if (!current || current.deleted || current.done !== after.done ||
                current.doneAt !== after.doneAt || current.nextId !== after.nextId) {
                throw new Error(tr('La tarea ha cambiado; no se puede deshacer esta acción.', 'The task has changed; this can’t be undone.'));
              }
              await changeDone(current, before.done, now, false);
            }
          });
          notify();
        } : null;
        return { ...result, spawned: result.spawned ?? parent?.spawned ?? null, undo };
      });
      notify();
      return result;
    },

    async deleteTask(id) {
      const changed = await db.transaction('rw', db.tasks, async () => {
        const now = stamp();
        const task = await db.tasks.get(id);
        if (!task || task.deleted === 1) return false;
        const kids = live(await db.tasks.where('parentId').equals(id).toArray());
        const toDelete = [task, ...kids].map((t) => ({ ...t, deleted: 1 as const, dirty: 1 as const, updatedAt: now }));
        await db.tasks.bulkPut(toDelete);
        await reconcileParent(task.parentId, now);
        return true;
      });
      if (changed) notify();
    },

    async restoreTask(id) {
      const changed = await db.transaction('rw', db.tasks, async () => {
        const now = stamp();
        const task = await db.tasks.get(id);
        if (!task || task.deleted === 0) return false;
        const kids = (await db.tasks.where('parentId').equals(id).toArray()).filter(
          (t) => t.deleted === 1 && t.updatedAt === task.updatedAt,
        );
        const toRestore = [task, ...kids].map((t) => ({ ...t, deleted: 0 as const, dirty: 1 as const, updatedAt: now }));
        await db.tasks.bulkPut(toRestore);
        await reconcileParent(task.parentId, now);
        await reconcileParent(task.id, now);
        return true;
      });
      if (changed) notify();
    },

    async moveTask(id, beforeId) {
      if (beforeId === id) return;
      await db.transaction('rw', db.tasks, async () => {
        const now = stamp();
        const task = await db.tasks.get(id);
        if (!task || task.deleted === 1) throw new Error(tr('Tarea no encontrada', 'Task not found'));
        const sibs = live(await db.tasks.toArray())
          .filter((t) => t.parentId === task.parentId && t.id !== id)
          .sort((a, b) => a.order - b.order);
        let order: number;
        if (beforeId === null) {
          order = (sibs.length ? Math.max(...sibs.map((s) => s.order)) : 0) + 1;
        } else {
          const idx = sibs.findIndex((s) => s.id === beforeId);
          if (idx < 0) throw new Error('beforeId no es hermano de la tarea');
          const after = sibs[idx].order;
          const before = idx > 0 ? sibs[idx - 1].order : after - 1;
          order = (before + after) / 2;
        }
        await db.tasks.put({ ...task, order, updatedAt: now, dirty: 1 });
      });
      notify();
    },

    async saveFilter(name, filter: Filter) {
      const saved = await db.transaction('rw', db.filters, async () => {
        const now = stamp();
        const rows = live(await db.filters.toArray());
        const max = rows.reduce((m, f) => Math.max(m, f.order), 0);
        const f: SavedFilter = {
          id: crypto.randomUUID(),
          name,
          filter,
          order: max + 1,
          updatedAt: now,
          deleted: 0,
          dirty: 1,
        };
        await db.filters.put(f);
        return f;
      });
      notify();
      return saved;
    },

    async deleteFilter(id) {
      const changed = await db.transaction('rw', db.filters, async () => {
        const now = stamp();
        const f = await db.filters.get(id);
        if (!f || f.deleted === 1) return false;
        await db.filters.put({ ...f, deleted: 1, dirty: 1, updatedAt: now });
        return true;
      });
      if (changed) notify();
    },

    async listLists() {
      return liveListsSorted();
    },

    async createList(name) {
      const created = await db.transaction('rw', db.lists, async () => {
        const now = stamp();
        const clean = await checkListName(name, '');
        const rows = await liveListsSorted();
        const max = rows.reduce((m, l) => Math.max(m, l.order), 0);
        const list: TodoList = { id: crypto.randomUUID(), name: clean, order: max + 1, updatedAt: now, deleted: 0, dirty: 1 };
        await db.lists.put(list);
        return list;
      });
      notify();
      return created;
    },

    async renameList(id, name) {
      const renamed = await db.transaction('rw', db.lists, async () => {
        const now = stamp();
        const current = await db.lists.get(id);
        const base = id === MAIN_LIST ? (current && current.deleted === 0 ? current : defaultMainList()) : current;
        if (!base || base.deleted === 1) throw new Error(tr('Lista no encontrada', 'List not found'));
        const clean = await checkListName(name, id);
        // Una compartida: la versión del nombre sube; el registro meta lo llevará el sync.
        const next: TodoList = {
          ...base, name: clean, updatedAt: now, dirty: 1,
          ...(base.shared ? { shared: { ...base.shared, nameAt: now } } : {}),
        };
        await db.lists.put(next);
        return next;
      });
      notify();
      return renamed;
    },

    async deleteList(id) {
      if (id === MAIN_LIST) throw new Error(tr('La lista principal no se puede borrar.', 'The main list can’t be deleted.'));
      const result = await db.transaction('rw', allTables, async () => {
        const now = stamp();
        const list = await db.lists.get(id);
        if (!list || list.deleted === 1) throw new Error(tr('Lista no encontrada', 'List not found'));
        if (list.shared) throw new Error(tr('Para dejar una lista compartida, sal de ella.', 'To remove a shared list, leave it.'));
        // Solo las vivas: las que ya estaban borradas no entran en esta operación y no se restauran.
        const victims = live(await db.tasks.toArray()).filter((t) => t.listId === id);
        await db.tasks.bulkPut(victims.map((t) => ({ ...t, deleted: 1 as const, dirty: 1 as const, updatedAt: now })));
        await db.lists.put({ ...list, deleted: 1, dirty: 1, updatedAt: now });
        const victimIds = victims.map((t) => t.id);
        const undo = async () => {
          await db.transaction('rw', allTables, async () => {
            const t = stamp();
            await checkListName(list.name, id);
            await db.lists.put({ ...list, deleted: 0, dirty: 1, updatedAt: t });
            for (const taskId of victimIds) {
              const cur = await db.tasks.get(taskId);
              if (cur && cur.deleted === 1) await db.tasks.put({ ...cur, deleted: 0, dirty: 1, updatedAt: t });
            }
          });
          notify();
        };
        return { tasks: victims.filter((t) => !t.parentId).length, undo };
      });
      notify();
      return result;
    },

    async moveToList(id, listId) {
      const result = await db.transaction('rw', allTables, async () => {
        const now = stamp();
        const task = await db.tasks.get(id);
        if (!task || task.deleted === 1) throw new Error(tr('Tarea no encontrada', 'Task not found'));
        if (!(await liveListsSorted()).some((l) => l.id === listId)) throw new Error(tr('Lista no encontrada', 'List not found'));
        const parent = task.parentId ? await db.tasks.get(task.parentId) : undefined;
        const top = parent && parent.deleted === 0 ? parent : task;
        const moved = await moveFamily(top, storedListId(listId), now);
        const topId = moved.ids.get(top.id) ?? top.id;
        if (!moved.changed) return { id: topId, undo: null };
        // Deshacer un cruce entre espacios es otro cruce: la copia vuelve a su lista anterior con ids nuevos.
        const prevList = storedListId(top.listId);
        const undo = async () => {
          await db.transaction('rw', allTables, async () => {
            const t = stamp();
            if (moved.cross) {
              const cur = await db.tasks.get(topId);
              if (cur && cur.deleted === 0) await moveFamily(cur, prevList, t);
            } else {
              for (const p of moved.prev) {
                const cur = await db.tasks.get(p.id);
                if (cur && cur.deleted === 0) await db.tasks.put({ ...cur, listId: p.listId, updatedAt: t, dirty: 1 });
              }
            }
          });
          notify();
        };
        return { id: topId, undo };
      });
      if (!result.undo) return { id: result.id, undo: async () => {} };
      notify();
      return { id: result.id, undo: result.undo };
    },

    async markShared(listId, lk) {
      if (listId === MAIN_LIST) throw new Error(tr('La lista principal no se puede compartir.', 'The main list can’t be shared.'));
      const copied = await db.transaction('rw', allTables, async () => {
        const now = stamp();
        const list = await db.lists.get(listId);
        if (!list || list.deleted === 1) throw new Error(tr('Lista no encontrada', 'List not found'));
        if (list.shared) throw new Error(tr('La lista ya está compartida.', 'The list is already shared.'));
        const mine = (await db.tasks.toArray()).filter((t) => t.listId === listId);
        const alive = mine.filter((t) => t.deleted === 0);
        // Copias vivas con id nuevo (también las completadas); originales a tombstone con listId null (espacio personal).
        const ids = new Map<ID, ID>(alive.map((t) => [t.id, crypto.randomUUID()] as const));
        const copies: Task[] = alive.map((t) => ({
          ...t,
          id: ids.get(t.id)!,
          parentId: t.parentId && ids.has(t.parentId) ? ids.get(t.parentId)! : null,
          nextId: t.nextId && ids.has(t.nextId) ? ids.get(t.nextId)! : null,
          updatedAt: now,
          dirty: 1 as const,
        }));
        const originals: Task[] = alive.map((t) => ({ ...t, listId: null, deleted: 1 as const, updatedAt: now, dirty: 1 as const }));
        // Los tombstones antiguos de la lista pasan al espacio personal sin tocar su versión.
        const tombs: Task[] = mine.filter((t) => t.deleted === 1).map((t) => ({ ...t, listId: null }));
        await db.tasks.bulkPut([...copies, ...originals, ...tombs]);
        await db.lists.put({ ...list, shared: { lk, nameAt: now }, updatedAt: now, dirty: 1 });
        return alive.length;
      });
      notify();
      return copied;
    },

    async joinShared(listId, lk, name) {
      const joined = await db.transaction('rw', db.lists, async () => {
        const now = stamp();
        const current = await db.lists.get(listId);
        if (current && current.deleted === 0 && current.shared) return { list: current, written: false };
        const max = (await liveListsSorted()).reduce((m, l) => Math.max(m, l.order), 0);
        const list: TodoList = {
          id: listId, name: name.trim() || 'Lista', order: max + 1, shared: { lk, nameAt: 0 },
          updatedAt: now, deleted: 0, dirty: 1,
        };
        await db.lists.put(list);
        return { list, written: true };
      });
      if (joined.written) notify();
      return joined.list;
    },

    async applyShared(listId, items) {
      const wrote = await db.transaction('rw', allTables, async () => {
        let any = false;
        let tasks = false;
        const batchTaskIds = new Set(items.filter((it) => it.kind === 'task').map((it) => it.id));
        for (const it of items) {
          let w = false;
          switch (it.kind) {
            case 'task':
              w = await applySharedTask(listId, it, batchTaskIds);
              tasks = tasks || w;
              break;
            case 'topic':
              w = await applySharedEntity('topic', it);
              break;
            case 'person':
              w = await applySharedEntity('person', it);
              break;
            case 'meta':
              w = await applySharedMeta(listId, it);
              break;
          }
          any = any || w;
        }
        if (tasks) await reconcileFamilies();
        return any;
      });
      if (wrote) notify();
    },

    async purgeShared(listId) {
      const previous = await db.transaction('rw', [...allTables, db.meta], async () => {
        const now = stamp();
        const list = await db.lists.get(listId);
        // Borrado físico: un tombstone de cada tarea se propagaría a los demás miembros.
        const victims = (await db.tasks.toArray()).filter((t) => t.listId === listId).map((t) => t.id);
        await db.tasks.bulkDelete(victims);
        await db.meta.delete(`sync.cursor.list:${listId}`);
        if (!list) return null;
        // Tombstone sin LK: mis otros dispositivos también la quitan.
        await db.lists.put({ id: listId, name: '', order: list.order, shared: null, deleted: 1, updatedAt: now, dirty: 1 });
        return list.name;
      });
      notify();
      return previous;
    },

    async renameEntity(kind, key, newName) {
      const name = newName.trim().replace(/^[#@]/, '').trim();
      if (!name) throw new Error(tr('Nombre vacío', 'Empty name'));
      const newKey = normalizeKey(name);
      const result = await db.transaction('rw', allTables, async () => {
        const now = stamp();
        const tbl = tableOf(kind);
        const old = await tbl.get(key);
        if (!old || old.deleted === 1) throw new Error('Entidad no encontrada');
        if (newKey === key) {
          await tbl.put({ ...old, name, updatedAt: now, dirty: 1 });
          const { tasks } = await retagAll(kind, key, key, name, now);
          return { key, merged: false, tasks };
        }
        // fusión: si ya hay una entidad viva con la nueva clave, esa conserva su nombre
        const target = await tbl.get(newKey);
        const merged = target?.deleted === 0;
        const destName = target?.deleted === 0 ? target.name : name;
        if (!merged) await tbl.put({ key: newKey, name, updatedAt: now, deleted: 0, dirty: 1 });
        await tbl.put({ ...old, deleted: 1, updatedAt: now, dirty: 1 });
        const { tasks } = await retagAll(kind, key, newKey, destName, now);
        return { key: newKey, merged, tasks };
      });
      notify();
      return result;
    },

    async deleteEntity(kind, key) {
      const tbl = tableOf(kind);
      const result = await db.transaction('rw', allTables, async () => {
        const now = stamp();
        const old = await tbl.get(key);
        if (!old || old.deleted === 1) throw new Error('Entidad no encontrada');
        await tbl.put({ ...old, deleted: 1, updatedAt: now, dirty: 1 });
        const { tasks, before } = await retagAll(kind, key, null, null, now);
        const undo = async () => {
          await db.transaction('rw', allTables, async () => {
            const t = stamp();
            await tbl.put({ ...old, deleted: 0, updatedAt: t, dirty: 1 });
            await db.tasks.bulkPut(before.tasks.map((x) => ({ ...x, updatedAt: t, dirty: 1 as const })));
            await db.filters.bulkPut(before.filters.map((x) => ({ ...x, updatedAt: t, dirty: 1 as const })));
          });
          notify();
        };
        return { tasks, undo };
      });
      notify();
      return result;
    },

    async wipe() {
      await db.transaction('rw', [...allTables, db.meta], async () => {
        await Promise.all([...allTables, db.meta].map((t) => t.clear()));
      });
      notify();
    },

    async exportBackup(): Promise<Backup> {
      const [tasks, topics, people, filters, lists] = await db.transaction('r', allTables, async () =>
        Promise.all([db.tasks.toArray(), db.topics.toArray(), db.people.toArray(), db.filters.toArray(), db.lists.toArray()]),
      );
      return {
        app: 'lista',
        version: 2,
        exportedAt: Date.now(),
        tasks: live(tasks),
        topics: live(topics),
        people: live(people),
        filters: live(filters),
        lists: live(lists),
      };
    },

    async pendingChanges() {
      const strip = <T extends SyncRec>(r: T): T => {
        const { dirty: _dirty, ...rest } = r;
        return rest as T;
      };
      const [tasks, topics, people, filters, settings, lists] = await Promise.all([
        db.tasks.where('dirty').equals(1).toArray(),
        db.topics.where('dirty').equals(1).toArray(),
        db.people.where('dirty').equals(1).toArray(),
        db.filters.where('dirty').equals(1).toArray(),
        db.settings.where('dirty').equals(1).toArray(),
        db.lists.where('dirty').equals(1).toArray(),
      ]);
      const items: RemoteItem[] = [];
      for (const t of tasks)
        items.push({ kind: 'task', id: t.id, data: strip(t), updated_at: t.updatedAt, deleted: t.deleted === 1 });
      for (const e of topics)
        items.push({ kind: 'topic', id: e.key, data: strip(e), updated_at: e.updatedAt, deleted: e.deleted === 1 });
      for (const e of people)
        items.push({ kind: 'person', id: e.key, data: strip(e), updated_at: e.updatedAt, deleted: e.deleted === 1 });
      for (const f of filters)
        items.push({ kind: 'filter', id: f.id, data: strip(f), updated_at: f.updatedAt, deleted: f.deleted === 1 });
      for (const s of settings)
        items.push({ kind: 'setting', id: s.key, data: strip(s), updated_at: s.updatedAt, deleted: s.deleted === 1 });
      for (const l of lists)
        items.push({ kind: 'list', id: l.id, data: strip(l), updated_at: l.updatedAt, deleted: l.deleted === 1 });
      return items;
    },

    async markPushed(items) {
      await db.transaction('rw', allTables, async () => {
        for (const it of items) {
          switch (it.kind) {
            case 'task':
              await markOne(db.tasks, it.id, it.updated_at);
              break;
            case 'topic':
              await markOne(db.topics, it.id, it.updated_at);
              break;
            case 'person':
              await markOne(db.people, it.id, it.updated_at);
              break;
            case 'filter':
              await markOne(db.filters, it.id, it.updated_at);
              break;
            case 'setting':
              await markOne(db.settings, it.id, it.updated_at);
              break;
            case 'list':
              await markOne(db.lists, it.id, it.updated_at);
              break;
          }
        }
      });
    },

    async applyRemote(items) {
      const wrote = await db.transaction('rw', [...allTables, db.meta], async () => {
        let any = false;
        for (const it of items) {
          const w = await applyByKind(it.kind, it);
          any = any || w;
        }
        if (any && items.some((it) => it.kind === 'task')) await reconcileFamilies();
        return any;
      });
      if (wrote) notify();
    },

    // Seguridad LWW de la purga: el servidor nunca borra filas (conserva sus tombstones) y su trigger descarta
    // escrituras con updated_at menor. Un tombstone solo se purga si ya está sincronizado (dirty=0), así que el
    // servidor tiene una versión con updated_at >= la purgada. Si después llega de nuevo (pull completo), applyOne
    // lo reinserta como tombstone; si llega una versión viva más antigua, el servidor la descarta. Una viva más
    // nueva sí entra, como debe. Por eso no hace falta notificar: los tombstones ya estaban fuera de todas las listas.
    // Las preferencias (settings) no se purgan: ahí la ausencia de registro cambia la semántica de
    // setSetting(..., 'initialize'), y apenas ocupan espacio.
    async purgeTombstones(olderThanMs) {
      const cutoff = Date.now() - olderThanMs;
      return db.transaction('rw', [db.tasks, db.topics, db.people, db.filters, db.lists], async () =>
        (await purgeOne(db.tasks, cutoff)) + (await purgeOne(db.topics, cutoff)) +
        (await purgeOne(db.people, cutoff)) + (await purgeOne(db.filters, cutoff)) +
        (await purgeOne(db.lists, cutoff)),
      );
    },

    async markAllDirty() {
      await db.transaction('rw', allTables, async () => {
        // Sin tocar updatedAt: los registros conservan su versión LWW, solo se vuelven a subir.
        await db.tasks.toCollection().modify({ dirty: 1 });
        await db.topics.toCollection().modify({ dirty: 1 });
        await db.people.toCollection().modify({ dirty: 1 });
        await db.filters.toCollection().modify({ dirty: 1 });
        await db.settings.toCollection().modify({ dirty: 1 });
        await db.lists.toCollection().modify({ dirty: 1 });
      });
    },

    async markDirty(refs) {
      await db.transaction('rw', allTables, async () => {
        for (const ref of refs) {
          switch (ref.kind) {
            case 'task':
              await db.tasks.update(ref.id, { dirty: 1 });
              break;
            case 'topic':
              await db.topics.update(ref.id, { dirty: 1 });
              break;
            case 'person':
              await db.people.update(ref.id, { dirty: 1 });
              break;
            case 'filter':
              await db.filters.update(ref.id, { dirty: 1 });
              break;
            case 'setting':
              await db.settings.update(ref.id, { dirty: 1 });
              break;
            case 'list':
              await db.lists.update(ref.id, { dirty: 1 });
              break;
          }
        }
      });
    },

    async getSetting<T = unknown>(key: string) {
      const row = await db.settings.get(key);
      return row && !row.deleted ? { value: row.value as T, updatedAt: row.updatedAt } : undefined;
    },

    async setSetting(key, value, mode) {
      const changed = await db.transaction('rw', db.settings, async () => {
        const existing = await db.settings.get(key);
        if (mode === 'initialize' && existing) return false;
        if (existing?.deleted === 0 && JSON.stringify(existing.value) === JSON.stringify(value)) return false;
        const rec: Setting = {
          key, value, updatedAt: mode === 'initialize' ? 0 : stamp(existing?.updatedAt), deleted: 0, dirty: 1,
        };
        await db.settings.put(rec);
        return true;
      });
      if (changed) notify();
    },

    async getMeta<T = unknown>(key: string) {
      const row = await db.meta.get(key);
      return row?.value as T | undefined;
    },

    async setMeta(key, value) {
      await db.meta.put({ key, value });
    },

    async clearAll() {
      await db.transaction('rw', [...allTables, db.meta], async () => {
        await Promise.all([...allTables, db.meta].map((t) => t.clear()));
      });
      notify();
    },

    subscribe(cb) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
  };

  /** Tarea de una lista compartida (docs/plan-listas.md §4.4). Nunca pisa una tarea local de otro espacio. */
  async function applySharedTask(listId: ID, it: ListItem, batchIds: Set<ID>): Promise<boolean> {
    const local = await db.tasks.get(it.id);
    if (local && (local.listId ?? null) !== listId) return false;
    if (local && it.updated_at <= local.updatedAt) return false;
    const data = it.data as Omit<Task, 'dirty'>;
    // Una subtarea solo cuelga de una principal de esta lista: si no la hay (ni en este lote), queda suelta.
    let parentId = data.parentId ?? null;
    if (parentId !== null && !batchIds.has(parentId)) {
      const parent = await db.tasks.get(parentId);
      if (!parent || (parent.listId ?? null) !== listId) parentId = null;
    }
    await db.tasks.put({
      ...data, listId, parentId, updatedAt: it.updated_at, deleted: it.deleted ? 1 : 0, dirty: 0,
    });
    return true;
  }

  /** Tema o persona de una lista compartida: solo se crea si no hay una viva con esa clave; los borrados se ignoran. */
  async function applySharedEntity(kind: EntityKind, it: ListItem): Promise<boolean> {
    if (it.deleted) return false;
    const tbl = tableOf(kind);
    const existing = await tbl.get(it.id);
    if (existing && existing.deleted === 0) return false;
    const data = it.data as Omit<Entity, 'dirty'>;
    await tbl.put({ ...data, key: it.id, updatedAt: it.updated_at, deleted: 0, dirty: 0 });
    return true;
  }

  /** Ficha de la lista (meta 'list'): el nombre cambia solo si su versión es más nueva que nameAt. No toca updatedAt ni dirty. */
  async function applySharedMeta(listId: ID, it: ListItem): Promise<boolean> {
    if (it.id !== 'list' || it.deleted) return false;
    const list = await db.lists.get(listId);
    if (!list || list.deleted === 1 || !list.shared) return false;
    const data = it.data as { name?: unknown } | null;
    const name = typeof data?.name === 'string' ? data.name.trim() : '';
    if (!name || it.updated_at <= list.shared.nameAt) return false;
    await db.lists.put({ ...list, name, shared: { ...list.shared, nameAt: it.updated_at } });
    return true;
  }

  /** Lista del espacio personal que llega del servidor. Si alguno de los dos lados es compartido, el nombre lo
   *  gana el nameAt mayor. Un tombstone de una lista que aquí era compartida borra sus tareas en local (ya no soy miembro). */
  async function applyRemoteList(it: RemoteItem): Promise<boolean> {
    const local = await db.lists.get(it.id);
    if (local && it.updated_at <= local.updatedAt) return false;
    const data = it.data as Omit<TodoList, 'dirty'>;
    const ls = local?.shared ?? null;
    const rs = data.shared ?? null;
    const useLocalName = ls !== null && (rs === null || ls.nameAt > rs.nameAt);
    const name = useLocalName && local ? local.name : data.name;
    const { shared: _shared, ...rest } = data;
    const shared = rs ? { ...rs, nameAt: Math.max(rs.nameAt, ls?.nameAt ?? rs.nameAt) } : it.deleted ? null : ls;
    await db.lists.put({
      ...rest, name, ...(shared ? { shared } : {}), updatedAt: it.updated_at, deleted: it.deleted ? 1 : 0, dirty: 0,
    });
    if (it.deleted && ls) {
      const victims = (await db.tasks.toArray()).filter((t) => t.listId === it.id).map((t) => t.id);
      await db.tasks.bulkDelete(victims);
      await db.meta.delete(`sync.cursor.list:${it.id}`);
    }
    return true;
  }

  async function applyByKind(kind: SyncKind, it: RemoteItem): Promise<boolean> {
    switch (kind) {
      case 'task':
        return applyOne(db.tasks, it);
      case 'topic':
        return applyOne(db.topics, it);
      case 'person':
        return applyOne(db.people, it);
      case 'filter':
        return applyOne(db.filters, it);
      case 'list':
        return applyRemoteList(it);
      case 'setting': {
        const data = it.data;
        if (!data || typeof data !== 'object' || !('key' in data) || data.key !== it.id || !('value' in data) ||
          !Number.isFinite(it.updated_at) || it.updated_at < 0) {
          throw new Error('Preferencia sincronizada no válida.');
        }
        const local = await db.settings.get(it.id);
        const deleted = it.deleted ? 1 : 0;
        // El servidor acepta empates. Tras confirmar nuestro envío adoptamos su ganador.
        if (local && (it.updated_at < local.updatedAt ||
          (it.updated_at === local.updatedAt && (local.dirty === 1 ||
            (JSON.stringify(local.value) === JSON.stringify(data.value) && local.deleted === deleted))))) return false;
        await db.settings.put({
          key: it.id, value: data.value, updatedAt: it.updated_at, deleted, dirty: 0,
        });
        return true;
      }
      default:
        throw new Error('Tipo de registro de sincronización no compatible.');
    }
  }

  return repo;
}
