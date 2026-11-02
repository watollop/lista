// @vitest-environment jsdom
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lazy } from './lazy';

describe('lazy: chunk que ya no existe tras un despliegue', () => {
  let root: HTMLElement;
  const reload = vi.fn();
  beforeEach(() => {
    root = document.createElement('div');
    document.body.append(root);
    sessionStorage.clear();
    reload.mockReset();
    vi.stubGlobal('location', { ...window.location, reload });
  });
  afterEach(() => {
    act(() => render(null, root));
    root.remove();
    vi.unstubAllGlobals();
  });

  const fail = () => lazy<object>(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module')));
  const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

  it('al pedir la vista y fallar la carga, recarga la página una vez', async () => {
    const View = fail();
    act(() => render(h(View, {}), root));
    await flush();
    expect(reload).toHaveBeenCalledTimes(1);
    // Un segundo fallo enseguida no vuelve a recargar (evita bucles).
    act(() => render(null, root));
    act(() => render(h(fail(), {}), root));
    await flush();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('la precarga en reposo no recarga aunque falle', async () => {
    fail().preload();
    await flush();
    expect(reload).not.toHaveBeenCalled();
  });

  it('sin conexión no recarga', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    act(() => render(h(fail(), {}), root));
    await flush();
    expect(reload).not.toHaveBeenCalled();
  });
});
