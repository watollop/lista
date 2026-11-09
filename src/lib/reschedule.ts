import type { ISODate, Period } from '../types';
import { addDays } from './date';
import { periodEnd } from './period';
import { lang } from '../i18n';

/** Bloques de la lista donde se puede soltar una tarea arrastrada (Vencidas no: no se mueve al pasado). */
export type DropTarget = 'today' | 'tomorrow' | 'week' | 'next' | 'nodate';

/** Pestaña de una lista donde se suelta una tarea para moverla a ella (data-drop="list:<id>"). */
export type ListDrop = `list:${string}`;
export const listDrop = (id: string): ListDrop => `list:${id}`;
/** Id de la lista si el destino es una lista; null si es un bloque de fecha. */
export const listOfDrop = (t: DropTarget | ListDrop): string | null => (t.startsWith('list:') ? t.slice(5) : null);

export const dropLabel = (t: DropTarget) => (lang() === 'en'
  ? { today: 'Today', tomorrow: 'Tomorrow', week: 'This week', next: 'Upcoming', nodate: 'No date' }
  : { today: 'Hoy', tomorrow: 'Mañana', week: 'Esta semana', next: 'Próximas', nodate: 'Sin fecha' })[t];

/** Nueva fecha al soltar en un bloque: Hoy/Mañana son días; Esta semana y Próximas, periodos de semana. */
export function scheduleFor(target: DropTarget, today: ISODate): { due: ISODate | null; period: Period | null } {
  switch (target) {
    case 'today': return { due: today, period: null };
    case 'tomorrow': return { due: addDays(today, 1), period: null };
    case 'week': return { due: periodEnd('week', today), period: 'week' };
    case 'next': return { due: periodEnd('week', today, 1), period: 'week' };
    case 'nodate': return { due: null, period: null };
  }
}
