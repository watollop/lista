import type { ISODate, Period } from '../types';
import { addDays, fromISODate, toISODate, todayISO } from '../lib/date';
import { periodEnd } from '../lib/period';
import { lang } from '../i18n';

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
  period?: Period; // fecha "blanda": fin de esa semana/mes/trimestre/año
}

const DOW: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
};
const dow = (d: ISODate) => fromISODate(d).getDay();
const DOW_RE = Object.keys(DOW).join('|');

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

/** Meses en español (texto plegado). "may" no entra: es también una palabra inglesa. */
const MESES: Record<string, number> = {
  enero: 1, ene: 1, febrero: 2, feb: 2, marzo: 3, mar: 3, abril: 4, abr: 4, mayo: 5,
  junio: 6, jun: 6, julio: 7, jul: 7, agosto: 8, ago: 8, septiembre: 9, setiembre: 9, sept: 9, sep: 9,
  octubre: 10, oct: 10, noviembre: 11, nov: 11, diciembre: 12, dic: 12,
};
const MES_RE = Object.keys(MESES).sort((a, b) => b.length - a.length).join('|');

/** Fecha ISO de ese día si existe (rechaza 31/04, 29/02 de año no bisiesto…). */
function isoOrNull(y: number, m: number, d: number): ISODate | null {
  const x = new Date(y, m - 1, d);
  return x.getFullYear() === y && x.getMonth() === m - 1 && x.getDate() === d ? toISODate(x) : null;
}

/** Próxima ocurrencia de un día y mes sin año (hoy incluido); el 29/02 salta a los años bisiestos. */
function nextMonthDay(today: ISODate, m: number, d: number): ISODate | null {
  const y0 = +today.slice(0, 4);
  for (let k = 0; k < 9; k++) {
    const c = isoOrNull(y0 + k, m, d);
    if (c && c >= today) return c;
  }
  return null;
}

/** Día + mes (+ año opcional). Sin año: próxima ocurrencia, como "vence:DD/MM". */
function dayMonth(d: string, m: number, y: string | undefined, today: ISODate): ISODate | null {
  return y ? isoOrNull(+y, m, +d) : nextMonthDay(today, m, +d);
}

interface Rule {
  re: RegExp; // global, sobre texto plegado
  date: (m: RegExpMatchArray, today: ISODate) => ISODate | null;
  period?: Period;
}

/** Alias de trimestre aceptados al escribir: "trimestre" es la forma principal; "quarter" y "q" se siguen entendiendo. */
const Q = 'trimestre|quarter|q';
/** "este mes", "el mes que viene", "el próximo mes"… (texto plegado: año → ano). */
const periodRules = (p: Period, noun: string): Rule[] => [
  { re: word(`(?:este|esta) (?:${noun})`), date: (_, t) => periodEnd(p, t), period: p },
  {
    re: new RegExp(`(?<!${W})(?:(?:el|la) )?(?:(?:proximo|proxima) (?:${noun})|(?:${noun}) que viene)(?!${W})`.replace(/ /g, '\\s+'), 'gu'),
    date: (_, t) => periodEnd(p, t, 1),
    period: p,
  },
];

const RULES_ES: Rule[] = [
  {
    // "15 de marzo", "el 15 marzo", "15 mar 2027", "1 de enero de 2027", "lunes 2 de noviembre", "29 feb"
    re: new RegExp(`(?<!${W})(?:(?:${DOW_RE})\\s+)?(?<d>\\d{1,2})(?:\\s+de)?\\s+(?<m>${MES_RE})(?:\\s+(?:de\\s+)?(?<y>\\d{4}))?(?!${W})`, 'gu'),
    date: (m, t) => dayMonth(m.groups!.d, MESES[m.groups!.m], m.groups!.y, t),
  },
  {
    // 15/3, 15/03/2027, 15-03-2027, 2027-03-15 (sin año: próxima ocurrencia; "15-3" sin año no cuenta)
    re: new RegExp('(?<![\\p{N}/.:-])(?<d>\\d{1,2})\\/(?<m>\\d{1,2})(?:\\/(?<y>\\d{4}))?(?![\\p{N}/])', 'gu'),
    date: (m, t) => dayMonth(m.groups!.d, +m.groups!.m, m.groups!.y, t),
  },
  {
    re: new RegExp('(?<![\\p{N}/.:-])(?<d>\\d{1,2})-(?<m>\\d{1,2})-(?<y>\\d{4})(?![\\p{N}/])', 'gu'),
    date: (m, t) => dayMonth(m.groups!.d, +m.groups!.m, m.groups!.y, t),
  },
  {
    re: new RegExp('(?<![\\p{N}/.:-])(?<y>\\d{4})-(?<m>\\d{1,2})-(?<d>\\d{1,2})(?![\\p{N}/])', 'gu'),
    date: (m, t) => dayMonth(m.groups!.d, +m.groups!.m, m.groups!.y, t),
  },
  {
    // "en 3 días", "dentro de 2 semanas", "en una semana"
    re: new RegExp(`(?<!${W})(?:en|dentro\\s+de)\\s+(?<n>\\d{1,3}|una?)\\s+(?<u>dias?|semanas?)(?!${W})`, 'gu'),
    date: (m, t) => addDays(t, (m.groups!.n.startsWith('u') ? 1 : +m.groups!.n) * (m.groups!.u.startsWith('s') ? 7 : 1)),
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
  ...periodRules('week', 'semana'),
  ...periodRules('month', 'mes'),
  ...periodRules('quarter', Q),
  ...periodRules('year', 'ano'),
  {
    // T1…T4 (y Q1…Q4, alias): ese trimestre de este año, o del siguiente si ya ha pasado
    re: new RegExp(`(?<!${W})[tq](?<q>[1-4])(?!${W})`, 'gu'),
    date: (m, t) => {
      const y = fromISODate(t).getFullYear();
      const end = (yy: number) => toISODate(new Date(yy, Number(m.groups!.q) * 3, 0));
      return end(y) >= t ? end(y) : end(y + 1);
    },
    period: 'quarter',
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

/* ---------- inglés (solo con la app en inglés) ---------- */
const DOW_EN: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, // «sun» y «sat» no: son palabras corrientes
};
const DOW_EN_RE = Object.keys(DOW_EN).sort((a, b) => b.length - a.length).join('|');
const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6,
  july: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9, october: 10, oct: 10, november: 11, nov: 11,
  december: 12, dec: 12,
};
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
const ORD = '(?:st|nd|rd|th)?';
const periodRulesEn = (p: Period, noun: string): Rule[] => [
  { re: word(`this (?:${noun})`), date: (_, t) => periodEnd(p, t), period: p },
  { re: word(`next (?:${noun})`), date: (_, t) => periodEnd(p, t, 1), period: p },
];

const RULES_EN: Rule[] = [
  {
    // "15 march", "15th of March 2027", "mon 2 nov"
    re: new RegExp(`(?<!${W})(?:(?:${DOW_EN_RE}),?\\s+)?(?<d>\\d{1,2})${ORD}(?:\\s+of)?\\s+(?<m>${MONTH_RE})(?:,?\\s+(?<y>\\d{4}))?(?!${W})`, 'gu'),
    date: (m, t) => dayMonth(m.groups!.d, MONTHS[m.groups!.m], m.groups!.y, t),
  },
  {
    // "march 15", "Nov 2nd, 2027", "monday, november 2"
    re: new RegExp(`(?<!${W})(?:(?:${DOW_EN_RE}),?\\s+)?(?<m>${MONTH_RE})\\s+(?<d>\\d{1,2})${ORD}(?:,?\\s+(?<y>\\d{4}))?(?!${W})`, 'gu'),
    date: (m, t) => dayMonth(m.groups!.d, MONTHS[m.groups!.m], m.groups!.y, t),
  },
  RULES_ES[1], RULES_ES[2], RULES_ES[3], // 15/3, 15-03-2027, 2027-03-15
  {
    // "in 3 days", "in 2 weeks", "in a week"
    re: new RegExp(`(?<!${W})in\\s+(?<n>\\d{1,3}|an?|one)\\s+(?<u>days?|weeks?)(?!${W})`, 'gu'),
    date: (m, t) => addDays(t, (/^\d/.test(m.groups!.n) ? +m.groups!.n : 1) * (m.groups!.u.startsWith('w') ? 7 : 1)),
  },
  { re: word('today|tonight'), date: (_, t) => t },
  { re: word('the day after tomorrow|day after tomorrow'), date: (_, t) => addDays(t, 2) },
  { re: word('tomorrow|tmrw'), date: (_, t) => addDays(t, 1) },
  ...periodRulesEn('week', 'week'),
  ...periodRulesEn('month', 'month'),
  ...periodRulesEn('quarter', 'quarter'),
  ...periodRulesEn('year', 'year'),
  {
    re: new RegExp(`(?<!${W})q(?<q>[1-4])(?!${W})`, 'gu'),
    date: (m, t) => {
      const y = fromISODate(t).getFullYear();
      const end = (yy: number) => toISODate(new Date(yy, Number(m.groups!.q) * 3, 0));
      return end(y) >= t ? end(y) : end(y + 1);
    },
    period: 'quarter',
  },
  { re: word('end of the month|end of month'), date: (_, t) => toISODate(new Date(fromISODate(t).getFullYear(), fromISODate(t).getMonth() + 1, 0)) },
  { re: word('this weekend|the weekend|weekend'), date: (_, t) => addDays(t, (6 - dow(t) + 7) % 7) },
  {
    // "monday", "on monday", "next monday", "this friday": always strictly after today
    re: new RegExp(`(?<!${W})(?:(?:next|this)\\s+)?(?<wd>${DOW_EN_RE})(?!${W})`, 'gu'),
    date: (m, t) => nextAfter(t, DOW_EN[m.groups!.wd]),
  },
  {
    re: new RegExp(`(?<!${W})the\\s+(?<day>\\d{1,2})${ORD}(?![\\p{L}\\p{N}_])(?!\\s+(?:of\\s+)?\\p{L})`, 'gu'),
    date: (m, t) => nextDayOfMonth(t, Number(m.groups!.day)),
  },
];

/** "la mañana" / "esta mañana" significa por la mañana, no el día de mañana. */
const MORNING = new RegExp(`(?<!${W})(?:la|esta)\\s+manana(?!${W})`, 'gu');

const sortPrefixes = (l: string[]) => l.map(foldText).sort((a, b) => b.length - a.length);
const PREFIXES_ES = sortPrefixes(['antes del', 'antes de', 'para el', 'hasta el', 'el dia', 'para', 'hasta', 'el', 'del']);
const PREFIXES_EN = sortPrefixes(['by the', 'on the', 'due on', 'due by', 'by', 'on', 'due', 'until', 'before', 'for']);

/** Incluye en el token la preposición/artículo inmediatamente anterior ("para el viernes"). */
function extendStart(f: string, start: number): number {
  const before = f.slice(0, start);
  for (const p of lang() === 'en' ? PREFIXES_EN : PREFIXES_ES) {
    const m = new RegExp(`(?<!${W})${p.replace(/ /g, '\\s+')}\\s+$`, 'u').exec(before);
    if (m) return m.index;
  }
  return start;
}

/**
 * Primera fecha (solo día, sin hora) del texto, con reglas propias en español (o en inglés con la app en inglés). El texto puede
 * contener MASK en lugar de tokens ya consumidos.
 */
export function parseSpanishDate(text: string, now: Date = new Date()): DateSpan | null {
  const today = todayISO(now);
  const en = lang() === 'en';
  let t = text;
  for (const m of en ? [] : foldText(text).matchAll(MORNING)) {
    const at = m.index! + m[0].length - 6; // 'manana'
    t = t.slice(0, at) + MASK.repeat(6) + t.slice(at + 6);
  }
  const f = foldText(t);

  const cands: DateSpan[] = [];
  for (const r of en ? RULES_EN : RULES_ES) {
    for (const m of f.matchAll(r.re)) {
      const date = r.date(m, today);
      if (date) {
        cands.push({ start: m.index!, end: m.index! + m[0].length, date, ...(r.period ? { period: r.period } : {}) });
        break;
      }
    }
  }
  // Una fecha natural en el pasado ("ayer", "el lunes pasado") no es un vencimiento: se queda en el texto.
  // Empate de inicio: gana el token más largo ("lunes 2 de noviembre" frente a "lunes").
  const best = cands.filter((c) => c.date >= today).sort((a, b) => a.start - b.start || b.end - a.end)[0];
  return best ? { ...best, start: extendStart(f, best.start) } : null;
}
