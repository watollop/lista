// Cifrado de extremo a extremo (ver docs/plan-cifrado.md). Solo Web Crypto, sin dependencias.
import type { EncRow, RemoteItem, SyncKind } from '../types';

const enc = new TextEncoder();
const dec = new TextDecoder();
const KINDS: readonly SyncKind[] = ['task', 'topic', 'person', 'filter', 'setting'];
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Error al descifrar una fila: manipulada, de otra clave o mal formada. */
export class CorruptItemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorruptItemError';
  }
}

// ---------- utilidades ----------

export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** HKDF-SHA256 con salt vacío sobre `ikm`, 32 bytes de salida. */
async function hkdf32(ikm: Uint8Array<ArrayBuffer>, info: string): Promise<Uint8Array<ArrayBuffer>> {
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(info) },
    base,
    256,
  );
  return new Uint8Array<ArrayBuffer>(bits);
}

// ---------- clave de datos (DK) ----------

export async function generateDk(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function exportDk(dk: CryptoKey): Promise<string> {
  return toB64(new Uint8Array(await crypto.subtle.exportKey('raw', dk)));
}

async function importRawDk(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

export async function importDk(b64: string): Promise<CryptoKey> {
  return importRawDk(fromB64(b64));
}

// Clave MAC derivada de la DK (HKDF-SHA256, info 'lista-mac'), cacheada por DK.
const macKeys = new WeakMap<CryptoKey, Promise<CryptoKey>>();

function macKeyOf(dk: CryptoKey): Promise<CryptoKey> {
  let p = macKeys.get(dk);
  if (!p) {
    p = (async () => {
      const raw = new Uint8Array(await crypto.subtle.exportKey('raw', dk));
      const bits = await hkdf32(raw, 'lista-mac');
      return crypto.subtle.importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    })();
    macKeys.set(dk, p);
  }
  return p;
}

async function hmacHex(dk: CryptoKey, text: string): Promise<string> {
  const key = await macKeyOf(dk);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}

/** Identificador de la DK (32 hex) para comprobar qué clave cifra sin revelarla. */
export async function keyIdOf(dk: CryptoKey): Promise<string> {
  return (await hmacHex(dk, 'lista-key-id')).slice(0, 32);
}

/** Id opaco de un registro en el servidor: HMAC(DK, kind + ':' + id), 64 hex. Determinista. */
export async function remoteId(dk: CryptoKey, kind: SyncKind, id: string): Promise<string> {
  return hmacHex(dk, `${kind}:${id}`);
}

// ---------- cifrado de registros ----------

// Liga el contenido a su fila, a su versión LWW y a su estado de borrado: el servidor no puede cambiarlos.
function aad(remote: string, updatedAt: number | string, deleted: boolean): Uint8Array<ArrayBuffer> {
  return enc.encode(`enc:${remote}:${updatedAt}:${deleted ? 1 : 0}`);
}

export async function encryptItem(dk: CryptoKey, item: RemoteItem): Promise<EncRow> {
  const id = await remoteId(dk, item.kind, item.id);
  const iv = randomBytes(12);
  const plaintext = enc.encode(JSON.stringify({ kind: item.kind, id: item.id, data: item.data }));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(id, item.updated_at, item.deleted) },
    dk,
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

export async function decryptItem(dk: CryptoKey, row: EncRow): Promise<RemoteItem> {
  try {
    if (row.data.v !== 1) throw new Error('versión desconocida');
    const iv = fromB64(row.data.iv);
    const ct = fromB64(row.data.ct);
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aad(row.id, row.updated_at, row.deleted) },
      dk,
      ct,
    );
    const body = JSON.parse(dec.decode(pt));
    const { kind, id, data } = body ?? {};
    if (!KINDS.includes(kind) || typeof id !== 'string') throw new Error('contenido inválido');
    if ((await remoteId(dk, kind, id)) !== row.id) throw new Error('id no coincide');
    return { kind, id, data, updated_at: row.updated_at, deleted: row.deleted };
  } catch (e) {
    throw new CorruptItemError(`Registro cifrado no válido: ${(e as Error).message}`);
  }
}

// ---------- clave de recuperación ----------

function base32Encode(bytes: Uint8Array<ArrayBuffer>): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = ((value << 8) | b) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** 32 bytes aleatorios en base32 RFC 4648 sin padding, en grupos de 4 separados por '-'. */
export function generateRecoveryKey(): string {
  const chars = base32Encode(randomBytes(32));
  return chars.match(/.{1,4}/g)!.join('-');
}

/** Acepta mayúsculas/minúsculas, espacios y guiones. Lanza Error si no son 32 bytes válidos. */
export function parseRecoveryKey(s: string): Uint8Array<ArrayBuffer> {
  const clean = s.toUpperCase().replace(/[\s-]/g, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('Clave de recuperación con caracteres no válidos');
    value = ((value << 5) | idx) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (out.length !== 32) throw new Error('Clave de recuperación con longitud incorrecta');
  return Uint8Array.from(out);
}

async function recoveryAesKey(recoveryKey: string): Promise<CryptoKey> {
  const bits = await hkdf32(parseRecoveryKey(recoveryKey), 'lista-recovery');
  return crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function wrapWithRecovery(
  dk: CryptoKey,
  recoveryKey: string,
): Promise<{ iv: string; wrapped: string }> {
  const key = await recoveryAesKey(recoveryKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', dk));
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, raw);
  return { iv: toB64(iv), wrapped: toB64(new Uint8Array(ct)) };
}

export async function unwrapWithRecovery(
  rec: { iv: string; wrapped: string },
  recoveryKey: string,
): Promise<CryptoKey> {
  try {
    const key = await recoveryAesKey(recoveryKey);
    const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(rec.iv) }, key, fromB64(rec.wrapped));
    return await importRawDk(new Uint8Array(raw));
  } catch {
    throw new Error('Clave de recuperación incorrecta');
  }
}
