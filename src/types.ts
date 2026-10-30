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

/** Preferencia sincronizada entre dispositivos (p. ej. la apariencia). key identifica la preferencia. */
export interface Setting extends SyncRec {
  key: string;
  value: unknown;
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
}

// ---------- sync ----------

export type SyncKind = 'task' | 'topic' | 'person' | 'filter' | 'setting';

/** Registro tal y como viaja al/desde el servidor. */
export interface RemoteItem {
  kind: SyncKind;
  id: string; // Task.id, Entity.key o SavedFilter.id
  data: Omit<Task, 'dirty'> | Omit<Entity, 'dirty'> | Omit<SavedFilter, 'dirty'> | Omit<Setting, 'dirty'>;
  updated_at: number;
  deleted: boolean;
}

export interface ChangeSet {
  items: RemoteItem[];
}

// ---------- cifrado (ver docs/plan-cifrado.md) ----------

/** kind tal y como lo ve el servidor: los de siempre más las filas cifradas y el marcador de clave. */
export type ServerKind = SyncKind | 'enc' | 'key';

/** Contenido cifrado de una fila 'enc'. iv y ct en base64. ct = AES-GCM(DK, JSON {kind, id, data}). */
export interface EncEnvelope {
  v: 1;
  iv: string;
  ct: string;
}

/** Fila cifrada: id = HMAC(DK, kind real + ':' + id real) en hex. */
export interface EncRow {
  kind: 'enc';
  id: string;
  data: EncEnvelope;
  updated_at: number;
  deleted: boolean;
}

/** Contenido de la fila marcador (kind 'key', id 'dk'). No contiene la DK. */
export interface KeyRowData {
  v: 1;
  keyId: string; // identifica la DK sin revelarla
  recovery: { iv: string; wrapped: string } | null; // DK envuelta con la clave de recuperación (opcional)
}

/** Fila de la tabla pairings (enlace de un dispositivo nuevo B con uno activado A). Binarios en base64. */
export interface PairingRow {
  id: string;
  pk_b: string; // clave pública ECDH P-256 de B (raw)
  commit_b: string; // SHA-256(pk_b ‖ n_b)
  n_b: string | null; // nonce de B, revelado tras recibir pk_a/n_a
  pk_a: string | null;
  n_a: string | null;
  wrapped_dk: string | null; // iv ‖ AES-GCM(K, DK raw), K = HKDF(ECDH)
  created_at: string;
  expires_at: string;
}

export type EncryptionState = 'off' | 'on' | 'locked' | 'migrating';

// ---------- interfaces de módulo ----------

/** API del módulo data (src/data/repo.ts). Todas las escrituras locales ponen dirty=1 y updatedAt=Date.now(). */
export interface Repo {
  listTasks(): Promise<Task[]>; // no borradas
  listTopics(): Promise<Entity[]>; // no borradas, orden alfabético
  listPeople(): Promise<Entity[]>;
  listFilters(): Promise<SavedFilter[]>; // no borrados, por order

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

  /** Preferencias que viajan con la cuenta. setSetting marca dirty y notifica; las remotas llegan por applyRemote. */
  getSetting<T = unknown>(key: string): Promise<{ value: T; updatedAt: number } | undefined>;
  /** initialize migra solo si no existe el registro, con prioridad inferior a una elección sincronizada. */
  setSetting(key: string, value: unknown, mode?: 'initialize'): Promise<void>;

  // --- soporte para sync ---
  pendingChanges(): Promise<RemoteItem[]>; // registros con dirty=1
  /** Marca como subidos (dirty=0) solo si su updatedAt no ha cambiado desde que se leyeron. */
  markPushed(items: RemoteItem[]): Promise<void>;
  /** Aplica cambios remotos con LWW: solo si no existe o remote.updated_at > local.updatedAt. Quedan dirty=0. */
  applyRemote(items: RemoteItem[]): Promise<void>;
  /** Marca dirty=1 TODOS los registros de tareas, temas, personas, filtros y preferencias, incluidos los
   *  borrados (tombstones). No cambia updatedAt ni notifica. Lo usa la migración a cifrado. */
  markAllDirty(): Promise<void>;
  /** Marca dirty=1 solo los registros indicados (los que no existan se ignoran). No cambia updatedAt ni notifica. */
  markDirty(refs: { kind: SyncKind; id: string }[]): Promise<void>;
  getMeta<T = unknown>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  /** Borra todos los datos locales de tareas, temas, personas, filtros, preferencias y metadatos (incl. la DK). */
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
  | { status: 'locked'; email: string } // hay cifrado activo en la cuenta y este dispositivo no tiene la clave
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

  // ---------- cifrado (ver docs/plan-cifrado.md) ----------
  /** Estado del cifrado según el último sync: 'off' (sin fila key), 'on', 'locked' o 'migrating'. */
  encryption(): EncryptionState;
  /** Activa el cifrado de la cuenta (irreversible). Sube todo cifrado y migra los datos en claro. */
  enableEncryption(): Promise<void>;
  /** Genera una clave de recuperación nueva (sustituye a la anterior) y la devuelve para mostrarla una vez. */
  createRecoveryKey(): Promise<string>;
  /** Desbloquea este dispositivo con la clave de recuperación de la cuenta. */
  unlockWithRecovery(recoveryKey: string): Promise<void>;
  /** Restablece el cifrado: nueva clave, se borran los datos cifrados del servidor y se resube lo local. */
  resetEncryption(): Promise<void>;
  /** Guarda una DK recibida por otra vía (p. ej. el enlace entre dispositivos). Lanza Error si su keyId no es el de la cuenta. */
  adoptKey(dk: CryptoKey): Promise<void>;

  // ---------- enlace de dispositivos (docs/plan-cifrado.md §4, src/sync/pairing.ts) ----------
  /** Enlace en curso visto desde este dispositivo; null si no hay ninguno. Los cambios se notifican por subscribe. */
  link(): LinkState | null;
  /** Dispositivo bloqueado: pide el enlace a un dispositivo activado. Termina al crear la petición; el resto avanza solo. */
  startLink(): Promise<void>;
  /** Cancela el enlace en curso (en cualquiera de los dos lados) y borra la petición del servidor. */
  cancelLink(): Promise<void>;
  /** Dispositivo activado: el usuario ha comprobado que el código coincide; envía la clave cifrada al nuevo. */
  confirmLink(): Promise<void>;
}

/** Enlace de dispositivos en curso. 'new' = este dispositivo pide la clave; 'active' = este dispositivo la da. */
export type LinkState =
  | { role: 'new'; status: 'waiting' } // esperando a que un dispositivo activado responda
  | { role: 'new'; status: 'code'; code: string } // mostrar el código y esperar la confirmación en el otro
  | { role: 'active'; status: 'waiting' } // ha llegado una petición; esperando el código
  | { role: 'active'; status: 'code'; code: string } // pedir al usuario que compare y confirme
  | { role: 'new' | 'active'; status: 'error'; message: string };
