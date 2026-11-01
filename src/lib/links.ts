/** Trozo de un título: texto normal o una dirección http(s) que se puede abrir. Concatenados dan el texto original. */
export type Segment =
  | { type: 'text'; raw: string }
  | { type: 'link'; raw: string; href: string; host: string };

// Una URL no empieza en mitad de una palabra («xhttps://» no cuenta) y termina en el primer espacio o comilla.
const CANDIDATE = /(?<![\p{L}\p{N}])https?:\/\/[^\s<>"«»]+/giu;
const TAIL = /[.,;:!?'’]/;

const count = (s: string, ch: string) => s.split(ch).length - 1;

/** Quita la puntuación final que no forma parte de la URL. Un «)» se queda si cierra un «(» de la propia URL. */
function trimTail(s: string): string {
  let out = s;
  while (out) {
    const last = out.slice(-1);
    const drop = last === ')' ? count(out, '(') < count(out, ')') : TAIL.test(last);
    if (!drop) break;
    out = out.slice(0, -1);
  }
  return out;
}

function toLink(raw: string): Segment | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;
  return { type: 'link', raw, href: raw, host: url.hostname.replace(/^www\./, '') };
}

/** Divide un texto en trozos normales y enlaces http(s). Lo que no es una URL válida se queda como texto. */
export function splitLinks(text: string): Segment[] {
  const out: Segment[] = [];
  let i = 0;
  for (const m of text.matchAll(CANDIDATE)) {
    const start = m.index!;
    const raw = trimTail(m[0]);
    const link = toLink(raw);
    if (!link) continue;
    if (start > i) out.push({ type: 'text', raw: text.slice(i, start) });
    out.push(link);
    i = start + raw.length;
  }
  if (i < text.length) out.push({ type: 'text', raw: text.slice(i) });
  return out;
}
