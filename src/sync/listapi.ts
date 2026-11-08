// Cliente de listas compartidas (PostgREST y RPC, sin supabase-js). Solo usa fetch.
import type { InviteErrorCode, ListInviteInfo, ListMemberInfo, ListMembership } from '../types';
import type { Session, SyncConfig } from './auth';
import type { ListRow } from './listcrypto';
import { authHeaders, httpErrorFrom, httpErrorFromBody, parseBody } from './api';

const PAGE_SIZE = 500;
const PUSH_CHUNK = 200;
const INVITE_FIELDS = 'id,list_id,created_by,created_at,expires_at,used_by,used_at';

const INVITE_MESSAGES: Record<InviteErrorCode, string> = {
  invite_invalid: 'El enlace de invitación no es válido',
  invite_expired: 'El enlace de invitación ha caducado',
  invite_used: 'El enlace de invitación ya se ha usado',
  list_full: 'La lista ya está completa',
};

/** El servidor no tiene el esquema de listas compartidas (404: falta la migración). */
export class SharingUnavailableError extends Error {
  constructor() {
    super('El servidor aún no admite listas compartidas');
    this.name = 'SharingUnavailableError';
  }
}

/** accept_invite ha rechazado el enlace por el motivo indicado en `code`. */
export class InviteRejectedError extends Error {
  code: InviteErrorCode;
  constructor(code: InviteErrorCode) {
    super(INVITE_MESSAGES[code]);
    this.name = 'InviteRejectedError';
    this.code = code;
  }
}

/** Convierte una respuesta no 2xx: 404 es que el servidor no admite listas compartidas; el resto, HttpError. */
async function failure(res: Response): Promise<Error> {
  if (res.status === 404) return new SharingUnavailableError();
  return httpErrorFrom(res);
}

function isInviteCode(v: unknown): v is InviteErrorCode {
  return typeof v === 'string' && Object.keys(INVITE_MESSAGES).includes(v);
}

/**
 * Convierte una clave de invitación en base64url (sin relleno, 43 caracteres para 32 bytes) a hex en minúsculas
 * de los bytes crudos, que es lo que espera accept_invite. Lanza Error si la entrada no es válida.
 */
export function b64urlToHex(s: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(s) || s.length % 4 === 1) throw new Error('La clave de la invitación no es válida');
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  if (bin.length !== 32) throw new Error('La clave de la invitación no es válida');
  let hex = '';
  for (let i = 0; i < bin.length; i++) hex += bin.charCodeAt(i).toString(16).padStart(2, '0');
  return hex;
}

/** Crea la lista en el servidor (RPC create_list). created=false si ya existía y ya era miembro. */
export async function createSharedList(
  cfg: SyncConfig,
  session: Session,
  listId: string,
  fetchImpl: typeof fetch,
): Promise<{ created: boolean }> {
  const res = await fetchImpl(`${cfg.url}/rest/v1/rpc/create_list`, {
    method: 'POST',
    headers: authHeaders(cfg, session),
    body: JSON.stringify({ p_list: listId }),
  });
  if (!res.ok) throw await failure(res);
  const body = (await res.json()) as { created: boolean };
  return { created: body.created === true };
}

/** Membresías del usuario actual: en qué listas compartidas está y con qué rol. */
export async function fetchMemberships(
  cfg: SyncConfig,
  session: Session,
  fetchImpl: typeof fetch,
): Promise<ListMembership[]> {
  const res = await fetchImpl(
    `${cfg.url}/rest/v1/list_members?select=list_id,role,joined_at&user_id=eq.${encodeURIComponent(session.userId)}`,
    { method: 'GET', headers: authHeaders(cfg, session) },
  );
  if (!res.ok) throw await failure(res);
  return (await res.json()) as ListMembership[];
}

/** Sube filas cifradas de una lista compartida en lotes de 200. Son upserts LWW, igual que pushItems. */
export async function pushListItems(
  cfg: SyncConfig,
  session: Session,
  listId: string,
  rows: ListRow[],
  fetchImpl: typeof fetch,
): Promise<void> {
  for (let i = 0; i < rows.length; i += PUSH_CHUNK) {
    const chunk = rows.slice(i, i + PUSH_CHUNK).map((r) => ({
      list_id: listId,
      kind: r.kind,
      id: r.id,
      data: r.data,
      updated_at: r.updated_at,
      deleted: r.deleted,
    }));
    const res = await fetchImpl(`${cfg.url}/rest/v1/list_items?on_conflict=list_id,kind,id`, {
      method: 'POST',
      headers: { ...authHeaders(cfg, session), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) throw await failure(res);
  }
}

interface ListPullRow {
  kind: 'enc';
  id: string;
  data: ListRow['data'];
  updated_at: number | string;
  deleted: boolean;
  synced_at: string;
}

/**
 * Descarga las filas de una lista con synced_at > sinceISO, paginando por synced_at ascendente (igual que pullItems).
 * cursor = synced_at máximo visto (null si no llegó ninguna fila).
 */
export async function pullListItems(
  cfg: SyncConfig,
  session: Session,
  listId: string,
  sinceISO: string | null,
  fetchImpl: typeof fetch,
): Promise<{ rows: ListRow[]; cursor: string | null }> {
  const rows: ListRow[] = [];
  let since = sinceISO;
  let cursor: string | null = null;

  for (;;) {
    const filter = since ? `&synced_at=gt.${encodeURIComponent(since)}` : '';
    const url =
      `${cfg.url}/rest/v1/list_items?select=kind,id,data,updated_at,deleted,synced_at` +
      `&order=synced_at.asc&limit=${PAGE_SIZE}${filter}&list_id=eq.${encodeURIComponent(listId)}`;
    const res = await fetchImpl(url, { method: 'GET', headers: authHeaders(cfg, session) });
    if (!res.ok) throw await failure(res);

    const page = (await res.json()) as ListPullRow[];
    for (const r of page) {
      rows.push({
        kind: r.kind,
        id: r.id,
        data: r.data,
        updated_at: Number(r.updated_at),
        deleted: r.deleted === true,
      });
    }
    if (page.length === 0) break;

    const last = page[page.length - 1].synced_at; // orden ascendente: la última es la máxima
    cursor = last;
    // Página incompleta = no hay más; si el cursor no avanza, cortamos para no entrar en bucle.
    if (page.length < PAGE_SIZE || last === since) break;
    since = last;
  }

  return { rows, cursor };
}

/** Copia solo los campos que ven los miembros: nunca token_hash ni wrapped. */
function toInviteInfo(r: any): ListInviteInfo {
  return {
    id: r.id,
    list_id: r.list_id,
    created_by: r.created_by ?? null,
    created_at: r.created_at,
    expires_at: r.expires_at,
    used_by: r.used_by ?? null,
    used_at: r.used_at ?? null,
  };
}

/** Crea una invitación con el id, el hash del secreto y la clave envuelta ya calculados en el cliente. */
export async function createInvite(
  cfg: SyncConfig,
  session: Session,
  invite: { id: string; list_id: string; token_hash: string; wrapped: string },
  fetchImpl: typeof fetch,
): Promise<ListInviteInfo> {
  const res = await fetchImpl(`${cfg.url}/rest/v1/list_invites?select=${INVITE_FIELDS}`, {
    method: 'POST',
    headers: { ...authHeaders(cfg, session), Prefer: 'return=representation' },
    body: JSON.stringify(invite),
  });
  if (!res.ok) throw await failure(res);
  const rows = (await res.json()) as unknown[];
  if (rows.length === 0) throw new Error('No se pudo crear la invitación');
  return toInviteInfo(rows[0]);
}

/** Invitaciones de una lista que aún no se han usado ni han caducado, más recientes primero. */
export async function listPendingInvites(
  cfg: SyncConfig,
  session: Session,
  listId: string,
  fetchImpl: typeof fetch,
): Promise<ListInviteInfo[]> {
  const now = encodeURIComponent(new Date().toISOString());
  const res = await fetchImpl(
    `${cfg.url}/rest/v1/list_invites?select=${INVITE_FIELDS}` +
      `&list_id=eq.${encodeURIComponent(listId)}&used_by=is.null&expires_at=gt.${now}&order=created_at.desc`,
    { method: 'GET', headers: authHeaders(cfg, session) },
  );
  if (!res.ok) throw await failure(res);
  const rows = (await res.json()) as unknown[];
  return rows.map(toInviteInfo);
}

/** Borra una invitación por id (la revoca). */
export async function deleteInvite(
  cfg: SyncConfig,
  session: Session,
  inviteId: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  const res = await fetchImpl(`${cfg.url}/rest/v1/list_invites?id=eq.${encodeURIComponent(inviteId)}`, {
    method: 'DELETE',
    headers: { ...authHeaders(cfg, session), Prefer: 'return=minimal' },
  });
  if (!res.ok) throw await failure(res);
}

/**
 * Acepta una invitación (RPC accept_invite). `auth` es la clave de autenticación en base64url, tal como la
 * produce inviteKeys. Si el servidor rechaza el enlace, lanza InviteRejectedError con el motivo.
 */
export async function acceptInvite(
  cfg: SyncConfig,
  session: Session,
  inviteId: string,
  auth: string,
  fetchImpl: typeof fetch,
): Promise<{ list_id: string; wrapped: string }> {
  const p_auth = b64urlToHex(auth);
  const res = await fetchImpl(`${cfg.url}/rest/v1/rpc/accept_invite`, {
    method: 'POST',
    headers: authHeaders(cfg, session),
    body: JSON.stringify({ p_invite: inviteId, p_auth }),
  });
  if (res.ok) return (await res.json()) as { list_id: string; wrapped: string };

  if (res.status === 404) throw new SharingUnavailableError();
  // El cuerpo solo se puede leer una vez: se parsea aquí y el error se construye a partir de él.
  const body = await parseBody(res);
  if (res.status === 400 && isInviteCode(body.message)) throw new InviteRejectedError(body.message);
  throw httpErrorFromBody(res.status, body);
}

/** Miembros de una lista con su email y nombre (RPC list_members_info). Vacío si no eres miembro. */
export async function fetchListMembers(
  cfg: SyncConfig,
  session: Session,
  listId: string,
  fetchImpl: typeof fetch,
): Promise<ListMemberInfo[]> {
  const res = await fetchImpl(`${cfg.url}/rest/v1/rpc/list_members_info`, {
    method: 'POST',
    headers: authHeaders(cfg, session),
    body: JSON.stringify({ p_list: listId }),
  });
  if (!res.ok) throw await failure(res);
  return (await res.json()) as ListMemberInfo[];
}

/** Sales de una lista compartida borrando tu propia membresía. */
export async function leaveList(
  cfg: SyncConfig,
  session: Session,
  listId: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  const res = await fetchImpl(
    `${cfg.url}/rest/v1/list_members?list_id=eq.${encodeURIComponent(listId)}` +
      `&user_id=eq.${encodeURIComponent(session.userId)}`,
    { method: 'DELETE', headers: { ...authHeaders(cfg, session), Prefer: 'return=minimal' } },
  );
  if (!res.ok) throw await failure(res);
}

/** Quita a otra persona de la lista. Solo puede el owner (quien la creó o a quien pasó): si RLS filtra la fila, lanza Error. */
export async function removeMember(
  cfg: SyncConfig,
  session: Session,
  listId: string,
  userId: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  const res = await fetchImpl(
    `${cfg.url}/rest/v1/list_members?list_id=eq.${encodeURIComponent(listId)}` +
      `&user_id=eq.${encodeURIComponent(userId)}`,
    { method: 'DELETE', headers: { ...authHeaders(cfg, session), Prefer: 'return=representation' } },
  );
  if (!res.ok) throw await failure(res);
  const removed = (await res.json()) as unknown[];
  if (removed.length === 0) throw new Error('Solo quien administra la lista puede quitar a alguien');
}

/** Borra la lista compartida para todos. Solo puede el owner: si RLS filtra la fila, lanza Error. */
export async function deleteSharedList(
  cfg: SyncConfig,
  session: Session,
  listId: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  const res = await fetchImpl(`${cfg.url}/rest/v1/lists?id=eq.${encodeURIComponent(listId)}`, {
    method: 'DELETE',
    headers: { ...authHeaders(cfg, session), Prefer: 'return=representation' },
  });
  if (!res.ok) throw await failure(res);
  const deleted = (await res.json()) as unknown[];
  if (deleted.length === 0) throw new Error('Solo quien administra la lista puede borrarla para todos');
}
