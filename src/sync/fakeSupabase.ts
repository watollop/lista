// Servidor Supabase falso en memoria (GoTrue, PostgREST y RPC) para tests.
// Varios usuarios y dispositivos pueden usar la misma instancia a la vez: `fetch` despacha por URL y por el
// token Bearer, así que cada dispositivo ve al servidor como un cliente distinto.
//
// Reproduce:
// - del FakeServer de encryption.test.ts: refresco de sesión con rotación, filtros eq/in, LWW en upserts y
//   PATCH, paginación por synced_at, pairings y la fila de clave (ignore-duplicates);
// - de supabase/migrations/20261108_listas.sql: RLS de cada tabla, triggers (salida de miembros, traspaso de
//   owner, lista sin miembros que se borra con todo su contenido), RPC y sus errores (P0001, 42501, 23514...).
import type { Session } from './auth';

/** Clave anónima que exige el fake en cada petición (cabecera apikey). */
export const ANON_KEY = 'anon-key';
/** Configuración de sincronización para usar con este fake. */
export const FAKE_CFG = { url: 'https://fake.supabase.co', anonKey: ANON_KEY };

type TableName = 'items' | 'pairings' | 'lists' | 'list_members' | 'list_items' | 'list_invites';
type Row = Record<string, any>;

/** Fila tal como la devuelven los inspectores (copia). */
export type FakeRow = Record<string, any>;

interface FakeUser {
  id: string;
  email: string;
  name: string | null;
}

const BASE_SYNC_MS = Date.parse('2026-10-27T10:00:00Z'); // base de synced_at, independiente del reloj del fake
const DAY_MS = 24 * 3600_000;
const INVITE_TTL_MS = 7 * DAY_MS; // expires_at por defecto de list_invites
const INVITE_MAX_AHEAD_MS = 7 * DAY_MS + 60_000; // política de insert: "7 days 1 minute"
const PAIRING_TTL_MS = 10 * 60_000; // expires_at por defecto de pairings
const MAX_MEMBERS = 50; // list_full
const MAX_LISTS_PER_USER = 200; // too_many_lists
const PAGE_CAP = 1000; // max-rows por defecto de Supabase

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHARED_TABLES = ['lists', 'list_members', 'list_items', 'list_invites'];
const SHARED_RPCS = ['create_list', 'accept_invite', 'list_members_info'];
/** Tablas con synced_at y LWW por updated_at (trigger items_lww / list_items_lww). */
const SYNC_TABLES: TableName[] = ['items', 'list_items'];
/** Columnas de inserción aceptadas (PGRST204 si llega otra). */
const COLS: Record<TableName, string[]> = {
  items: ['user_id', 'kind', 'id', 'data', 'updated_at', 'deleted', 'synced_at'],
  pairings: [],
  lists: ['id', 'created_by', 'created_at'],
  list_members: ['list_id', 'user_id', 'role', 'joined_at'],
  list_items: ['list_id', 'kind', 'id', 'data', 'updated_at', 'deleted', 'synced_at'],
  list_invites: ['id', 'list_id', 'created_by', 'token_hash', 'wrapped', 'created_at', 'expires_at', 'used_by', 'used_at'],
};
/** Clave de conflicto de cada tabla (on_conflict de PostgREST). */
const KEYS: Record<TableName, string[]> = {
  items: ['user_id', 'kind', 'id'],
  pairings: ['id'],
  lists: ['id'],
  list_members: ['list_id', 'user_id'],
  list_items: ['list_id', 'kind', 'id'],
  list_invites: ['id'],
};
/** Parámetros de PostgREST que no son filtros de columna. */
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict']);

// ---------- tiempo ----------

/** ISO con microsegundos ('AAAA-MM-DDTHH:MM:SS.sssuuu+00:00'), como PostgREST. `micros` = µs desde epoch. */
function fmtMicro(micros: number): string {
  const ms = Math.floor(micros / 1000);
  const rest = micros - ms * 1000;
  return new Date(ms).toISOString().slice(0, -1) + String(rest).padStart(3, '0') + '+00:00';
}

/** Microsegundos desde epoch de un timestamp de PostgREST (o de un número en ms). NaN si no es un timestamp. */
function microsOf(v: unknown): number {
  if (typeof v === 'number') return v * 1000;
  if (typeof v !== 'string') return NaN;
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+ ]00:00)$/.exec(v);
  if (!m) return NaN;
  return Date.parse(m[1] + 'Z') * 1000 + Number((m[2] ?? '').padEnd(6, '0'));
}

// ---------- consultas PostgREST ----------

function valueStr(v: unknown): string {
  return v === null || v === undefined ? 'null' : String(v);
}

/** Valores de un filtro in.("a","b") (o in.(a,b) sin comillas). */
function inList(f: string): string[] {
  const quoted = [...f.matchAll(/"((?:[^"\\]|\\.)*)"/g)];
  if (quoted.length > 0) return quoted.map((m) => m[1].replace(/\\(.)/g, '$1'));
  return f.slice(4, -1).split(',').filter(Boolean);
}

function matchFilter(value: unknown, f: string): boolean {
  if (f === 'is.null') return value === null || value === undefined;
  if (f.startsWith('eq.')) return valueStr(value) === f.slice(3);
  if (f.startsWith('in.(')) return inList(f).includes(valueStr(value));
  if (f.startsWith('gt.') || f.startsWith('lt.')) {
    const rhs = f.slice(3);
    const [x, y] = typeof value === 'number' ? [value, Number(rhs)] : [microsOf(value), microsOf(rhs)];
    if (Number.isNaN(x) || Number.isNaN(y)) return false;
    return f.startsWith('gt.') ? x > y : x < y;
  }
  throw new Error(`filtro no soportado por el fake: ${f}`);
}

function applyFilters(rows: Row[], url: URL): Row[] {
  let out = rows;
  for (const [col, f] of url.searchParams) {
    if (RESERVED.has(col)) continue;
    out = out.filter((r) => matchFilter(r[col], f));
  }
  return out;
}

function ordCmp(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const ma = microsOf(a);
  const mb = microsOf(b);
  if (!Number.isNaN(ma) && !Number.isNaN(mb)) return ma - mb;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/** order=col.asc|desc[,col2.dir]. */
function orderRows(rows: Row[], order: string): Row[] {
  const keys = order.split(',').map((part) => {
    const [col, dir = 'asc'] = part.split('.');
    return { col, desc: dir === 'desc' };
  });
  return rows.slice().sort((a, b) => {
    for (const { col, desc } of keys) {
      const c = ordCmp(a[col], b[col]);
      if (c !== 0) return desc ? -c : c;
    }
    return 0;
  });
}

/** Filtros, orden (por defecto synced_at asc si la tabla lo tiene), offset y limit (tope 1000). */
function query(rows: Row[], url: URL): Row[] {
  let out = applyFilters(rows, url);
  const order = url.searchParams.get('order') ?? (out.length > 0 && 'synced_at' in out[0] ? 'synced_at.asc' : null);
  if (order) out = orderRows(out, order);
  const offset = Number(url.searchParams.get('offset') ?? 0);
  const limit = Number(url.searchParams.get('limit') ?? PAGE_CAP);
  return out.slice(offset, offset + limit);
}

/** select=col1,col2 (o * / ausente). Devuelve copias. */
function project(rows: Row[], select: string | null): Row[] {
  if (!select || select === '*') return rows.map((r) => ({ ...r }));
  const cols = select.split(',').map((s) => s.trim());
  return rows.map((r) => Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, r[c]])));
}

// ---------- respuestas ----------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function empty(status: number): Response {
  return new Response(null, { status });
}

function pgError(status: number, code: string, message: string): Response {
  return json({ code, message, details: null, hint: null }, status);
}

/** Error de RLS en un insert o upsert (política WITH CHECK no cumplida). */
function rlsError(table: TableName): Response {
  return pgError(403, '42501', `new row violates row-level security policy for table "${table}"`);
}

/** Error de una función PL/pgSQL con RAISE EXCEPTION (errcode P0001): el cliente lee `message`. */
function rpcError(message: string): Response {
  return pgError(400, 'P0001', message);
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

// ---------- servidor ----------

export class FakeSupabase {
  /** Reloj en ms: caducidad de invitaciones y pairings, y joined_at. Se mueve con advance(). */
  now: number;
  /** false: el servidor no tiene la migración de listas. Sus endpoints responden 404 (PGRST205 / PGRST202). */
  sharing = true;

  private users = new Map<string, FakeUser>();
  private accessTokens = new Map<string, string>(); // access token -> user id
  private refreshTokens = new Map<string, string>(); // refresh token -> user id
  private tables: Record<TableName, Row[]> = {
    items: [],
    pairings: [],
    lists: [],
    list_members: [],
    list_items: [],
    list_invites: [],
  };
  private userSeq = 0;
  private tokenSeq = 0;
  private syncSeq = 0;

  /** Por defecto, la hora real al crear el fake (los filtros del cliente usan Date real). */
  constructor(now: number = Date.now()) {
    this.now = now;
  }

  // ---------- API de tests ----------

  /** Registra un usuario (id user-1, user-2...). Si ya existe ese email, devuelve su id. */
  addUser(email: string, name?: string): string {
    const found = [...this.users.values()].find((u) => u.email === email);
    if (found) return found.id;
    const id = `user-${++this.userSeq}`;
    this.users.set(id, { id, email, name: name ?? null });
    return id;
  }

  /** Tokens de una sesión ya iniciada: el dispositivo la arranca con ellos guardados. */
  session(email: string, now = Date.now()): Session {
    const u = [...this.users.values()].find((x) => x.email === email);
    if (!u) throw new Error(`usuario no registrado en el fake: ${email}`);
    const body = this.issue(u.id);
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: now + 3600_000,
      userId: u.id,
      email,
    };
  }

  /** Avanza el reloj del fake. */
  advance(ms: number): void {
    this.now += ms;
  }

  /** Miembros de una lista ordenados como en la vista (joined_at, user_id). */
  membersOf(listId: string): Array<{ userId: string; role: 'owner' | 'member' }> {
    return this.sortedMembers(listId).map((m) => ({ userId: m.user_id, role: m.role }));
  }

  /** Filas cifradas de una lista (incluidos tombstones), por synced_at. */
  listRows(listId: string): FakeRow[] {
    return clone(
      this.tables.list_items
        .filter((r) => r.list_id === listId)
        .sort((a, b) => microsOf(a.synced_at) - microsOf(b.synced_at)),
    );
  }

  /** Invitaciones de una lista, con token_hash y wrapped (lo que guarda el servidor). */
  invitesOf(listId: string): FakeRow[] {
    return clone(this.tables.list_invites.filter((i) => i.list_id === listId));
  }

  hasList(listId: string): boolean {
    return this.tables.lists.some((l) => l.id === listId);
  }

  /** Filas de `items` de un usuario. */
  itemsOf(userId: string): FakeRow[] {
    return clone(this.tables.items.filter((r) => r.user_id === userId));
  }

  /** Todo lo que guarda el servidor, en JSON (para comprobar que no hay texto en claro). */
  serverText(): string {
    return JSON.stringify({
      users: [...this.users.values()],
      items: this.tables.items,
      pairings: this.tables.pairings,
      lists: this.tables.lists,
      list_members: this.tables.list_members,
      list_items: this.tables.list_items,
      list_invites: this.tables.list_invites,
    });
  }

  // ---------- transporte ----------

  /** Sustituto de fetch. Cada petición se resuelve según la URL y el token Bearer. */
  fetch: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    const body: any = init?.body ? JSON.parse(String(init.body)) : undefined;

    if (headers.get('apikey') !== ANON_KEY) return json({ message: 'Invalid API key' }, 401);

    const p = url.pathname;
    if (p === '/auth/v1/token') return this.authToken(body);
    if (p === '/auth/v1/logout') return empty(204);
    if (p === '/auth/v1/settings') return json({ external: { google: true } });
    if (p === '/auth/v1/user') {
      const uid = this.uidOf(headers);
      if (!uid) return json({ message: 'invalid JWT' }, 401);
      const u = this.users.get(uid)!;
      return json({ id: u.id, email: u.email, user_metadata: u.name ? { full_name: u.name } : {} });
    }
    if (p.startsWith('/rest/v1/rpc/')) return this.rpc(p.slice('/rest/v1/rpc/'.length), headers, body);
    if (p.startsWith('/rest/v1/')) return this.rest(p.slice('/rest/v1/'.length), url, method, headers, body);
    return json({ message: 'not found' }, 404);
  };

  private issue(userId: string) {
    const n = ++this.tokenSeq;
    const access = `at-${n}`;
    const refresh = `rt-${n}`;
    this.accessTokens.set(access, userId);
    this.refreshTokens.set(refresh, userId);
    const u = this.users.get(userId)!;
    return {
      access_token: access,
      refresh_token: refresh,
      expires_in: 3600,
      token_type: 'bearer',
      user: { id: u.id, email: u.email },
    };
  }

  private authToken(body: any): Response {
    const uid = this.refreshTokens.get(body?.refresh_token);
    if (!uid) return json({ error_description: 'Invalid Refresh Token' }, 400);
    this.refreshTokens.delete(body.refresh_token); // rotación: el refresh token usado ya no vale
    return json(this.issue(uid));
  }

  private uidOf(headers: Headers): string | undefined {
    const m = /^Bearer (.+)$/.exec(headers.get('Authorization') ?? '');
    return m ? this.accessTokens.get(m[1]) : undefined;
  }

  private rest(name: string, url: URL, method: string, headers: Headers, body: any): Response {
    if (!this.sharing && SHARED_TABLES.includes(name)) {
      return pgError(404, 'PGRST205', `Could not find the table 'public.${name}' in the schema cache`);
    }
    if (!(name in this.tables)) return json({ message: 'not found' }, 404);
    const table = name as TableName;
    const uid = this.uidOf(headers);
    if (!uid) return json({ message: 'JWT expired', code: 'PGRST303' }, 401);
    const prefer = headers.get('Prefer') ?? '';
    const select = url.searchParams.get('select');

    switch (method) {
      case 'GET':
        return json(project(query(this.visibleRows(table, uid), url), select));
      case 'POST':
        return this.insert(table, url, uid, prefer, body);
      case 'PATCH':
        return this.patch(table, url, uid, prefer, body);
      case 'DELETE':
        return this.remove(table, url, uid, prefer);
      default:
        return json({ message: 'not found' }, 404);
    }
  }

  // ---------- RLS (política SELECT / UPDATE / DELETE) ----------

  private isMember(listId: string, uid: string): boolean {
    return this.tables.list_members.some((m) => m.list_id === listId && m.user_id === uid);
  }

  private isOwner(listId: string, uid: string): boolean {
    return this.tables.list_members.some((m) => m.list_id === listId && m.user_id === uid && m.role === 'owner');
  }

  /** Filas que el usuario ve (política SELECT). */
  private visibleRows(table: TableName, uid: string): Row[] {
    const all = this.tables[table];
    switch (table) {
      case 'items':
      case 'pairings':
        return all.filter((r) => r.user_id === uid);
      case 'lists':
        return all.filter((r) => this.isMember(r.id, uid));
      default:
        return all.filter((r) => this.isMember(r.list_id, uid));
    }
  }

  private canUpdate(table: TableName, r: Row, uid: string): boolean {
    switch (table) {
      case 'items':
      case 'pairings':
        return r.user_id === uid;
      case 'list_items':
        return this.isMember(r.list_id, uid);
      default:
        return false; // lists, list_members y list_invites no tienen política de update
    }
  }

  private canDelete(table: TableName, r: Row, uid: string): boolean {
    switch (table) {
      case 'items':
      case 'pairings':
        return r.user_id === uid;
      case 'lists':
        return this.isOwner(r.id, uid);
      case 'list_members':
        return r.user_id === uid || this.isOwner(r.list_id, uid);
      case 'list_invites':
        return this.isMember(r.list_id, uid);
      default:
        return false; // list_items no tiene política de delete: los borrados son tombstones
    }
  }

  // ---------- escrituras ----------

  /**
   * Valida una fila de insert o upsert (RLS, columnas, CHECK y NOT NULL) y devuelve la fila completa con sus
   * valores por defecto, o la respuesta de error.
   */
  private prepare(table: TableName, raw: Row, uid: string): Row | Response {
    for (const k of Object.keys(raw)) {
      if (table !== 'pairings' && !COLS[table].includes(k)) {
        return pgError(400, 'PGRST204', `Could not find the '${k}' column of '${table}' in the schema cache`);
      }
    }
    switch (table) {
      case 'items': {
        const row = { user_id: raw.user_id ?? uid, kind: raw.kind, id: raw.id, data: raw.data, updated_at: raw.updated_at, deleted: raw.deleted ?? false };
        return row.user_id === uid ? row : rlsError(table);
      }
      case 'pairings': {
        const row: Row = {
          id: raw.id ?? crypto.randomUUID(),
          user_id: raw.user_id ?? uid,
          pk_b: raw.pk_b ?? null,
          commit_b: raw.commit_b ?? null,
          n_b: null,
          pk_a: null,
          n_a: null,
          wrapped_dk: null,
          ...raw,
          created_at: this.nowIso(),
          expires_at: raw.expires_at ?? fmtMicro((this.now + PAIRING_TTL_MS) * 1000),
        };
        if (row.user_id !== uid) return rlsError(table);
        for (const c of ['pk_b', 'commit_b']) {
          if (row[c] === null) {
            return pgError(400, '23502', `null value in column "${c}" of relation "pairings" violates not-null constraint`);
          }
        }
        return row;
      }
      case 'lists':
      case 'list_members':
        return rlsError(table); // sin política de insert: se crean con create_list / accept_invite
      case 'list_items': {
        const row = { list_id: raw.list_id, kind: raw.kind, id: raw.id, data: raw.data, updated_at: raw.updated_at, deleted: raw.deleted ?? false };
        if (!this.isMember(row.list_id, uid)) return rlsError(table);
        if (row.kind !== 'enc') return pgError(400, '23514', `new row for relation "list_items" violates check constraint "list_items_kind_check"`);
        if (JSON.stringify(row.data).length > 65536) {
          return pgError(400, '23514', `new row for relation "list_items" violates check constraint "list_items_data_size"`);
        }
        return row;
      }
      case 'list_invites': {
        const row: Row = {
          id: raw.id,
          list_id: raw.list_id,
          created_by: raw.created_by ?? uid,
          token_hash: raw.token_hash,
          wrapped: raw.wrapped,
          created_at: this.nowIso(),
          expires_at: raw.expires_at ?? fmtMicro((this.now + INVITE_TTL_MS) * 1000),
          used_by: null,
          used_at: null,
        };
        // Política: miembro, a su nombre, sin usar y con 7 días como mucho (más un minuto de margen).
        const tooFar = microsOf(row.expires_at) > this.nowMicros() + INVITE_MAX_AHEAD_MS * 1000;
        if (!this.isMember(row.list_id, uid) || row.created_by !== uid || raw.used_by != null || raw.used_at != null || tooFar) {
          return rlsError(table);
        }
        if (row.id === undefined || row.id === null) {
          return pgError(400, '23502', `null value in column "id" of relation "list_invites" violates not-null constraint`);
        }
        if (!/^[0-9a-f]{64}$/.test(String(row.token_hash))) {
          return pgError(400, '23514', `new row for relation "list_invites" violates check constraint "list_invites_token_hash_check"`);
        }
        if (String(row.wrapped).length > 4096) {
          return pgError(400, '23514', `new row for relation "list_invites" violates check constraint "list_invites_wrapped_size"`);
        }
        return row;
      }
    }
  }

  private insert(table: TableName, url: URL, uid: string, prefer: string, body: unknown): Response {
    const raws: Row[] = Array.isArray(body) ? body : [body as Row];
    const resolution = /resolution=(merge|ignore)-duplicates/.exec(prefer)?.[1];

    // Se valida todo antes de escribir: una fila mala tumba el lote entero, como en PostgreSQL.
    const prepared: Row[] = [];
    for (const raw of raws) {
      const row = this.prepare(table, raw, uid);
      if (row instanceof Response) return row;
      if (!resolution && this.findByKey(table, row)) {
        return pgError(409, '23505', `duplicate key value violates unique constraint "${table}_pkey"`);
      }
      prepared.push(row);
    }

    const written: Row[] = [];
    for (const row of prepared) {
      const ex = this.findByKey(table, row);
      if (ex) {
        if (resolution === 'ignore') continue; // ignore-duplicates: nunca pisa
        if (SYNC_TABLES.includes(table) && row.updated_at < ex.updated_at) continue; // LWW: descarte silencioso
        Object.assign(ex, row);
        if (SYNC_TABLES.includes(table)) ex.synced_at = this.nextSynced();
        written.push(ex);
      } else {
        const nr: Row = { ...row };
        if (SYNC_TABLES.includes(table)) nr.synced_at = this.nextSynced();
        this.tables[table].push(nr);
        written.push(nr);
      }
    }

    if (prefer.includes('return=representation')) {
      return json(project(written, url.searchParams.get('select')), 201);
    }
    return empty(201);
  }

  private findByKey(table: TableName, row: Row): Row | undefined {
    return this.tables[table].find((r) => KEYS[table].every((c) => r[c] === row[c]));
  }

  private patch(table: TableName, url: URL, uid: string, prefer: string, body: Row | undefined): Response {
    const patchBody = body ?? {};
    const candidates = applyFilters(
      this.tables[table].filter((r) => this.canUpdate(table, r, uid)),
      url,
    );
    const written: Row[] = [];
    for (const r of candidates) {
      if (SYNC_TABLES.includes(table)) {
        if (patchBody.updated_at !== undefined && patchBody.updated_at < r.updated_at) continue; // LWW
        for (const k of ['data', 'updated_at', 'deleted']) if (k in patchBody) r[k] = patchBody[k];
        r.synced_at = this.nextSynced();
      } else {
        for (const [k, v] of Object.entries(patchBody)) {
          if (!['id', 'user_id', 'created_at', 'expires_at'].includes(k)) r[k] = v;
        }
      }
      written.push(r);
    }
    if (prefer.includes('return=representation')) {
      return json(project(written, url.searchParams.get('select')), 200);
    }
    return empty(204);
  }

  private remove(table: TableName, url: URL, uid: string, prefer: string): Response {
    const victims = applyFilters(
      this.tables[table].filter((r) => this.canDelete(table, r, uid)),
      url,
    );
    for (const v of victims) this.deleteRow(table, v);
    if (prefer.includes('return=representation')) {
      return json(project(victims, url.searchParams.get('select')), 200);
    }
    return empty(204);
  }

  private deleteRow(table: TableName, row: Row): void {
    if (table === 'list_members') {
      this.leave(row);
    } else if (table === 'lists') {
      this.deleteList(row.id);
    } else {
      this.tables[table] = this.tables[table].filter((r) => r !== row);
    }
  }

  /**
   * Trigger AFTER DELETE de list_members (list_members_after_delete): quita las invitaciones sin usar que creó
   * quien sale, pasa el owner al miembro más antiguo y borra la lista si ya no queda nadie.
   */
  private leave(m: Row): void {
    this.tables.list_members = this.tables.list_members.filter((x) => x !== m);
    this.tables.list_invites = this.tables.list_invites.filter(
      (i) => !(i.list_id === m.list_id && i.created_by === m.user_id && i.used_by == null),
    );
    if (m.role === 'owner') {
      const next = this.sortedMembers(m.list_id)[0];
      if (next) next.role = 'owner';
    }
    if (!this.tables.list_members.some((x) => x.list_id === m.list_id)) this.deleteList(m.list_id);
  }

  /** Borra la lista con todo lo que cuelga de ella (cascada). */
  private deleteList(listId: string): void {
    this.tables.lists = this.tables.lists.filter((l) => l.id !== listId);
    this.tables.list_members = this.tables.list_members.filter((m) => m.list_id !== listId);
    this.tables.list_items = this.tables.list_items.filter((r) => r.list_id !== listId);
    this.tables.list_invites = this.tables.list_invites.filter((i) => i.list_id !== listId);
  }

  // ---------- RPC ----------

  private async rpc(fn: string, headers: Headers, body: any): Promise<Response> {
    if (!this.sharing && SHARED_RPCS.includes(fn)) {
      return pgError(404, 'PGRST202', `Could not find the function public.${fn} in the schema cache`);
    }
    const uid = this.uidOf(headers);
    if (!uid) return json({ message: 'JWT expired', code: 'PGRST303' }, 401);
    switch (fn) {
      case 'create_list':
        return this.rpcCreateList(uid, body?.p_list);
      case 'accept_invite':
        return await this.rpcAcceptInvite(uid, body?.p_invite, body?.p_auth);
      case 'list_members_info':
        return this.rpcMembersInfo(uid, body?.p_list);
      case 'delete_account':
        return this.rpcDeleteAccount(uid);
      default:
        return pgError(404, 'PGRST202', `Could not find the function public.${fn} in the schema cache`);
    }
  }

  /** create_list(p_list): { created: true } o { created: false } si ya era miembro. */
  private rpcCreateList(uid: string, listId: unknown): Response {
    if (typeof listId !== 'string' || !UUID_RE.test(listId)) {
      return pgError(400, '22P02', 'invalid input syntax for type uuid');
    }
    if (this.tables.list_members.filter((m) => m.user_id === uid).length >= MAX_LISTS_PER_USER) {
      return rpcError('too_many_lists');
    }
    if (this.tables.lists.some((l) => l.id === listId)) {
      if (this.isMember(listId, uid)) return json({ created: false });
      return rpcError('list_exists');
    }
    this.tables.lists.push({ id: listId, created_by: uid, created_at: this.nowIso() });
    this.tables.list_members.push({ list_id: listId, user_id: uid, role: 'owner', joined_at: this.nowIso() });
    return json({ created: true });
  }

  /** accept_invite(p_invite, p_auth): el secreto se comprueba primero; ver list_invites en la migración. */
  private async rpcAcceptInvite(uid: string, inviteId: unknown, auth: unknown): Promise<Response> {
    if (typeof inviteId !== 'string' || !UUID_RE.test(inviteId)) {
      return pgError(400, '22P02', 'invalid input syntax for type uuid');
    }
    const inv = this.tables.list_invites.find((i) => i.id === inviteId);
    if (!inv || typeof auth !== 'string' || !/^[0-9a-f]{64}$/.test(auth)) return rpcError('invite_invalid');
    // SHA-256 de los bytes crudos de p_auth (encode(sha256(decode(p_auth,'hex')),'hex') en SQL).
    const bytes = new Uint8Array(auth.match(/../g)!.map((h) => parseInt(h, 16)));
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    if (digest !== inv.token_hash) return rpcError('invite_invalid');

    const ok = json({ list_id: inv.list_id, wrapped: inv.wrapped });
    if (inv.used_by != null) {
      // Idempotente solo para quien la usó y sigue dentro (la respuesta se perdió y reintenta).
      if (inv.used_by === uid && this.isMember(inv.list_id, uid)) return ok;
      return rpcError('invite_used');
    }
    if (microsOf(inv.expires_at) < this.nowMicros()) return rpcError('invite_expired');
    // Ya era miembro por otra invitación: no gasta esta, que puede ser para otra persona.
    if (this.isMember(inv.list_id, uid)) return ok;
    if (this.sortedMembers(inv.list_id).length >= MAX_MEMBERS) return rpcError('list_full');

    this.tables.list_members.push({ list_id: inv.list_id, user_id: uid, role: 'member', joined_at: this.nowIso() });
    inv.used_by = uid;
    inv.used_at = this.nowIso();
    return ok;
  }

  /** list_members_info(p_list): miembros con email y nombre; [] si no eres miembro. */
  private rpcMembersInfo(uid: string, listId: unknown): Response {
    if (typeof listId !== 'string' || !this.isMember(listId, uid)) return json([]);
    return json(
      this.sortedMembers(listId).map((m) => {
        const u = this.users.get(m.user_id);
        return {
          user_id: m.user_id,
          role: m.role,
          joined_at: m.joined_at,
          email: u?.email ?? null,
          name: u?.name ?? null,
        };
      }),
    );
  }

  /**
   * delete_account(): sale de sus listas (con el trigger), borra sus invitaciones, items, pairings y usuario.
   * Sin migración de listas (sharing = false) solo borra items, pairings y usuario, como la función antigua.
   */
  private rpcDeleteAccount(uid: string): Response {
    if (this.sharing) {
      for (const m of this.tables.list_members.filter((x) => x.user_id === uid)) {
        if (this.tables.list_members.includes(m)) this.leave(m);
      }
      this.tables.list_invites = this.tables.list_invites.filter((i) => i.created_by !== uid);
      for (const l of this.tables.lists) if (l.created_by === uid) l.created_by = null;
      for (const i of this.tables.list_invites) if (i.used_by === uid) i.used_by = null;
    }
    this.tables.items = this.tables.items.filter((r) => r.user_id !== uid);
    this.tables.pairings = this.tables.pairings.filter((r) => r.user_id !== uid);
    this.users.delete(uid);
    for (const [t, id] of [...this.accessTokens]) if (id === uid) this.accessTokens.delete(t);
    for (const [t, id] of [...this.refreshTokens]) if (id === uid) this.refreshTokens.delete(t);
    return empty(204);
  }

  // ---------- utilidades internas ----------

  private sortedMembers(listId: string): Row[] {
    return this.tables.list_members
      .filter((m) => m.list_id === listId)
      .sort((a, b) => microsOf(a.joined_at) - microsOf(b.joined_at) || (a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0));
  }

  private nowMicros(): number {
    return this.now * 1000;
  }

  private nowIso(): string {
    return fmtMicro(this.nowMicros());
  }

  /** synced_at estrictamente creciente: base fija + un microsegundo por escritura. */
  private nextSynced(): string {
    return fmtMicro(BASE_SYNC_MS * 1000 + ++this.syncSeq);
  }
}
