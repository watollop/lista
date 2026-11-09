import { tr } from '../i18n';

/** Una entrada de Novedades. Título y texto son funciones: el idioma se fija al arrancar (ver i18n). */
export interface NewsItem { id: string; title: () => string; text: () => string }

/** Novedades, la más reciente primero. */
export const NEWS: NewsItem[] = [
  {
    id: '2026-11-monedas',
    title: () => tr('Nuevo: monedas', 'New: coins'),
    text: () => tr(
      'Cada tarea que completas hoy suma una moneda en la pantalla de Hoy (en el móvil, en Filtrar). A ver cuántas juntas.',
      'Every task you complete today adds a coin on the Today screen (on the phone, under Filter). See how many you can collect.',
    ),
  },
  {
    id: '2026-11-pestanas',
    title: () => tr('Las listas, en pestañas', 'Lists, now in tabs'),
    text: () => tr(
      'Tus listas están en pestañas, arriba: toca otra vez la activa para renombrarla, compartirla o borrarla, y + crea otra. En el móvil, Filtrar reúne la búsqueda y todos los filtros. En el ordenador, arrastra una tarea a otro día o a otra pestaña con el asa ⠿ que aparece al pasar el ratón.',
      'Your lists are now tabs at the top: tap the active one again to rename, share or delete it, and + creates another. On the phone, Filter gathers search and every filter. On a computer, drag a task to another day or tab by the ⠿ handle that appears on hover.',
    ),
  },
  {
    id: '2026-11-listas-compartidas',
    title: () => tr('Nuevo: listas compartidas', 'New: shared lists'),
    text: () => tr(
      'Comparte una lista, la compra con tu pareja o las tareas de casa, y editadla juntos desde cada móvil u ordenador. Todo va cifrado. Para compartirla, toca otra vez su pestaña y elige Compartir.',
      'Share a list, the shopping with your partner or the housework, and edit it together from each phone or computer. Everything is encrypted. To share it, tap its tab again and choose Share.',
    ),
  },
  {
    id: '2026-11-listas',
    title: () => tr('Nuevo: listas', 'New: lists'),
    text: () => tr(
      'Separa la compra, el trabajo y lo personal. Crea una lista con el + junto a tus listas, y escribe /compra para apuntar en ella sin cambiar de lista.',
      'Keep shopping, work and personal apart. Create a list with the + next to your lists, and type /shopping to add to it without switching lists.',
    ),
  },
];

/** Clave de localStorage: array JSON de ids de Novedades ya vistas. Módulo aparte, como intro.ts. */
export const NEWS_KEY = 'lista.news';

/** Ids vistos, o null si no se pueden leer (modo privado, JSON corrupto). */
function readSeen(): string[] | null {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(NEWS_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;
  } catch { return null; }
}

/** Novedades que este dispositivo aún no ha visto. Si no se puede saber (error de almacenamiento), ninguna: mejor no molestar que repetir. */
export function unseenNews(): NewsItem[] {
  const seen = readSeen();
  if (seen === null) return [];
  return NEWS.filter((n) => !seen.includes(n.id));
}

/** Marca como vistas las novedades indicadas, conservando las ya marcadas. */
export function markNewsSeen(ids: string[]) {
  const seen = readSeen() ?? [];
  const all = [...new Set([...seen, ...ids])];
  try { localStorage.setItem(NEWS_KEY, JSON.stringify(all)); } catch { /* modo privado: se volverá a mostrar */ }
}

/** Marca todas las novedades actuales como vistas (al cerrar la bienvenida, o al ver la hoja). */
export function markAllNewsSeen() {
  markNewsSeen(NEWS.map((n) => n.id));
}
