import { useEffect, useRef, useState } from 'preact/hooks';
import type { Entity, ID, ISODate, ParsedLine, Task } from '../types';
import { formatLine, parseLine } from '../parser';
import { TaskChips, type ChipTap } from './Chips';

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
}

type SectionKey = 'overdue' | 'today' | 'next' | 'nodate' | 'done';
const SECTION_LABEL: Record<SectionKey, string> = {
  overdue: 'Vencidas', today: 'Hoy', next: 'Próximas', nodate: 'Sin fecha', done: 'Completadas',
};

function sectionOf(t: Task, today: ISODate, doneToday: Set<ID>): SectionKey {
  if (t.done && !doneToday.has(t.id)) return 'done';
  if (!t.due) return 'nodate';
  if (t.due < today) return 'overdue';
  return t.due === today ? 'today' : 'next';
}

export function TaskList(props: Props) {
  const { groups, today } = props;
  const sections: Array<{ key: SectionKey; items: Group[] }> = [];
  for (const g of groups) {
    const key = sectionOf(g.task, today, props.doneToday);
    const last = sections[sections.length - 1];
    if (last?.key === key) last.items.push(g);
    else sections.push({ key, items: [g] });
  }
  return (
    <>
      {sections.map((s) => (
        <section key={s.key}>
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
      ))}
    </>
  );
}

function Row({ task, sub, names, today, selected, editing, onSelect, onEdit, onToggle, onSave, onDelete, onChip }:
  Props & { task: Task; sub?: boolean }) {
  const isEditing = editing === task.id;
  const ref = useRef<HTMLLIElement>(null);
  const swipe = useSwipeRight(() => onToggle(task.id), !isEditing);
  useEffect(() => {
    if (selected === task.id) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    <li
      ref={ref}
      class={`row ${sub ? 'sub' : ''} ${task.done ? 'done' : ''} ${selected === task.id ? 'sel' : ''} ${swipe.active ? 'swiping' : ''}`}
      data-id={task.id}
      data-swipe={task.done ? 'Pendiente' : 'Hecha'}
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
              {task.title}
            </button>
            <div class="meta">
              <TaskChips due={task.due} done={!!task.done} priority={task.priority} recurrence={task.recurrence}
                topics={task.topics} people={task.people} names={names} today={today} onTap={onChip} />
            </div>
          </>
        )}
      </div>
    </li>
  );
}

const SWIPE_MIN = 72; // px; o un tercio del ancho de la fila si es mayor

/** Deslizar a la derecha (táctil) completa la tarea. El scroll vertical sigue siendo del navegador (touch-action: pan-y). */
function useSwipeRight(onSwipe: () => void, enabled: boolean) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const [dx, setDx] = useState(0);
  const reset = () => { start.current = null; setDx(0); };

  const handlers = {
    onPointerDown: (e: PointerEvent) => {
      if (!enabled || e.pointerType === 'mouse') return;
      start.current = { x: e.clientX, y: e.clientY };
      moved.current = false;
    },
    onPointerMove: (e: PointerEvent) => {
      const s = start.current;
      if (!s) return;
      const x = e.clientX - s.x;
      const y = e.clientY - s.y;
      if (!moved.current) {
        if (Math.abs(y) > 10 && Math.abs(y) > Math.abs(x)) { reset(); return; }
        if (x < 10) return;
        moved.current = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }
      setDx(Math.max(0, x));
    },
    onPointerUp: (e: PointerEvent) => {
      const width = (e.currentTarget as HTMLElement).offsetWidth;
      if (moved.current && dx > Math.max(SWIPE_MIN, width / 3)) onSwipe();
      reset();
    },
    onPointerCancel: reset,
    // Tras un deslizamiento no debe abrirse el editor ni pulsarse el check.
    onClickCapture: (e: MouseEvent) => {
      if (moved.current) { e.preventDefault(); e.stopPropagation(); moved.current = false; }
    },
  };
  const style = dx ? { '--dx': `${dx}px`, '--swipe': Math.min(1, dx / SWIPE_MIN) } : undefined;
  return { handlers, style, active: dx > 0 };
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
    due: task.due, priority: task.priority, recurrence: task.recurrence,
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
