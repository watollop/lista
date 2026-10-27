import type { ISODate } from '../types';

const pad = (n: number) => String(n).padStart(2, '0');

/** Fecha local -> 'YYYY-MM-DD'. */
export function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 'YYYY-MM-DD' -> Date a medianoche local. */
export function fromISODate(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s: ISODate, n: number): ISODate {
  const d = fromISODate(s);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** Suma meses fijando el día al último del mes si no existe (31 ene + 1 mes = 28/29 feb). */
export function addMonths(s: ISODate, n: number): ISODate {
  const d = fromISODate(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toISODate(d);
}

/** Diferencia en días naturales b - a. */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((fromISODate(b).getTime() - fromISODate(a).getTime()) / 86400000);
}

export function todayISO(now: Date = new Date()): ISODate {
  return toISODate(now);
}
