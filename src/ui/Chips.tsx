import type { Entity, ISODate, Priority, Recurrence } from '../types';
import { formatDue, formatRecurrence } from '../parser';
import { PRIORITY_LABEL, PriorityIcon } from './Priority';

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
  const tag = (cls: string, content: preact.ComponentChildren, tap?: () => void, label?: string) =>
    tap
      ? <button class={`chip ${cls}`} onClick={tap} aria-label={label} title={label}>{content}</button>
      : <span class={`chip ${cls}`} aria-label={label} title={label}>{content}</span>;
  return (
    <>
      {due && tag(overdue ? 'warn' : '', formatDue(due, today))}
      {recurrence && tag('', formatRecurrence(recurrence))}
      {priority && tag(`prio ${priority === 1 ? 'warn' : ''}`, <PriorityIcon p={priority} />,
        onTap && (() => onTap('priority', priority)), `Prioridad ${PRIORITY_LABEL[priority].toLowerCase()}`)}
      {topics.map((k) => tag('', `#${names.get('#' + k)?.name ?? k}`, onTap && (() => onTap('topic', k))))}
      {people.map((k) => tag('', `@${names.get('@' + k)?.name ?? k}`, onTap && (() => onTap('person', k))))}
    </>
  );
}
