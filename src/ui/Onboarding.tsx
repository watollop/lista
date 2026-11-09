import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Entity } from '../types';
import { normalizeKey, parseLine } from '../parser';
import { todayISO } from '../lib/date';
import { TaskChips } from './Chips';
import { PriorityIcon, RepeatIcon } from './Priority';
import { SHORTCUTS } from './shortcuts';
import { isEn, tr } from '../i18n';


interface Props {
  onClose: () => void;
  signIn?: () => void; // solo si se puede entrar con Google
  extended?: boolean; // abierta desde Ajustes: el último botón dice «Listo» en vez de «Empezar»
}

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** En táctil (móvil) se dice "este móvil"; con ratón (ordenador) "este ordenador". */
const isPhone = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
const device = () => (isPhone() ? tr('móvil', 'phone') : tr('ordenador', 'computer'));
/** Cómo se crea una lista: igual en móvil y ordenador, con el + de las pestañas. */
const createHow = () => tr('con el + junto a tus listas', 'with the + next to your lists');

// Funciones, no constantes: los textos dependen del idioma, que se fija al arrancar (después de importar los módulos).
const SLIDES = (): Slide[] => [
  {
    title: tr('Una lista. Nada más.', 'A list. Nothing more.'),
    text: () => tr('Sin IA, sin anuncios y sin avisos que te persigan. Escribes lo que tienes pendiente y te olvidas. Sencilla, rápida y tuya.',
      'No AI, no ads and no nagging notifications. Write down what you need to do and forget about it. Simple, fast and yours.'),
    Demo: CoverDemo,
  },
  { title: tr('Escribe en una línea', 'Write it in one line'), text: () => tr('Fecha, tema, prioridad y repetición se detectan al escribir. Las tareas que se repiten vuelven solas.', 'Date, topic, priority and repeat are picked up as you type. Repeating tasks come back on their own.'), Demo: TypingDemo },
  { title: tr('Completa y filtra', 'Complete and filter'), text: () => tr('Desliza a la derecha para completar. Toca una persona o un tema y verás solo sus tareas. Las vencidas siempre están arriba.', 'Swipe right to complete. Tap a person or a topic to see only their tasks. Overdue tasks are always at the top.'), Demo: SwipeDemo },
  {
    title: tr('Más listas, si las necesitas', 'More lists, if you need them'),
    text: () => tr(`Empiezas con una: Personal. Crea otra para la compra o el trabajo ${createHow()} y compártela si quieres editarla con alguien. Y escribe /compra para apuntar en ella sin cambiar de lista.`,
      `You start with one: Personal. Create another for shopping or work ${createHow()} and share it if you want to edit it with someone. And type /shopping to add to it without switching lists.`),
    Demo: ListsDemo,
  },
  {
    title: tr('Tus datos, contigo', 'Your data stays with you'),
    text: () => tr(`Todo se guarda solo en este ${device()} y funciona sin conexión, sin cuenta. Si quieres tenerlo también en otros dispositivos, entra con Google para sincronizar.`,
      `Everything is stored only on this ${device()} and works offline, with no account. To have it on your other devices too, sign in with Google to sync.`),
    Demo: DevicesDemo,
    google: true,
  },
];

/** Con ratón (ordenador) se enseñan también los atajos de teclado. */
const hasKeyboard = () => typeof matchMedia !== 'undefined' && matchMedia('(hover: hover) and (pointer: fine)').matches;

/** Referencia de todo lo que se puede escribir (al final de la bienvenida). */
const EXTRA = (): Slide[] => [
  { title: tr('Fechas como las dirías', 'Dates the way you’d say them'), text: () => tr('Escribe el día con palabras o con números. Los periodos vencen al final: la semana, el viernes.', 'Write the day in words or numbers. Periods are due at their end: a week, on Friday.'), Demo: DatesDemo },
  { title: tr('Prioridad y repetición', 'Priority and repeat'), text: () => tr('Marca lo importante con !alta, !media o !baja. Con «cada» la tarea vuelve sola al completarla; «cada 2 martes» empieza el próximo martes y sigue cada dos semanas.', 'Mark what matters with !high, !medium or !low. With “every” the task comes back when you complete it; “every 2 tuesdays” starts next Tuesday and repeats every two weeks.'), Demo: PrioRepeatDemo },
  { title: tr('Compartir una lista', 'Share a list'), text: () => tr('Desde la pestaña de la lista, elige Compartir: invita a quien quieras con un enlace, uno por persona, que caduca en 7 días. La editáis juntos y todo va cifrado. Hace falta entrar con Google.', 'From the list’s tab, choose Share: invite anyone you like with a link, one per person, that expires in 7 days. You edit it together and everything is encrypted. You need to sign in with Google.'), Demo: ShareDemo },
  { title: tr('Atajos de teclado', 'Keyboard shortcuts'), text: () => tr('Sin soltar el teclado: escribe, muévete por la lista, completa, pasa a mañana y filtra.', 'Without leaving the keyboard: write, move through the list, complete, move to tomorrow and filter.'), Demo: KeysDemo, keyboard: true },
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

/** Bienvenida completa: portada, tres pasos y referencia. Se muestra la primera vez y desde Ajustes → Ayuda → Cómo funciona. */
export function Onboarding({ onClose, signIn, extended }: Props) {
  // Siempre todas: portada, los tres pasos y la referencia (fechas, prioridad y repetición; teclado solo con ratón).
  const [slides] = useState<Slide[]>(() => [...SLIDES(), ...EXTRA().filter((s) => !s.keyboard || hasKeyboard())]);
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
    <div class="intro" role="dialog" aria-modal="true" aria-label={tr('Cómo funciona', 'How it works')}>
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
          <button class="link" onClick={onClose}>{tr('Saltar', 'Skip')}</button>
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
              <button key={k} class={k === i ? 'on' : ''} aria-label={tr(`Ir a la diapositiva ${k + 1}`, `Go to slide ${k + 1}`)}
                aria-current={k === i ? 'step' : undefined} onClick={() => setI(k)}>
                <i />
              </button>
            ))}
          </span>
          <span class="row-btns">
            {slides[i].google && signIn && <button class="btn btn-google" onClick={() => { onClose(); signIn(); }}><GoogleG />{tr('Entrar con Google', 'Sign in with Google')}</button>}
            <button class="btn solid" onClick={next} ref={primary}>{last ? (extended ? tr('Listo', 'Done') : tr('Empezar', 'Get started')) : tr('Siguiente', 'Next')}</button>
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

const demoLine = () => tr('Revisar ventas cada lunes #trabajo !alta', 'Review sales every monday #work !high');

/** La frase se escribe sola y los chips aparecen con el parser real. */
function TypingDemo() {
  const DEMO_LINE = demoLine();
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
        <RepeatIcon /> {tr('Al completarla, vuelve sola el lunes siguiente', 'When you complete it, it comes back next Monday')}
      </p>
    </div>
  );
}

/** Lista por días: una tarea se desliza y queda hecha; al tocar @ana se pliegan las que no son suyas. */
function SwipeDemo() {
  // [clave, día (cabecera antes de la fila), texto, ¿es de @ana?]
  const rows: Array<[string, string | null, string, boolean]> = isEn() ? [
    ['a', 'Today', 'Call @ana', true],
    ['b', null, 'Buy bread #home', false],
    ['c', 'Tomorrow', 'Send proposal to @ana', true],
    ['d', null, 'Pay electricity #home', false],
    ['e', 'This week', 'Prepare meeting #work', false],
    ['f', null, 'Review notes with @ana', true],
  ] : [
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
  const desk = !isPhone();
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
        <span class="local">{tr(`Solo en este ${where}`, `Only on this ${where}`)}</span>
        <span class="synced">{tr('Sincronizado · solo tú lo ves', 'Synced · only you can see it')}</span>
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

/** Varias listas: se escribe «Leche /compra» en la principal, la tarea se apunta en Compra y el aviso lo dice. */
function ListsDemo() {
  const TEXT = tr('Leche /compra', 'Milk /shopping');
  const NOTE = tr('Añadida a Compra', 'Added to Shopping');
  // Tras escribir, la línea se envía (el campo queda vacío) y el aviso aparece; luego todo vuelve a empezar.
  const SENT = TEXT.length + 4;
  const [n, setN] = useState(() => (reduced() ? SENT + 20 : 0));
  useEffect(() => {
    if (reduced()) return;
    const id = setInterval(() => setN((k) => (k >= SENT + 40 ? 0 : k + 1)), 70);
    return () => clearInterval(id);
  }, []);
  const sent = n >= SENT;
  const text = sent ? '' : TEXT.slice(0, n);
  return (
    <div class={`lists ${reduced() ? 'still' : ''}`}>
      <div class="lists-head lists-tabs"><span class="on">{tr('Personal', 'Personal')}</span><span>{tr('Compra', 'Shopping')}</span><span>+</span></div>
      <div class="lists-rows">
        <span class="lists-line"><i /><b /></span>
        <span class="lists-line l1"><i /><b /></span>
      </div>
      <div class="lists-input">
        <span>
          {text.split(/(\s+)/).map((w, k) => (w.startsWith('/') ? <span key={k} class="tag">{w}</span> : w))}
          {!sent && <span class="demo-caret" />}
        </span>
      </div>
      <p class={`lists-note ${sent ? 'on' : ''}`}>{NOTE}</p>
    </div>
  );
}

/** Compartir: una lista con otra persona. Las dos tienen sus tareas y el icono de personas indica que está compartida. */
function ShareDemo() {
  return (
    <div class={`lists share ${reduced() ? 'still' : ''}`}>
      <div class="lists-head">
        {tr('Compra', 'Shopping')}
        <svg class="share-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none"
          stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="9" cy="8" r="3" /><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
          <circle cx="17" cy="9" r="2.4" /><path d="M16.5 14.2c2.6.2 4.5 1.8 4.5 4.8" />
        </svg>
      </div>
      <div class="lists-rows">
        <span class="lists-line"><i /><b /></span>
        <span class="lists-line l1"><i /><b /></span>
      </div>
      <div class="share-people">
        <span class="share-av">{tr('Tú', 'You')}</span>
        <span class="share-av b">Ana</span>
      </div>
      <p class="lists-note on">{tr('Compartida. Todo va cifrado.', 'Shared. Everything is encrypted.')}</p>
    </div>
  );
}

/* ---------- slides de referencia (versión extendida) ---------- */

const chips = (list: string[]) => <span class="ref-chips">{list.map((c) => <code key={c} class="chip">{c}</code>)}</span>;

/** Fechas y periodos que entiende la caja de captura. */
function DatesDemo() {
  return (
    <div class="ref">
      {isEn() ? <>
        <div class="ref-group"><span class="label">Day</span>{chips(['today', 'tomorrow', 'friday', 'Nov 15', 'in 3 days'])}</div>
        <div class="ref-group"><span class="label">Period</span>{chips(['this week', 'this month', 'this quarter', 'this year'])}</div>
        <div class="ref-group"><span class="label">Exact</span>{chips(['due:15/11', 'due:2026-11-15'])}</div>
      </> : <>
        <div class="ref-group"><span class="label">Día</span>{chips(['hoy', 'mañana', 'pasado', 'el viernes', '15 nov', 'en 3 días'])}</div>
        <div class="ref-group"><span class="label">Periodo</span>{chips(['esta semana', 'este mes', 'este trimestre', 'este año'])}</div>
        <div class="ref-group"><span class="label">Exacta</span>{chips(['vence:15/11', 'vence:2026-11-15'])}</div>
      </>}
    </div>
  );
}

/** Prioridades con su icono y repeticiones. */
function PrioRepeatDemo() {
  const prio: Array<[string, 1 | 2 | 3]> = isEn() ? [['!high', 1], ['!medium', 2], ['!low', 3]] : [['!alta', 1], ['!media', 2], ['!baja', 3]];
  return (
    <div class="ref">
      <div class="ref-group">
        <span class="label">{tr('Prioridad', 'Priority')}</span>
        <span class="ref-chips">
          {prio.map(([w, p]) => (
            <span key={w} class="ref-pair"><code class="chip">{w}</code><span class={`chip ${p === 1 ? 'warn' : ''}`}><PriorityIcon p={p} /></span></span>
          ))}
        </span>
      </div>
      <div class="ref-group">
        <span class="label">{tr('Repetir', 'Repeat')}</span>
        <span class="ref-chips">
          {(isEn() ? ['every day', 'every monday', 'every 2 tuesdays', 'every month', 'every year'] : ['cada día', 'cada lunes', 'cada 2 martes', 'cada mes', 'cada año']).map((c) => <span key={c} class="chip"><RepeatIcon /> {c}</span>)}
        </span>
      </div>
    </div>
  );
}

/** Atajos de teclado (solo en ordenador). */
function KeysDemo() {
  return (
    <dl class="keys ref-keys">
      {SHORTCUTS().map(([keys, what]) => (
        <div key={what}>
          <dt>{keys.map((k) => <kbd key={k}>{k}</kbd>)}</dt>
          <dd>{what}</dd>
        </div>
      ))}
    </dl>
  );
}
