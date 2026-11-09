import { useEffect, useRef, useState } from 'preact/hooks';
import type { ISODate } from '../types';
import { fromISODate } from '../lib/date';
import { isEn, tr } from '../i18n';

const DAY_ES = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const DAY_NAME_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DAY_EN = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAME_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

// Moneda de píxeles (8×10), en el color de la app: '#' canto, 'o' cara, 's' brillo, 'l' ranura.
const COIN = [
  '..####..',
  '.#oooo#.',
  '#osoloo#',
  '#osoloo#',
  '#osoloo#',
  '#oooloo#',
  '#oooloo#',
  '#oooooo#',
  '.#oooo#.',
  '..####..',
];
const COIN_CLS: Record<string, string> = { '#': 'coin-rim', o: 'coin-face', s: 'coin-shine', l: 'coin-slot' };

function Coin() {
  return (
    <svg class="coin" viewBox="0 0 8 10" width="16" height="20" shape-rendering="crispEdges" aria-hidden="true">
      {COIN.flatMap((line, y) => [...line].map((c, x) => (c === '.' ? null : <rect key={`${x},${y}`} x={x} y={y} width="1" height="1" class={COIN_CLS[c]} />)))}
    </svg>
  );
}

/**
 * Hechas hoy, como el contador de monedas de un juego de plataformas: una moneda por tarea completada. Al sumar una,
 * la moneda salta girando y sube un «+1» (sin animación si se pide movimiento reducido: lo quita styles.css).
 * scopeKey: al cargar los datos o cambiar de lista el número cambia sin completar nada, y entonces no salta.
 */
function Coins({ done, scopeKey }: { done: number; scopeKey: string }) {
  const prev = useRef({ done, scopeKey });
  const [pops, setPops] = useState(0);
  useEffect(() => {
    const p = prev.current;
    if (p.scopeKey === scopeKey && done > p.done) setPops((n) => n + 1);
    prev.current = { done, scopeKey };
  }, [done, scopeKey]);
  const label = tr(`${done} ${done === 1 ? 'hecha' : 'hechas'} hoy`, `${done} done today`);
  return (
    <span class={`week-coins ${done ? 'has' : ''}`} title={label} aria-label={label} role="img">
      <span class="week-coin-row">
        {/* key: cada moneda nueva vuelve a montar la caja y la animación se repite; al cargar (pops 0) no salta. */}
        <span class={`coin-box ${pops ? 'pop' : ''}`} key={pops}>
          <Coin />
          {pops > 0 && <span class="coin-plus" aria-hidden="true">+1</span>}
        </span>
        <span class="week-coin-n" aria-hidden="true">×{pad(done)}</span>
      </span>
      <span class="week-coin-label label" aria-hidden="true">{tr('hechas hoy', 'done today')}</span>
    </span>
  );
}

interface Props {
  today: number; // pendientes para hoy
  overdue: number;
  open: number;
  done: number; // completadas hoy (monedas)
  scopeKey: string; // lista actual ('' mientras cargan los datos): al cambiar, las monedas no saltan
  days: Array<{ date: ISODate; count: number }>; // de hoy en adelante
  day?: ISODate; // día filtrado
  onPick: (date: ISODate) => void;
}

/**
 * «Pantalla» de Hoy: pendientes de hoy en grande, las monedas de lo hecho hoy y los próximos 7 días con cuántas tareas
 * tiene cada uno. Tocar un día muestra solo ese día.
 */
export function Week({ today, overdue, open, done, scopeKey, days, day, onPick }: Props) {
  const first = fromISODate(days[0].date);
  const en = isEn();
  const DAY = en ? DAY_EN : DAY_ES;
  const DAY_NAME = en ? DAY_NAME_EN : DAY_NAME_ES;
  const tasks = (n: number) => en ? `${n} ${n === 1 ? 'task' : 'tasks'}` : `${n} ${n === 1 ? 'tarea' : 'tareas'}`;
  const dayLabel = (x: Date) => en ? `${DAY_NAME[x.getDay()]} ${MONTH_EN[x.getMonth()]} ${x.getDate()}` : `${DAY_NAME[x.getDay()]} ${x.getDate()} ${MES[x.getMonth()]}`;
  return (
    <section class="week" aria-label={tr('Tu semana', 'Your week')}>
      <div class="week-head label">
        <span>{tr('Hoy', 'Today')} · {DAY_NAME[first.getDay()].slice(0, 3)} {pad(first.getDate())}</span>
        <span>{open} {tr('abiertas', 'open')}</span>
      </div>
      <div class="week-now">
        <span class="week-score">
          <span class="week-big" aria-label={tr(`${tasks(today)} para hoy`, `${tasks(today)} today`)}>{pad(today)}</span>
          {overdue > 0 && <span class="week-late label">+{overdue} {tr('venc.', 'late')}</span>}
        </span>
        <Coins done={done} scopeKey={scopeKey} />
      </div>
      <ol class="week-days">
        {days.map((d, i) => {
          const x = fromISODate(d.date);
          return (
            <li key={d.date}>
              <button class={`${i === 0 ? 'now' : ''} ${d.count ? 'busy' : ''} ${day === d.date ? 'on' : ''}`}
                aria-pressed={day === d.date} onClick={() => onPick(d.date)}
                aria-label={`${dayLabel(x)}: ${d.count ? tasks(d.count) : tr('nada', 'nothing')}`}>
                <span class="week-d" aria-hidden="true">{DAY[x.getDay()]}</span>
                <span class="week-n" aria-hidden="true">{pad(x.getDate())}</span>
                <span class="week-c" aria-hidden="true">{d.count || '·'}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
