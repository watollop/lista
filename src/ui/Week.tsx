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
        <span class="week-big" aria-label={tr(`${tasks(today)} para hoy`, `${tasks(today)} today`)}>{pad(today)}</span>
        {overdue > 0 && <span class="week-late label">+{overdue} {tr('venc.', 'late')}</span>}
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
