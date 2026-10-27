import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Entity, ID, ISODate, ParsedLine, Task } from '../types';
import { formatLine, inlineTags, normalizeKey, parseLine } from '../parser';
import { TaskChips, type ChipTap } from './Chips';
import { isCurrentPeriod, periodEnd } from '../lib/period';
import { addDays } from '../lib/date';

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
}

type SectionKey = 'past' | 'overdue' | 'today' | 'tomorrow' | 'week' | 'next' | 'nodate' | 'done';
const SECTION_LABEL: Record<SectionKey, string> = {
  past: 'Pasadas', overdue: 'Vencidas', today: 'Hoy', tomorrow: 'Mañana', week: 'Esta semana',
  next: 'Próximas', nodate: 'Sin fecha', done: 'Completadas',
};
const SECTION_ORDER = Object.keys(SECTION_LABEL) as SectionKey[];

function sectionOf(t: Task, today: ISODate, doneToday: Set<ID>, pastMode: boolean): SectionKey {
  if (t.done && !doneToday.has(t.id)) return pastMode ? 'past' : 'done';
  if (!t.due) return 'nodate';
  if (t.due < today) return 'overdue';
  // "Esta semana" llega hasta el viernes e incluye las de periodo "esta semana"; mes/Q/año van a Próximas.
  if (t.period) return t.period === 'week' && isCurrentPeriod('week', t.due, today) ? 'week' : 'next';
  if (t.due === today) return 'today';
  if (t.due === addDays(today, 1)) return 'tomorrow';
  return t.due <= periodEnd('week', today) ? 'week' : 'next';
}

export function TaskList(props: Props) {
  const { groups, today } = props;
  const byKey = new Map<SectionKey, Group[]>();
  for (const g of groups) {
    const key = sectionOf(g.task, today, props.doneToday, props.pastMode);
    byKey.set(key, [...(byKey.get(key) ?? []), g]);
  }
  const sections = SECTION_ORDER.filter((k) => byKey.has(k)).map((key) => ({ key, items: byKey.get(key)! }));
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
    const header = (document.querySelector('.top') as HTMLElement | null)?.offsetHeight ?? 0;
    window.scrollTo({ top: nowRef.current.getBoundingClientRect().top + window.scrollY - header });
  });

  const render = (s: { key: SectionKey; items: Group[] }) => (
    <section key={s.key} class={s.key === 'past' ? 'past' : ''}>
      <h2 class={`section ${s.key === 'overdue' ? 'warn' : ''}`}>
        <span>{SECTION_LABEL[s.key]}</span>
        <span>{s.items.length}</span>
      </h2>
      <ul class="list">
        {s.items.map((g) => [
          <Row key={g.task.id} task={g.task} {...props} />,
          ...g.children.map((c) => <Row key={c.id} task={c} sub {...props} />),
        ])}
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

function Row({ task, sub, names, today, selected, editing, onSelect, onEdit, onToggle, onSave, onDelete, onChip }:
  Props & { task: Task; sub?: boolean }) {
  const isEditing = editing === task.id;
  const ref = useRef<HTMLLIElement>(null);
  const swipe = useSwipe(() => onToggle(task.id), () => onDelete(task.id), !isEditing);
  useEffect(() => {
    if (selected === task.id) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    <li
      ref={ref}
      class={`row ${sub ? 'sub' : ''} ${task.done ? 'done' : ''} ${selected === task.id ? 'sel' : ''} ${swipe.active ? 'swiping' : ''}`}
      data-id={task.id}
      data-swipe={task.done ? 'Pendiente' : 'Hecha'}
      data-swipe-left="Borrar"
      style={swipe.style}
      {...swipe.handlers}
    >
      <button class="check" aria-label={task.done ? 'Marcar pendiente' : 'Completar'} onClick={() => onToggle(task.id)}>
        <i />
      </button>
      <div class="body">
        {isEditing ? (
          <Editor task={task} names={names} onSave={(l) => onSave(task.id, l)} onCancel={() => onEdit(null)}
            onDelete={() => onDelete(task.id)} />
        ) : (
          <>
            <button class={`title ${task.priority === 1 ? 'p1' : ''}`} onClick={() => { onSelect(task.id); onEdit(task.id); }}>
              <TitleText text={task.title} onChip={onChip} />
            </button>
            <div class="meta">
              <TaskChips due={task.due} period={task.period} done={!!task.done} priority={task.priority} recurrence={task.recurrence}
                topics={task.topics} people={task.people} names={names} today={today} onTap={onChip} title={task.title} />
            </div>
          </>
        )}
      </div>
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
function Editor({ task, names, onSave, onCancel, onDelete }: {
  task: Task; names: Map<string, Entity>;
  onSave: (l: ParsedLine) => void; onCancel: () => void; onDelete: () => void;
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
        <button class="link danger" onMouseDown={(e) => { e.preventDefault(); done.current = true; }} onClick={onDelete}>
          Borrar
        </button>
      </div>
    </>
  );
}
