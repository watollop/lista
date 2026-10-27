import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { DateFilter, Entity, Filter, ID, ParsedLine, Priority, Repo, Sync } from '../types';
import { applyFilter, counts, emptyFilter, groupTasks, isEmptyFilter, toggleIn } from '../filters';
import { formatDue } from '../parser';
import { toISODate } from '../lib/date';
import { useData, useKeyboardInset, useSyncState, useToday, useWide } from './hooks';
import { Capture } from './Capture';
import { FilterBar } from './FilterBar';
import { Sidebar } from './Sidebar';
import { TaskList } from './TaskList';
import type { ChipTap } from './Chips';
import { Settings } from './Settings';
import { INTRO_KEY, Onboarding } from './Onboarding';

interface Toast { msg: string; action?: { label: string; run: () => void } }

const FILTER_KEY = 'lista.filter';
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
  const [settings, setSettings] = useState(false);
  const [intro, setIntro] = useState(() => { try { return !localStorage.getItem(INTRO_KEY); } catch { return false; } });
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
  const groups = useMemo(() => groupTasks(visible), [visible]);
  const flat = useMemo(() => groups.flatMap((g) => [g.task, ...g.children]), [groups]);
  const tally = useMemo(() => counts(data.tasks, today), [data.tasks, today]);


  // ---------- acciones ----------
  const add = async (lines: ParsedLine[]) => {
    // Subtareas desactivadas por ahora: toda línea es una tarea normal ('>' o indentación no anidan).
    const created = await repo.addParsed(lines.map((l) => ({ ...l, isSubtask: false })), null);
    if (created.length > 1) showToast(`${created.length} tareas añadidas`);
    else if (created[0] && !applyFilter([...data.tasks, created[0]], filter, today).some((t) => t.id === created[0].id)) {
      showToast({ msg: 'Añadida (oculta por el filtro)', action: { label: 'Ver todo', run: () => setFilter(emptyFilter()) } });
    }
  };

  const toggle = async (id: ID) => {
    const { task, spawned } = await repo.toggleDone(id);
    if (task.done) {
      showToast({
        msg: spawned?.due ? `Hecha · siguiente ${formatDue(spawned.due, today)}` : 'Hecha',
        action: { label: 'Deshacer', run: () => repo.toggleDone(id) },
      });
    }
  };

  const remove = async (id: ID) => {
    const idx = flat.findIndex((t) => t.id === id);
    await repo.deleteTask(id);
    setEditing(null);
    setSelected(flat[idx + 1]?.id ?? flat[idx - 1]?.id ?? null);
    showToast({ msg: 'Tarea borrada', action: { label: 'Deshacer', run: () => repo.restoreTask(id) } });
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
            <span class="label kbd-hint">⌘K escribir</span>
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
            filter={filter} setFilter={setFilter} saved={data.filters} topics={data.topics} people={data.people}
            names={names} counts={tally} open={panel} setOpen={setPanel} searchRef={searchRef}
            onSave={saveFilter} onDeleteSaved={(id) => repo.deleteFilter(id)}
          />
        )}
      </header>

      {wide && (
        <Sidebar
          filter={filter} setFilter={setFilter} tasks={data.tasks} saved={data.filters} topics={data.topics}
          people={data.people} counts={tally} searchRef={searchRef}
          onSave={saveFilter} onDeleteSaved={(id) => repo.deleteFilter(id)}
        />
      )}

      <Capture
        topics={data.topics} people={data.people} names={names} today={today} kbOpen={kbOpen}
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
            doneToday={doneToday}
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

      {settings && (
        <Settings repo={repo} sync={sync} state={syncState} onClose={() => setSettings(false)} toast={showToast}
          onIntro={() => { setSettings(false); setIntro(true); }} />
      )}
      {intro && (
        <Onboarding onClose={closeIntro}
          signIn={googleOk && syncState.status === 'signedOut' ? () => sync.signInWithGoogle() : undefined} />
      )}
    </div>
  );
}
