import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Entity } from '../types';
import { normalizeKey, parseLine } from '../parser';
import { todayISO } from '../lib/date';
import { TaskChips } from './Chips';
import { PriorityIcon, RepeatIcon } from './Priority';

export const INTRO_KEY = 'lista.intro';

interface Props {
  onClose: () => void;
  signIn?: () => void; // solo si se puede entrar con Google
  extended?: boolean; // abierta desde Ajustes: el último botón dice «Listo» en vez de «Empezar»
}

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** En táctil (móvil) se dice "este móvil"; con ratón (ordenador) "este ordenador". */
const device = () => (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? 'móvil' : 'ordenador');

const SLIDES = [
  {
    title: 'Una lista. Nada más.',
    text: () => 'Sin IA, sin anuncios y sin avisos que te persigan. Escribes lo que tienes pendiente y te olvidas. Sencilla, rápida y tuya.',
    Demo: CoverDemo,
  },
  { title: 'Escribe en una línea', text: () => 'Fecha, tema, prioridad y repetición se detectan al escribir. Las tareas que se repiten vuelven solas.', Demo: TypingDemo },
  { title: 'Completa y filtra', text: () => 'Desliza a la derecha para completar. Toca una persona o un tema y verás solo sus tareas.', Demo: SwipeDemo },
  {
    title: 'Tus datos, contigo',
    text: () => `Todo se guarda solo en este ${device()} y funciona sin conexión, sin cuenta. Si quieres tenerlo también en otros dispositivos, entra con Google para sincronizar.`,
    Demo: DevicesDemo,
    google: true,
  },
];

/** Con ratón (ordenador) se enseñan también los atajos de teclado. */
const hasKeyboard = () => typeof matchMedia !== 'undefined' && matchMedia('(hover: hover) and (pointer: fine)').matches;

/** Referencia de todo lo que se puede escribir (al final de la bienvenida). */
const EXTRA = [
  { title: 'Fechas como las dirías', text: () => 'Escribe el día con palabras o con números. Los periodos vencen al final: la semana, el viernes.', Demo: DatesDemo },
  { title: 'Prioridad y repetición', text: () => 'Marca lo importante con !alta, !media o !baja. Con «cada» la tarea vuelve sola al completarla.', Demo: PrioRepeatDemo },
  { title: 'Atajos de teclado', text: () => 'Sin soltar el teclado: escribe, muévete por la lista, completa y filtra.', Demo: KeysDemo, keyboard: true },
];

type Slide = { title: string; text: () => string; Demo: () => preact.JSX.Element; google?: boolean; keyboard?: boolean };

/** Icono de Google monocromo (solo la G, trazo fino, currentColor). */
function GoogleG({ class: cls }: { class?: string }) {
  return (
    <svg class={cls} viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none"
      stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18.93 8A8 8 0 1 0 20 12H12.4" />
    </svg>
  );
}

const FOCUSABLE = 'button:not([disabled])';

/** Bienvenida completa: portada, tres pasos y referencia. Se muestra la primera vez y desde Ajustes → Cómo funciona. */
export function Onboarding({ onClose, signIn, extended }: Props) {
  // Siempre todas: portada, los tres pasos y la referencia (fechas, prioridad y repetición; teclado solo con ratón).
  const [slides] = useState<Slide[]>(() => [...SLIDES, ...EXTRA.filter((s) => !s.keyboard || hasKeyboard())]);
  const [i, setI] = useState(0);
  const last = i === slides.length - 1;
  const { Demo } = slides[i];
  const next = () => (last ? onClose() : setI(i + 1));
  const prev = () => setI(Math.max(0, i - 1));
  const card = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);

  // El foco va al botón principal al abrir y vuelve a quien abrió la bienvenida al cerrar.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    primary.current?.focus();
    return () => before?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        // Foco atrapado dentro de la tarjeta (es un diálogo modal).
        const items = [...(card.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
        if (!items.length) return;
        const first = items[0];
        const lastItem = items[items.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || !card.current?.contains(active))) { e.preventDefault(); lastItem.focus(); }
        else if (!e.shiftKey && (active === lastItem || !card.current?.contains(active))) { e.preventDefault(); first.focus(); }
        return;
      }
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') { if (!last) next(); }
      else if (e.key === 'ArrowLeft') { if (i > 0) prev(); }
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  return (
    <div class="intro" role="dialog" aria-modal="true" aria-label="Cómo funciona">
      <div class="intro-card" ref={card}
        onTouchStart={(e) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
        onTouchEnd={(e) => {
          const t = touch.current;
          touch.current = null;
          if (!t) return;
          const dx = e.changedTouches[0].clientX - t.x;
          if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(e.changedTouches[0].clientY - t.y)) return;
          if (dx < 0 && !last) next();
          else if (dx > 0 && i > 0) prev();
        }}>
        <div class="bar">
          <span class="label" aria-live="polite">{i + 1} / {slides.length}</span>
          <button class="link" onClick={onClose}>Saltar</button>
        </div>
        <div class="intro-stage" key={i}>
          <Fit><Demo /></Fit>
        </div>
        {/* Los textos se apilan en la misma celda: la tarjeta mide siempre lo mismo entre slides. */}
        <div class="intro-copy">
          {slides.map((s, k) => (
            <div key={k} class={`intro-text ${k === i ? 'on' : ''}`} aria-hidden={k !== i}>
              <h2>{s.title}</h2>
              <p>{s.text()}</p>
            </div>
          ))}
        </div>
        <div class="intro-foot">
          <span class="intro-dots">
            {slides.map((_, k) => (
              <button key={k} class={k === i ? 'on' : ''} aria-label={`Ir a la diapositiva ${k + 1}`}
                aria-current={k === i ? 'step' : undefined} onClick={() => setI(k)}>
                <i />
              </button>
            ))}
          </span>
          <span class="row-btns">
            {slides[i].google && signIn && <button class="btn btn-google" onClick={() => { onClose(); signIn(); }}><GoogleG />Entrar con Google</button>}
            <button class="btn solid" onClick={next} ref={primary}>{last ? (extended ? 'Listo' : 'Empezar') : 'Siguiente'}</button>
          </span>
        </div>
      </div>
    </div>
  );
}

/** Reduce la ilustración si no cabe en el hueco (pantallas bajas o estrechas), sin cambiar su diseño. */
function Fit({ children }: { children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = ref.current;
    const stage = box?.parentElement;
    const inner = box?.firstElementChild as HTMLElement | null | undefined;
    if (!box || !stage || !inner) return;
    const fit = () => {
      const cs = getComputedStyle(stage);
      const w = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const k = Math.min(1, w / inner.offsetWidth, h / inner.offsetHeight);
      box.style.setProperty('--fit', String(k > 0 ? k : 1));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(stage);
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);
  return <div class="demo-fit" ref={ref}>{children}</div>;
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
      <div class="demo-input"><span>{text}<span class="demo-caret" /></span></div>
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

/** Lista por días: una tarea se desliza y queda hecha; al tocar @ana se pliegan las que no son suyas. */
function SwipeDemo() {
  // [clave, día (cabecera antes de la fila), texto, ¿es de @ana?]
  const rows: Array<[string, string | null, string, boolean]> = [
    ['a', 'Hoy', 'Llamar a @ana', true],
    ['b', null, 'Comprar pan #casa', false],
    ['c', 'Mañana', 'Enviar propuesta a @ana', true],
    ['d', null, 'Pagar luz #casa', false],
    ['e', 'Esta semana', 'Preparar reunión #trabajo', false],
    ['f', null, 'Revisar notas con @ana', true],
  ];
  const list = useRef<HTMLDivElement>(null);
  // Posiciones del dedo medidas en el DOM (no en píxeles fijos): valen con cualquier fuente o ancho.
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const place = () => {
      const tap = el.querySelector<HTMLElement>('.demo-tap');
      const b = el.querySelector<HTMLElement>('.demo-row.b');
      if (!tap || !b) return;
      el.style.setProperty('--tap-x', `${tap.offsetLeft + tap.offsetWidth / 2}px`);
      el.style.setProperty('--tap-y', `${tap.offsetTop + tap.offsetHeight / 2}px`);
      el.style.setProperty('--row-y', `${b.offsetTop + b.offsetHeight / 2}px`);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const text = (t: string, tap: boolean) =>
    t.split(/(\s+)/).map((w, i) => (/^[#@]/.test(w)
      ? <span key={i} class={`tag ${tap && w === '@ana' ? 'demo-tap' : ''}`}>{w}</span>
      : w));
  return (
    <div class={`demo-list ${reduced() ? 'still' : ''}`} ref={list}>
      {rows.map(([k, day, title, ana]) => [
        day && <div key={day} class="demo-day">{day}</div>,
        <div key={k} class={`demo-row ${k} ${ana ? 'keep' : 'hide'}`}>
          <span class="demo-check"><i /></span>
          <span class="demo-title">{text(title, k === 'a')}</span>
        </div>,
      ])}
      <span class="demo-finger" />
    </div>
  );
}

/** Primero solo el móvil (local, con candado); después el ordenador sincronizado. */
function DevicesDemo() {
  const where = device();
  const desk = where === 'ordenador';
  const lines = (
    <>
      <span class="demo-line"><i /><b /><em><PriorityIcon p={1} /></em></span>
      <span class="demo-line"><i /><b /></span>
      <span class="demo-line"><i /><b /></span>
    </>
  );
  // Candado: en el dispositivo local (móvil o portátil según dónde se abra).
  const lock = (cls: string) => (
    <svg class={`demo-lock ${cls}`} viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" fill="none"
      stroke="currentColor" stroke-width="1.1" stroke-linecap="round">
      <rect x="2.5" y="5.5" width="7" height="5" rx="1" /><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" />
    </svg>
  );
  return (
    <div class={`demo-devices ${desk ? 'desk' : ''} ${reduced() ? 'still' : ''}`}>
      <div class="demo-pair">
        <div class="demo-phone">
          {lock('demo-lock-phone')}
          {lines}
        </div>
        <span class="demo-syncwrap">
          <svg class="demo-sync" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none"
            stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 9h14l-3-3M20 15H6l3 3" />
          </svg>
          <GoogleG class="demo-g" />
        </span>
        <div class="demo-laptop">
          {lock('demo-lock-desk')}
          {lines}
        </div>
      </div>
      <div class="demo-captions label">
        <span class="local">Solo en este {where}</span>
        <span class="synced">Sincronizado · solo tú lo ves</span>
      </div>
    </div>
  );
}

/** Portada: el nombre y tres tareas que se marcan despacio, una a una. */
function CoverDemo() {
  return (
    <div class={`cover ${reduced() ? 'still' : ''}`}>
      <span class="cover-brand">Lista</span>
      <span class="cover-lines" aria-hidden="true">
        {[0, 1, 2].map((k) => <span key={k} class={`cover-line l${k}`}><i /><b /></span>)}
      </span>
    </div>
  );
}

/* ---------- slides de referencia (versión extendida) ---------- */

const chips = (list: string[]) => <span class="ref-chips">{list.map((c) => <code key={c} class="chip">{c}</code>)}</span>;

/** Fechas y periodos que entiende la caja de captura. */
function DatesDemo() {
  return (
    <div class="ref">
      <div class="ref-group"><span class="label">Día</span>{chips(['hoy', 'mañana', 'pasado', 'el viernes', '15 nov', 'en 3 días'])}</div>
      <div class="ref-group"><span class="label">Periodo</span>{chips(['esta semana', 'este mes', 'este trimestre', 'este año'])}</div>
      <div class="ref-group"><span class="label">Exacta</span>{chips(['vence:15/11', 'vence:2026-11-15'])}</div>
    </div>
  );
}

/** Prioridades con su icono y repeticiones. */
function PrioRepeatDemo() {
  const prio: Array<[string, 1 | 2 | 3]> = [['!alta', 1], ['!media', 2], ['!baja', 3]];
  return (
    <div class="ref">
      <div class="ref-group">
        <span class="label">Prioridad</span>
        <span class="ref-chips">
          {prio.map(([w, p]) => (
            <span key={w} class="ref-pair"><code class="chip">{w}</code><span class={`chip ${p === 1 ? 'warn' : ''}`}><PriorityIcon p={p} /></span></span>
          ))}
        </span>
      </div>
      <div class="ref-group">
        <span class="label">Repetir</span>
        <span class="ref-chips">
          {['cada día', 'cada lunes', 'cada mes', 'cada año'].map((c) => <span key={c} class="chip"><RepeatIcon /> {c}</span>)}
        </span>
      </div>
    </div>
  );
}

const KEYS: Array<[string[], string]> = [
  [['⌘K', '/', 'n'], 'escribir tarea'],
  [['j', 'k'], 'moverse por la lista'],
  [['x'], 'completar'],
  [['e'], 'editar'],
  [['⌫'], 'borrar'],
  [['h', 's', 'v'], 'hoy · semana · vencidas'],
  [['f'], 'buscar'],
  [['esc'], 'limpiar filtro'],
];

/** Atajos de teclado (solo en ordenador). */
function KeysDemo() {
  return (
    <dl class="keys ref-keys">
      {KEYS.map(([keys, what]) => (
        <div key={what}>
          <dt>{keys.map((k) => <kbd key={k}>{k}</kbd>)}</dt>
          <dd>{what}</dd>
        </div>
      ))}
    </dl>
  );
}
