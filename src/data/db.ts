import Dexie, { type Table } from 'dexie';
import type { Entity, SavedFilter, Setting, Task } from '../types';

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
  }
}
