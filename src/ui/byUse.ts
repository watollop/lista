import type { Entity } from '../types';

/** Con más elementos que esto, las listas de temas/personas muestran una caja de búsqueda. */
export const SEARCH_FROM = 10;

/** Temas o personas ordenados por tareas pendientes (más usados primero) y después por nombre. */
export function byUse(list: Entity[], sym: '#' | '@', pending: Map<string, number>): Entity[] {
  const n = (e: Entity) => pending.get(sym + e.key) ?? 0;
  return [...list].sort((a, b) => n(b) - n(a) || a.name.localeCompare(b.name, 'es'));
}
