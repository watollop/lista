import type { ParsedLine } from '../types';

export function validateCapture(lines: ParsedLine[]): ParsedLine[] {
  if (!lines[0]?.title) throw new Error('Escribe un título para la tarea.');
  if (lines.some((line) => !line.title)) throw new Error('Escribe un título para cada tarea y subtarea, además de sus etiquetas.');
  return [{ ...lines[0], isSubtask: false }, ...lines.slice(1)];
}

/**
 * Texto de una tarea que llega desde fuera de la app:
 * - `?nueva=…` (enlace directo; p. ej. un Atajo de iOS con Siri)
 * - `?title=…&text=…&url=…` («Compartir con Lista» en Android, share_target del manifiesto)
 * Devuelve null si no hay nada que apuntar.
 */
export function externalCapture(search: string): string | null {
  const q = new URLSearchParams(search);
  const nueva = q.get('nueva');
  if (nueva !== null) return nueva.trim() || null;
  // Al compartir, cada app rellena unos campos u otros (y a veces repite el enlace en el texto).
  const parts: string[] = [];
  for (const k of ['title', 'text', 'url']) {
    const v = q.get(k)?.trim();
    if (v && !parts.some((p) => p.includes(v))) parts.push(v);
  }
  return parts.join(' ') || null;
}
