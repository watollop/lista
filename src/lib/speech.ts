/**
 * Dictado: convierte lo hablado en líneas con la sintaxis de la app (luego las interpreta el parser de siempre).
 * - "prioridad alta" / "urgente" -> !alta; "prioridad media" -> !media; "prioridad baja" -> !baja
 * - "tema trabajo" / "etiqueta trabajo" / "almohadilla trabajo" -> #trabajo
 * - "persona Ana" / "arroba Ana" -> @ana
 * - "siguiente", "nueva tarea", "otra tarea" o un punto separan tareas.
 */

import { lang } from '../i18n';

const W = '[\\p{L}\\p{N}_-]+';

export function spokenToSyntax(text: string): string {
  if (lang() === 'en') {
    // "priority high", "high priority", "urgent" -> !high; "tag work" / "topic work" / "hashtag work" -> #work; "person Ana" -> @ana
    return text
      .replace(/\b(?:with\s+)?(?:priority\s+(high|medium|low)|(high|medium|low)\s+priority)\b/giu, (_, a?: string, b?: string) => `!${(a ?? b ?? '').toLowerCase()}`)
      .replace(/\b(?:it'?s\s+)?urgent\b/giu, '!high')
      .replace(new RegExp(`\\b(?:tag|topic|hashtag)\\s+(${W})`, 'giu'), (_, t: string) => `#${t.toLowerCase()}`)
      .replace(new RegExp(`\\bperson\\s+(${W})`, 'giu'), (_, p: string) => `@${p.toLowerCase()}`)
      .replace(/\s+/g, ' ')
      .trim();
  }
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
  // En inglés no vale «next» suelto: «next monday» es una fecha.
  const sep = lang() === 'en'
    ? /\s*(?:[.;]\s+|[.;]$|\b(?:next task|new task|another task)\b[,.]?)\s*/iu
    : /\s*(?:[.;]\s+|[.;]$|\b(?:siguiente|nueva tarea|otra tarea)\b[,.]?)\s*/iu;
  return text
    .split(sep)
    .map((t) => spokenToSyntax(t.replace(/[.,;]+$/, '')))
    .filter((t) => t.length > 1)
    .map((t) => t[0].toUpperCase() + t.slice(1));
}

/**
 * Reconstruye lo dictado a partir de los resultados del reconocedor, sean del tipo que sean:
 * - Chrome: un resultado por frase ("llamar a Ana", "comprar pan").
 * - Safari/iOS: cada resultado repite el texto acumulado ("llamar", "llamar a", "llamar a la…"), todos «finales».
 * Un resultado que empieza por el anterior lo sustituye (no se suma). Devuelve las frases resultantes.
 */
export function collapseResults(transcripts: string[]): string[] {
  const out: string[] = [];
  for (const raw of transcripts) {
    const t = raw.trim();
    if (!t) continue;
    const prev = out[out.length - 1];
    const norm = (x: string) => x.toLowerCase().replace(/[.,;!?]/g, '').replace(/\s+/g, ' ').trim();
    if (prev !== undefined && norm(t).startsWith(norm(prev))) out[out.length - 1] = t;
    else out.push(t);
  }
  return out;
}

/**
 * Tareas a partir de las frases y de los cortes por pausa (en nº de palabras desde el inicio del dictado):
 * iOS no separa frases al hacer pausa, así que la app mide el silencio entre resultados y corta ahí.
 */
export function dictationItems(phrases: string[], pauseCuts: number[]): string[] {
  const words = phrases.flatMap((p, i) => p.trim().split(/\s+/).map((w, k) => ({ w, start: k === 0 && i > 0 })));
  const cuts = new Set(pauseCuts);
  const chunks: string[] = [];
  let cur: string[] = [];
  words.forEach(({ w, start }, i) => {
    if ((start || cuts.has(i)) && cur.length) { chunks.push(cur.join(' ')); cur = []; }
    cur.push(w);
  });
  if (cur.length) chunks.push(cur.join(' '));
  return chunks.flatMap(splitDictation);
}
