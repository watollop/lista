import { useState } from 'preact/hooks';
import type { DateFilter, Entity, EntityKind, Filter, ID, Priority, SavedFilter } from '../types';
import { emptyFilter, isEmptyFilter, toggleIn } from '../filters';
import { sameFilter } from './FilterBar';
import { PriorityName } from './Priority';
import { EntityEditor } from './EntityEditor';
import { SEARCH_FROM, byUse } from './byUse';
import { fold } from '../lib/text';

interface Props {
  filter: Filter;
  setFilter: (f: Filter) => void;
  saved: SavedFilter[];
  topics: Entity[]; // solo los que tienen pendientes o están en el filtro
  people: Entity[];
  allTopics: Entity[]; // todos: para detectar fusiones al editar
  allPeople: Entity[];
  pending: Map<string, number>; // '#clave' | '@clave' | '!prioridad' -> pendientes
  counts: Record<DateFilter | 'open', number>;
  searchRef: { current: HTMLInputElement | null };
  onSave: (name: string) => void;
  onDeleteSaved: (id: ID) => void;
  onRename: (kind: EntityKind, key: string, name: string) => void;
  onDelete: (kind: EntityKind, key: string) => void;
}

const DATES: Array<[DateFilter, string]> = [
  ['today', 'Hoy'], ['week', 'Semana'], ['month', 'Mes'],
  ['overdue', 'Vencidas'], ['nodate', 'Sin fecha'],
];

/** Pantallas anchas: todos los filtros a la vista, con recuento de pendientes. Misma lógica que FilterBar. */
export function Sidebar(p: Props) {
  const { filter: f, setFilter } = p;
  const set = (patch: Partial<Filter>) => setFilter({ ...f, ...patch });
  const current = p.saved.find((s) => sameFilter(f, s.filter));
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

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
            drop={d === 'today' ? 'today' : d === 'week' ? 'week' : d === 'nodate' ? 'nodate' : undefined}
            onClick={() => set({ dates: toggleIn(f.dates, d) })}>{l}</Item>
        ))}
        <Item on={f.status === 'done'} onClick={() => set({ status: f.status === 'done' ? 'open' : 'done' })}>Hechas</Item>
      </Group>

      <Group title="Prioridad">
        {([1, 2, 3] as Priority[]).map((n) => (
          <Item key={n} on={f.priorities.includes(n)} count={p.pending.get('!' + n)}
            onClick={() => set({ priorities: toggleIn(f.priorities, n) })}><PriorityName p={n} /></Item>
        ))}
      </Group>

      {p.topics.length > 0 && (
        <EntityGroup title="Temas" kind="topic" items={p.topics} all={p.allTopics} pending={p.pending}
          selected={f.topics} onToggle={(k) => set({ topics: toggleIn(f.topics, k) })}
          onRename={p.onRename} onDelete={p.onDelete} />
      )}

      {p.people.length > 0 && (
        <EntityGroup title="Personas" kind="person" items={p.people} all={p.allPeople} pending={p.pending}
          selected={f.people} onToggle={(k) => set({ people: toggleIn(f.people, k) })}
          onRename={p.onRename} onDelete={p.onDelete} />
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

const TOP = 5; // plegado: los seleccionados y los TOP más usados

/** Temas o personas: plegado muestra los seleccionados y los más usados; «Ver todos» despliega la lista con búsqueda. */
function EntityGroup({ title, kind, items, all, pending, selected, onToggle, onRename, onDelete }: {
  title: string; kind: EntityKind; items: Entity[]; all: Entity[]; pending: Map<string, number>; selected: string[];
  onToggle: (key: string) => void; onRename: (kind: EntityKind, key: string, name: string) => void;
  onDelete: (kind: EntityKind, key: string) => void;
}) {
  const store = `lista.side.${kind}`;
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(store) === '1'; } catch { return false; } });
  const [q, setQ] = useState('');
  const toggle = () => {
    const next = !open;
    setOpen(next);
    setQ('');
    try { localStorage.setItem(store, next ? '1' : '0'); } catch { /* modo privado */ }
  };
  const sorted = byUse(items, kind === 'topic' ? '#' : '@', pending);
  const shown = open
    ? sorted.filter((e) => !q || fold(e.name).includes(fold(q)))
    : [...sorted.filter((e) => selected.includes(e.key)), ...sorted.filter((e) => !selected.includes(e.key)).slice(0, TOP)];
  const foldable = items.length > TOP;

  return (
    <Group title={title}>
      {open && items.length > SEARCH_FROM && (
        <li>
          <input class="side-search side-filter" type="search" placeholder={`Buscar ${title.toLowerCase()}`} value={q}
            aria-label={`Buscar ${title.toLowerCase()}`} onInput={(e) => setQ(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setQ(''); e.currentTarget.blur(); } }} />
        </li>
      )}
      {shown.map((t) => (
        <EntityItem key={t.key} kind={kind} ent={t} all={all} pending={pending} on={selected.includes(t.key)}
          onToggle={() => onToggle(t.key)} onRename={onRename} onDelete={onDelete} />
      ))}
      {open && q && !shown.length && <li class="side-empty">Sin resultados</li>}
      {foldable && (
        <li>
          <button class="side-item side-more" aria-expanded={open} onClick={toggle}>
            {open ? 'Ver menos' : `Ver todos (${items.length})`}
          </button>
        </li>
      )}
    </Group>
  );
}

/** Tema o persona en la barra: al pasar el ratón, lápiz (editar) y papelera (borrar). Doble clic en el nombre también edita. */
function EntityItem({ kind, ent, all, pending, on, onToggle, onRename, onDelete }: {
  kind: EntityKind; ent: Entity; all: Entity[]; pending: Map<string, number>; on: boolean;
  onToggle: () => void;
  onRename: (kind: EntityKind, key: string, name: string) => void;
  onDelete: (kind: EntityKind, key: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const sym = kind === 'topic' ? '#' : '@';
  const count = pending.get(sym + ent.key);

  if (editing) {
    return (
      <li class="side-ent">
        <EntityEditor kind={kind} entity={ent} entities={all} pending={pending} variant="inline"
          onSave={(n) => { setEditing(false); onRename(kind, ent.key, n); }}
          onCancel={() => setEditing(false)} />
      </li>
    );
  }

  return (
    <li class="side-ent">
      {/* detail > 1: el segundo clic del doble clic no vuelve a filtrar; el doble clic abre la edición. */}
      <button class={`side-item ${on ? 'on' : ''}`} aria-pressed={on}
        onClick={(e) => { if (e.detail < 2) onToggle(); }} onDblClick={() => setEditing(true)}>
        <span>{sym}{ent.name}</span>
        {count ? <span class="side-count">{count}</span> : null}
      </button>
      <span class="side-acts">
        <button class="side-act" aria-label={`Editar ${sym}${ent.name}`} title="Editar" onClick={() => setEditing(true)}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">
            <path d="M3 13l.6-2.6 7.4-7.4 2 2-7.4 7.4z" /><path d="M9.5 4.5l2 2" />
          </svg>
        </button>
        <button class="side-act del" aria-label={`Borrar ${sym}${ent.name}`} title="Borrar" onClick={() => onDelete(kind, ent.key)}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">
            <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
          </svg>
        </button>
      </span>
    </li>
  );
}

function Item({ on, count, warn, drop, onClick, children }:
  { on: boolean; count?: number; warn?: boolean; drop?: string; onClick: () => void; children: preact.ComponentChildren }) {
  // drop: también se puede soltar ahí una tarea arrastrada desde la lista (Hoy, Semana, Sin fecha).
  return (
    <li data-drop={drop}>
      <button class={`side-item ${on ? 'on' : ''} ${warn ? 'warn' : ''}`} aria-pressed={on} onClick={onClick}>
        <span>{children}</span>
        {count ? <span class="side-count">{count}</span> : null}
      </button>
    </li>
  );
}
