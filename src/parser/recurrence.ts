import type { Recurrence } from '../types';
import { word } from './dates';

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

const RULES: Rule[] = [
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

export interface RecurrenceSpan {
  start: number;
  end: number;
  rec: Recurrence;
}

/** Primera recurrencia del texto plegado (ver foldText). */
export function matchRecurrence(f: string): RecurrenceSpan | null {
  const cands: RecurrenceSpan[] = [];
  for (const r of RULES) {
    for (const m of f.matchAll(r.re)) {
      const rec = r.rec(m);
      if (rec) {
        cands.push({ start: m.index!, end: m.index! + m[0].length, rec });
        break;
      }
    }
  }
  return cands.sort((a, b) => a.start - b.start)[0] ?? null;
}

const UNIT_NAMES = {
  day: ['día', 'días'],
  week: ['semana', 'semanas'],
  month: ['mes', 'meses'],
  year: ['año', 'años'],
} as const;

export function formatRecurrence(r: Recurrence): string {
  if (r.unit === 'week' && r.weekday !== undefined) {
    if (r.every === 1) return `cada ${DAYS[r.weekday]}`;
    return `cada ${r.every} ${r.weekday % 6 === 0 ? `${DAYS[r.weekday]}s` : DAYS[r.weekday]}`;
  }
  const [one, many] = UNIT_NAMES[r.unit];
  return r.every === 1 ? `cada ${one}` : `cada ${r.every} ${many}`;
}
