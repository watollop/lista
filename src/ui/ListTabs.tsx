import { useEffect, useRef, useState } from 'preact/hooks';
import { MAIN_LIST, type ID, type ListScope, type TodoList } from '../types';
import { listDrop } from '../lib/reschedule';
import { tr } from '../i18n';
import { PeopleIcon } from './PeopleIcon';

interface Props {
  lists: TodoList[]; // en su orden (Personal primero)
  scope: ListScope; // lista actual, o 'all'
  sharing: boolean; // hay sincronización configurada: se puede compartir
  onPick: (scope: ListScope) => void;
  onCreate: (name: string) => Promise<void>; // lanza Error si el nombre no vale (se muestra bajo las pestañas)
  onRename: (id: ID, name: string) => Promise<void>;
  onDelete: (id: ID) => void; // la confirmación la gestiona App
  onShare: (id: ID) => void; // abre el diálogo de compartir (o de personas, si ya está compartida)
}

const MENU_W = 200; // ancho del menú de la pestaña activa (styles.css: .lt-menu)

/**
 * Pestañas de listas (docs/plan-listas.md, «Pestañas»): cambiar de lista con un toque, el único sitio donde se gestionan.
 * La activa lleva ▾: tocarla otra vez abre su menú (renombrar, compartir, borrar). «+» crea una lista en línea.
 * «Todas» solo con más de una. En escritorio, doble clic renombra y soltar una tarea en una pestaña la mueve allí.
 */
export function ListTabs(p: Props) {
  const navRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<number | null>(null); // izquierda del menú abierto (px dentro de la barra) o null
  const [renaming, setRenaming] = useState<ID | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const cancelled = useRef(false); // Esc: que el blur que llega al desmontar el campo no guarde lo escrito

  const active = p.scope === 'all' ? null : (p.lists.find((l) => l.id === p.scope) ?? null);
  const isShared = (l: TodoList) => p.sharing && !!l.shared;

  // El menú se cierra con Esc o tocando fuera.
  useEffect(() => {
    if (menu === null) return;
    const down = (e: PointerEvent) => { if (!navRef.current?.contains(e.target as Node)) setMenu(null); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMenu(null); } };
    document.addEventListener('pointerdown', down);
    window.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', down);
      window.removeEventListener('keydown', key, true);
    };
  }, [menu]);

  // La pestaña activa siempre a la vista (en el móvil la fila se desplaza).
  useEffect(() => {
    scrollRef.current?.querySelector<HTMLElement>('.lt-tab.on')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [p.scope, p.lists.length]);

  const closeAll = () => { setMenu(null); setRenaming(null); setCreating(false); setError(''); setName(''); };

  const tap = (scope: ListScope, e: MouseEvent) => {
    if (e.detail > 1) return; // el segundo clic de un doble clic (que renombra) no abre ni cierra nada
    if (scope !== p.scope || scope === 'all') { closeAll(); p.onPick(scope); return; }
    if (menu !== null) { setMenu(null); return; }
    const nav = navRef.current?.getBoundingClientRect();
    const tab = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu(nav ? Math.max(0, Math.min(tab.left - nav.left, nav.width - MENU_W)) : 0);
  };

  const startRename = (l: TodoList) => { cancelled.current = false; setMenu(null); setCreating(false); setError(''); setName(l.name); setRenaming(l.id); };
  const startCreate = () => { cancelled.current = false; setMenu(null); setRenaming(null); setError(''); setName(''); setCreating(true); };

  const inFlight = useRef(false); // Enter y el blur posterior no deben crear (o renombrar) dos veces
  const commit = async () => {
    if (inFlight.current) return;
    const n = name.trim();
    const list = renaming ? p.lists.find((l) => l.id === renaming) : null;
    if (!n || (list && n === list.name)) { closeAll(); return; }
    inFlight.current = true;
    try {
      if (list) await p.onRename(list.id, n);
      else await p.onCreate(n);
      cancelled.current = true;
      closeAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : list ? tr('No se pudo renombrar la lista.', 'Couldn’t rename the list.') : tr('No se pudo crear la lista.', 'Couldn’t create the list.'));
    } finally {
      inFlight.current = false;
    }
  };

  const field = (label: string, placeholder?: string) => (
    <input class="lt-input" value={name} aria-label={label} placeholder={placeholder} autoFocus maxLength={60}
      size={Math.max(8, name.length + 1)}
      onInput={(e) => { setName(e.currentTarget.value); setError(''); }}
      onBlur={() => { if (!error && !cancelled.current) void commit(); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); void commit(); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelled.current = true; closeAll(); }
      }} />
  );

  return (
    <nav class="list-tabs" aria-label={tr('Listas', 'Lists')} ref={navRef}>
      <div class="lt-row" ref={scrollRef}>
        {p.lists.map((l) => {
          const on = l.id === p.scope;
          if (renaming === l.id) return <span key={l.id} class="lt-tab on lt-editing">{field(tr('Nombre de la lista', 'List name'))}</span>;
          return (
            <button key={l.id} class={`lt-tab ${on ? 'on' : ''} ${p.lists.length === 1 ? 'solo' : ''}`} data-drop={listDrop(l.id)}
              aria-current={on ? 'page' : undefined} aria-haspopup={on ? 'menu' : undefined} aria-expanded={on ? menu !== null : undefined}
              title={on ? tr('Opciones de la lista', 'List options') : undefined}
              onClick={(e) => tap(l.id, e)} onDblClick={() => startRename(l)}>
              <span class="lt-name">{l.name}</span>
              {isShared(l) && <PeopleIcon title={tr('Compartida', 'Shared')} />}
              {on && <span class="lt-caret" aria-hidden="true">▾</span>}
            </button>
          );
        })}
        {p.lists.length > 1 && (
          <button class={`lt-tab ${p.scope === 'all' ? 'on' : ''}`} aria-current={p.scope === 'all' ? 'page' : undefined}
            onClick={(e) => tap('all', e)}>
            <span class="lt-name">{tr('Todas', 'All')}</span>
          </button>
        )}
        {creating
          ? <span class="lt-tab lt-editing">{field(tr('Nombre de la lista nueva', 'New list name'), tr('Nueva lista', 'New list'))}</span>
          : <button class="lt-tab lt-add" aria-label={tr('Nueva lista', 'New list')} title={tr('Nueva lista', 'New list')} onClick={startCreate}>+</button>}
      </div>
      {error && <p class="lt-error" role="alert">{error}</p>}
      {menu !== null && active && (
        <div class="lt-menu" role="menu" aria-label={active.name} style={{ left: `${menu}px` }}>
          <button role="menuitem" onClick={() => startRename(active)}>{tr('Renombrar', 'Rename')}</button>
          {p.sharing && active.id !== MAIN_LIST && (
            <button role="menuitem" onClick={() => { setMenu(null); p.onShare(active.id); }}>{tr('Compartir', 'Share')}</button>
          )}
          {active.id !== MAIN_LIST && !active.shared && (
            <button role="menuitem" class="danger" onClick={() => { setMenu(null); p.onDelete(active.id); }}>{tr('Borrar lista', 'Delete list')}</button>
          )}
        </div>
      )}
    </nav>
  );
}
