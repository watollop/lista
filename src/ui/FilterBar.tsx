import { useState } from 'preact/hooks';
import type { DateFilter, Entity, EntityKind, Filter, ID, Priority, SavedFilter } from '../types';
import { emptyFilter, isEmptyFilter, toggleIn } from '../filters';
import { PRIORITY_LABEL, PriorityName } from './Priority';

interface Props {
  filter: Filter;
  setFilter: (f: Filter) => void;
  saved: SavedFilter[];
  topics: Entity[]; // solo los que tienen pendientes o están en el filtro
  people: Entity[];
  names: Map<string, Entity>;
  pending: Map<string, number>; // '#clave' | '@clave' -> pendientes
  counts: Record<DateFilter | 'open', number>;
  open: boolean; // fila de búsqueda visible
  setOpen: (v: boolean) => void;
  searchRef: { current: HTMLInputElement | null };
  onSave: (name: string) => void;
  onDeleteSaved: (id: ID) => void;
  onEditEntity: (kind: EntityKind, key: string) => void; // la hoja de edición la pinta App
  onDeleteEntity: (kind: EntityKind, key: string) => void;
}

type Menu = 'date' | 'topic' | 'person' | 'prio' | 'saved';

const DATES: Array<[DateFilter, string]> = [
  ['today', 'Hoy'], ['week', 'Semana'], ['month', 'Mes'],
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
  const [editing, setEditing] = useState(false); // modo edición de temas/personas
  const set = (patch: Partial<Filter>) => setFilter({ ...f, ...patch });
  const toggleMenu = (m: Menu) => { setEditing(false); setMenu(menu === m ? null : m); };
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

  // Chips de temas o personas. En modo edición: nº de pendientes, tocar edita y la ✕ borra.
  const entityChips = (kind: EntityKind) => {
    const sym = kind === 'topic' ? '#' : '@';
    const list = kind === 'topic' ? p.topics : p.people;
    const sel = kind === 'topic' ? f.topics : f.people;
    if (!list.length) {
      return <span class="label hint">{kind === 'topic'
        ? 'Aún no hay temas · escribe #tema en una tarea'
        : 'Aún no hay personas · escribe @persona en una tarea'}</span>;
    }
    return (
      <>
        {list.map((t) => editing ? (
          <span key={t.key} class="pair">
            <button class="chip" onClick={() => p.onEditEntity(kind, t.key)}>
              {sym}{t.name}<sup>{p.pending.get(sym + t.key) ?? 0}</sup>
            </button>
            <button class="chip" aria-label={`Borrar ${sym}${t.name}`} onClick={() => p.onDeleteEntity(kind, t.key)}>×</button>
          </span>
        ) : (
          <Chip key={t.key} on={sel.includes(t.key)}
            onClick={() => set(kind === 'topic' ? { topics: toggleIn(f.topics, t.key) } : { people: toggleIn(f.people, t.key) })}>
            {sym}{t.name}
          </Chip>
        ))}
        {editing
          ? <button class="link on" onClick={() => setEditing(false)}>Listo</button>
          : <button class="link" onClick={() => setEditing(true)}>Editar</button>}
      </>
    );
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
          {menu === 'topic' && entityChips('topic')}
          {menu === 'person' && entityChips('person')}
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
