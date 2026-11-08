import { describe, expect, it } from 'vitest';
import type { TodoList } from '../types';
import { MAX_SUGGESTIONS, listInsertText, listSuggestions } from './suggest';

const list = (id: string, name: string, order = 0): TodoList => ({
  id, name, order, updatedAt: 0, deleted: 0, dirty: 0,
} as TodoList);

const lists = [
  list('main', 'Principal'),
  list('compra', 'La compra', 1),
  list('camping', 'Cámping', 2),
  list('trabajo', 'Trabajo', 3),
  list('viajes', 'Viajes', 4),
  list('casa', 'Casa', 5),
  list('deporte', 'Deporte', 6),
  list('libros', 'Libros', 7),
];

const ids = (xs: TodoList[]) => xs.map((l) => l.id);

describe('listSuggestions', () => {
  it('prefijo vacío sugiere todas, como máximo 6', () => {
    const out = listSuggestions(lists, '');
    expect(out).toHaveLength(MAX_SUGGESTIONS);
    expect(MAX_SUGGESTIONS).toBe(6);
    expect(ids(out)).toEqual(['main', 'compra', 'camping', 'trabajo', 'viajes', 'casa']);
  });

  it('con una sola lista no sugiere nada', () => {
    expect(listSuggestions([list('main', 'Personal')], '')).toEqual([]);
  });

  it('ignora tildes, mayúsculas y espacios', () => {
    expect(ids(listSuggestions(lists, 'la c'))).toEqual(['compra']);
    expect(ids(listSuggestions(lists, 'LA C'))).toEqual(['compra']);
    expect(ids(listSuggestions(lists, 'lac'))).toEqual(['compra']);
    expect(ids(listSuggestions(lists, 'camp'))).toEqual(['camping']);
    expect(ids(listSuggestions(lists, 'CÁMP'))).toEqual(['camping']);
  });

  it('no sugiere la lista si el prefijo ya es exactamente su clave', () => {
    expect(ids(listSuggestions(lists, 'Trabajo'))).toEqual([]);
    expect(ids(listSuggestions(lists, 'la compra'))).toEqual([]);
    expect(ids(listSuggestions(lists, 'trabajo'))).toEqual([]);
  });

  it('sin coincidencias devuelve vacío', () => {
    expect(listSuggestions(lists, 'zzz')).toEqual([]);
  });

  it('respeta el máximo indicado', () => {
    expect(listSuggestions(lists, '', 2)).toHaveLength(2);
  });
});

describe('listInsertText', () => {
  it('cambia los espacios por guiones y antepone la barra', () => {
    expect(listInsertText('La compra')).toBe('/La-compra');
    expect(listInsertText('Lista  de   reyes')).toBe('/Lista-de-reyes');
    expect(listInsertText('Trabajo')).toBe('/Trabajo');
  });
});
