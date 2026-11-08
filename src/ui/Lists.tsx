import { useEffect, useRef, useState } from 'preact/hooks';
import { MAIN_LIST, type ID, type ListScope, type TodoList } from '../types';
import { tr } from '../i18n';
import { PeopleIcon } from './PeopleIcon';

/** Nombre de lista sin espacios sobrantes. */
const cleanName = (s: string) => s.trim();

/** Icono de lápiz (como en la barra lateral de temas y personas). */
function Pencil() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">
      <path d="M3 13l.6-2.6 7.4-7.4 2 2-7.4 7.4z" /><path d="M9.5 4.5l2 2" />
    </svg>
  );
}

interface SheetProps {
  mode: 'pick' | 'move';
  lists: TodoList[];
  pending: Map<ID, number>; // pendientes por lista
  total: number; // pendientes de todas
  scope: ListScope; // lista actual (en 'pick' lleva la marca ✓)
  current?: ID; // en 'move': la lista de la tarea (aparece deshabilitada)
  onPick: (scope: ListScope) => void; // en 'move', elegir lista mueve la tarea
  onCreate: (name: string) => Promise<void>; // lanza Error si no se puede (se muestra junto al campo)
  onRename: (id: ID, name: string) => Promise<void>;
  onDelete: (id: ID) => void; // la confirmación la gestiona App
  onClose: () => void;
  // Compartir (docs/plan-listas.md, fase 2D). Con sharing false no aparece nada de compartir.
  sharing?: boolean; // hay sincronización configurada (Settings: state.status !== 'disabled')
  onShare?: (id: ID) => void; // abre el diálogo de compartir de esa lista
  onJoin?: () => void; // «Unirse con un enlace»
}

/**
 * Hoja de listas. 'pick': cambiar de lista, con «Todas», renombrar y borrar. 'move': elegir destino para la tarea
 * (sin «Todas», sin editar). Esc o un clic fuera la cierran; Esc dentro de un campo solo cancela ese campo.
 */
export function ListSheet(p: SheetProps) {
  const { mode, lists, pending, scope, current } = p;
  const move = mode === 'move';
  const sharing = !!p.sharing;
  const anyShared = sharing && lists.some((l) => !!l.shared);
  const title = move ? tr('Mover a…', 'Move to…') : tr('Listas', 'Lists');
  const ref = useRef<HTMLDivElement>(null);
  // Guardamos el último onClose para que el efecto (que solo corre al abrir) no use uno viejo.
  const closeRef = useRef(p.onClose);
  closeRef.current = p.onClose;

  // Foco al abrir; al cerrar vuelve al elemento que tenía el foco (el ▾ de la cabecera, la tecla l, el editor…).
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

  const [editing, setEditing] = useState<ID | null>(null);
  const [editName, setEditName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const startEdit = (l: TodoList) => { setError(''); setCreating(false); setEditing(l.id); setEditName(l.name); };
  const cancelEdit = () => { setError(''); setEditing(null); };
  const saveEdit = async (id: ID) => {
    const name = cleanName(editName);
    if (!name) { setError(tr('Escribe un nombre.', 'Write a name.')); return; }
    setBusy(true);
    try {
      await p.onRename(id, name);
      setEditing(null);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('No se pudo renombrar la lista.', 'Couldn’t rename the list.'));
    } finally { setBusy(false); }
  };

  const openCreate = () => { setError(''); setEditing(null); setCreating(true); setNewName(''); };
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

  // Esc dentro de un campo cancela ese campo y corta la propagación: no cierra la hoja.
  const escCancels = (cancel: () => void) => (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); cancel(); }
  };
  const enter = (run: () => void) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); run(); }
  };

  const mark = move ? current : scope;
  const count = (id: ID) => pending.get(id) ?? 0;

  return (
    <div class="dialog-backdrop" onClick={(e) => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div class="dialog list-sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <span class="label">{title}</span>
        {move && anyShared && (
          <p class="look-hint">
            {tr('Las listas con ', 'Lists with ')}
            <PeopleIcon title={tr('Compartida', 'Shared')} />
            {tr(' están compartidas: lo que muevas ahí lo verán sus miembros.', ' are shared: what you move there will be seen by its members.')}
          </p>
        )}
        <ul class="ls-list">
          {lists.map((l) => {
            const here = l.id === mark;
            if (editing === l.id && !move) {
              return (
                <li class="ls-row ls-editing" key={l.id}>
                  <input class="ls-input" value={editName} aria-label={tr('Nombre de la lista', 'List name')} autoFocus
                    onInput={(e) => setEditName(e.currentTarget.value)} disabled={busy}
                    onKeyDown={(e) => { escCancels(cancelEdit)(e); enter(() => void saveEdit(l.id))(e); }} />
                  <div class="ls-acts">
                    <button class="link" onClick={() => void saveEdit(l.id)} disabled={busy}>{tr('Guardar', 'Save')}</button>
                    <button class="link" onClick={cancelEdit}>{tr('Cancelar', 'Cancel')}</button>
                    {sharing && p.onShare && l.id !== MAIN_LIST && (
                      <button class="link" aria-label={`${l.shared ? tr('Compartida', 'Shared') : tr('Compartir', 'Share')} ${l.name}`}
                        onClick={() => p.onShare?.(l.id)}>{l.shared ? tr('Compartida', 'Shared') : tr('Compartir', 'Share')}</button>
                    )}
                    {l.id !== MAIN_LIST && !l.shared && (
                      <button class="link danger" onClick={() => p.onDelete(l.id)}>{tr('Borrar lista', 'Delete list')}</button>
                    )}
                  </div>
                </li>
              );
            }
            return (
              <li class={`ls-row ${here ? 'on' : ''}`} key={l.id}>
                <button class="ls-pick" aria-current={here ? 'true' : undefined} disabled={move && here}
                  onClick={() => p.onPick(l.id)}>
                  <span class="ls-name">{l.name}</span>
                  {sharing && !!l.shared && <PeopleIcon title={tr('Compartida', 'Shared')} />}
                  {count(l.id) > 0 && <span class="ls-count">{count(l.id)}</span>}
                  <span class="ls-mark" aria-hidden="true">{here ? '✓' : ''}</span>
                </button>
                {!move && (
                  <button class="ls-edit" aria-label={tr(`Editar ${l.name}`, `Edit ${l.name}`)} title={tr('Editar', 'Edit')}
                    onClick={() => startEdit(l)}><Pencil /></button>
                )}
              </li>
            );
          })}
          {!move && lists.length > 1 && (
            <li class={`ls-row ${scope === 'all' ? 'on' : ''}`} key="all">
              <button class="ls-pick" aria-current={scope === 'all' ? 'true' : undefined} onClick={() => p.onPick('all')}>
                <span class="ls-name">{tr('Todas las listas', 'All lists')}</span>
                {p.total > 0 && <span class="ls-count">{p.total}</span>}
                <span class="ls-mark" aria-hidden="true">{scope === 'all' ? '✓' : ''}</span>
              </button>
            </li>
          )}
        </ul>

        {creating ? (
          <div class="ls-new">
            <input class="ls-input" value={newName} placeholder={tr('Nombre de la lista', 'List name')}
              aria-label={tr('Nombre de la lista nueva', 'New list name')} autoFocus disabled={busy}
              onInput={(e) => setNewName(e.currentTarget.value)}
              onKeyDown={(e) => { escCancels(() => { setCreating(false); setError(''); })(e); enter(() => void create())(e); }} />
            <div class="ls-acts">
              <button class="link" onClick={() => void create()} disabled={busy}>{move ? tr('Crear y mover', 'Create and move') : tr('Crear', 'Create')}</button>
              <button class="link" onClick={() => { setCreating(false); setError(''); }}>{tr('Cancelar', 'Cancel')}</button>
            </div>
          </div>
        ) : (
          <button class="ls-add" onClick={openCreate}>{tr('+ Nueva lista', '+ New list')}</button>
        )}
        {!move && sharing && p.onJoin && (
          <button class="ls-add" onClick={() => p.onJoin?.()}>{tr('Unirse con un enlace', 'Join with a link')}</button>
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
    // Fase de captura: se queda con el Esc antes que la hoja de listas que lo abrió (y que también escucha en window).
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
