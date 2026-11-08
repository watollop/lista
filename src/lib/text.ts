/** Clave canónica de un tema/persona: minúsculas, sin acentos (conserva la ñ), sin espacios extremos. */
export function normalizeKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/ñ/g, '\u0000')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\u0000/g, 'ñ');
}

/** Normalización para búsqueda libre: minúsculas y sin ningún diacrítico. */
export function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Clave de una lista para la sintaxis /nombre: como normalizeKey, sin espacios ni signos.
 *  «La compra», /la-compra y /lacompra dan la misma clave. */
export function listKey(name: string): string {
  return normalizeKey(name).replace(/[^\p{L}\p{N}]+/gu, '');
}
