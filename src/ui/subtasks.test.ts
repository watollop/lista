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
import { SubtaskInputs } from './SubtaskInputs';
import { INTRO_KEY } from './Onboarding';
import { DEFAULT_SUBTASK_COLOR, applyTheme, getSubtaskColor, setSubtaskColor } from './theme';
import type { Entity, ParsedLine, Repo } from '../types';

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

function paste(el: HTMLInputElement, text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
  act(() => { el.dispatchEvent(event); });
  return event;
}

function button(text: string): HTMLButtonElement {
  const el = [...root.querySelectorAll('button')].find((b) => b.textContent === text);
  expect(el, text).toBeDefined();
  return el!;
}

function capture(onAdd = vi.fn<(lines: ParsedLine[]) => Promise<void>>().mockResolvedValue(undefined), topics: Entity[] = []) {
  act(() => render(h(Capture, {
    topics, people: [], names: new Map(), today: '2026-10-29', kbOpen: false,
    inputRef: { current: null }, onAdd,
  }), root));
  return onAdd;
}

async function app(repo: Repo) {
  act(() => render(h(App, { repo, sync: createSync(repo, null) }), root));
  await vi.waitFor(() => expect(root.querySelector('.empty, .list')).not.toBeNull());
}

describe('captura con subtareas', () => {
  it('la captura externa conserva varias familias inline y limpia la URL solo al guardarlas', async () => {
    const repo = createRepo('ui-' + crypto.randomUUID());
    history.replaceState(null, '', '/?nueva=' + encodeURIComponent('Viaje <Billetes\nCompra <Pan !alta'));
    await app(repo);
    await vi.waitFor(async () => expect(await repo.listTasks()).toHaveLength(4));
    const tasks = await repo.listTasks();
    const trip = tasks.find((t) => t.title === 'Viaje')!;
    const shop = tasks.find((t) => t.title === 'Compra')!;
    expect(trip.parentId).toBeNull();
    expect(shop.parentId).toBeNull();
    expect(tasks.find((t) => t.title === 'Billetes')?.parentId).toBe(trip.id);
    expect(tasks.find((t) => t.title === 'Pan')).toMatchObject({ parentId: shop.id, priority: 1 });
    expect(location.search).toBe('');
  });

  it.each(['Proyecto <', '<Paso', 'Proyecto <<Paso'])('la captura externa informa de títulos vacíos sin crear tareas ni perder la URL: %s', async (text) => {
    const repo = createRepo('ui-' + crypto.randomUUID());
    const query = '?nueva=' + encodeURIComponent(text);
    history.replaceState(null, '', '/' + query);
    await app(repo);
    await vi.waitFor(() => expect(root.querySelector('.toast')?.textContent).toContain('título'));
    expect(await repo.listTasks()).toEqual([]);
    expect(location.search).toBe(query);
  });

  it('un fallo de captura externa se muestra y permite reintentar desde la misma URL', async () => {
    const repo = createRepo('ui-' + crypto.randomUUID());
    vi.spyOn(repo, 'addParsed').mockRejectedValue(new Error('Sin espacio'));
    history.replaceState(null, '', '/?nueva=Viaje%20%3CBilletes');
    await app(repo);
    await vi.waitFor(() => expect(root.querySelector('.toast')?.textContent).toContain('Sin espacio'));
    expect(location.search).toBe('?nueva=Viaje%20%3CBilletes');
    expect(await repo.listTasks()).toEqual([]);
  });
  it('mantiene la guía sin botones de subtarea y guarda el conjunto inline con Enter', async () => {
    const add = capture();
    expect(input('Nueva tarea').placeholder).toBe('Viaje <Billetes mañana !alta #ocio @ana');
    type(input('Nueva tarea'), 'Preparar viaje #casa <Comprar billetes @ana <Reservar hotel');
    expect(root.querySelector('.capture-guide')?.textContent).toBe('#tema @persona !prioridad fecha <subtarea');
    expect(input('Nueva tarea').getAttribute('aria-describedby')).toBe('capture-guide');
    expect(root.querySelector('.capture .add-subtask-action, .capture .add-subtask, .capture .subtask-inputs')).toBeNull();
    expect([...root.querySelectorAll('.capture button')].some((button) => button.textContent?.includes('Subtarea'))).toBe(false);
    enter(input('Nueva tarea'), true);
    expect(add).not.toHaveBeenCalled();
    enter(input('Nueva tarea'));
    await vi.waitFor(() => expect(input('Nueva tarea').value).toBe(''));
    expect(add).toHaveBeenCalledTimes(1);
    const lines = add.mock.calls[0][0];
    expect(lines.map((l) => l.isSubtask)).toEqual([false, true, true]);
    expect(lines[0].topics).toEqual(['casa']);
    expect(lines[1].people).toEqual(['ana']);
    expect(root.querySelector('.subtask-inputs')).toBeNull();
    expect(document.activeElement).toBe(input('Nueva tarea'));
  });

  it('guarda tarea y subtareas inline con metadatos separados y devuelve los ejemplos al vaciarse', async () => {
    const add = capture();
    type(input('Nueva tarea'), 'Tarea A <Subtarea B <Subtarea C !alta mañana #tema @ana');
    expect(root.querySelector('.capture-guide')?.textContent).toContain('<subtarea');
    enter(input('Nueva tarea'));
    await vi.waitFor(() => expect(add).toHaveBeenCalledOnce());
    const [parent, b, c] = add.mock.calls[0][0];
    expect(parent).toMatchObject({ title: 'Tarea A', isSubtask: false, due: null, priority: null });
    expect(b).toMatchObject({ title: 'Subtarea B', isSubtask: true, topics: [] });
    expect(c).toMatchObject({ title: 'Subtarea C #tema @ana', isSubtask: true, priority: 1, topics: ['tema'], people: ['ana'] });
    expect(c.due).not.toBeNull();
    await vi.waitFor(() => expect(input('Nueva tarea').value).toBe(''));
    expect(input('Nueva tarea').placeholder).toBe('Viaje <Billetes mañana !alta #ocio @ana');
  });

  it.each(['Proyecto <', 'Proyecto <<Paso', 'Proyecto <!alta', '<Paso'])('informa de segmentos sin título sin perder el borrador: %s', async (value) => {
    const add = capture();
    type(input('Nueva tarea'), value);
    enter(input('Nueva tarea'));
    await vi.waitFor(() => expect(root.querySelector('[role="alert"]')?.textContent).toContain('título'));
    expect(add).not.toHaveBeenCalled();
    expect(input('Nueva tarea').value).toBe(value);
  });

  it('un fallo al guardar la sintaxis inline conserva la línea completa', async () => {
    const add = capture(vi.fn<(lines: ParsedLine[]) => Promise<void>>().mockRejectedValue(new Error('Sin espacio')));
    const value = 'Proyecto <Paso uno <Paso dos';
    type(input('Nueva tarea'), value);
    enter(input('Nueva tarea'));
    await vi.waitFor(() => expect(root.querySelector('[role="alert"]')?.textContent).toBe('Sin espacio'));
    expect(add).toHaveBeenCalledOnce();
    expect(input('Nueva tarea').value).toBe(value);
  });

  it.each(['Proyecto <\nOtra tarea', 'Proyecto\nPaso <!alta'])('rechaza pegados con subtareas vacías sin modificar el borrador: %s', (value) => {
    const add = capture();
    type(input('Nueva tarea'), 'Borrador original');
    const event = paste(input('Nueva tarea'), value);
    expect(event.defaultPrevented).toBe(true);
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('título');
    expect(input('Nueva tarea').value).toBe('Borrador original');
    expect(add).not.toHaveBeenCalled();
  });

  it('no duplica un guardado con un pegado mientras espera la escritura', async () => {
    let finish!: () => void;
    const add = capture(vi.fn<(lines: ParsedLine[]) => Promise<void>>().mockImplementation(
      () => new Promise<void>((resolve) => { finish = resolve; }),
    ));
    type(input('Nueva tarea'), 'Proyecto <Paso');
    enter(input('Nueva tarea'));
    expect(input('Nueva tarea').disabled).toBe(true);
    paste(input('Nueva tarea'), 'Otra tarea\nOtro paso');
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('Guarda primero');
    expect(add).toHaveBeenCalledOnce();
    await act(async () => { finish(); });
    expect(input('Nueva tarea').value).toBe('');
  });

  it('conserva el borrador e informa si falla un pegado de varias tareas', async () => {
    const add = capture(vi.fn<(lines: ParsedLine[]) => Promise<void>>().mockRejectedValue(new Error('Sin espacio')));
    type(input('Nueva tarea'), 'Borrador original');
    paste(input('Nueva tarea'), 'Proyecto <Paso\nOtra tarea');
    await vi.waitFor(() => expect(root.querySelector('[role="alert"]')?.textContent).toBe('Sin espacio'));
    expect(input('Nueva tarea').value).toBe('Borrador original');
    expect(add).toHaveBeenCalledOnce();
  });

  it('conserva el acceso al dictado sin mostrar controles de subtareas en la captura', async () => {
    const abort = vi.fn();
    vi.stubGlobal('SpeechRecognition', class { start() {} stop() {} abort = abort; });
    capture();
    click(root.querySelector('[aria-label="Dictar tareas"]'));
    await vi.waitFor(() => expect(root.querySelector('.dict-list')).not.toBeNull());
    expect(root.querySelector('.capture .add-subtask-action')).toBeNull();
    click(button('Cancelar'));
    await vi.waitFor(() => expect(root.querySelector('.dict-list')).toBeNull());
    expect(abort).toHaveBeenCalled();
  });

  it('autocompletar antes de otra subtarea conserva el separador y su texto', async () => {
    const add = capture(undefined, [{ key: 'casa', name: 'Casa', updatedAt: 0, deleted: 0, dirty: 0 }]);
    const value = 'Proyecto <#ca<Otra subtarea';
    const el = input('Nueva tarea');
    type(el, value);
    act(() => {
      el.setSelectionRange(value.indexOf('<Otra'), value.indexOf('<Otra'));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(root.querySelector('.suggest')).not.toBeNull();
    enter(el);
    expect(el.value).toBe('Proyecto <#Casa <Otra subtarea');
    expect(add).not.toHaveBeenCalled();
    enter(el);
    await vi.waitFor(() => expect(add).toHaveBeenCalledOnce());
    expect(add.mock.calls[0][0].map((line) => line.title)).toEqual(['Proyecto', '#Casa', 'Otra subtarea']);
  });

  it('no pierde texto ante un fallo ni duplica guardados pendientes', async () => {
    const add = capture(vi.fn<(lines: ParsedLine[]) => Promise<void>>().mockRejectedValue(new Error('Sin espacio')));
    type(input('Nueva tarea'), 'Mi proyecto <Primer paso');
    enter(input('Nueva tarea'));
    enter(input('Nueva tarea'));
    await vi.waitFor(() => expect(root.querySelector('[role="alert"]')?.textContent).toBe('Sin espacio'));
    expect(add).toHaveBeenCalledTimes(1);
    expect(input('Nueva tarea').value).toBe('Mi proyecto <Primer paso');
  });

  it('ofrece guardado táctil y evita guardar metadatos sin título', async () => {
    const add = vi.fn<(lines: ParsedLine[]) => Promise<void>>().mockResolvedValue(undefined);
    act(() => render(h(SubtaskInputs, { onSubmit: add, onCancel: vi.fn() }), root));
    type(input('Subtarea 1'), '!alta');
    click(button('Guardar tarea'));
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('título');
    expect(add).not.toHaveBeenCalled();
    type(input('Subtarea 1'), 'Comprar pan #casa');
    click(button('Guardar tarea'));
    await vi.waitFor(() => expect(add).toHaveBeenCalledTimes(1));
  });

  it('cancelar las entradas de subtareas no envía sus borradores', () => {
    const add = vi.fn<(lines: ParsedLine[]) => Promise<void>>().mockResolvedValue(undefined);
    const cancel = vi.fn();
    act(() => render(h(SubtaskInputs, { onSubmit: add, onCancel: cancel }), root));
    type(input('Subtarea 1'), 'Paso');
    click(button('Cancelar'));
    expect(cancel).toHaveBeenCalledOnce();
    expect(add).not.toHaveBeenCalled();
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
  it('pegar varias familias con < guarda cada subtarea bajo su propia tarea', async () => {
    const repo = createRepo('ui-' + crypto.randomUUID());
    await app(repo);
    paste(input('Nueva tarea'), 'Proyecto A <Paso B <Paso C !alta mañana #tema\nProyecto D <Paso E @ana');
    await vi.waitFor(async () => expect(await repo.listTasks()).toHaveLength(5));
    const tasks = await repo.listTasks();
    const a = tasks.find((task) => task.title === 'Proyecto A')!;
    const d = tasks.find((task) => task.title === 'Proyecto D')!;
    expect(tasks.filter((task) => task.parentId === null)).toHaveLength(2);
    expect(tasks.filter((task) => task.parentId === a.id).sort((a, b) => a.order - b.order).map((task) => task.title))
      .toEqual(['Paso B', 'Paso C #tema']);
    expect(tasks.find((task) => task.title === 'Paso C #tema')).toMatchObject({ priority: 1, topics: ['tema'] });
    expect(tasks.find((task) => task.title === 'Paso E @ana')).toMatchObject({ parentId: d.id, people: ['ana'] });
  });

  it('guarda desde la captura y conserva las subtareas al volver a abrir la app', async () => {
    const repo = createRepo('ui-' + crypto.randomUUID());
    await app(repo);
    type(input('Nueva tarea'), 'Viaje #casa <Comprar billetes');
    enter(input('Nueva tarea'));
    await vi.waitFor(() => expect(root.querySelector('.row.has-subtasks')).not.toBeNull());
    const tasks = await repo.listTasks();
    const parent = tasks.find((t) => t.parentId === null)!;
    expect(tasks.filter((t) => t.parentId === parent.id).map((t) => t.title)).toEqual(['Comprar billetes']);
    act(() => render(null, root));
    await app(repo);
    expect(root.querySelector('.row.sub')).toBeNull();
    click(root.querySelector('.row.has-subtasks .title'));
    expect(root.querySelector('.row.sub .title')?.textContent).toBe('Comprar billetes');
  });

  it.each([false, true])('pliega, despliega, completa y reabre con diseño ancho=%s', async (wide) => {
    vi.stubGlobal('matchMedia', vi.fn((q: string) => ({
      matches: wide && q === '(min-width: 1200px)', addEventListener() {}, removeEventListener() {},
    })));
    const repo = createRepo('ui-' + crypto.randomUUID());
    const [parent, a, b, plain] = await repo.addParsed([
      parseLine('Proyecto'), { ...parseLine('Primer paso'), isSubtask: true }, { ...parseLine('Segundo paso'), isSubtask: true },
      parseLine('Sin subtareas'),
    ]);
    await app(repo);
    expect(!!root.querySelector('.app.wide')).toBe(wide);
    expect(root.querySelector(`[data-id="${plain.id}"]`)?.classList.contains('has-subtasks')).toBe(false);
    expect(root.querySelector(`[data-id="${plain.id}"]`)?.classList.contains('subtasks-collapsed')).toBe(false);
    expect(root.querySelector(`[data-id="${parent.id}"]`)?.classList.contains('subtasks-collapsed')).toBe(true);
    expect(root.querySelector(`[data-id="${plain.id}"] .title`)?.hasAttribute('aria-expanded')).toBe(false);
    expect(root.querySelectorAll('.row.sub')).toHaveLength(0);
    const toggle = root.querySelector('.row.has-subtasks .title');
    expect(root.querySelector('.subtask-toggle')).toBeNull();
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    click(toggle);
    expect(root.querySelector(`[data-id="${parent.id}"]`)?.classList.contains('subtasks-collapsed')).toBe(false);
    expect(root.querySelectorAll('.row.sub')).toHaveLength(2);
    expect(root.querySelector('.subtask-group')).not.toBeNull();
    expect(root.querySelector('.row.has-subtasks .title')?.getAttribute('aria-label')).toContain('0 de 2 subtareas');
    expect(root.querySelector<HTMLButtonElement>(`[data-id="${parent.id}"] .check`)?.disabled).toBe(false);
    click(root.querySelector(`[data-id="${a.id}"] .check`));
    await vi.waitFor(() => expect(root.querySelector(`[data-id="${a.id}"]`)?.classList.contains('done')).toBe(true));
    expect([...root.querySelectorAll('.row.sub')].map((row) => row.getAttribute('data-id'))).toEqual([a.id, b.id]);
    expect(root.querySelector('.row.sub:last-child')?.getAttribute('data-id')).toBe(b.id);
    expect(root.querySelector('.row.sub:last-child [aria-label="Añadir subtarea"]')).not.toBeNull();
    expect(root.querySelector(`[data-id="${parent.id}"]`)?.classList.contains('done')).toBe(false);
    click(root.querySelector(`[data-id="${b.id}"] .check`));
    await vi.waitFor(() => expect(root.querySelector(`[data-id="${parent.id}"]`)?.classList.contains('done')).toBe(true));
    expect([...root.querySelectorAll('.row.sub')].map((row) => row.getAttribute('data-id'))).toEqual([a.id, b.id]);
    click(root.querySelector(`[data-id="${a.id}"] .check`));
    await vi.waitFor(() => expect(root.querySelector(`[data-id="${parent.id}"]`)?.classList.contains('done')).toBe(false));
    expect([...root.querySelectorAll('.row.sub')].map((row) => row.getAttribute('data-id'))).toEqual([a.id, b.id]);
    click(root.querySelector(`[data-id="${parent.id}"] .title`));
    expect(root.querySelectorAll('.row.sub')).toHaveLength(0);
    expect(root.querySelector('.row.has-subtasks')).not.toBeNull();
    expect(root.querySelector('.subtask-group')).toBeNull();
    expect(root.querySelector(`[data-id="${parent.id}"]`)?.classList.contains('subtasks-collapsed')).toBe(true);
    click(root.querySelector(`[data-id="${parent.id}"] .title`));
    const title = root.querySelector<HTMLButtonElement>(`[data-id="${parent.id}"] .title`)!;
    act(() => {
      title.focus();
      title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(root.querySelector('input[aria-label="Editar tarea"]')).toBeNull();
    click(title);
    expect(root.querySelectorAll('.row.sub')).toHaveLength(0);
    click(root.querySelector(`[data-id="${parent.id}"] .edit-task`));
    expect(input('Editar tarea')).not.toBeNull();
  });

  it.each([false, true])('cerrar el padre por casilla o teclado cierra todas las subtareas y permite deshacer; ancho=%s', async (wide) => {
    vi.stubGlobal('matchMedia', vi.fn((q: string) => ({
      matches: wide && q === '(min-width: 1200px)', addEventListener() {}, removeEventListener() {},
    })));
    const repo = createRepo('ui-' + crypto.randomUUID());
    const [parent] = await repo.addParsed([parseLine('Proyecto'), { ...parseLine('Paso'), isSubtask: true }]);
    await app(repo);
    click(root.querySelector(`[data-id="${parent.id}"] .check`));
    await vi.waitFor(async () => expect((await repo.listTasks()).every((t) => t.done)).toBe(true));
    expect(root.querySelector(`[data-id="${parent.id}"] .check`)?.getAttribute('aria-pressed')).toBe('true');
    click(root.querySelector('.toast .link'));
    await vi.waitFor(async () => expect((await repo.listTasks()).every((t) => !t.done)).toBe(true));
    click(root.querySelector(`[data-id="${parent.id}"] .title`));
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true })); });
    await vi.waitFor(async () => expect((await repo.listTasks()).every((t) => t.done)).toBe(true));
    const check = root.querySelector<HTMLButtonElement>(`[data-id="${parent.id}"] .check`)!;
    act(() => {
      check.focus();
      check.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(root.querySelector('input[aria-label="Editar tarea"]')).toBeNull();
    expect((await repo.listTasks()).every((t) => t.done)).toBe(true);
    click(check);
    await vi.waitFor(async () => expect((await repo.listTasks()).every((t) => !t.done)).toBe(true));
  });

  it('el Deshacer real del padre conserva el estado y la fecha de subtareas hechas anteriormente', async () => {
    const repo = createRepo('ui-' + crypto.randomUUID());
    const [parent, a, b] = await repo.addParsed([
      parseLine('Proyecto'), { ...parseLine('Hecha antes'), isSubtask: true }, { ...parseLine('Pendiente'), isSubtask: true },
    ]);
    await repo.toggleDone(a.id);
    const previous = (await repo.listTasks()).find((t) => t.id === a.id)!;
    await app(repo);
    click(root.querySelector(`[data-id="${parent.id}"] .check`));
    await vi.waitFor(() => expect(root.querySelector('.toast .link')).not.toBeNull());
    click(root.querySelector('.toast .link'));
    await vi.waitFor(async () => expect((await repo.listTasks()).find((t) => t.id === b.id)?.done).toBe(0));
    const tasks = await repo.listTasks();
    expect(tasks.find((t) => t.id === a.id)).toEqual(previous);
    expect(tasks.find((t) => t.id === parent.id)?.done).toBe(0);
  });

  it('el Deshacer muestra conflictos sin descartar cambios posteriores', async () => {
    const repo = createRepo('ui-' + crypto.randomUUID());
    const [parent] = await repo.addParsed([parseLine('Proyecto'), { ...parseLine('Paso'), isSubtask: true }]);
    await app(repo);
    click(root.querySelector(`[data-id="${parent.id}"] .check`));
    await vi.waitFor(() => expect(root.querySelector('.toast .link')).not.toBeNull());
    await repo.updateTask(parent.id, { doneAt: 123 });
    click(root.querySelector('.toast .link'));
    await vi.waitFor(() => expect(root.querySelector('.toast')?.textContent).toContain('ha cambiado'));
    expect((await repo.listTasks()).every((t) => t.done)).toBe(true);
  });

  it('añade subtareas a una tarea existente desde su editor', async () => {
    const repo = createRepo('ui-' + crypto.randomUUID());
    const [parent] = await repo.addParsed([parseLine('Proyecto')]);
    await app(repo);
    click(root.querySelector(`[data-id="${parent.id}"] .title`));
    type(input('Editar tarea'), 'Proyecto editado');
    const action = root.querySelector('.edit-actions [aria-label="Añadir subtarea"]');
    expect(action?.textContent?.trim()).toBe('');
    expect(action?.querySelector('svg')).not.toBeNull();
    const editorMouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    act(() => { action!.dispatchEvent(editorMouseDown); });
    expect(editorMouseDown.defaultPrevented).toBe(true);
    click(action);
    type(input('Subtarea 1'), 'Borrador cancelado');
    click(button('Cancelar'));
    expect(root.querySelector('.subtask-inputs')).toBeNull();
    await vi.waitFor(async () => expect((await repo.listTasks())[0].title).toBe('Proyecto editado'));
    click(root.querySelector(`[data-id="${parent.id}"] .title`));
    click(root.querySelector('.edit-actions [aria-label="Añadir subtarea"]'));
    type(input('Subtarea 1'), 'Paso añadido');
    enter(input('Subtarea 1'));
    enter(input('Subtarea 2'));
    await vi.waitFor(() => expect(root.querySelector('.row.sub .title')?.textContent).toBe('Paso añadido'));
    const children = (await repo.listTasks()).filter((t) => t.parentId === parent.id);
    expect(children).toHaveLength(1);
    const add = root.querySelector('.row.sub:last-child [aria-label="Añadir subtarea"]');
    expect(add?.textContent?.trim()).toBe('');
    expect(add?.querySelector('svg')).not.toBeNull();
    expect(root.querySelector('.subtask-composer')).toBeNull();
    expect(root.querySelectorAll('.add-subtask-icon')).toHaveLength(1);
    const rowMouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    act(() => { add!.dispatchEvent(rowMouseDown); });
    expect(rowMouseDown.defaultPrevented).toBe(false);
    click(add);
    type(input('Subtarea 1'), 'Otro paso desde el más <Paso inline !alta');
    enter(input('Subtarea 1'));
    enter(input('Subtarea 2'));
    await vi.waitFor(() => expect(root.querySelectorAll('.row.sub')).toHaveLength(3));
    const updated = (await repo.listTasks()).filter((t) => t.parentId === parent.id);
    expect(updated).toHaveLength(3);
    expect(updated.find((t) => t.title === 'Paso inline')?.priority).toBe(1);
    expect(root.querySelector('.row.sub:last-child [aria-label="Añadir subtarea"]')).not.toBeNull();
  });

  it('mantiene el indicador y toda la familia al filtrar solo el título del padre', async () => {
    const repo = createRepo('ui-' + crypto.randomUUID());
    await repo.addParsed([parseLine('Proyecto'), { ...parseLine('Paso'), isSubtask: true }]);
    localStorage.setItem('lista.filter', JSON.stringify({ text: 'Proyecto' }));
    await app(repo);
    click(root.querySelector('.row.has-subtasks .title'));
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
    if (parentId) {
      click(root.querySelector(`[data-id="${parentId}"] .title`));
      click(root.querySelector('.edit-actions [aria-label="Añadir subtarea"]'));
    }
    const field = parentId ? 'Subtarea 1' : 'Nueva tarea';
    const draft = parentId ? 'Borrador conservado' : 'Proyecto <Borrador conservado';
    type(input(field), draft);
    click(root.querySelector('[aria-label="Ajustes"]'));
    const focus = vi.spyOn(input(field), 'focus');
    for (const name of ['Oscuro', 'Clásico', 'Claro', 'Industrial', 'Sistema']) {
      const control = button(name);
      act(() => control.focus());
      click(control);
      expect(document.activeElement).toBe(control);
    }
    expect(focus).not.toHaveBeenCalled();
    click(button('Cerrar'));
    expect(input(field).value).toBe(draft);
    if (parentId) click(button('Añadir subtareas'));
    else enter(input('Nueva tarea'));
    if (!parentId) {
      await vi.waitFor(() => expect(root.querySelector('.row.has-subtasks')).not.toBeNull());
      click(root.querySelector('.row.has-subtasks .title'));
    }
    await vi.waitFor(() => expect(root.querySelector('.row.sub .title')?.textContent).toBe('Borrador conservado'));
  });
});

describe('color secundario', () => {
  it('muestra errores al cargar la preferencia en lugar de fallar en silencio', async () => {
    const repo = createRepo('ui-' + crypto.randomUUID());
    vi.spyOn(repo, 'getSetting').mockRejectedValue(new Error('No se pudo leer el color'));
    await app(repo);
    await vi.waitFor(() => expect(root.querySelector('.toast')?.textContent).toContain('No se pudo leer el color'));
  });

  it.each(['input', 'change'])('guarda el selector nativo al recibir %s y conserva la última selección rápida', async (eventName) => {
    const repo = createRepo('ui-' + crypto.randomUUID());
    await app(repo);
    click(root.querySelector('[aria-label="Ajustes"]'));
    click(button('Clásico'));
    const picker = input('Color secundario personalizado');
    act(() => {
      for (const value of ['#123456', '#654321', '#7849ce']) {
        picker.value = value;
        picker.dispatchEvent(new Event(eventName, { bubbles: true }));
      }
    });
    await vi.waitFor(() => expect(getSubtaskColor()).toBe('#7849ce'));
    await vi.waitFor(async () => expect(await repo.getSetting('appearance')).toMatchObject({ value: { subtaskColor: '#7849ce' } }));
    expect(picker.closest('label')?.classList.contains('selected')).toBe(true);
    expect(picker.value).toBe('#7849ce');
  });

  it('solo muestra la paleta en Clásico y conserva el color al pasar por Industrial', async () => {
    const repo = createRepo('ui-' + crypto.randomUUID());
    await repo.setSetting('appearance', { theme: 'system', look: 'industrial', subtaskColor: '#7849ce' });
    await app(repo);
    click(root.querySelector('[aria-label="Ajustes"]'));
    expect(root.querySelector('.subtask-colors')).toBeNull();
    expect(root.querySelector('#subtask-color-label')).toBeNull();
    click(button('Clásico'));
    await vi.waitFor(() => expect(input('Color secundario personalizado').value).toBe('#7849ce'));
    click(button('Industrial'));
    expect(root.querySelector('.subtask-colors')).toBeNull();
    expect(getSubtaskColor()).toBe('#7849ce');
    click(button('Clásico'));
    expect(input('Color secundario personalizado').value).toBe('#7849ce');
  });

  it('refleja la apariencia remota con Ajustes abierto y oculta la paleta si llega Industrial', async () => {
    const repo = createRepo('ui-' + crypto.randomUUID());
    await app(repo);
    click(root.querySelector('[aria-label="Ajustes"]'));
    click(button('Clásico'));
    click(button('Oscuro'));
    await vi.waitFor(async () => expect(await repo.getSetting('appearance')).toMatchObject({ value: { theme: 'dark', look: 'classic' } }));
    const remoteTime = (await repo.getSetting('appearance'))!.updatedAt + 1000;
    await repo.applyRemote([{
      kind: 'setting', id: 'appearance',
      data: { key: 'appearance', value: { theme: 'dark', look: 'classic', subtaskColor: '#3689cc' }, updatedAt: remoteTime, deleted: 0 },
      updated_at: remoteTime, deleted: false,
    }]);
    await vi.waitFor(() => expect(input('Color secundario personalizado').value).toBe('#3689cc'));
    expect(root.querySelector('[aria-label="Azul"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(document.documentElement.style.getPropertyValue('--subtask-color')).toBe('#3689cc');
    expect(document.documentElement.dataset.look).toBeUndefined();
    expect(document.documentElement.dataset.theme).toBe('dark');
    await repo.applyRemote([{
      kind: 'setting', id: 'appearance',
      data: { key: 'appearance', value: { theme: 'light', look: 'industrial', subtaskColor: '#58a676' }, updatedAt: remoteTime + 1000, deleted: 0 },
      updated_at: remoteTime + 1000, deleted: false,
    }]);
    await vi.waitFor(() => expect(root.querySelector('.subtask-colors')).toBeNull());
    expect(document.documentElement.dataset.look).toBe('industrial');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('aplica la elección local y avisa si no puede guardarla para sincronizar', async () => {
    const repo = createRepo('ui-' + crypto.randomUUID());
    await app(repo);
    click(root.querySelector('[aria-label="Ajustes"]'));
    click(button('Clásico'));
    await vi.waitFor(async () => expect(await repo.getSetting('appearance')).toBeDefined());
    vi.spyOn(repo, 'setSetting').mockRejectedValue(new Error('Sin espacio'));
    click(root.querySelector('[aria-label="Azul"]'));
    await vi.waitFor(() => expect(root.querySelector('.toast')?.textContent).toContain('Sin espacio'));
    expect(root.querySelector('[aria-label="Azul"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(getSubtaskColor()).toBe('#3689cc');
  });

  it('ofrece cuatro círculos de colores y uno personalizado sin texto y conserva la elección', async () => {
    const repo = createRepo('ui-' + crypto.randomUUID());
    await app(repo);
    click(root.querySelector('[aria-label="Ajustes"]'));
    click(button('Clásico'));
    let color = root.querySelector<HTMLInputElement>('#subtask-color')!;
    expect(root.querySelector('#subtask-color-label')?.textContent).toBe('Color secundario');
    expect(color.getAttribute('aria-label')).toBe('Color secundario personalizado');
    const palette = color.closest('[role="group"]')!;
    expect(palette.textContent?.trim()).toBe('');
    expect(palette.querySelectorAll('.color-option')).toHaveLength(5);
    expect(palette.querySelectorAll('button')).toHaveLength(4);
    expect(palette.querySelector('.multicolor')).not.toBeNull();
    expect(color.value).toBe(DEFAULT_SUBTASK_COLOR);
    expect(palette.querySelector('[aria-label="Rosa"]')?.getAttribute('aria-pressed')).toBe('true');
    for (const [name, value] of [['Azul', '#3689cc'], ['Verde', '#58a676'], ['Naranja', '#e68b45'], ['Rosa', DEFAULT_SUBTASK_COLOR]]) {
      click(palette.querySelector(`[aria-label="${name}"]`));
      await vi.waitFor(() => expect(getSubtaskColor()).toBe(value));
      expect(color.value).toBe(value);
      expect(document.documentElement.style.getPropertyValue('--subtask-color')).toBe(value);
      expect(palette.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
      expect(palette.querySelector(`[aria-label="${name}"]`)?.getAttribute('aria-pressed')).toBe('true');
      expect(color.closest('label')?.classList.contains('selected')).toBe(false);
    }
    type(color, '#7849ce');
    await vi.waitFor(() => expect(localStorage.getItem('lista.subtaskColor')).toBe('#7849ce'));
    expect(palette.querySelector('[aria-pressed="true"]')).toBeNull();
    expect(color.closest('label')?.classList.contains('selected')).toBe(true);
    applyTheme('dark', 'industrial');
    expect(document.documentElement.style.getPropertyValue('--subtask-color')).toBe('#7849ce');
    click(button('Cerrar'));
    click(root.querySelector('[aria-label="Ajustes"]'));
    color = root.querySelector<HTMLInputElement>('#subtask-color')!;
    expect(color.value).toBe('#7849ce');
    expect(color.closest('label')?.classList.contains('selected')).toBe(true);
    click(root.querySelector('[aria-label="Rosa"]'));
    await vi.waitFor(() => expect(getSubtaskColor()).toBe(DEFAULT_SUBTASK_COLOR));
  });

  it('rechaza valores no válidos y tolera preferencias corruptas', () => {
    expect(() => setSubtaskColor('red')).toThrow('color válido');
    localStorage.setItem('lista.subtaskColor', 'invalid');
    expect(getSubtaskColor()).toBe(DEFAULT_SUBTASK_COLOR);
  });
});
