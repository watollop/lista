import { describe, it, expect } from 'vitest';
import { externalCapture } from './capture';

describe('captura desde fuera', () => {
  it('?nueva= con la sintaxis de la app', () => {
    expect(externalCapture('?nueva=Llamar%20a%20%40ana%20ma%C3%B1ana%20!alta')).toBe('Llamar a @ana mañana !alta');
    expect(externalCapture('?nueva=+Comprar+pan+')).toBe('Comprar pan');
  });
  it('sin nada que apuntar => null', () => {
    expect(externalCapture('')).toBeNull();
    expect(externalCapture('?nueva=')).toBeNull();
    expect(externalCapture('?otra=1')).toBeNull();
  });
  it('compartir: junta título, texto y enlace sin repetir', () => {
    expect(externalCapture('?title=Receta&text=Mira+esto&url=https%3A%2F%2Fx.com%2Fr')).toBe('Receta Mira esto https://x.com/r');
    expect(externalCapture('?text=Mira+https%3A%2F%2Fx.com%2Fr&url=https%3A%2F%2Fx.com%2Fr')).toBe('Mira https://x.com/r');
  });
});
