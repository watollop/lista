import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { MAIN_LIST, type DateFilter, type Entity, type EntityKind, type Filter, type ID, type ListScope, type ParsedLine, type Priority, type Repo, type Sync, type Task } from '../types';
import { applyFilter, counts, dayLoad, emptyFilter, groupTasks, isEmptyFilter, toggleIn } from '../filters';
import { formatDue, parseBlock, setKnownLists } from '../parser';
import { toISODate } from '../lib/date';
import { externalCapture, validateCapture } from '../lib/capture';
import { dropLabel, listOfDrop, scheduleFor, type DropTarget, type ListDrop } from '../lib/reschedule';
import { useData, useKeyboardInset, useSyncState, useToday, useWide } from './hooks';
import { Capture } from './Capture';
import { FilterBar } from './FilterBar';
import { Sidebar } from './Sidebar';
import { TaskList } from './TaskList';
import type { ChipTap } from './Chips';
import { EntityEditor } from './EntityEditor';
import { UPDATE_READY_EVENT } from '../pwa/register';
import { Critter } from './Critter';
import { INTRO_KEY } from './intro';
import { startAppearanceSync } from './appearanceSync';
import { startLangSync } from './langSync';
import { LazyJoinDialog, LazyLinkDialog, LazyLockedPanel, LazyOnboarding, LazySettings, LazyShareDialog, LazyShortcutsSheet, preloadViews } from './lazyViews';
import { whenIdle } from './lazy';
import { Week } from './Week';
import { byUse } from './byUse';
import { tr } from '../i18n';
import { ConfirmDialog, ListSheet } from './Lists';
import { ListTabs } from './ListTabs';
import { NewsSheet } from './WhatsNew';
import { markAllNewsSeen, unseenNews, type NewsItem } from './news';
import { inScope, listName, loadScope, resolveScope, saveScope } from './listScope';
import { captureJoinLink, clearPendingJoin, pendingJoin } from './sharing';

interface Toast { msg: string; action?: { label: string; run: () => void } }
// Hoja de listas: 'pick' cambia de lista; 'move' elige destino para la tarea del editor.
type ListSheetState = { taskId: ID }; // hoja «Mover a…» de una tarea

const FILTER_KEY = 'lista.filter';
const PAST_DAYS = 30;
const loadFilter = (): Filter => {
  // El día del mini calendario es un vistazo: no se recuerda al volver a abrir (si no, se esconden las vencidas y el resto).
  try { return { ...emptyFilter(), ...JSON.parse(localStorage.getItem(FILTER_KEY) || '{}'), day: undefined }; } catch { return emptyFilter(); }
};


/** Tareas pendientes por etiqueta ('#clave', '@clave', '!prioridad'). */
function tallyPending(tasks: Task[]): Map<string, number> {
  const m = new Map<string, number>();
  const inc = (k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const t of tasks) {
    if (t.deleted || t.done) continue;
    t.topics.forEach((k) => inc('#' + k));
    t.people.forEach((k) => inc('@' + k));
    if (t.priority) inc('!' + t.priority);
  }
  return m;
}
export function App({ repo, sync }: { repo: Repo; sync: Sync }) {
  const data = useData(repo);
  const today = useToday();
  const syncState = useSyncState(sync);
  const kbOpen = useKeyboardInset();
  const wide = useWide();

  // Lista actual (docs/plan-listas.md): se recuerda por dispositivo y se resuelve contra las listas que existen.
  const [scopeRaw, setScopeRaw] = useState<ListScope>(loadScope);
  // Antes de cargar las listas, la guardada (no hay tareas que mostrar, pero una captura externa sí sabe dónde está el usuario).
  const scope: ListScope = data.ready ? resolveScope(scopeRaw, data.lists) : scopeRaw;
  const changeScope = (s: ListScope) => {
    setScopeRaw(s);
    saveScope(s);
    setSelected(null);
    setEditing(null);
  };
  // El parser solo reconoce /lista de las listas que existen, y solo si hay más de una: con una sola, «/personal»
  // sigue siendo texto, como siempre.
  useLayoutEffect(() => { setKnownLists(data.lists.length > 1 ? data.lists.map((l) => l.name) : []); }, [data.lists]);

  const [filter, setFilterRaw] = useState<Filter>(loadFilter);
  const [panel, setPanel] = useState(false);
  const [selected, setSelected] = useState<ID | null>(null);
  const [editing, setEditing] = useState<ID | null>(null);
  const [sheetEnt, setSheetEnt] = useState<{ kind: EntityKind; key: string } | null>(null); // editor de tema/persona en móvil
  const [settings, setSettings] = useState(false);
  const [shortcuts, setShortcuts] = useState(false); // hoja «?» con los atajos (escritorio)
  // 'first': primera vez; 'full': abierta desde Ajustes (mismas slides, el último botón dice «Listo»).
  const [intro, setIntro] = useState<false | 'first' | 'full'>(() => { try { return localStorage.getItem(INTRO_KEY) ? false : 'first'; } catch { return false; } });
  const [googleOk, setGoogleOk] = useState(false);
  useEffect(() => { if (intro && syncState.status === 'signedOut') sync.googleEnabled().then(setGoogleOk); }, [intro, syncState.status]);
  const closeIntro = () => {
    setIntro(false);
    try { localStorage.setItem(INTRO_KEY, '1'); } catch { /* modo privado */ }
    markAllNewsSeen(); // quien llega nuevo ve la bienvenida, no las novedades
    setNewsSheet(null);
  };
  const [toast, setToast] = useState<Toast | null>(null);
  const [listSheet, setListSheet] = useState<ListSheetState | null>(null);
  const [confirmDel, setConfirmDel] = useState<ID | null>(null); // lista a borrar (diálogo de confirmación)
  // Novedades (src/ui/news.ts): las no vistas salen en su hoja nada más entrar, una sola vez. Con la bienvenida o un
  // enlace de invitación pendiente esperan a la próxima vez. Desde Ajustes → Novedades se ven todas.
  const [newsSheet, setNewsSheet] = useState<NewsItem[] | null>(() => {
    if (intro || pendingJoin()) return null;
    const unseen = unseenNews();
    return unseen.length ? unseen : null;
  });
  const closeNews = () => { markAllNewsSeen(); setNewsSheet(null); };
  // Listas compartidas (docs/plan-listas.md, «Interfaz de compartir»): diálogo de una lista y diálogo de unirse.
  // Unirse: link = el enlace que abrió la app (#unirse=…, guardado por captureJoinLink en main.tsx) o el pegado en la captura.
  const [shareFor, setShareFor] = useState<{ id: ID; leave?: boolean } | null>(null);
  const [join, setJoin] = useState<{ link: string } | null>(() => {
    const link = pendingJoin();
    return link ? { link } : null;
  });

  // Tras el primer pintado, bajar los chunks de las vistas diferidas (Ajustes, bienvenida, cifrado, atajos, dictado).
  useEffect(() => whenIdle(preloadViews), []);

  const captureRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const setFilter = (f: Filter) => {
    setFilterRaw(f);
    try { localStorage.setItem(FILTER_KEY, JSON.stringify({ ...f, day: undefined })); } catch { /* modo privado */ }
  };

  // Pila de «Deshacer»: cada aviso con ese botón apunta aquí su acción y ⌘Z / Ctrl+Z las ejecuta, la última primero.
  const undoStack = useRef<Array<() => unknown>>([]);
  const showToast = (t: Toast | string) => {
    clearTimeout(toastTimer.current);
    if (typeof t !== 'string' && t.action?.label === tr('Deshacer', 'Undo')) {
      const run = t.action.run;
      const entry = () => run();
      undoStack.current = [...undoStack.current.slice(-19), entry];
      // Si se pulsa el botón del aviso, esa acción sale de la pila para que ⌘Z no la repita.
      t = { ...t, action: { ...t.action, run: () => { undoStack.current = undoStack.current.filter((x) => x !== entry); run(); } } };
    }
    setToast(typeof t === 'string' ? { msg: t } : t);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };

  // Hay una versión nueva esperando: se ofrece recargar en vez de esperar a que la pestaña pase a segundo plano.
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => {
    const on = () => setUpdateReady(true);
    window.addEventListener(UPDATE_READY_EVENT, on);
    return () => window.removeEventListener(UPDATE_READY_EVENT, on);
  }, []);

  // Sin sincronización configurada no hay nada que compartir (y el sync de algunos tests no lo implementa).
  const sharing = syncState.status !== 'disabled' && typeof sync.shareList === 'function';
  const closeJoin = () => { clearPendingJoin(); setJoin(null); };
  // Un enlace de invitación abierto con la app ya cargada en esta pestaña solo cambia el fragmento: se recoge igual.
  useEffect(() => {
    const onHash = () => {
      if (!captureJoinLink()) return;
      const link = pendingJoin();
      if (link) setJoin({ link });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const openShare = (id: ID, leave = false) => { setListSheet(null); setSettings(false); setShareFor({ id, leave }); };
  // Enlace pegado (o escrito) en la caja de tareas: con sincronización abre el diálogo de unirse; sin ella, se explica.
  const joinFromCapture = (text: string) => {
    if (!sharing) { showToast(tr('Para unirte a una lista compartida hace falta la sincronización.', 'Joining a shared list needs sync.')); return; }
    setJoin({ link: text.slice(text.indexOf('#unirse=')).split(/\s/)[0] });
  };

  // El sync quitó una lista compartida (me quitaron, se borró para todos o salí desde otro dispositivo): se avisa.
  const lastSync = syncState.status === 'idle' ? syncState.lastSync : null;
  useEffect(() => {
    if (syncState.status !== 'idle' || typeof sync.takeLostLists !== 'function') return;
    void sync.takeLostLists().then((names) => {
      if (names.length === 1) showToast(tr(`Ya no formas parte de «${names[0]}»`, `You’re no longer in “${names[0]}”`));
      else if (names.length > 1) showToast(tr(`Ya no formas parte de ${names.length} listas compartidas`, `You’re no longer in ${names.length} shared lists`));
    }, () => {});
  }, [syncState.status, lastSync]);

  // Cifrado: al pasar de bloqueado a desbloqueado (enlace o clave de recuperación) se confirma con un aviso.
  const enc = sync.encryption?.() ?? 'off'; // el sync de algunos tests no implementa el cifrado
  const prevEnc = useRef(enc);
  useEffect(() => {
    if (prevEnc.current === 'locked' && (enc === 'on' || enc === 'migrating')) showToast(tr('Dispositivo enlazado. Tus datos ya están al día.', 'Device linked. Your data is up to date.'));
    prevEnc.current = enc;
  }, [enc]);

  useEffect(() => startLangSync(repo), [repo]);
  useEffect(() => startAppearanceSync(repo, (error) => {
    showToast(error instanceof Error ? error.message : tr('No se pudo cargar la apariencia.', 'Couldn’t load the appearance.'));
  }), [repo]);

  const names = useMemo(() => {
    const m = new Map<string, Entity>();
    data.topics.forEach((e) => m.set('#' + e.key, e));
    data.people.forEach((e) => m.set('@' + e.key, e));
    return m;
  }, [data.topics, data.people]);

  // Tareas de la lista actual: contadores, bloques, temas y personas, navegación. Las de otras listas no cuentan.
  const tasks = useMemo(() => data.tasks.filter((t) => inScope(t, scope)), [data.tasks, scope]);
  // Pendientes por etiqueta en la lista actual: filtros y contadores.
  const pending = useMemo(() => tallyPending(tasks), [tasks]);
  // En todas las listas: renombrar, unir o borrar un tema o una persona cambia todas, así que Ajustes y el editor cuentan todas
  // (si no, un tema que solo se usa en otra lista salía «sin tareas»).
  const pendingAll = useMemo(() => tallyPending(data.tasks), [data.tasks]);

  // Lo que se muestra en filtros: solo con pendientes, o los que el filtro activo usa (para no perderlos).
  const shownTopics = useMemo(() => data.topics.filter((e) => pending.has('#' + e.key) || filter.topics.includes(e.key)),
    [data.topics, pending, filter.topics]);
  const shownPeople = useMemo(() => data.people.filter((e) => pending.has('@' + e.key) || filter.people.includes(e.key)),
    [data.people, pending, filter.people]);
  // Al escribir se sugiere todo lo conocido (también lo que solo sale en tareas hechas), con pendientes primero.
  const captureTopics = useMemo(() => byUse(data.topics, '#', pending), [data.topics, pending]);
  const capturePeople = useMemo(() => byUse(data.people, '@', pending), [data.people, pending]);

  // Completadas hoy: siguen visibles (tachadas, en su sitio) hasta que cambia el día.
  const doneToday = useMemo(() => new Set(tasks
    .filter((t) => t.done && t.doneAt && toISODate(new Date(t.doneAt)) === today)
    .map((t) => t.id)), [tasks, today]);

  const visible = useMemo(() => {
    const shown = applyFilter(tasks, filter, today);
    if (doneToday.size && filter.status === 'open') {
      const ids = new Set(shown.map((t) => t.id));
      const extra = tasks.filter((t) => doneToday.has(t.id) && !ids.has(t.id));
      // Mantener su posición: se ordenan como si siguieran abiertas.
      return applyFilter(
        tasks.map((t) => (extra.includes(t) ? { ...t, done: 0 as const } : t)),
        filter, today,
      ).map((t) => (doneToday.has(t.id) ? tasks.find((x) => x.id === t.id)! : t));
    }
    return shown;
  }, [tasks, filter, today, doneToday]);

  // Pasadas: completadas antes de hoy (últimos PAST_DAYS días), arriba de la lista y fuera de la vista inicial.
  const past = useMemo(() => {
    if (filter.status !== 'open') return [];
    const since = Date.now() - PAST_DAYS * 864e5;
    return applyFilter(tasks, { ...filter, status: 'done' }, today)
      .filter((t) => !doneToday.has(t.id) && (t.doneAt ?? 0) >= since)
      .sort((a, b) => (a.doneAt ?? 0) - (b.doneAt ?? 0));
  }, [tasks, filter, today, doneToday]);
  const groups = useMemo(() => {
    const matched = [...new Map([...past, ...visible].map((t) => [t.id, t])).values()];
    const families = groupTasks(tasks);
    const children = new Map(families.map((g) => [g.task.id, g.children]));
    return groupTasks(matched).map((g) => ({ ...g, children: children.get(g.task.id) ?? g.children }));
  }, [past, visible, tasks]);
  const flat = useMemo(() => groups.flatMap((g) => [g.task, ...g.children]), [groups]);
  const tally = useMemo(() => counts(tasks, today), [tasks, today]);
  // Un día del mini calendario que ya pasó (la app quedó abierta o se guardó ayer) deja de filtrar.
  useEffect(() => { if (filter.day && filter.day < today) setFilter({ ...filter, day: undefined }); }, [today, filter.day]);
  const load = useMemo(() => dayLoad(tasks, today), [tasks, today]);
  // Tocar un día del mini calendario muestra solo ese día (sustituye a los filtros de Fecha); tocarlo otra vez lo quita.
  const pickDay = (d: string) => setFilter({ ...filter, dates: [], day: filter.day === d ? undefined : d });
  const week = <Week today={tally.today} overdue={tally.overdue} open={tally.open} done={doneToday.size} scopeKey={data.ready ? scope : ''}
    days={load} day={filter.day} onPick={pickDay} />;


  // ---------- acciones ----------
  // Tareas recién creadas que el filtro activo no deja ver. Una subtarea se ve si se ve su principal.
  // Solo cuentan las de la lista actual: las de otra lista ya se avisan con «Añadida a …».
  const hiddenByFilter = (created: Task[]) => {
    const here = created.filter((t) => inScope(t, scope));
    const shown = new Set(applyFilter([...tasks, ...here], filter, today).map((t) => t.id));
    return here.filter((t) => !shown.has(t.id) && !(t.parentId && shown.has(t.parentId))).length;
  };
  const showAllAction = () => ({ label: tr('Ver todo', 'Show all'), run: () => setFilter(emptyFilter()) });
  // Lista de destino de una tarea nueva: «Todas» escribe en la principal.
  const addTarget = (): ID => (scope === 'all' ? MAIN_LIST : scope);
  // Si las principales creadas acaban todas en una misma lista distinta de la actual (la vista no es «Todas»), esa lista y cuántas.
  const elsewhereOf = (created: Task[]): { id: ID; n: number } | null => {
    if (scope === 'all') return null;
    const tops = created.filter((t) => !t.parentId);
    if (!tops.length) return null;
    const id = tops[0].listId ?? MAIN_LIST;
    if (tops.some((t) => (t.listId ?? MAIN_LIST) !== id) || id === scope) return null;
    return { id, n: tops.length };
  };
  // Aviso con Ver: cambia a la lista donde fueron las tareas. Tiene prioridad sobre el de «oculta por el filtro».
  const announceElsewhere = ({ id, n }: { id: ID; n: number }) => {
    const name = listName(data.lists, id);
    showToast({
      msg: n > 1 ? tr(`${n} tareas añadidas a ${name}`, `${n} tasks added to ${name}`) : tr(`Añadida a ${name}`, `Added to ${name}`),
      action: { label: tr('Ver', 'View'), run: () => changeScope(id) },
    });
  };
  const add = async (lines: ParsedLine[]) => {
    const created = await repo.addParsed(lines, null, addTarget());
    if (!created.length) return;
    const elsewhere = elsewhereOf(created);
    if (elsewhere) { announceElsewhere(elsewhere); return; }
    const hidden = hiddenByFilter(created);
    const n = created.length;
    if (!hidden) {
      if (n > 1) showToast(tr(`${n} tareas añadidas`, `${n} tasks added`));
    } else if (n === 1) {
      showToast({ msg: tr('Añadida (oculta por el filtro)', 'Added (hidden by the filter)'), action: showAllAction() });
    } else {
      const msg = hidden === n
        ? tr(`${n} tareas añadidas (ocultas por el filtro)`, `${n} tasks added (hidden by the filter)`)
        : tr(`${n} tareas añadidas (${hidden} ocultas por el filtro)`, `${n} tasks added (${hidden} hidden by the filter)`);
      showToast({ msg, action: showAllAction() });
    }
  };

  // Aviso tras una captura externa. Se llama con el estado de la última pintada (el efecto corre una sola vez).
  const handleExternal = useRef<(created: Task[]) => void>(() => undefined);
  handleExternal.current = (created) => {
    const elsewhere = elsewhereOf(created);
    if (elsewhere) { announceElsewhere(elsewhere); return; }
    // Si el filtro la esconde, avisar pesa más que ofrecer deshacer: el aviso admite una sola acción.
    if (hiddenByFilter(created)) {
      showToast({ msg: tr('Apuntada (oculta por el filtro)', 'Saved (hidden by the filter)'), action: showAllAction() });
      return;
    }
    showToast({
      msg: created.length > 1 ? tr(`${created.length} tareas apuntadas`, `${created.length} tasks saved`) : tr('Apuntada: ', 'Saved: ') + created[0].title,
      action: { label: tr('Deshacer', 'Undo'), run: () => { for (const t of created) void repo.deleteTask(t.id); } },
    });
  };

  // Tarea que llega desde fuera («Compartir con Lista» en Android): se apunta una vez, en la principal
  // (salvo /lista), y se limpia la URL para que recargar no la duplique.
  useEffect(() => {
    const text = externalCapture(location.search);
    if (!text) return;
    (async () => {
      const created = await repo.addParsed(validateCapture(parseBlock(text)), null, MAIN_LIST);
      history.replaceState(null, '', location.pathname + location.hash);
      if (created.length) handleExternal.current(created);
    })().catch((e) => showToast(e instanceof Error ? e.message : tr('No se pudieron añadir las tareas.', 'Couldn’t add the tasks.')));
  }, []);

  const toggle = async (id: ID) => {
    try {
      const { task, spawned, undo } = await repo.toggleDone(id);
      if (task.done && undo) {
        showToast({
          msg: spawned?.due ? tr('Hecha · siguiente ', 'Done · next ') + formatDue(spawned.due, today) : tr('Hecha', 'Done'),
          action: { label: tr('Deshacer', 'Undo'), run: () => {
            void undo().catch((e) => showToast(e instanceof Error ? e.message : tr('No se pudo deshacer la tarea.', 'Couldn’t undo the task.')));
          } },
        });
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : tr('No se pudo cambiar la tarea.', 'Couldn’t change the task.'));
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
    showToast({ msg: tr('Tarea borrada', 'Task deleted'), action: { label: tr('Deshacer', 'Undo'), run: () => repo.restoreTask(id) } });
  };

  // Tarea a otra lista (arrastrada a la barra, o elegida en la hoja «Mover a…»): cambia quién la ve.
  // name: para una lista recién creada, que aún no está en data.lists.
  const moveToList = async (id: ID, listId: ID, name = listName(data.lists, listId)) => {
    const t = data.tasks.find((x) => x.id === id);
    if (!t || (t.listId ?? MAIN_LIST) === listId) return;
    try {
      // Entre una lista compartida y otra la tarea cambia de id (docs/plan-listas.md §4.4): la selección la sigue.
      const { id: movedId, undo } = await repo.moveToList(id, listId);
      if (movedId && movedId !== id) setSelected((cur) => (cur === id ? movedId : cur));
      const shared = data.lists.find((l) => l.id === listId)?.shared;
      showToast({
        msg: shared ? tr(`Movida a ${name}, compartida`, `Moved to ${name}, shared`) : tr(`Movida a ${name}`, `Moved to ${name}`),
        action: { label: tr('Deshacer', 'Undo'), run: () => {
          void undo().catch((e) => showToast(e instanceof Error ? e.message : tr('No se pudo deshacer la tarea.', 'Couldn’t undo the task.')));
        } },
      });
    } catch (e) {
      showToast(e instanceof Error ? e.message : tr('No se pudo mover la tarea.', 'Couldn’t move the task.'));
    }
  };

  // Tarea arrastrada a otro bloque (Hoy, Mañana, Esta semana, Próximas, Sin fecha): cambia su fecha.
  // Soltada en una lista de la barra (list:<id>): se mueve a esa lista.
  const move = async (id: ID, target: DropTarget | ListDrop) => {
    const listId = listOfDrop(target);
    if (listId !== null) { await moveToList(id, listId); return; }
    const dest = target as DropTarget;
    const t = data.tasks.find((x) => x.id === id);
    if (!t) return;
    const next = scheduleFor(dest, today);
    if (next.due === t.due && (next.period ?? null) === (t.period ?? null)) return;
    const before = { due: t.due, period: t.period ?? null };
    await repo.updateTask(id, next);
    showToast({ msg: tr('Movida a ', 'Moved to ') + dropLabel(dest), action: { label: tr('Deshacer', 'Undo'), run: () => repo.updateTask(id, before) } });
  };

  // ---------- listas (hoja, barra y diálogo de borrado) ----------
  const openMove = (id: ID) => setListSheet({ taskId: id });
  const taskListOf = (id: ID): ID => data.tasks.find((x) => x.id === id)?.listId ?? MAIN_LIST;
  // Elegir una lista en «Mover a…»: mueve la tarea y cierra el editor.
  const pickFromSheet = (s: ListScope) => {
    const sheet = listSheet;
    setListSheet(null);
    setEditing(null);
    if (sheet && s !== 'all') void moveToList(sheet.taskId, s);
  };
  // Crear una lista (pestañas o «Mover a…»). Lanza Error si el nombre no vale: lo muestra quien lo pidió.
  const createList = async (name: string) => {
    const list = await repo.createList(name);
    changeScope(list.id);
  };
  const createFromSheet = async (name: string) => {
    const list = await repo.createList(name);
    const sheet = listSheet;
    setListSheet(null);
    setEditing(null);
    if (sheet) await moveToList(sheet.taskId, list.id, list.name);
  };
  const renameList = (id: ID, name: string) => repo.renameList(id, name).then(() => undefined);
  // Tecla l: la pestaña siguiente (con más de una lista, Todas primero; luego las listas), y vuelta a empezar.
  const nextScope = (): ListScope => {
    const order: ListScope[] = [...(data.lists.length > 1 ? (['all'] as const) : []), ...data.lists.map((l) => l.id)];
    return order[(order.indexOf(scope) + 1) % order.length] ?? MAIN_LIST;
  };
  // Borrar: primero se pregunta (con cuántas tareas se lleva consigo).
  const askDeleteList = (id: ID) => setConfirmDel(id);
  const openTasksIn = (id: ID) => data.tasks.filter((t) => !t.parentId && (t.listId ?? MAIN_LIST) === id).length;
  const deleteListNow = async (id: ID) => {
    setConfirmDel(null);
    const name = listName(data.lists, id);
    try {
      const { undo } = await repo.deleteList(id);
      if (scope === id) changeScope(MAIN_LIST);
      showToast({
        msg: tr(`Lista «${name}» borrada`, `List “${name}” deleted`),
        action: { label: tr('Deshacer', 'Undo'), run: () => {
          void undo().catch((e) => showToast(e instanceof Error ? e.message : tr('No se pudo deshacer', 'Couldn’t undo')));
        } },
      });
    } catch (e) {
      showToast(e instanceof Error ? e.message : tr('No se pudo borrar la lista.', 'Couldn’t delete the list.'));
    }
  };
  const confirmText = (n: number) => (n === 0 ? tr('No tiene tareas.', 'It has no tasks.')
    : n === 1 ? tr('Tiene 1 tarea. Se borrará con ella.', 'It has 1 task. It will be deleted with it.')
    : tr(`Tiene ${n} tareas. Se borrarán con ella.`, `It has ${n} tasks. They will be deleted with it.`));

  // «Para mañana»: fecha de mañana sin periodo (botón del editor o «m»). Si había texto editado, se guarda con él.
  // Deshacer restaura solo la fecha anterior.
  const tomorrow = async (id: ID, line: ParsedLine | null = null) => {
    setEditing(null);
    const t = data.tasks.find((x) => x.id === id);
    if (!t || t.done) return; // una hecha no se pospone
    const next = scheduleFor('tomorrow', today);
    const before = { due: t.due, period: t.period ?? null };
    if (!line && next.due === t.due && next.period === before.period) return;
    try {
      if (line) await repo.replaceParsed(id, { ...line, ...next });
      else await repo.updateTask(id, next);
      showToast({
        msg: tr('Para mañana', 'Moved to tomorrow'),
        action: { label: tr('Deshacer', 'Undo'), run: () => {
          void repo.updateTask(id, before).catch((e) => showToast(e instanceof Error ? e.message : tr('No se pudo deshacer la tarea.', 'Couldn’t undo the task.')));
        } },
      });
    } catch (e) {
      showToast(e instanceof Error ? e.message : tr('No se pudo cambiar la tarea.', 'Couldn’t change the task.'));
    }
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
        showToast(tr('Unido con ', 'Merged with ') + sigil(kind) + (target?.name ?? newName));
      } else {
        showToast(tr('Renombrado a ', 'Renamed to ') + sigil(kind) + newName);
      }
    } catch (e) {
      showToast((e as Error).message || tr('No se pudo renombrar', 'Couldn’t rename'));
    }
  };

  const deleteEntity = async (kind: EntityKind, key: string) => {
    const name = listOf(kind).find((e) => e.key === key)?.name ?? key;
    try {
      const { undo } = await repo.deleteEntity(kind, key);
      patchEntityKeys(kind, key, (keys) => keys.filter((k) => k !== key));
      showToast({
        msg: `${sigil(kind)}${name} ${tr('borrado', 'deleted')}`,
        action: {
          label: tr('Deshacer', 'Undo'),
          run: () => { undo().catch((e: Error) => showToast(e.message || tr('No se pudo deshacer', 'Couldn’t undo'))); },
        },
      });
    } catch (e) {
      showToast((e as Error).message || tr('No se pudo borrar', 'Couldn’t delete'));
    }
  };

  const saveFilter = async (name: string) => {
    await repo.saveFilter(name, filter);
    setPanel(false);
    showToast(tr(`Filtro «${name}» guardado`, `Filter “${name}” saved`));
  };

  // ---------- teclado (escritorio) ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
      if (intro) return; // la bienvenida gestiona su propio teclado
      if (listSheet || newsSheet || confirmDel) return; // hojas y diálogos: su propio teclado (Esc los cierra)
      if (shortcuts) { if (e.key === '?' || e.key === 'Escape') { e.preventDefault(); setShortcuts(false); } return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        captureRef.current?.focus();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z' && !typing && !settings) {
        // Fuera de un campo de texto (ahí ⌘Z deshace lo escrito), deshace el último cambio hecho en la lista.
        const undo = undoStack.current[undoStack.current.length - 1];
        if (!undo) return;
        e.preventDefault();
        undoStack.current = undoStack.current.slice(0, -1);
        Promise.resolve().then(undo)
          .then(() => showToast(tr('Deshecho', 'Undone')))
          .catch((err) => showToast(err instanceof Error ? err.message : tr('No se pudo deshacer', 'Couldn’t undo')));
        return;
      }
      if (typing || settings || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.key === 'Enter' || e.key === ' ') && el.closest?.('button, a, [role="button"]')) return;
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
      else if (key === 'm' && selected) run(() => void tomorrow(selected));
      else if ((key === 'Backspace' || key === 'Delete') && selected) run(() => remove(selected));
      else if (key === '?') run(() => setShortcuts(true));
      else if (key === 'l') run(() => changeScope(nextScope()));
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
  const link = sync.link?.() ?? null; // el sync de algunos tests no implementa link()
  const multi = data.lists.length > 1;
  // Pestañas de listas (docs/plan-listas.md, «Pestañas»): el único sitio donde se cambian, crean, renombran, comparten y borran.
  const tabs = (
    <ListTabs lists={data.lists} scope={scope} sharing={sharing} onPick={changeScope} onCreate={createList}
      onRename={renameList} onDelete={askDeleteList} onShare={(id) => openShare(id)} onLeave={(id) => openShare(id, true)} />
  );

  return (
    <div class={`app ${wide ? 'wide' : ''}`} onClick={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
      <header class="top">
        <div class="bar">
          <span class="brand">Lista</span>
          {wide && tabs}
          <span class="bar-right">
            {!wide && (
              <button class={`link ${panel || !isEmptyFilter(filter) ? 'on' : ''}`} aria-expanded={panel} onClick={() => setPanel(!panel)}>
                {tr('Filtrar', 'Filter')}
              </button>
            )}
            <button class="link" onClick={() => setSettings(true)} aria-label={tr('Ajustes', 'Settings')}>{tr('Ajustes', 'Settings')}{syncDot}</button>
          </span>
        </div>
        {!wide && tabs}
        {!wide && (
          <FilterBar
            filter={filter} setFilter={setFilter} saved={data.filters} topics={shownTopics} people={shownPeople}
            names={names} pending={pending} counts={tally} today={today} week={week} open={panel} setOpen={setPanel} searchRef={searchRef}
            onSave={saveFilter} onDeleteSaved={(id) => repo.deleteFilter(id)}
            onEditEntity={(kind, key) => setSheetEnt({ kind, key })} onDeleteEntity={deleteEntity}
          />
        )}
      </header>

      {wide && (
        <Sidebar
          filter={filter} setFilter={setFilter} saved={data.filters} topics={shownTopics}
          people={shownPeople} allTopics={data.topics} allPeople={data.people} pending={pending} pendingAll={pendingAll}
          counts={tally} week={week} searchRef={searchRef} onSave={saveFilter} onDeleteSaved={(id) => repo.deleteFilter(id)}
          onRename={renameEntity} onDelete={deleteEntity}
        />
      )}

      <Capture
        topics={captureTopics} people={capturePeople} names={names} today={today} kbOpen={kbOpen}
        inputRef={captureRef} onAdd={add} onJoinLink={joinFromCapture}
        lists={data.lists} target={multi ? (data.lists.find((l) => l.id === addTarget()) ?? null) : null}
      />

      <main>
        {enc === 'locked' && <LazyLockedPanel sync={sync} onRecovery={() => setSettings(true)} />}
        {/* Novedad no vista: tarjeta al principio de la lista, una a una. Con la bienvenida abierta no se muestra. */}
        {data.ready && groups.length === 0 ? (
          <div class="empty">
            {isEmptyFilter(filter) ? (
              <><p>{tr('Nada pendiente.', 'Nothing to do.')}</p><p class="label">{tr('Escribe una tarea para empezar', 'Write a task to get started')}</p></>
            ) : (
              <><p>{tr('Sin resultados.', 'No results.')}</p><button class="link" onClick={() => setFilter(emptyFilter())}>{tr('Quitar filtros', 'Clear filters')}</button></>
            )}
          </div>
        ) : (
          <TaskList
            groups={groups} names={names} today={today} selected={selected} editing={editing}
            onSelect={setSelected} onEdit={setEditing} onToggle={toggle} onSave={save} onDelete={remove} onChip={chipTap}
            doneToday={doneToday} pastMode={filter.status === 'open'} anchorKey={JSON.stringify(filter)} onMove={move}
            onAddSubtasks={addSubtasks}
            lists={data.lists} showList={scope === 'all'} onPickList={(id) => changeScope(id)} onMoveTo={openMove}
          />
        )}
      </main>

      {updateReady && (
        <div class="toast toast-top" role="status">
          <span>{tr('Hay una versión nueva de Lista', 'A new version of Lista is available')}</span>
          <button class="link" onClick={() => window.location.reload()}>{tr('Recargar', 'Reload')}</button>
        </div>
      )}

      {newsSheet && <NewsSheet items={newsSheet} onClose={closeNews} />}

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
          <EntityEditor kind={sheetEnt.kind} entity={ent} entities={listOf(sheetEnt.kind)} pending={pendingAll}
            variant="sheet" onCancel={() => setSheetEnt(null)}
            onSave={(name) => { setSheetEnt(null); renameEntity(sheetEnt.kind, sheetEnt.key, name); }}
            onDelete={() => { setSheetEnt(null); deleteEntity(sheetEnt.kind, sheetEnt.key); }} />
        );
      })()}

      {settings && (
        <LazySettings repo={repo} sync={sync} state={syncState} onClose={() => setSettings(false)} toast={showToast}
          topics={data.topics} people={data.people} pending={pendingAll}
          onRename={renameEntity} onDelete={deleteEntity}
          onIntro={() => { setSettings(false); setIntro('full'); }}
          onShortcuts={() => { setSettings(false); setShortcuts(true); }} />
      )}
      {listSheet && (
        <ListSheet lists={data.lists} current={taskListOf(listSheet.taskId)} sharing={sharing}
          onPick={pickFromSheet} onCreate={createFromSheet} onClose={() => setListSheet(null)} />
      )}
      {confirmDel && (
        <ConfirmDialog
          title={tr(`¿Borrar «${listName(data.lists, confirmDel)}»?`, `Delete “${listName(data.lists, confirmDel)}”?`)}
          text={confirmText(openTasksIn(confirmDel))} confirm={tr('Borrar', 'Delete')}
          onConfirm={() => void deleteListNow(confirmDel)} onCancel={() => setConfirmDel(null)} />
      )}
      {shortcuts && <LazyShortcutsSheet onClose={() => setShortcuts(false)} />}
      {link?.role === 'active' && <LazyLinkDialog sync={sync} link={link} toast={showToast} />}
      <Critter enabled={wide} />
      {intro && (
        <LazyOnboarding onClose={closeIntro} extended={intro === 'full'}
          signIn={googleOk && syncState.status === 'signedOut' ? () => sync.signInWithGoogle() : undefined} />
      )}
      {/* Después de la bienvenida: quien llega con un enlace de invitación lo ve encima. */}
      {sharing && shareFor && (() => {
        const list = data.lists.find((l) => l.id === shareFor.id);
        if (!list) return null;
        return (
          <LazyShareDialog key={`${list.id}:${shareFor.leave ? 'leave' : ''}`} list={list} leave={shareFor.leave}
            sync={sync} state={syncState} toast={showToast} onClose={() => setShareFor(null)}
            onGone={(id, name) => {
              if (scope === id) changeScope(MAIN_LIST);
              showToast(tr(`«${name}» ya no está en tus listas`, `“${name}” is no longer in your lists`));
            }} />
        );
      })()}
      {sharing && join && (
        <LazyJoinDialog link={join.link} sync={sync} state={syncState} onClose={closeJoin}
          onJoined={(id, name) => {
            clearPendingJoin();
            changeScope(id);
            showToast(tr(`Te has unido a «${name}»`, `You joined “${name}”`));
          }} />
      )}
    </div>
  );
}
