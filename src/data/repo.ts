import type { Table } from 'dexie';
import type {
  Backup,
  Entity,
  EntityKind,
  Filter,
  ID,
  ParsedLine,
  RemoteItem,
  Repo,
  SavedFilter,
  Setting,
  SyncKind,
  SyncRec,
  Task,
} from '../types';
import { normalizeKey } from '../lib/text';
import { nextOccurrence } from '../lib/recurrence';
import { addDays, diffDays, todayISO } from '../lib/date';
import { retagTitle } from '../parser/retag';
import { ListaDB } from './db';

/** Reloj monotónico: dos escrituras en el mismo ms reciben valores estrictamente crecientes. */
let lastStamp = 0;
function stamp(after = 0): number {
  const now = Math.max(Date.now(), after + 1);
  lastStamp = now <= lastStamp ? lastStamp + 1 : now;
  return lastStamp;
}

const live = <T extends SyncRec>(rows: T[]): T[] => rows.filter((r) => r.deleted === 0);

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

async function mergeOne<R extends SyncRec>(tbl: Table<R, string>, rec: R, keyOf: (r: R) => string): Promise<void> {
  const local = await tbl.get(keyOf(rec));
  if (!local || rec.updatedAt > local.updatedAt) {
    await tbl.put({ ...rec, dirty: 1 as const });
  }
}

async function tombstoneAll<R extends SyncRec>(tbl: Table<R, string>, now: number): Promise<void> {
  const rows = live(await tbl.toArray());
  if (rows.length) await tbl.bulkPut(rows.map((r) => ({ ...r, deleted: 1 as const, dirty: 1 as const, updatedAt: now })));
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

  const allTables = [db.tasks, db.topics, db.people, db.filters, db.settings] as const;
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

  async function reconcileFamilies(): Promise<void> {
    const rows = await db.tasks.toArray();
    const now = stamp(rows.reduce((max, t) => Math.max(max, t.updatedAt), 0));
    const parents = new Set(live(rows).map((t) => t.parentId).filter((id) => id !== null));
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
      return live(await db.tasks.toArray());
    },

    async listTopics() {
      return live(await db.topics.toArray()).sort((a, b) => a.name.localeCompare(b.name, 'es'));
    },

    async listPeople() {
      return live(await db.people.toArray()).sort((a, b) => a.name.localeCompare(b.name, 'es'));
    },

    async listFilters() {
      return live(await db.filters.toArray()).sort((a, b) => a.order - b.order);
    },

    async addParsed(lines, defaultParentId = null) {
      const created = await db.transaction('rw', allTables, async () => {
        const now = stamp();
        const rows = await db.tasks.toArray();
        let defaultParent: ID | null = null;
        if (defaultParentId) {
          const p = rows.find((t) => t.id === defaultParentId && t.deleted === 0);
          if (!p) throw new Error('La tarea principal ya no existe.');
          defaultParent = p.parentId ?? p.id;
          if (!rows.some((t) => t.id === defaultParent && !t.deleted)) throw new Error('La tarea principal ya no existe.');
        }
        const out: Task[] = [];
        let lastTop: ID | null = null;
        for (const line of lines) {
          const fields = fieldsFromLine(line);
          if (!fields.title) continue;
          const parentId: ID | null = line.isSubtask ? (lastTop ?? defaultParent) : null;
          const topics = await ensureEntities(db.topics, line.topics, now);
          const people = await ensureEntities(db.people, line.people, now);
          const task: Task = {
            id: crypto.randomUUID(),
            ...fields,
            topics,
            people,
            parentId,
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
        if (!task || task.deleted === 1) throw new Error('Tarea no encontrada');
        const fields = fieldsFromLine(line);
        if (!fields.title) throw new Error('El título no puede estar vacío');
        const topics = await ensureEntities(db.topics, line.topics, now);
        const people = await ensureEntities(db.people, line.people, now);
        const next: Task = { ...task, ...fields, topics, people, updatedAt: now, dirty: 1 };
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
        if (!task) throw new Error('Tarea no encontrada');
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
        if (!task || task.deleted === 1) throw new Error('Tarea no encontrada');
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
                throw new Error('La tarea ha cambiado; no se puede deshacer esta acción.');
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
        if (!task || task.deleted === 1) throw new Error('Tarea no encontrada');
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

    async renameEntity(kind, key, newName) {
      const name = newName.trim().replace(/^[#@]/, '').trim();
      if (!name) throw new Error('Nombre vacío');
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
      const [tasks, topics, people, filters] = await db.transaction('r', allTables, async () =>
        Promise.all([db.tasks.toArray(), db.topics.toArray(), db.people.toArray(), db.filters.toArray()]),
      );
      return {
        app: 'lista',
        version: 1,
        exportedAt: Date.now(),
        tasks: live(tasks),
        topics: live(topics),
        people: live(people),
        filters: live(filters),
      };
    },

    async importBackup(b, mode) {
      if (
        !b ||
        b.app !== 'lista' ||
        b.version !== 1 ||
        !Array.isArray(b.tasks) ||
        !Array.isArray(b.topics) ||
        !Array.isArray(b.people) ||
        !Array.isArray(b.filters)
      ) {
        throw new Error('Copia de seguridad no válida');
      }
      await db.transaction('rw', allTables, async () => {
        const now = stamp();
        if (mode === 'replace') {
          await tombstoneAll(db.tasks, now);
          await tombstoneAll(db.topics, now);
          await tombstoneAll(db.people, now);
          await tombstoneAll(db.filters, now);
          const put = <R extends SyncRec>(recs: R[]) => recs.map((r) => ({ ...r, dirty: 1 as const, updatedAt: now }));
          await db.tasks.bulkPut(put(b.tasks));
          await db.topics.bulkPut(put(b.topics));
          await db.people.bulkPut(put(b.people));
          await db.filters.bulkPut(put(b.filters));
        } else {
          for (const t of b.tasks) await mergeOne(db.tasks, t, (r) => r.id);
          for (const t of b.topics) await mergeOne(db.topics, t, (r) => r.key);
          for (const t of b.people) await mergeOne(db.people, t, (r) => r.key);
          for (const f of b.filters) await mergeOne(db.filters, f, (r) => r.id);
        }
        await reconcileFamilies();
      });
      notify();
    },

    async pendingChanges() {
      const strip = <T extends SyncRec>(r: T): T => {
        const { dirty: _dirty, ...rest } = r;
        return rest as T;
      };
      const [tasks, topics, people, filters, settings] = await Promise.all([
        db.tasks.where('dirty').equals(1).toArray(),
        db.topics.where('dirty').equals(1).toArray(),
        db.people.where('dirty').equals(1).toArray(),
        db.filters.where('dirty').equals(1).toArray(),
        db.settings.where('dirty').equals(1).toArray(),
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
          }
        }
      });
    },

    async applyRemote(items) {
      const wrote = await db.transaction('rw', allTables, async () => {
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

    async markAllDirty() {
      await db.transaction('rw', allTables, async () => {
        // Sin tocar updatedAt: los registros conservan su versión LWW, solo se vuelven a subir.
        await db.tasks.toCollection().modify({ dirty: 1 });
        await db.topics.toCollection().modify({ dirty: 1 });
        await db.people.toCollection().modify({ dirty: 1 });
        await db.filters.toCollection().modify({ dirty: 1 });
        await db.settings.toCollection().modify({ dirty: 1 });
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
