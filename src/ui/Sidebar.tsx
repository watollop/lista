import { useMemo, useState } from 'preact/hooks';
import type { DateFilter, Entity, Filter, ID, Priority, SavedFilter, Task } from '../types';
import { emptyFilter, isEmptyFilter, toggleIn } from '../filters';
import { sameFilter } from './FilterBar';
import { PriorityName } from './Priority';

interface Props {
  filter: Filter;
  setFilter: (f: Filter) => void;
  tasks: Task[];
  saved: SavedFilter[];
  topics: Entity[];
  people: Entity[];
  counts: Record<DateFilter | 'open', number>;
  searchRef: { current: HTMLInputElement | null };
  onSave: (name: string) => void;
  onDeleteSaved: (id: ID) => void;
}

const DATES: Array<[DateFilter, string]> = [
  ['today', 'Hoy'], ['week', 'Semana'], ['month', 'Mes'], ['quarter', 'Trimestre'], ['year', 'Año'],
  ['overdue', 'Vencidas'], ['nodate', 'Sin fecha'],
];

/** Pantallas anchas: todos los filtros a la vista, con recuento de pendientes. Misma lógica que FilterBar. */
export function Sidebar(p: Props) {
  const { filter: f, setFilter } = p;
  const set = (patch: Partial<Filter>) => setFilter({ ...f, ...patch });
  const current = p.saved.find((s) => sameFilter(f, s.filter));
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  // Pendientes por tema, persona y prioridad.
  const tally = useMemo(() => {
    const m = new Map<string, number>();
    const inc = (k: string) => m.set(k, (m.get(k) ?? 0) + 1);
    for (const t of p.tasks) {
      if (t.deleted || t.done) continue;
      t.topics.forEach((k) => inc('#' + k));
      t.people.forEach((k) => inc('@' + k));
      if (t.priority) inc('!' + t.priority);
    }
    return m;
  }, [p.tasks]);

  const save = () => {
    if (name.trim()) p.onSave(name.trim());
    setName('');
    setNaming(false);
  };

  return (
    <aside class="side" aria-label="Filtros">
      <input ref={p.searchRef} class="side-search" type="search" placeholder="Buscar" value={f.text} aria-label="Buscar"
        onInput={(e) => set({ text: e.currentTarget.value })}
        onKeyDown={(e) => { if (e.key === 'Escape') e.currentTarget.blur(); }} />

      <ul class="side-list">
        <Item on={isEmptyFilter(f)} count={p.counts.open} onClick={() => setFilter(emptyFilter())}>Todas</Item>
      </ul>

      <Group title="Fecha">
        {DATES.map(([d, l]) => (
          <Item key={d} on={f.dates.includes(d)} count={p.counts[d]} warn={d === 'overdue' && p.counts.overdue > 0}
            onClick={() => set({ dates: toggleIn(f.dates, d) })}>{l}</Item>
        ))}
        <Item on={f.status === 'done'} onClick={() => set({ status: f.status === 'done' ? 'open' : 'done' })}>Hechas</Item>
      </Group>

      <Group title="Prioridad">
        {([1, 2, 3] as Priority[]).map((n) => (
          <Item key={n} on={f.priorities.includes(n)} count={tally.get('!' + n)}
            onClick={() => set({ priorities: toggleIn(f.priorities, n) })}><PriorityName p={n} /></Item>
        ))}
      </Group>

      {p.topics.length > 0 && (
        <Group title="Temas">
          {p.topics.map((t) => (
            <Item key={t.key} on={f.topics.includes(t.key)} count={tally.get('#' + t.key)}
              onClick={() => set({ topics: toggleIn(f.topics, t.key) })}>#{t.name}</Item>
          ))}
        </Group>
      )}

      {p.people.length > 0 && (
        <Group title="Personas">
          {p.people.map((t) => (
            <Item key={t.key} on={f.people.includes(t.key)} count={tally.get('@' + t.key)}
              onClick={() => set({ people: toggleIn(f.people, t.key) })}>@{t.name}</Item>
          ))}
        </Group>
      )}

      {(p.saved.length > 0 || (!isEmptyFilter(f) && !current)) && (
        <Group title="Guardados">
          {p.saved.map((s, i) => (
            <li key={s.id} class="side-pair">
              <button class={`side-item ${current?.id === s.id ? 'on' : ''}`} aria-pressed={current?.id === s.id}
                onClick={() => setFilter(current?.id === s.id ? emptyFilter() : s.filter)}>
                <span>{s.name}</span>{i < 9 && <kbd>{i + 1}</kbd>}
              </button>
              <button class="side-x" aria-label={`Borrar filtro ${s.name}`} onClick={() => p.onDeleteSaved(s.id)}>×</button>
            </li>
          ))}
          {!isEmptyFilter(f) && !current && (
            <li>
              {naming ? (
                <input autoFocus class="side-search" placeholder="Nombre del filtro" value={name} aria-label="Nombre del filtro"
                  onInput={(e) => setName(e.currentTarget.value)} onBlur={save}
                  onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setNaming(false); }} />
              ) : (
                <button class="side-item side-add" onClick={() => setNaming(true)}>+ Guardar filtro actual</button>
              )}
            </li>
          )}
        </Group>
      )}
    </aside>
  );
}

function Group({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return (
    <section class="side-group">
      <h3 class="label">{title}</h3>
      <ul class="side-list">{children}</ul>
    </section>
  );
}

function Item({ on, count, warn, onClick, children }:
  { on: boolean; count?: number; warn?: boolean; onClick: () => void; children: preact.ComponentChildren }) {
  return (
    <li>
      <button class={`side-item ${on ? 'on' : ''} ${warn ? 'warn' : ''}`} aria-pressed={on} onClick={onClick}>
        <span>{children}</span>
        {count ? <span class="side-count">{count}</span> : null}
      </button>
    </li>
  );
}
