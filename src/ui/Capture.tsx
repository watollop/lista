import { useMemo, useRef, useState } from 'preact/hooks';
import type { Entity, ISODate, ParsedLine } from '../types';
import { activeToken, normalizeKey, parseBlock, parseLine } from '../parser';
import { TaskChips } from './Chips';

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

  const parsed = useMemo(() => (value.trim() ? parseLine(value) : null), [value, today]);
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
    const next = value.slice(0, active.start) + sym + e.name + ' ' + value.slice(active.end).replace(/^\S*\s?/, '');
    const pos = active.start + sym.length + e.name.length + 1;
    setValue(next);
    setCaret(pos);
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(pos, pos));
  };

  const submit = async () => {
    if (!parsed || !parsed.title) return;
    setValue('');
    setCaret(0);
    await onAdd([parsed]);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (composing.current || e.isComposing) return;
    if (suggestions.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((sel + 1) % suggestions.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((sel - 1 + suggestions.length) % suggestions.length); return; }
      if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); accept(suggestions[sel]); return; }
    }
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    if (e.key === 'Escape') {
      if (value) setValue('');
      else (e.target as HTMLInputElement).blur();
    }
  };

  const onPaste = async (e: ClipboardEvent) => {
    const text = e.clipboardData?.getData('text') ?? '';
    if (!text.includes('\n')) return;
    e.preventDefault();
    const lines = parseBlock(text).filter((l) => l.title);
    if (lines.length) await onAdd(lines);
  };

  return (
    <div class={`capture ${kbOpen ? 'kb' : ''}`}>
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
        <input
          ref={inputRef}
          value={value}
          placeholder="Nueva tarea…  #tema @persona mañana !1"
          aria-label="Nueva tarea"
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
