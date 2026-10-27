import type { Task } from '../types';
import { googleCalendarUrl, icsFor } from '../lib/calendar';

/** iPhone, iPad y Mac usan Calendario de Apple por defecto; el resto, Google Calendar. */
export const prefersApple = () => typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

/** Abre «Añadir evento» del Calendario de Apple con un .ics generado en el momento. */
export function addToAppleCalendar(t: Task) {
  const url = URL.createObjectURL(new Blob([icsFor(t)], { type: 'text/calendar;charset=utf-8' }));
  if (isIOS()) {
    // En iOS, abrir el .ics muestra directamente la hoja de Calendario para añadirlo.
    location.href = url;
  } else {
    const a = document.createElement('a');
    a.href = url;
    a.download = `${t.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 40) || 'tarea'}.ics`;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Abre Google Calendar con el evento ya rellenado (solo falta «Guardar»). */
export function addToGoogleCalendar(t: Task) {
  window.open(googleCalendarUrl(t), '_blank', 'noopener');
}

/** Acción principal según la plataforma. */
export const addToCalendar = (t: Task) => (prefersApple() ? addToAppleCalendar(t) : addToGoogleCalendar(t));
