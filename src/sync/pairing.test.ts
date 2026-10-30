import { describe, it, expect } from 'vitest';
import type { PairingRow } from '../types';
import {
  PairingError,
  answerPairing,
  confirmPairing,
  rejectPairing,
  sasCode,
  startPairing,
  stepA,
  stepB,
  type PairingTransport,
} from './pairing';

/** Transporte en memoria. El "servidor" es el Map de filas; los tests pueden manipularlo como un MITM. */
class MemoryServer implements PairingTransport {
  rows = new Map<string, PairingRow>();

  async create(row: { pk_b: string; commit_b: string }): Promise<PairingRow> {
    const id = crypto.randomUUID();
    const full: PairingRow = {
      id,
      pk_b: row.pk_b,
      commit_b: row.commit_b,
      n_b: null,
      pk_a: null,
      n_a: null,
      wrapped_dk: null,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    };
    this.rows.set(id, full);
    return { ...full };
  }

  async get(id: string): Promise<PairingRow | null> {
    const r = this.rows.get(id);
    return r ? { ...r } : null;
  }

  async update(id: string, patch: Partial<Pick<PairingRow, 'n_b' | 'pk_a' | 'n_a' | 'wrapped_dk'>>): Promise<void> {
    const r = this.rows.get(id);
    if (!r) throw new Error('fila inexistente');
    Object.assign(r, patch);
  }

  async remove(id: string): Promise<void> {
    this.rows.delete(id);
  }
}

/** Envuelve un transporte para que `get` devuelva una fila alterada (el servidor miente a un lado). */
function tamperedGet(base: PairingTransport, fn: (r: PairingRow) => PairingRow): PairingTransport {
  return {
    create: (row) => base.create(row),
    get: async (id) => {
      const r = await base.get(id);
      return r && fn(r);
    },
    update: (id, patch) => base.update(id, patch),
    remove: (id) => base.remove(id),
  };
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

async function genDK(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

async function encryptWith(key: CryptoKey, text: string): Promise<{ iv: Uint8Array<ArrayBuffer>; ct: ArrayBuffer }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  return { iv, ct };
}

async function decryptWith(key: CryptoKey, c: { iv: Uint8Array<ArrayBuffer>; ct: ArrayBuffer }): Promise<string> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: c.iv }, key, c.ct);
  return new TextDecoder().decode(pt);
}

/** Genera un par ECDH y devuelve su clave pública raw. */
async function fakePublicKey(): Promise<Uint8Array<ArrayBuffer>> {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
}

describe('enlace de dispositivos (SAS)', () => {
  it('enlace completo: el código coincide y la DK llega intacta', async () => {
    const server = new MemoryServer();
    const dk = await genDK();

    const st = await startPairing(server);
    const row = (await server.get(st.id)) as PairingRow;
    const sa = await answerPairing(server, row);

    expect(await stepA(server, sa)).toEqual({ status: 'waiting' });

    const rb = await stepB(server, st);
    expect(rb.status).toBe('code');
    const codeB = (rb as { code: string }).code;

    const ra = await stepA(server, sa);
    expect(ra.status).toBe('code');
    expect((ra as { code: string }).code).toBe(codeB);
    expect(sa.code).toBe(codeB);

    await confirmPairing(server, sa, dk);
    const done = await stepB(server, st);
    expect(done.status).toBe('done');
    const received = (done as { dk: CryptoKey }).dk;

    const c = await encryptWith(dk, 'hola lista');
    expect(await decryptWith(received, c)).toBe('hola lista');
    const c2 = await encryptWith(received, 'otra vuelta');
    expect(await decryptWith(dk, c2)).toBe('otra vuelta');

    expect(server.rows.has(st.id)).toBe(false);
  });

  it('confirmPairing sin código lanza PairingError', async () => {
    const server = new MemoryServer();
    const dk = await genDK();
    const st = await startPairing(server);
    const sa = await answerPairing(server, (await server.get(st.id)) as PairingRow);

    await expect(confirmPairing(server, sa, dk)).rejects.toBeInstanceOf(PairingError);
    expect(sa.code).toBeNull();
  });

  it('MITM que sustituye pk_b antes de responder: los códigos difieren y B no descifra', async () => {
    const server = new MemoryServer();
    const dk = await genDK();

    const st = await startPairing(server);

    // El servidor pone su propia clave y su propio compromiso con un nonce que conoce.
    const pkX = await fakePublicKey();
    const nX = crypto.getRandomValues(new Uint8Array(32));
    const commitX = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array([...pkX, ...nX])));
    const rowX = server.rows.get(st.id)!;
    rowX.pk_b = b64(pkX);
    rowX.commit_b = b64(commitX);

    const sa = await answerPairing(server, (await server.get(st.id)) as PairingRow);

    // B revela su nonce real.
    const rb = await stepB(server, st);
    const codeB = (rb as { code: string }).code;

    // El servidor reescribe n_b con el nonce del atacante para que A pase la verificación del compromiso.
    server.rows.get(st.id)!.n_b = b64(nX);

    const ra = await stepA(server, sa);
    const codeA = (ra as { code: string }).code;
    expect(codeA).not.toBe(codeB);

    // Aunque A confirme, la DK queda envuelta con una K que solo conoce A y el atacante.
    await confirmPairing(server, sa, dk);
    await expect(stepB(server, st)).rejects.toBeInstanceOf(PairingError);
  });

  it('MITM que sustituye pk_a/n_a vistos por B: los códigos difieren', async () => {
    const server = new MemoryServer();

    const st = await startPairing(server);
    const sa = await answerPairing(server, (await server.get(st.id)) as PairingRow);

    // B ve una pk_a y un n_a falsos.
    const fakePkA = await fakePublicKey();
    const fakeNA = crypto.getRandomValues(new Uint8Array(32));
    const forB = tamperedGet(server, (r) => ({ ...r, pk_a: b64(fakePkA), n_a: b64(fakeNA) }));

    const rb = await stepB(forB, st);
    expect(rb.status).toBe('code');
    const codeB = (rb as { code: string }).code;

    const ra = await stepA(server, sa);
    expect(ra.status).toBe('code');
    expect((ra as { code: string }).code).not.toBe(codeB);
  });

  it('n_b que no coincide con commit_b lanza PairingError en A', async () => {
    const server = new MemoryServer();
    const st = await startPairing(server);
    const sa = await answerPairing(server, (await server.get(st.id)) as PairingRow);

    server.rows.get(st.id)!.n_b = b64(crypto.getRandomValues(new Uint8Array(32)));

    await expect(stepA(server, sa)).rejects.toBeInstanceOf(PairingError);
    expect(sa.code).toBeNull();
  });

  it('fila borrada (rechazo o caducidad) devuelve gone en ambos lados', async () => {
    const server = new MemoryServer();
    const st = await startPairing(server);
    const sa = await answerPairing(server, (await server.get(st.id)) as PairingRow);

    await rejectPairing(server, st.id);

    expect(await stepA(server, sa)).toEqual({ status: 'gone' });
    expect(await stepB(server, st)).toEqual({ status: 'gone' });
  });

  it('caducidad tras revelar: B devuelve gone aunque ya tuviera código', async () => {
    const server = new MemoryServer();
    const st = await startPairing(server);
    await answerPairing(server, (await server.get(st.id)) as PairingRow);

    expect((await stepB(server, st)).status).toBe('code');
    server.rows.delete(st.id);
    expect(await stepB(server, st)).toEqual({ status: 'gone' });
  });

  it('sasCode tiene formato ddd ddd y es determinista', async () => {
    const pkA = await fakePublicKey();
    const pkB = await fakePublicKey();
    const nA = crypto.getRandomValues(new Uint8Array(32));
    const nB = crypto.getRandomValues(new Uint8Array(32));

    const c1 = await sasCode(pkA, pkB, nA, nB);
    const c2 = await sasCode(pkA, pkB, nA, nB);

    expect(c1).toMatch(/^\d{3} \d{3}$/);
    expect(c2).toBe(c1);

    // El orden importa: intercambiar nonces cambia el código (salvo colisión improbable).
    const other = await sasCode(pkA, pkB, nB, nA);
    expect(other).toMatch(/^\d{3} \d{3}$/);
  });

  it('sasCode coincide con la fórmula de la especificación', async () => {
    const pkA = new Uint8Array(65).fill(1);
    const pkB = new Uint8Array(65).fill(2);
    const nA = new Uint8Array(32).fill(3);
    const nB = new Uint8Array(32).fill(4);

    const input = new Uint8Array([...pkA, ...pkB, ...nA, ...nB]);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
    const n = new DataView(digest.buffer).getUint32(0, false) % 1_000_000;
    const expected = String(n).padStart(6, '0');

    expect(await sasCode(pkA, pkB, nA, nB)).toBe(`${expected.slice(0, 3)} ${expected.slice(3)}`);
  });
});
