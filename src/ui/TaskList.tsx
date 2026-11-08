import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Fragment } from 'preact';
import { MAIN_LIST, type Entity, type ID, type ISODate, type ParsedLine, type Task, type TodoList } from '../types';
import { formatLine, inlineTags, normalizeKey, parseLine } from '../parser';
import { ListChip, TaskChips, type ChipTap } from './Chips';
import { isCurrentPeriod, periodEnd } from '../lib/period';
import { splitLinks } from '../lib/links';
import { addToAppleCalendar, addToCalendar, addToGoogleCalendar, prefersApple } from './calendar';
import { addDays } from '../lib/date';
import { useDrag, dragging } from './drag';
import type { DropTarget, ListDrop } from '../lib/reschedule';
import { SubtaskInputs } from './SubtaskInputs';
import { titleTooLong, titleTooLongMsg } from '../lib/capture';
import { isEn, tr } from '../i18n';

export interface Group { task: Task; children: Task[] }

interface Props {
  groups: Group[];
  names: Map<string, Entity>;
  today: ISODate;
  selected: ID | null;
  editing: ID | null;
  onSelect: (id: ID | null) => void;
  onEdit: (id: ID | null) => void;
  onToggle: (id: ID) => void;
  onSave: (id: ID, line: ParsedLine) => void;
  onDelete: (id: ID) => void;
  onChip: ChipTap;
  doneToday: Set<ID>; // completadas hoy: se quedan en su sitio hasta que cambia el día
  pastMode: boolean; // vista de pendientes: las completadas antes de hoy van a "Pasadas", arriba
  anchorKey: string; // al cambiar (filtro), se vuelve a colocar la vista en el presente
  onMove: (id: ID, target: DropTarget | ListDrop) => void; // tarea arrastrada a otro bloque o a una lista de la barra
  onAddSubtasks: (id: ID, lines: ParsedLine[]) => Promise<void>;
  lists: TodoList[]; // todas las listas, la principal primero
  showList: boolean; // vista «Todas las listas»: cada tarea principal muestra su lista
  onPickList: (listId: ID) => void; // tocar la etiqueta de lista: abre esa lista
  onMoveTo: (id: ID) => void; // botón «Mover a…» del editor
}

type SectionKey = 'past' | 'overdue' | 'today' | 'tomorrow' | 'week' | 'next' | 'nodate' | 'done';
const SECTION_ORDER: SectionKey[] = ['past', 'overdue', 'today', 'tomorrow', 'week', 'next', 'nodate', 'done'];
const sectionLabel = (k: SectionKey) => (isEn()
  ? { past: 'Earlier', overdue: 'Overdue', today: 'Today', tomorrow: 'Tomorrow', week: 'This week', next: 'Upcoming', nodate: 'No date', done: 'Completed' }
  : { past: 'Pasadas', overdue: 'Vencidas', today: 'Hoy', tomorrow: 'Mañana', week: 'Esta semana', next: 'Próximas', nodate: 'Sin fecha', done: 'Completadas' })[k];
/** Bloques donde se puede soltar una tarea arrastrada (mientras se arrastra se muestran aunque estén vacíos). */
const DROP: SectionKey[] = ['today', 'tomorrow', 'week', 'next', 'nodate'];

function sectionOf(t: Task, today: ISODate, doneToday: Set<ID>, pastMode: boolean): SectionKey {
  if (t.done && !doneToday.has(t.id)) return pastMode ? 'past' : 'done';
  if (!t.due) return 'nodate';
  if (t.due < today) return 'overdue';
  // "Esta semana" llega hasta el viernes e incluye las de periodo "esta semana"; mes/trimestre/año van a Próximas.
  if (t.period) return t.period === 'week' && isCurrentPeriod('week', t.due, today) ? 'week' : 'next';
  if (t.due === today) return 'today';
  if (t.due === addDays(today, 1)) return 'tomorrow';
  return t.due <= periodEnd('week', today) ? 'week' : 'next';
}

const EXPANDED_KEY = 'lista.expanded';
/** Grupos de subtareas abiertos: se recuerdan en este dispositivo para que sigan abiertos al volver. */
const loadExpanded = (): Set<ID> => {
  try {
    const v = JSON.parse(localStorage.getItem(EXPANDED_KEY) || '[]');
    return new Set(Array.isArray(v) ? v.filter((x): x is ID => typeof x === 'string') : []);
  } catch { return new Set(); }
};

export function TaskList(props: Props) {
  const { groups, today } = props;
  const [dragId, setDragId] = useState<ID | null>(null);
  const [expanded, setExpanded] = useState<Set<ID>>(loadExpanded);
  useEffect(() => {
    try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded])); } catch { /* modo privado */ }
  }, [expanded]);
  const [adding, setAdding] = useState<ID | null>(null);
  const expand = (id: ID) => setExpanded((old) => {
    const next = new Set(old);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const addSubtask = (id: ID) => {
    props.onEdit(null);
    setExpanded((old) => new Set([...old, id]));
    setAdding(id);
  };
  useEffect(() => {
    const parent = groups.find((g) => g.children.some((c) => c.id === props.selected || c.id === props.editing));
    if (parent) setExpanded((old) => old.has(parent.task.id) ? old : new Set([...old, parent.task.id]));
  }, [props.selected, props.editing, groups]);
  const byKey = new Map<SectionKey, Group[]>();
  for (const g of groups) {
    const key = sectionOf(g.task, today, props.doneToday, props.pastMode);
    byKey.set(key, [...(byKey.get(key) ?? []), g]);
  }
  const shown = (k: SectionKey) => byKey.has(k) || (dragId !== null && props.pastMode && DROP.includes(k));
  const sections = SECTION_ORDER.filter(shown).map((key) => ({ key, items: byKey.get(key) ?? [] }));
  // Dentro de cada bloque, las pendientes arriba y las ya hechas (hoy) abajo, conservando el orden.
  for (const s of sections) {
    if (s.key !== 'past') s.items = [...s.items.filter((g) => !g.task.done), ...s.items.filter((g) => g.task.done)];
  }
  const pastSection = sections[0]?.key === 'past' ? sections.shift()! : null;

  // Las pasadas quedan por encima de la vista: al cargar o cambiar de filtro se coloca el presente arriba.
  const nowRef = useRef<HTMLDivElement>(null);
  const anchored = useRef('');
  useLayoutEffect(() => {
    const key = `${props.anchorKey}|${!!pastSection}`;
    if (anchored.current === key || !nowRef.current) return;
    anchored.current = key;
    if (!pastSection) return;
    // Lo que queda fijo arriba: la cabecera y, en escritorio, también la captura.
    const header = ['.top', '.capture'].reduce((h, sel) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      return el && getComputedStyle(el).position === 'sticky' ? h + el.offsetHeight : h;
    }, 0);
    window.scrollTo({ top: nowRef.current.getBoundingClientRect().top + window.scrollY - header });
  });

  const drop = (k: SectionKey) => (dragId !== null && DROP.includes(k) ? k : undefined);
  const rowProps = { ...props, onDragStart: setDragId, onDragEnd: () => setDragId(null) };
  const render = (s: { key: SectionKey; items: Group[] }) => (
    <section key={s.key} class={`${s.key === 'past' ? 'past' : ''} ${drop(s.key) ? 'droppable' : ''}`} data-drop={drop(s.key)}>
      <h2 class={`section ${s.key === 'overdue' ? 'warn' : ''}`}>
        <span>{sectionLabel(s.key)}</span>
        <span>{s.items.length}</span>
      </h2>
      <ul class="list">
        {s.items.map((g) => {
          const open = (g.children.length > 0 && expanded.has(g.task.id)) || adding === g.task.id;
          return (
            <Fragment key={g.task.id}>
              <Row task={g.task} section={s.key} {...rowProps} childrenCount={g.children.length}
                completedCount={g.children.filter((c) => c.done).length} expanded={open}
                onExpand={() => expand(g.task.id)} onAddSubtask={() => addSubtask(g.task.id)} />
              {open && (
                <li class="subtask-group">
                  <ul id={`subtasks-${g.task.id}`} aria-label={tr(`Subtareas de ${g.task.title}`, `Subtasks of ${g.task.title}`)}>
                    {g.children.map((c, i) => <Row key={c.id} task={c} sub section={s.key} {...rowProps}
                      onAddSubtask={i === g.children.length - 1 && adding !== g.task.id ? () => addSubtask(g.task.id) : undefined} />)}
                    {adding === g.task.id && (
                      <li class="subtask-composer">
                        <SubtaskInputs label={tr('Listo', 'Done')} onCancel={() => setAdding(null)}
                          onEach={(lines) => props.onAddSubtasks(g.task.id, lines)}
                          onSubmit={async (lines) => { await props.onAddSubtasks(g.task.id, lines); setAdding(null); }} />
                      </li>
                    )}
                  </ul>
                </li>
              )}
            </Fragment>
          );
        })}
        {!s.items.length && <li class="drop-empty">{tr('Suelta aquí', 'Drop here')}</li>}
      </ul>
    </section>
  );

  return (
    <>
      {pastSection && render(pastSection)}
      <div ref={nowRef} class={pastSection ? 'now has-past' : 'now'}>
        {pastSection && (
          <button class="past-hint label" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            ↑ {pastSection.items.length} {isEn() ? 'earlier' : pastSection.items.length === 1 ? 'pasada' : 'pasadas'}
          </button>
        )}
        {sections.map(render)}
      </div>
    </>
  );
}

function Row({ task, sub, section, names, today, selected, editing, onSelect, onEdit, onToggle, onSave, onDelete, onChip, onMove, onDragStart, onDragEnd,
  lists, showList, onPickList, onMoveTo, childrenCount = 0, completedCount = 0, expanded = false, onExpand, onAddSubtask }:
  Props & { task: Task; sub?: boolean; section: SectionKey; onDragStart: (id: ID) => void; onDragEnd: () => void;
    childrenCount?: number; completedCount?: number; expanded?: boolean; onExpand?: () => void; onAddSubtask?: () => void }) {
  const isEditing = editing === task.id;
  const ref = useRef<HTMLLIElement>(null);
  const swipe = useSwipe(() => onToggle(task.id), () => onDelete(task.id), !isEditing);
  const drag = useDrag(task.id, isEditing && !task.done, () => onDragStart(task.id), (target) => {
    onDragEnd();
    onEdit(null);
    if (target) onMove(task.id, target);
  });
  // El deslizamiento lateral y el arrastre (que solo empieza desde el asa del editor) comparten el clic de después.
  const clickCapture = (e: MouseEvent) => { drag.handlers.onClickCapture(e); swipe.handlers.onClickCapture(e); };
  useEffect(() => {
    if (selected === task.id) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  // Tocar una tarea con subtareas la abre entera: se despliegan sus pasos y se abre su editor. Plegar es cosa del botón de ramas.
  const activate = () => { onSelect(task.id); if (childrenCount && !expanded) onExpand?.(); onEdit(task.id); };

  return (
    <li
      ref={ref}
      class={`row ${sub ? 'sub' : ''} ${childrenCount ? 'has-subtasks' : ''} ${childrenCount && !expanded ? 'subtasks-collapsed' : ''} ${task.done ? 'done' : ''} ${selected === task.id ? 'sel' : ''} ${swipe.active ? 'swiping' : ''} ${drag.active ? 'dragging' : ''}`}
      data-id={task.id}
      data-swipe={task.done ? tr('Pendiente', 'Undo') : tr('Hecha', 'Done')}
      data-swipe-left={tr('Borrar', 'Delete')}
      style={{ ...swipe.style, ...drag.style }}
      {...swipe.handlers}
      onClickCapture={clickCapture}
    >
      {sub && onAddSubtask && <AddSubtaskButton onClick={onAddSubtask} />}
      {isEditing && !task.done ? (
        // Editando, la casilla deja sitio al asa: se arrastra a otro bloque (Hoy, Mañana…) para cambiar de día.
        <button class="check move" aria-label={tr('Mover a otro día', 'Move to another day')} title={tr('Arrastra para cambiar de día', 'Drag to change the day')}
          onMouseDown={(e) => e.preventDefault()} onTouchStart={(e) => e.preventDefault()} onPointerDown={drag.start}>
          <svg class="grip" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor">
            <circle cx="5.5" cy="3.5" r="1.4" /><circle cx="10.5" cy="3.5" r="1.4" /><circle cx="5.5" cy="8" r="1.4" />
            <circle cx="10.5" cy="8" r="1.4" /><circle cx="5.5" cy="12.5" r="1.4" /><circle cx="10.5" cy="12.5" r="1.4" />
          </svg>
        </button>
      ) : (
        <button class="check" aria-pressed={!!task.done}
          aria-label={childrenCount ? task.done ? tr('Reabrir tarea y subtareas', 'Reopen task and subtasks') : tr('Completar tarea y subtareas', 'Complete task and subtasks') : task.done ? tr('Marcar pendiente', 'Mark as not done') : tr('Completar', 'Complete')}
          title={childrenCount ? tr('Cambiar también todas sus subtareas', 'Also changes all its subtasks') : undefined} onClick={() => onToggle(task.id)}>
          <i />
        </button>
      )}
      <div class="body">
        {isEditing ? (
          <Editor task={task} names={names} onSave={(l) => onSave(task.id, l)} onCancel={() => onEdit(null)}
            onDelete={() => onDelete(task.id)}
            onAddSubtask={sub ? undefined : onAddSubtask}
            onMoveTo={lists.length > 1 ? () => onMoveTo(task.id) : undefined} />
        ) : (
          <>
            <div class="title-line">
              {/* No es un <button>: dentro puede ir un enlace, y un enlace no puede estar dentro de un botón. */}
              <span class={`title ${task.priority === 1 ? 'p1' : ''}`} role="button" tabIndex={0}
                onKeyDown={(e) => {
                  // Enter y Espacio activan el título; si el foco está en un enlace dentro, lo activa el enlace.
                  if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
                  e.preventDefault();
                  activate();
                }}
                onClick={(e) => {
                  activate();
                  // Con el ratón no debe quedar el aro de foco sobre el título (con el teclado sí).
                  if (e.detail > 0) (e.currentTarget as HTMLElement).blur();
                }}>
                <TitleText text={task.title} onChip={onChip} />
              </span>
              {childrenCount > 0 && (
                <button class="fold-task" aria-expanded={expanded}
                  aria-controls={expanded ? `subtasks-${task.id}` : undefined}
                  aria-label={tr(`Subtareas: ${completedCount} de ${childrenCount} completadas`, `Subtasks: ${completedCount} of ${childrenCount} done`)}
                  title={expanded ? tr('Ocultar subtareas', 'Hide subtasks') : tr('Mostrar subtareas', 'Show subtasks')}
                  onClick={() => { onSelect(task.id); onExpand?.(); }}>
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor"
                    stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="4" cy="3.5" r="1.6" /><circle cx="4" cy="12.5" r="1.6" /><circle cx="12" cy="5.5" r="1.6" />
                    <path d="M4 5.1v5.8M12 7.1c0 2.4-2.2 3-6.4 3.6" />
                  </svg>
                  <span class="fold-count">{completedCount}/{childrenCount}</span>
                </button>
              )}
            </div>
            <div class="meta">
              {/* Vista «Todas las listas»: la etiqueta de la lista va en las principales; las subtareas siguen a su principal. */}
              {showList && !sub && (() => {
                const list = lists.find((l) => l.id === (task.listId ?? MAIN_LIST));
                return list && <ListChip name={list.name} onTap={() => onPickList(list.id)} />;
              })()}
              <TaskChips due={task.due} period={task.period} done={!!task.done} priority={task.priority} recurrence={task.recurrence}
                topics={task.topics} people={task.people} names={names} today={today} onTap={onChip} title={task.title}
                hideDue={!task.done && ((section === 'today' && task.due === today && !task.period) || (section === 'tomorrow' && !task.period) || (section === 'week' && task.period === 'week'))} />
            </div>
          </>
        )}
      </div>
      {!isEditing && task.due && !task.done && (
        <button class="trash cal" aria-label={tr('Añadir al calendario', 'Add to calendar')} title={tr('Añadir al calendario', 'Add to calendar')} onClick={() => addToCalendar(task)}>
          <CalendarIcon />
        </button>
      )}
      {!isEditing && (
        <button class="trash" aria-label={tr('Borrar tarea', 'Delete task')} title={tr('Borrar', 'Delete')} onClick={() => onDelete(task.id)}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor"
            stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2.5 4.5h11M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M4 4.5l.7 8.6a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.6M6.7 7v4.5M9.3 7v4.5" />
          </svg>
        </button>
      )}
    </li>
  );
}

/** Pantalla táctil: el editor muestra menos acciones (borrar se hace deslizando). */
const touch = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

const SWIPE_MIN = 72; // px; o un tercio del ancho de la fila si es mayor

/** Táctil: deslizar a la derecha completa y a la izquierda borra. El scroll vertical sigue siendo del navegador (touch-action: pan-y). */
function useSwipe(onRight: () => void, onLeft: () => void, enabled: boolean) {
  const start = useRef<{ x: number; y: number; min: number } | null>(null);
  const moved = useRef(false);
  const [dx, setDx] = useState(0);
  const reset = () => { start.current = null; setDx(0); };

  const handlers = {
    onPointerDown: (e: PointerEvent) => {
      if (!enabled || e.pointerType === 'mouse') return;
      // Umbral para completar/borrar: 72 px o un tercio de la fila. El color de fondo llega al máximo ahí.
      start.current = { x: e.clientX, y: e.clientY, min: Math.max(SWIPE_MIN, (e.currentTarget as HTMLElement).offsetWidth / 3) };
      moved.current = false;
    },
    onPointerMove: (e: PointerEvent) => {
      const s = start.current;
      if (!s) return;
      if (dragging.id) { reset(); return; } // se está arrastrando la tarea a otro bloque
      const x = e.clientX - s.x;
      const y = e.clientY - s.y;
      if (!moved.current) {
        if (Math.abs(y) > 10 && Math.abs(y) > Math.abs(x)) { reset(); return; }
        if (Math.abs(x) < 10) return;
        moved.current = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }
      setDx(x);
    },
    onPointerUp: (e: PointerEvent) => {
      const min = start.current?.min ?? SWIPE_MIN;
      if (moved.current && dx > min) onRight();
      else if (moved.current && dx < -min) onLeft();
      reset();
    },
    onPointerCancel: reset,
    // Tras un deslizamiento no debe abrirse el editor ni pulsarse el check.
    onClickCapture: (e: MouseEvent) => {
      if (moved.current) { e.preventDefault(); e.stopPropagation(); moved.current = false; }
    },
  };
  const min = start.current?.min ?? SWIPE_MIN;
  const style = dx
    ? { '--dx': `${dx}px`, '--swipe': Math.min(1, Math.max(0, dx) / min), '--swipe-l': Math.min(1, Math.max(0, -dx) / min) }
    : undefined;
  return { handlers, style, active: dx !== 0 };
}

/** Título con los #temas y @personas resaltados (tocarlos filtra, sin abrir el editor) y las web como enlaces cortos. */
export function TitleText({ text, onChip }: { text: string; onChip: ChipTap }) {
  const parts: preact.ComponentChildren[] = [];
  splitLinks(text).forEach((seg, n) => {
    if (seg.type === 'link') {
      // Tocar el enlace abre la web y no hace nada más en la fila (ni selección, ni editor, ni deslizamiento).
      const stop = (e: Event) => e.stopPropagation();
      parts.push(
        <a key={`link${n}`} href={seg.href} target="_blank" rel="noopener noreferrer" title={seg.href}
          aria-label={`Abrir ${seg.host}`} onClick={stop} onPointerDown={stop}>{seg.host} ↗</a>,
      );
      return;
    }
    let i = 0;
    for (const t of inlineTags(seg.raw)) {
      parts.push(seg.raw.slice(i, t.start));
      parts.push(
        <span key={`tag${n}-${t.start}`} class="tag" onClick={(e) => {
          e.stopPropagation();
          onChip(t.sym === '#' ? 'topic' : 'person', normalizeKey(t.name));
        }}>{seg.raw.slice(t.start, t.end)}</span>,
      );
      i = t.end;
    }
    parts.push(seg.raw.slice(i));
  });
  return <>{parts}</>;
}

function AddSubtaskButton({ onClick, inline = false }: { onClick: () => void; inline?: boolean }) {
  // En el editor es texto, como el resto de acciones; en la subtarea, el «+» de la izquierda.
  if (inline) return <button class="link" aria-label={tr('Añadir subtarea', 'Add subtask')} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>{tr('+ Subtarea', '+ Subtask')}</button>;
  return (
    <button class="add-subtask-action add-subtask-icon" aria-label={tr('Añadir subtarea', 'Add subtask')} title={tr('Añadir subtarea', 'Add subtask')} onClick={onClick}>
      <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" fill="none"
        stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
        <path d="M10 4v12M4 10h12" />
      </svg>
    </button>
  );
}

/** Edición en línea con la misma sintaxis que la captura. Las fechas se muestran como vence:AAAA-MM-DD
 *  para que una relativa ("mañana") no se recalcule al guardar. */
function Editor({ task, names, onSave, onCancel, onDelete, onAddSubtask, onMoveTo }: {
  task: Task; names: Map<string, Entity>;
  onSave: (l: ParsedLine) => void; onCancel: () => void; onDelete: () => void;
  onAddSubtask?: () => void;
  onMoveTo?: () => void; // solo si hay más de una lista
}) {
  const initial = formatLine({
    title: task.title,
    topicNames: task.topics.map((k) => names.get('#' + k)?.name ?? k),
    peopleNames: task.people.map((k) => names.get('@' + k)?.name ?? k),
    due: task.due, period: task.period, priority: task.priority, recurrence: task.recurrence,
  });
  const [v, setV] = useState(initial);
  const [error, setError] = useState('');
  const [cal, setCal] = useState(false); // elegir Apple / Google
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => { ref.current?.focus(); }, []);

  const save = () => {
    if (done.current) return;
    const line = parseLine(v);
    if (v === initial || !line.title) { done.current = true; onCancel(); return; }
    // Con error no se cierra la edición: el texto sigue ahí para recortarlo.
    if (titleTooLong([line])) { setError(titleTooLongMsg()); return; }
    done.current = true;
    onSave(line);
  };
  const keep = (e: Event) => e.preventDefault(); // que el clic no quite el foco (blur = guardar)
  const both = task.due && prefersApple() && !touch(); // en Mac se elige Apple o Google; si no, va directo
  return (
    <>
      <div class="edit-line">
        <input
          ref={ref}
          class="edit"
          value={v}
          aria-label={tr('Editar tarea', 'Edit task')}
          autocomplete="off"
          enterkeyhint="done"
          onInput={(e) => { setV(e.currentTarget.value); setError(''); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); save(); }
            if (e.key === 'Escape') { e.preventDefault(); done.current = true; onCancel(); }
          }}
          onBlur={save}
        />
      </div>
      {/* Se guarda con Enter o al salir: no hace falta botón «Guardar». */}
      <div class="edit-actions">
        {onAddSubtask && <AddSubtaskButton inline onClick={() => { save(); onAddSubtask(); }} />}
        {task.due && (cal && both ? (
          <>
            <button class="link" onMouseDown={keep} onClick={() => { addToAppleCalendar(task); setCal(false); }}>Apple</button>
            <button class="link" onMouseDown={keep} onClick={() => { addToGoogleCalendar(task); setCal(false); }}>Google</button>
          </>
        ) : (
          <button class="link" title={tr('Añadir a tu calendario', 'Add to your calendar')} onMouseDown={keep}
            onClick={() => (both ? setCal(true) : prefersApple() ? addToAppleCalendar(task) : addToGoogleCalendar(task))}>
            {tr('Calendario', 'Calendar')}
          </button>
        ))}
        {/* Mismo gesto que los vecinos: el clic no quita el foco, así que el editor no se guarda al abrir la hoja. */}
        {onMoveTo && <button class="link" onMouseDown={keep} onClick={onMoveTo}>{tr('Mover a…', 'Move to…')}</button>}
        <button class="link danger" onMouseDown={(e) => { e.preventDefault(); done.current = true; }} onClick={onDelete}>
          {tr('Borrar', 'Delete')}
        </button>
      </div>
      {error && <p class="err" role="alert">{error}</p>}
    </>
  );
}

/** Calendario de trazo fino (mismo estilo que la papelera). */
function CalendarIcon() {
  return (
    <svg class="cal-icon" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor"
      stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
    </svg>
  );
}
