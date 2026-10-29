// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepo } from '../data/repo';
import { createSync } from '../sync';
import { parseLine } from '../parser';
import { App } from './App';
import { Capture } from './Capture';
import { INTRO_KEY } from './Onboarding';
import { DEFAULT_SUBTASK_COLOR, applyTheme, getSubtaskColor, setSubtaskColor } from './theme';
import type { ParsedLine, Repo } from '../types';

let root: HTMLDivElement;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(INTRO_KEY, '1');
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  root = document.createElement('div');
  document.body.append(root);
});

afterEach(() => {
  act(() => render(null, root));
  root.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-look');
});

function input(label: string): HTMLInputElement {
  const el = root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  expect(el, label).not.toBeNull();
  return el!;
}

function type(el: HTMLInputElement, text: string) {
  act(() => {
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function enter(el: HTMLInputElement, composing = false) {
  act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: composing })); });
}

function click(el: Element | null) {
  expect(el).not.toBeNull();
  act(() => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

function button(text: string): HTMLButtonElement {
  const el = [...root.querySelectorAll('button')].find((b) => b.textContent === text);
  expect(el, text).toBeDefined();
  return el!;
}

function capture(onAdd = vi.fn<(lines: ParsedLine[]) => Promise<void>>().mockResolvedValue(undefined)) {
  act(() => render(h(Capture, {
    topics: [], people: [], names: new Map(), today: '2026-10-29', kbOpen: false,
    inputRef: { current: null }, onAdd,
  }), root));
  return onAdd;
}

async function app(repo: Repo) {
  act(() => render(h(App, { repo, sync: createSync(repo, null) }), root));
  await vi.waitFor(() => expect(root.querySelector('.empty, .list')).not.toBeNull());
}

describe('captura con subtareas', () => {
  it('mantiene la guía al escribir y guarda el conjunto al dar Enter en vacío', async () => {
    const add = capture();
    type(input('Nueva tarea'), 'Preparar viaje #casa');
    expect(root.querySelector('.capture-guide')?.textContent).toBe('#tema @persona !prioridad fecha');
    expect(input('Nueva tarea').getAttribute('aria-describedby')).toBe('capture-guide');
    click(button('Subtarea'));
    expect(document.activeElement).toBe(input('Subtarea 1'));
    type(input('Subtarea 1'), 'Comprar billetes @ana');
    enter(input('Subtarea 1'), true);
    expect(root.querySelectorAll('.subtask-field input')).toHaveLength(1);
    enter(input('Subtarea 1'));
    expect(document.activeElement).toBe(input('Subtarea 2'));
    expect(add).not.toHaveBeenCalled();
    type(input('Subtarea 2'), 'Reservar hotel');
    enter(input('Subtarea 2'));
    enter(input('Subtarea 3'));
    await vi.waitFor(() => expect(input('Nueva tarea').value).toBe(''));
    expect(add).toHaveBeenCalledTimes(1);
    const lines = add.mock.calls[0][0];
    expect(lines.map((l) => l.isSubtask)).toEqual([false, true, true]);
    expect(lines[0].topics).toEqual(['casa']);
    expect(lines[1].people).toEqual(['ana']);
    expect(root.querySelector('.subtask-inputs')).toBeNull();
    expect(document.activeElement).toBe(input('Nueva tarea'));
  });

  it('no pierde texto ante un fallo ni duplica guardados pendientes', async () => {
    const add = capture(vi.fn<(lines: ParsedLine[]) => Promise<void>>().mockRejectedValue(new Error('Sin espacio')));
    type(input('Nueva tarea'), 'Mi proyecto');
    click(button('Subtarea'));
    type(input('Subtarea 1'), 'Primer paso');
    enter(input('Subtarea 1'));
    enter(input('Subtarea 2'));
    enter(input('Subtarea 2'));
    await vi.waitFor(() => expect(root.querySelector('[role="alert"]')?.textContent).toBe('Sin espacio'));
    expect(add).toHaveBeenCalledTimes(1);
    expect(input('Nueva tarea').value).toBe('Mi proyecto');
    expect(input('Subtarea 1').value).toBe('Primer paso');
  });

  it('ofrece guardado táctil y evita guardar metadatos sin título', async () => {
    const add = capture();
    type(input('Nueva tarea'), 'Proyecto');
    click(button('Subtarea'));
    type(input('Subtarea 1'), '!alta');
    click(button('Guardar tarea'));
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('título');
    expect(add).not.toHaveBeenCalled();
    type(input('Subtarea 1'), 'Comprar pan #casa');
    click(button('Guardar tarea'));
    await vi.waitFor(() => expect(add).toHaveBeenCalledTimes(1));
  });

  it('cancelar las subtareas conserva la tarea principal', () => {
    capture();
    type(input('Nueva tarea'), 'Proyecto');
    click(button('Subtarea'));
    type(input('Subtarea 1'), 'Paso');
    click(button('Cancelar'));
    expect(input('Nueva tarea').value).toBe('Proyecto');
    expect(root.querySelector('.subtask-inputs')).toBeNull();
  });

  it('aplaza las escrituras de layout del observador y no repite alturas idénticas', () => {
    let notify = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { notify = callback; }
      observe() {}
      disconnect = disconnect;
    });
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => { frames.push(cb); return frames.length; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    capture();
    const box = root.querySelector('.capture')!;
    Object.defineProperty(box, 'offsetHeight', { configurable: true, value: 140 });
    const write = vi.spyOn(document.documentElement.style, 'setProperty');
    act(() => notify());
    expect(write).not.toHaveBeenCalled();
    act(() => { frames.shift()?.(0); });
    expect(write).toHaveBeenCalledExactlyOnceWith('--capture-height', '140px');
    act(() => notify());
    act(() => { frames.shift()?.(0); });
    expect(write).toHaveBeenCalledTimes(1);
    act(() => render(null, root));
    expect(disconnect).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });
});

describe('lista de subtareas', () => {
  it('guarda desde la captura y conserva las subtareas al volver a abrir la app', async () => {
    const repo = createRepo('ui-' + crypto.randomUUID());
    await app(repo);
    type(input('Nueva tarea'), 'Viaje #casa');
    click(button('Subtarea'));
    type(input('Subtarea 1'), 'Comprar billetes');
    enter(input('Subtarea 1'));
    enter(input('Subtarea 2'));
    await vi.waitFor(() => expect(root.querySelector('.subtask-toggle')).not.toBeNull());
    const tasks = await repo.listTasks();
    const parent = tasks.find((t) => t.parentId === null)!;
    expect(tasks.filter((t) => t.parentId === parent.id).map((t) => t.title)).toEqual(['Comprar billetes']);
    act(() => render(null, root));
    await app(repo);
    expect(root.querySelector('.row.sub')).toBeNull();
    click(root.querySelector('.subtask-toggle'));
    expect(root.querySelector('.row.sub .title')?.textContent).toBe('Comprar billetes');
  });

  it.each([false, true])('pliega, despliega, completa y reabre con diseño ancho=%s', async (wide) => {
    vi.stubGlobal('matchMedia', vi.fn((q: string) => ({
      matches: wide && q === '(min-width: 1200px)', addEventListener() {}, removeEventListener() {},
    })));
    const repo = createRepo('ui-' + crypto.randomUUID());
    const [parent, a, b] = await repo.addParsed([
      parseLine('Proyecto'), { ...parseLine('Primer paso'), isSubtask: true }, { ...parseLine('Segundo paso'), isSubtask: true },
    ]);
    await app(repo);
    expect(!!root.querySelector('.app.wide')).toBe(wide);
    expect(root.querySelectorAll('.row.sub')).toHaveLength(0);
    const toggle = root.querySelector('.subtask-toggle');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    click(toggle);
    expect(root.querySelectorAll('.row.sub')).toHaveLength(2);
    expect(root.querySelector<HTMLButtonElement>(`[data-id="${parent.id}"] .check`)?.disabled).toBe(true);
    click(root.querySelector(`[data-id="${a.id}"] .check`));
    await vi.waitFor(() => expect(root.querySelector(`[data-id="${a.id}"]`)?.classList.contains('done')).toBe(true));
    expect(root.querySelector(`[data-id="${parent.id}"]`)?.classList.contains('done')).toBe(false);
    click(root.querySelector(`[data-id="${b.id}"] .check`));
    await vi.waitFor(() => expect(root.querySelector(`[data-id="${parent.id}"]`)?.classList.contains('done')).toBe(true));
    click(root.querySelector(`[data-id="${a.id}"] .check`));
    await vi.waitFor(() => expect(root.querySelector(`[data-id="${parent.id}"]`)?.classList.contains('done')).toBe(false));
    click(root.querySelector(`[data-id="${parent.id}"] .title`));
    expect(root.querySelectorAll('.row.sub')).toHaveLength(0);
  });

  it('añade subtareas a una tarea existente desde su editor', async () => {
    const repo = createRepo('ui-' + crypto.randomUUID());
    const [parent] = await repo.addParsed([parseLine('Proyecto')]);
    await app(repo);
    click(root.querySelector(`[data-id="${parent.id}"] .title`));
    click(button('Subtarea'));
    type(input('Subtarea 1'), 'Paso añadido');
    enter(input('Subtarea 1'));
    enter(input('Subtarea 2'));
    await vi.waitFor(() => expect(root.querySelector('.row.sub .title')?.textContent).toBe('Paso añadido'));
    const children = (await repo.listTasks()).filter((t) => t.parentId === parent.id);
    expect(children).toHaveLength(1);
  });

  it('mantiene el icono y toda la familia al filtrar solo el título del padre', async () => {
    const repo = createRepo('ui-' + crypto.randomUUID());
    await repo.addParsed([parseLine('Proyecto'), { ...parseLine('Paso'), isSubtask: true }]);
    localStorage.setItem('lista.filter', JSON.stringify({ text: 'Proyecto' }));
    await app(repo);
    click(root.querySelector('.subtask-toggle'));
    expect(root.querySelector('.row.sub .title')?.textContent).toBe('Paso');
  });

  it.each(['captura', 'existente'])('usar Ajustes no roba el foco ni pierde el borrador de subtarea en %s', async (surface) => {
    const repo = createRepo('ui-' + crypto.randomUUID());
    let parentId = '';
    if (surface === 'existente') {
      const [parent] = await repo.addParsed([parseLine('Proyecto')]);
      parentId = parent.id;
    }
    await app(repo);
    if (parentId) click(root.querySelector(`[data-id="${parentId}"] .title`));
    else type(input('Nueva tarea'), 'Proyecto');
    click(button('Subtarea'));
    type(input('Subtarea 1'), 'Borrador conservado');
    click(root.querySelector('[aria-label="Ajustes"]'));
    const focus = vi.spyOn(input('Subtarea 1'), 'focus');
    for (const name of ['Oscuro', 'Clásico', 'Claro', 'Industrial', 'Sistema']) {
      const control = button(name);
      act(() => control.focus());
      click(control);
      expect(document.activeElement).toBe(control);
    }
    expect(focus).not.toHaveBeenCalled();
    click(button('Cerrar'));
    expect(input('Subtarea 1').value).toBe('Borrador conservado');
    click(button(parentId ? 'Añadir subtareas' : 'Guardar tarea'));
    if (!parentId) {
      await vi.waitFor(() => expect(root.querySelector('.subtask-toggle')).not.toBeNull());
      click(root.querySelector('.subtask-toggle'));
    }
    await vi.waitFor(() => expect(root.querySelector('.row.sub .title')?.textContent).toBe('Borrador conservado'));
  });
});

describe('color de subtareas', () => {
  it('usa rosa, permite personalizarlo en ajustes y lo conserva al aplicar el tema', async () => {
    const repo = createRepo('ui-' + crypto.randomUUID());
    await app(repo);
    click(root.querySelector('[aria-label="Ajustes"]'));
    const color = root.querySelector<HTMLInputElement>('#subtask-color')!;
    expect(color.value).toBe(DEFAULT_SUBTASK_COLOR);
    expect(color.closest('label')?.classList.contains('btn')).toBe(true);
    type(color, '#3689cc');
    expect(localStorage.getItem('lista.subtaskColor')).toBe('#3689cc');
    applyTheme('dark', 'industrial');
    expect(document.documentElement.style.getPropertyValue('--subtask-color')).toBe('#3689cc');
    click(button('Rosa'));
    expect(getSubtaskColor()).toBe(DEFAULT_SUBTASK_COLOR);
  });

  it('rechaza valores no válidos y tolera preferencias corruptas', () => {
    expect(() => setSubtaskColor('red')).toThrow('color válido');
    localStorage.setItem('lista.subtaskColor', 'invalid');
    expect(getSubtaskColor()).toBe(DEFAULT_SUBTASK_COLOR);
  });
});
