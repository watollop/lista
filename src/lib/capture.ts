import type { ParsedLine } from '../types';
import { tr } from '../i18n';

/**
 * Longitud máxima del título de una tarea o subtarea, en caracteres. El servidor rechaza registros de más de
 * 64 KiB (supabase/migrations/20261101_limites.sql) y un lote con un registro así no se sube nunca. Un título
 * de 1000 caracteres ocupa unos pocos KiB cifrados en base64, muy por debajo de ese límite.
 */
export const MAX_TITLE = 1000;
export const titleTooLongMsg = () => tr(`Una tarea admite hasta ${MAX_TITLE} caracteres.`, `A task can have up to ${MAX_TITLE} characters.`);

/** Algún título (tarea o subtarea) supera MAX_TITLE. Se cuentan caracteres, no unidades UTF-16. */
export function titleTooLong(lines: ParsedLine[]): boolean {
  return lines.some((line) => [...line.title].length > MAX_TITLE);
}

export function validateCapture(lines: ParsedLine[]): ParsedLine[] {
  if (!lines[0]?.title) throw new Error(tr('Escribe un título para la tarea.', 'Write a title for the task.'));
  if (lines.some((line) => !line.title)) throw new Error(tr('Escribe un título para cada tarea y subtarea, además de sus etiquetas.', 'Write a title for each task and subtask, not just its tags.'));
  if (titleTooLong(lines)) throw new Error(titleTooLongMsg());
  return [{ ...lines[0], isSubtask: false }, ...lines.slice(1)];
}

/** Recorta un texto a MAX_TITLE caracteres (el «…» cuenta), en el último espacio si cae en la segunda mitad. */
function fitTitle(text: string): string {
  const chars = [...text];
  if (chars.length <= MAX_TITLE) return text;
  const head = chars.slice(0, MAX_TITLE - 1).join('');
  const space = head.lastIndexOf(' ');
  return (space > (MAX_TITLE - 1) / 2 ? head.slice(0, space) : head).trimEnd() + '…';
}

/**
 * Texto de una tarea que llega desde fuera de la app por «Compartir con Lista» en Android
 * (share_target del manifiesto: `?title=…&text=…&url=…`).
 * Quien llama no puede pedir al usuario que recorte, así que el texto se recorta aquí, antes de parsear.
 * Devuelve null si no hay nada que apuntar.
 */
export function externalCapture(search: string): string | null {
  const q = new URLSearchParams(search);
  // Al compartir, cada app rellena unos campos u otros (y a veces repite el enlace en el texto).
  const parts: string[] = [];
  for (const k of ['title', 'text', 'url']) {
    const v = q.get(k)?.trim();
    if (v && !parts.some((p) => p.includes(v))) parts.push(v);
  }
  return fitTitle(parts.join(' ')) || null;
}
