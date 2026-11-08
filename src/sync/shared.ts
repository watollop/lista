// Sincronización de las listas compartidas (ver docs/plan-listas.md §4.4 y §4.5).
// Cada lista compartida es un espacio aparte: sus tareas (y los temas y personas que usan) viajan cifrados con su
// clave (LK) en list_items, con su propio cursor. El resto sigue en el espacio personal (index.ts).
import { MAIN_LIST } from '../types';
import type { Entity, ID, ListItem, ListMemberInfo, ListMembership, RemoteItem, Repo, Task, TodoList } from '../types';
import type { Session, SyncConfig } from './auth';
import { CorruptItemError } from './crypto';
import {
  SharingUnavailableError,
  acceptInvite,
  createInvite,
  createSharedList,
  deleteSharedList,
  fetchListMembers,
  fetchMemberships,
  leaveList,
  pullListItems,
  pushListItems,
  removeMember,
} from './listapi';
import {
  createInviteSecret,
  decryptListItem,
  encryptListItem,
  exportLk,
  generateLk,
  importLk,
  inviteKeys,
  inviteLink,
  parseInviteFragment,
  unwrapInvite,
  wrapInvite,
} from './listcrypto';
import type { ListRow } from './listcrypto';
import { tr } from '../i18n';

export const listCursorKey = (listId: ID): string => `sync.cursor.list:${listId}`;
export const MEMBERSHIPS_KEY = 'sync.memberships';
export const PENDING_SHARE_KEY = 'sync.pendingShare';
export const LOST_KEY = 'sync.lostLists';

/** Lo que necesita este módulo del sync: servidor, sesión, repo y dos utilidades de index.ts. */
export interface SharedCtx {
  cfg: SyncConfig;
  session: Session;
  repo: Repo;
  fetchImpl: typeof fetch;
  /** Retrocede el cursor unos segundos (commits que llegan fuera de orden). */
  overlapSince: (cursor: string) => string;
  /** True si un registro es demasiado grande para subirlo (se queda pendiente). */
  tooLarge: (kind: string, id: string, data: unknown) => boolean;
}

// ---------- reparto entre espacios (puro) ----------

/** Ids de las listas compartidas vivas en local. */
export function sharedIds(lists: TodoList[]): Set<ID> {
  return new Set(lists.filter((l) => l.deleted === 0 && l.shared).map((l) => l.id));
}

function taskListId(it: RemoteItem): ID | null {
  return it.kind === 'task' ? ((it.data as Task).listId ?? null) : null;
}

/** Pendientes que suben al espacio personal: todo menos las tareas (y tombstones) de listas compartidas. */
export function personalPending(pending: RemoteItem[], shared: Set<ID>): RemoteItem[] {
  return pending.filter((it) => {
    const l = taskListId(it);
    return l === null || !shared.has(l);
  });
}

/**
 * Pendientes del espacio personal que NO se dan por subidos al terminar la subida personal: los registros de las
 * listas compartidas, porque además tienen que llevar su meta (el nombre) a la lista. Los marca la subida de la lista.
 */
export function deferredMark(it: RemoteItem, shared: Set<ID>): boolean {
  return it.kind === 'list' && shared.has(it.id);
}

const stripDirty = <T extends { dirty?: unknown }>(r: T): Omit<T, 'dirty'> => {
  const { dirty: _dirty, ...rest } = r;
  return rest;
};

/**
 * Registros que suben a una lista compartida, a partir de los pendientes al empezar el ciclo (snapshot):
 * - sus tareas pendientes (vivas y tombstones);
 * - los temas y personas que usan esas tareas vivas, y los pendientes del snapshot que usa alguna tarea viva de la lista
 *   (solo vivos: un tema borrado en mi espacio no se borra para los demás);
 * - el meta con el nombre si el registro de la lista está pendiente y su nombre tiene versión (nameAt > 0).
 * `sent` son los pendientes que se darán por subidos si la subida sale bien.
 */
export function sharedPushFor(
  list: TodoList,
  snapshot: RemoteItem[],
  liveTasks: Task[],
  topics: Entity[],
  people: Entity[],
): { items: ListItem[]; sent: RemoteItem[] } {
  const items: ListItem[] = [];
  const sent: RemoteItem[] = [];
  const topicKeys = new Set<string>();
  const personKeys = new Set<string>();

  for (const it of snapshot) {
    if (taskListId(it) !== list.id) continue;
    const t = it.data as Task;
    items.push({ kind: 'task', id: it.id, data: it.data, updated_at: it.updated_at, deleted: it.deleted });
    sent.push(it);
    if (!it.deleted) {
      t.topics?.forEach((k) => topicKeys.add(k));
      t.people?.forEach((k) => personKeys.add(k));
    }
  }

  // Entidades pendientes que usa alguna tarea viva de la lista (p. ej. un tema renombrado).
  const usedTopics = new Set<string>();
  const usedPeople = new Set<string>();
  for (const t of liveTasks) {
    if ((t.listId ?? null) !== list.id) continue;
    t.topics.forEach((k) => usedTopics.add(k));
    t.people.forEach((k) => usedPeople.add(k));
  }
  for (const it of snapshot) {
    if (it.kind === 'topic' && usedTopics.has(it.id)) topicKeys.add(it.id);
    if (it.kind === 'person' && usedPeople.has(it.id)) personKeys.add(it.id);
  }

  for (const e of topics) {
    if (topicKeys.has(e.key) && e.deleted === 0)
      items.push({ kind: 'topic', id: e.key, data: stripDirty(e), updated_at: e.updatedAt, deleted: false });
  }
  for (const e of people) {
    if (personKeys.has(e.key) && e.deleted === 0)
      items.push({ kind: 'person', id: e.key, data: stripDirty(e), updated_at: e.updatedAt, deleted: false });
  }

  const rec = snapshot.find((it) => it.kind === 'list' && it.id === list.id);
  if (rec) {
    sent.push(rec);
    const nameAt = list.shared?.nameAt ?? 0;
    if (nameAt > 0) items.push({ kind: 'meta', id: 'list', data: { name: list.name }, updated_at: nameAt, deleted: false });
  }
  return { items, sent };
}

// ---------- ciclo ----------

async function pushSpace(ctx: SharedCtx, list: TodoList, lk: CryptoKey, snapshot: RemoteItem[]): Promise<void> {
  const { repo } = ctx;
  const [liveTasks, topics, people] = await Promise.all([repo.listTasks(), repo.listTopics(), repo.listPeople()]);
  const { items, sent } = sharedPushFor(list, snapshot, liveTasks, topics, people);
  if (items.length === 0 && sent.length === 0) return;
  const rows: ListRow[] = [];
  const ok = new Set<string>(); // `${kind}|${id}` de los que caben
  for (const it of items) {
    const row = await encryptListItem(lk, list.id, it);
    if (ctx.tooLarge(it.kind, it.id, row.data)) continue;
    rows.push(row);
    ok.add(`${it.kind}|${it.id}`);
  }
  if (rows.length > 0) await pushListItems(ctx.cfg, ctx.session, list.id, rows, ctx.fetchImpl);
  // Un registro demasiado grande sigue pendiente; el de la lista se marca aunque no lleve meta.
  await repo.markPushed(sent.filter((it) => it.kind === 'list' || ok.has(`${it.kind}|${it.id}`)));
}

async function pullSpace(ctx: SharedCtx, list: TodoList, lk: CryptoKey): Promise<number> {
  const { repo } = ctx;
  const stored = await repo.getMeta<string>(listCursorKey(list.id));
  const since = typeof stored === 'string' && stored ? ctx.overlapSince(stored) : null;
  const { rows, cursor } = await pullListItems(ctx.cfg, ctx.session, list.id, since, ctx.fetchImpl);
  const items: ListItem[] = [];
  let skipped = 0;
  for (const row of rows) {
    try {
      items.push(await decryptListItem(lk, list.id, row));
    } catch (e) {
      if (e instanceof CorruptItemError) skipped++; // no se aplica: nunca pisa el local
      else throw e;
    }
  }
  if (skipped > 0) console.warn(`Sync: ${skipped} registro(s) de la lista ${list.id} no válido(s), omitido(s)`);
  if (items.length > 0) await repo.applyShared(list.id, items);
  if (cursor !== null) await repo.setMeta(listCursorKey(list.id), cursor);
  return rows.length;
}

/**
 * Termina un «compartir» que se quedó a medias (la app se cerró entre create_list y markShared). Devuelve true si
 * cambió algo en local: entonces hace falta otra vuelta completa, porque lo nuevo no está en la foto de este ciclo
 * (y el registro de la lista aún no ha subido al espacio personal, que es el que lleva la LK a mis otros dispositivos).
 */
async function resumePendingShare(ctx: SharedCtx): Promise<boolean> {
  const { repo } = ctx;
  const pending = await repo.getMeta<{ listId: ID; lk: string } | null>(PENDING_SHARE_KEY);
  if (!pending || typeof pending.listId !== 'string' || typeof pending.lk !== 'string') return false;
  const list = (await repo.listLists()).find((l) => l.id === pending.listId);
  if (list?.shared) {
    await repo.setMeta(PENDING_SHARE_KEY, null); // ya compartida (aquí o desde otro dispositivo)
    return false;
  }
  if (!list) {
    // La lista ya no existe: se deja la del servidor si llegó a crearse.
    await leaveList(ctx.cfg, ctx.session, pending.listId, ctx.fetchImpl).catch(() => {});
    await repo.setMeta(PENDING_SHARE_KEY, null);
    return false;
  }
  await createSharedList(ctx.cfg, ctx.session, pending.listId, ctx.fetchImpl);
  await repo.markShared(pending.listId, pending.lk);
  await repo.setMeta(PENDING_SHARE_KEY, null);
  return true;
}

/**
 * Fase compartida de un ciclo, después de la subida y la bajada personales (§4.4, pasos 3 a 5).
 * snapshot = pendientes al empezar el ciclo. Devuelve cuántas filas bajaron, los nombres de las listas perdidas y si hace
 * falta otra vuelta (again). Si el servidor no admite listas compartidas (falta la migración), solo da por subidos los
 * registros de lista.
 */
export async function syncSharedSpaces(
  ctx: SharedCtx,
  snapshot: RemoteItem[],
): Promise<{ pulled: number; lost: string[]; again: boolean }> {
  const { repo } = ctx;
  let memberships: ListMembership[];
  try {
    memberships = await fetchMemberships(ctx.cfg, ctx.session, ctx.fetchImpl);
  } catch (e) {
    if (!(e instanceof SharingUnavailableError)) throw e;
    const shared = sharedIds(await repo.listLists());
    await repo.markPushed(snapshot.filter((it) => deferredMark(it, shared)));
    await repo.setMeta(MEMBERSHIPS_KEY, []);
    return { pulled: 0, lost: [], again: false };
  }
  await repo.setMeta(MEMBERSHIPS_KEY, memberships);
  if (await resumePendingShare(ctx)) return { pulled: 0, lost: [], again: true };

  const mine = new Set(memberships.map((m) => m.list_id));
  const lists = (await repo.listLists()).filter((l) => l.shared);
  const lost: string[] = [];
  let pulled = 0;
  for (const list of lists) {
    if (!mine.has(list.id)) {
      const name = await repo.purgeShared(list.id);
      if (name !== null) lost.push(name);
      continue;
    }
    let lk: CryptoKey;
    try {
      lk = await importLk(list.shared!.lk);
    } catch {
      console.warn(`Sync: clave de la lista ${list.id} no válida`);
      continue;
    }
    await pushSpace(ctx, list, lk, snapshot);
    pulled += await pullSpace(ctx, list, lk);
  }
  if (lost.length > 0) {
    const prev = (await repo.getMeta<string[]>(LOST_KEY)) ?? [];
    await repo.setMeta(LOST_KEY, [...prev, ...lost]);
  }
  return { pulled, lost, again: false };
}

// ---------- operaciones (las envuelve index.ts en exclusive y sincroniza después) ----------

async function sharedList(repo: Repo, listId: ID): Promise<TodoList & { shared: NonNullable<TodoList['shared']> }> {
  const list = (await repo.listLists()).find((l) => l.id === listId);
  if (!list || !list.shared) throw new Error(tr('Esa lista no está compartida', 'That list isn’t shared'));
  return list as TodoList & { shared: NonNullable<TodoList['shared']> };
}

/** Pasos 1 a 3 de «compartir» (§4.5): LK, create_list y markShared. El sync y la invitación los hace quien llama. */
export async function shareListLocal(ctx: SharedCtx, listId: ID): Promise<void> {
  const { repo } = ctx;
  const list = (await repo.listLists()).find((l) => l.id === listId);
  if (!list) throw new Error(tr('Lista no encontrada', 'List not found'));
  if (list.shared) return; // ya compartida: solo falta la invitación
  if (listId === MAIN_LIST) throw new Error(tr('La lista Personal no se comparte.', 'The Personal list can’t be shared.'));
  const lk = await exportLk(await generateLk());
  await repo.setMeta(PENDING_SHARE_KEY, { listId, lk });
  const { created } = await createSharedList(ctx.cfg, ctx.session, listId, ctx.fetchImpl);
  if (!created) {
    // Ya existía y soy miembro: un reintento, u otro de mis dispositivos se adelantó (entonces su LK llega por el sync).
    const again = (await repo.listLists()).find((l) => l.id === listId);
    if (again?.shared) {
      await repo.setMeta(PENDING_SHARE_KEY, null);
      return;
    }
  }
  await repo.markShared(listId, lk);
  await repo.setMeta(PENDING_SHARE_KEY, null);
}

/** Enlace de invitación nuevo (un solo uso, 7 días) para una lista compartida. */
export async function createInviteLink(
  ctx: SharedCtx,
  listId: ID,
  origin: string,
): Promise<{ link: string; expiresAt: string }> {
  const list = await sharedList(ctx.repo, listId);
  const lk = await importLk(list.shared.lk);
  const secret = createInviteSecret();
  const inviteId = crypto.randomUUID();
  const { authHash, wrapKey } = await inviteKeys(secret);
  const wrapped = await wrapInvite(wrapKey, inviteId, listId, { lk, name: list.name });
  const info = await createInvite(
    ctx.cfg,
    ctx.session,
    { id: inviteId, list_id: listId, token_hash: authHash, wrapped },
    ctx.fetchImpl,
  );
  return { link: inviteLink(origin, inviteId, secret), expiresAt: info.expires_at };
}

/** Une a este usuario con un enlace (completo o solo el fragmento) y crea la lista en local. El sync, quien llama. */
export async function joinWithLink(ctx: SharedCtx, link: string): Promise<{ listId: ID; name: string }> {
  const hashAt = link.indexOf('#');
  const parsed = parseInviteFragment(hashAt >= 0 ? link.slice(hashAt) : link.trim());
  if (!parsed) throw new Error(tr('Ese enlace de invitación no es válido.', 'That invite link isn’t valid.'));
  const { auth, wrapKey } = await inviteKeys(parsed.secret);
  const { list_id, wrapped } = await acceptInvite(ctx.cfg, ctx.session, parsed.inviteId, auth, ctx.fetchImpl);
  let opened: { lk: CryptoKey; name: string };
  try {
    opened = await unwrapInvite(wrapKey, parsed.inviteId, list_id, wrapped);
  } catch {
    // Sin la LK la membresía no sirve: se deshace para no dejar un miembro fantasma.
    await leaveList(ctx.cfg, ctx.session, list_id, ctx.fetchImpl).catch(() => {});
    throw new Error(tr('La invitación está dañada. Pide un enlace nuevo.', 'The invite is damaged. Ask for a new link.'));
  }
  const list = await ctx.repo.joinShared(list_id, await exportLk(opened.lk), opened.name);
  return { listId: list.id, name: list.name };
}

/** Sale de la lista en el servidor y la quita de este dispositivo. */
export async function leaveShared(ctx: SharedCtx, listId: ID): Promise<void> {
  await sharedList(ctx.repo, listId);
  await leaveList(ctx.cfg, ctx.session, listId, ctx.fetchImpl);
  await ctx.repo.purgeShared(listId);
  await dropMembership(ctx.repo, listId);
}

/** Borra la lista para todos (solo el owner) y la quita de este dispositivo. */
export async function deleteShared(ctx: SharedCtx, listId: ID): Promise<void> {
  await sharedList(ctx.repo, listId);
  await deleteSharedList(ctx.cfg, ctx.session, listId, ctx.fetchImpl);
  await ctx.repo.purgeShared(listId);
  await dropMembership(ctx.repo, listId);
}

export function removeSharedMember(ctx: SharedCtx, listId: ID, userId: string): Promise<void> {
  return removeMember(ctx.cfg, ctx.session, listId, userId, ctx.fetchImpl);
}

export function sharedMembers(ctx: SharedCtx, listId: ID): Promise<ListMemberInfo[]> {
  return fetchListMembers(ctx.cfg, ctx.session, listId, ctx.fetchImpl);
}

async function dropMembership(repo: Repo, listId: ID): Promise<void> {
  const cur = (await repo.getMeta<ListMembership[]>(MEMBERSHIPS_KEY)) ?? [];
  await repo.setMeta(MEMBERSHIPS_KEY, cur.filter((m) => m.list_id !== listId));
}
