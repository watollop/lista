import { describe, it, expect } from 'vitest';
import { MAX_TITLE, externalCapture, validateCapture } from './capture';
import { parseBlock } from '../parser';

describe('validación compartida de captura', () => {
  it('conserva familias y normaliza la primera línea como tarea principal', () => {
    const lines = validateCapture(parseBlock('> Viaje <Billetes\nCompra <Pan'));
    expect(lines.map((line) => line.isSubtask)).toEqual([false, true, false, true]);
  });

  it.each(['', '<Paso', 'Proyecto <', 'Proyecto <<Paso', 'Proyecto <!alta'])('rechaza títulos vacíos: %s', (text) => {
    expect(() => validateCapture(parseBlock(text))).toThrow('título');
  });

  it('acepta un título de MAX_TITLE caracteres y rechaza uno más largo, en tarea o subtarea', () => {
    expect(() => validateCapture(parseBlock('a'.repeat(MAX_TITLE)))).not.toThrow();
    expect(() => validateCapture(parseBlock('a'.repeat(MAX_TITLE + 1)))).toThrow('Una tarea admite hasta 1000 caracteres.');
    expect(() => validateCapture(parseBlock(`Proyecto\n${'a'.repeat(MAX_TITLE + 1)}`))).toThrow('1000 caracteres');
  });
});

describe('captura desde fuera', () => {
  it('?nueva= ya no crea captura', () => {
    expect(externalCapture('?nueva=Llamar%20a%20%40ana%20ma%C3%B1ana%20!alta')).toBeNull();
    expect(externalCapture('?nueva=+Comprar+pan+')).toBeNull();
  });
  it('sin nada que apuntar => null', () => {
    expect(externalCapture('')).toBeNull();
    expect(externalCapture('?title=+&text=')).toBeNull();
    expect(externalCapture('?otra=1')).toBeNull();
  });
  it('compartir: junta título, texto y enlace sin repetir', () => {
    expect(externalCapture('?title=Receta&text=Mira+esto&url=https%3A%2F%2Fx.com%2Fr')).toBe('Receta Mira esto https://x.com/r');
    expect(externalCapture('?text=Mira+https%3A%2F%2Fx.com%2Fr&url=https%3A%2F%2Fx.com%2Fr')).toBe('Mira https://x.com/r');
  });
  it('compartir texto enorme: se recorta a MAX_TITLE en el último espacio y con «…»', () => {
    const text = 'palabra '.repeat(300).trim();
    const out = externalCapture(`?text=${encodeURIComponent(text)}`)!;
    expect([...out].length).toBeLessThanOrEqual(MAX_TITLE);
    expect(out.endsWith('palabra…')).toBe(true);
    expect(out.startsWith('palabra palabra')).toBe(true);
  });
  it('sin espacios corta a MAX_TITLE exacto (el «…» cuenta)', () => {
    expect(externalCapture(`?text=${'a'.repeat(1500)}`)).toBe('a'.repeat(MAX_TITLE - 1) + '…');
  });
});
