import { describe, it, expect } from 'vitest';
import type { Filter, Task } from '../types';
import {
  emptyFilter,
  isEmptyFilter,
  toggleIn,
  matches,
  sortTasks,
  applyFilter,
  groupTasks,
  counts,
} from './index';

const TODAY = '2026-10-27';
let seq = 0;
const mk = (p: Partial<Task> = {}): Task => ({
  id: `t${++seq}`,
  title: 'tarea',
  topics: [],
  people: [],
  due: null,
  priority: null,
  recurrence: null,
  parentId: null,
  done: 0,
  doneAt: null,
  nextId: null,
  order: 0,
  createdAt: 0,
  updatedAt: 0,
  deleted: 0,
  dirty: 0,
  ...p,
});
const f = (p: Partial<Filter> = {}): Filter => ({ ...emptyFilter(), ...p });

describe('emptyFilter / isEmptyFilter / toggleIn', () => {
  it('empty filter is empty; status open is default', () => {
    expect(emptyFilter()).toEqual({ topics: [], people: [], dates: [], priorities: [], status: 'open', text: '' });
    expect(isEmptyFilter(emptyFilter())).toBe(true);
    expect(isEmptyFilter(f({ text: '   ' }))).toBe(true);
  });
  it('detects any constraint', () => {
    expect(isEmptyFilter(f({ topics: ['x'] }))).toBe(false);
    expect(isEmptyFilter(f({ people: ['x'] }))).toBe(false);
    expect(isEmptyFilter(f({ dates: ['today'] }))).toBe(false);
    expect(isEmptyFilter(f({ priorities: [1] }))).toBe(false);
    expect(isEmptyFilter(f({ status: 'all' }))).toBe(false);
    expect(isEmptyFilter(f({ text: 'a' }))).toBe(false);
  });
  it('toggleIn adds and removes without mutating', () => {
    const a = ['x'];
    expect(toggleIn(a, 'y')).toEqual(['x', 'y']);
    expect(toggleIn(a, 'x')).toEqual([]);
    expect(a).toEqual(['x']);
  });
});

describe('date filters', () => {
  it('today', () => {
    const t = mk({ due: TODAY });
    expect(matches(t, f({ dates: ['today'] }), TODAY)).toBe(true);
    expect(matches(mk({ due: '2026-10-28' }), f({ dates: ['today'] }), TODAY)).toBe(false);
  });
  it('week includes day 0 and day 6, excludes day 7 and past', () => {
    const w = f({ dates: ['week'] });
    expect(matches(mk({ due: '2026-10-27' }), w, TODAY)).toBe(true);
    expect(matches(mk({ due: '2026-11-02' }), w, TODAY)).toBe(true); // today+6
    expect(matches(mk({ due: '2026-11-03' }), w, TODAY)).toBe(false); // today+7
    expect(matches(mk({ due: '2026-10-26' }), w, TODAY)).toBe(false);
    expect(matches(mk({ due: null }), w, TODAY)).toBe(false);
  });
  it('overdue excludes done and future', () => {
    const o = f({ dates: ['overdue'], status: 'all' });
    expect(matches(mk({ due: '2026-10-26' }), o, TODAY)).toBe(true);
    expect(matches(mk({ due: '2026-10-26', done: 1 }), o, TODAY)).toBe(false);
    expect(matches(mk({ due: TODAY }), o, TODAY)).toBe(false);
  });
  it('nodate', () => {
    expect(matches(mk({ due: null }), f({ dates: ['nodate'] }), TODAY)).toBe(true);
    expect(matches(mk({ due: TODAY }), f({ dates: ['nodate'] }), TODAY)).toBe(false);
  });
  it('OR within dates field', () => {
    const d = f({ dates: ['today', 'nodate'] });
    expect(matches(mk({ due: TODAY }), d, TODAY)).toBe(true);
    expect(matches(mk({ due: null }), d, TODAY)).toBe(true);
    expect(matches(mk({ due: '2026-11-10' }), d, TODAY)).toBe(false);
  });
});

describe('OR within field, AND across fields', () => {
  it('topics OR, priorities OR', () => {
    const t = mk({ topics: ['casa'], priority: 2 });
    expect(matches(t, f({ topics: ['trabajo', 'casa'] }), TODAY)).toBe(true);
    expect(matches(t, f({ topics: ['trabajo'] }), TODAY)).toBe(false);
    expect(matches(t, f({ priorities: [1, 2] }), TODAY)).toBe(true);
    expect(matches(mk({ priority: null }), f({ priorities: [1] }), TODAY)).toBe(false);
  });
  it('AND across fields', () => {
    const t = mk({ topics: ['casa'], due: TODAY });
    expect(matches(t, f({ topics: ['casa'], dates: ['today'] }), TODAY)).toBe(true);
    expect(matches(t, f({ topics: ['casa'], dates: ['nodate'] }), TODAY)).toBe(false);
    expect(matches(t, f({ topics: ['otro'], dates: ['today'] }), TODAY)).toBe(false);
  });
  it('people filter', () => {
    const t = mk({ people: ['ana'] });
    expect(matches(t, f({ people: ['ana', 'luis'] }), TODAY)).toBe(true);
    expect(matches(t, f({ people: ['luis'] }), TODAY)).toBe(false);
  });
});

describe('status', () => {
  it('open / done / all', () => {
    const open = mk({ done: 0 });
    const done = mk({ done: 1, doneAt: 5 });
    expect(matches(open, f({ status: 'open' }), TODAY)).toBe(true);
    expect(matches(done, f({ status: 'open' }), TODAY)).toBe(false);
    expect(matches(open, f({ status: 'done' }), TODAY)).toBe(false);
    expect(matches(done, f({ status: 'done' }), TODAY)).toBe(true);
    expect(matches(open, f({ status: 'all' }), TODAY)).toBe(true);
    expect(matches(done, f({ status: 'all' }), TODAY)).toBe(true);
  });
  it('deleted tasks never match, even with status all', () => {
    expect(matches(mk({ deleted: 1 }), f({ status: 'all' }), TODAY)).toBe(false);
  });
});

describe('text search', () => {
  it('ignores accents and case', () => {
    expect(matches(mk({ title: 'Reunión con Ana' }), f({ text: 'reunion' }), TODAY)).toBe(true);
    expect(matches(mk({ title: 'Reunion' }), f({ text: 'REUNIÓN' }), TODAY)).toBe(true);
  });
  it('every word must match, in any order, across title/topics/people', () => {
    const t = mk({ title: 'Llamar a banco', topics: ['finanzas'], people: ['ana'] });
    expect(matches(t, f({ text: 'banco llamar' }), TODAY)).toBe(true);
    expect(matches(t, f({ text: '  banco   finanzas ' }), TODAY)).toBe(true);
    expect(matches(t, f({ text: 'banco ana' }), TODAY)).toBe(true);
    expect(matches(t, f({ text: 'banco luis' }), TODAY)).toBe(false);
  });
  it('blank text is no constraint', () => {
    expect(matches(mk({ title: 'x' }), f({ text: '   ' }), TODAY)).toBe(true);
  });
});

describe('subtask inheritance', () => {
  it('subtask inherits parent topics and people', () => {
    const parent = mk({ id: 'P', topics: ['casa'], people: ['ana'] });
    const sub = mk({ parentId: 'P' });
    expect(matches(sub, f({ topics: ['casa'] }), TODAY)).toBe(false);
    expect(matches(sub, f({ topics: ['casa'] }), TODAY, parent)).toBe(true);
    expect(matches(sub, f({ people: ['ana'] }), TODAY, parent)).toBe(true);
  });
  it('applyFilter: matching subtask brings its parent as context', () => {
    const parent = mk({ id: 'P', title: 'proyecto', createdAt: 1 });
    const sub = mk({ id: 'S', parentId: 'P', title: 'comprar pan', createdAt: 2 });
    const other = mk({ id: 'O', title: 'otra' });
    const res = applyFilter([parent, sub, other], f({ text: 'pan' }), TODAY);
    expect(res.map((t) => t.id).sort()).toEqual(['P', 'S']);
  });
  it('applyFilter: subtask inherits parent topic and parent is included once', () => {
    const parent = mk({ id: 'P', topics: ['casa'] });
    const sub = mk({ id: 'S', parentId: 'P' });
    const sub2 = mk({ id: 'S2', parentId: 'P' });
    const res = applyFilter([parent, sub, sub2], f({ topics: ['casa'] }), TODAY);
    expect(res.map((t) => t.id).sort()).toEqual(['P', 'S', 'S2']);
  });
  it('applyFilter: parent does not add subtasks that do not match', () => {
    const parent = mk({ id: 'P', title: 'leche' });
    const sub = mk({ id: 'S', parentId: 'P', title: 'otra cosa' });
    expect(applyFilter([parent, sub], f({ text: 'leche' }), TODAY).map((t) => t.id)).toEqual(['P']);
  });
});

describe('applyFilter', () => {
  it('excludes deleted tasks and does not return deleted parents as context', () => {
    const parent = mk({ id: 'P', deleted: 1, title: 'x' });
    const sub = mk({ id: 'S', parentId: 'P', title: 'x' });
    const del = mk({ id: 'D', title: 'x', deleted: 1 });
    expect(applyFilter([parent, sub, del], f({ text: 'x' }), TODAY).map((t) => t.id)).toEqual(['S']);
  });
  it('sorts the result', () => {
    const a = mk({ id: 'a', due: '2026-11-01', createdAt: 1 });
    const b = mk({ id: 'b', due: TODAY, createdAt: 2 });
    expect(applyFilter([a, b], emptyFilter(), TODAY).map((t) => t.id)).toEqual(['b', 'a']);
  });
});

describe('sortTasks', () => {
  it('open before done; done by doneAt desc', () => {
    const d1 = mk({ id: 'd1', done: 1, doneAt: 10 });
    const d2 = mk({ id: 'd2', done: 1, doneAt: 20 });
    const o = mk({ id: 'o' });
    expect(sortTasks([d1, o, d2], TODAY).map((t) => t.id)).toEqual(['o', 'd2', 'd1']);
  });
  it('overdue first, then due asc with null last', () => {
    const over = mk({ id: 'over', due: '2026-10-20' });
    const today = mk({ id: 'today', due: TODAY });
    const future = mk({ id: 'future', due: '2026-12-01' });
    const nodate = mk({ id: 'nodate' });
    expect(sortTasks([nodate, future, today, over], TODAY).map((t) => t.id)).toEqual([
      'over',
      'today',
      'future',
      'nodate',
    ]);
  });
  it('then priority asc with null last, then order, then createdAt', () => {
    const p1 = mk({ id: 'p1', priority: 1 });
    const p3 = mk({ id: 'p3', priority: 3 });
    const pn = mk({ id: 'pn', priority: null });
    expect(sortTasks([pn, p3, p1], TODAY).map((t) => t.id)).toEqual(['p1', 'p3', 'pn']);

    const o2 = mk({ id: 'o2', order: 2, createdAt: 1 });
    const o1 = mk({ id: 'o1', order: 1, createdAt: 9 });
    expect(sortTasks([o2, o1], TODAY).map((t) => t.id)).toEqual(['o1', 'o2']);

    const c2 = mk({ id: 'c2', createdAt: 5 });
    const c1 = mk({ id: 'c1', createdAt: 3 });
    expect(sortTasks([c2, c1], TODAY).map((t) => t.id)).toEqual(['c1', 'c2']);
  });
  it('returns a new array and does not mutate input', () => {
    const input = [mk({ id: 'b', order: 2 }), mk({ id: 'a', order: 1 })];
    const out = sortTasks(input, TODAY);
    expect(out).not.toBe(input);
    expect(input.map((t) => t.id)).toEqual(['b', 'a']);
  });
});

describe('groupTasks', () => {
  it('groups children under parent, open first then order', () => {
    const p = mk({ id: 'P', order: 1 });
    const c1 = mk({ id: 'c1', parentId: 'P', done: 1, doneAt: 1, order: 0 });
    const c2 = mk({ id: 'c2', parentId: 'P', order: 5 });
    const c3 = mk({ id: 'c3', parentId: 'P', order: 2 });
    const g = groupTasks([p, c2, c3, c1]);
    expect(g.length).toBe(1);
    expect(g[0].task.id).toBe('P');
    expect(g[0].children.map((t) => t.id)).toEqual(['c3', 'c2', 'c1']);
  });
  it('orphan subtask (parent not in list) becomes top-level', () => {
    const orphan = mk({ id: 'O', parentId: 'GONE' });
    const p = mk({ id: 'P' });
    const g = groupTasks([p, orphan]);
    expect(g.map((e) => e.task.id)).toEqual(['P', 'O']);
    expect(g[1].children).toEqual([]);
  });
  it('keeps top-level input order', () => {
    const a = mk({ id: 'a' });
    const b = mk({ id: 'b' });
    expect(groupTasks([b, a]).map((e) => e.task.id)).toEqual(['b', 'a']);
  });
});

describe('periodos en filtros', () => {
  it('mes, trimestre y año van de hoy al fin del periodo', () => {
    const tasks = [mk({ id: 'oct', due: '2026-10-31' }), mk({ id: 'nov', due: '2026-11-30' }), mk({ id: 'mar', due: '2027-03-31' })];
    const ids = (d: 'month' | 'quarter' | 'year') => applyFilter(tasks, { ...emptyFilter(), dates: [d] }, TODAY).map((t) => t.id);
    expect(ids('month')).toEqual(['oct']);
    expect(ids('quarter')).toEqual(['oct', 'nov']);
    expect(ids('year')).toEqual(['oct', 'nov']);
  });
});

describe('counts', () => {
  it('counts open, non-deleted tasks by bucket', () => {
    const tasks = [
      mk({ due: TODAY }),
      mk({ due: '2026-11-02' }),
      mk({ due: '2026-11-03' }),
      mk({ due: '2026-10-01' }),
      mk({ due: null }),
      mk({ due: TODAY, done: 1, doneAt: 1 }),
      mk({ due: null, deleted: 1 }),
    ];
    expect(counts(tasks, TODAY)).toEqual({ today: 1, week: 2, month: 1, quarter: 3, year: 3, overdue: 1, nodate: 1, open: 5 });
  });
});

describe('isEmptyFilter', () => {
  it('is false when status is not open', () => {
    expect(isEmptyFilter(f({ status: 'done' }))).toBe(false);
  });
});
