import type { DateFilter, Filter, ISODate, Task } from '../types';
import { addDays } from '../lib/date';
import { periodEnd } from '../lib/period';
import { fold } from '../lib/text';

export function emptyFilter(): Filter {
  return { topics: [], people: [], dates: [], priorities: [], status: 'open', text: '' };
}

export function isEmptyFilter(f: Filter): boolean {
  return (
    f.topics.length === 0 &&
    f.people.length === 0 &&
    f.dates.length === 0 &&
    f.priorities.length === 0 &&
    f.status === 'open' &&
    f.text.trim() === ''
  );
}

export function toggleIn<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

const inWeek = (due: ISODate | null, today: ISODate) =>
  due !== null && due >= today && due <= addDays(today, 6);

/** Desde hoy hasta el fin del mes/trimestre/año en curso. */
const until = (due: ISODate | null, today: ISODate, end: ISODate) => due !== null && due >= today && due <= end;
const inMonth = (due: ISODate | null, today: ISODate) => until(due, today, periodEnd('month', today));
const inQuarter = (due: ISODate | null, today: ISODate) => until(due, today, periodEnd('quarter', today));
const inYear = (due: ISODate | null, today: ISODate) => until(due, today, periodEnd('year', today));

const isOverdue = (t: Task, today: ISODate) => t.due !== null && t.due < today && t.done === 0;

/** Comparador ascendente con nulos al final. */
function nullLast<T extends string | number>(x: T | null, y: T | null): number {
  if (x === null || y === null) return x === null ? (y === null ? 0 : 1) : -1;
  return x < y ? -1 : x > y ? 1 : 0;
}

export function matches(task: Task, f: Filter, today: ISODate, parent?: Task): boolean {
  if (task.deleted) return false;
  if (f.topics.length && !f.topics.some((k) => [...task.topics, ...(parent?.topics ?? [])].includes(k))) return false;
  if (f.people.length && !f.people.some((k) => [...task.people, ...(parent?.people ?? [])].includes(k))) return false;
  if (f.dates.length) {
    const ok = f.dates.some((d) => {
      switch (d) {
        case 'today': return task.due === today;
        case 'week': return inWeek(task.due, today);
        case 'month': return inMonth(task.due, today);
        case 'quarter': return inQuarter(task.due, today);
        case 'year': return inYear(task.due, today);
        case 'overdue': return isOverdue(task, today);
        case 'nodate': return task.due === null;
      }
    });
    if (!ok) return false;
  }
  if (f.priorities.length && (task.priority === null || !f.priorities.includes(task.priority))) return false;
  if (f.status === 'open' && task.done !== 0) return false;
  if (f.status === 'done' && task.done !== 1) return false;
  const words = fold(f.text).trim().split(/\s+/).filter(Boolean);
  if (words.length) {
    const hay = fold(`${task.title} ${task.topics.join(' ')} ${task.people.join(' ')}`);
    if (!words.every((w) => hay.includes(w))) return false;
  }
  return true;
}

export function sortTasks(tasks: Task[], today: ISODate): Task[] {
  const ov = (t: Task) => (isOverdue(t, today) ? 0 : 1);
  return [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done - b.done;
    if (a.done === 1) return (b.doneAt ?? 0) - (a.doneAt ?? 0);
    return (
      ov(a) - ov(b) ||
      nullLast(a.due, b.due) ||
      nullLast(a.priority, b.priority) ||
      a.order - b.order ||
      a.createdAt - b.createdAt
    );
  });
}

export function applyFilter(tasks: Task[], f: Filter, today: ISODate): Task[] {
  const live = tasks.filter((t) => !t.deleted);
  const byId = new Map(live.map((t) => [t.id, t]));
  const out = new Set<Task>();
  for (const t of live) {
    const parent = t.parentId ? byId.get(t.parentId) : undefined;
    if (!matches(t, f, today, parent)) continue;
    out.add(t);
    if (parent) out.add(parent);
  }
  return sortTasks([...out], today);
}

export function groupTasks(sorted: Task[]): Array<{ task: Task; children: Task[] }> {
  const ids = new Set(sorted.map((t) => t.id));
  const childrenOf = new Map<string, Task[]>();
  for (const t of sorted) {
    if (t.parentId && ids.has(t.parentId)) {
      const list = childrenOf.get(t.parentId) ?? [];
      list.push(t);
      childrenOf.set(t.parentId, list);
    }
  }
  for (const list of childrenOf.values()) {
    list.sort((a, b) => a.done - b.done || a.order - b.order || a.createdAt - b.createdAt);
  }
  return sorted
    .filter((t) => !(t.parentId && ids.has(t.parentId)))
    .map((task) => ({ task, children: childrenOf.get(task.id) ?? [] }));
}

export function counts(
  tasks: Task[],
  today: ISODate,
): Record<DateFilter | 'open', number> {
  const open = tasks.filter((t) => !t.deleted && t.done === 0);
  return {
    today: open.filter((t) => t.due === today).length,
    week: open.filter((t) => inWeek(t.due, today)).length,
    month: open.filter((t) => inMonth(t.due, today)).length,
    quarter: open.filter((t) => inQuarter(t.due, today)).length,
    year: open.filter((t) => inYear(t.due, today)).length,
    overdue: open.filter((t) => isOverdue(t, today)).length,
    nodate: open.filter((t) => t.due === null).length,
    open: open.length,
  };
}
