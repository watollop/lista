import { describe, it, expect } from 'vitest';
import { retagTitle } from './retag';

describe('retagTitle', () => {
  it('renombra la etiqueta conservando el resto del texto', () => {
    expect(retagTitle('Llamar a @Elan y @ana', '@', 'elan', 'elena')).toBe('Llamar a @elena y @ana');
  });

  it('con to null quita el símbolo y deja la palabra (todas las apariciones)', () => {
    expect(retagTitle('x #Casa #casa', '#', 'casa', null)).toBe('x Casa casa');
  });

  it('no toca etiquetas de otro símbolo', () => {
    expect(retagTitle('#casa @casa', '@', 'casa', 'hogar')).toBe('#casa @hogar');
  });

  it('no toca direcciones de correo', () => {
    expect(retagTitle('escribe a ana@x.com y @ana', '@', 'ana', 'ana2')).toBe('escribe a ana@x.com y @ana2');
  });

  it('compara sin mayúsculas ni tildes', () => {
    expect(retagTitle('Hablar con @José', '@', 'jose', 'Pepe')).toBe('Hablar con @Pepe');
    expect(retagTitle('Hablar con @José', '@', 'jose', null)).toBe('Hablar con José');
  });

  it('sin coincidencias devuelve el título igual', () => {
    expect(retagTitle('Nada que ver #aura', '#', 'otra', 'x')).toBe('Nada que ver #aura');
  });
});
