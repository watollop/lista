import { useEffect, useRef, useState } from 'preact/hooks';
import type { ID, TodoList } from '../types';
import { tr } from '../i18n';
import { PeopleIcon } from './PeopleIcon';

/** Nombre de lista sin espacios sobrantes. */
const cleanName = (s: string) => s.trim();

interface SheetProps {
  lists: TodoList[];
  current: ID; // la lista de la tarea (aparece deshabilitada, con ✓)
  onPick: (id: ID) => void; // mueve la tarea a esa lista
  onCreate: (name: string) => Promise<void>; // crea la lista y mueve la tarea; lanza Error si no se puede (se muestra junto al campo)
  onClose: () => void;
  sharing?: boolean; // hay sincronización configurada: se marcan las listas compartidas
}

/**
 * Hoja «Mover a…» del editor de una tarea: elegir la lista de destino o crear una. Cambiar de lista, renombrar,
 * compartir y borrar están en las pestañas (ListTabs). Esc o un clic fuera la cierran; Esc en el campo solo lo cancela.
 */
export function ListSheet(p: SheetProps) {
  const { lists, current } = p;
  const anyShared = !!p.sharing && lists.some((l) => !!l.shared);
  const title = tr('Mover a…', 'Move to…');
  const ref = useRef<HTMLDivElement>(null);
  // Guardamos el último onClose para que el efecto (que solo corre al abrir) no use uno viejo.
  const closeRef = useRef(p.onClose);
  closeRef.current = p.onClose;

  // Foco al abrir; al cerrar vuelve al elemento que tenía el foco (el editor).
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); }
    };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
      prev?.focus?.();
    };
  }, []);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const name = cleanName(newName);
    if (!name) { setError(tr('Escribe un nombre.', 'Write a name.')); return; }
    setBusy(true);
    try {
      await p.onCreate(name);
      setCreating(false);
      setNewName('');
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('No se pudo crear la lista.', 'Couldn’t create the list.'));
    } finally { setBusy(false); }
  };
  const cancelCreate = () => { setCreating(false); setError(''); };

  return (
    <div class="dialog-backdrop" onClick={(e) => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div class="dialog list-sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <span class="label">{title}</span>
        {anyShared && (
          <p class="look-hint">
            {tr('Las listas con ', 'Lists with ')}
            <PeopleIcon title={tr('Compartida', 'Shared')} />
            {tr(' están compartidas: lo que muevas ahí lo verán sus miembros.', ' are shared: what you move there will be seen by its members.')}
          </p>
        )}
        <ul class="ls-list">
          {lists.map((l) => {
            const here = l.id === current;
            return (
              <li class={`ls-row ${here ? 'on' : ''}`} key={l.id}>
                <button class="ls-pick" aria-current={here ? 'true' : undefined} disabled={here} onClick={() => p.onPick(l.id)}>
                  <span class="ls-name">{l.name}</span>
                  {p.sharing && !!l.shared && <PeopleIcon title={tr('Compartida', 'Shared')} />}
                  <span class="ls-mark" aria-hidden="true">{here ? '✓' : ''}</span>
                </button>
              </li>
            );
          })}
        </ul>

        {creating ? (
          <div class="ls-new">
            <input class="ls-input" value={newName} placeholder={tr('Nombre de la lista', 'List name')}
              aria-label={tr('Nombre de la lista nueva', 'New list name')} autoFocus disabled={busy}
              onInput={(e) => setNewName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { e.stopPropagation(); cancelCreate(); }
                if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); void create(); }
              }} />
            <div class="ls-acts">
              <button class="link" onClick={() => void create()} disabled={busy}>{tr('Crear y mover', 'Create and move')}</button>
              <button class="link" onClick={cancelCreate}>{tr('Cancelar', 'Cancel')}</button>
            </div>
          </div>
        ) : (
          <button class="ls-add" onClick={() => { setError(''); setNewName(''); setCreating(true); }}>{tr('+ Nueva lista', '+ New list')}</button>
        )}
        {error && <p class="ls-error" role="alert">{error}</p>}
        <div class="row-btns"><button class="btn" onClick={p.onClose}>{tr('Cerrar', 'Close')}</button></div>
      </div>
    </div>
  );
}

interface ConfirmProps {
  title: string;
  text: string;
  confirm: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Diálogo de confirmación. El botón de la acción es el peligroso; el foco empieza en Cancelar. Esc cancela. */
export function ConfirmDialog({ title, text, confirm, onConfirm, onCancel }: ConfirmProps) {
  const ref = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    // Fase de captura: se queda con el Esc antes que las pestañas o la hoja que lo abrieron (también escuchan en window).
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelRef.current(); }
    };
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('keydown', key, true);
      prev?.focus?.();
    };
  }, []);
  useEffect(() => { ref.current?.querySelector<HTMLButtonElement>('.confirm-cancel')?.focus(); }, []);
  return (
    <div class="dialog-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div class="dialog confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-text" ref={ref}>
        <h2 class="confirm-title" id="confirm-title">{title}</h2>
        <p id="confirm-text">{text}</p>
        <div class="row-btns">
          <button class="btn confirm-cancel" onClick={onCancel}>{tr('Cancelar', 'Cancel')}</button>
          <button class="btn danger-btn solid" onClick={onConfirm}>{confirm}</button>
        </div>
      </div>
    </div>
  );
}
