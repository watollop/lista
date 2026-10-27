import { useEffect, useRef, useState } from 'preact/hooks';
import type { Entity } from '../types';
import { normalizeKey, parseLine } from '../parser';
import { todayISO } from '../lib/date';
import { TaskChips } from './Chips';
import { PriorityIcon, RepeatIcon } from './Priority';

export const INTRO_KEY = 'lista.intro';

interface Props {
  onClose: () => void;
  signIn?: () => void; // solo si se puede entrar con Google
}

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const SLIDES = [
  { title: 'Escribe en una línea', text: 'Fecha, tema, prioridad y repetición se detectan al escribir. Las tareas que se repiten vuelven solas.', Demo: TypingDemo },
  { title: 'Completa y filtra', text: 'Desliza a la derecha para completar. Toca un tema y verás solo sus tareas.', Demo: SwipeDemo },
  {
    title: 'Tus datos, contigo',
    text: 'Todo se guarda en tu dispositivo y funciona sin conexión, sin cuenta. Si quieres, entra con Google para sincronizar móvil y ordenador: solo tú puedes ver tu lista.',
    Demo: DevicesDemo,
  },
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

const DEMO_LINE = 'Revisar ventas cada lunes #trabajo !alta';

/** La frase se escribe sola y los chips aparecen con el parser real. */
function TypingDemo() {
  const [n, setN] = useState(() => (reduced() ? DEMO_LINE.length : 0));
  useEffect(() => {
    if (reduced()) return;
    // +45 pasos de 70 ms: ~3 s de pausa con la frase completa antes de repetir
    const id = setInterval(() => setN((k) => (k >= DEMO_LINE.length + 45 ? 0 : k + 1)), 70);
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
        <TaskChips due={p.due} priority={p.priority} recurrence={p.recurrence} topics={p.topics.map(normalizeKey)}
          people={[]} names={names} today={todayISO()} />
      </div>
      <p class={`demo-repeat ${p.recurrence ? 'on' : ''}`}>
        <RepeatIcon /> Al completarla, vuelve sola el lunes siguiente
      </p>
    </div>
  );
}

/** Una tarea se desliza y queda hecha; al tocar #trabajo se pliegan las demás. */
function SwipeDemo() {
  const rows: Array<[string, string, string]> = [
    ['a', 'Llamar a Ana', 'hoy'],
    ['b', 'Enviar propuesta', '#trabajo'],
    ['c', 'Comprar pan', '#casa'],
    ['d', 'Preparar reunión', '#trabajo'],
    ['e', 'Pedir cita médico', '#personal'],
  ];
  return (
    <div class={`demo-list ${reduced() ? 'still' : ''}`}>
      {rows.map(([k, title, chip]) => (
        <div key={k} class={`demo-row ${k} ${chip === '#trabajo' ? 'keep' : 'hide'}`}>
          <span class="demo-check"><i /></span>
          <span class="demo-title">{title}</span>
          <span class={`chip ${k === 'b' ? 'demo-tap' : ''}`}>{chip}</span>
        </div>
      ))}
      <span class="demo-finger" />
    </div>
  );
}

/** Primero solo el móvil (local, con candado); después el ordenador sincronizado. */
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
      <div class="demo-pair">
        <div class="demo-phone">
          <svg class="demo-lock" viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" fill="none"
            stroke="currentColor" stroke-width="1.1" stroke-linecap="round">
            <rect x="2.5" y="5.5" width="7" height="5" rx="1" /><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" />
          </svg>
          {lines}
        </div>
        <svg class="demo-sync" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none"
          stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 9h14l-3-3M20 15H6l3 3" />
        </svg>
        <div class="demo-laptop">{lines}</div>
      </div>
      <div class="demo-captions label">
        <span class="local">Solo en este dispositivo</span>
        <span class="synced">Sincronizado · solo tú lo ves</span>
      </div>
    </div>
  );
}
