import type { DateFilter, Entity, ISODate, Period, Priority, Recurrence } from '../types';
import { formatDue, formatRecurrence, inlineTags, normalizeKey } from '../parser';
import { PRIORITY_LABEL, PriorityIcon } from './Priority';
import { dateFilterFor } from '../filters';
import { formatPeriod, isCurrentPeriod } from '../lib/period';

export type ChipTap = (type: 'topic' | 'person' | 'priority' | 'date', key: string | Priority | DateFilter) => void;

interface Props {
  due: ISODate | null;
  period?: Period | null;
  done?: boolean;
  priority: Priority | null;
  recurrence: Recurrence | null;
  topics: string[];
  people: string[];
  names: Map<string, Entity>; // clave -> entidad (temas y personas)
  today: ISODate;
  onTap?: ChipTap;
  title?: string; // los #temas/@personas ya escritos en el título no se repiten como chip
}

/** Chips discretos de una tarea. Con onTap, tocar #tema/@persona/!prio filtra por él. */
export function TaskChips({ due, period, done, priority, recurrence, topics, people, names, today, onTap, title }: Props) {
  const inline = new Set(title ? inlineTags(title).map((t) => t.sym + normalizeKey(t.name)) : []);
  const overdue = !done && due !== null && due < today;
  const tag = (cls: string, content: preact.ComponentChildren, tap?: () => void, label?: string) =>
    tap
      ? <button class={`chip ${cls}`} onClick={tap} aria-label={label} title={label}>{content}</button>
      : <span class={`chip ${cls}`} aria-label={label} title={label}>{content}</span>;
  return (
    <>
      {due && tag(overdue ? 'warn' : '', period ? formatPeriod(period, due, today) : formatDue(due, today),
        // Tocar la fecha filtra por su bloque: el del periodo en curso o el más estrecho que la contiene.
        onTap && (() => onTap('date', period && isCurrentPeriod(period, due, today) ? period : dateFilterFor(due, today))))}
      {recurrence && tag('', formatRecurrence(recurrence))}
      {priority && tag(`prio ${priority === 1 ? 'warn' : ''}`, <PriorityIcon p={priority} />,
        onTap && (() => onTap('priority', priority)), `Prioridad ${PRIORITY_LABEL[priority].toLowerCase()}`)}
      {topics.filter((k) => !inline.has('#' + k)).map((k) => tag('', `#${names.get('#' + k)?.name ?? k}`, onTap && (() => onTap('topic', k))))}
      {people.filter((k) => !inline.has('@' + k)).map((k) => tag('', `@${names.get('@' + k)?.name ?? k}`, onTap && (() => onTap('person', k))))}
    </>
  );
}
