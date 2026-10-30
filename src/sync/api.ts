// Cliente PostgREST mínimo (sin supabase-js). Solo usa fetch.
import type { EncRow, KeyRowData, PairingRow, RemoteItem, ServerKind } from '../types';
import type { Session, SyncConfig } from './auth';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

const PAGE_SIZE = 500;
const PUSH_CHUNK = 200;

/** Lee el cuerpo como JSON; si no lo es, devuelve { message: texto }. */
export async function parseBody(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

/** Construye un HttpError a partir de una respuesta no 2xx de PostgREST o Auth. */
export async function httpErrorFrom(res: Response): Promise<HttpError> {
  const body = await parseBody(res);
  const msg = body.message || body.msg || body.error_description || body.error || `HTTP ${res.status}`;
  return new HttpError(res.status, String(msg));
}

function authHeaders(cfg: SyncConfig, session: Session): Record<string, string> {
  return {
    apikey: cfg.anonKey,
    Authorization: `Bearer ${session.accessToken}`,
    'Content-Type': 'application/json',
  };
}

interface PullRow {
  kind: RemoteItem['kind'];
  id: string;
  data: RemoteItem['data'];
  updated_at: number | string;
  deleted: boolean;
  synced_at: string;
}

/** Sube registros en lotes de 200. Las escrituras son upserts LWW (ver supabase/schema.sql). */
export async function pushItems(
  cfg: SyncConfig,
  session: Session,
  items: (RemoteItem | EncRow)[],
  fetchImpl: typeof fetch,
): Promise<void> {
  for (let i = 0; i < items.length; i += PUSH_CHUNK) {
    const rows = items.slice(i, i + PUSH_CHUNK).map((it) => ({
      user_id: session.userId,
      kind: it.kind,
      id: it.id,
      data: it.data,
      updated_at: it.updated_at,
      deleted: it.deleted,
    }));
    const res = await fetchImpl(`${cfg.url}/rest/v1/items?on_conflict=user_id,kind,id`, {
      method: 'POST',
      headers: { ...authHeaders(cfg, session), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    });
    if (!res.ok) throw await httpErrorFrom(res);
  }
}

/**
 * Descarga registros con synced_at > sinceISO, paginando por synced_at ascendente.
 * cursor = synced_at máximo visto (null si no llegó ninguna fila).
 */
export async function pullItems(
  cfg: SyncConfig,
  session: Session,
  sinceISO: string | null,
  fetchImpl: typeof fetch,
): Promise<{ items: RemoteItem[]; cursor: string | null }> {
  const items: RemoteItem[] = [];
  let since = sinceISO;
  let cursor: string | null = null;

  for (;;) {
    const filter = since ? `&synced_at=gt.${encodeURIComponent(since)}` : '';
    const url =
      `${cfg.url}/rest/v1/items?select=kind,id,data,updated_at,deleted,synced_at` +
      `&order=synced_at.asc&limit=${PAGE_SIZE}${filter}`;
    const res = await fetchImpl(url, { method: 'GET', headers: authHeaders(cfg, session) });
    if (!res.ok) throw await httpErrorFrom(res);

    const rows = (await res.json()) as PullRow[];
    for (const r of rows) {
      items.push({
        kind: r.kind,
        id: r.id,
        data: r.data,
        updated_at: Number(r.updated_at),
        deleted: r.deleted === true,
      });
    }
    if (rows.length === 0) break;

    const last = rows[rows.length - 1].synced_at; // orden ascendente: la última es la máxima
    cursor = last;
    // Página incompleta = no hay más; si el cursor no avanza, cortamos para no entrar en bucle.
    if (rows.length < PAGE_SIZE || last === since) break;
    since = last;
  }

  return { items, cursor };
}

/**
 * Elimina la cuenta: llama a la función delete_account (ver supabase/schema.sql), que borra las filas y el
 * usuario. Si la función no existe en el proyecto (404), borra al menos las filas y devuelve account=false.
 */
export async function deleteRemoteAccount(
  cfg: SyncConfig,
  session: Session,
  fetchImpl: typeof fetch,
): Promise<{ account: boolean }> {
  const rpc = await fetchImpl(`${cfg.url}/rest/v1/rpc/delete_account`, {
    method: 'POST',
    headers: authHeaders(cfg, session),
    body: '{}',
  });
  if (rpc.ok) return { account: true };
  if (rpc.status !== 404) throw await httpErrorFrom(rpc);
  const del = await fetchImpl(`${cfg.url}/rest/v1/items?user_id=eq.${encodeURIComponent(session.userId)}`, {
    method: 'DELETE',
    headers: { ...authHeaders(cfg, session), Prefer: 'return=minimal' },
  });
  if (!del.ok) throw await httpErrorFrom(del);
  return { account: false };
}

// ---------- cifrado: fila marcador (kind 'key', id 'dk') ----------

/** Lee la fila marcador de la clave de cifrado. Devuelve null si no existe (cifrado no activado). */
export async function fetchKeyRow(
  cfg: SyncConfig,
  session: Session,
  fetchImpl: typeof fetch,
): Promise<KeyRowData | null> {
  const res = await fetchImpl(`${cfg.url}/rest/v1/items?select=data&kind=eq.key&id=eq.dk`, {
    method: 'GET',
    headers: authHeaders(cfg, session),
  });
  if (!res.ok) throw await httpErrorFrom(res);
  const rows = (await res.json()) as Array<{ data: KeyRowData }>;
  return rows.length > 0 ? rows[0].data : null;
}

/**
 * Inserta la fila marcador si no existe (ignorando el conflicto) y devuelve la que queda en el servidor,
 * que puede ser la de otro dispositivo si se adelantó.
 */
export async function putKeyRow(
  cfg: SyncConfig,
  session: Session,
  data: KeyRowData,
  fetchImpl: typeof fetch,
): Promise<KeyRowData> {
  const res = await fetchImpl(`${cfg.url}/rest/v1/items?on_conflict=user_id,kind,id`, {
    method: 'POST',
    headers: { ...authHeaders(cfg, session), Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify([
      { user_id: session.userId, kind: 'key', id: 'dk', data, updated_at: Date.now(), deleted: false },
    ]),
  });
  if (!res.ok) throw await httpErrorFrom(res);
  const stored = await fetchKeyRow(cfg, session, fetchImpl);
  if (!stored) throw new Error('No se pudo guardar la fila de clave de cifrado');
  return stored;
}

/**
 * Sustituye el contenido de la fila marcador (p. ej. para añadir la clave de recuperación).
 * El trigger LWW descarta en silencio un updated_at menor que el guardado (reloj de este dispositivo atrasado),
 * así que se escribe por encima del actual y se comprueba que la fila cambió. Lanza Error si no existe.
 */
export async function updateKeyRow(
  cfg: SyncConfig,
  session: Session,
  data: KeyRowData,
  fetchImpl: typeof fetch,
): Promise<void> {
  const url = `${cfg.url}/rest/v1/items?kind=eq.key&id=eq.dk`;
  const cur = await fetchImpl(`${url}&select=updated_at`, { method: 'GET', headers: authHeaders(cfg, session) });
  if (!cur.ok) throw await httpErrorFrom(cur);
  const rows = (await cur.json()) as Array<{ updated_at: number | string }>;
  if (rows.length === 0) throw new Error('No se encontró la fila de clave de cifrado');
  const updatedAt = Math.max(Date.now(), Number(rows[0].updated_at) + 1);

  const res = await fetchImpl(url, {
    method: 'PATCH',
    headers: { ...authHeaders(cfg, session), Prefer: 'return=representation' },
    body: JSON.stringify({ data, updated_at: updatedAt }),
  });
  if (!res.ok) throw await httpErrorFrom(res);
  const written = (await res.json()) as unknown[];
  if (written.length === 0) throw new Error('No se pudo guardar la fila de clave de cifrado');
}

/** Borra la fila marcador de la clave de cifrado. */
export async function deleteKeyRow(cfg: SyncConfig, session: Session, fetchImpl: typeof fetch): Promise<void> {
  const res = await fetchImpl(`${cfg.url}/rest/v1/items?kind=eq.key&id=eq.dk`, {
    method: 'DELETE',
    headers: { ...authHeaders(cfg, session), Prefer: 'return=minimal' },
  });
  if (!res.ok) throw await httpErrorFrom(res);
}

// ---------- cifrado: borrados ----------

const DELETE_CHUNK = 100;

/**
 * Borra filas en claro de un tipo dado (p. ej. tras migrar a cifrado), en lotes de 100.
 * Cada id va entre comillas dobles (escapando \ y ") y se codifica para la URL, porque puede contener
 * espacios o comas (las claves de tema). No hace ninguna petición si ids está vacío.
 */
export async function deleteItems(
  cfg: SyncConfig,
  session: Session,
  kind: ServerKind,
  ids: string[],
  fetchImpl: typeof fetch,
): Promise<void> {
  for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
    const list = ids
      .slice(i, i + DELETE_CHUNK)
      .map((id) => encodeURIComponent(`"${id.replace(/["\\]/g, '\\$&')}"`))
      .join(',');
    const res = await fetchImpl(`${cfg.url}/rest/v1/items?kind=eq.${kind}&id=in.(${list})`, {
      method: 'DELETE',
      headers: { ...authHeaders(cfg, session), Prefer: 'return=minimal' },
    });
    if (!res.ok) throw await httpErrorFrom(res);
  }
}

/** Borra todas las filas cifradas (kind 'enc') del usuario actual. */
export async function deleteAllEnc(cfg: SyncConfig, session: Session, fetchImpl: typeof fetch): Promise<void> {
  const res = await fetchImpl(
    `${cfg.url}/rest/v1/items?kind=eq.enc&user_id=eq.${encodeURIComponent(session.userId)}`,
    {
      method: 'DELETE',
      headers: { ...authHeaders(cfg, session), Prefer: 'return=minimal' },
    },
  );
  if (!res.ok) throw await httpErrorFrom(res);
}

// ---------- enlace de dispositivos (tabla pairings, ver docs/plan-cifrado.md §4) ----------

const PAIRINGS = '/rest/v1/pairings';

/** Crea una petición de enlace con la clave pública y el compromiso del dispositivo B. Devuelve la fila creada. */
export async function createPairing(
  cfg: SyncConfig,
  session: Session,
  body: { pk_b: string; commit_b: string },
  fetchImpl: typeof fetch,
): Promise<PairingRow> {
  const res = await fetchImpl(`${cfg.url}${PAIRINGS}`, {
    method: 'POST',
    headers: { ...authHeaders(cfg, session), Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await httpErrorFrom(res);
  const rows = (await res.json()) as PairingRow[];
  if (rows.length === 0) throw new Error('No se pudo crear la petición de enlace');
  return rows[0];
}

/** Lee una petición de enlace por id. null si no existe (o ya fue borrada). */
export async function getPairing(
  cfg: SyncConfig,
  session: Session,
  id: string,
  fetchImpl: typeof fetch,
): Promise<PairingRow | null> {
  const res = await fetchImpl(`${cfg.url}${PAIRINGS}?select=*&id=eq.${encodeURIComponent(id)}`, {
    method: 'GET',
    headers: authHeaders(cfg, session),
  });
  if (!res.ok) throw await httpErrorFrom(res);
  const rows = (await res.json()) as PairingRow[];
  return rows.length > 0 ? rows[0] : null;
}

/** Actualiza campos de una petición de enlace (nonce, clave pública de A, DK envuelta...). */
export async function updatePairing(
  cfg: SyncConfig,
  session: Session,
  id: string,
  patch: Partial<Omit<PairingRow, 'id' | 'created_at' | 'expires_at'>>,
  fetchImpl: typeof fetch,
): Promise<void> {
  const res = await fetchImpl(`${cfg.url}${PAIRINGS}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...authHeaders(cfg, session), Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw await httpErrorFrom(res);
}

/** Borra una petición de enlace por id. */
export async function deletePairing(
  cfg: SyncConfig,
  session: Session,
  id: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  const res = await fetchImpl(`${cfg.url}${PAIRINGS}?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { ...authHeaders(cfg, session), Prefer: 'return=minimal' },
  });
  if (!res.ok) throw await httpErrorFrom(res);
}

/** Peticiones de enlace vigentes (no caducadas), más recientes primero. */
export async function listPendingPairings(
  cfg: SyncConfig,
  session: Session,
  fetchImpl: typeof fetch,
): Promise<PairingRow[]> {
  const now = encodeURIComponent(new Date().toISOString());
  const res = await fetchImpl(
    `${cfg.url}${PAIRINGS}?select=*&expires_at=gt.${now}&order=created_at.desc`,
    { method: 'GET', headers: authHeaders(cfg, session) },
  );
  if (!res.ok) throw await httpErrorFrom(res);
  return (await res.json()) as PairingRow[];
}

/** Borra las peticiones de enlace caducadas. */
export async function deleteExpiredPairings(
  cfg: SyncConfig,
  session: Session,
  fetchImpl: typeof fetch,
): Promise<void> {
  const now = encodeURIComponent(new Date().toISOString());
  const res = await fetchImpl(`${cfg.url}${PAIRINGS}?expires_at=lt.${now}`, {
    method: 'DELETE',
    headers: { ...authHeaders(cfg, session), Prefer: 'return=minimal' },
  });
  if (!res.ok) throw await httpErrorFrom(res);
}
