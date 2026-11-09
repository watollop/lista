import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Entity, ISODate, ParsedLine, TodoList } from '../types';
import { activeToken, normalizeKey, parseBlock } from '../parser';
import { validateCapture } from '../lib/capture';
import { listKey } from '../lib/text';
import { TaskChips } from './Chips';
import { canDictate } from './recognition';
import { LazyDictation } from './lazyViews';
import { listInsertText, listSuggestions } from './suggest';
import { tr } from '../i18n';

interface Props {
  topics: Entity[];
  people: Entity[];
  names: Map<string, Entity>;
  lists?: TodoList[]; // todas, la principal primero
  target?: TodoList | null; // donde cae lo que se escribe sin /lista; null si solo hay una lista
  today: ISODate;
  kbOpen: boolean;
  inputRef: { current: HTMLInputElement | null };
  onAdd: (lines: ParsedLine[]) => Promise<void>;
  /** Un enlace de invitación (#unirse=…) pegado o escrito aquí no es una tarea: abre el diálogo de unirse. */
  onJoinLink?: (link: string) => void;
}

const JOIN_MARK = '#unirse=';

/** Una opción del desplegable: lo que se muestra, su etiqueta y lo que se inserta al aceptarla. */
interface Option {
  key: string;
  display: string;
  hint: string;
  insert: string;
}

const NO_LISTS: TodoList[] = [];

export function Capture({ topics, people, names, lists = NO_LISTS, target = null, today, kbOpen, inputRef, onAdd, onJoinLink }: Props) {
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
  const suggestions = useMemo<Option[]>(() => {
    if (!active) return [];
    if (active.type === 'list') {
      return listSuggestions(lists, active.prefix).map((l) => ({
        key: l.id, display: `/${l.name}`, hint: tr('lista', 'list'), insert: listInsertText(l.name),
      }));
    }
    const sym = active.type === 'topic' ? '#' : '@';
    const pool = active.type === 'topic' ? topics : people;
    const p = normalizeKey(active.prefix);
    const hits = pool.filter((e) => e.key.startsWith(p) && e.key !== p).slice(0, 6);
    return hits.map((e) => ({
      key: e.key, display: sym + e.name, hint: active.type === 'topic' ? tr('tema', 'topic') : tr('persona', 'person'), insert: sym + e.name,
    }));
  }, [active, topics, people, lists]);

  const sync = (el: HTMLInputElement) => {
    setValue(el.value);
    setCaret(el.selectionStart ?? el.value.length);
    setSel(0);
  };

  /** Sustituye el token activo por `text` y deja el cursor tras él (y un espacio). */
  const insert = (text: string) => {
    if (!active) return;
    const next = value.slice(0, active.start) + text + ' ' + value.slice(active.end).replace(/^[^\s<]*\s?/, '');
    const pos = active.start + text.length + 1;
    setValue(next);
    setCaret(pos);
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(pos, pos));
  };

  const accept = (o: Option) => insert(o.insert);

  // La lista de destino de la línea, si escribe /lista distinta de la de target.
  const destination = parsed?.list ? lists.find((l) => listKey(l.name) === parsed.list) : undefined;
  const showDestination = !!destination && !!target && destination.id !== target.id;

  // Guía de sintaxis: /lista solo aparece si hay más de una lista.
  const guide = [
    tr('#tema', '#topic'),
    tr('@persona', '@person'),
    ...(lists.length > 1 ? [tr('/lista', '/list')] : []),
    tr('!prioridad', '!priority'),
    tr('fecha', 'date'),
    tr('<subtarea', '<subtask'),
  ].join(' ');

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
      if (onJoinLink && value.includes(JOIN_MARK)) { onJoinLink(value.trim()); setValue(''); setError(''); return; }
      if (value.trim()) void submit().catch((e: Error) => setError(e.message));
    }
    if (e.key === 'Escape') {
      if (value) { setValue(''); setError(''); }
      else (e.target as HTMLInputElement).blur();
    }
  };

  const onPaste = async (e: ClipboardEvent) => {
    const text = e.clipboardData?.getData('text') ?? '';
    if (onJoinLink && text.includes(JOIN_MARK)) { e.preventDefault(); onJoinLink(text.trim()); return; }
    if (!text.includes('\n')) return;
    e.preventDefault();
    if (busy) {
      setError(tr('Guarda primero la tarea con sus subtareas antes de pegar varias líneas.', 'Save the task and its subtasks before pasting several lines.'));
      return;
    }
    const pasted = parseBlock(text);
    if (pasted.length) {
      try { await onAdd(validateCapture(pasted)); }
      catch (e) { setError(e instanceof Error ? e.message : tr('No se pudieron añadir las tareas.', 'Couldn’t add the tasks.')); }
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
                  {s.display}
                  <small>{s.hint}</small>
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
          placeholder={tr('Viaje <Billetes mañana !alta #ocio @ana', 'Trip <Tickets tomorrow !high #fun @ana')}
          aria-label={target ? tr(`Nueva tarea en ${target.name}`, `New task in ${target.name}`) : tr('Nueva tarea', 'New task')}
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
          <button class="mic" disabled={busy} aria-label={tr('Dictar tareas', 'Dictate tasks')} title={tr('Dictar tareas', 'Dictate tasks')} onClick={() => setDictating(true)}>
            <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor"
              stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" /><path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" />
            </svg>
          </button>
        )}
        </div>
        <div id="capture-guide" class="capture-guide">{guide}</div>
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
          {showDestination && (
            <span class="chip" title={tr(`Va a la lista ${destination!.name}`, `Goes to list ${destination!.name}`)}>
              → {destination!.name}
            </span>
          )}
        </div>
      </div>
      {dictating && <LazyDictation names={names} today={today} onAdd={onAdd} onClose={() => setDictating(false)} />}
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
