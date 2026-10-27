import type { ISODate, Recurrence } from '../types';
import { addDays, addMonths, fromISODate, toISODate } from './date';

function step(base: ISODate, rec: Recurrence, k: number): ISODate {
  switch (rec.unit) {
    case 'day': return addDays(base, rec.every * k);
    case 'week': return addDays(base, 7 * rec.every * k);
    case 'month': return anchor(addMonths(base, rec.every * k), rec.monthDay);
    case 'year': return anchor(addMonths(base, 12 * rec.every * k), rec.monthDay);
  }
}

/** Lleva la fecha al día ancla del mes, o al último día si el mes es más corto. */
function anchor(d: ISODate, day: number | undefined): ISODate {
  if (!day) return d;
  const x = fromISODate(d);
  const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
  x.setDate(Math.min(day, last));
  return toISODate(x);
}

/** Primera fecha de una recurrencia creada hoy (sin fecha explícita). */
export function firstOccurrence(rec: Recurrence, today: ISODate): ISODate {
  if (rec.unit === 'week' && rec.weekday !== undefined) {
    const wd = fromISODate(today).getDay();
    return addDays(today, (rec.weekday - wd + 7) % 7);
  }
  return today;
}

/** Siguiente ocurrencia tras completar: avanza al menos una vez desde due (o hoy) y hasta quedar > hoy.
 *  Calcula siempre desde la base original para que los meses no deriven (31 ene -> 28 feb -> 31 mar). */
export function nextOccurrence(rec: Recurrence, due: ISODate | null, today: ISODate): ISODate {
  let base = due ?? today;
  if (rec.unit === 'week' && rec.weekday !== undefined && fromISODate(base).getDay() !== rec.weekday) {
    base = firstOccurrence(rec, base);
    if (base > today) return base;
  }
  let k = 1;
  let next = step(base, rec, k);
  while (next <= today) next = step(base, rec, ++k);
  return next;
}
