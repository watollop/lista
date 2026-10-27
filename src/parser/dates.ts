import * as chronoEs from 'chrono-node/es';
import type { ISODate } from '../types';
import { addDays, fromISODate, toISODate, todayISO } from '../lib/date';

/** Carácter que sustituye a los tokens ya encontrados (misma longitud, nunca es espacio ni letra). */
export const MASK = '\u0001';
const W = '[\\p{L}\\p{N}_]';

/** Pliega mayúsculas y diacríticos carácter a carácter. Conserva la longitud: los índices siguen valiendo. */
export const foldText = (s: string) => s.replace(/[\s\S]/g, (c) => c.toLowerCase().normalize('NFD')[0] || c);

/** Regex global de una frase en español (sin acentos, espacios = cualquier blanco), con límites de palabra. */
export const word = (phrase: string) =>
  new RegExp(`(?<!${W})(?:${foldText(phrase).replace(/ /g, '\\s+')})(?!${W})`, 'gu');

export interface DateSpan {
  start: number;
  end: number; // exclusivo
  date: ISODate;
}

const DOW: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
};
const dow = (d: ISODate) => fromISODate(d).getDay();

/** Próximo día de la semana estrictamente posterior a hoy. */
const nextAfter = (today: ISODate, wd: number) => addDays(today, ((wd - dow(today) + 6) % 7) + 1);

/** Próximo día (hoy incluido) con ese número de día del mes; se salta los meses que no lo tienen. */
function nextDayOfMonth(today: ISODate, day: number): ISODate | null {
  if (day < 1 || day > 31) return null;
  const t = fromISODate(today);
  for (let k = 0; k < 13; k++) {
    const x = new Date(t.getFullYear(), t.getMonth() + k, day);
    if (x.getDate() === day && (k > 0 || day >= t.getDate())) return toISODate(x);
  }
  return null;
}

interface Rule {
  re: RegExp; // global, sobre texto plegado
  date: (m: RegExpMatchArray, today: ISODate) => ISODate | null;
}

const RULES: Rule[] = [
  {
    re: word('29 de febrero|29 de feb|29 febrero|29 feb'),
    date: (_, t) => {
      for (let y = +t.slice(0, 4); ; y++) {
        const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
        if (leap && `${y}-02-29` >= t) return `${y}-02-29`;
      }
    },
  },
  { re: word('hoy'), date: (_, t) => t },
  { re: word('pasado manana'), date: (_, t) => addDays(t, 2) },
  {
    // "pasado" solo = pasado mañana; no en "el lunes pasado", "el mes pasado", "hablar del pasado"…
    re: new RegExp(
      `(?<!(?:${W}|(?:domingo|lunes|martes|miercoles|jueves|viernes|sabado|dia|mes|ano|finde|el|lo|del|al|un)\\s+))pasado(?!${W})`,
      'gu',
    ),
    date: (_, t) => addDays(t, 2),
  },
  { re: word('manana'), date: (_, t) => addDays(t, 1) },
  {
    re: word('la proxima semana|la semana que viene|proxima semana'),
    date: (_, t) => nextAfter(t, 1),
  },
  { re: word('fin de mes|final de mes'), date: (_, t) => toISODate(new Date(fromISODate(t).getFullYear(), fromISODate(t).getMonth() + 1, 0)) },
  {
    re: word('este fin de semana|el finde|este finde'),
    date: (_, t) => addDays(t, (6 - dow(t) + 7) % 7),
  },
  {
    // "lunes", "el lunes", "el próximo lunes", "el lunes que viene": siempre estrictamente después de hoy
    re: new RegExp(
      `(?<!${W})(?:el\\s+)?(?:proximo\\s+)?(?<wd>domingo|lunes|martes|miercoles|jueves|viernes|sabado)(?:\\s+que\\s+viene)?(?!${W})`,
      'gu',
    ),
    date: (m, t) => nextAfter(t, DOW[m.groups!.wd]),
  },
  {
    re: new RegExp(`(?<!${W})el\\s+(?:dia\\s+)?(?<day>\\d{1,2})(?![\\p{L}\\p{N}_])(?!\\s*\\p{L})`, 'gu'),
    date: (m, t) => nextDayOfMonth(t, Number(m.groups!.day)),
  },
];

/** "la mañana" / "esta mañana" significa por la mañana, no el día de mañana. */
const MORNING = new RegExp(`(?<!${W})(?:la|esta)\\s+manana(?!${W})`, 'gu');

const PREFIXES = ['antes del', 'antes de', 'para el', 'hasta el', 'el dia', 'para', 'hasta', 'el', 'del']
  .map(foldText)
  .sort((a, b) => b.length - a.length);

/** Incluye en el token la preposición/artículo inmediatamente anterior ("para el viernes"). */
function extendStart(f: string, start: number): number {
  const before = f.slice(0, start);
  for (const p of PREFIXES) {
    const m = new RegExp(`(?<!${W})${p.replace(/ /g, '\\s+')}\\s+$`, 'u').exec(before);
    if (m) return m.index;
  }
  return start;
}

/**
 * Primera fecha (solo día, sin hora) del texto. Reglas propias en español primero; chrono-node/es
 * como respaldo. El texto puede contener MASK en lugar de tokens ya consumidos.
 */
export function parseSpanishDate(text: string, now: Date = new Date()): DateSpan | null {
  const today = todayISO(now);
  let t = text;
  for (const m of foldText(text).matchAll(MORNING)) {
    const at = m.index! + m[0].length - 6; // 'manana'
    t = t.slice(0, at) + MASK.repeat(6) + t.slice(at + 6);
  }
  const f = foldText(t);

  const cands: DateSpan[] = [];
  for (const r of RULES) {
    for (const m of f.matchAll(r.re)) {
      const date = r.date(m, today);
      if (date) {
        cands.push({ start: m.index!, end: m.index! + m[0].length, date });
        break;
      }
    }
  }
  // chrono: solo cuenta si fija el día (descarta "a las 10", "por la mañana" sin fecha)
  for (const r of chronoEs.parse(t, now, { forwardDate: true })) {
    if (!r.start.isCertain('day')) continue;
    cands.push({ start: r.index, end: r.index + r.text.length, date: toISODate(r.start.date()) });
    break;
  }

  const best = cands.sort((a, b) => a.start - b.start)[0];
  return best ? { ...best, start: extendStart(f, best.start) } : null;
}
