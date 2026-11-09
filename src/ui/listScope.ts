// Lista actual de la pantalla (escritorio y móvil): funciones puras, sin estado de React.
import { MAIN_LIST, type ID, type ListScope, type Task, type TodoList } from '../types';
import { tr } from '../i18n';

/** Clave de localStorage: la última lista (o 'all') que abrió este dispositivo. No se sincroniza. */
export const SCOPE_KEY = 'lista.list';

/** Lista recordada en este dispositivo; la principal si no hay nada guardado o no se puede leer. */
export function loadScope(): ListScope {
  try {
    return localStorage.getItem(SCOPE_KEY) || MAIN_LIST;
  } catch {
    return MAIN_LIST;
  }
}

/** Guarda la lista actual en este dispositivo. Si el almacenamiento falla (modo privado), no pasa nada. */
export function saveScope(s: ListScope): void {
  try {
    localStorage.setItem(SCOPE_KEY, s);
  } catch { /* modo privado: se usará la principal al volver */ }
}

/** Lista que se muestra de verdad: si la guardada ya no existe, la principal; «Todas» con una sola lista es la principal. */
export function resolveScope(scope: ListScope, lists: TodoList[]): ListScope {
  if (scope === 'all') return lists.length > 1 ? 'all' : MAIN_LIST;
  return lists.some((l) => l.id === scope) ? scope : MAIN_LIST;
}

/** Si la tarea se ve con esta lista seleccionada. Sin listId (tareas anteriores) es la principal. */
export function inScope(task: Task, scope: ListScope): boolean {
  return scope === 'all' || (task.listId ?? MAIN_LIST) === scope;
}

/** Nombre visible de una lista. La principal sin registro se llama «Personal». */
export function listName(lists: TodoList[], id: ID): string {
  const found = lists.find((l) => l.id === id)?.name;
  if (found) return found;
  return id === MAIN_LIST ? tr('Personal', 'Personal') : '';
}
