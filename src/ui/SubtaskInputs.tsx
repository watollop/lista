import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ParsedLine } from '../types';
import { parseBlock } from '../parser';
import { TITLE_TOO_LONG, titleTooLong } from '../lib/capture';

export function SubtaskInputs({ onSubmit, onCancel, onEach, label = 'Guardar tarea' }: {
  onSubmit: (lines: ParsedLine[]) => Promise<void>;
  onCancel: () => void;
  /** Tarea ya existente: cada Enter guarda esa subtarea al momento y deja el campo listo para la siguiente. */
  onEach?: (lines: ParsedLine[]) => Promise<void>;
  label?: string;
}) {
  const [values, setValues] = useState(['']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const focus = useRef<number | null>(0);
  const saving = useRef(false);

  useLayoutEffect(() => {
    if (focus.current === null) return;
    const input = inputs.current[focus.current];
    focus.current = null;
    input?.focus();
    input?.scrollIntoView({ block: 'nearest' });
  });

  /** Valida y guarda con `save`; devuelve true si se guardó. */
  const run = async (texts: string[], save: (lines: ParsedLine[]) => Promise<void>) => {
    if (saving.current) return false;
    const lines = texts.filter((v) => v.trim()).flatMap((v) => parseBlock(v).map((line) => ({ ...line, isSubtask: true })));
    if (lines.some((l) => !l.title)) {
      setError('Escribe un título para cada subtarea, además de sus etiquetas.');
      return false;
    }
    if (titleTooLong(lines)) { setError(TITLE_TOO_LONG); return false; }
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      await save(lines);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron guardar las subtareas.');
      return false;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  const submit = () => run(values, onSubmit);
  // Guardar esta subtarea ya y vaciar el campo para la siguiente.
  const saveOne = async (i: number) => {
    if (!onEach || !(await run([values[i]], onEach))) return;
    focus.current = 0;
    setValues(['']);
  };

  return (
    <div class="subtask-inputs">
      <div class="subtask-fields">
        {values.map((v, i) => (
          <div class="subtask-field" key={i}>
            <input ref={(el) => { inputs.current[i] = el; }} value={v} disabled={busy}
              aria-label={`Subtarea ${i + 1}`} placeholder="Nueva subtarea…"
              autocomplete="off" enterkeyhint={v.trim() ? 'next' : 'done'}
              onInput={(e) => { setValues(values.map((s, j) => j === i ? e.currentTarget.value : s)); setError(''); }}
              onKeyDown={(e) => {
                if (e.isComposing || e.key !== 'Enter') return;
                e.preventDefault();
                if (!v.trim()) { void submit(); return; }
                if (parseBlock(v).some((line) => !line.title)) { setError('Escribe un título para cada subtarea.'); return; }
                if (onEach) { void saveOne(i); return; }
                if (i < values.length - 1) inputs.current[i + 1]?.focus();
                else {
                  focus.current = i + 1;
                  setValues([...values, '']);
                }
              }} />
            <button class="remove-subtask" disabled={busy} aria-label={`Quitar subtarea ${i + 1}`}
              onClick={() => {
                focus.current = Math.max(0, i - 1);
                setValues(values.length === 1 ? [''] : values.filter((_, j) => j !== i));
              }}>×</button>
          </div>
        ))}
      </div>
      <p class="subtask-help">{onEach ? 'Enter: guardar y escribir otra · Enter en vacío: cerrar' : 'Enter: siguiente · Enter en vacío: guardar'}</p>
      <div class="subtask-actions">
        <button class="link" disabled={busy} onClick={() => void submit()}>{busy ? 'Guardando…' : label}</button>
        <button class="link" disabled={busy} onClick={onCancel}>Cancelar</button>
      </div>
      {error && <p class="err" role="alert">{error}</p>}
    </div>
  );
}
