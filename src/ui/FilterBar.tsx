import { useState } from 'preact/hooks';
import type { DateFilter, Entity, EntityKind, Filter, ID, Priority, SavedFilter } from '../types';
import { emptyFilter, isEmptyFilter, toggleIn } from '../filters';
import { priorityLabel, PriorityName } from './Priority';
import { formatDue } from '../parser';
import { tr } from '../i18n';

interface Props {
  filter: Filter;
  setFilter: (f: Filter) => void;
  saved: SavedFilter[];
  topics: Entity[]; // solo los que tienen pendientes o están en el filtro
  people: Entity[];
  names: Map<string, Entity>;
  pending: Map<string, number>; // '#clave' | '@clave' -> pendientes
  counts: Record<DateFilter | 'open', number>;
  today: string;
  week: preact.ComponentChildren; // pantalla de Hoy: en móvil, al final del panel de Filtrar (en escritorio, arriba de la barra lateral)
  open: boolean; // fila de búsqueda visible
  setOpen: (v: boolean) => void;
  searchRef: { current: HTMLInputElement | null };
  onSave: (name: string) => void;
  onDeleteSaved: (id: ID) => void;
  onEditEntity: (kind: EntityKind, key: string) => void; // la hoja de edición la pinta App
  onDeleteEntity: (kind: EntityKind, key: string) => void;
}

const DATES = (): Array<[DateFilter, string]> => [
  ['today', tr('Hoy', 'Today')], ['week', tr('Semana', 'Week')], ['month', tr('Mes', 'Month')],
  ['overdue', tr('Vencidas', 'Overdue')], ['nodate', tr('Sin fecha', 'No date')],
];

export const sameFilter = (a: Filter, b: Filter) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
const norm = (f: Filter) => ({
  ...f, text: f.text.trim(),
  topics: [...f.topics].sort(), people: [...f.people].sort(), dates: [...f.dates].sort(), priorities: [...f.priorities].sort(),
});

/**
 * Filtros en pantallas estrechas. Cerrado, no ocupa nada; con un filtro puesto, una fila con lo que filtra (tocar una
 * cosa la quita) y «Quitar filtros». «Filtrar» (cabecera) abre el panel con todo a la vista, como la barra lateral del
 * escritorio: búsqueda, fecha, prioridad, temas, personas, filtros guardados y la pantalla de Hoy.
 */
export function FilterBar(p: Props) {
  const { filter: f, setFilter } = p;
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<EntityKind | null>(null); // temas o personas en modo edición
  const set = (patch: Partial<Filter>) => setFilter({ ...f, ...patch });
  const active = !isEmptyFilter(f);
  const current = p.saved.find((s) => sameFilter(f, s.filter));

  const save = () => {
    if (name.trim()) p.onSave(name.trim());
    setName('');
    setNaming(false);
  };

  // Lo que filtra ahora, para la fila de resumen: cada cosa se quita tocándola.
  const ent = (sym: '#' | '@', k: string) => sym + (p.names.get(sym + k)?.name ?? k);
  const summary: Array<[string, string, () => void]> = current
    ? [['saved', current.name, () => setFilter(emptyFilter())]]
    : [
      ...(f.text.trim() ? [['text', `«${f.text.trim()}»`, () => set({ text: '' })] as [string, string, () => void]] : []),
      ...f.dates.map((d): [string, string, () => void] => [d, DATES().find((x) => x[0] === d)![1], () => set({ dates: f.dates.filter((x) => x !== d) })]),
      ...(f.day ? [['day', formatDue(f.day, p.today), () => set({ day: undefined })] as [string, string, () => void]] : []),
      ...(f.status === 'done' ? [['done', tr('Hechas', 'Done'), () => set({ status: 'open' })] as [string, string, () => void]] : []),
      ...f.priorities.map((n): [string, string, () => void] => [`!${n}`, priorityLabel(n), () => set({ priorities: f.priorities.filter((x) => x !== n) })]),
      ...f.topics.map((k): [string, string, () => void] => [`#${k}`, ent('#', k), () => set({ topics: f.topics.filter((x) => x !== k) })]),
      ...f.people.map((k): [string, string, () => void] => [`@${k}`, ent('@', k), () => set({ people: f.people.filter((x) => x !== k) })]),
    ];

  // Chips de temas o personas. En modo edición: nº de pendientes, tocar edita y la × borra.
  const entityChips = (kind: EntityKind) => {
    const sym = kind === 'topic' ? '#' : '@';
    const list = kind === 'topic' ? p.topics : p.people;
    const sel = kind === 'topic' ? f.topics : f.people;
    return list.map((t) => editing === kind ? (
      <span key={t.key} class="pair">
        <button class="chip" onClick={() => p.onEditEntity(kind, t.key)}>
          {sym}{t.name}<sup>{p.pending.get(sym + t.key) ?? 0}</sup>
        </button>
        <button class="chip" aria-label={tr(`Borrar ${sym}${t.name}`, `Delete ${sym}${t.name}`)} onClick={() => p.onDeleteEntity(kind, t.key)}>×</button>
      </span>
    ) : (
      <Chip key={t.key} on={sel.includes(t.key)}
        onClick={() => set(kind === 'topic' ? { topics: toggleIn(f.topics, t.key) } : { people: toggleIn(f.people, t.key) })}>
        {sym}{t.name}
      </Chip>
    ));
  };
  const editLink = (kind: EntityKind) => (editing === kind
    ? <button class="link on" onClick={() => setEditing(null)}>{tr('Listo', 'Done')}</button>
    : <button class="link" onClick={() => setEditing(kind)}>{tr('Editar', 'Edit')}</button>);

  return (
    <>
      {p.open && (
        <div class="filter-panel">
          <input ref={p.searchRef} class="search" type="search" placeholder={tr('Buscar', 'Search')} value={f.text} aria-label={tr('Buscar', 'Search')}
            onInput={(e) => set({ text: e.currentTarget.value })}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.currentTarget.blur(); if (!f.text) p.setOpen(false); } }} />
          <FilterGroup label={tr('Fecha', 'Date')}>
            {DATES().map(([d, l]) => (
              <Chip key={d} on={f.dates.includes(d)} warn={d === 'overdue' && p.counts.overdue > 0}
                onClick={() => set({ dates: toggleIn(f.dates, d), day: undefined })}>
                {l}{p.counts[d] > 0 && <sup>{p.counts[d]}</sup>}
              </Chip>
            ))}
            <span class="sep" />
            <Chip on={f.status === 'done'} onClick={() => set({ status: f.status === 'done' ? 'open' : 'done' })}>{tr('Hechas', 'Done')}</Chip>
          </FilterGroup>
          <FilterGroup label={tr('Prioridad', 'Priority')}>
            {([1, 2, 3] as Priority[]).map((n) => (
              <Chip key={n} on={f.priorities.includes(n)} onClick={() => set({ priorities: toggleIn(f.priorities, n) })}><PriorityName p={n} /></Chip>
            ))}
          </FilterGroup>
          {p.topics.length > 0 && <FilterGroup label={tr('Temas', 'Topics')} extra={editLink('topic')}>{entityChips('topic')}</FilterGroup>}
          {p.people.length > 0 && <FilterGroup label={tr('Personas', 'People')} extra={editLink('person')}>{entityChips('person')}</FilterGroup>}
          {p.saved.length > 0 && (
            <FilterGroup label={tr('Guardados', 'Saved')}>
              {p.saved.map((s) => (
                <span key={s.id} class="pair">
                  <Chip on={current?.id === s.id} onClick={() => setFilter(current?.id === s.id ? emptyFilter() : s.filter)}>{s.name}</Chip>
                  <button class="chip" aria-label={tr(`Borrar filtro ${s.name}`, `Delete filter ${s.name}`)} onClick={() => p.onDeleteSaved(s.id)}>×</button>
                </span>
              ))}
            </FilterGroup>
          )}
          {/* La pantalla de Hoy, al final: el panel es para filtrar y lo primero son los filtros. */}
          <div class="filter-week">{p.week}</div>
        </div>
      )}

      {active && (
        <div class="actions filter-summary">
          {naming ? (
            <>
              <input autoFocus placeholder={tr('Nombre del filtro', 'Filter name')} value={name} aria-label={tr('Nombre del filtro', 'Filter name')} maxLength={60}
                onInput={(e) => setName(e.currentTarget.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setNaming(false); }} />
              <button class="link on" onClick={save}>{tr('Guardar', 'Save')}</button>
            </>
          ) : (
            <>
              {!p.open && (
                <span class="filter-now">
                  {summary.map(([k, text, remove]) => (
                    <button key={k} class="chip on" aria-label={tr(`Quitar ${text}`, `Remove ${text}`)} onClick={remove}>{text} ×</button>
                  ))}
                </span>
              )}
              {p.open && !current && !f.day && <button class="link" onClick={() => setNaming(true)}>{tr('Guardar filtro', 'Save filter')}</button>}
              <button class="link" onClick={() => setFilter(emptyFilter())}>{tr('Quitar filtros', 'Clear filters')}</button>
            </>
          )}
        </div>
      )}
    </>
  );
}

function FilterGroup({ label, extra, children }: { label: string; extra?: preact.ComponentChildren; children: preact.ComponentChildren }) {
  return (
    <div class="filter-group">
      <span class="label filter-label">{label}{extra}</span>
      <div class="menu">{children}</div>
    </div>
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
