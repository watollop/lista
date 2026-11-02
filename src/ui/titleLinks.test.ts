// @vitest-environment jsdom
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskList, TitleText, type Group } from './TaskList';
import type { Task } from '../types';

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

describe('fila con enlace en el título', () => {
  const task = (id: string, title: string, parentId: string | null = null): Task => ({
    id, title, topics: [], people: [], due: null, priority: null, recurrence: null, parentId,
    done: 0, doneAt: null, nextId: null, order: 0, createdAt: 0, updatedAt: 0, deleted: 0, dirty: 0,
  });
  const key = (el: Element, k: string) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });
  const list = (groups: Group[], onEdit = vi.fn(), onSelect = vi.fn()) =>
    act(() => render(h(TaskList, {
      groups, names: new Map(), today: '2026-11-01', selected: null, editing: null,
      onSelect, onEdit, onToggle: vi.fn(), onSave: vi.fn(), onTomorrow: vi.fn(), onDelete: vi.fn(),
      onChip: vi.fn(), doneToday: new Set<string>(), pastMode: false, anchorKey: 'k', onMove: vi.fn(), onAddSubtasks: vi.fn(async () => {}),
    }), root));

  it('el enlace no está dentro de ningún botón y el título tiene rol de botón', () => {
    list([{ task: task('t1', 'Leer https://github.com/a'), children: [] }]);
    expect(root.querySelector('button a, button .title, a button')).toBeNull();
    const title = root.querySelector('.title')!;
    expect(title.tagName).toBe('SPAN');
    expect(title.getAttribute('role')).toBe('button');
    expect(title.getAttribute('tabindex')).toBe('0');
    expect(title.querySelector('a')?.textContent).toBe('github.com ↗');
  });

  it('Enter y Espacio en el título editan la tarea', () => {
    const onEdit = vi.fn();
    list([{ task: task('t1', 'Comprar pan'), children: [] }], onEdit);
    key(root.querySelector('.title')!, 'Enter');
    key(root.querySelector('.title')!, ' ');
    expect(onEdit.mock.calls).toEqual([['t1'], ['t1']]);
  });

  it('con subtareas, Enter en el título la expande', () => {
    list([{ task: task('p', 'Proyecto'), children: [task('c', 'Paso', 'p')] }]);
    expect(root.querySelector('.title')?.getAttribute('aria-expanded')).toBe('false');
    key(root.querySelector('.title')!, 'Enter');
    expect(root.querySelector('.title')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('Enter y Espacio dentro del enlace no activan el título', () => {
    const onEdit = vi.fn();
    const onSelect = vi.fn();
    list([{ task: task('t1', 'Leer https://github.com/a'), children: [] }], onEdit, onSelect);
    key(root.querySelector('.title a')!, 'Enter');
    key(root.querySelector('.title a')!, ' ');
    expect(onEdit).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
