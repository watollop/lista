// Contratos compartidos entre módulos. Cualquier cambio aquí lo decide el orquestador.

export type ID = string; // crypto.randomUUID()
export type ISODate = string; // 'YYYY-MM-DD' en hora local
export type Priority = 1 | 2 | 3; // 1 = máxima

export interface Recurrence {
  unit: 'day' | 'week' | 'month' | 'year';
  every: number; // >= 1 ("cada 2 semanas" => 2)
  weekday?: number; // 0=domingo..6=sábado, solo con unit 'week' ("cada lunes")
  monthDay?: number; // día ancla para 'month'/'year' (31 ene -> 28 feb -> 31 mar); lo fija el repo
}

/** Campos comunes a todo registro sincronizable. */
export interface SyncRec {
  updatedAt: number; // ms epoch, se actualiza en cada escritura local
  deleted: 0 | 1; // tombstone: nunca se borra físicamente
  dirty: 0 | 1; // 1 = pendiente de subir al servidor
}

export interface ColorPreference extends SyncRec {
  id: 'secondaryColor';
  value: string;
}

export interface Task extends SyncRec {
  id: ID;
  title: string; // texto sin tokens
  topics: string[]; // claves normalizadas (normalizeKey) de Topic
  people: string[]; // claves normalizadas de Person
  due: ISODate | null;
  period?: Period | null; // si está, `due` es el fin de esa semana/mes/trimestre/año (fecha "blanda")
  priority: Priority | null;
  recurrence: Recurrence | null;
  parentId: ID | null; // subtarea de un solo nivel
  done: 0 | 1;
  doneAt: number | null;
  nextId: ID | null; // ocurrencia creada al completar una recurrente (para deshacer)
  order: number; // orden manual dentro del grupo; menor primero
  createdAt: number;
}

export type EntityKind = 'topic' | 'person';

/** Tema (#) o persona (@). key = normalizeKey(name). */
export interface Entity extends SyncRec {
  key: string;
  name: string; // forma de visualización (la primera escrita)
}

/** Periodo de una fecha "blanda": esta semana (acaba el viernes), este mes, trimestre natural, año. */
export type Period = 'week' | 'month' | 'quarter' | 'year';

export type DateFilter = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'overdue' | 'nodate';
export type StatusFilter = 'open' | 'done' | 'all';

export interface Filter {
  topics: string[]; // claves; OR dentro del campo
  people: string[];
  dates: DateFilter[];
  priorities: Priority[];
  status: StatusFilter;
  text: string; // búsqueda libre, insensible a mayúsculas y acentos
}

export interface SavedFilter extends SyncRec {
  id: ID;
  name: string;
  filter: Filter;
  order: number;
}

// ---------- parser ----------

export type TokenType = 'topic' | 'person' | 'date' | 'priority' | 'recurrence';

export interface ParsedToken {
  type: TokenType;
  text: string; // texto original tal cual aparece en la línea
  start: number; // índice en la línea original
  end: number; // exclusivo
}

export interface ParsedLine {
  title: string; // línea sin tokens, espacios colapsados
  topics: string[]; // nombres tal y como se escribieron (sin '#')
  people: string[]; // sin '@'
  due: ISODate | null;
  period: Period | null;
  priority: Priority | null;
  recurrence: Recurrence | null;
  isSubtask: boolean; // empieza por '>', va indentada o es un segmento tras '<'
  tokens: ParsedToken[]; // ordenados por start
}

/** Token en edición bajo el cursor, para autocompletar. */
export interface ActiveToken {
  type: 'topic' | 'person';
  prefix: string; // lo escrito tras '#'/'@'
  start: number; // índice del '#'/'@'
  end: number;
}

// ---------- backup ----------

export interface Backup {
  app: 'lista';
  version: 1;
  exportedAt: number;
  tasks: Task[];
  topics: Entity[];
  people: Entity[];
  filters: SavedFilter[];
  preferences?: ColorPreference[]; // opcional para aceptar copias anteriores
}

// ---------- sync ----------

export type SyncKind = 'task' | 'topic' | 'person' | 'filter' | 'preference';

/** Registro tal y como viaja al/desde el servidor. */
export interface RemoteItem {
  kind: SyncKind;
  id: string; // Task.id, Entity.key o SavedFilter.id
  data: Omit<Task, 'dirty'> | Omit<Entity, 'dirty'> | Omit<SavedFilter, 'dirty'> | Omit<ColorPreference, 'dirty'>;
  updated_at: number;
  deleted: boolean;
}

export interface ChangeSet {
  items: RemoteItem[];
}

// ---------- interfaces de módulo ----------

/** API del módulo data (src/data/repo.ts). Todas las escrituras locales ponen dirty=1 y updatedAt=Date.now(). */
export interface Repo {
  listTasks(): Promise<Task[]>; // no borradas
  listTopics(): Promise<Entity[]>; // no borradas, orden alfabético
  listPeople(): Promise<Entity[]>;
  listFilters(): Promise<SavedFilter[]>; // no borrados, por order
  getSecondaryColor(): Promise<ColorPreference | undefined>;
  setSecondaryColor(color: string): Promise<ColorPreference>;
  /** Migra solo si no existe un registro, con prioridad inferior a una elección sincronizada. */
  initializeSecondaryColor(color: string): Promise<void>;

  /** Crea tareas desde líneas parseadas. Una línea isSubtask cuelga de la última no-subtarea del lote
   *  o, si no hay, de defaultParentId (si es null se crea como tarea normal). Crea Topic/Person si no existen. */
  addParsed(lines: ParsedLine[], defaultParentId?: ID | null): Promise<Task[]>;
  /** Sustituye título/tokens de una tarea existente con una línea parseada (edición). */
  replaceParsed(id: ID, line: ParsedLine): Promise<Task>;
  updateTask(id: ID, patch: Partial<Omit<Task, 'id'>>): Promise<Task>;
  /** Alterna done; un padre cambia también sus subtareas en la misma transacción.
   *  Cambiar una subtarea deriva el estado del padre. Una recurrente genera la siguiente familia pendiente.
   *  Al completar devuelve undo para restaurar solo los estados cambiados por esa operación. */
  toggleDone(id: ID): Promise<{ task: Task; spawned: Task | null; undo: (() => Promise<void>) | null }>;
  deleteTask(id: ID): Promise<void>; // tombstone de la tarea y sus subtareas
  restoreTask(id: ID): Promise<void>; // deshacer borrado (tarea y subtareas borradas en la misma operación)
  /** Mueve la tarea antes de beforeId (o al final si null) recalculando order. */
  moveTask(id: ID, beforeId: ID | null): Promise<void>;

  saveFilter(name: string, filter: Filter): Promise<SavedFilter>;
  deleteFilter(id: ID): Promise<void>;

  /** Renombra un tema/persona. Si el nuevo nombre normaliza a otra clave que ya existe, FUSIONA: sus tareas y
   *  filtros guardados pasan a esa clave y la antigua se borra (tombstone). Reescribe las etiquetas en el texto
   *  de las tareas (#viejo -> #nuevo). Mismo key (solo cambia mayúsculas/tildes): actualiza el nombre visible. */
  renameEntity(kind: EntityKind, key: string, newName: string): Promise<{ key: string; merged: boolean; tasks: number }>;
  /** Borra un tema/persona: lo quita de sus tareas (en el texto queda la palabra sin #/@) y de los filtros
   *  guardados. Las tareas NO se borran. Devuelve cuántas tareas cambió y una función para deshacerlo. */
  deleteEntity(kind: EntityKind, key: string): Promise<{ tasks: number; undo: () => Promise<void> }>;

  exportBackup(): Promise<Backup>;
  /** Borra todos los datos locales (tareas, temas, personas, filtros y metadatos de sync). */
  wipe(): Promise<void>;
  /** merge: LWW por updatedAt. replace: borra todo y carga. */
  importBackup(b: Backup, mode: 'merge' | 'replace'): Promise<void>;

  // --- soporte para sync ---
  pendingChanges(): Promise<RemoteItem[]>; // registros con dirty=1
  /** Marca como subidos (dirty=0) solo si su updatedAt no ha cambiado desde que se leyeron. */
  markPushed(items: RemoteItem[]): Promise<void>;
  /** Aplica cambios remotos con LWW: solo si no existe o remote.updated_at > local.updatedAt. Quedan dirty=0. */
  applyRemote(items: RemoteItem[]): Promise<void>;
  getMeta<T = unknown>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  clearAll(): Promise<void>;

  /** Notifica cualquier escritura (local o remota). Devuelve la función para desuscribirse. */
  subscribe(cb: () => void): () => void;
}

export type SyncState =
  | { status: 'disabled' } // sin VITE_SUPABASE_*
  | { status: 'signedOut'; message?: string } // message: error del último intento de acceso
  | { status: 'idle'; lastSync: number | null; email: string }
  | { status: 'syncing'; email: string }
  | { status: 'offline'; email: string }
  | { status: 'error'; message: string; email: string };

/** API del módulo sync (src/sync/index.ts). */
export interface Sync {
  getState(): SyncState;
  subscribe(cb: (s: SyncState) => void): () => void;
  googleEnabled(): Promise<boolean>; // false si el proveedor no está activado en Supabase
  signInWithGoogle(): void; // redirige a Google; al volver, start() recoge la sesión del hash
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  /** Borra los datos de la nube y la cuenta (si la función existe en Supabase) y cierra la sesión.
   *  remote: 'none' sin sesión; 'data' solo se borraron las tareas; 'account' tareas y cuenta. */
  deleteAccount(): Promise<{ remote: 'none' | 'data' | 'account' }>;
  syncNow(): Promise<void>;
  start(): void; // engancha eventos (focus, online, visibilidad, intervalo, cambios del repo)
  stop(): void;
}
