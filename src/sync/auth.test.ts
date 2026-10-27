import { describe, it, expect } from 'vitest';
import { googleAuthorizeUrl, googleEnabled, sessionFromRedirect } from './auth';

const cfg = { url: 'https://x.supabase.co', anonKey: 'anon' };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('auth: Google', () => {
  it('URL de Google con redirect codificado', () => {
    expect(googleAuthorizeUrl(cfg, 'https://lista.pages.dev/')).toBe(
      'https://x.supabase.co/auth/v1/authorize?provider=google&redirect_to=https%3A%2F%2Flista.pages.dev%2F',
    );
  });

  it('sesión desde el hash de vuelta + usuario', async () => {
    const calls: string[] = [];
    const fetch = (async (url: string, init?: RequestInit) => {
      calls.push(url);
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer AT');
      return json(200, { id: 'u1', email: 'yo@x.com' });
    }) as unknown as typeof globalThis.fetch;
    const s = await sessionFromRedirect(cfg, '#access_token=AT&refresh_token=RT&expires_in=3600&token_type=bearer', fetch, () => 1000);
    expect(s).toEqual({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 1000 + 3600_000, userId: 'u1', email: 'yo@x.com' });
    expect(calls).toEqual(['https://x.supabase.co/auth/v1/user']);
  });

  it('hash ajeno => null; hash de error => excepción legible', async () => {
    const fetch = (async () => json(200, {})) as unknown as typeof globalThis.fetch;
    expect(await sessionFromRedirect(cfg, '#otra-cosa', fetch)).toBeNull();
    await expect(sessionFromRedirect(cfg, '#error=access_denied&error_description=Usuario+cancel%C3%B3', fetch))
      .rejects.toThrow('Usuario canceló');
  });

  it('Google activado según /auth/v1/settings; error de red => false', async () => {
    const on = (async () => json(200, { external: { google: true, email: true } })) as unknown as typeof globalThis.fetch;
    const off = (async () => json(200, { external: { google: false } })) as unknown as typeof globalThis.fetch;
    const down = (async () => { throw new TypeError('offline'); }) as unknown as typeof globalThis.fetch;
    expect(await googleEnabled(cfg, on)).toBe(true);
    expect(await googleEnabled(cfg, off)).toBe(false);
    expect(await googleEnabled(cfg, down)).toBe(false);
  });
});
