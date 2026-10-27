import { useRef, useState } from 'preact/hooks';
import type { ID } from '../types';
import type { DropTarget } from '../lib/reschedule';

/** Arrastre en curso (solo uno a la vez); el deslizamiento lateral lo consulta para no competir. */
export const dragging = { id: null as ID | null };

const HOLD_MS = 450; // táctil: mantener pulsado para levantar la tarea
const SLOP = 8; // px de margen antes de decidir el gesto
const EDGE = 90; // px desde el borde que hacen scroll automático
const GRAB = 48; // px máximos entre el borde izquierdo de la tarea arrastrada y el cursor

/**
 * Arrastrar una tarea a otro bloque de la lista. Táctil: mantener pulsado y mover; ratón: mover unos px.
 * Los destinos son elementos con data-drop="today|tomorrow|week|next|nodate".
 */
export function useDrag(id: ID, enabled: boolean, onStart: () => void, onEnd: (target: DropTarget | null) => void) {
  const [d, setD] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(false);
  const justDragged = useRef(false);
  const press = useRef<{ x: number; y: number; el: HTMLElement; timer?: ReturnType<typeof setTimeout>; mouse: boolean } | null>(null);

  const begin = (startX: number, startY: number) => {
    const p = press.current;
    if (!p) return;
    clearTimeout(p.timer);
    dragging.id = id;
    setActive(true);
    onStart();
    navigator.vibrate?.(15);
    let over: HTMLElement | null = null;
    let lastY = startY;
    // La fila debe quedar bajo el dedo aunque la lista cambie (aparecen bloques vacíos) o haga scroll:
    // se mide dónde está sin el desplazamiento y se corrige.
    const el = p.el;
    const r0 = el.getBoundingClientRect();
    const t = { x: 0, y: 0 };
    // Agarre: el cursor queda cerca del borde izquierdo de la tarjeta, donde está el texto (aunque se pulsara lejos).
    const grab = Math.min(startX - r0.left, GRAB);
    const place = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect();
      t.x = cx - grab - (r.left - t.x);
      t.y = r0.top + (cy - startY) - (r.top - t.y);
      setD({ x: t.x, y: t.y });
    };
    let lastX = startX;
    let raf = 0;
    const scroll = () => {
      const v = lastY < EDGE ? -12 : lastY > innerHeight - EDGE - 60 ? 12 : 0;
      if (v) window.scrollBy(0, v);
      place(lastX, lastY);
      raf = requestAnimationFrame(scroll);
    };
    raf = requestAnimationFrame(scroll);
    const move = (e: PointerEvent) => {
      lastY = e.clientY;
      lastX = e.clientX;
      const hit = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-drop]') ?? null;
      if (hit !== over) { over?.classList.remove('drop-on'); hit?.classList.add('drop-on'); over = hit; }
    };
    const noScroll = (e: TouchEvent) => e.preventDefault();
    const end = (e: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      document.removeEventListener('touchmove', noScroll);
      cancelAnimationFrame(raf);
      over?.classList.remove('drop-on');
      const target = e.type === 'pointerup' ? (over?.dataset.drop as DropTarget | undefined) ?? null : null;
      dragging.id = null;
      press.current = null;
      justDragged.current = true;
      setActive(false);
      setD({ x: 0, y: 0 });
      onEnd(target);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    document.addEventListener('touchmove', noScroll, { passive: false }); // que el dedo arrastre y no haga scroll
  };

  const cancel = () => { clearTimeout(press.current?.timer); press.current = null; };

  const handlers = {
    onPointerDown: (e: PointerEvent) => {
      if (!enabled || e.button !== 0 || (e.target as HTMLElement).closest('input, .check, .trash, .edit-actions')) return;
      const mouse = e.pointerType === 'mouse';
      const y = e.clientY;
      const x = e.clientX;
      const el = e.currentTarget as HTMLElement;
      press.current = { x, y, el, mouse, timer: mouse ? undefined : setTimeout(() => begin(x, y), HOLD_MS) };
    },
    onPointerMove: (e: PointerEvent) => {
      const p = press.current;
      if (!p || dragging.id) return;
      const far = Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP;
      if (!far) return;
      if (p.mouse) begin(p.x, p.y); // ratón: arrastrar en cuanto se mueve
      else cancel(); // táctil: si se mueve antes de mantener pulsado, es scroll o deslizamiento
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    // Tras soltar no debe abrirse el editor (el clic llega al título).
    onClickCapture: (e: MouseEvent) => {
      if (justDragged.current) { e.preventDefault(); e.stopPropagation(); justDragged.current = false; }
    },
  };
  return { handlers, active, style: active ? { '--drag-x': `${d.x}px`, '--drag-y': `${d.y}px` } : undefined };
}
