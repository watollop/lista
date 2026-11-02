import { useEffect, useRef, useState } from 'preact/hooks';
import type { Entity, ISODate, ParsedLine } from '../types';
import { normalizeKey, parseLine } from '../parser';
import { collapseResults, dictationItems } from '../lib/speech';
import { micSteps, type Blocked } from '../lib/mic';
import { TaskChips } from './Chips';
import { Ctor, type Recognition } from './recognition';
import { isEn, tr } from '../i18n';

const ERRORS = (): Record<string, string> => ({
  'no-speech': tr('No te he oído. Toca «Seguir hablando».', 'I didn’t hear you. Tap “Keep talking”.'),
  network: tr('Sin conexión: el dictado necesita internet.', 'Offline: dictation needs an internet connection.'),
});

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
    // Inglés: la variante del navegador si es inglesa (en-GB, en-US…); si no, en-US.
    r.lang = isEn() ? (navigator.language?.toLowerCase().startsWith('en') ? navigator.language : 'en-US') : 'es-ES';
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
      setError(ERRORS()[e.error] ?? tr('No se ha podido dictar.', 'Dictation failed.'));
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
      <div class="ent-sheet dict" role="dialog" aria-modal="true" aria-label={tr('Dictar tareas', 'Dictate tasks')} onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
        <div class="dict-head">
          <span class={`dict-dot ${listening ? 'on' : ''}`} aria-hidden="true" />
          <span class="label">{blocked ? tr('Sin acceso al micrófono', 'No microphone access') : listening ? tr('Escuchando…', 'Listening…') : tr('Dictado en pausa', 'Dictation paused')}</span>
        </div>
        {blocked ? (
          <div class="dict-blocked" role="alert">
            <p>{blocked === 'service'
              ? tr('El dictado está desactivado en este dispositivo. Para usarlo:', 'Dictation is turned off on this device. To use it:')
              : tr('Lista no tiene permiso para usar el micrófono. Para dictar:', 'Lista isn’t allowed to use the microphone. To dictate:')}</p>
            <ol>{micSteps(blocked, navigator.userAgent, isStandalone(), navigator.maxTouchPoints).map((s) => <li key={s}>{s}</li>)}</ol>
            {blocked === 'mic' && <p class="dict-note">{tr('Mientras tanto, puedes usar el micrófono del teclado en la caja de texto.', 'Meanwhile, you can use your keyboard’s microphone in the text box.')}</p>}
          </div>
        ) : <p class="dict-hint">{tr('Di una tarea, haz una pausa y di la siguiente. «Prioridad alta», «tema trabajo» y «persona Ana» también valen.', 'Say a task, pause, then say the next one. “High priority”, “tag work” and “person Ana” work too.')}</p>}
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
                <button class="dict-x" aria-label={tr(`Quitar «${p.title}»`, `Remove “${p.title}”`)} onClick={() => setRemoved((r) => new Set(r).add(t))}>×</button>
              </li>
            );
          })}
        </ul>
        {error && <p class="err">{error}</p>}
        {blocked ? (
          <div class="ent-actions">
            <button class="btn solid" onClick={retry}>{tr('Reintentar', 'Try again')}</button>
            <button class="link" onClick={onClose}>{tr('Cerrar', 'Close')}</button>
          </div>
        ) : <div class="ent-actions">
          <button class="btn solid" disabled={!items.length} onClick={add}>
            {items.length ? tr(`Añadir ${items.length} ${items.length === 1 ? 'tarea' : 'tareas'}`, `Add ${items.length} ${items.length === 1 ? 'task' : 'tasks'}`) : tr('Añadir', 'Add')}
          </button>
          {listening
            ? <button class="link" onClick={stop}>{tr('Parar', 'Stop')}</button>
            : <button class="link" onClick={start}>{tr('Seguir hablando', 'Keep talking')}</button>}
          <button class="link" onClick={onClose}>{tr('Cancelar', 'Cancel')}</button>
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
