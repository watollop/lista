import { useEffect, useRef, useState } from 'preact/hooks';
import type { Entity, ISODate, ParsedLine } from '../types';
import { normalizeKey, parseLine } from '../parser';
import { collapseResults, dictationItems } from '../lib/speech';
import { micSteps, type Blocked } from '../lib/mic';
import { TaskChips } from './Chips';

// Reconocimiento de voz del navegador (Chrome/Android: Google; Safari/iOS: Apple). Sin tipos en lib.dom.
type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
const Ctor = () => (globalThis as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition })
  .SpeechRecognition ?? (globalThis as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;

/** ¿Hay reconocimiento de voz en este navegador? */
export const canDictate = () => typeof window !== 'undefined' && !!Ctor();

const ERRORS: Record<string, string> = {
  'no-speech': 'No te he oído. Toca «Seguir hablando».',
  network: 'Sin conexión: el dictado necesita internet.',
};

/** Errores que significan «sin permiso»: se muestran los pasos para darlo en lugar de un aviso. */
const BLOCKED: Record<string, Blocked> = { 'not-allowed': 'mic', 'service-not-allowed': 'service' };
let blockedThisSession: Blocked | null = null; // al volver a tocar el micrófono, los pasos salen directamente

const isStandalone = () => typeof matchMedia !== 'undefined' && (matchMedia('(display-mode: standalone)').matches
  || (navigator as unknown as { standalone?: boolean }).standalone === true);

/** ¿El navegador ya sabe que el micrófono está denegado? (Safari 16+, Chrome). Sin la API, se sabrá al empezar. */
async function micDenied(): Promise<boolean> {
  try {
    return (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state === 'denied';
  } catch {
    return false;
  }
}

interface Props {
  names: Map<string, Entity>;
  today: ISODate;
  onAdd: (lines: ParsedLine[]) => Promise<void>;
  onClose: () => void;
}

/** Dictado: hablas tareas seguidas (pausa, punto o «siguiente» entre ellas) y se añaden de una vez. */
const PAUSE_MS = 1100; // silencio entre resultados que separa una tarea de la siguiente

export function Dictation({ names, today, onAdd, onClose }: Props) {
  // Tareas de sesiones anteriores («Seguir hablando») y de la sesión en curso, que se recalcula entera en cada
  // resultado: algunos navegadores (Chrome en Android, Safari) repiten el texto acumulado como resultados nuevos.
  const [done, setDone] = useState<string[]>([]);
  const [live, setLive] = useState<string[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const [blocked, setBlocked] = useState<Blocked | null>(blockedThisSession);
  const rec = useRef<Recognition | null>(null);
  const items = [...done, ...live].filter((t) => !removed.has(t));

  const start = () => {
    const C = Ctor();
    if (!C) return;
    const r = new C();
    r.lang = 'es-ES';
    r.continuous = true;
    r.interimResults = true;
    // Cortes por pausa, en nº de palabras: si pasa PAUSE_MS sin resultados, lo siguiente es otra tarea.
    const cuts: number[] = [];
    let last = 0;
    let words = 0;
    let current: string[] = [];
    r.onresult = (e) => {
      const now = Date.now();
      if (last && now - last > PAUSE_MS && words) cuts.push(words);
      last = now;
      const phrases = collapseResults(Array.from(e.results, (res) => res[0].transcript));
      words = phrases.join(' ').split(/\s+/).filter(Boolean).length;
      current = dictationItems(phrases, cuts);
      setLive(current);
    };
    r.onerror = (e) => {
      if (e.error === 'aborted') return;
      const b = BLOCKED[e.error];
      if (b) { blockedThisSession = b; setBlocked(b); return; }
      setError(ERRORS[e.error] ?? 'No se ha podido dictar.');
    };
    r.onend = () => {
      // Lo de esta sesión pasa a fijo; «Seguir hablando» empieza una sesión nueva.
      setDone((d) => [...d, ...current]);
      setLive([]);
      current = [];
      setListening(false);
    };
    setError('');
    setListening(true);
    rec.current = r;
    r.start();
  };
  // Reintentar tras dar permiso: si el navegador sigue diciendo que no, los pasos se quedan.
  const retry = async () => {
    if (await micDenied()) return;
    blockedThisSession = null;
    setBlocked(null);
    start();
  };
  const stop = () => rec.current?.stop();

  useEffect(() => {
    if (blockedThisSession) return;
    let gone = false;
    micDenied().then((denied) => {
      if (gone) return;
      if (denied) { blockedThisSession = 'mic'; setBlocked('mic'); } else start();
    });
    return () => { gone = true; rec.current?.abort(); };
  }, []);

  const add = async () => {
    rec.current?.abort();
    await onAdd(items.map((t) => parseLine(t)));
    onClose();
  };

  return (
    <div class="ent-back" onClick={onClose}>
      <div class="ent-sheet dict" role="dialog" aria-modal="true" aria-label="Dictar tareas" onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
        <div class="dict-head">
          <span class={`dict-dot ${listening ? 'on' : ''}`} aria-hidden="true" />
          <span class="label">{blocked ? 'Sin acceso al micrófono' : listening ? 'Escuchando…' : 'Dictado en pausa'}</span>
        </div>
        {blocked ? (
          <div class="dict-blocked" role="alert">
            <p>{blocked === 'service'
              ? 'El dictado está desactivado en este dispositivo. Para usarlo:'
              : 'Lista no tiene permiso para usar el micrófono. Para dictar:'}</p>
            <ol>{micSteps(blocked, navigator.userAgent, isStandalone(), navigator.maxTouchPoints).map((s) => <li key={s}>{s}</li>)}</ol>
            {blocked === 'mic' && <p class="dict-note">Mientras tanto, puedes usar el micrófono del teclado en la caja de texto.</p>}
          </div>
        ) : <p class="dict-hint">Di una tarea, haz una pausa y di la siguiente. «Prioridad alta», «tema trabajo» y «persona Ana» también valen.</p>}
        <ul class="dict-list">
          {items.map((t, i) => {
            const p = parseLine(t);
            return (
              <li key={i}>
                <div class="dict-item">
                  <span>{p.title}</span>
                  <span class="meta">
                    <TaskChips due={p.due} period={p.period} priority={p.priority} recurrence={p.recurrence}
                      topics={p.topics.map(normalizeKey)} people={p.people.map(normalizeKey)} names={withNames(names, p)}
                      today={today} title={p.title} />
                  </span>
                </div>
                <button class="dict-x" aria-label={`Quitar «${p.title}»`} onClick={() => setRemoved((r) => new Set(r).add(t))}>×</button>
              </li>
            );
          })}
        </ul>
        {error && <p class="err">{error}</p>}
        {blocked ? (
          <div class="ent-actions">
            <button class="btn solid" onClick={retry}>Reintentar</button>
            <button class="link" onClick={onClose}>Cerrar</button>
          </div>
        ) : <div class="ent-actions">
          <button class="btn solid" disabled={!items.length} onClick={add}>
            {items.length ? `Añadir ${items.length} ${items.length === 1 ? 'tarea' : 'tareas'}` : 'Añadir'}
          </button>
          {listening
            ? <button class="link" onClick={stop}>Parar</button>
            : <button class="link" onClick={start}>Seguir hablando</button>}
          <button class="link" onClick={onClose}>Cancelar</button>
        </div>}
      </div>
    </div>
  );
}

/** Nombres para los chips de temas/personas que aún no existen. */
function withNames(names: Map<string, Entity>, p: ParsedLine): Map<string, Entity> {
  const m = new Map(names);
  for (const t of p.topics) if (!m.has('#' + normalizeKey(t))) m.set('#' + normalizeKey(t), { key: normalizeKey(t), name: t } as Entity);
  for (const t of p.people) if (!m.has('@' + normalizeKey(t))) m.set('@' + normalizeKey(t), { key: normalizeKey(t), name: t } as Entity);
  return m;
}
