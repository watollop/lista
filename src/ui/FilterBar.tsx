import { useState } from 'preact/hooks';
import type { DateFilter, Entity, Filter, ID, Priority, SavedFilter } from '../types';
import { emptyFilter, isEmptyFilter, toggleIn } from '../filters';
import { PRIORITY_LABEL, PriorityName } from './Priority';

interface Props {
  filter: Filter;
  setFilter: (f: Filter) => void;
  saved: SavedFilter[];
  topics: Entity[];
  people: Entity[];
  names: Map<string, Entity>;
  counts: Record<DateFilter | 'open', number>;
  open: boolean; // fila de búsqueda visible
  setOpen: (v: boolean) => void;
  searchRef: { current: HTMLInputElement | null };
  onSave: (name: string) => void;
  onDeleteSaved: (id: ID) => void;
}

type Menu = 'date' | 'topic' | 'person' | 'prio' | 'saved';

const DATES: Array<[DateFilter, string]> = [
  ['today', 'Hoy'], ['week', 'Semana'], ['month', 'Mes'], ['quarter', 'Trimestre'], ['year', 'Año'],
  ['overdue', 'Vencidas'], ['nodate', 'Sin fecha'],
];

export const sameFilter = (a: Filter, b: Filter) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
const norm = (f: Filter) => ({
  ...f, text: f.text.trim(),
  topics: [...f.topics].sort(), people: [...f.people].sort(), dates: [...f.dates].sort(), priorities: [...f.priorities].sort(),
});

/** Etiqueta del selector: su nombre si no hay selección, el valor si hay uno, "N <plural>" si hay varios. */
function label(base: string, plural: string, values: string[]): string {
  if (!values.length) return base;
  return values.length === 1 ? values[0] : `${values.length} ${plural}`;
}

export function FilterBar(p: Props) {
  const { filter: f, setFilter } = p;
  const [menu, setMenu] = useState<Menu | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const set = (patch: Partial<Filter>) => setFilter({ ...f, ...patch });
  const toggleMenu = (m: Menu) => setMenu(menu === m ? null : m);
  const active = !isEmptyFilter(f);
  const current = p.saved.find((s) => sameFilter(f, s.filter));

  const dateValues = [
    ...f.dates.map((d) => DATES.find((x) => x[0] === d)![1]),
    ...(f.status === 'done' ? ['Hechas'] : []),
  ];
  const selectors: Array<[Menu, string, boolean]> = [
    ['date', label('Fecha', 'fechas', dateValues), dateValues.length > 0],
    ['topic', label('Tema', 'temas', f.topics.map((k) => '#' + (p.names.get('#' + k)?.name ?? k))), f.topics.length > 0],
    ['person', label('Persona', 'personas', f.people.map((k) => '@' + (p.names.get('@' + k)?.name ?? k))), f.people.length > 0],
    ['prio', label('Prioridad', 'prioridades', f.priorities.map((n) => PRIORITY_LABEL[n])), f.priorities.length > 0],
  ];
  if (p.saved.length) selectors.push(['saved', current ? current.name : 'Guardados', !!current]);

  const save = () => {
    if (name.trim()) p.onSave(name.trim());
    setName('');
    setNaming(false);
  };

  return (
    <>
      {p.open && (
        <input ref={p.searchRef} class="search" type="search" placeholder="Buscar" value={f.text} aria-label="Buscar"
          onInput={(e) => set({ text: e.currentTarget.value })}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.currentTarget.blur(); if (!f.text) p.setOpen(false); } }} />
      )}

      <nav class="tabs" aria-label="Filtros">
        {selectors.map(([m, text, on]) => (
          <button key={m} class={`tab ${on ? 'on' : ''} ${menu === m ? 'open' : ''}`} aria-expanded={menu === m}
            onClick={() => toggleMenu(m)}>
            {text}<span class="caret" aria-hidden="true" />
          </button>
        ))}
      </nav>

      {menu && (
        <div class="menu">
          {menu === 'date' && (
            <>
              {DATES.map(([d, l]) => (
                <Chip key={d} on={f.dates.includes(d)} warn={d === 'overdue' && p.counts.overdue > 0}
                  onClick={() => set({ dates: toggleIn(f.dates, d) })}>
                  {l}{p.counts[d] > 0 && <sup>{p.counts[d]}</sup>}
                </Chip>
              ))}
              <span class="sep" />
              <Chip on={f.status === 'done'} onClick={() => set({ status: f.status === 'done' ? 'open' : 'done' })}>Hechas</Chip>
            </>
          )}
          {menu === 'topic' && (p.topics.length
            ? p.topics.map((t) => (
              <Chip key={t.key} on={f.topics.includes(t.key)} onClick={() => set({ topics: toggleIn(f.topics, t.key) })}>#{t.name}</Chip>
            ))
            : <span class="label hint">Aún no hay temas · escribe #tema en una tarea</span>)}
          {menu === 'person' && (p.people.length
            ? p.people.map((t) => (
              <Chip key={t.key} on={f.people.includes(t.key)} onClick={() => set({ people: toggleIn(f.people, t.key) })}>@{t.name}</Chip>
            ))
            : <span class="label hint">Aún no hay personas · escribe @persona en una tarea</span>)}
          {menu === 'prio' && ([1, 2, 3] as Priority[]).map((n) => (
            <Chip key={n} on={f.priorities.includes(n)} onClick={() => set({ priorities: toggleIn(f.priorities, n) })}><PriorityName p={n} /></Chip>
          ))}
          {menu === 'saved' && p.saved.map((s) => (
            <span key={s.id} class="pair">
              <Chip on={current?.id === s.id} onClick={() => { setFilter(current?.id === s.id ? emptyFilter() : s.filter); setMenu(null); }}>
                {s.name}
              </Chip>
              <button class="chip" aria-label={`Borrar filtro ${s.name}`} onClick={() => p.onDeleteSaved(s.id)}>×</button>
            </span>
          ))}
        </div>
      )}

      {active && (
        <div class="actions">
          {naming ? (
            <>
              <input autoFocus placeholder="Nombre del filtro" value={name} aria-label="Nombre del filtro"
                onInput={(e) => setName(e.currentTarget.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setNaming(false); }} />
              <button class="link on" onClick={save}>Guardar</button>
            </>
          ) : (
            <>
              <button class="link" onClick={() => { setFilter(emptyFilter()); setMenu(null); }}>Limpiar ×</button>
              {!current && <button class="link" onClick={() => setNaming(true)}>Guardar filtro</button>}
            </>
          )}
        </div>
      )}
    </>
  );
}

function Chip({ on, warn, onClick, children }:
  { on?: boolean; warn?: boolean; onClick: () => void; children: preact.ComponentChildren }) {
  return (
    <button class={`chip ${on ? 'on' : ''} ${warn && !on ? 'warn' : ''}`} aria-pressed={!!on} onClick={onClick}>
      {children}
    </button>
  );
}
