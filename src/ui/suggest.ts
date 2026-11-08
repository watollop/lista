import type { TodoList } from '../types';
import { listKey } from '../lib/text';

/** Máximo de sugerencias a la vez en el desplegable. */
export const MAX_SUGGESTIONS = 6;

/** Listas cuyo listKey empieza por el de lo escrito tras «/» (sin contar la coincidencia exacta).
 *  «la c» sugiere «La compra»: tildes, mayúsculas y espacios no cuentan. */
export function listSuggestions(lists: TodoList[], prefix: string, max = MAX_SUGGESTIONS): TodoList[] {
  // Con una sola lista, «/» no sugiere nada: Lista se ve igual que siempre para quien no usa listas.
  if (lists.length < 2) return [];
  const p = listKey(prefix);
  return lists
    .filter((l) => {
      const k = listKey(l.name);
      return k.startsWith(p) && k !== p;
    })
    .slice(0, max);
}

/** Texto que se inserta al aceptar una lista: «La compra» → «/La-compra» (sin el espacio final). */
export function listInsertText(name: string): string {
  return '/' + name.trim().replace(/\s+/g, '-');
}
