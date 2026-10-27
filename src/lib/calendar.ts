import type { Recurrence, Task } from '../types';
import { addDays } from './date';

/**
 * Evento de calendario de día completo para una tarea con fecha (copia puntual: no se sincroniza).
 * Apple Calendario: archivo .ics. Google Calendar: enlace de plantilla con el evento rellenado.
 */

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const compact = (iso: string) => iso.replaceAll('-', '');

/** Regla de repetición iCalendar (RFC 5545) equivalente a la recurrencia de la tarea. */
export function rrule(rec: Recurrence, due: string): string {
  const interval = rec.every > 1 ? `;INTERVAL=${rec.every}` : '';
  if (rec.unit === 'day') return `FREQ=DAILY${interval}`;
  if (rec.unit === 'week') return `FREQ=WEEKLY${interval}${rec.weekday !== undefined ? `;BYDAY=${DAYS[rec.weekday]}` : ''}`;
  const day = rec.monthDay ?? +due.slice(8);
  if (rec.unit === 'month') return `FREQ=MONTHLY${interval};BYMONTHDAY=${day}`;
  return `FREQ=YEARLY${interval}`;
}

/** Texto del evento: el título tal cual (con sus #temas y @personas). */
const summary = (t: Pick<Task, 'title'>) => t.title.trim() || 'Tarea';

/** Escapa texto para iCalendar. */
const esc = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n');

export function icsFor(t: Pick<Task, 'id' | 'title' | 'due' | 'recurrence'>, now: Date = new Date()): string {
  if (!t.due) throw new Error('La tarea no tiene fecha');
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lista//ES',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${t.id}@lista`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compact(t.due)}`,
    `DTEND;VALUE=DATE:${compact(addDays(t.due, 1))}`,
    `SUMMARY:${esc(summary(t))}`,
    ...(t.recurrence ? [`RRULE:${rrule(t.recurrence, t.due)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

export function googleCalendarUrl(t: Pick<Task, 'title' | 'due' | 'recurrence'>): string {
  if (!t.due) throw new Error('La tarea no tiene fecha');
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: summary(t),
    dates: `${compact(t.due)}/${compact(addDays(t.due, 1))}`,
  });
  if (t.recurrence) q.set('recur', `RRULE:${rrule(t.recurrence, t.due)}`);
  return `https://calendar.google.com/calendar/render?${q}`;
}
