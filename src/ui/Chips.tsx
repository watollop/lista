import type { Entity, ISODate, Priority, Recurrence } from '../types';
import { formatDue, formatRecurrence } from '../parser';

export type ChipTap = (type: 'topic' | 'person' | 'priority', key: string | Priority) => void;

interface Props {
  due: ISODate | null;
  done?: boolean;
  priority: Priority | null;
  recurrence: Recurrence | null;
  topics: string[];
  people: string[];
  names: Map<string, Entity>; // clave -> entidad (temas y personas)
  today: ISODate;
  onTap?: ChipTap;
}

/** Chips discretos de una tarea. Con onTap, tocar #tema/@persona/!prio filtra por él. */
export function TaskChips({ due, done, priority, recurrence, topics, people, names, today, onTap }: Props) {
  const overdue = !done && due !== null && due < today;
  const tag = (cls: string, text: string, tap?: () => void) =>
    tap ? <button class={`chip ${cls}`} onClick={tap}>{text}</button> : <span class={`chip ${cls}`}>{text}</span>;
  return (
    <>
      {due && tag(overdue ? 'warn' : '', formatDue(due, today))}
      {recurrence && tag('', formatRecurrence(recurrence))}
      {priority && tag(priority === 1 ? 'warn' : '', `!${priority}`, onTap && (() => onTap('priority', priority)))}
      {topics.map((k) => tag('', `#${names.get('#' + k)?.name ?? k}`, onTap && (() => onTap('topic', k))))}
      {people.map((k) => tag('', `@${names.get('@' + k)?.name ?? k}`, onTap && (() => onTap('person', k))))}
    </>
  );
}
