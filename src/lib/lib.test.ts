import { describe, it, expect } from 'vitest';
import { normalizeKey, fold } from './text';
import { nextOccurrence, firstOccurrence } from './recurrence';
import { addMonths, diffDays } from './date';

describe('lib', () => {
  it('normalizeKey', () => {
    expect(normalizeKey(' Áurea ')).toBe('aurea');
    expect(normalizeKey('Año')).toBe('año');
    expect(fold('Año Ávila')).toBe('ano avila');
  });
  it('fechas', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(diffDays('2026-10-27', '2026-11-02')).toBe(6);
  });
  it('recurrencias', () => {
    const t = '2026-10-27'; // martes
    expect(firstOccurrence({ unit: 'week', every: 1, weekday: 1 }, t)).toBe('2026-11-02');
    expect(firstOccurrence({ unit: 'week', every: 1, weekday: 2 }, t)).toBe('2026-10-27');
    expect(nextOccurrence({ unit: 'day', every: 1 }, '2026-10-20', t)).toBe('2026-10-28');
    expect(nextOccurrence({ unit: 'week', every: 1, weekday: 1 }, '2026-10-26', t)).toBe('2026-11-02');
    expect(nextOccurrence({ unit: 'week', every: 2 }, t, t)).toBe('2026-11-10');
    expect(nextOccurrence({ unit: 'month', every: 1 }, '2026-01-31', '2026-01-31')).toBe('2026-02-28');
    expect(nextOccurrence({ unit: 'month', every: 1 }, '2026-01-31', '2026-03-01')).toBe('2026-03-31');
    expect(nextOccurrence({ unit: 'day', every: 1 }, null, t)).toBe('2026-10-28');
  });
});
