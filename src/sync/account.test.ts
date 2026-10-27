import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { deleteRemoteAccount } from './api';
import { createRepo } from '../data/repo';

const cfg = { url: 'https://x.supabase.co', anonKey: 'anon' };
const session = { accessToken: 'AT', refreshToken: 'RT', expiresAt: 0, userId: 'u1', email: 'yo@x.com' };
const res = (status: number) => new Response(status === 204 ? null : '{}', { status });

describe('eliminar cuenta', () => {
  it('llama a la función delete_account con la sesión', async () => {
    const calls: string[] = [];
    const fetch = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${url.replace(cfg.url, '')}`);
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer AT');
      return res(204);
    }) as unknown as typeof globalThis.fetch;
    expect(await deleteRemoteAccount(cfg, session, fetch)).toEqual({ account: true });
    expect(calls).toEqual(['POST /rest/v1/rpc/delete_account']);
  });

  it('sin la función en Supabase (404) borra al menos las filas del usuario', async () => {
    const calls: string[] = [];
    const fetch = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${url.replace(cfg.url, '')}`);
      return res(url.includes('/rpc/') ? 404 : 204);
    }) as unknown as typeof globalThis.fetch;
    expect(await deleteRemoteAccount(cfg, session, fetch)).toEqual({ account: false });
    expect(calls).toEqual(['POST /rest/v1/rpc/delete_account', 'DELETE /rest/v1/items?user_id=eq.u1']);
  });

  it('un error del servidor se propaga (no se borra nada en local)', async () => {
    const fetch = (async () => new Response('{"message":"boom"}', { status: 500 })) as unknown as typeof globalThis.fetch;
    await expect(deleteRemoteAccount(cfg, session, fetch)).rejects.toThrow();
  });

  it('repo.wipe deja la base local vacía', async () => {
    const r = createRepo('test-' + crypto.randomUUID());
    await r.addParsed([{ title: 'x', topics: ['casa'], people: ['ana'], due: null, period: null, priority: null, recurrence: null, isSubtask: false, tokens: [] }]);
    await r.wipe();
    expect(await r.listTasks()).toEqual([]);
    expect(await r.listTopics()).toEqual([]);
    expect(await r.listPeople()).toEqual([]);
    expect(await r.pendingChanges()).toEqual([]);
  });
});
