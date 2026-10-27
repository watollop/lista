import { normalizeKey } from '../lib/text';

/**
 * Reescribe en un título las etiquetas `sym` cuya clave normalizada es `key`.
 * `to` = nuevo nombre (sin símbolo) -> `#nuevo`; `to` = null -> se quita el símbolo y queda la palabra.
 * Mismas reglas de etiqueta que parseLine: al inicio o tras espacio, letras/números/_/-.
 * CONTRATO: lo implementa el agente de datos.
 */
export function retagTitle(title: string, sym: '#' | '@', key: string, to: string | null): string {
  void normalizeKey; void sym; void key; void to;
  throw new Error('retagTitle: sin implementar');
}
