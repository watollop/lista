import { afterEach, describe, expect, it } from 'vitest';
import { InviteRejectedError, SharingUnavailableError } from '../sync/listapi';
import { setLangForTests } from '../i18n';
import type { ListMemberInfo } from '../types';
import {
  JOIN_KEY, captureJoinLink, clearPendingJoin, copyLink, formatExpiry, inviteErrorText, iosBrowser,
  memberLabel, nextOwner, pendingJoin, savePendingJoin, sendLink,
} from './sharing';

const member = (over: Partial<ListMemberInfo> & { user_id: string }): ListMemberInfo => ({
  role: 'member', joined_at: '2026-01-01T00:00:00Z', email: null, name: null, ...over,
});

const memStore = (init: Record<string, string> = {}) => {
  const data = { ...init };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => { data[k] = v; },
    removeItem: (k: string) => { delete data[k]; },
  };
};

afterEach(() => setLangForTests('es'));

describe('captura del enlace de unirse', () => {
  it('guarda el fragmento y quita el hash de la URL', () => {
    const store = memStore();
    const calls: string[] = [];
    const hist = { replaceState: (_d: unknown, _u: string, url?: string | null) => { calls.push(String(url)); } };
    const ok = captureJoinLink({ hash: '#unirse=abc.def', pathname: '/lista/', search: '?x=1' }, hist, store);
    expect(ok).toBe(true);
    expect(store.data[JOIN_KEY]).toBe('#unirse=abc.def');
    expect(calls).toEqual(['/lista/?x=1']);
  });

  it('sin fragmento de unirse no hace nada', () => {
    const store = memStore();
    let touched = false;
    const hist = { replaceState: () => { touched = true; } };
    expect(captureJoinLink({ hash: '#otra', pathname: '/', search: '' }, hist, store)).toBe(false);
    expect(touched).toBe(false);
    expect(store.data[JOIN_KEY]).toBeUndefined();
  });

  it('si el almacenamiento falla, devuelve false sin tocar la URL', () => {
    const store = { setItem: () => { throw new Error('quota'); } };
    let touched = false;
    const hist = { replaceState: () => { touched = true; } };
    expect(captureJoinLink({ hash: '#unirse=a.b', pathname: '/', search: '' }, hist, store)).toBe(false);
    expect(touched).toBe(false);
  });

  it('si replaceState falla, el enlace ya está guardado y devuelve true', () => {
    const store = memStore();
    const hist = { replaceState: () => { throw new Error('nope'); } };
    expect(captureJoinLink({ hash: '#unirse=a.b', pathname: '/', search: '' }, hist, store)).toBe(true);
    expect(store.data[JOIN_KEY]).toBe('#unirse=a.b');
  });
});

describe('enlace pendiente', () => {
  it('pendingJoin devuelve lo guardado o null', () => {
    expect(pendingJoin(memStore({ [JOIN_KEY]: '#unirse=x.y' }))).toBe('#unirse=x.y');
    expect(pendingJoin(memStore())).toBeNull();
  });

  it('pendingJoin nunca lanza', () => {
    expect(pendingJoin({ getItem: () => { throw new Error('denied'); } })).toBeNull();
  });

  it('clearPendingJoin borra la clave y nunca lanza', () => {
    const store = memStore({ [JOIN_KEY]: '#unirse=x.y' });
    clearPendingJoin(store);
    expect(store.data[JOIN_KEY]).toBeUndefined();
    expect(() => clearPendingJoin({ removeItem: () => { throw new Error('denied'); } })).not.toThrow();
  });

  it('savePendingJoin guarda desde el fragmento de un enlace completo', () => {
    const store = memStore();
    expect(savePendingJoin('https://lista.example/#unirse=a.b', store)).toBe(true);
    expect(store.data[JOIN_KEY]).toBe('#unirse=a.b');
    expect(savePendingJoin('no es un enlace', store)).toBe(false);
  });
});

describe('textos de error de invitación', () => {
  it('cada código de rechazo tiene su texto en español', () => {
    expect(inviteErrorText(new InviteRejectedError('invite_invalid'))).toBe('Este enlace no es válido. Pide uno nuevo.');
    expect(inviteErrorText(new InviteRejectedError('invite_used'))).toBe(
      'Este enlace ya se usó. Cada enlace sirve para una persona: pide uno nuevo.',
    );
    expect(inviteErrorText(new InviteRejectedError('invite_expired'))).toBe('Este enlace ha caducado. Pide uno nuevo.');
    expect(inviteErrorText(new InviteRejectedError('list_full'))).toBe('Esta lista ya tiene 50 personas.');
  });

  it('los códigos tienen versión en inglés', () => {
    setLangForTests('en');
    expect(inviteErrorText(new InviteRejectedError('list_full'))).toBe('This list already has 50 people.');
    expect(inviteErrorText(new SharingUnavailableError())).toBe('Your server doesn’t support shared lists yet.');
  });

  it('servidor sin listas compartidas, error normal y desconocido', () => {
    expect(inviteErrorText(new SharingUnavailableError())).toBe('Tu servidor aún no admite listas compartidas.');
    expect(inviteErrorText(new Error('Fallo concreto'))).toBe('Fallo concreto');
    expect(inviteErrorText('raro')).toBe('No se pudo completar. Inténtalo de nuevo.');
  });
});

describe('nombres de miembros', () => {
  it('«Tú» cuando el email coincide, sin distinguir mayúsculas', () => {
    expect(memberLabel(member({ user_id: 'a', email: 'Ana@Mail.com', name: 'Ana' }), 'ana@mail.com')).toBe('Tú');
  });

  it('nombre, luego email, luego «Alguien»', () => {
    expect(memberLabel(member({ user_id: 'a', name: 'Luis', email: 'l@x.com' }), 'otra@x.com')).toBe('Luis');
    expect(memberLabel(member({ user_id: 'a', email: 'l@x.com' }))).toBe('l@x.com');
    expect(memberLabel(member({ user_id: 'a' }))).toBe('Alguien');
  });
});

describe('siguiente owner', () => {
  it('es el miembro más antiguo entre los demás', () => {
    const ms = [
      member({ user_id: 'o', role: 'owner', joined_at: '2026-01-01T00:00:00Z' }),
      member({ user_id: 'b', joined_at: '2026-03-01T00:00:00Z' }),
      member({ user_id: 'c', joined_at: '2026-02-01T00:00:00Z' }),
    ];
    expect(nextOwner(ms, 'o')?.user_id).toBe('c');
  });

  it('en empate gana el user_id menor', () => {
    const ms = [
      member({ user_id: 'z', joined_at: '2026-02-01T00:00:00Z' }),
      member({ user_id: 'm', joined_at: '2026-02-01T00:00:00Z' }),
      member({ user_id: 'o', role: 'owner', joined_at: '2026-01-01T00:00:00Z' }),
    ];
    expect(nextOwner(ms, 'o')?.user_id).toBe('m');
  });

  it('no elige a quien se va y devuelve null si no queda nadie', () => {
    expect(nextOwner([member({ user_id: 'o', role: 'owner' })], 'o')).toBeNull();
    expect(nextOwner([], 'o')).toBeNull();
  });
});

describe('caducidad', () => {
  it('fecha corta en español', () => {
    expect(formatExpiry('2026-11-15T10:00:00Z')).toBe('15 nov');
  });

  it('fecha corta en inglés', () => {
    setLangForTests('en');
    expect(formatExpiry('2026-11-15T10:00:00Z')).toBe('Nov 15');
  });

  it('fecha inválida da cadena vacía', () => {
    expect(formatExpiry('no es fecha')).toBe('');
  });
});

describe('enviar y copiar enlace', () => {
  const clip = (ok = true) => {
    const written: string[] = [];
    return {
      written,
      clipboard: { writeText: async (t: string) => { if (!ok) throw new Error('denied'); written.push(t); } },
    };
  };

  it('usa el menú de compartir y devuelve shared, con texto y url', async () => {
    let got: { title?: string; text?: string; url?: string } | null = null;
    const r = await sendLink('https://x/#unirse=a.b', 'Compra', {
      share: async (d) => { got = d; },
    });
    expect(r).toBe('shared');
    expect(got).toEqual({
      title: 'Lista',
      text: 'Te invito a mi lista «Compra» en Lista',
      url: 'https://x/#unirse=a.b',
    });
  });

  it('AbortError al compartir es cancelado', async () => {
    const r = await sendLink('u', 'Compra', {
      share: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); },
    });
    expect(r).toBe('cancelled');
  });

  it('si compartir falla de otra forma, copia', async () => {
    const c = clip();
    const r = await sendLink('u', 'Compra', {
      share: async () => { throw new Error('NotAllowed'); },
      clipboard: c.clipboard,
    });
    expect(r).toBe('copied');
    expect(c.written).toEqual(['u']);
  });

  it('sin menú de compartir copia el enlace', async () => {
    const c = clip();
    expect(await sendLink('u', 'Compra', { clipboard: c.clipboard })).toBe('copied');
  });

  it('si no se puede ni enviar ni copiar, falla', async () => {
    expect(await sendLink('u', 'Compra', { clipboard: clip(false).clipboard })).toBe('failed');
    expect(await sendLink('u', 'Compra', {})).toBe('failed');
  });

  it('copyLink devuelve true o false sin lanzar', async () => {
    const c = clip();
    expect(await copyLink('u', { clipboard: c.clipboard })).toBe(true);
    expect(c.written).toEqual(['u']);
    expect(await copyLink('u', { clipboard: clip(false).clipboard })).toBe(false);
    expect(await copyLink('u', {})).toBe(false);
  });
});

describe('iPhone fuera de la app instalada', () => {
  const noMedia = { matchMedia: () => ({ matches: false }) };
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
  const android = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
  const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15';

  it('true en iPhone sin app instalada', () => {
    expect(iosBrowser({ userAgent: iphone, standalone: false }, noMedia)).toBe(true);
  });

  it('false con la app instalada (navigator.standalone o display-mode)', () => {
    expect(iosBrowser({ userAgent: iphone, standalone: true }, noMedia)).toBe(false);
    expect(iosBrowser({ userAgent: iphone }, { matchMedia: () => ({ matches: true }) })).toBe(false);
  });

  it('true en iPad con el modo escritorio (se presenta como Mac con pantalla táctil)', () => {
    expect(iosBrowser({ userAgent: mac, platform: 'MacIntel', maxTouchPoints: 5 }, noMedia)).toBe(true);
  });

  it('false en Android y en Mac sin pantalla táctil', () => {
    expect(iosBrowser({ userAgent: android }, noMedia)).toBe(false);
    expect(iosBrowser({ userAgent: mac, platform: 'MacIntel', maxTouchPoints: 0 }, noMedia)).toBe(false);
  });
});
