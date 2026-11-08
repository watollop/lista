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
  /** Lista a la que pertenece. null o ausente = la principal (MAIN_LIST). Una subtarea siempre está en la lista
   *  de su principal. Ver docs/plan-listas.md. */
  listId?: ID | null;
}

/** Id de la lista principal. Sus tareas tienen listId null; solo tiene registro si se renombra. */
export const MAIN_LIST = 'main';

/** Lista de tareas (docs/plan-listas.md). La principal no se puede borrar y va siempre primero. */
export interface TodoList extends SyncRec {
  id: ID; // MAIN_LIST para la principal
  name: string; // forma de visualización; dos listas propias no pueden normalizar al mismo listKey
  order: number; // orden en el selector; menor primero (la principal va primero siempre)
  /** Solo en listas compartidas (docs/plan-listas.md §4.4). La principal nunca se comparte. */
  shared?: SharedList | null;
}

/** Lo que guarda cada miembro de una lista compartida, en su registro personal (cifrado con su DK). */
export interface SharedList {
  lk: string; // clave de la lista (AES-256-GCM raw en base64, ver src/sync/listcrypto.ts)
  nameAt: number; // versión del nombre (ms): la del último registro meta aplicado o del último renombrado local
}

/** Tipo de registro dentro de una lista compartida: tareas, temas y personas, y su ficha (meta, id 'list'). */
export type ListKind = 'task' | 'topic' | 'person' | 'meta';

/** Registro de una lista compartida ya descifrado. data: Task, Entity o { name } (meta), sin dirty. */
export interface ListItem {
  kind: ListKind;
  id: string;
  data: unknown;
  updated_at: number;
  deleted: boolean;
}

/** Lista actual de la pantalla: una lista concreta o todas mezcladas. Se recuerda por dispositivo. */
export type ListScope = ID | 'all';

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
  day?: ISODate; // un día concreto (mini calendario); opcional: los filtros guardados antes no lo tienen
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

export type TokenType = 'topic' | 'person' | 'date' | 'priority' | 'recurrence' | 'list';

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
  /** listKey de una lista existente escrita como /nombre (solo se reconocen las conocidas, ver setKnownLists).
   *  null = no se indicó: la tarea va a la lista actual (o, al editar, no cambia de lista). */
  list: string | null;
  tokens: ParsedToken[]; // ordenados por start
}

/** Token en edición bajo el cursor, para autocompletar. */
export interface ActiveToken {
  type: 'topic' | 'person' | 'list';
  prefix: string; // lo escrito tras '#'/'@'/'/'
  start: number; // índice del '#'/'@'/'/'
  end: number;
}

// ---------- backup ----------

export interface Backup {
  app: 'lista';
  version: 2; // 2: añade lists
  exportedAt: number;
  tasks: Task[];
  topics: Entity[];
  people: Entity[];
  filters: SavedFilter[];
  lists: TodoList[];
}

// ---------- sync ----------

export type SyncKind = 'task' | 'topic' | 'person' | 'filter' | 'setting' | 'list';

/** Registro tal y como viaja al/desde el servidor. */
export interface RemoteItem {
  kind: SyncKind;
  id: string; // Task.id, Entity.key, SavedFilter.id, Setting.key o TodoList.id
  data: Omit<Task, 'dirty'> | Omit<Entity, 'dirty'> | Omit<SavedFilter, 'dirty'> | Omit<Setting, 'dirty'> | Omit<TodoList, 'dirty'>;
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

// ---------- listas compartidas: servidor (supabase/migrations/20261108_listas.sql, docs/plan-listas.md §4.3) ----------

export type ListRole = 'owner' | 'member';

/** Una membresía del usuario actual (fila de list_members). */
export interface ListMembership {
  list_id: ID; // el mismo id que la lista local
  role: ListRole;
  joined_at: string;
}

/** Un miembro de una lista, con su email y nombre de Google (RPC list_members_info). */
export interface ListMemberInfo {
  user_id: string;
  role: ListRole;
  joined_at: string;
  email: string | null;
  name: string | null;
}

/** Invitación tal como la ven los miembros. Nunca incluye token_hash ni wrapped. */
export interface ListInviteInfo {
  id: string;
  list_id: ID;
  created_by: string | null;
  created_at: string;
  expires_at: string;
  used_by: string | null;
  used_at: string | null;
}

/** Motivos por los que accept_invite rechaza un enlace. */
export type InviteErrorCode = 'invite_invalid' | 'invite_expired' | 'invite_used' | 'list_full';

export type EncryptionState = 'off' | 'on' | 'locked' | 'migrating';

// ---------- interfaces de módulo ----------

/** API del módulo data (src/data/repo.ts). Todas las escrituras locales ponen dirty=1 y updatedAt=Date.now(). */
export interface Repo {
  listTasks(): Promise<Task[]>; // no borradas
  listTopics(): Promise<Entity[]>; // no borradas, orden alfabético
  listPeople(): Promise<Entity[]>;
  listFilters(): Promise<SavedFilter[]>; // no borrados, por order
  /** Listas vivas: la principal primero (con nombre por defecto si no tiene registro) y luego por order. */
  listLists(): Promise<TodoList[]>;

  /** Crea tareas desde líneas parseadas. Una línea isSubtask cuelga de la última no-subtarea del lote
   *  o, si no hay, de defaultParentId (si es null se crea como tarea normal). Crea Topic/Person si no existen.
   *  Lista de cada tarea principal: la de su `line.list` si existe; si no, listId (por defecto la principal).
   *  Las subtareas van siempre a la lista de su principal. */
  addParsed(lines: ParsedLine[], defaultParentId?: ID | null, listId?: ID): Promise<Task[]>;
  /** Sustituye título/tokens de una tarea existente con una línea parseada (edición).
   *  Si line.list indica otra lista existente, la tarea (con sus subtareas) se mueve a ella. */
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

  /** Crea una lista al final. Lanza Error si el nombre está vacío o su listKey coincide con otra lista viva. */
  createList(name: string): Promise<TodoList>;
  /** Renombra (también la principal, que entonces pasa a tener registro). Mismas reglas que createList. */
  renameList(id: ID, name: string): Promise<TodoList>;
  /** Borra una lista y todas sus tareas (tombstones) en una transacción. La principal no se puede borrar,
   *  ni una compartida (eso es salir o borrar para todos, en el sync).
   *  undo restaura la lista y solo las tareas que borró esta operación. */
  deleteList(id: ID): Promise<{ tasks: number; undo: () => Promise<void> }>;
  /** Mueve una tarea principal y sus subtareas a otra lista (una subtarea mueve a su familia entera).
   *  Entre espacios distintos (personal ↔ compartida, o dos compartidas) copia la familia con ids nuevos y deja
   *  tombstones de los originales (docs/plan-listas.md §4.4). `id` es el de la tarea principal resultante.
   *  undo la devuelve a la lista anterior. */
  moveToList(id: ID, listId: ID): Promise<{ id: ID; undo: () => Promise<void> }>;

  // --- listas compartidas (docs/plan-listas.md §4.4); las llama el sync, no la interfaz ---
  /** Convierte una lista propia (no la principal, viva, sin compartir) en compartida con la LK dada: guarda
   *  shared = { lk, nameAt: ahora } y copia sus tareas vivas (con subtareas, también completadas) con ids nuevos,
   *  dejando los originales como tombstones con listId null. Devuelve cuántas tareas copió. */
  markShared(listId: ID, lk: string): Promise<number>;
  /** Crea en local una lista compartida a la que me acabo de unir (o la reactiva si era un tombstone), al final,
   *  con shared = { lk, nameAt: 0 } y dirty. Admite un nombre repetido. Si ya existe viva y compartida, la devuelve. */
  joinShared(listId: ID, lk: string, name: string): Promise<TodoList>;
  /** Aplica registros ya descifrados de una lista compartida (reglas en docs/plan-listas.md §4.4). Quedan dirty=0. */
  applyShared(listId: ID, items: ListItem[]): Promise<void>;
  /** Ya no soy miembro: borra físicamente en local sus tareas (sin tombstones) y deja la lista como tombstone
   *  dirty, sin LK. Devuelve el nombre que tenía (null si no existía). */
  purgeShared(listId: ID): Promise<string | null>;

  /** Renombra un tema/persona. Si el nuevo nombre normaliza a otra clave que ya existe, FUSIONA: sus tareas y
   *  filtros guardados pasan a esa clave y la antigua se borra (tombstone). Reescribe las etiquetas en el texto
   *  de las tareas (#viejo -> #nuevo). Mismo key (solo cambia mayúsculas/tildes): actualiza el nombre visible. */
  renameEntity(kind: EntityKind, key: string, newName: string): Promise<{ key: string; merged: boolean; tasks: number }>;
  /** Borra un tema/persona: lo quita de sus tareas (en el texto queda la palabra sin #/@) y de los filtros
   *  guardados. Las tareas NO se borran. Devuelve cuántas tareas cambió y una función para deshacerlo. */
  deleteEntity(kind: EntityKind, key: string): Promise<{ tasks: number; undo: () => Promise<void> }>;

  exportBackup(): Promise<Backup>;
  /** Borra físicamente, solo en local, los tombstones sincronizados (deleted=1, dirty=0) con updatedAt anterior a
   *  now - olderThanMs, en tareas, temas, personas, filtros y listas. Nunca toca pendientes ni vivos. No notifica
   *  (nada visible cambia). Devuelve cuántos registros borró. */
  purgeTombstones(olderThanMs: number): Promise<number>;
  /** Borra todos los datos locales (tareas, temas, personas, filtros, listas y metadatos de sync). */
  wipe(): Promise<void>;

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
  /** Marca dirty=1 TODOS los registros de tareas, temas, personas, filtros, listas y preferencias, incluidos los
   *  borrados (tombstones). No cambia updatedAt ni notifica. Lo usa la migración a cifrado. */
  markAllDirty(): Promise<void>;
  /** Marca dirty=1 solo los registros indicados (los que no existan se ignoran). No cambia updatedAt ni notifica. */
  markDirty(refs: { kind: SyncKind; id: string }[]): Promise<void>;
  getMeta<T = unknown>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  /** Borra todos los datos locales de tareas, temas, personas, filtros, listas, preferencias y metadatos (incl. la DK). */
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
  signOut(): Promise<void>;
  /** Borra los datos de la nube y la cuenta (si la función existe en Supabase) y cierra la sesión.
   *  remote: 'none' sin sesión; 'data' solo se borraron las tareas; 'account' tareas y cuenta. */
  deleteAccount(): Promise<{ remote: 'none' | 'data' | 'account' }>;
  syncNow(): Promise<void>;
  start(): void; // engancha eventos (focus, online, visibilidad, intervalo, cambios del repo)
  stop(): void;

  // ---------- cifrado (ver docs/plan-cifrado.md) ----------
  /**
   * Estado del cifrado según el último sync. Es obligatorio: el primer sync de la cuenta lo activa.
   * 'off' solo antes de ese primer sync; luego 'migrating', 'on' o 'locked'.
   */
  encryption(): EncryptionState;
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

  // ---------- listas compartidas (docs/plan-listas.md §4.4 y §4.5, src/sync/shared.ts) ----------
  /** Comparte una lista propia (sesión iniciada y cifrado 'on'): la crea en el servidor, pasa sus tareas al
   *  espacio compartido, sincroniza y devuelve un enlace de invitación. */
  shareList(listId: ID): Promise<{ link: string; expiresAt: string }>;
  /** Nuevo enlace de invitación (un solo uso, 7 días) para una lista ya compartida. */
  createInvite(listId: ID): Promise<{ link: string; expiresAt: string }>;
  /** Se une con un enlace (completo o solo su fragmento #unirse=…). Lanza InviteRejectedError si el servidor
   *  lo rechaza. Devuelve la lista local creada. */
  joinList(link: string): Promise<{ listId: ID; name: string }>;
  /** Sale de una lista compartida (si era el owner, pasa al miembro más antiguo) y la quita de este dispositivo. */
  leaveList(listId: ID): Promise<void>;
  /** Solo el owner: borra la lista para todos y la quita de este dispositivo. */
  deleteSharedList(listId: ID): Promise<void>;
  /** Solo el owner: quita a otra persona. */
  removeMember(listId: ID, userId: string): Promise<void>;
  /** Miembros con su email y nombre. */
  listMembers(listId: ID): Promise<ListMemberInfo[]>;
  /** Mis membresías según el último sync (vacío si el servidor no admite listas compartidas). */
  memberships(): Promise<ListMembership[]>;
  /** Nombres de las listas que este dispositivo quitó por membresía perdida desde la última llamada; las olvida. */
  takeLostLists(): Promise<string[]>;
}

/** Enlace de dispositivos en curso. 'new' = este dispositivo pide la clave; 'active' = este dispositivo la da. */
export type LinkState =
  | { role: 'new'; status: 'waiting' } // esperando a que un dispositivo activado responda
  | { role: 'new'; status: 'code'; code: string } // mostrar el código y esperar la confirmación en el otro
  | { role: 'active'; status: 'waiting' } // ha llegado una petición; esperando el código
  | { role: 'active'; status: 'code'; code: string } // pedir al usuario que compare y confirme
  | { role: 'new' | 'active'; status: 'error'; message: string };
