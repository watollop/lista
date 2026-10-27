import { normalizeKey } from '../lib/text';

/**
 * Reescribe en un título las etiquetas `sym` cuya clave normalizada es `key`.
 * `to` = nuevo nombre (sin símbolo) -> `#nuevo`; `to` = null -> se quita el símbolo y queda la palabra.
 * Mismas reglas de etiqueta que parseLine: al inicio o tras espacio, letras/números/_/-.
 */
export function retagTitle(title: string, sym: '#' | '@', key: string, to: string | null): string {
  return title.replace(/(?<!\S)([#@])([\p{L}\p{N}_-]+)/gu, (tag, s: string, name: string) => {
    if (s !== sym || normalizeKey(name) !== key) return tag;
    return to === null ? name : sym + to;
  });
}
