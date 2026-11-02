import type { ISODate } from '../types';
import { fromISODate } from '../lib/date';

const DAY = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const DAY_NAME = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const pad = (n: number) => String(n).padStart(2, '0');

interface Props {
  today: number; // pendientes para hoy
  overdue: number;
  open: number;
  days: Array<{ date: ISODate; count: number }>; // de hoy en adelante
  day?: ISODate; // día filtrado
  onPick: (date: ISODate) => void;
}

/** «Pantalla» de Hoy: pendientes de hoy en grande y los próximos 7 días con cuántas tareas tiene cada uno. Tocar un día muestra solo ese día. */
export function Week({ today, overdue, open, days, day, onPick }: Props) {
  const first = fromISODate(days[0].date);
  const tasks = (n: number) => `${n} ${n === 1 ? 'tarea' : 'tareas'}`;
  return (
    <section class="week" aria-label="Tu semana">
      <div class="week-head label">
        <span>Hoy · {DAY_NAME[first.getDay()].slice(0, 3)} {pad(first.getDate())}</span>
        <span>{open} abiertas</span>
      </div>
      <div class="week-now">
        <span class="week-big" aria-label={`${tasks(today)} para hoy`}>{pad(today)}</span>
        {overdue > 0 && <span class="week-late label">+{overdue} venc.</span>}
      </div>
      <ol class="week-days">
        {days.map((d, i) => {
          const x = fromISODate(d.date);
          return (
            <li key={d.date}>
              <button class={`${i === 0 ? 'now' : ''} ${d.count ? 'busy' : ''} ${day === d.date ? 'on' : ''}`}
                aria-pressed={day === d.date} onClick={() => onPick(d.date)}
                aria-label={`${DAY_NAME[x.getDay()]} ${x.getDate()} ${MES[x.getMonth()]}: ${d.count ? tasks(d.count) : 'nada'}`}>
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
