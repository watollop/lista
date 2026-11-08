// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAIN_LIST, type Task, type TodoList } from '../types';
import { SCOPE_KEY, inScope, listName, loadScope, openByList, resolveScope, saveScope } from './listScope';

const list = (id: string, name: string, order = 1): TodoList => ({ id, name, order, updatedAt: 0, deleted: 0, dirty: 0 });
const MAIN = list(MAIN_LIST, 'Personal', 0);
const COMPRA = list('c1', 'Compra');

const task = (over: Partial<Task> = {}): Task => ({
  id: 't' + Math.random().toString(36).slice(2), title: 'x', topics: [], people: [], due: null, period: null,
  priority: null, recurrence: null, parentId: null, done: 0, doneAt: null, nextId: null, order: 0, createdAt: 0,
  updatedAt: 0, deleted: 0, dirty: 0, ...over,
} as Task);

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('loadScope / saveScope', () => {
  it('por defecto es la principal', () => {
    expect(loadScope()).toBe(MAIN_LIST);
  });

  it('guarda y recupera la lista actual', () => {
    saveScope('c1');
    expect(localStorage.getItem(SCOPE_KEY)).toBe('c1');
    expect(loadScope()).toBe('c1');
    saveScope('all');
    expect(loadScope()).toBe('all');
  });

  it('si el almacenamiento falla, no lanza y devuelve la principal', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => saveScope('c1')).not.toThrow();
    expect(loadScope()).toBe(MAIN_LIST);
  });
});

describe('resolveScope', () => {
  it('conserva una lista que existe', () => {
    expect(resolveScope('c1', [MAIN, COMPRA])).toBe('c1');
  });

  it('si la lista ya no existe, vuelve a la principal', () => {
    expect(resolveScope('borrada', [MAIN, COMPRA])).toBe(MAIN_LIST);
  });

  it('«Todas» con una sola lista es la principal', () => {
    expect(resolveScope('all', [MAIN])).toBe(MAIN_LIST);
    expect(resolveScope('all', [MAIN, COMPRA])).toBe('all');
  });
});

describe('inScope', () => {
  it('sin listId es la principal', () => {
    expect(inScope(task(), MAIN_LIST)).toBe(true);
    expect(inScope(task(), 'c1')).toBe(false);
  });

  it('listId null es la principal', () => {
    expect(inScope(task({ listId: null }), MAIN_LIST)).toBe(true);
  });

  it('con listId concreto solo se ve en esa lista', () => {
    const t = task({ listId: 'c1' });
    expect(inScope(t, 'c1')).toBe(true);
    expect(inScope(t, MAIN_LIST)).toBe(false);
  });

  it('«Todas» ve todas las tareas', () => {
    expect(inScope(task({ listId: 'c1' }), 'all')).toBe(true);
    expect(inScope(task(), 'all')).toBe(true);
  });
});

describe('listName', () => {
  it('devuelve el nombre de la lista', () => {
    expect(listName([MAIN, COMPRA], 'c1')).toBe('Compra');
  });

  it('la principal sin registro se llama Personal', () => {
    expect(listName([], MAIN_LIST)).toBe('Personal');
  });

  it('una lista desconocida da cadena vacía', () => {
    expect(listName([MAIN], 'nope')).toBe('');
  });
});

describe('openByList', () => {
  it('cuenta pendientes vivas por lista', () => {
    const m = openByList([
      task({ listId: 'c1' }),
      task({ listId: 'c1' }),
      task({ listId: null }),
      task(),
    ]);
    expect(m.get('c1')).toBe(2);
    expect(m.get(MAIN_LIST)).toBe(2);
  });

  it('ignora las hechas y las borradas', () => {
    const m = openByList([
      task({ listId: 'c1', done: 1 }),
      task({ listId: 'c1', deleted: 1 }),
      task({ listId: 'c1' }),
    ]);
    expect(m.get('c1')).toBe(1);
  });

  it('una lista sin pendientes no aparece', () => {
    expect(openByList([task({ listId: 'c1', done: 1 })]).has('c1')).toBe(false);
    expect(openByList([]).size).toBe(0);
  });
});
