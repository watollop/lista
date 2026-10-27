import { useEffect, useRef, useState } from 'preact/hooks';
import type { Entity } from '../types';
import { normalizeKey, parseLine } from '../parser';
import { todayISO } from '../lib/date';
import { TaskChips } from './Chips';
import { PriorityIcon } from './Priority';

export const INTRO_KEY = 'lista.intro';

interface Props {
  onClose: () => void;
  signIn?: () => void; // solo si se puede entrar con Google
}

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const SLIDES = [
  { title: 'Escribe en una línea', text: 'Fecha, tema, persona y prioridad se detectan al escribir.', Demo: TypingDemo },
  { title: 'Completa y filtra', text: 'Desliza a la derecha para completar. Toca un tema o una persona para ver solo eso.', Demo: SwipeDemo },
  { title: 'En todos tus dispositivos', text: 'Funciona sin conexión. Entra con Google para tener la misma lista en el móvil y el ordenador.', Demo: DevicesDemo },
];

/** Bienvenida en tres pasos. Se muestra la primera vez y desde Ajustes → Cómo funciona. */
export function Onboarding({ onClose, signIn }: Props) {
  const [i, setI] = useState(0);
  const last = i === SLIDES.length - 1;
  const next = () => (last ? onClose() : setI(i + 1));
  const prev = () => setI(Math.max(0, i - 1));
  const touch = useRef<{ x: number; y: number } | null>(null);
  const { title, text, Demo } = SLIDES[i];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  return (
    <div class="intro" role="dialog" aria-modal="true" aria-label="Cómo funciona">
      <div class="intro-card"
        onTouchStart={(e) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
        onTouchEnd={(e) => {
          const t = touch.current;
          touch.current = null;
          if (!t) return;
          const dx = e.changedTouches[0].clientX - t.x;
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.changedTouches[0].clientY - t.y)) (dx < 0 ? next : prev)();
        }}>
        <div class="bar">
          <span class="label">{i + 1} / {SLIDES.length}</span>
          <button class="link" onClick={onClose}>Saltar</button>
        </div>
        <div class="intro-stage" key={i}><Demo /></div>
        <h2>{title}</h2>
        <p>{text}</p>
        <div class="intro-foot">
          <span class="intro-dots" aria-hidden="true">
            {SLIDES.map((_, k) => <i key={k} class={k === i ? 'on' : ''} />)}
          </span>
          <span class="row-btns">
            {last && signIn && <button class="btn" onClick={() => { onClose(); signIn(); }}>Entrar con Google</button>}
            <button class="btn solid" onClick={next} autoFocus>{last ? 'Empezar' : 'Siguiente'}</button>
          </span>
        </div>
      </div>
    </div>
  );
}

const DEMO_LINE = 'Llamar a Ana mañana #trabajo !alta';

/** La frase se escribe sola y los chips aparecen con el parser real. */
function TypingDemo() {
  const [n, setN] = useState(() => (reduced() ? DEMO_LINE.length : 0));
  useEffect(() => {
    if (reduced()) return;
    const id = setInterval(() => setN((k) => (k >= DEMO_LINE.length + 25 ? 0 : k + 1)), 70);
    return () => clearInterval(id);
  }, []);
  const text = DEMO_LINE.slice(0, n);
  // Los chips aparecen cuando la palabra está completa (al escribir el espacio o al final).
  const done = n >= DEMO_LINE.length ? text : text.slice(0, text.lastIndexOf(' ') + 1);
  const p = parseLine(done);
  const names = new Map<string, Entity>(p.topics.map((t) => ['#' + normalizeKey(t), { key: normalizeKey(t), name: t } as Entity]));
  return (
    <div class="demo-type">
      <div class="demo-input">{text}<span class="demo-caret" /></div>
      <div class="demo-chips">
        <TaskChips due={p.due} priority={p.priority} recurrence={null} topics={p.topics.map(normalizeKey)}
          people={[]} names={names} today={todayISO()} />
      </div>
    </div>
  );
}

/** Una tarea se desliza y queda hecha; luego se "toca" un chip. */
function SwipeDemo() {
  return (
    <div class={`demo-list ${reduced() ? 'still' : ''}`}>
      <div class="demo-row a">
        <span class="demo-check"><i /></span>
        <span class="demo-title">Llamar a Ana</span>
        <span class="chip">hoy</span>
      </div>
      <div class="demo-row b">
        <span class="demo-check"><i /></span>
        <span class="demo-title">Enviar propuesta</span>
        <span class="chip demo-tap">#trabajo</span>
      </div>
      <span class="demo-finger" />
    </div>
  );
}

/** Ordenador y móvil con la misma lista. */
function DevicesDemo() {
  const lines = (
    <>
      <span class="demo-line"><i /><b /><em><PriorityIcon p={1} /></em></span>
      <span class="demo-line"><i /><b /></span>
      <span class="demo-line"><i /><b /></span>
    </>
  );
  return (
    <div class={`demo-devices ${reduced() ? 'still' : ''}`}>
      <div class="demo-laptop">{lines}</div>
      <svg class="demo-sync" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none"
        stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 9h14l-3-3M20 15H6l3 3" />
      </svg>
      <div class="demo-phone">{lines}</div>
    </div>
  );
}
