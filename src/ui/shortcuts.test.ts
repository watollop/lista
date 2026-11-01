// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepo } from '../data/repo';
import { createSync } from '../sync';
import { App } from './App';
import { INTRO_KEY } from './Onboarding';
import { SHORTCUTS } from './shortcuts';
import appSource from './App.tsx?raw';

const keys = SHORTCUTS.flatMap(([ks]) => ks);

describe('lista compartida de atajos', () => {
  it('incluye ? para la hoja de atajos', () => {
    expect(keys).toContain('?');
  });

  it('contiene las teclas que App.tsx gestiona', () => {
    for (const k of ['/', 'n', 'j', 'k', 'x', 'e', 'h', 's', 'v', 'f', '?']) {
      expect(appSource, `App.tsx gestiona '${k}'`).toContain(`'${k}'`);
      expect(keys, `la lista muestra '${k}'`).toContain(k);
    }
    expect(appSource).toContain("key === 'Escape'");
    expect(keys).toContain('esc');
    expect(appSource).toContain("key === 'Backspace'");
    expect(keys).toContain('⌫');
    expect(keys).toContain('⌘K');
    expect(keys).toContain('1–9');
  });
});

let root: HTMLDivElement;

beforeEach(() => {
  history.replaceState(null, '', '/');
  localStorage.clear();
  localStorage.setItem(INTRO_KEY, '1');
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('scrollTo', vi.fn());
  HTMLElement.prototype.scrollIntoView = vi.fn();
  root = document.createElement('div');
  document.body.append(root);
});

afterEach(() => {
  act(() => render(null, root));
  root.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function app() {
  const repo = createRepo('ui-' + crypto.randomUUID());
  act(() => render(h(App, { repo, sync: createSync(repo, null) }), root));
  await vi.waitFor(() => expect(root.querySelector('.empty, .list')).not.toBeNull());
}

function press(target: EventTarget, key: string) {
  act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });
}

const sheet = () => root.querySelector<HTMLElement>('[role="dialog"][aria-label="Atajos de teclado"]');

describe('hoja de atajos con ?', () => {
  it('? abre la hoja y Esc la cierra', async () => {
    await app();
    press(document.body, '?');
    expect(sheet()).not.toBeNull();
    press(sheet()!, 'Escape');
    expect(sheet()).toBeNull();
  });

  it('? vuelve a cerrar la hoja', async () => {
    await app();
    press(document.body, '?');
    press(document.body, '?');
    expect(sheet()).toBeNull();
  });

  it('un clic fuera de la hoja la cierra', async () => {
    await app();
    press(document.body, '?');
    act(() => { root.querySelector<HTMLElement>('.dialog-backdrop')!.click(); });
    expect(sheet()).toBeNull();
  });

  it('? dentro de un input no abre la hoja', async () => {
    await app();
    const input = root.querySelector('input, textarea');
    expect(input).not.toBeNull();
    press(input!, '?');
    expect(sheet()).toBeNull();
  });

  it('muestra cada atajo de la lista compartida', async () => {
    await app();
    press(document.body, '?');
    const text = sheet()!.textContent ?? '';
    for (const [, what] of SHORTCUTS) expect(text).toContain(what);
    expect(sheet()!.querySelectorAll('kbd')).toHaveLength(keys.length);
  });
});
