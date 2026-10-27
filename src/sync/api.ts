// Cliente PostgREST mínimo (sin supabase-js). Solo usa fetch.
import type { RemoteItem } from '../types';
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
  items: RemoteItem[],
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
