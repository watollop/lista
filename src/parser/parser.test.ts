import { describe, it, expect } from 'vitest';
import { parseLine, parseBlock, activeToken, formatLine, formatDue, formatRecurrence, normalizeKey } from './index';
import { parseSpanishDate } from './dates';

// Martes 27 oct 2026
const now = new Date(2026, 9, 27, 10, 0);

const due = (s: string) => parseLine(s, now).due;

describe('parseLine: ejemplo completo', () => {
  const l = parseLine('Revisar informe @ana #aura mañana !1 cada lunes', now);
  it('título, personas, temas, prioridad y recurrencia', () => {
    expect(l.title).toBe('Revisar informe @ana #aura'); // #tema y @persona se quedan en el texto
    expect(l.people).toEqual(['ana']);
    expect(l.topics).toEqual(['aura']);
    expect(l.priority).toBe(1);
    expect(l.recurrence).toEqual({ unit: 'week', every: 1, weekday: 1 });
    expect(l.due).toBe('2026-10-28'); // la fecha explícita gana a firstOccurrence
    expect(l.isSubtask).toBe(false);
  });
  it('tokens ordenados con texto original', () => {
    expect(l.tokens.map((t) => [t.type, t.text])).toEqual([
      ['person', '@ana'],
      ['topic', '#aura'],
      ['date', 'mañana'],
      ['priority', '!1'],
      ['recurrence', 'cada lunes'],
    ]);
    for (let i = 1; i < l.tokens.length; i++) expect(l.tokens[i].start).toBeGreaterThan(l.tokens[i - 1].start);
  });
});

describe('recurrencias y fechas por defecto', () => {
  it('cada lunes sin fecha usa la primera ocurrencia', () => {
    const l = parseLine('Comprar pan cada lunes', now);
    expect(l.title).toBe('Comprar pan');
    expect(l.due).toBe('2026-11-02');
    expect(l.recurrence).toEqual({ unit: 'week', every: 1, weekday: 1 });
  });
  it('cada día', () => {
    const l = parseLine('Agua cada día', now);
    expect(l.recurrence).toEqual({ unit: 'day', every: 1 });
    expect(l.due).toBe('2026-10-27');
  });
  it('cada 2 semanas', () => {
    expect(parseLine('Regar cada 2 semanas', now).recurrence).toEqual({ unit: 'week', every: 2 });
  });
  it('todos los meses', () => {
    expect(parseLine('Facturas todos los meses', now).recurrence).toEqual({ unit: 'month', every: 1 });
  });
  it('cada sábado', () => {
    const l = parseLine('Limpiar cada sábado', now);
    expect(l.recurrence).toEqual({ unit: 'week', every: 1, weekday: 6 });
    expect(l.due).toBe('2026-10-31');
  });
  it('cada 3 días, cada año, a diario, miercoles con y sin acento', () => {
    expect(parseLine('x cada 3 días', now).recurrence).toEqual({ unit: 'day', every: 3 });
    expect(parseLine('x cada año', now).recurrence).toEqual({ unit: 'year', every: 1 });
    expect(parseLine('x a diario', now).recurrence).toEqual({ unit: 'day', every: 1 });
    expect(parseLine('x todos los miercoles', now).recurrence).toEqual({ unit: 'week', every: 1, weekday: 3 });
    expect(parseLine('x todos los miércoles', now).recurrence).toEqual({ unit: 'week', every: 1, weekday: 3 });
  });
});

describe('fechas naturales', () => {
  const cases: [string, string | null, string | null][] = [
    ['mañana', '', '2026-10-28'],
    ['pasado mañana', '', '2026-10-29'],
    ['Llamar a Ana pasado', 'Llamar a Ana', '2026-10-29'],
    ['Repasar el mes pasado', 'Repasar el mes pasado', null],
    ['Hablar del pasado', 'Hablar del pasado', null],
    ['Repasado', 'Repasado', null],
    ['Llamar el viernes', 'Llamar', '2026-10-30'],
    ['el martes', '', '2026-11-03'],
    ['15 nov', '', '2026-11-15'],
    ['15 oct', '', '2027-10-15'],
    ['en 3 días', '', '2026-10-30'],
    ['dentro de 2 semanas', '', '2026-11-10'],
    ['hoy', '', '2026-10-27'],
    ['la próxima semana', '', '2026-11-06'],
    ['la semana que viene', '', '2026-11-06'],
    ['fin de mes', '', '2026-10-31'],
    ['el 3', '', '2026-11-03'],
    ['el 30', '', '2026-10-30'],
    ['miercoles', '', '2026-10-28'],
    ['el próximo lunes', '', '2026-11-02'],
    ['este fin de semana', '', '2026-10-31'],
    ['para el viernes', '', '2026-10-30'],
    ['el 15 de noviembre', '', '2026-11-15'],
  ];
  for (const [input, title, date] of cases) {
    it(`"${input}" => ${date}`, () => {
      const l = parseLine(input, now);
      expect(l.due).toBe(date);
      expect(l.title).toBe(title ?? '');
    });
  }
  it('"Llamar por la mañana" no es una fecha', () => {
    const l = parseLine('Llamar por la mañana', now);
    expect(l.due).toBeNull();
    expect(l.title).toBe('Llamar por la mañana');
    expect(l.tokens).toEqual([]);
  });
  it('"esta mañana" no es una fecha', () => {
    expect(due('Reunión esta mañana')).toBeNull();
  });
  it('fecha natural dentro de otra palabra no cuenta', () => {
    expect(due('hoyo en el suelo')).toBeNull();
    expect(due('Mañanero')).toBeNull();
  });
  it('sin fecha', () => {
    expect(due('Comprar leche')).toBeNull();
  });
});

describe('vence: explícito', () => {
  it('YYYY-MM-DD', () => expect(due('Pagar vence:2026-11-15')).toBe('2026-11-15'));
  it('DD/MM futuro', () => expect(due('vence:01/12')).toBe('2026-12-01'));
  it('DD/MM ya pasado => año siguiente', () => expect(due('vence:01/02')).toBe('2027-02-01'));
  it('DD/MM de hoy incluido', () => expect(due('vence:27/10')).toBe('2026-10-27'));
  it('DD/MM/YYYY', () => expect(due('vence:05/03/2027')).toBe('2027-03-05'));
  it('explícito gana a natural', () => expect(due('Algo mañana vence:2026-11-15')).toBe('2026-11-15'));
  it('fecha inválida no es token', () => {
    const l = parseLine('x vence:2026-02-30', now);
    expect(l.due).toBeNull();
    expect(l.tokens.some((t) => t.text.startsWith('vence'))).toBe(false);
  });
});

describe('temas y personas', () => {
  it('se quedan en el título donde se escribieron; fecha y prioridad no', () => {
    const l = parseLine('@elena hablar sobre #sto mañana !alta', now);
    expect(l).toMatchObject({ title: '@elena hablar sobre #sto', topics: ['sto'], people: ['elena'], priority: 1 });
  });
  it('formatLine no repite etiquetas que ya están en el título', () => {
    expect(formatLine({ title: 'hablar con @Elena', topicNames: ['sto'], peopleNames: ['elena'], due: null, priority: null, recurrence: null }))
      .toBe('hablar con @Elena #sto');
  });
  it('deduplica por clave, conserva la primera escritura', () => {
    const l = parseLine('#Aura #aura #Áura', now);
    expect(l.topics).toEqual(['Aura']);
    expect(l.title).toBe('#Aura #aura #Áura');
  });
  it('email no produce persona', () => {
    const l = parseLine('Escribir a ana@x.com', now);
    expect(l.people).toEqual([]);
    expect(l.title).toBe('Escribir a ana@x.com');
  });
  it('persona y tema con guiones y números', () => {
    const l = parseLine('@juan-carlos #proyecto_2 tarea', now);
    expect(l.people).toEqual(['juan-carlos']);
    expect(l.topics).toEqual(['proyecto_2']);
    expect(l.title).toBe('@juan-carlos #proyecto_2 tarea');
  });
  it('# dentro de palabra no cuenta', () => {
    const l = parseLine('casa(#aura)', now);
    expect(l.topics).toEqual([]);
  });
});

describe('fechas pasadas', () => {
  it('"ayer" no es un vencimiento y se queda en el texto', () => {
    expect(parseLine('Hablar de lo de ayer', now)).toMatchObject({ title: 'Hablar de lo de ayer', due: null });
    expect(parseLine('Revisar lo de ayer mañana', now)).toMatchObject({ title: 'Revisar lo de ayer', due: '2026-10-28' });
  });
  it('vence: explícito en el pasado sí se respeta', () => {
    expect(parseLine('x vence:2026-10-20', now).due).toBe('2026-10-20');
  });
});

describe('periodos', () => {
  // now = martes 27-oct-2026
  const per = (t: string) => { const l = parseLine(t, now); return [l.title, l.due, l.period]; };
  it('esta semana (viernes), este mes, este Q, este año', () => {
    expect(per('Informe esta semana')).toEqual(['Informe', '2026-10-30', 'week']);
    expect(per('Informe este mes')).toEqual(['Informe', '2026-10-31', 'month']);
    expect(per('Informe este Q')).toEqual(['Informe', '2026-12-31', 'quarter']);
    expect(per('Informe este trimestre')).toEqual(['Informe', '2026-12-31', 'quarter']);
    expect(per('Informe este año')).toEqual(['Informe', '2026-12-31', 'year']);
  });
  it('el siguiente periodo', () => {
    expect(per('x la semana que viene')).toEqual(['x', '2026-11-06', 'week']);
    expect(per('x el mes que viene')).toEqual(['x', '2026-11-30', 'month']);
    expect(per('x el próximo trimestre')).toEqual(['x', '2027-03-31', 'quarter']);
    expect(per('x el año que viene')).toEqual(['x', '2027-12-31', 'year']);
  });
  it('Q1…Q4 (alias): este año o el siguiente si ya pasó', () => {
    expect(per('plan Q4')).toEqual(['plan', '2026-12-31', 'quarter']);
    expect(per('plan Q1')).toEqual(['plan', '2027-03-31', 'quarter']);
  });
  it('T1…T4: este año o el siguiente si ya pasó, en mayúscula o minúscula', () => {
    expect(per('plan T4')).toEqual(['plan', '2026-12-31', 'quarter']);
    expect(per('plan T1')).toEqual(['plan', '2027-03-31', 'quarter']);
    expect(per('plan t1')).toEqual(['plan', '2027-03-31', 'quarter']);
    expect(per('plan t4')).toEqual(['plan', '2026-12-31', 'quarter']);
  });
  it('alias "este quarter" y "el trimestre que viene"', () => {
    expect(per('x este quarter')).toEqual(['x', '2026-12-31', 'quarter']);
    expect(per('x el trimestre que viene')).toEqual(['x', '2027-03-31', 'quarter']);
  });
  it('T dentro de una palabra o de un número no es trimestre', () => {
    for (const t of ['x AT4', 'x T45', 'x 2T4', 'x T5', 'x T0']) {
      const l = parseLine(t, now);
      expect([t, l.due, l.period]).toEqual([t, null, null]);
    }
  });
  it('un día concreto no tiene periodo; "cada año" sigue siendo recurrencia', () => {
    expect(parseLine('x mañana', now).period).toBeNull();
    expect(parseLine('x cada año', now)).toMatchObject({ period: null, recurrence: { unit: 'year' } });
  });
  it('vence:2026-T4 (y el antiguo -Q4) al editar una tarea de trimestre', () => {
    expect(per('x vence:2026-T4')).toEqual(['x', '2026-12-31', 'quarter']);
    expect(per('x vence:2026-Q4')).toEqual(['x', '2026-12-31', 'quarter']);
    const l = parseLine('Plan este trimestre', now);
    expect(formatLine({ ...l, topicNames: [], peopleNames: [] })).toBe('Plan vence:2026-T4');
  });
  it('vence: con periodo y formatLine ida y vuelta', () => {
    expect(per('x vence:2026-Q4')).toEqual(['x', '2026-12-31', 'quarter']);
    expect(per('x vence:2026-W45')).toEqual(['x', '2026-11-06', 'week']);
    for (const t of ['x esta semana', 'x este mes', 'x este Q', 'x el año que viene']) {
      const l = parseLine(t, now);
      const again = parseLine(formatLine({ ...l, topicNames: [], peopleNames: [] }), now);
      expect([again.due, again.period]).toEqual([l.due, l.period]);
    }
  });
});

describe('prioridad', () => {
  it('la última gana', () => {
    expect(parseLine('x !1 !3', now).priority).toBe(3);
  });
  it('!alta !media !baja equivalen a !1 !2 !3', () => {
    expect(parseLine('x !alta', now).priority).toBe(1);
    expect(parseLine('x !Media', now).priority).toBe(2);
    expect(parseLine('x !baja', now)).toMatchObject({ priority: 3, title: 'x' });
    expect(parseLine('x !bajada', now).priority).toBeNull();
  });
  it('!4 no es prioridad', () => {
    const l = parseLine('x !4', now);
    expect(l.priority).toBeNull();
    expect(l.title).toBe('x !4');
  });
});

describe('subtareas', () => {
  it('> al inicio', () => {
    const l = parseLine('> comprar leche', now);
    expect(l.isSubtask).toBe(true);
    expect(l.title).toBe('comprar leche');
  });
  it('índices de tokens respecto a la línea original', () => {
    const line = '>  #aura mañana';
    const l = parseLine(line, now);
    expect(l.title).toBe('#aura');
    for (const t of l.tokens) expect(line.slice(t.start, t.end)).toBe(t.text);
  });
  it('parseBlock marca indentadas', () => {
    const r = parseBlock('Viaje\n  billetes\n  hotel\nOtra', now);
    expect(r).toHaveLength(4);
    expect(r.map((l) => l.isSubtask)).toEqual([false, true, true, false]);
  });
  it('parseBlock: primera línea indentada no es subtarea; omite vacías', () => {
    const r = parseBlock('  primera\n\n  segunda\n\n', now);
    expect(r.map((l) => [l.title, l.isSubtask])).toEqual([
      ['primera', false],
      ['segunda', true],
    ]);
  });
});

describe('título', () => {
  it('colapsa espacios', () => {
    expect(parseLine('  a   #x   b  ', now).title).toBe('a #x b');
  });
  it('solo tokens => título vacío', () => {
    expect(parseLine('!2 mañana', now).title).toBe('');
  });
});

describe('parseSpanishDate', () => {
  it('devuelve el span con el artículo incluido', () => {
    const r = parseSpanishDate('Llamar el viernes', now);
    expect(r).toEqual({ start: 7, end: 17, date: '2026-10-30' });
  });
  it('solo fecha, nada de hora', () => {
    expect(parseSpanishDate('a las 10', now)).toBeNull();
  });
});

describe('activeToken', () => {
  it('prefijo de tema', () => {
    expect(activeToken('hola #au', 8)).toEqual({ type: 'topic', prefix: 'au', start: 5, end: 8 });
  });
  it('# recién escrito', () => {
    expect(activeToken('hola #', 6)).toEqual({ type: 'topic', prefix: '', start: 5, end: 6 });
  });
  it('@ al inicio', () => {
    expect(activeToken('@an', 3)).toEqual({ type: 'person', prefix: 'an', start: 0, end: 3 });
  });
  it('email no es token', () => {
    expect(activeToken('ana@x', 5)).toBeNull();
  });
  it('sin símbolo', () => {
    expect(activeToken('hola mundo', 4)).toBeNull();
  });
  it('cursor en medio de la palabra usa solo lo previo', () => {
    expect(activeToken('#aura', 3)).toEqual({ type: 'topic', prefix: 'au', start: 0, end: 3 });
  });
});

describe('formatLine', () => {
  const cases = [
    'Revisar informe @ana #aura mañana !1 cada lunes',
    'Comprar pan cada lunes',
    'Pagar vence:2026-11-15 !2',
    'Regar cada 2 semanas',
    'Agua cada día',
    'Algo #a #b @c',
  ];
  for (const input of cases) {
    it(`round trip: ${input}`, () => {
      const p = parseLine(input, now);
      const out = formatLine({
        title: p.title,
        topicNames: p.topics,
        peopleNames: p.people,
        due: p.due,
        priority: p.priority,
        recurrence: p.recurrence,
      });
      const q = parseLine(out, now);
      expect(q.title).toBe(p.title);
      expect(q.topics).toEqual(p.topics);
      expect(q.people).toEqual(p.people);
      expect(q.due).toBe(p.due);
      expect(q.priority).toBe(p.priority);
      expect(q.recurrence).toEqual(p.recurrence);
    });
  }
  it('formato canónico', () => {
    expect(formatLine({
      title: 'Revisar informe', topicNames: ['aura'], peopleNames: ['ana'],
      due: '2026-11-02', priority: 1, recurrence: { unit: 'week', every: 1, weekday: 1 },
    })).toBe('Revisar informe #aura @ana !alta cada lunes vence:2026-11-02');
  });
  it('sin partes opcionales', () => {
    expect(formatLine({ title: 'Solo', topicNames: [], peopleNames: [], due: null, priority: null, recurrence: null }))
      .toBe('Solo');
  });
});

describe('formatDue', () => {
  const today = '2026-10-27';
  it('relativos', () => {
    expect(formatDue('2026-10-27', today)).toBe('hoy');
    expect(formatDue('2026-10-28', today)).toBe('mañana');
    expect(formatDue('2026-10-26', today)).toBe('ayer');
  });
  it('día de la semana para 2..6 días', () => {
    expect(formatDue('2026-10-29', today)).toBe('jue');
    expect(formatDue('2026-10-31', today)).toBe('sáb');
    expect(formatDue('2026-11-01', today)).toBe('dom');
    expect(formatDue('2026-11-02', today)).toBe('lun');
    expect(formatDue('2026-11-03', today)).toBe('3 nov');
    expect(formatDue('2026-11-04', today)).toBe('4 nov');
  });
  it('D mmm y año si cambia', () => {
    expect(formatDue('2026-11-15', today)).toBe('15 nov');
    expect(formatDue('2027-01-02', today)).toBe('2 ene 2027');
    expect(formatDue('2026-10-20', today)).toBe('20 oct');
  });
});

describe('formatRecurrence', () => {
  it('casos', () => {
    expect(formatRecurrence({ unit: 'day', every: 1 })).toBe('cada día');
    expect(formatRecurrence({ unit: 'day', every: 3 })).toBe('cada 3 días');
    expect(formatRecurrence({ unit: 'week', every: 1 })).toBe('cada semana');
    expect(formatRecurrence({ unit: 'week', every: 2 })).toBe('cada 2 semanas');
    expect(formatRecurrence({ unit: 'week', every: 1, weekday: 1 })).toBe('cada lunes');
    expect(formatRecurrence({ unit: 'week', every: 1, weekday: 6 })).toBe('cada sábado');
    expect(formatRecurrence({ unit: 'month', every: 1 })).toBe('cada mes');
    expect(formatRecurrence({ unit: 'month', every: 2 })).toBe('cada 2 meses');
    expect(formatRecurrence({ unit: 'year', every: 1 })).toBe('cada año');
  });
});

describe('normalizeKey re-exportado', () => {
  it('es la misma función de lib/text', () => {
    expect(normalizeKey(' Áurea ')).toBe('aurea');
  });
});
