import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Fragment } from 'preact';
import type { Entity, ID, ISODate, ParsedLine, Task } from '../types';
import { formatLine, inlineTags, normalizeKey, parseLine } from '../parser';
import { TaskChips, type ChipTap } from './Chips';
import { isCurrentPeriod, periodEnd } from '../lib/period';
import { addToAppleCalendar, addToCalendar, addToGoogleCalendar, prefersApple } from './calendar';
import { addDays } from '../lib/date';
import { useDrag, dragging } from './drag';
import type { DropTarget } from '../lib/reschedule';
import { SubtaskInputs } from './SubtaskInputs';

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
  onMove: (id: ID, target: DropTarget) => void; // tarea arrastrada a otro bloque
  onAddSubtasks: (id: ID, lines: ParsedLine[]) => Promise<void>;
}

type SectionKey = 'past' | 'overdue' | 'today' | 'tomorrow' | 'week' | 'next' | 'nodate' | 'done';
const SECTION_LABEL: Record<SectionKey, string> = {
  past: 'Pasadas', overdue: 'Vencidas', today: 'Hoy', tomorrow: 'Mañana', week: 'Esta semana',
  next: 'Próximas', nodate: 'Sin fecha', done: 'Completadas',
};
const SECTION_ORDER = Object.keys(SECTION_LABEL) as SectionKey[];
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

export function TaskList(props: Props) {
  const { groups, today } = props;
  const [dragId, setDragId] = useState<ID | null>(null);
  const [expanded, setExpanded] = useState<Set<ID>>(new Set());
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
        <span>{SECTION_LABEL[s.key]}</span>
        <span>{s.items.length}</span>
      </h2>
      <ul class="list">
        {s.items.map((g) => {
          const open = expanded.has(g.task.id) || adding === g.task.id;
          return (
            <Fragment key={g.task.id}>
              <Row task={g.task} section={s.key} {...rowProps} childrenCount={g.children.length}
                completedCount={g.children.filter((c) => c.done).length} expanded={open}
                onExpand={() => expand(g.task.id)} onAddSubtask={() => addSubtask(g.task.id)} />
              {open && (
                <li class="subtask-group">
                  <ul id={`subtasks-${g.task.id}`} aria-label={`Subtareas de ${g.task.title}`}>
                    {g.children.map((c) => <Row key={c.id} task={c} sub section={s.key} {...rowProps} />)}
                    <li class="subtask-composer">
                      {adding === g.task.id ? (
                        <SubtaskInputs label="Añadir subtareas" onCancel={() => setAdding(null)}
                          onSubmit={async (lines) => { await props.onAddSubtasks(g.task.id, lines); setAdding(null); }} />
                      ) : <button class="link add-subtask" onClick={() => addSubtask(g.task.id)}>+ subtarea</button>}
                    </li>
                  </ul>
                </li>
              )}
            </Fragment>
          );
        })}
        {!s.items.length && <li class="drop-empty">Suelta aquí</li>}
      </ul>
    </section>
  );

  return (
    <>
      {pastSection && render(pastSection)}
      <div ref={nowRef} class={pastSection ? 'now has-past' : 'now'}>
        {pastSection && (
          <button class="past-hint label" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            ↑ {pastSection.items.length} {pastSection.items.length === 1 ? 'pasada' : 'pasadas'}
          </button>
        )}
        {sections.map(render)}
      </div>
    </>
  );
}

function Row({ task, sub, section, names, today, selected, editing, onSelect, onEdit, onToggle, onSave, onDelete, onChip, onMove, onDragStart, onDragEnd,
  childrenCount = 0, completedCount = 0, expanded = false, onExpand, onAddSubtask }:
  Props & { task: Task; sub?: boolean; section: SectionKey; onDragStart: (id: ID) => void; onDragEnd: () => void;
    childrenCount?: number; completedCount?: number; expanded?: boolean; onExpand?: () => void; onAddSubtask?: () => void }) {
  const isEditing = editing === task.id;
  const ref = useRef<HTMLLIElement>(null);
  const swipe = useSwipe(() => { if (!childrenCount) onToggle(task.id); }, () => onDelete(task.id), !isEditing);
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

  return (
    <li
      ref={ref}
      class={`row ${sub ? 'sub' : ''} ${task.done ? 'done' : ''} ${selected === task.id ? 'sel' : ''} ${swipe.active ? 'swiping' : ''} ${drag.active ? 'dragging' : ''}`}
      data-id={task.id}
      data-swipe={task.done ? 'Pendiente' : 'Hecha'}
      data-swipe-left="Borrar"
      style={{ ...swipe.style, ...drag.style }}
      {...swipe.handlers}
      onClickCapture={clickCapture}
    >
      <button class="check" disabled={childrenCount > 0}
        aria-label={childrenCount ? `${completedCount} de ${childrenCount} subtareas completadas` : task.done ? 'Marcar pendiente' : 'Completar'}
        title={childrenCount ? 'Se completa al terminar todas las subtareas' : undefined} onClick={() => onToggle(task.id)}>
        <i />
      </button>
      <div class="body">
        {isEditing ? (
          <Editor task={task} names={names} onSave={(l) => onSave(task.id, l)} onCancel={() => onEdit(null)}
            onDelete={() => onDelete(task.id)} onDragStart={task.done ? undefined : drag.start}
            onAddSubtask={sub ? undefined : onAddSubtask} />
        ) : (
          <>
            <div class="title-line">
              <button class={`title ${task.priority === 1 ? 'p1' : ''}`}
                aria-expanded={childrenCount ? expanded : undefined}
                aria-controls={childrenCount && expanded ? `subtasks-${task.id}` : undefined}
                onClick={() => { onSelect(task.id); if (childrenCount) onExpand?.(); else onEdit(task.id); }}>
                <TitleText text={task.title} onChip={onChip} />
              </button>
              {childrenCount > 0 && (
                <>
                  <button class="subtask-toggle" aria-expanded={expanded}
                    aria-controls={expanded ? `subtasks-${task.id}` : undefined}
                    aria-label={`${expanded ? 'Ocultar' : 'Mostrar'} subtareas: ${completedCount} de ${childrenCount} completadas`}
                    onClick={onExpand}>
                    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor"
                      stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M4 3v11h3M4 7h3M10 7h6M10 14h6" />
                      <path d={expanded ? 'm13 3 2-2 2 2' : 'm13 1 2 2 2-2'} />
                    </svg>
                  </button>
                  <button class="edit-task" aria-label="Editar tarea" title="Editar tarea"
                    onClick={() => { onSelect(task.id); onEdit(task.id); }}>
                    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor"
                      stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="m3 10 7-7 3 3-7 7-4 1 1-4ZM9 4l3 3" />
                    </svg>
                  </button>
                </>
              )}
            </div>
            <div class="meta">
              <TaskChips due={task.due} period={task.period} done={!!task.done} priority={task.priority} recurrence={task.recurrence}
                topics={task.topics} people={task.people} names={names} today={today} onTap={onChip} title={task.title}
                hideDue={!task.done && ((section === 'today' && task.due === today && !task.period) || (section === 'tomorrow' && !task.period) || (section === 'week' && task.period === 'week'))} />
            </div>
          </>
        )}
      </div>
      {!isEditing && task.due && !task.done && (
        <button class="trash cal" aria-label="Añadir al calendario" title="Añadir al calendario" onClick={() => addToCalendar(task)}>
          <CalendarIcon />
        </button>
      )}
      {!isEditing && (
        <button class="trash" aria-label="Borrar tarea" title="Borrar" onClick={() => onDelete(task.id)}>
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

/** Título con los #temas y @personas resaltados; tocarlos filtra (sin abrir el editor). */
export function TitleText({ text, onChip }: { text: string; onChip: ChipTap }) {
  const parts: preact.ComponentChildren[] = [];
  let i = 0;
  for (const t of inlineTags(text)) {
    parts.push(text.slice(i, t.start));
    parts.push(
      <span key={t.start} class="tag" onClick={(e) => {
        e.stopPropagation();
        onChip(t.sym === '#' ? 'topic' : 'person', normalizeKey(t.name));
      }}>{text.slice(t.start, t.end)}</span>,
    );
    i = t.end;
  }
  parts.push(text.slice(i));
  return <>{parts}</>;
}

/** Edición en línea con la misma sintaxis que la captura. Las fechas se muestran como vence:AAAA-MM-DD
 *  para que una relativa ("mañana") no se recalcule al guardar. */
function Editor({ task, names, onSave, onCancel, onDelete, onDragStart, onAddSubtask }: {
  task: Task; names: Map<string, Entity>;
  onSave: (l: ParsedLine) => void; onCancel: () => void; onDelete: () => void;
  onDragStart?: (e: PointerEvent) => void; // asa «Mover»: arrastrar la tarea a otro día
  onAddSubtask?: () => void;
}) {
  const initial = formatLine({
    title: task.title,
    topicNames: task.topics.map((k) => names.get('#' + k)?.name ?? k),
    peopleNames: task.people.map((k) => names.get('@' + k)?.name ?? k),
    due: task.due, period: task.period, priority: task.priority, recurrence: task.recurrence,
  });
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => { ref.current?.focus(); }, []);

  const save = () => {
    if (done.current) return;
    done.current = true;
    const line = parseLine(v);
    if (v === initial || !line.title) onCancel();
    else onSave(line);
  };
  return (
    <>
      <input
        ref={ref}
        class="edit"
        value={v}
        aria-label="Editar tarea"
        autocomplete="off"
        enterkeyhint="done"
        onInput={(e) => setV(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); save(); }
          if (e.key === 'Escape') { e.preventDefault(); done.current = true; onCancel(); }
        }}
        onBlur={save}
      />
      <div class="edit-actions">
        <button class="link" onMouseDown={(e) => e.preventDefault()} onClick={save}>Guardar</button>
        {onAddSubtask && (
          <button class="link add-subtask" onMouseDown={(e) => e.preventDefault()}
            onClick={() => { save(); onAddSubtask(); }}>+ subtarea</button>
        )}
        {onDragStart && (
          <button class="link move" aria-label="Mover a otro día" title="Arrastra para cambiar de día"
            onMouseDown={(e) => e.preventDefault()} onTouchStart={(e) => e.preventDefault()} onPointerDown={onDragStart}>
            <svg class="grip" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor">
              <circle cx="5.5" cy="3.5" r="1.4" /><circle cx="10.5" cy="3.5" r="1.4" /><circle cx="5.5" cy="8" r="1.4" />
              <circle cx="10.5" cy="8" r="1.4" /><circle cx="5.5" cy="12.5" r="1.4" /><circle cx="10.5" cy="12.5" r="1.4" />
            </svg>
            Mover
          </button>
        )}
        {task.due && (prefersApple() ? (
          <>
            <button class="link" onMouseDown={(e) => e.preventDefault()} onClick={() => addToAppleCalendar(task)}><CalendarIcon />Calendario</button>
            {!touch() && <button class="link" onMouseDown={(e) => e.preventDefault()} onClick={() => addToGoogleCalendar(task)}>Google</button>}
          </>
        ) : (
          <button class="link" onMouseDown={(e) => e.preventDefault()} onClick={() => addToGoogleCalendar(task)}><CalendarIcon />Google Calendar</button>
        ))}
        <button class="link danger" onMouseDown={(e) => { e.preventDefault(); done.current = true; }} onClick={onDelete}>
          Borrar
        </button>
      </div>
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
