import { describe, it, expect } from 'vitest';
import { splitDictation, spokenToSyntax } from './speech';
import { parseLine } from '../parser';

const now = new Date(2026, 9, 27, 10); // martes 27-oct-2026

describe('dictado', () => {
  it('palabras habladas -> sintaxis', () => {
    expect(spokenToSyntax('revisar ventas prioridad alta tema trabajo')).toBe('revisar ventas !alta #trabajo');
    expect(spokenToSyntax('llamar a persona Ana es urgente')).toBe('llamar a @ana !alta');
    expect(spokenToSyntax('comprar pan con prioridad baja')).toBe('comprar pan !baja');
    expect(spokenToSyntax('arroba Marta almohadilla casa')).toBe('@marta #casa');
  });
  it('separa tareas por pausas con punto o por "siguiente"', () => {
    expect(splitDictation('llamar a Ana mañana. comprar pan el viernes.')).toEqual(['Llamar a Ana mañana', 'Comprar pan el viernes']);
    expect(splitDictation('llamar a Ana mañana siguiente comprar pan nueva tarea pagar luz')).toEqual(['Llamar a Ana mañana', 'Comprar pan', 'Pagar luz']);
    expect(splitDictation('   ')).toEqual([]);
  });
  it('el resultado lo entiende el parser de siempre', () => {
    const [t] = splitDictation('revisar ventas cada lunes prioridad alta tema trabajo');
    expect(parseLine(t, now)).toMatchObject({
      title: 'Revisar ventas #trabajo', priority: 1, topics: ['trabajo'], recurrence: { unit: 'week', weekday: 1 },
    });
  });
});
