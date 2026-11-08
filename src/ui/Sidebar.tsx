import { useState } from 'preact/hooks';
import { MAIN_LIST, type DateFilter, type Entity, type EntityKind, type Filter, type ID, type ListScope, type Priority, type SavedFilter, type TodoList } from '../types';
import { emptyFilter, isEmptyFilter, toggleIn } from '../filters';
import { listDrop } from '../lib/reschedule';
import { sameFilter } from './FilterBar';
import { PriorityName } from './Priority';
import { EntityEditor } from './EntityEditor';
import { SEARCH_FROM, byUse } from './byUse';
import { fold } from '../lib/text';
import { tr } from '../i18n';

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
  week: preact.ComponentChildren; // pantalla de Hoy con los próximos 7 días
  searchRef: { current: HTMLInputElement | null };
  onSave: (name: string) => void;
  onDeleteSaved: (id: ID) => void;
  onRename: (kind: EntityKind, key: string, name: string) => void;
  onDelete: (kind: EntityKind, key: string) => void;
  // Listas (docs/plan-listas.md). Con una sola lista, la barra solo ofrece «+ Nueva lista» al final.
  lists: TodoList[];
  scope: ListScope; // lista actual, o 'all'
  listPending: Map<ID, number>; // pendientes por lista
  total: number; // pendientes de todas las listas
  onPickList: (scope: ListScope) => void;
  onCreateList: (name: string) => Promise<void>; // lanza Error si no se puede (se muestra en la barra)
  onRenameList: (id: ID, name: string) => Promise<void>;
  onDeleteList: (id: ID) => void; // la confirmación la gestiona App
}

const DATES = (): Array<[DateFilter, string]> => [
  ['today', tr('Hoy', 'Today')], ['week', tr('Semana', 'Week')], ['month', tr('Mes', 'Month')],
  ['overdue', tr('Vencidas', 'Overdue')], ['nodate', tr('Sin fecha', 'No date')],
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
    <aside class="side" aria-label={tr('Filtros', 'Filters')}>
      {p.lists.length > 1 && (
        <section class="side-group side-lists">
          <h3 class="label">{tr('Listas', 'Lists')}</h3>
          <ul class="side-list">
            {p.lists.map((l) => (
              <ListEntry key={l.id} list={l} on={p.scope === l.id} count={p.listPending.get(l.id)}
                onPick={() => p.onPickList(l.id)} onRename={p.onRenameList} onDelete={p.onDeleteList} />
            ))}
            <Item on={p.scope === 'all'} count={p.total} onClick={() => p.onPickList('all')}>{tr('Todas las listas', 'All lists')}</Item>
            <NewListItem onCreate={p.onCreateList} />
          </ul>
        </section>
      )}
      {p.week}
      <input ref={p.searchRef} class="side-search" type="search" placeholder={tr('Buscar', 'Search')} value={f.text} aria-label={tr('Buscar', 'Search')}
        onInput={(e) => set({ text: e.currentTarget.value })}
        onKeyDown={(e) => { if (e.key === 'Escape') e.currentTarget.blur(); }} />

      <ul class="side-list">
        <Item on={isEmptyFilter(f)} count={p.counts.open} onClick={() => setFilter(emptyFilter())}>{tr('Todas', 'All')}</Item>
      </ul>

      <Group title={tr('Fecha', 'Date')}>
        {DATES().map(([d, l]) => (
          <Item key={d} on={f.dates.includes(d)} count={p.counts[d]} warn={d === 'overdue' && p.counts.overdue > 0}
            drop={d === 'today' ? 'today' : d === 'week' ? 'week' : d === 'nodate' ? 'nodate' : undefined}
            onClick={() => set({ dates: toggleIn(f.dates, d), day: undefined })}>{l}</Item>
        ))}
        <Item on={f.status === 'done'} onClick={() => set({ status: f.status === 'done' ? 'open' : 'done' })}>{tr('Hechas', 'Done')}</Item>
      </Group>

      <Group title={tr('Prioridad', 'Priority')}>
        {([1, 2, 3] as Priority[]).map((n) => (
          <Item key={n} on={f.priorities.includes(n)} count={p.pending.get('!' + n)}
            onClick={() => set({ priorities: toggleIn(f.priorities, n) })}><PriorityName p={n} /></Item>
        ))}
      </Group>

      {p.topics.length > 0 && (
        <EntityGroup title={tr('Temas', 'Topics')} kind="topic" items={p.topics} all={p.allTopics} pending={p.pending}
          selected={f.topics} onToggle={(k) => set({ topics: toggleIn(f.topics, k) })}
          onRename={p.onRename} onDelete={p.onDelete} />
      )}

      {p.people.length > 0 && (
        <EntityGroup title={tr('Personas', 'People')} kind="person" items={p.people} all={p.allPeople} pending={p.pending}
          selected={f.people} onToggle={(k) => set({ people: toggleIn(f.people, k) })}
          onRename={p.onRename} onDelete={p.onDelete} />
      )}

      {(p.saved.length > 0 || (!isEmptyFilter(f) && !current && !f.day)) && (
        <Group title={tr('Guardados', 'Saved')}>
          {p.saved.map((s, i) => (
            <li key={s.id} class="side-pair">
              <button class={`side-item ${current?.id === s.id ? 'on' : ''}`} aria-pressed={current?.id === s.id}
                onClick={() => setFilter(current?.id === s.id ? emptyFilter() : s.filter)}>
                <span>{s.name}</span>{i < 9 && <kbd>{i + 1}</kbd>}
              </button>
              <button class="side-x" aria-label={tr(`Borrar filtro ${s.name}`, `Delete filter ${s.name}`)} onClick={() => p.onDeleteSaved(s.id)}>×</button>
            </li>
          ))}
          {!isEmptyFilter(f) && !current && !f.day && ( /* un día concreto no se guarda: mañana ya no sería el mismo */
            <li>
              {naming ? (
                <input autoFocus class="side-search" placeholder={tr('Nombre del filtro', 'Filter name')} value={name} aria-label={tr('Nombre del filtro', 'Filter name')}
                  onInput={(e) => setName(e.currentTarget.value)} onBlur={save}
                  onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setNaming(false); }} />
              ) : (
                <button class="side-item side-add" onClick={() => setNaming(true)}>{tr('+ Guardar filtro actual', '+ Save current filter')}</button>
              )}
            </li>
          )}
        </Group>
      )}

      {p.lists.length <= 1 && (
        <section class="side-group">
          <ul class="side-list"><NewListItem onCreate={p.onCreateList} /></ul>
        </section>
      )}
    </aside>
  );
}

/** Una lista en la barra: lápiz (renombrar en línea) y papelera (no en la principal) al pasar el ratón; soltar tareas aquí las mueve. */
function ListEntry({ list, on, count, onPick, onRename, onDelete }: {
  list: TodoList; on: boolean; count?: number; onPick: () => void;
  onRename: (id: ID, name: string) => Promise<void>; onDelete: (id: ID) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(list.name);
  const [err, setErr] = useState('');
  const isMain = list.id === MAIN_LIST;
  const startEdit = () => { setName(list.name); setErr(''); setEditing(true); };
  const cancel = () => { setEditing(false); setErr(''); };
  const save = () => {
    const n = name.trim();
    if (!n || n === list.name) { cancel(); return; }
    onRename(list.id, n).then(() => cancel(), (e: unknown) => setErr(e instanceof Error ? e.message : tr('No se pudo renombrar la lista.', 'Couldn’t rename the list.')));
  };

  if (editing) {
    return (
      <li class="side-ent">
        <input autoFocus class="side-search side-filter" value={name} aria-label={tr('Nombre de la lista', 'List name')}
          onInput={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); save(); }
            if (e.key === 'Escape') { e.stopPropagation(); cancel(); }
          }} />
        {err && <p class="side-err" role="alert">{err}</p>}
      </li>
    );
  }

  return (
    <li class="side-ent" data-drop={listDrop(list.id)}>
      {/* detail > 1: el segundo clic del doble clic no vuelve a elegir la lista; el doble clic abre la edición. */}
      <button class={`side-item ${on ? 'on' : ''}`} aria-pressed={on}
        onClick={(e) => { if (e.detail < 2) onPick(); }} onDblClick={startEdit}>
        <span>{list.name}</span>
        {count ? <span class="side-count">{count}</span> : null}
      </button>
      <span class="side-acts">
        <button class="side-act" aria-label={tr(`Editar ${list.name}`, `Edit ${list.name}`)} title={tr('Editar', 'Edit')} onClick={startEdit}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">
            <path d="M3 13l.6-2.6 7.4-7.4 2 2-7.4 7.4z" /><path d="M9.5 4.5l2 2" />
          </svg>
        </button>
        {!isMain && (
          <button class="side-act del" aria-label={tr(`Borrar ${list.name}`, `Delete ${list.name}`)} title={tr('Borrar', 'Delete')} onClick={() => onDelete(list.id)}>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">
              <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
            </svg>
          </button>
        )}
      </span>
    </li>
  );
}

/** «+ Nueva lista» en línea, como «+ Guardar filtro actual». Enter crea; Esc o dejarlo vacío lo cancela. */
function NewListItem({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const cancel = () => { setNaming(false); setName(''); setErr(''); };
  const create = () => {
    const n = name.trim();
    if (!n) { cancel(); return; }
    onCreate(n).then(() => cancel(), (e: unknown) => setErr(e instanceof Error ? e.message : tr('No se pudo crear la lista.', 'Couldn’t create the list.')));
  };

  if (!naming) {
    return <li><button class="side-item side-add" onClick={() => setNaming(true)}>{tr('+ Nueva lista', '+ New list')}</button></li>;
  }
  return (
    <li>
      <input autoFocus class="side-search" placeholder={tr('Nombre de la lista', 'List name')} value={name} aria-label={tr('Nombre de la lista nueva', 'New list name')}
        onInput={(e) => setName(e.currentTarget.value)}
        onBlur={() => { if (!name.trim()) cancel(); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); create(); }
          if (e.key === 'Escape') { e.stopPropagation(); cancel(); }
        }} />
      {err && <p class="side-err" role="alert">{err}</p>}
    </li>
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
            aria-label={tr(`Buscar ${title.toLowerCase()}`, `Search ${title.toLowerCase()}`)} onInput={(e) => setQ(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setQ(''); e.currentTarget.blur(); } }} />
        </li>
      )}
      {shown.map((t) => (
        <EntityItem key={t.key} kind={kind} ent={t} all={all} pending={pending} on={selected.includes(t.key)}
          onToggle={() => onToggle(t.key)} onRename={onRename} onDelete={onDelete} />
      ))}
      {open && q && !shown.length && <li class="side-empty">{tr('Sin resultados', 'No results')}</li>}
      {foldable && (
        <li>
          <button class="side-item side-more" aria-expanded={open} onClick={toggle}>
            {open ? tr('Ver menos', 'Show less') : tr(`Ver todos (${items.length})`, `Show all (${items.length})`)}
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
        <button class="side-act" aria-label={tr(`Editar ${sym}${ent.name}`, `Edit ${sym}${ent.name}`)} title={tr('Editar', 'Edit')} onClick={() => setEditing(true)}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">
            <path d="M3 13l.6-2.6 7.4-7.4 2 2-7.4 7.4z" /><path d="M9.5 4.5l2 2" />
          </svg>
        </button>
        <button class="side-act del" aria-label={tr(`Borrar ${sym}${ent.name}`, `Delete ${sym}${ent.name}`)} title={tr('Borrar', 'Delete')} onClick={() => onDelete(kind, ent.key)}>
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
