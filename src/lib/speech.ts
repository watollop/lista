/**
 * Dictado: convierte lo hablado en líneas con la sintaxis de la app (luego las interpreta el parser de siempre).
 * - "prioridad alta" / "urgente" -> !alta; "prioridad media" -> !media; "prioridad baja" -> !baja
 * - "tema trabajo" / "etiqueta trabajo" / "almohadilla trabajo" -> #trabajo
 * - "persona Ana" / "arroba Ana" -> @ana
 * - "siguiente", "nueva tarea", "otra tarea" o un punto separan tareas.
 */

const W = '[\\p{L}\\p{N}_-]+';

export function spokenToSyntax(text: string): string {
  return text
    .replace(/\b(?:con\s+)?prioridad\s+(alta|media|baja)\b/giu, (_, p: string) => `!${p.toLowerCase()}`)
    .replace(/\b(?:es\s+)?urgente\b/giu, '!alta')
    .replace(new RegExp(`\\b(?:tema|etiqueta|almohadilla)\\s+(${W})`, 'giu'), (_, t: string) => `#${t.toLowerCase()}`)
    .replace(new RegExp(`\\b(?:persona|arroba)\\s+(${W})`, 'giu'), (_, p: string) => `@${p.toLowerCase()}`)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parte un dictado en tareas y las limpia: sin punto final, primera letra en mayúscula. */
export function splitDictation(text: string): string[] {
  return text
    .split(/\s*(?:[.;]\s+|[.;]$|\b(?:siguiente|nueva tarea|otra tarea)\b[,.]?)\s*/iu)
    .map((t) => spokenToSyntax(t.replace(/[.,;]+$/, '')))
    .filter((t) => t.length > 1)
    .map((t) => t[0].toUpperCase() + t.slice(1));
}
