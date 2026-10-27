import { useEffect, useRef, useState } from 'preact/hooks';
import type { Entity, ISODate, ParsedLine } from '../types';
import { normalizeKey, parseLine } from '../parser';
import { splitDictation } from '../lib/speech';
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
  'not-allowed': 'Permite el micrófono para dictar.',
  'service-not-allowed': 'El dictado no está disponible aquí.',
  'no-speech': 'No te he oído. Toca «Seguir hablando».',
  network: 'Sin conexión: el dictado necesita internet.',
};

interface Props {
  names: Map<string, Entity>;
  today: ISODate;
  onAdd: (lines: ParsedLine[]) => Promise<void>;
  onClose: () => void;
}

/** Dictado: hablas tareas seguidas (pausa, punto o «siguiente» entre ellas) y se añaden de una vez. */
export function Dictation({ names, today, onAdd, onClose }: Props) {
  const [items, setItems] = useState<string[]>([]);
  const [interim, setInterim] = useState('');
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const rec = useRef<Recognition | null>(null);

  const start = () => {
    const C = Ctor();
    if (!C) return;
    const r = new C();
    r.lang = 'es-ES';
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let partial = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) {
          const found = splitDictation(res[0].transcript);
          if (found.length) setItems((xs) => [...xs, ...found]);
        } else partial += res[0].transcript;
      }
      setInterim(partial);
    };
    r.onerror = (e) => { if (e.error !== 'aborted') setError(ERRORS[e.error] ?? 'No se ha podido dictar.'); };
    r.onend = () => { setListening(false); setInterim(''); };
    setError('');
    setListening(true);
    rec.current = r;
    r.start();
  };
  const stop = () => rec.current?.stop();

  useEffect(() => {
    start();
    return () => rec.current?.abort();
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
          <span class="label">{listening ? 'Escuchando…' : 'Dictado en pausa'}</span>
        </div>
        <p class="dict-hint">Di una tarea, haz una pausa y di la siguiente. «Prioridad alta», «tema trabajo» y «persona Ana» también valen.</p>
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
                <button class="dict-x" aria-label={`Quitar «${p.title}»`} onClick={() => setItems((xs) => xs.filter((_, k) => k !== i))}>×</button>
              </li>
            );
          })}
          {interim && <li class="dict-interim">{interim}…</li>}
        </ul>
        {error && <p class="err">{error}</p>}
        <div class="ent-actions">
          <button class="btn solid" disabled={!items.length} onClick={add}>
            {items.length ? `Añadir ${items.length} ${items.length === 1 ? 'tarea' : 'tareas'}` : 'Añadir'}
          </button>
          {listening
            ? <button class="link" onClick={stop}>Parar</button>
            : <button class="link" onClick={start}>Seguir hablando</button>}
          <button class="link" onClick={onClose}>Cancelar</button>
        </div>
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
