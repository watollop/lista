import { describe, it, expect } from 'vitest';
import { splitLinks, type Segment } from './links';

const links = (text: string) => splitLinks(text).filter((s) => s.type === 'link');
const join = (segs: Segment[]) => segs.map((s) => s.raw).join('');

describe('splitLinks', () => {
  it('URL al principio, en medio y al final', () => {
    expect(splitLinks('https://github.com/a/b')).toEqual([
      { type: 'link', raw: 'https://github.com/a/b', href: 'https://github.com/a/b', host: 'github.com' },
    ]);
    expect(splitLinks('Lee https://x.es/p ya')).toEqual([
      { type: 'text', raw: 'Lee ' },
      { type: 'link', raw: 'https://x.es/p', href: 'https://x.es/p', host: 'x.es' },
      { type: 'text', raw: ' ya' },
    ]);
    expect(splitLinks('Mira http://a.org')).toEqual([
      { type: 'text', raw: 'Mira ' },
      { type: 'link', raw: 'http://a.org', href: 'http://a.org', host: 'a.org' },
    ]);
  });

  it('varias URLs en el mismo título', () => {
    const text = 'A https://a.com y https://b.com/x #tema';
    expect(links(text).map((s) => (s.type === 'link' ? s.host : ''))).toEqual(['a.com', 'b.com']);
    expect(join(splitLinks(text))).toBe(text);
  });

  it('la puntuación final no forma parte de la URL', () => {
    const cases: Array<[string, string]> = [
      ['Ver https://a.com/x.', 'https://a.com/x'],
      ['https://a.com, luego', 'https://a.com'],
      ['¿Y https://a.com/x?', 'https://a.com/x'],
      ['(ver https://a.com/x)', 'https://a.com/x'],
      ['«https://a.com/x».', 'https://a.com/x'],
      ['https://a.com/x!!', 'https://a.com/x'],
    ];
    for (const [text, url] of cases) {
      const [l] = links(text);
      expect(l?.type === 'link' ? l.raw : null, text).toBe(url);
      expect(join(splitLinks(text)), text).toBe(text);
    }
  });

  it('conserva los paréntesis que cierran una URL', () => {
    const [l] = links('https://es.wikipedia.org/wiki/Foo_(bar)');
    expect(l.type === 'link' && l.raw).toBe('https://es.wikipedia.org/wiki/Foo_(bar)');
    const [m] = links('(https://es.wikipedia.org/wiki/Foo_(bar))');
    expect(m.type === 'link' && m.raw).toBe('https://es.wikipedia.org/wiki/Foo_(bar)');
  });

  it('muestra el dominio sin www. y conserva la URL completa', () => {
    const [l] = links('https://www.github.com/x');
    expect(l.type === 'link' && l.host).toBe('github.com');
    expect(l.type === 'link' && l.href).toBe('https://www.github.com/x');
  });

  it('www. sin esquema no es un enlace', () => {
    expect(links('mira www.example.com')).toEqual([]);
  });

  it('URLs inválidas se quedan como texto', () => {
    expect(links('https://')).toEqual([]);
    expect(links('http:// vacío')).toEqual([]);
    expect(splitLinks('xhttps://a.com')).toEqual([{ type: 'text', raw: 'xhttps://a.com' }]);
  });

  it('javascript: y otros esquemas nunca se convierten', () => {
    expect(links('javascript:alert(1)')).toEqual([]);
    expect(links('JavaScript:alert(document.cookie)')).toEqual([]);
    expect(links('data:text/html,hola')).toEqual([]);
    expect(links('mailto:a@b.com')).toEqual([]);
    expect(links('ftp://a.com/x')).toEqual([]);
  });

  it('sin URLs devuelve el texto tal cual', () => {
    expect(splitLinks('Comprar pan #casa @ana')).toEqual([{ type: 'text', raw: 'Comprar pan #casa @ana' }]);
    expect(splitLinks('')).toEqual([]);
  });

  it('los segmentos reconstruyen siempre el texto original', () => {
    for (const t of ['https://a.com.', 'x https://a.com/#/b?c=1&d=2 y', 'https://a.com/@ana #tema', 'https://']) {
      expect(join(splitLinks(t))).toBe(t);
    }
  });
});
