import { describe, it, expect } from 'vitest';
import { CorruptItemError, fromB64, generateDk, importDk, exportDk, remoteId, toB64 } from './crypto';
import {
  createInviteSecret,
  decryptListItem,
  encryptListItem,
  exportLk,
  generateLk,
  importLk,
  inviteKeys,
  inviteLink,
  listRemoteId,
  parseInviteFragment,
  unwrapInvite,
  wrapInvite,
  type ListItem,
  type ListKind,
  type ListRow,
} from './listcrypto';

const task = (title = 'Comprar pan de centeno'): ListItem => ({
  kind: 'task',
  id: 't-1',
  data: { id: 't-1', title, topics: ['casa'], done: 0 },
  updated_at: 1700000000000,
  deleted: false,
});

const meta = (): ListItem => ({
  kind: 'meta',
  id: 'list',
  data: { name: 'Compra' },
  updated_at: 1700000000005,
  deleted: false,
});

const LIST = 'list-aaaa';
const SECRET_ZERO = 'A'.repeat(43); // 32 bytes a cero, forma canónica

describe('cifrado de registros de lista', () => {
  it('round-trip de tarea, tema, persona y meta', async () => {
    const lk = await generateLk();
    const items: ListItem[] = [
      task(),
      { kind: 'topic', id: 'casa', data: { name: 'casa' }, updated_at: 1, deleted: false },
      { kind: 'person', id: 'ana', data: { name: 'Ana' }, updated_at: 2, deleted: true },
      meta(),
    ];
    for (const item of items) {
      const row = await encryptListItem(lk, LIST, item);
      expect(row.kind).toBe('enc');
      expect(await decryptListItem(lk, LIST, row)).toEqual(item);
    }
  });

  it('dos cifrados del mismo item: iv y ct distintos, mismo id', async () => {
    const lk = await generateLk();
    const a = await encryptListItem(lk, LIST, task());
    const b = await encryptListItem(lk, LIST, task());
    expect(a.id).toBe(b.id);
    expect(a.data.iv).not.toBe(b.data.iv);
    expect(a.data.ct).not.toBe(b.data.ct);
  });

  it('el ciphertext no contiene el título ni los temas en claro', async () => {
    const lk = await generateLk();
    const row = await encryptListItem(lk, LIST, task('Comprar pan de centeno'));
    expect(JSON.stringify(row)).not.toContain('Comprar pan');
    expect(JSON.stringify(row)).not.toContain('casa');
    const ctText = new TextDecoder().decode(fromB64(row.data.ct));
    expect(ctText).not.toContain('Comprar');
  });

  it('descifrar con otro listId falla: el servidor no puede mover filas entre listas', async () => {
    const lk = await generateLk();
    const row = await encryptListItem(lk, 'list-A', task());
    await expect(decryptListItem(lk, 'list-B', row)).rejects.toBeInstanceOf(CorruptItemError);
    await expect(decryptListItem(lk, 'list-A', row)).resolves.toBeDefined();
  });

  it('manipular id, updated_at, deleted, ct, iv o v hace que falle con CorruptItemError', async () => {
    const lk = await generateLk();
    const row = await encryptListItem(lk, LIST, task());
    const flipB64 = (s: string) => {
      const bytes = fromB64(s);
      bytes[0] ^= 1;
      return toB64(bytes);
    };
    const tampered: ListRow[] = [
      { ...row, id: 'f'.repeat(64) },
      { ...row, updated_at: row.updated_at + 1 },
      { ...row, deleted: !row.deleted },
      { ...row, data: { ...row.data, ct: flipB64(row.data.ct) } },
      { ...row, data: { ...row.data, iv: flipB64(row.data.iv) } },
      { ...row, data: { ...row.data, v: 2 as 1 } },
      { ...row, data: { ...row.data, ct: '!!no-base64!!' } },
    ];
    for (const t of tampered) {
      await expect(decryptListItem(lk, LIST, t)).rejects.toBeInstanceOf(CorruptItemError);
    }
    await expect(decryptListItem(lk, LIST, row)).resolves.toBeDefined();
  });

  it('CorruptItemError tiene name correcto', async () => {
    const lk = await generateLk();
    const row = await encryptListItem(lk, LIST, task());
    const err = await decryptListItem(lk, LIST, { ...row, updated_at: 0 }).catch((e) => e);
    expect(err).toBeInstanceOf(CorruptItemError);
    expect(err.name).toBe('CorruptItemError');
  });

  it('una LK distinta no descifra', async () => {
    const lk1 = await generateLk();
    const lk2 = await generateLk();
    const row = await encryptListItem(lk1, LIST, task());
    await expect(decryptListItem(lk2, LIST, row)).rejects.toBeInstanceOf(CorruptItemError);
  });

  it('un kind que no es de lista falla aunque el cifrado sea válido', async () => {
    const lk = await generateLk();
    // Cifrado correcto de un 'filter' (kind de espacio personal): el descifrado debe rechazarlo.
    const row = await encryptListItem(lk, LIST, { ...task(), kind: 'filter' as ListKind });
    await expect(decryptListItem(lk, LIST, row)).rejects.toBeInstanceOf(CorruptItemError);
  });

  it('listRemoteId: determinista, 64 hex, distinto con otra LK, otro kind u otro id', async () => {
    const lk1 = await generateLk();
    const lk2 = await generateLk();
    const id = await listRemoteId(lk1, 'task', 't-1');
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(await listRemoteId(lk1, 'task', 't-1')).toBe(id);
    expect(await listRemoteId(lk2, 'task', 't-1')).not.toBe(id);
    expect(await listRemoteId(lk1, 'topic', 't-1')).not.toBe(id);
    expect(await listRemoteId(lk1, 'task', 't-2')).not.toBe(id);
  });

  it('listRemoteId no coincide con remoteId de la DK para los mismos bytes, kind e id', async () => {
    // Mismos bytes como DK y como LK: solo la etiqueta HKDF ('lista-mac' vs 'lista-list-mac') puede diferenciarlas.
    const raw = await exportDk(await generateDk());
    const dk = await importDk(raw);
    const lk = await importLk(raw);
    expect(await listRemoteId(lk, 'task', 't-1')).not.toBe(await remoteId(dk, 'task', 't-1'));
  });

  it('exportLk/importLk: base64 de 32 bytes y la LK importada sigue sirviendo', async () => {
    const lk = await generateLk();
    const b64 = await exportLk(lk);
    expect(fromB64(b64)).toHaveLength(32);
    const copy = await importLk(b64);
    expect(await exportLk(copy)).toBe(b64);
    expect(await listRemoteId(copy, 'task', 't-1')).toBe(await listRemoteId(lk, 'task', 't-1'));
    const row = await encryptListItem(lk, LIST, task());
    expect(await decryptListItem(copy, LIST, row)).toEqual(task());
    expect(await decryptListItem(lk, LIST, await encryptListItem(copy, LIST, task()))).toEqual(task());
  });
});

describe('invitaciones', () => {
  it('createInviteSecret: 43 caracteres base64url, distinto cada vez y válido para parsear', () => {
    const s = createInviteSecret();
    expect(s).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createInviteSecret()).not.toBe(s);
    const id = crypto.randomUUID();
    expect(parseInviteFragment(`#unirse=${id}.${s}`)).toEqual({ inviteId: id, secret: s });
  });

  it('wrap/unwrap round-trip: la LK desenvuelta descifra las filas de la lista', async () => {
    const lk = await generateLk();
    const inviteId = crypto.randomUUID();
    const keys = await inviteKeys(createInviteSecret());
    const wrapped = await wrapInvite(keys.wrapKey, inviteId, LIST, { lk, name: 'Compra' });
    const out = await unwrapInvite(keys.wrapKey, inviteId, LIST, wrapped);
    expect(out.name).toBe('Compra');
    expect(await exportLk(out.lk)).toBe(await exportLk(lk));
    const row = await encryptListItem(lk, LIST, task());
    expect(await decryptListItem(out.lk, LIST, row)).toEqual(task());
  });

  it('secreto equivocado no desenvuelve', async () => {
    const lk = await generateLk();
    const inviteId = crypto.randomUUID();
    const good = await inviteKeys(createInviteSecret());
    const wrapped = await wrapInvite(good.wrapKey, inviteId, LIST, { lk, name: 'x' });
    const other = await inviteKeys(createInviteSecret());
    await expect(unwrapInvite(other.wrapKey, inviteId, LIST, wrapped)).rejects.toBeInstanceOf(CorruptItemError);
  });

  it('otro inviteId o listId no desenvuelve', async () => {
    const lk = await generateLk();
    const inviteId = crypto.randomUUID();
    const { wrapKey } = await inviteKeys(createInviteSecret());
    const wrapped = await wrapInvite(wrapKey, inviteId, LIST, { lk, name: 'x' });
    await expect(unwrapInvite(wrapKey, crypto.randomUUID(), LIST, wrapped)).rejects.toBeInstanceOf(CorruptItemError);
    await expect(unwrapInvite(wrapKey, inviteId, 'list-otra', wrapped)).rejects.toBeInstanceOf(CorruptItemError);
    await expect(unwrapInvite(wrapKey, inviteId, LIST, wrapped)).resolves.toBeDefined();
  });

  it('envoltura manipulada falla (iv y ct) y envoltura corta también', async () => {
    const lk = await generateLk();
    const inviteId = crypto.randomUUID();
    const { wrapKey } = await inviteKeys(createInviteSecret());
    const wrapped = await wrapInvite(wrapKey, inviteId, LIST, { lk, name: 'x' });
    const bytes = fromB64(wrapped);
    const flipAt = (i: number) => {
      const b = bytes.slice();
      b[i] ^= 1;
      return toB64(b);
    };
    await expect(unwrapInvite(wrapKey, inviteId, LIST, flipAt(0))).rejects.toBeInstanceOf(CorruptItemError); // iv
    await expect(unwrapInvite(wrapKey, inviteId, LIST, flipAt(20))).rejects.toBeInstanceOf(CorruptItemError); // ct
    await expect(unwrapInvite(wrapKey, inviteId, LIST, 'AAAA')).rejects.toBeInstanceOf(CorruptItemError);
    await expect(unwrapInvite(wrapKey, inviteId, LIST, '!!no-base64!!')).rejects.toBeInstanceOf(CorruptItemError);
  });

  it('wrapKey no es extraíble', async () => {
    const { wrapKey } = await inviteKeys(createInviteSecret());
    await expect(crypto.subtle.exportKey('raw', wrapKey)).rejects.toThrow();
  });

  it('auth y authHash: deterministas, distintos con otro secreto, auth no es el hash', async () => {
    const secret = createInviteSecret();
    const a = await inviteKeys(secret);
    const b = await inviteKeys(secret);
    expect(a.auth).toBe(b.auth);
    expect(a.authHash).toBe(b.authHash);
    expect(a.auth).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.authHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.authHash).not.toBe(a.auth);
    const other = await inviteKeys(createInviteSecret());
    expect(other.authHash).not.toBe(a.authHash);
    expect(other.auth).not.toBe(a.auth);
  });

  it('auth y wrapKey salen de etiquetas distintas: auth no sirve para descifrar la envoltura', async () => {
    const secret = createInviteSecret();
    const keys = await inviteKeys(secret);
    const lk = await generateLk();
    const inviteId = crypto.randomUUID();
    const wrapped = await wrapInvite(keys.wrapKey, inviteId, LIST, { lk, name: 'x' });
    // Intentar usar los bytes de auth (lo único que tiene el servidor) como clave AES de la envoltura.
    const authRaw = fromB64(keys.auth.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (keys.auth.length % 4)) % 4));
    const fakeKey = await crypto.subtle.importKey('raw', authRaw, { name: 'AES-GCM' }, false, ['decrypt']);
    await expect(unwrapInvite(fakeKey, inviteId, LIST, wrapped)).rejects.toBeInstanceOf(CorruptItemError);
  });

  it('secreto mal formado en inviteKeys lanza Error', async () => {
    await expect(inviteKeys('corto')).rejects.toThrow(Error);
    await expect(inviteKeys('A'.repeat(42))).rejects.toThrow(Error);
    await expect(inviteKeys('A'.repeat(44))).rejects.toThrow(Error);
    await expect(inviteKeys('A'.repeat(42) + '!')).rejects.toThrow(Error);
    await expect(inviteKeys('A'.repeat(42) + 'B')).rejects.toThrow(Error); // forma no canónica
  });

  it('inviteLink + parseInviteFragment: ida y vuelta', () => {
    const id = crypto.randomUUID();
    const secret = createInviteSecret();
    const link = inviteLink('https://lista.app', id, secret);
    expect(link).toBe(`https://lista.app/#unirse=${id}.${secret}`);
    const hash = link.slice(link.indexOf('#'));
    expect(parseInviteFragment(hash)).toEqual({ inviteId: id, secret });
    expect(parseInviteFragment(hash.slice(1))).toEqual({ inviteId: id, secret });
  });

  it('parseInviteFragment rechaza basura', () => {
    const id = crypto.randomUUID();
    const bad = [
      '',
      '#',
      `#unirse=${id}${SECRET_ZERO}`, // sin punto
      `#unirse=no-es-uuid.${SECRET_ZERO}`, // uuid inválido
      `#unirse=${id.slice(0, -1)}.${SECRET_ZERO}`, // uuid corto
      `#unirse=${id}.${'A'.repeat(42)}`, // secreto corto
      `#unirse=${id}.${'A'.repeat(44)}`, // secreto largo
      `#unirse=${id}.${'A'.repeat(42)}+`, // carácter fuera de base64url
      `#unirse=${id}.${'A'.repeat(42)}B`, // forma no canónica
      `#invitar=${id}.${SECRET_ZERO}`, // otro prefijo
      `#unirse=${id}.${SECRET_ZERO}&x=1`, // basura detrás
      `unirse=${id}.${SECRET_ZERO}x`,
    ];
    for (const h of bad) expect(parseInviteFragment(h)).toBeNull();
    expect(parseInviteFragment(`#unirse=${id}.${SECRET_ZERO}`)).not.toBeNull();
  });
});
