import { describe, it, expect } from 'vitest';
import { googleCalendarUrl, icsFor, rrule } from './calendar';

const task = { id: 'abc', title: 'Llamar a @ana; revisar, cerrar', due: '2026-10-30', recurrence: null };

describe('calendario', () => {
  it('ics de día completo con el título escapado', () => {
    const ics = icsFor(task, new Date('2026-10-27T10:00:00Z'));
    expect(ics).toContain('DTSTART;VALUE=DATE:20261030');
    expect(ics).toContain('DTEND;VALUE=DATE:20261031');
    expect(ics).toContain('SUMMARY:Llamar a @ana\\; revisar\\, cerrar');
    expect(ics).toContain('UID:abc@lista');
    expect(ics).toContain('DTSTAMP:20261027T100000Z');
    expect(ics).not.toContain('RRULE');
    expect(ics.split('\r\n')[0]).toBe('BEGIN:VCALENDAR');
  });
  it('fin de mes: el día siguiente cambia de mes y de año', () => {
    expect(icsFor({ ...task, due: '2026-12-31' })).toContain('DTEND;VALUE=DATE:20270101');
  });
  it('repeticiones en RRULE', () => {
    expect(rrule({ unit: 'week', every: 1, weekday: 1 }, '2026-11-02')).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(rrule({ unit: 'week', every: 2 }, '2026-11-02')).toBe('FREQ=WEEKLY;INTERVAL=2');
    expect(rrule({ unit: 'day', every: 1 }, '2026-11-02')).toBe('FREQ=DAILY');
    expect(rrule({ unit: 'month', every: 1, monthDay: 31 }, '2026-11-30')).toBe('FREQ=MONTHLY;BYMONTHDAY=31');
    expect(rrule({ unit: 'year', every: 1 }, '2026-11-02')).toBe('FREQ=YEARLY');
    expect(icsFor({ ...task, recurrence: { unit: 'week', every: 1, weekday: 1 } })).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO');
  });
  it('enlace de Google Calendar con el evento rellenado', () => {
    const url = new URL(googleCalendarUrl({ ...task, recurrence: { unit: 'day', every: 1 } }));
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe('Llamar a @ana; revisar, cerrar');
    expect(url.searchParams.get('dates')).toBe('20261030/20261031');
    expect(url.searchParams.get('recur')).toBe('RRULE:FREQ=DAILY');
  });
  it('sin fecha no hay evento', () => {
    expect(() => icsFor({ ...task, due: null })).toThrow();
  });
});
