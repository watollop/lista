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
