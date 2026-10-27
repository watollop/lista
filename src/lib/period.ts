import type { ISODate, Period } from '../types';
import { addDays, fromISODate, toISODate } from './date';

/**
 * Fechas "de periodo": vencen el último día del periodo (la semana es laboral: acaba el viernes;
 * trimestres naturales). El vencimiento se guarda como fecha normal y `period` solo indica cómo
 * mostrarla y agruparla.
 */

const dow = (d: ISODate) => fromISODate(d).getDay();

/** Viernes de la semana de `d`. En sábado o domingo, el de la semana siguiente. */
export function weekEnd(d: ISODate): ISODate {
  return addDays(d, (5 - dow(d) + 7) % 7);
}

export function monthEnd(d: ISODate, add = 0): ISODate {
  const x = fromISODate(d);
  return toISODate(new Date(x.getFullYear(), x.getMonth() + add + 1, 0));
}

export const quarterOf = (d: ISODate) => Math.floor(fromISODate(d).getMonth() / 3) + 1;

export function quarterEnd(d: ISODate, add = 0): ISODate {
  const x = fromISODate(d);
  const q = Math.floor(x.getMonth() / 3) + add; // índice de trimestre desde enero de ese año
  return toISODate(new Date(x.getFullYear(), q * 3 + 3, 0));
}

export function yearEnd(d: ISODate, add = 0): ISODate {
  return `${fromISODate(d).getFullYear() + add}-12-31`;
}

/** Fin del periodo en curso para `today` (`add` periodos más adelante). */
export function periodEnd(p: Period, today: ISODate, add = 0): ISODate {
  if (p === 'week') return addDays(weekEnd(today), 7 * add);
  if (p === 'month') return monthEnd(today, add);
  if (p === 'quarter') return quarterEnd(today, add);
  return yearEnd(today, add);
}

/** ¿Es `due` el vencimiento del periodo en curso? */
export const isCurrentPeriod = (p: Period, due: ISODate, today: ISODate) => due === periodEnd(p, today);

/** Semana ISO (año y número) de una fecha; la de su jueves. */
export function isoWeek(d: ISODate): { year: number; week: number } {
  const thu = fromISODate(addDays(d, 3 - ((dow(d) + 6) % 7)));
  const jan1 = new Date(thu.getFullYear(), 0, 1);
  return { year: thu.getFullYear(), week: Math.floor((thu.getTime() - jan1.getTime()) / 864e5 / 7) + 1 };
}

/** Viernes de la semana ISO `week` de `year`. */
export function isoWeekFriday(year: number, week: number): ISODate | null {
  if (week < 1 || week > 53) return null;
  const jan4 = toISODate(new Date(year, 0, 4));
  const monday = addDays(jan4, -((dow(jan4) + 6) % 7) + 7 * (week - 1));
  const fri = addDays(monday, 4);
  return isoWeek(fri).year === year ? fri : null;
}

/** Forma canónica para `vence:` (vuelve a parsearse igual): 2026-W44, 2026-10, 2026-Q4, 2026. */
export function periodToken(p: Period, due: ISODate): string {
  const y = due.slice(0, 4);
  if (p === 'week') {
    const w = isoWeek(due);
    return `${w.year}-W${String(w.week).padStart(2, '0')}`;
  }
  if (p === 'month') return due.slice(0, 7);
  if (p === 'quarter') return `${y}-Q${quarterOf(due)}`;
  return y;
}

/** `vence:2026-W44` / `2026-10` / `2026-Q4` / `2026` → fin de periodo. null si no es un periodo. */
export function parsePeriodToken(s: string): { date: ISODate; period: Period } | null {
  let m = /^(\d{4})-W(\d{2})$/i.exec(s);
  if (m) {
    const date = isoWeekFriday(+m[1], +m[2]);
    return date ? { date, period: 'week' } : null;
  }
  m = /^(\d{4})-Q([1-4])$/i.exec(s);
  if (m) return { date: toISODate(new Date(+m[1], +m[2] * 3, 0)), period: 'quarter' };
  m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m && +m[2] >= 1 && +m[2] <= 12) return { date: toISODate(new Date(+m[1], +m[2], 0)), period: 'month' };
  m = /^(\d{4})$/.exec(s);
  if (m) return { date: `${m[1]}-12-31`, period: 'year' };
  return null;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Texto del chip: "esta semana", "semana que viene", "sem. 13 nov", "octubre", "Q4", "2026". */
export function formatPeriod(p: Period, due: ISODate, today: ISODate): string {
  const d = fromISODate(due);
  const otherYear = d.getFullYear() !== fromISODate(today).getFullYear();
  if (p === 'week') {
    if (due === periodEnd('week', today)) return 'esta semana';
    if (due === periodEnd('week', today, 1)) return 'semana que viene';
    return `sem. ${d.getDate()} ${MES_CORTO[d.getMonth()]}`;
  }
  if (p === 'month') return MESES[d.getMonth()] + (otherYear ? ` ${d.getFullYear()}` : '');
  if (p === 'quarter') return `Q${quarterOf(due)}` + (otherYear ? ` ${d.getFullYear()}` : '');
  return String(d.getFullYear());
}
