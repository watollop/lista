// @vitest-environment jsdom
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkDialog, LockedPanel } from './Encryption';
import type { LinkState, Sync } from '../types';

let root: HTMLDivElement;

beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
});

afterEach(() => {
  act(() => render(null, root));
  root.remove();
});

/** Sync falso: solo lo que usan los componentes de cifrado. */
function fakeSync(link: LinkState | null) {
  return {
    link: () => link,
    startLink: vi.fn(async () => {}),
    cancelLink: vi.fn(async () => {}),
    confirmLink: vi.fn(async () => {}),
  } as unknown as Sync & Record<'startLink' | 'cancelLink' | 'confirmLink', ReturnType<typeof vi.fn>>;
}

function button(label: string): HTMLButtonElement {
  const el = [...root.querySelectorAll('button')].find((b) => b.textContent === label);
  expect(el, label).toBeDefined();
  return el!;
}

async function click(el: Element) {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

describe('LockedPanel (dispositivo bloqueado)', () => {
  it('sin enlace: explica el bloqueo y «Enlazar este dispositivo» pide el enlace', async () => {
    const sync = fakeSync(null);
    const onRecovery = vi.fn();
    act(() => render(h(LockedPanel, { sync, onRecovery }), root));
    expect(root.textContent).toContain('Este dispositivo está bloqueado');
    await click(button('Enlazar este dispositivo'));
    expect(sync.startLink).toHaveBeenCalledOnce();
    await click(button('Usar clave de recuperación'));
    expect(onRecovery).toHaveBeenCalledOnce();
  });

  it('esperando: indica qué hacer en el otro dispositivo y permite cancelar', async () => {
    const sync = fakeSync({ role: 'new', status: 'waiting' });
    act(() => render(h(LockedPanel, { sync }), root));
    expect(root.textContent).toContain('Abre Lista en el dispositivo donde ya está activado el cifrado');
    await click(button('Cancelar'));
    expect(sync.cancelLink).toHaveBeenCalledOnce();
  });

  it('con código: lo muestra en grande', () => {
    act(() => render(h(LockedPanel, { sync: fakeSync({ role: 'new', status: 'code', code: '048 913' }) }), root));
    expect(root.querySelector('.link-code')?.textContent).toBe('048 913');
  });

  it('error: «Volver a intentarlo» cancela y pide un enlace nuevo', async () => {
    const sync = fakeSync({ role: 'new', status: 'error', message: 'Caducó' });
    act(() => render(h(LockedPanel, { sync }), root));
    expect(root.textContent).toContain('Caducó');
    await click(button('Volver a intentarlo'));
    expect(sync.cancelLink).toHaveBeenCalledOnce();
    expect(sync.startLink).toHaveBeenCalledOnce();
  });
});

describe('LinkDialog (dispositivo activado)', () => {
  it('con código: diálogo modal con aviso; «Enlazar» confirma y avisa', async () => {
    const sync = fakeSync(null);
    const toast = vi.fn();
    act(() => render(h(LinkDialog, { sync, link: { role: 'active', status: 'code', code: '123 456' }, toast }), root));
    expect(root.querySelector('[role="alertdialog"][aria-modal="true"]')).not.toBeNull();
    expect(root.querySelector('.link-code')?.textContent).toBe('123 456');
    expect(root.textContent).toContain('Confirma solo si eres tú');
    await click(button('Enlazar'));
    expect(sync.confirmLink).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenCalledWith('Dispositivo enlazado');
  });

  it('«Rechazar» cancela y avisa', async () => {
    const sync = fakeSync(null);
    const toast = vi.fn();
    act(() => render(h(LinkDialog, { sync, link: { role: 'active', status: 'waiting' }, toast }), root));
    await click(button('Rechazar'));
    expect(sync.cancelLink).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenCalledWith('Enlace rechazado');
  });

  it('si falla la confirmación, muestra el error y no avisa de éxito', async () => {
    const sync = fakeSync(null);
    sync.confirmLink.mockRejectedValueOnce(new Error('Sin conexión'));
    const toast = vi.fn();
    act(() => render(h(LinkDialog, { sync, link: { role: 'active', status: 'code', code: '123 456' }, toast }), root));
    await click(button('Enlazar'));
    expect(root.textContent).toContain('Sin conexión');
    expect(toast).not.toHaveBeenCalled();
  });
});
