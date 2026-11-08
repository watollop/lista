// @vitest-environment jsdom
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskList, TitleText, type Group } from './TaskList';
import type { Task, TodoList } from '../types';
import { MAIN_LIST } from '../types';

let root: HTMLDivElement;
const mainList: TodoList = { id: MAIN_LIST, name: 'Personal', order: 0, updatedAt: 0, deleted: 0, dirty: 0 } as TodoList;
const workList: TodoList = { id: 'trabajo', name: 'Trabajo', order: 1, updatedAt: 0, deleted: 0, dirty: 0 } as TodoList;

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
      onSelect, onEdit, onToggle: vi.fn(), onSave: vi.fn(), onDelete: vi.fn(),
      onChip: vi.fn(), doneToday: new Set<string>(), pastMode: false, anchorKey: 'k', onMove: vi.fn(), onAddSubtasks: vi.fn(async () => {}),
      lists: [mainList], showList: false, onPickList: vi.fn(), onMoveTo: vi.fn(),
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

  it('con subtareas, Enter en el título edita y abre todo y el botón de ramas las pliega', () => {
    const onEdit = vi.fn();
    list([{ task: task('p', 'Proyecto'), children: [task('c', 'Paso', 'p')] }], onEdit);
    expect(root.querySelector('.fold-task')?.getAttribute('aria-expanded')).toBe('false');
    key(root.querySelector('.title')!, 'Enter');
    expect(onEdit).toHaveBeenCalledWith('p');
    expect(root.querySelector('.fold-task')?.getAttribute('aria-expanded')).toBe('true');
    act(() => (root.querySelector('.fold-task') as HTMLElement).click());
    expect(root.querySelector('.fold-task')?.getAttribute('aria-expanded')).toBe('false');
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

describe('listas: etiqueta de lista y «Mover a…»', () => {
  const task = (id: string, title: string, parentId: string | null = null, listId: string | null = null): Task => ({
    id, title, topics: [], people: [], due: null, priority: null, recurrence: null, parentId, listId,
    done: 0, doneAt: null, nextId: null, order: 0, createdAt: 0, updatedAt: 0, deleted: 0, dirty: 0,
  });
  const render1 = (groups: Group[], opts: { lists?: TodoList[]; showList?: boolean; editing?: string | null; onPickList?: () => void; onMoveTo?: () => void; onEdit?: () => void; onSelect?: () => void } = {}) =>
    act(() => render(h(TaskList, {
      groups, names: new Map(), today: '2026-11-01', selected: null, editing: opts.editing ?? null,
      onSelect: opts.onSelect ?? vi.fn(), onEdit: opts.onEdit ?? vi.fn(), onToggle: vi.fn(), onSave: vi.fn(), onDelete: vi.fn(),
      onChip: vi.fn(), doneToday: new Set<string>(), pastMode: false, anchorKey: 'k', onMove: vi.fn(), onAddSubtasks: vi.fn(async () => {}),
      lists: opts.lists ?? [mainList], showList: opts.showList ?? false,
      onPickList: opts.onPickList ?? vi.fn(), onMoveTo: opts.onMoveTo ?? vi.fn(),
    }), root));
  const byText = (text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === text) ?? null;

  it('con una sola lista no aparece «Mover a…» en el editor', () => {
    render1([{ task: task('t1', 'Comprar pan'), children: [] }], { editing: 't1' });
    expect(root.querySelector('.edit')).not.toBeNull();
    expect(byText('Mover a…')).toBeNull();
  });

  it('con dos listas aparece «Mover a…» y llama a onMoveTo con la tarea, sin quitar el foco', () => {
    const onMoveTo = vi.fn();
    render1([{ task: task('t1', 'Comprar pan'), children: [] }], { editing: 't1', lists: [mainList, workList], onMoveTo });
    const btn = byText('Mover a…')!;
    expect(btn).not.toBeNull();
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    act(() => { btn.dispatchEvent(down); });
    expect(down.defaultPrevented).toBe(true);
    act(() => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onMoveTo).toHaveBeenCalledWith('t1');
  });

  it('con showList, la principal muestra su etiqueta de lista; tocarla abre esa lista sin editar ni seleccionar', () => {
    const onPickList = vi.fn();
    const onEdit = vi.fn();
    const onSelect = vi.fn();
    render1([
      { task: task('a', 'Informe', null, 'trabajo'), children: [] },
      { task: task('b', 'Pan', null, null), children: [] },
    ], { showList: true, lists: [mainList, workList], onPickList, onEdit, onSelect });
    const chips = [...root.querySelectorAll<HTMLButtonElement>('.chip[aria-label^="Abrir la lista"]')];
    expect(chips.map((c) => c.textContent)).toEqual(['Trabajo', 'Personal']);
    act(() => { chips[0].dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onPickList).toHaveBeenCalledWith('trabajo');
    expect(onEdit).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('las subtareas no muestran etiqueta de lista', () => {
    render1([{ task: task('p', 'Proyecto', null, 'trabajo'), children: [task('c', 'Paso', 'p', 'trabajo')] }], { showList: true, lists: [mainList, workList] });
    expect(root.querySelectorAll('.chip[aria-label^="Abrir la lista"]')).toHaveLength(1);
    act(() => (root.querySelector('.fold-task') as HTMLElement).click());
    expect(root.querySelector('.row.sub')).not.toBeNull();
    expect(root.querySelectorAll('.chip[aria-label^="Abrir la lista"]')).toHaveLength(1);
    expect(root.querySelector('.row.sub .chip')).toBeNull();
  });

  it('sin showList no hay etiquetas de lista', () => {
    render1([{ task: task('a', 'Informe', null, 'trabajo'), children: [] }], { showList: false, lists: [mainList, workList] });
    expect(root.querySelector('.chip[aria-label^="Abrir la lista"]')).toBeNull();
  });
});
