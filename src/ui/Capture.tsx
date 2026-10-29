import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Entity, ISODate, ParsedLine } from '../types';
import { activeToken, normalizeKey, parseBlock } from '../parser';
import { validateCapture } from '../lib/capture';
import { TaskChips } from './Chips';
import { Dictation, canDictate } from './Dictation';

interface Props {
  topics: Entity[];
  people: Entity[];
  names: Map<string, Entity>;
  today: ISODate;
  kbOpen: boolean;
  inputRef: { current: HTMLInputElement | null };
  onAdd: (lines: ParsedLine[]) => Promise<void>;
}

export function Capture({ topics, people, names, today, kbOpen, inputRef, onAdd }: Props) {
  const [value, setValue] = useState('');
  const [caret, setCaret] = useState(0);
  const [sel, setSel] = useState(0);
  const composing = useRef(false);
  const [dictating, setDictating] = useState(false);
  const [mic] = useState(canDictate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  const refocus = useRef(false);
  const container = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    let frame = 0;
    const measure = () => {
      const height = `${container.current?.offsetHeight ?? 0}px`;
      const style = document.documentElement.style;
      if (style.getPropertyValue('--capture-height') !== height) style.setProperty('--capture-height', height);
    };
    measure();
    // Cambiar el espaciado desde ResizeObserver puede realimentar su propio cálculo de layout.
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    if (container.current) observer.observe(container.current);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      document.documentElement.style.removeProperty('--capture-height');
    };
  }, []);
  useLayoutEffect(() => {
    if (!busy && refocus.current) {
      refocus.current = false;
      inputRef.current?.focus();
    }
  }, [busy]);

  const lines = useMemo(() => (value.trim() ? parseBlock(value) : []), [value, today]);
  const parsed = lines[lines.length - 1];
  const active = useMemo(() => activeToken(value, caret), [value, caret]);
  const suggestions = useMemo(() => {
    if (!active) return [];
    const pool = active.type === 'topic' ? topics : people;
    const p = normalizeKey(active.prefix);
    const hits = pool.filter((e) => e.key.startsWith(p) && e.key !== p);
    return hits.slice(0, 6);
  }, [active, topics, people]);

  const sync = (el: HTMLInputElement) => {
    setValue(el.value);
    setCaret(el.selectionStart ?? el.value.length);
    setSel(0);
  };

  const accept = (e: Entity) => {
    if (!active) return;
    const sym = active.type === 'topic' ? '#' : '@';
    const next = value.slice(0, active.start) + sym + e.name + ' ' + value.slice(active.end).replace(/^[^\s<]*\s?/, '');
    const pos = active.start + sym.length + e.name.length + 1;
    setValue(next);
    setCaret(pos);
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(pos, pos));
  };

  const submit = async () => {
    const captured = validateCapture(lines);
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      await onAdd(captured);
      setValue('');
      setCaret(0);
      refocus.current = true;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (composing.current || e.isComposing) return;
    if (suggestions.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((sel + 1) % suggestions.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((sel - 1 + suggestions.length) % suggestions.length); return; }
      if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); accept(suggestions[sel]); return; }
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (value.trim()) void submit().catch((e: Error) => setError(e.message));
    }
    if (e.key === 'Escape') {
      if (value) { setValue(''); setError(''); }
      else (e.target as HTMLInputElement).blur();
    }
  };

  const onPaste = async (e: ClipboardEvent) => {
    const text = e.clipboardData?.getData('text') ?? '';
    if (!text.includes('\n')) return;
    e.preventDefault();
    if (busy) {
      setError('Guarda primero la tarea con sus subtareas antes de pegar varias líneas.');
      return;
    }
    const pasted = parseBlock(text);
    if (pasted.length) {
      try { await onAdd(validateCapture(pasted)); }
      catch (e) { setError(e instanceof Error ? e.message : 'No se pudieron añadir las tareas.'); }
    }
  };

  return (
    <div ref={container} class={`capture ${kbOpen ? 'kb' : ''}`}>
      <div class="capture-inner">
        {suggestions.length > 0 && (
          <ul class="suggest" role="listbox">
            {suggestions.map((s, i) => (
              <li class={i === sel ? 'on' : ''} key={s.key}>
                <button onMouseDown={(e) => { e.preventDefault(); accept(s); }}>
                  {active!.type === 'topic' ? '#' : '@'}{s.name}
                  <small>{active!.type === 'topic' ? 'tema' : 'persona'}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div class="capture-row">
        <input
          ref={inputRef}
          value={value}
          disabled={busy}
          placeholder="Viaje <Billetes mañana !alta #ocio @ana"
          aria-label="Nueva tarea"
          aria-describedby="capture-guide"
          autocomplete="off"
          enterkeyhint="enter" // la tecla azul dice "intro": no se confunde con el ✓ de iOS, que solo cierra el teclado
          onInput={(e) => sync(e.currentTarget)}
          onKeyUp={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onClick={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={() => (composing.current = false)}
        />
        {mic && (
          <button class="mic" disabled={busy} aria-label="Dictar tareas" title="Dictar tareas" onClick={() => setDictating(true)}>
            <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor"
              stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" /><path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" />
            </svg>
          </button>
        )}
        </div>
        <div id="capture-guide" class="capture-guide">#tema @persona !prioridad fecha &lt;subtarea</div>
        {error && <p class="err" role="alert">{error}</p>}
        <div class="preview">
          {parsed && parsed.tokens.length > 0 && (
            <TaskChips
              due={parsed.due}
              period={parsed.period}
              priority={parsed.priority}
              recurrence={parsed.recurrence}
              topics={parsed.topics.map(normalizeKey)}
              people={parsed.people.map(normalizeKey)}
              names={withTyped(names, parsed)}
              today={today}
            />
          )}
        </div>
      </div>
      {dictating && <Dictation names={names} today={today} onAdd={onAdd} onClose={() => setDictating(false)} />}
    </div>
  );
}

/** Para la vista previa: nombres tal y como se están escribiendo si el tema/persona aún no existe. */
function withTyped(names: Map<string, Entity>, p: ParsedLine): Map<string, Entity> {
  const m = new Map(names);
  const add = (sym: string, n: string) => {
    const k = sym + normalizeKey(n);
    if (!m.has(k)) m.set(k, { key: normalizeKey(n), name: n, updatedAt: 0, deleted: 0, dirty: 0 });
  };
  p.topics.forEach((n) => add('#', n));
  p.people.forEach((n) => add('@', n));
  return m;
}
