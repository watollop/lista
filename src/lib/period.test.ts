import { describe, it, expect } from 'vitest';
import { formatPeriod, isoWeek, isoWeekFriday, parsePeriodToken, periodEnd, periodToken } from './period';

// martes 27-oct-2026
const T = '2026-10-27';

describe('periodos', () => {
  it('fin de periodo: la semana acaba el viernes; trimestres naturales', () => {
    expect(periodEnd('week', T)).toBe('2026-10-30');
    expect(periodEnd('week', '2026-10-30')).toBe('2026-10-30'); // el propio viernes
    expect(periodEnd('week', '2026-10-31')).toBe('2026-11-06'); // sábado: la siguiente
    expect(periodEnd('week', T, 1)).toBe('2026-11-06');
    expect(periodEnd('month', T)).toBe('2026-10-31');
    expect(periodEnd('month', '2026-12-15', 1)).toBe('2027-01-31');
    expect(periodEnd('quarter', T)).toBe('2026-12-31');
    expect(periodEnd('quarter', '2026-02-10')).toBe('2026-03-31');
    expect(periodEnd('quarter', T, 1)).toBe('2027-03-31');
    expect(periodEnd('year', T)).toBe('2026-12-31');
    expect(periodEnd('year', T, 1)).toBe('2027-12-31');
  });

  it('semana ISO y su viernes', () => {
    expect(isoWeek('2026-10-30')).toEqual({ year: 2026, week: 44 });
    expect(isoWeekFriday(2026, 44)).toBe('2026-10-30');
    expect(isoWeek('2027-01-01')).toEqual({ year: 2026, week: 53 });
    expect(isoWeekFriday(2026, 53)).toBe('2027-01-01');
    expect(isoWeekFriday(2025, 53)).toBeNull();
  });

  it('token canónico ida y vuelta', () => {
    for (const p of ['week', 'month', 'quarter', 'year'] as const) {
      const due = periodEnd(p, T);
      expect(parsePeriodToken(periodToken(p, due))).toEqual({ date: due, period: p });
    }
    expect(periodToken('quarter', '2026-12-31')).toBe('2026-Q4');
    expect(parsePeriodToken('2026-13')).toBeNull();
    expect(parsePeriodToken('2026-10-30')).toBeNull();
  });

  it('texto del chip', () => {
    expect(formatPeriod('week', '2026-10-30', T)).toBe('esta semana');
    expect(formatPeriod('week', '2026-11-06', T)).toBe('semana que viene');
    expect(formatPeriod('week', '2026-11-13', T)).toBe('sem. 13 nov');
    expect(formatPeriod('month', '2026-10-31', T)).toBe('octubre');
    expect(formatPeriod('month', '2027-01-31', T)).toBe('enero 2027');
    expect(formatPeriod('quarter', '2026-12-31', T)).toBe('Q4');
    expect(formatPeriod('year', '2027-12-31', T)).toBe('2027');
  });
});
