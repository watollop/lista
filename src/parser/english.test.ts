import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setLangForTests } from '../i18n';
import { formatDue, formatLine, formatRecurrence, parseLine, setKnownLists } from './index';
import { formatPeriod } from '../lib/period';

// Lunes 2 de noviembre de 2026.
const now = new Date(2026, 10, 2, 10, 0);
const p = (s: string) => parseLine(s, now);

describe('intérprete en inglés', () => {
  beforeAll(() => setLangForTests('en'));
  afterAll(() => setLangForTests('es'));

  it('fechas', () => {
    expect(p('Call Ana today').due).toBe('2026-11-02');
    expect(p('Call Ana tomorrow').due).toBe('2026-11-03');
    expect(p('x day after tomorrow').due).toBe('2026-11-04');
    expect(p('x on friday').due).toBe('2026-11-06');
    expect(p('x next monday').due).toBe('2026-11-09');
    expect(p('x in 3 days').due).toBe('2026-11-05');
    expect(p('x in a week').due).toBe('2026-11-09');
    expect(p('x March 15').due).toBe('2027-03-15');
    expect(p('x 15th of March 2027').due).toBe('2027-03-15');
    expect(p('x Nov 20').due).toBe('2026-11-20');
    expect(p('x by the 20th').due).toBe('2026-11-20');
    expect(p('x due:2026-12-01').due).toBe('2026-12-01');
    expect(p('Pay rent tomorrow').title).toBe('Pay rent');
    expect(p('Finish report by friday').title).toBe('Finish report');
  });

  it('periodos', () => {
    const w = p('x this week');
    expect(w.period).toBe('week');
    expect(w.due).toBe('2026-11-06');
    expect(p('x next month').period).toBe('month');
    expect(p('x q1').due).toBe('2027-03-31');
  });

  it('palabras corrientes no son fechas', () => {
    expect(p('Buy sun cream').due).toBeNull();
    expect(p('Sat down with Ana').due).toBeNull();
    expect(p('May the force').due).toBeNull();
  });

  it('prioridad y repetición', () => {
    expect(p('x !high').priority).toBe(1);
    expect(p('x !medium').priority).toBe(2);
    expect(p('x !low').priority).toBe(3);
    expect(p('x !alta').priority).toBeNull(); // en inglés no se mezclan
    expect(p('Standup daily').recurrence).toEqual({ unit: 'day', every: 1 });
    expect(p('x every monday').recurrence).toEqual({ unit: 'week', every: 1, weekday: 1 });
    const r = p('Meeting every 2 tuesdays');
    expect(r.recurrence).toEqual({ unit: 'week', every: 2, weekday: 2 });
    expect(r.due).toBe('2026-11-03');
    expect(r.title).toBe('Meeting');
    expect(p('x every other week').recurrence).toEqual({ unit: 'week', every: 2 });
    expect(p('x every three months').recurrence).toEqual({ unit: 'month', every: 3 });
    expect(p('x biweekly').recurrence).toEqual({ unit: 'week', every: 2 });
    const w = p('Weekly review every friday #work');
    expect(w.recurrence).toEqual({ unit: 'week', every: 1, weekday: 5 });
    expect(w.title).toBe('Weekly review #work');
  });

  it('formatos', () => {
    expect(formatDue('2026-11-02', '2026-11-02')).toBe('today');
    expect(formatDue('2026-11-03', '2026-11-02')).toBe('tomorrow');
    expect(formatDue('2026-11-05', '2026-11-02')).toBe('Thu');
    expect(formatDue('2026-11-20', '2026-11-02')).toBe('Nov 20');
    expect(formatRecurrence({ unit: 'week', every: 2, weekday: 2 })).toBe('every 2 Tuesdays');
    expect(formatPeriod('week', '2026-11-06', '2026-11-02')).toBe('this week');
    expect(formatPeriod('month', '2026-12-31', '2026-11-02')).toBe('December');
    const line = formatLine({ title: 'Review', topicNames: ['work'], peopleNames: [], due: '2026-11-03', priority: 1, recurrence: { unit: 'week', every: 1, weekday: 2 } });
    expect(line).toBe('Review #work !high every Tuesday due:2026-11-03');
    const back = p(line);
    expect([back.title, back.due, back.priority]).toEqual(['Review #work', '2026-11-03', 1]);
    expect(back.recurrence).toEqual({ unit: 'week', every: 1, weekday: 2 });
  });

  it('en español no entiende inglés', () => {
    setLangForTests('es');
    expect(p('Preparar la daily').recurrence).toBeNull();
    expect(p('x tomorrow').due).toBeNull();
    setLangForTests('en');
  });
});

describe('listas en inglés', () => {
  beforeAll(() => setLangForTests('en'));
  afterAll(() => setLangForTests('es'));
  afterEach(() => setKnownLists([]));

  it('/lista funciona igual, y una lista llamada como un día no es fecha', () => {
    setKnownLists(['work', 'friday']);
    expect(p('Call Ana /work')).toMatchObject({ title: 'Call Ana', list: 'work', due: null });
    expect(p('Call Ana /friday')).toMatchObject({ title: 'Call Ana', list: 'friday', due: null });
    expect(p('Call Ana on friday').due).toBe('2026-11-06');
  });
});
