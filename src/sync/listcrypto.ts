// Cifrado de las listas compartidas (ver docs/plan-listas.md §4.1 y §4.2). Solo Web Crypto, sin dependencias.
// Modelo calcado de crypto.ts: cada lista tiene su clave (LK) y las filas van cifradas con ella.
// Diferencias: el AAD liga cada fila a su lista, y las invitaciones usan un secreto aparte que viaja en el fragmento del enlace.
import { CorruptItemError, fromB64, toB64 } from './crypto';

const enc = new TextEncoder();
const dec = new TextDecoder();

import type { ListItem, ListKind } from '../types';

export type { ListItem, ListKind } from '../types';
const LIST_KINDS: readonly ListKind[] = ['task', 'topic', 'person', 'meta'];

/** Fila tal como la ve el servidor: solo el id opaco, la versión y el estado de borrado son visibles. */
export interface ListRow {
  kind: 'enc';
  id: string;
  data: { v: 1; iv: string; ct: string };
  updated_at: number;
  deleted: boolean;
}

// ---------- utilidades ----------

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** HKDF-SHA256 con salt vacío sobre `ikm`, 32 bytes de salida. Copia local de la de crypto.ts (es privada allí). */
async function hkdf32(ikm: Uint8Array<ArrayBuffer>, info: string): Promise<Uint8Array<ArrayBuffer>> {
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(info) },
    base,
    256,
  );
  return new Uint8Array<ArrayBuffer>(bits);
}

/** base64url sin relleno (los enlaces no pueden llevar '+', '/' ni '='). */
function toB64url(bytes: Uint8Array): string {
  return toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('base64url no válido');
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return fromB64(padded);
}

// ---------- clave de lista (LK) ----------

export async function generateLk(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function exportLk(lk: CryptoKey): Promise<string> {
  return toB64(new Uint8Array(await crypto.subtle.exportKey('raw', lk)));
}

export async function importLk(b64: string): Promise<CryptoKey> {
  // Extraíble: hace falta para exportarla de nuevo al guardarla en el registro personal o al invitar.
  return crypto.subtle.importKey('raw', fromB64(b64), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

// Clave MAC derivada de la LK. La etiqueta 'lista-list-mac' es distinta de 'lista-mac' (la de la DK),
// así que aunque LK y DK tuvieran los mismos bytes, los ids remotos no coincidirían.
const listMacKeys = new WeakMap<CryptoKey, Promise<CryptoKey>>();

function listMacKeyOf(lk: CryptoKey): Promise<CryptoKey> {
  let p = listMacKeys.get(lk);
  if (!p) {
    p = (async () => {
      const raw = new Uint8Array<ArrayBuffer>(await crypto.subtle.exportKey('raw', lk));
      const bits = await hkdf32(raw, 'lista-list-mac');
      return crypto.subtle.importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    })();
    listMacKeys.set(lk, p);
  }
  return p;
}

/** Id opaco de un registro de una lista en el servidor: HMAC(LK, kind + ':' + id), 64 hex. Determinista. */
export async function listRemoteId(lk: CryptoKey, kind: ListKind, id: string): Promise<string> {
  const key = await listMacKeyOf(lk);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(`${kind}:${id}`)));
}

// ---------- cifrado de registros de lista ----------

// Liga el contenido a su lista, a su fila, a su versión LWW y a su estado de borrado.
// El listId impide que el servidor mueva una fila a otra lista: el descifrado fallaría.
function listAad(listId: string, remote: string, updatedAt: number, deleted: boolean): Uint8Array<ArrayBuffer> {
  return enc.encode(`list:${listId}:${remote}:${updatedAt}:${deleted ? 1 : 0}`);
}

export async function encryptListItem(lk: CryptoKey, listId: string, item: ListItem): Promise<ListRow> {
  const id = await listRemoteId(lk, item.kind, item.id);
  const iv = randomBytes(12);
  const plaintext = enc.encode(JSON.stringify({ kind: item.kind, id: item.id, data: item.data }));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: listAad(listId, id, item.updated_at, item.deleted) },
    lk,
    plaintext,
  );
  return {
    kind: 'enc',
    id,
    data: { v: 1, iv: toB64(iv), ct: toB64(new Uint8Array(ct)) },
    updated_at: item.updated_at,
    deleted: item.deleted,
  };
}

export async function decryptListItem(lk: CryptoKey, listId: string, row: ListRow): Promise<ListItem> {
  try {
    if (row.kind !== 'enc') throw new Error('tipo de fila desconocido');
    if (row.data.v !== 1) throw new Error('versión desconocida');
    const iv = fromB64(row.data.iv);
    const ct = fromB64(row.data.ct);
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: listAad(listId, row.id, row.updated_at, row.deleted) },
      lk,
      ct,
    );
    const body = JSON.parse(dec.decode(pt));
    const { kind, id, data } = body ?? {};
    // Un kind fuera de la lista (p. ej. 'filter', que es de espacios personales) no se acepta aunque descifre.
    if (!LIST_KINDS.includes(kind) || typeof id !== 'string') throw new Error('contenido inválido');
    if ((await listRemoteId(lk, kind, id)) !== row.id) throw new Error('id no coincide');
    return { kind, id, data, updated_at: row.updated_at, deleted: row.deleted };
  } catch (e) {
    throw new CorruptItemError(`Registro de lista no válido: ${(e as Error).message}`);
  }
}

// ---------- invitaciones ----------

const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;

/** Un secreto válido son 32 bytes en base64url sin relleno. Se exige forma canónica: el último carácter sin bits sobrantes. */
function isCanonicalSecret(s: string): boolean {
  if (!SECRET_RE.test(s)) return false;
  return toB64url(fromB64url(s)) === s;
}

function secretBytes(secret: string): Uint8Array<ArrayBuffer> {
  if (!isCanonicalSecret(secret)) throw new Error('Secreto de invitación mal formado');
  return fromB64url(secret);
}

/** 32 bytes aleatorios en base64url sin relleno (43 caracteres). Va en el fragmento del enlace. */
export function createInviteSecret(): string {
  return toB64url(randomBytes(32));
}

/**
 * Claves derivadas del secreto. Dos etiquetas HKDF distintas, así que son independientes:
 * - auth: el cliente la envía al servidor para aceptar la invitación; el servidor solo guarda su SHA-256.
 * - wrapKey: cifra { lk, name }. Nunca sale del cliente, y de auth no se puede sacar (HKDF es de una sola vía).
 * Por eso el servidor, aunque lea la tabla de invitaciones, no puede desenvolver la LK.
 */
export async function inviteKeys(secret: string): Promise<{ auth: string; authHash: string; wrapKey: CryptoKey }> {
  const ikm = secretBytes(secret);
  const authBytes = await hkdf32(ikm, 'lista-invite-auth');
  const authHash = toHex(await crypto.subtle.digest('SHA-256', authBytes));
  const wrapRaw = await hkdf32(ikm, 'lista-invite-wrap');
  // No extraíble: nadie puede leer la clave de envoltura, solo usarla.
  const wrapKey = await crypto.subtle.importKey('raw', wrapRaw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  return { auth: toB64url(authBytes), authHash, wrapKey };
}

// El AAD liga la envoltura a una invitación y a una lista concretas: no sirve para otra.
function inviteAad(inviteId: string, listId: string): Uint8Array<ArrayBuffer> {
  return enc.encode(`invite:${inviteId}:${listId}`);
}

/** base64 de iv ‖ AES-GCM(JSON { lk, name }). */
export async function wrapInvite(
  wrapKey: CryptoKey,
  inviteId: string,
  listId: string,
  payload: { lk: CryptoKey; name: string },
): Promise<string> {
  const iv = randomBytes(12);
  const plaintext = enc.encode(JSON.stringify({ lk: await exportLk(payload.lk), name: payload.name }));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: inviteAad(inviteId, listId) }, wrapKey, plaintext),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return toB64(out);
}

export async function unwrapInvite(
  wrapKey: CryptoKey,
  inviteId: string,
  listId: string,
  wrapped: string,
): Promise<{ lk: CryptoKey; name: string }> {
  try {
    const all = fromB64(wrapped);
    if (all.length <= 12) throw new Error('envoltura demasiado corta');
    const iv = all.slice(0, 12);
    const ct = all.slice(12);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: inviteAad(inviteId, listId) }, wrapKey, ct);
    const body = JSON.parse(dec.decode(pt));
    const { lk, name } = body ?? {};
    if (typeof lk !== 'string' || typeof name !== 'string') throw new Error('contenido inválido');
    return { lk: await importLk(lk), name };
  } catch (e) {
    throw new CorruptItemError(`Invitación no válida: ${(e as Error).message}`);
  }
}

/** Enlace de invitación: el secreto va detrás de '#', que el navegador no envía al servidor. */
export function inviteLink(origin: string, inviteId: string, secret: string): string {
  return `${origin}/#unirse=${inviteId}.${secret}`;
}

const FRAGMENT_RE = /^#?unirse=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/i;

/** Acepta `#unirse=<uuid>.<secreto>` (con o sin '#'). Cualquier otra cosa → null. */
export function parseInviteFragment(hash: string): { inviteId: string; secret: string } | null {
  if (typeof hash !== 'string') return null;
  const m = FRAGMENT_RE.exec(hash);
  if (!m || !isCanonicalSecret(m[2])) return null;
  return { inviteId: m[1].toLowerCase(), secret: m[2] };
}
