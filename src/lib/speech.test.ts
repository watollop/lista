import { describe, it, expect } from 'vitest';
import { collapseResults, dictationItems, splitDictation, spokenToSyntax } from './speech';
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

describe('resultados del reconocedor', () => {
  it('iOS: resultados acumulados no se duplican (el caso real)', () => {
    const ios = ['Llamar', 'Llamar a', 'Llamar a la', 'Llamar a la peluquería', 'Llamar a la peluquería mañana'];
    expect(collapseResults(ios)).toEqual(['Llamar a la peluquería mañana']);
    expect(dictationItems(collapseResults(ios), [])).toEqual(['Llamar a la peluquería mañana']);
  });
  it('iOS: una pausa larga corta en dos tareas aunque el texto siga acumulado', () => {
    const ios = ['Llamar a la peluquería mañana', 'Llamar a la peluquería mañana comprar pan'];
    // la pausa se detectó cuando había 5 palabras
    expect(dictationItems(collapseResults(ios), [5])).toEqual(['Llamar a la peluquería mañana', 'Comprar pan']);
  });
  it('Chrome: un resultado por frase', () => {
    const chrome = ['llamar a Ana mañana', 'comprar pan el viernes'];
    expect(collapseResults(chrome)).toEqual(chrome);
    expect(dictationItems(chrome, [4])).toEqual(['Llamar a Ana mañana', 'Comprar pan el viernes']);
  });
  it('mayúsculas y puntuación de iOS no rompen el acumulado', () => {
    expect(collapseResults(['comprar pan', 'Comprar pan.'])).toEqual(['Comprar pan.']);
  });
});
