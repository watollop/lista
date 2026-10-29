import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ParsedLine } from '../types';
import { parseBlock } from '../parser';

export function SubtaskInputs({ onSubmit, onCancel, label = 'Guardar tarea' }: {
  onSubmit: (lines: ParsedLine[]) => Promise<void>;
  onCancel: () => void;
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

  const submit = async () => {
    if (saving.current) return;
    const lines = values.filter((v) => v.trim()).flatMap((v) => parseBlock(v).map((line) => ({ ...line, isSubtask: true })));
    if (lines.some((l) => !l.title)) {
      setError('Escribe un título para cada subtarea, además de sus etiquetas.');
      return;
    }
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      await onSubmit(lines);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron guardar las subtareas.');
    } finally {
      saving.current = false;
      setBusy(false);
    }
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
      <p class="subtask-help">Enter: siguiente · Enter en vacío: guardar</p>
      <div class="subtask-actions">
        <button class="link" disabled={busy} onClick={() => void submit()}>{busy ? 'Guardando…' : label}</button>
        <button class="link" disabled={busy} onClick={onCancel}>Cancelar</button>
      </div>
      {error && <p class="err" role="alert">{error}</p>}
    </div>
  );
}
