import { useEffect, useRef } from 'preact/hooks';
import { SHORTCUTS } from './shortcuts';

/** Hoja «?» con los atajos de escritorio. Esc, «?» o un clic fuera la cierran (los gestiona App). */
export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => prev?.focus?.();
  }, []);
  return (
    <div class="dialog-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="dialog shortcuts" role="dialog" aria-modal="true" aria-label="Atajos de teclado" tabIndex={-1} ref={ref}>
        <span class="label">Atajos de teclado</span>
        <dl class="keys">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={what}>
              <dt>{keys.map((k) => <kbd key={k}>{k}</kbd>)}</dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
        <div class="row-btns"><button class="btn" onClick={onClose}>Cerrar</button></div>
      </div>
    </div>
  );
}
