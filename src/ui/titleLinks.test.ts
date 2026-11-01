// @vitest-environment jsdom
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TitleText } from './TaskList';

let root: HTMLDivElement;

beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
});

afterEach(() => {
  act(() => render(null, root));
  root.remove();
});

/** El título dentro de una fila de mentira: el clic de la fila no debe producirse al tocar el enlace. */
function mount(text: string, onRowClick = vi.fn(), onChip = vi.fn()) {
  act(() => render(h('button', { class: 'title', onClick: onRowClick }, h(TitleText, { text, onChip })), root));
  return { onRowClick, onChip };
}

describe('TitleText con enlaces', () => {
  it('muestra el dominio corto con el enlace completo', () => {
    mount('Leer https://www.github.com/a/b pronto');
    const a = root.querySelector('a')!;
    expect(root.textContent).toBe('Leer github.com ↗ pronto');
    expect(a.getAttribute('href')).toBe('https://www.github.com/a/b');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.getAttribute('title')).toBe('https://www.github.com/a/b');
    expect(a.getAttribute('aria-label')).toBe('Abrir github.com');
  });

  it('tocar el enlace no dispara el clic de la fila', () => {
    const { onRowClick } = mount('https://github.com/a');
    act(() => { root.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    act(() => { root.querySelector('a')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('una etiqueta en el mismo título sigue filtrando y no se convierte en enlace', () => {
    const { onRowClick, onChip } = mount('Pan #casa https://a.com/#/x');
    expect(root.querySelectorAll('a')).toHaveLength(1);
    expect(root.querySelector('a')!.getAttribute('href')).toBe('https://a.com/#/x');
    act(() => { root.querySelector<HTMLElement>('.tag')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onChip).toHaveBeenCalledWith('topic', 'casa');
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('javascript: queda como texto', () => {
    mount('javascript:alert(1)');
    expect(root.querySelector('a')).toBeNull();
    expect(root.textContent).toBe('javascript:alert(1)');
  });
});
