import Dexie, { type Table } from 'dexie';
import type { Entity, SavedFilter, Setting, Task, TodoList } from '../types';

export interface MetaRow {
  key: string;
  value: unknown;
}

/** Base de datos IndexedDB local. Los booleanos se guardan como 0|1 porque IndexedDB no los indexa. */
export class ListaDB extends Dexie {
  declare tasks: Table<Task, string>;
  declare topics: Table<Entity, string>;
  declare people: Table<Entity, string>;
  declare filters: Table<SavedFilter, string>;
  declare settings: Table<Setting, string>;
  declare lists: Table<TodoList, string>;
  declare meta: Table<MetaRow, string>;

  constructor(name = 'lista') {
    super(name);
    this.version(1).stores({
      tasks: 'id, parentId, dirty, updatedAt',
      topics: 'key, dirty',
      people: 'key, dirty',
      filters: 'id, dirty',
      meta: 'key',
    });
    this.version(2).stores({ settings: 'key, dirty' });
    this.version(3).stores({}).upgrade(async (tx) => {
      // Una versión anterior pudo avanzar el cursor ignorando preferencias aún desconocidas.
      await tx.table('meta').delete('sync.cursor');
    });
    // Índice en `deleted` para leer solo los vivos (`where('deleted').equals(0)`) sin recorrer los tombstones.
    // Los índices de IndexedDB ignoran los valores undefined o booleanos: la migración normaliza todo a 0|1 antes.
    this.version(4).stores({
      tasks: 'id, parentId, dirty, updatedAt, deleted',
      topics: 'key, dirty, deleted',
      people: 'key, dirty, deleted',
      filters: 'id, dirty, deleted',
    }).upgrade(async (tx) => {
      for (const name of ['tasks', 'topics', 'people', 'filters']) {
        await tx.table(name).toCollection()
          .filter((r: { deleted?: unknown }) => r.deleted !== 0 && r.deleted !== 1)
          .modify((r: { deleted?: unknown }) => { r.deleted = r.deleted ? 1 : 0; });
      }
    });
    // Listas (docs/plan-listas.md). Sin migración de tareas: las existentes van a la principal (listId null).
    this.version(5).stores({ lists: 'id, dirty, deleted' });
  }
}
