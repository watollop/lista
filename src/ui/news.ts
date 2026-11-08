import { tr } from '../i18n';

/** Una entrada de Novedades. Título y texto son funciones: el idioma se fija al arrancar (ver i18n). */
export interface NewsItem { id: string; title: () => string; text: () => string }

/** Novedades, la más reciente primero. */
export const NEWS: NewsItem[] = [
  {
    id: '2026-11-listas',
    title: () => tr('Nuevo: listas', 'New: lists'),
    text: () => tr(
      'Separa la compra, el trabajo y lo personal. Crea una lista desde la barra lateral o tocando el nombre de arriba, y escribe /compra para apuntar en ella.',
      'Keep shopping, work and personal apart. Create a list from the sidebar or by tapping the name at the top, and type /shopping to add to it.',
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
