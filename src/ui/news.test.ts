// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NEWS, NEWS_KEY, markAllNewsSeen, markNewsSeen, unseenNews } from './news';

const ID = NEWS[0].id;

describe('Novedades: qué se ha visto', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('sin nada visto, todas las novedades están sin ver', () => {
    expect(unseenNews()).toEqual(NEWS);
  });

  it('markNewsSeen marca solo los ids indicados y se guarda como array JSON', () => {
    markNewsSeen([ID]);
    expect(unseenNews()).toEqual(NEWS.filter((n) => n.id !== ID));
    expect(JSON.parse(localStorage.getItem(NEWS_KEY)!)).toEqual([ID]);
    // Repetir no duplica ids.
    markNewsSeen([ID]);
    expect(JSON.parse(localStorage.getItem(NEWS_KEY)!)).toEqual([ID]);
  });

  it('markAllNewsSeen deja todas como vistas', () => {
    markAllNewsSeen();
    expect(unseenNews()).toEqual([]);
  });

  it('si localStorage lanza al leer, unseenNews devuelve [] sin romper', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(unseenNews()).toEqual([]);
  });

  it('si localStorage lanza al escribir, markNewsSeen no rompe', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => markNewsSeen([ID])).not.toThrow();
    expect(() => markAllNewsSeen()).not.toThrow();
  });

  it('JSON corrupto no rompe: unseenNews devuelve [] y markNewsSeen lo reemplaza', () => {
    localStorage.setItem(NEWS_KEY, '{no es json');
    expect(unseenNews()).toEqual([]);
    expect(() => markNewsSeen([ID])).not.toThrow();
    expect(unseenNews()).toEqual(NEWS.filter((n) => n.id !== ID));
  });

  it('un valor JSON que no es array tampoco rompe', () => {
    localStorage.setItem(NEWS_KEY, '{"a":1}');
    expect(unseenNews()).toEqual([]);
  });
});
