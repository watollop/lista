// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repo } from '../types';
import { detectLang, setLangForTests } from '../i18n';
import { startLangSync } from './langSync';

/** Repo mínimo con solo los ajustes (lo único que usa langSync). */
function fakeRepo(initial?: unknown) {
  const store = new Map<string, unknown>(initial === undefined ? [] : [['lang', initial]]);
  const subs = new Set<() => void>();
  const repo = {
    getSetting: async (k: string) => (store.has(k) ? { value: store.get(k), updatedAt: 1 } : undefined),
    setSetting: vi.fn(async (k: string, v: unknown) => { store.set(k, v); subs.forEach((f) => f()); }),
    subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); },
  } as unknown as Repo & { setSetting: ReturnType<typeof vi.fn> };
  return { repo, store, push: (v: unknown) => { store.set('lang', v); subs.forEach((f) => f()); } };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('idioma', () => {
  const reload = vi.fn();
  beforeEach(() => {
    localStorage.clear();
    reload.mockReset();
    vi.stubGlobal('location', { ...window.location, reload });
    setLangForTests('es');
  });
  afterEach(() => { vi.unstubAllGlobals(); setLangForTests('es'); });

  it('detecta español entre las lenguas del navegador; si no hay, inglés', () => {
    expect(detectLang(['es-ES'])).toBe('es');
    expect(detectLang(['en-GB', 'es'])).toBe('es');
    expect(detectLang(['en-US'])).toBe('en');
    expect(detectLang(['fr-FR', 'de'])).toBe('en');
    expect(detectLang([])).toBe('en');
  });

  it('el idioma elegido en otro dispositivo se aplica aquí (recarga si cambia el que se ve)', async () => {
    const { repo, push } = fakeRepo();
    const stop = startLangSync(repo);
    await flush();
    push('en');
    await flush();
    expect(localStorage.getItem('lista.lang')).toBe('en');
    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });

  it('si la cuenta no tiene idioma y aquí hay uno elegido, lo sube', async () => {
    localStorage.setItem('lista.lang', 'en');
    const { repo, store } = fakeRepo();
    const stop = startLangSync(repo);
    await flush();
    expect(store.get('lang')).toBe('en');
    expect(reload).not.toHaveBeenCalled();
    stop();
  });

  it('un valor remoto igual al local no recarga', async () => {
    localStorage.setItem('lista.lang', 'es');
    const { repo } = fakeRepo('es');
    const stop = startLangSync(repo);
    await flush();
    expect(reload).not.toHaveBeenCalled();
    stop();
  });
});
