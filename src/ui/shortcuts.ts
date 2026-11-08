import { tr } from '../i18n';

/** Atajos de teclado de escritorio: fuente única para la diapositiva de la bienvenida y la hoja «?». */
export const SHORTCUTS = (): Array<[string[], string]> => [
  [['⌘K', '/', 'n'], tr('escribir tarea', 'new task')],
  [['j', 'k'], tr('moverse por la lista', 'move through the list')],
  [['x'], tr('completar', 'complete')],
  [['e'], tr('editar', 'edit')],
  [['m'], tr('para mañana', 'move to tomorrow')],
  [['⌘Z'], tr('deshacer lo último', 'undo the last change')],
  [['⌫'], tr('borrar', 'delete')],
  [['h', 's', 'v'], tr('hoy · semana · vencidas', 'today · week · overdue')],
  [['1–9'], tr('filtros guardados', 'saved filters')],
  [['l'], tr('cambiar de lista', 'switch list')],
  [['f'], tr('buscar', 'search')],
  [['esc'], tr('limpiar filtro', 'clear filter')],
  [['?'], tr('estos atajos', 'these shortcuts')],
];
