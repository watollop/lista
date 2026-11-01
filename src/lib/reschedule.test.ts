import { describe, it, expect } from 'vitest';
import { scheduleFor } from './reschedule';

const T = '2026-10-27'; // martes

describe('arrastrar a otro bloque', () => {
  it('cada bloque da su fecha', () => {
    expect(scheduleFor('today', T)).toEqual({ due: '2026-10-27', period: null });
    expect(scheduleFor('tomorrow', T)).toEqual({ due: '2026-10-28', period: null });
    expect(scheduleFor('week', T)).toEqual({ due: '2026-10-30', period: 'week' }); // viernes
    expect(scheduleFor('next', T)).toEqual({ due: '2026-11-06', period: 'week' }); // viernes siguiente
    expect(scheduleFor('nodate', T)).toEqual({ due: null, period: null });
  });
});

describe('para mañana', () => {
  it('es el día siguiente, sin periodo', () => {
    expect(scheduleFor('tomorrow', '2026-10-27')).toEqual({ due: '2026-10-28', period: null });
  });

  it('cambia de mes y de año', () => {
    expect(scheduleFor('tomorrow', '2026-01-31').due).toBe('2026-02-01');
    expect(scheduleFor('tomorrow', '2026-02-28').due).toBe('2026-03-01');
    expect(scheduleFor('tomorrow', '2026-04-30').due).toBe('2026-05-01');
    expect(scheduleFor('tomorrow', '2026-12-31').due).toBe('2027-01-01');
  });

  it('bisiestos: 28 feb 2028 -> 29 feb; 28 feb 2027 -> 1 mar', () => {
    expect(scheduleFor('tomorrow', '2028-02-28').due).toBe('2028-02-29');
    expect(scheduleFor('tomorrow', '2028-02-29').due).toBe('2028-03-01');
    expect(scheduleFor('tomorrow', '2027-02-28').due).toBe('2027-03-01');
  });

  it('cruza el cambio de hora (29 mar y 25 oct de 2026, España) sin saltar ni repetir día', () => {
    expect(scheduleFor('tomorrow', '2026-03-28').due).toBe('2026-03-29');
    expect(scheduleFor('tomorrow', '2026-03-29').due).toBe('2026-03-30');
    expect(scheduleFor('tomorrow', '2026-10-24').due).toBe('2026-10-25');
    expect(scheduleFor('tomorrow', '2026-10-25').due).toBe('2026-10-26');
  });
});
