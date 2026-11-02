import type { ISODate } from '../types';
import { fromISODate } from '../lib/date';

const DAY = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const DAY_NAME = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DOTS = 5; // más tareas en un día no añaden puntos: el número sigue contando
const pad = (n: number) => String(n).padStart(2, '0');

interface Props {
  today: number; // pendientes para hoy
  overdue: number;
  open: number;
  days: Array<{ date: ISODate; count: number }>; // de hoy en adelante
}

/** «Pantalla» de Hoy: pendientes de hoy en grande y los próximos 7 días con un punto por tarea. Solo informa; filtrar sigue en Fecha. */
export function Week({ today, overdue, open, days }: Props) {
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
            <li key={d.date} class={`${i === 0 ? 'now' : ''} ${d.count ? 'busy' : ''}`}
              aria-label={`${DAY_NAME[x.getDay()]} ${x.getDate()} ${MES[x.getMonth()]}: ${d.count ? tasks(d.count) : 'nada'}`}>
              <span class="week-d" aria-hidden="true">{DAY[x.getDay()]}</span>
              <span class="week-n" aria-hidden="true">{pad(x.getDate())}</span>
              <span class="week-dots" aria-hidden="true">
                {Array.from({ length: Math.min(d.count, DOTS) }, (_, k) => <i key={k} />)}
              </span>
              <span class="week-c" aria-hidden="true">{d.count || '·'}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
