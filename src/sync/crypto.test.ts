import { describe, it, expect } from 'vitest';
import type { EncRow, RemoteItem } from '../types';
import {
  CorruptItemError,
  decryptItem,
  encryptItem,
  exportDk,
  fromB64,
  generateDk,
  generateRecoveryKey,
  importDk,
  keyIdOf,
  parseRecoveryKey,
  remoteId,
  toB64,
  unwrapWithRecovery,
  wrapWithRecovery,
} from './crypto';

const task = (title = 'Comprar pan de centeno'): RemoteItem => ({
  kind: 'task',
  id: 't-1',
  data: {
    id: 't-1',
    title,
    topics: ['casa'],
    people: [],
    due: null,
    priority: null,
    recurrence: null,
    parentId: null,
    done: 0,
    doneAt: null,
    nextId: null,
    order: 1,
    createdAt: 1,
  } as unknown as RemoteItem['data'],
  updated_at: 1700000000000,
  deleted: false,
});

const setting = (): RemoteItem => ({
  kind: 'setting',
  id: 'theme',
  data: { key: 'theme', value: 'dark' } as RemoteItem['data'],
  updated_at: 1700000000005,
  deleted: false,
});

describe('cifrado de registros', () => {
  it('round-trip de una tarea y de un setting', async () => {
    const dk = await generateDk();
    for (const item of [task(), setting()]) {
      const row = await encryptItem(dk, item);
      expect(row.kind).toBe('enc');
      expect(await decryptItem(dk, row)).toEqual(item);
    }
  });

  it('dos cifrados del mismo item: iv y ct distintos, mismo id', async () => {
    const dk = await generateDk();
    const a = await encryptItem(dk, task());
    const b = await encryptItem(dk, task());
    expect(a.id).toBe(b.id);
    expect(a.data.iv).not.toBe(b.data.iv);
    expect(a.data.ct).not.toBe(b.data.ct);
  });

  it('el ciphertext no contiene el título en claro', async () => {
    const dk = await generateDk();
    const row = await encryptItem(dk, task('Comprar pan de centeno'));
    expect(JSON.stringify(row)).not.toContain('Comprar pan');
    expect(JSON.stringify(row)).not.toContain('casa');
    const ctText = new TextDecoder().decode(fromB64(row.data.ct));
    expect(ctText).not.toContain('Comprar');
  });

  it('manipular id, updated_at, ct o iv hace que decryptItem lance CorruptItemError', async () => {
    const dk = await generateDk();
    const row = await encryptItem(dk, task());
    const flipB64 = (s: string) => {
      const bytes = fromB64(s);
      bytes[0] ^= 1;
      return toB64(bytes);
    };
    const tampered: EncRow[] = [
      { ...row, id: 'f'.repeat(64) },
      { ...row, updated_at: row.updated_at + 1 },
      { ...row, deleted: !row.deleted },
      { ...row, data: { ...row.data, ct: flipB64(row.data.ct) } },
      { ...row, data: { ...row.data, iv: flipB64(row.data.iv) } },
      { ...row, data: { ...row.data, v: 2 as 1 } },
      { ...row, data: { ...row.data, ct: '!!no-base64!!' } },
    ];
    for (const t of tampered) {
      await expect(decryptItem(dk, t)).rejects.toBeInstanceOf(CorruptItemError);
    }
    await expect(decryptItem(dk, row)).resolves.toBeDefined();
  });

  it('CorruptItemError tiene name correcto', async () => {
    const dk = await generateDk();
    const row = await encryptItem(dk, task());
    const err = await decryptItem(dk, { ...row, updated_at: 0 }).catch((e) => e);
    expect(err).toBeInstanceOf(CorruptItemError);
    expect(err.name).toBe('CorruptItemError');
  });

  it('una DK distinta no descifra', async () => {
    const dk1 = await generateDk();
    const dk2 = await generateDk();
    const row = await encryptItem(dk1, task());
    await expect(decryptItem(dk2, row)).rejects.toBeInstanceOf(CorruptItemError);
  });

  it('remoteId y keyId son deterministas y distintos para DK distintas', async () => {
    const dk1 = await generateDk();
    const dk2 = await generateDk();
    expect(await remoteId(dk1, 'task', 't-1')).toBe(await remoteId(dk1, 'task', 't-1'));
    expect(await remoteId(dk1, 'task', 't-1')).toMatch(/^[0-9a-f]{64}$/);
    expect(await remoteId(dk1, 'task', 't-1')).not.toBe(await remoteId(dk2, 'task', 't-1'));
    expect(await remoteId(dk1, 'task', 't-1')).not.toBe(await remoteId(dk1, 'topic', 't-1'));
    expect(await keyIdOf(dk1)).toBe(await keyIdOf(dk1));
    expect(await keyIdOf(dk1)).toMatch(/^[0-9a-f]{32}$/);
    expect(await keyIdOf(dk1)).not.toBe(await keyIdOf(dk2));
  });

  it('exportDk/importDk: el id y el descifrado siguen funcionando', async () => {
    const dk = await generateDk();
    const copy = await importDk(await exportDk(dk));
    expect(await keyIdOf(copy)).toBe(await keyIdOf(dk));
    expect(await remoteId(copy, 'task', 't-1')).toBe(await remoteId(dk, 'task', 't-1'));
    const row = await encryptItem(dk, task());
    expect(await decryptItem(copy, row)).toEqual(task());
    const rowFromCopy = await encryptItem(copy, task());
    expect(await decryptItem(dk, rowFromCopy)).toEqual(task());
  });
});

describe('clave de recuperación', () => {
  it('formato: grupos de 4 separados por guiones, solo A-Z2-7', () => {
    const key = generateRecoveryKey();
    expect(key).toMatch(/^([A-Z2-7]{4}-){12}[A-Z2-7]{4}$/);
    expect(key.replace(/-/g, '')).toHaveLength(52);
    expect(generateRecoveryKey()).not.toBe(key);
  });

  it('parse tolerante: minúsculas, espacios y sin guiones', () => {
    const key = generateRecoveryKey();
    const expected = parseRecoveryKey(key);
    expect(expected).toHaveLength(32);
    expect(parseRecoveryKey(key.toLowerCase())).toEqual(expected);
    expect(parseRecoveryKey(key.replace(/-/g, ' '))).toEqual(expected);
    expect(parseRecoveryKey(key.replace(/-/g, ''))).toEqual(expected);
    expect(parseRecoveryKey('  ' + key.toLowerCase().replace(/-/g, '  ') + '\n')).toEqual(expected);
  });

  it('parse rechaza longitud incorrecta y caracteres inválidos', () => {
    const key = generateRecoveryKey();
    expect(() => parseRecoveryKey(key.slice(0, -4))).toThrow(Error);
    expect(() => parseRecoveryKey(key + 'AAAA')).toThrow(Error);
    expect(() => parseRecoveryKey('')).toThrow(Error);
    expect(() => parseRecoveryKey(key.slice(0, -1) + '1')).toThrow(Error); // '1' no está en A-Z2-7
    expect(() => parseRecoveryKey(key.slice(0, -1) + '!')).toThrow(Error);
  });

  it('wrap/unwrap round-trip: la DK recuperada descifra los mismos datos', async () => {
    const dk = await generateDk();
    const recKey = generateRecoveryKey();
    const rec = await wrapWithRecovery(dk, recKey);
    const restored = await unwrapWithRecovery(rec, recKey.toLowerCase().replace(/-/g, ' '));
    expect(await exportDk(restored)).toBe(await exportDk(dk));
    const row = await encryptItem(dk, task());
    expect(await decryptItem(restored, row)).toEqual(task());
  });

  it('clave de recuperación equivocada lanza error', async () => {
    const dk = await generateDk();
    const rec = await wrapWithRecovery(dk, generateRecoveryKey());
    await expect(unwrapWithRecovery(rec, generateRecoveryKey())).rejects.toThrow('Clave de recuperación incorrecta');
  });
});
