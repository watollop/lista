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
