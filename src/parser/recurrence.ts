import type { Recurrence } from '../types';
import { word } from './dates';
import { lang } from '../i18n';

/** Nombres de día, índice = Recurrence.weekday (0=domingo). */
const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const FIXED: [string, Recurrence][] = [
  ['cada día', { unit: 'day', every: 1 }],
  ['todos los días', { unit: 'day', every: 1 }],
  ['a diario', { unit: 'day', every: 1 }],
  ['diariamente', { unit: 'day', every: 1 }],
  ['cada semana', { unit: 'week', every: 1 }],
  ['quincenal', { unit: 'week', every: 2 }],
  ['quincenalmente', { unit: 'week', every: 2 }],
  ['cada quincena', { unit: 'week', every: 2 }],
  ['semanalmente', { unit: 'week', every: 1 }],
  ['cada mes', { unit: 'month', every: 1 }],
  ['mensualmente', { unit: 'month', every: 1 }],
  ['todos los meses', { unit: 'month', every: 1 }],
  ['cada año', { unit: 'year', every: 1 }],
  ['anualmente', { unit: 'year', every: 1 }],
  ['todos los años', { unit: 'year', every: 1 }],
  ...DAYS.flatMap((name, weekday): [string, Recurrence][] => [
    [`cada ${name}`, { unit: 'week', every: 1, weekday }],
    [`todos los ${name}`, { unit: 'week', every: 1, weekday }],
  ]),
];

const UNITS: Record<string, Recurrence['unit']> = { dias: 'day', semanas: 'week', meses: 'month', anos: 'year' };
/** Números escritos con letra (texto plegado, sin tildes). */
const NUMS: Record<string, number> = {
  dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, quince: 15,
};
const N = `(\\d+|${Object.keys(NUMS).join('|')})`;
const num = (x: string) => NUMS[x] ?? Number(x);
/** Día de la semana plegado → índice (acepta plural: «cada 2 sábados»). */
const WEEKDAYS: Record<string, number> = {
  domingo: 0, domingos: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, sabados: 6,
};

interface Rule {
  re: RegExp; // global, sobre texto plegado
  rec: (m: RegExpMatchArray) => Recurrence | null;
}

const RULES_ES: Rule[] = [
  ...FIXED.map(([phrase, rec]) => ({ re: word(phrase), rec: () => rec })),
  {
    re: new RegExp(`(?<![\\p{L}\\p{N}_])(?:cada|todos\\s+los)\\s+${N}\\s+(dias|semanas|meses|anos)(?![\\p{L}\\p{N}_])`, 'gu'),
    rec: (m) => (num(m[1]) >= 1 ? { unit: UNITS[m[2]], every: num(m[1]) } : null),
  },
  {
    // «cada 2 martes»: cada dos semanas, en martes.
    re: new RegExp(`(?<![\\p{L}\\p{N}_])cada\\s+${N}\\s+(${Object.keys(WEEKDAYS).join('|')})(?![\\p{L}\\p{N}_])`, 'gu'),
    rec: (m) => (num(m[1]) >= 1 ? { unit: 'week', every: num(m[1]), weekday: WEEKDAYS[m[2]] } : null),
  },
];

/* ---------- inglés ---------- */
const DAYS_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FIXED_EN: [string, Recurrence][] = [
  ['every day', { unit: 'day', every: 1 }], ['each day', { unit: 'day', every: 1 }], ['daily', { unit: 'day', every: 1 }],
  ['every week', { unit: 'week', every: 1 }], ['each week', { unit: 'week', every: 1 }], ['weekly', { unit: 'week', every: 1 }],
  ['every other week', { unit: 'week', every: 2 }], ['every fortnight', { unit: 'week', every: 2 }],
  ['biweekly', { unit: 'week', every: 2 }], ['fortnightly', { unit: 'week', every: 2 }],
  ['every month', { unit: 'month', every: 1 }], ['each month', { unit: 'month', every: 1 }], ['monthly', { unit: 'month', every: 1 }],
  ['every year', { unit: 'year', every: 1 }], ['each year', { unit: 'year', every: 1 }], ['yearly', { unit: 'year', every: 1 }],
  ['annually', { unit: 'year', every: 1 }],
  ...DAYS_EN.flatMap((name, weekday): [string, Recurrence][] => [
    [`every ${name}`, { unit: 'week', every: 1, weekday }],
    [`every other ${name}`, { unit: 'week', every: 2, weekday }],
    [`${name}s`, { unit: 'week', every: 1, weekday }], // «mondays»
  ]),
];
const UNITS_EN: Record<string, Recurrence['unit']> = { day: 'day', days: 'day', week: 'week', weeks: 'week', month: 'month', months: 'month', year: 'year', years: 'year' };
const NUMS_EN: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15,
};
const N_EN = `(\\d+|${Object.keys(NUMS_EN).join('|')})`;
const numEn = (x: string) => NUMS_EN[x] ?? Number(x);
const B = '(?<![\\p{L}\\p{N}_])', E = '(?![\\p{L}\\p{N}_])';
const RULES_EN: Rule[] = [
  ...FIXED_EN.map(([phrase, rec]) => ({ re: word(phrase), rec: () => rec })),
  {
    re: new RegExp(`${B}every\\s+${N_EN}\\s+(days|weeks|months|years)${E}`, 'gu'),
    rec: (m) => (numEn(m[1]) >= 1 ? { unit: UNITS_EN[m[2]], every: numEn(m[1]) } : null),
  },
  {
    // «every 2 tuesdays»: every two weeks, on Tuesday.
    re: new RegExp(`${B}every\\s+${N_EN}\\s+(${DAYS_EN.join('|')})s?${E}`, 'gu'),
    rec: (m) => (numEn(m[1]) >= 1 ? { unit: 'week', every: numEn(m[1]), weekday: DAYS_EN.indexOf(m[2]) } : null),
  },
];

export interface RecurrenceSpan {
  start: number;
  end: number;
  rec: Recurrence;
}

/** Primera recurrencia del texto plegado (ver foldText). */
export function matchRecurrence(f: string): RecurrenceSpan | null {
  const cands: RecurrenceSpan[] = [];
  for (const r of lang() === 'en' ? RULES_EN : RULES_ES) {
    for (const m of f.matchAll(r.re)) {
      const rec = r.rec(m);
      if (rec) {
        cands.push({ start: m.index!, end: m.index! + m[0].length, rec });
        break;
      }
    }
  }
  // «every friday» / «cada viernes» gana a un adverbio suelto («Weekly review every friday»: weekly es parte del título).
  const bare = (c: RecurrenceSpan) => (/^(?:every|each|cada|todos)\b/.test(f.slice(c.start, c.end)) ? 0 : 1);
  return cands.sort((a, b) => bare(a) - bare(b) || a.start - b.start)[0] ?? null;
}

const UNIT_NAMES = {
  day: ['día', 'días'],
  week: ['semana', 'semanas'],
  month: ['mes', 'meses'],
  year: ['año', 'años'],
} as const;

const UNIT_NAMES_EN = { day: ['day', 'days'], week: ['week', 'weeks'], month: ['month', 'months'], year: ['year', 'years'] } as const;

export function formatRecurrence(r: Recurrence): string {
  if (lang() === 'en') {
    if (r.unit === 'week' && r.weekday !== undefined) return r.every === 1 ? `every ${DAY_EN[r.weekday]}` : `every ${r.every} ${DAY_EN[r.weekday]}s`;
    const [one, many] = UNIT_NAMES_EN[r.unit];
    return r.every === 1 ? `every ${one}` : `every ${r.every} ${many}`;
  }
  if (r.unit === 'week' && r.weekday !== undefined) {
    if (r.every === 1) return `cada ${DAYS[r.weekday]}`;
    return `cada ${r.every} ${r.weekday % 6 === 0 ? `${DAYS[r.weekday]}s` : DAYS[r.weekday]}`;
  }
  const [one, many] = UNIT_NAMES[r.unit];
  return r.every === 1 ? `cada ${one}` : `cada ${r.every} ${many}`;
}
