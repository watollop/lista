import type {
  ActiveToken, ISODate, ParsedLine, ParsedToken, Priority, Recurrence, TokenType,
} from '../types';
import { diffDays, fromISODate, toISODate, todayISO } from '../lib/date';
import { normalizeKey } from '../lib/text';
import { firstOccurrence } from '../lib/recurrence';
import { MASK, foldText, parseSpanishDate } from './dates';
import { formatRecurrence, matchRecurrence } from './recurrence';

export { normalizeKey, formatRecurrence };

const isWordChar = (c: string) => /[\p{L}\p{N}_-]/u.test(c);
const isValid = (y: number, m: number, d: number) => {
  const x = new Date(y, m - 1, d);
  return x.getFullYear() === y && x.getMonth() === m - 1 && x.getDate() === d;
};
const isoOf = (y: number, m: number, d: number) => toISODate(new Date(y, m - 1, d));

/** vence:YYYY-MM-DD | vence:DD/MM | vence:DD/MM/YYYY (sin año: próxima ocurrencia, hoy incluido). */
function explicitDue(v: string, today: ISODate): ISODate | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (iso) return isValid(+iso[1], +iso[2], +iso[3]) ? v : null;
  const [, d, mo, y] = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(v)!;
  const day = +d, month = +mo;
  if (y) return isValid(+y, month, day) ? isoOf(+y, month, day) : null;
  const year = +today.slice(0, 4);
  for (let k = 0; k < 9; k++) { // 29/02 puede necesitar varios años
    if (!isValid(year + k, month, day)) continue;
    const cand = isoOf(year + k, month, day);
    if (cand >= today) return cand;
  }
  return null;
}

const unique = (names: string[]) => {
  const byKey = new Map<string, string>();
  for (const n of names) if (!byKey.has(normalizeKey(n))) byKey.set(normalizeKey(n), n);
  return [...byKey.values()];
};

/**
 * Parsea una línea. Los tokens encontrados se sustituyen por MASK en un texto de trabajo de la misma
 * longitud, así los índices siguen refiriéndose a la línea original.
 */
export function parseLine(line: string, now: Date = new Date()): ParsedLine {
  const today = todayISO(now);
  const isSubtask = /^\s*>/.test(line);
  let w = line;
  const tokens: ParsedToken[] = [];
  const take = (type: TokenType, start: number, end: number) => {
    tokens.push({ type, text: line.slice(start, end), start, end });
    w = w.slice(0, start) + MASK.repeat(end - start) + w.slice(end);
  };
  if (isSubtask) {
    const gt = line.indexOf('>');
    w = w.slice(0, gt) + MASK + w.slice(gt + 1);
  }

  // #tema / @persona: al inicio o tras espacio (así "ana@x.com" no es una persona)
  const topicNames: string[] = [];
  const personNames: string[] = [];
  for (const m of w.matchAll(/(?<!\S)([#@])([\p{L}\p{N}_-]+)/gu)) {
    const start = m.index!;
    (m[1] === '#' ? topicNames : personNames).push(m[2]);
    take(m[1] === '#' ? 'topic' : 'person', start, start + m[0].length);
  }

  let priority: Priority | null = null;
  for (const m of w.matchAll(/(?<!\S)!([123])(?![\p{L}\p{N}_])/gu)) {
    priority = Number(m[1]) as Priority;
    take('priority', m.index!, m.index! + m[0].length);
  }

  let explicit: ISODate | null = null;
  for (const m of w.matchAll(/(?<!\S)vence:(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{4})?)(?![\p{L}\p{N}_])/giu)) {
    const due = explicitDue(m[1], today);
    if (!due) continue;
    explicit = due;
    take('date', m.index!, m.index! + m[0].length);
  }

  // la recurrencia va antes que las fechas naturales para que "cada lunes" no sea "el lunes"
  let recurrence: Recurrence | null = null;
  const rec = matchRecurrence(foldText(w));
  if (rec) {
    recurrence = rec.rec;
    take('recurrence', rec.start, rec.end);
  }

  // se detecta aunque haya vence:, pero entonces no se usa
  const natural = parseSpanishDate(w, now);
  if (natural) take('date', natural.start, natural.end);

  const due = explicit ?? natural?.date ?? (recurrence ? firstOccurrence(recurrence, today) : null);

  return {
    title: w.replace(/\u0001+/g, ' ').replace(/\s+/g, ' ').trim(),
    topics: unique(topicNames),
    people: unique(personNames),
    due,
    priority,
    recurrence,
    isSubtask,
    tokens: tokens.sort((a, b) => a.start - b.start),
  };
}

/** Un bloque de texto: una tarea por línea no vacía. Las líneas indentadas (salvo la primera) son subtareas. */
export function parseBlock(text: string, now: Date = new Date()): ParsedLine[] {
  const out: ParsedLine[] = [];
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;
    const p = parseLine(raw, now);
    if (/^[ \t]/.test(raw) && out.length > 0) p.isSubtask = true;
    out.push(p);
  }
  return out;
}

/** Token de tema/persona bajo el cursor (para autocompletar). */
export function activeToken(text: string, caret: number): ActiveToken | null {
  const end = Math.min(Math.max(caret, 0), text.length);
  let i = end;
  while (i > 0 && isWordChar(text[i - 1])) i--;
  const sym = text[i - 1];
  if (sym !== '#' && sym !== '@') return null;
  if (i >= 2 && !/\s/.test(text[i - 2])) return null;
  return { type: sym === '#' ? 'topic' : 'person', prefix: text.slice(i, end), start: i - 1, end };
}

/** Línea canónica que vuelve a parsearse al mismo resultado. */
export function formatLine(t: {
  title: string;
  topicNames: string[];
  peopleNames: string[];
  due: ISODate | null;
  priority: Priority | null;
  recurrence: Recurrence | null;
}): string {
  return [
    t.title,
    ...t.topicNames.map((n) => `#${n}`),
    ...t.peopleNames.map((n) => `@${n}`),
    t.priority ? `!${t.priority}` : '',
    t.recurrence ? formatRecurrence(t.recurrence) : '',
    t.due ? `vence:${t.due}` : '',
  ].filter(Boolean).join(' ');
}

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Fecha relativa a hoy para mostrar: hoy, mañana, ayer, nombre de día (2-6 días) o "2 nov". */
export function formatDue(due: ISODate, today: ISODate): string {
  const diff = diffDays(today, due);
  if (diff === 0) return 'hoy';
  if (diff === 1) return 'mañana';
  if (diff === -1) return 'ayer';
  const d = fromISODate(due);
  if (diff >= 2 && diff <= 6) return DIAS[d.getDay()];
  const base = `${d.getDate()} ${MESES[d.getMonth()]}`;
  return d.getFullYear() === fromISODate(today).getFullYear() ? base : `${base} ${d.getFullYear()}`;
}
