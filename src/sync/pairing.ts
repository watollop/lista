/**
 * Enlace de dispositivos por SAS (ver docs/plan-cifrado.md §4, "Protocolo de enlace").
 *
 * Pasos: B (nuevo) crea una fila con pkB y el compromiso cB = SHA-256(pkB ‖ nB) sin revelar nB.
 * A (activado) responde con pkA y nA. B revela nB, A comprueba el compromiso y ambos calculan
 * el mismo código corto (SAS). Tras confirmarlo en A, A cifra la DK con K = HKDF(ECDH) y B la descifra.
 *
 * Por qué el compromiso sirve: como B fija pkB y nB antes de conocer pkA y nA, el servidor no puede
 * elegir sus claves en función de las del otro dispositivo. Para que el código coincida tendría que
 * adivinar 6 dígitos a ciegas, es decir, 1 entre 10^6 por intento, y cada intento exige confirmación
 * del usuario.
 *
 * Todo el estado se pasa explícitamente (sin globales). El transporte se inyecta.
 */
import type { PairingRow } from '../types';

export interface PairingTransport {
  create(row: { pk_b: string; commit_b: string }): Promise<PairingRow>;
  get(id: string): Promise<PairingRow | null>;
  update(id: string, patch: Partial<Pick<PairingRow, 'n_b' | 'pk_a' | 'n_a' | 'wrapped_dk'>>): Promise<void>;
  remove(id: string): Promise<void>;
}

export class PairingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PairingError';
  }
}

/** Estado del lado B (dispositivo nuevo). pkA y nA guardan lo que B vio al revelar nB. */
export interface BState {
  id: string;
  keyPair: CryptoKeyPair;
  pkB: Uint8Array<ArrayBuffer>;
  nB: Uint8Array<ArrayBuffer>;
  revealed: boolean;
  code: string | null;
  /** pk_a y n_a (base64) tal como se revelaron. Sirven para detectar cambios posteriores. */
  pkA: string | null;
  nA: string | null;
}

/** Estado del lado A (dispositivo activado). */
export interface AState {
  id: string;
  keyPair: CryptoKeyPair;
  pkA: Uint8Array<ArrayBuffer>;
  nA: Uint8Array<ArrayBuffer>;
  pkB: Uint8Array<ArrayBuffer>;
  commitB: string;
  code: string | null;
}

const ECDH_PARAMS = { name: 'ECDH', namedCurve: 'P-256' } as const;
const NONCE_BYTES = 32;
const IV_BYTES = 12;
const enc = new TextEncoder();

// ---------- helpers privados ----------

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n));
}

async function sha256(...parts: Uint8Array[]): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', concat(...parts)));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function generateKeyPair(): Promise<CryptoKeyPair> {
  // La clave pública es siempre exportable; la privada no lo es.
  return crypto.subtle.generateKey(ECDH_PARAMS, false, ['deriveBits']);
}

async function exportPublic(kp: CryptoKeyPair): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
}

/**
 * K = HKDF-SHA256(ECDH(priv, pkPeer)), salt = SHA-256(pkA ‖ pkB), info = 'lista-pairing',
 * resultado AES-GCM 256. Ambos lados llegan a la misma K porque el ECDH es simétrico.
 */
async function deriveK(
  priv: CryptoKey,
  pkPeer: Uint8Array<ArrayBuffer>,
  pkA: Uint8Array<ArrayBuffer>,
  pkB: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  let shared: ArrayBuffer;
  try {
    const peer = await crypto.subtle.importKey('raw', pkPeer, ECDH_PARAMS, false, []);
    shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, priv, 256);
  } catch {
    throw new PairingError('Clave pública del enlace no válida');
  }
  const base = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: await sha256(pkA, pkB),
      info: enc.encode('lista-pairing'),
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ---------- API pública ----------

/**
 * Código SAS: SHA-256(pkA ‖ pkB ‖ nA ‖ nB), primeros 4 bytes como uint32 BE, mod 10^6,
 * con ceros a la izquierda y formato 'ddd ddd'.
 */
export async function sasCode(pkA: Uint8Array, pkB: Uint8Array, nA: Uint8Array, nB: Uint8Array): Promise<string> {
  const digest = await sha256(pkA, pkB, nA, nB);
  const n = new DataView(digest.buffer, digest.byteOffset, digest.byteLength).getUint32(0, false) % 1_000_000;
  const s = String(n).padStart(6, '0');
  return `${s.slice(0, 3)} ${s.slice(3)}`;
}

/** Lado B: genera su par ECDH y nB, y crea la fila con el compromiso. */
export async function startPairing(t: PairingTransport): Promise<BState> {
  const keyPair = await generateKeyPair();
  const pkB = await exportPublic(keyPair);
  const nB = randomBytes(NONCE_BYTES);
  const commitB = await sha256(pkB, nB);
  const row = await t.create({ pk_b: toBase64(pkB), commit_b: toBase64(commitB) });
  return { id: row.id, keyPair, pkB, nB, revealed: false, code: null, pkA: null, nA: null };
}

/**
 * Lado B: avanza el enlace.
 * - Si A ya respondió y aún no se reveló nB, lo revela y muestra el código.
 * - Si hay wrapped_dk, descifra la DK, borra la fila y devuelve 'done'.
 */
export async function stepB(
  t: PairingTransport,
  st: BState,
): Promise<{ status: 'waiting' } | { status: 'code'; code: string } | { status: 'done'; dk: CryptoKey } | { status: 'gone' }> {
  const row = await t.get(st.id);
  if (!row) return { status: 'gone' };

  if (row.pk_a && row.n_a && !st.revealed) {
    await t.update(st.id, { n_b: toBase64(st.nB) });
    const pkA = fromBase64(row.pk_a);
    const nA = fromBase64(row.n_a);
    st.code = await sasCode(pkA, st.pkB, nA, st.nB);
    st.pkA = row.pk_a;
    st.nA = row.n_a;
    st.revealed = true;
    return { status: 'code', code: st.code };
  }

  if (!st.revealed) return { status: 'waiting' };

  if (row.pk_a !== st.pkA || row.n_a !== st.nA) {
    throw new PairingError('El enlace ha cambiado después de revelar el código');
  }

  if (!row.wrapped_dk) return { status: 'code', code: st.code as string };

  const pkA = fromBase64(row.pk_a as string);
  const buf = fromBase64(row.wrapped_dk);
  if (buf.length <= IV_BYTES) throw new PairingError('Clave envuelta no válida');
  const iv = buf.slice(0, IV_BYTES);
  const ct = buf.slice(IV_BYTES);

  const K = await deriveK(st.keyPair.privateKey, pkA, pkA, st.pkB);
  let raw: ArrayBuffer;
  try {
    raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(st.id) }, K, ct);
  } catch {
    throw new PairingError('No se pudo descifrar la clave del enlace');
  }
  const dk = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  await t.remove(st.id);
  return { status: 'done', dk };
}

/** Lado A: genera su par ECDH y nA, y los escribe en la fila que ha visto. */
export async function answerPairing(t: PairingTransport, row: PairingRow): Promise<AState> {
  const keyPair = await generateKeyPair();
  const pkA = await exportPublic(keyPair);
  const nA = randomBytes(NONCE_BYTES);
  await t.update(row.id, { pk_a: toBase64(pkA), n_a: toBase64(nA) });
  return {
    id: row.id,
    keyPair,
    pkA,
    nA,
    pkB: fromBase64(row.pk_b),
    commitB: row.commit_b,
    code: null,
  };
}

/**
 * Lado A: comprueba si B ya reveló nB. Verifica el compromiso y que pk_b/commit_b no hayan
 * cambiado, y entonces calcula el código.
 */
export async function stepA(
  t: PairingTransport,
  st: AState,
): Promise<{ status: 'waiting' } | { status: 'code'; code: string } | { status: 'gone' }> {
  const row = await t.get(st.id);
  if (!row) return { status: 'gone' };
  if (!row.n_b) return { status: 'waiting' };

  const nB = fromBase64(row.n_b);
  const commit = await sha256(st.pkB, nB);
  if (!bytesEqual(commit, fromBase64(st.commitB))) {
    throw new PairingError('El nonce de B no coincide con el compromiso');
  }
  if (!bytesEqual(fromBase64(row.pk_b), st.pkB) || row.commit_b !== st.commitB) {
    throw new PairingError('La clave o el compromiso de B han cambiado');
  }

  st.code = await sasCode(st.pkA, st.pkB, st.nA, nB);
  return { status: 'code', code: st.code };
}

/** Lado A: tras confirmar el código, cifra la DK con K y la escribe en la fila. */
export async function confirmPairing(t: PairingTransport, st: AState, dk: CryptoKey): Promise<void> {
  if (st.code === null) throw new PairingError('El código aún no se ha calculado');

  const K = await deriveK(st.keyPair.privateKey, st.pkB, st.pkA, st.pkB);
  let raw: ArrayBuffer;
  try {
    raw = await crypto.subtle.exportKey('raw', dk);
  } catch {
    throw new PairingError('La clave de datos no es extraíble');
  }
  const iv = randomBytes(IV_BYTES);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(st.id) }, K, raw),
  );
  await t.update(st.id, { wrapped_dk: toBase64(concat(iv, ct)) });
}

/** Rechaza o cancela el enlace borrando la fila. */
export async function rejectPairing(t: PairingTransport, id: string): Promise<void> {
  await t.remove(id);
}
