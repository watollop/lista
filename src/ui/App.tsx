import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { DateFilter, Entity, EntityKind, Filter, ID, ParsedLine, Priority, Repo, Sync } from '../types';
import { applyFilter, counts, emptyFilter, groupTasks, isEmptyFilter, toggleIn } from '../filters';
import { formatDue, parseBlock } from '../parser';
import { toISODate } from '../lib/date';
import { externalCapture, validateCapture } from '../lib/capture';
import { DROP_LABEL, scheduleFor, type DropTarget } from '../lib/reschedule';
import { useData, useKeyboardInset, useSyncState, useToday, useWide } from './hooks';
import { Capture } from './Capture';
import { FilterBar } from './FilterBar';
import { Sidebar } from './Sidebar';
import { TaskList } from './TaskList';
import type { ChipTap } from './Chips';
import { EntityEditor } from './EntityEditor';
import { Settings } from './Settings';
import { INTRO_KEY, Onboarding } from './Onboarding';

interface Toast { msg: string; action?: { label: string; run: () => void } }

const FILTER_KEY = 'lista.filter';
const PAST_DAYS = 30;
const loadFilter = (): Filter => {
  try { return { ...emptyFilter(), ...JSON.parse(localStorage.getItem(FILTER_KEY) || '{}') }; } catch { return emptyFilter(); }
};

export function App({ repo, sync }: { repo: Repo; sync: Sync }) {
  const data = useData(repo);
  const today = useToday();
  const syncState = useSyncState(sync);
  const kbOpen = useKeyboardInset();
  const wide = useWide();

  const [filter, setFilterRaw] = useState<Filter>(loadFilter);
  const [panel, setPanel] = useState(false);
  const [selected, setSelected] = useState<ID | null>(null);
  const [editing, setEditing] = useState<ID | null>(null);
  const [sheetEnt, setSheetEnt] = useState<{ kind: EntityKind; key: string } | null>(null); // editor de tema/persona en móvil
  const [settings, setSettings] = useState(false);
  // 'first': primera vez; 'full': abierta desde Ajustes (mismas slides, el último botón dice «Listo»).
  const [intro, setIntro] = useState<false | 'first' | 'full'>(() => { try { return localStorage.getItem(INTRO_KEY) ? false : 'first'; } catch { return false; } });
  const [googleOk, setGoogleOk] = useState(false);
  useEffect(() => { if (intro && syncState.status === 'signedOut') sync.googleEnabled().then(setGoogleOk); }, [intro, syncState.status]);
  const closeIntro = () => {
    setIntro(false);
    try { localStorage.setItem(INTRO_KEY, '1'); } catch { /* modo privado */ }
  };
  const [toast, setToast] = useState<Toast | null>(null);

  const captureRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const setFilter = (f: Filter) => {
    setFilterRaw(f);
    try { localStorage.setItem(FILTER_KEY, JSON.stringify(f)); } catch { /* modo privado */ }
  };

  const showToast = (t: Toast | string) => {
    clearTimeout(toastTimer.current);
    setToast(typeof t === 'string' ? { msg: t } : t);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };

  const names = useMemo(() => {
    const m = new Map<string, Entity>();
    data.topics.forEach((e) => m.set('#' + e.key, e));
    data.people.forEach((e) => m.set('@' + e.key, e));
    return m;
  }, [data.topics, data.people]);

  // Tareas pendientes por etiqueta ('#clave', '@clave', '!prioridad').
  const pending = useMemo(() => {
    const m = new Map<string, number>();
    const inc = (k: string) => m.set(k, (m.get(k) ?? 0) + 1);
    for (const t of data.tasks) {
      if (t.deleted || t.done) continue;
      t.topics.forEach((k) => inc('#' + k));
      t.people.forEach((k) => inc('@' + k));
      if (t.priority) inc('!' + t.priority);
    }
    return m;
  }, [data.tasks]);

  // Lo que se muestra en filtros y captura: solo con pendientes, o los que el filtro activo usa (para no perderlos).
  const shownTopics = useMemo(() => data.topics.filter((e) => pending.has('#' + e.key) || filter.topics.includes(e.key)),
    [data.topics, pending, filter.topics]);
  const shownPeople = useMemo(() => data.people.filter((e) => pending.has('@' + e.key) || filter.people.includes(e.key)),
    [data.people, pending, filter.people]);

  // Completadas hoy: siguen visibles (tachadas, en su sitio) hasta que cambia el día.
  const doneToday = useMemo(() => new Set(data.tasks
    .filter((t) => t.done && t.doneAt && toISODate(new Date(t.doneAt)) === today)
    .map((t) => t.id)), [data.tasks, today]);

  const visible = useMemo(() => {
    const shown = applyFilter(data.tasks, filter, today);
    if (doneToday.size && filter.status === 'open') {
      const ids = new Set(shown.map((t) => t.id));
      const extra = data.tasks.filter((t) => doneToday.has(t.id) && !ids.has(t.id));
      // Mantener su posición: se ordenan como si siguieran abiertas.
      return applyFilter(
        data.tasks.map((t) => (extra.includes(t) ? { ...t, done: 0 as const } : t)),
        filter, today,
      ).map((t) => (doneToday.has(t.id) ? data.tasks.find((x) => x.id === t.id)! : t));
    }
    return shown;
  }, [data.tasks, filter, today, doneToday]);

  // Pasadas: completadas antes de hoy (últimos PAST_DAYS días), arriba de la lista y fuera de la vista inicial.
  const past = useMemo(() => {
    if (filter.status !== 'open') return [];
    const since = Date.now() - PAST_DAYS * 864e5;
    return applyFilter(data.tasks, { ...filter, status: 'done' }, today)
      .filter((t) => !doneToday.has(t.id) && (t.doneAt ?? 0) >= since)
      .sort((a, b) => (a.doneAt ?? 0) - (b.doneAt ?? 0));
  }, [data.tasks, filter, today, doneToday]);
  const groups = useMemo(() => {
    const matched = [...new Map([...past, ...visible].map((t) => [t.id, t])).values()];
    const families = groupTasks(data.tasks);
    const children = new Map(families.map((g) => [g.task.id, g.children]));
    return groupTasks(matched).map((g) => ({ ...g, children: children.get(g.task.id) ?? g.children }));
  }, [past, visible, data.tasks]);
  const flat = useMemo(() => groups.flatMap((g) => [g.task, ...g.children]), [groups]);
  const tally = useMemo(() => counts(data.tasks, today), [data.tasks, today]);


  // ---------- acciones ----------
  const add = async (lines: ParsedLine[]) => {
    const created = await repo.addParsed(lines, null);
    if (created.length > 1) showToast(`${created.length} tareas añadidas`);
    else if (created[0] && !applyFilter([...data.tasks, created[0]], filter, today).some((t) => t.id === created[0].id)) {
      showToast({ msg: 'Añadida (oculta por el filtro)', action: { label: 'Ver todo', run: () => setFilter(emptyFilter()) } });
    }
  };

  // Tarea que llega desde fuera (?nueva=… de un Atajo/Siri, o «Compartir con Lista»): se apunta una vez
  // y se limpia la URL para que recargar no la duplique.
  useEffect(() => {
    const text = externalCapture(location.search);
    if (!text) return;
    (async () => {
      const created = await repo.addParsed(validateCapture(parseBlock(text)), null);
      history.replaceState(null, '', location.pathname + location.hash);
      if (!created.length) return;
      showToast({
        msg: created.length > 1 ? `${created.length} tareas apuntadas` : `Apuntada: ${created[0].title}`,
        action: { label: 'Deshacer', run: () => { for (const t of created) void repo.deleteTask(t.id); } },
      });
    })().catch((e) => showToast(e instanceof Error ? e.message : 'No se pudieron añadir las tareas.'));
  }, []);

  const toggle = async (id: ID) => {
    try {
      const { task, spawned, undo } = await repo.toggleDone(id);
      if (task.done && undo) {
        showToast({
          msg: spawned?.due ? `Hecha · siguiente ${formatDue(spawned.due, today)}` : 'Hecha',
          action: { label: 'Deshacer', run: () => {
            void undo().catch((e) => showToast(e instanceof Error ? e.message : 'No se pudo deshacer la tarea.'));
          } },
        });
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo cambiar la tarea.');
    }
  };

  const addSubtasks = async (id: ID, lines: ParsedLine[]) => {
    await repo.addParsed(lines.map((l) => ({ ...l, isSubtask: true })), id);
  };

  const remove = async (id: ID) => {
    const idx = flat.findIndex((t) => t.id === id);
    await repo.deleteTask(id);
    setEditing(null);
    setSelected(flat[idx + 1]?.id ?? flat[idx - 1]?.id ?? null);
    showToast({ msg: 'Tarea borrada', action: { label: 'Deshacer', run: () => repo.restoreTask(id) } });
  };

  // Tarea arrastrada a otro bloque (Hoy, Mañana, Esta semana, Próximas, Sin fecha): cambia su fecha.
  const move = async (id: ID, target: DropTarget) => {
    const t = data.tasks.find((x) => x.id === id);
    if (!t) return;
    const next = scheduleFor(target, today);
    if (next.due === t.due && (next.period ?? null) === (t.period ?? null)) return;
    const before = { due: t.due, period: t.period ?? null };
    await repo.updateTask(id, next);
    showToast({ msg: `Movida a ${DROP_LABEL[target]}`, action: { label: 'Deshacer', run: () => repo.updateTask(id, before) } });
  };

  const save = async (id: ID, line: ParsedLine) => {
    setEditing(null);
    await repo.replaceParsed(id, line);
  };

  const chipTap: ChipTap = (type, key) => {
    if (type === 'topic') setFilter({ ...filter, topics: toggleIn(filter.topics, key as string) });
    if (type === 'person') setFilter({ ...filter, people: toggleIn(filter.people, key as string) });
    if (type === 'priority') setFilter({ ...filter, priorities: toggleIn(filter.priorities, key as Priority) });
    if (type === 'date') setFilter({ ...filter, dates: toggleIn(filter.dates, key as DateFilter) });
  };

  // ---------- temas y personas ----------
  const sigil = (kind: EntityKind) => (kind === 'topic' ? '#' : '@');
  const listOf = (kind: EntityKind) => (kind === 'topic' ? data.topics : data.people);
  // Aplica fn a las claves del filtro de ese tipo (solo si la entidad está en él).
  const patchEntityKeys = (kind: EntityKind, key: string, fn: (keys: string[]) => string[]) => {
    const inFilter = kind === 'topic' ? filter.topics : filter.people;
    if (!inFilter.includes(key)) return;
    setFilter(kind === 'topic' ? { ...filter, topics: fn(filter.topics) } : { ...filter, people: fn(filter.people) });
  };

  const renameEntity = async (kind: EntityKind, key: string, newName: string) => {
    try {
      const r = await repo.renameEntity(kind, key, newName);
      if (r.key !== key) patchEntityKeys(kind, key, (keys) => [...new Set(keys.map((k) => (k === key ? r.key : k)))]);
      if (r.merged) {
        const target = listOf(kind).find((e) => e.key === r.key);
        showToast(`Unido con ${sigil(kind)}${target?.name ?? newName}`);
      } else {
        showToast(`Renombrado a ${sigil(kind)}${newName}`);
      }
    } catch (e) {
      showToast((e as Error).message || 'No se pudo renombrar');
    }
  };

  const deleteEntity = async (kind: EntityKind, key: string) => {
    const name = listOf(kind).find((e) => e.key === key)?.name ?? key;
    try {
      const { undo } = await repo.deleteEntity(kind, key);
      patchEntityKeys(kind, key, (keys) => keys.filter((k) => k !== key));
      showToast({
        msg: `${sigil(kind)}${name} borrado`,
        action: {
          label: 'Deshacer',
          run: () => { undo().catch((e: Error) => showToast(e.message || 'No se pudo deshacer')); },
        },
      });
    } catch (e) {
      showToast((e as Error).message || 'No se pudo borrar');
    }
  };

  const saveFilter = async (name: string) => {
    await repo.saveFilter(name, filter);
    setPanel(false);
    showToast(`Filtro «${name}» guardado`);
  };

  // ---------- teclado (escritorio) ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
      if (intro) return; // la bienvenida gestiona su propio teclado
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        captureRef.current?.focus();
        return;
      }
      if (typing || settings || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.key === 'Enter' || e.key === ' ') && el.closest?.('button, a')) return;
      const i = flat.findIndex((t) => t.id === selected);
      const go = (n: number) => {
        if (!flat.length) return;
        const next = i < 0 ? (n > 0 ? 0 : flat.length - 1) : Math.max(0, Math.min(flat.length - 1, i + n));
        setSelected(flat[next].id);
      };
      const key = e.key;
      const run = (fn: () => void) => { e.preventDefault(); fn(); };
      if (key === '/' || key === 'n') run(() => captureRef.current?.focus());
      else if (key === 'j' || key === 'ArrowDown') run(() => go(1));
      else if (key === 'k' || key === 'ArrowUp') run(() => go(-1));
      else if ((key === 'x' || key === ' ') && selected) run(() => toggle(selected));
      else if ((key === 'e' || key === 'Enter') && selected) run(() => setEditing(selected));
      else if ((key === 'Backspace' || key === 'Delete') && selected) run(() => remove(selected));
      else if (key === 'h') run(() => setFilter({ ...emptyFilter(), dates: ['today'] }));
      else if (key === 's') run(() => setFilter({ ...emptyFilter(), dates: ['week'] }));
      else if (key === 'v') run(() => setFilter({ ...emptyFilter(), dates: ['overdue'] }));
      else if (key === 'f') run(() => { if (!wide) setPanel(true); setTimeout(() => searchRef.current?.focus(), 0); });
      else if (/^[1-9]$/.test(key) && data.filters[+key - 1]) run(() => setFilter(data.filters[+key - 1].filter));
      else if (key === 'Escape') run(() => {
        if (selected) setSelected(null);
        else if (panel) setPanel(false);
        else setFilter(emptyFilter());
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const syncDot = syncState.status === 'error' || syncState.status === 'offline' ? ' ·' : '';

  return (
    <div class={`app ${wide ? 'wide' : ''}`} onClick={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
      <header class="top">
        <div class="bar">
          <span class="brand">Lista</span>
          <span class="bar-right">
            {!wide && (
              <button class={`link ${panel ? 'on' : ''}`} aria-expanded={panel}
                onClick={() => { const next = !panel; setPanel(next); if (next) setTimeout(() => searchRef.current?.focus(), 0); }}>
                Buscar
              </button>
            )}
            <button class="link" onClick={() => setSettings(true)} aria-label="Ajustes">Ajustes{syncDot}</button>
          </span>
        </div>
        {!wide && (
          <FilterBar
            filter={filter} setFilter={setFilter} saved={data.filters} topics={shownTopics} people={shownPeople}
            names={names} pending={pending} counts={tally} open={panel} setOpen={setPanel} searchRef={searchRef}
            onSave={saveFilter} onDeleteSaved={(id) => repo.deleteFilter(id)}
            onEditEntity={(kind, key) => setSheetEnt({ kind, key })} onDeleteEntity={deleteEntity}
          />
        )}
      </header>

      {wide && (
        <Sidebar
          filter={filter} setFilter={setFilter} saved={data.filters} topics={shownTopics}
          people={shownPeople} allTopics={data.topics} allPeople={data.people} pending={pending}
          counts={tally} searchRef={searchRef} onSave={saveFilter} onDeleteSaved={(id) => repo.deleteFilter(id)}
          onRename={renameEntity} onDelete={deleteEntity}
        />
      )}

      <Capture
        topics={shownTopics} people={shownPeople} names={names} today={today} kbOpen={kbOpen}
        inputRef={captureRef} onAdd={add}
      />

      <main>
        {data.ready && groups.length === 0 ? (
          <div class="empty">
            {isEmptyFilter(filter) ? (
              <><p>Nada pendiente.</p><p class="label">Escribe una tarea para empezar</p></>
            ) : (
              <><p>Sin resultados.</p><button class="link" onClick={() => setFilter(emptyFilter())}>Quitar filtros</button></>
            )}
          </div>
        ) : (
          <TaskList
            groups={groups} names={names} today={today} selected={selected} editing={editing}
            onSelect={setSelected} onEdit={setEditing} onToggle={toggle} onSave={save} onDelete={remove} onChip={chipTap}
            doneToday={doneToday} pastMode={filter.status === 'open'} anchorKey={JSON.stringify(filter)} onMove={move}
            onAddSubtasks={addSubtasks}
          />
        )}
      </main>

      {toast && (
        <div class="toast" role="status">
          <span>{toast.msg}</span>
          {toast.action && (
            <button class="link" onClick={() => { toast.action!.run(); setToast(null); }}>{toast.action.label}</button>
          )}
        </div>
      )}

      {sheetEnt && !settings && (() => {
        const ent = listOf(sheetEnt.kind).find((e) => e.key === sheetEnt.key);
        if (!ent) return null;
        return (
          <EntityEditor kind={sheetEnt.kind} entity={ent} entities={listOf(sheetEnt.kind)} pending={pending}
            variant="sheet" onCancel={() => setSheetEnt(null)}
            onSave={(name) => { setSheetEnt(null); renameEntity(sheetEnt.kind, sheetEnt.key, name); }}
            onDelete={() => { setSheetEnt(null); deleteEntity(sheetEnt.kind, sheetEnt.key); }} />
        );
      })()}

      {settings && (
        <Settings repo={repo} sync={sync} state={syncState} onClose={() => setSettings(false)} toast={showToast}
          topics={data.topics} people={data.people} pending={pending}
          onRename={renameEntity} onDelete={deleteEntity}
          onIntro={() => { setSettings(false); setIntro('full'); }} />
      )}
      {intro && (
        <Onboarding onClose={closeIntro} extended={intro === 'full'}
          signIn={googleOk && syncState.status === 'signedOut' ? () => sync.signInWithGoogle() : undefined} />
      )}
    </div>
  );
}
