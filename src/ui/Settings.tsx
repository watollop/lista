import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import type { Entity, EntityKind, Repo, Sync, SyncState } from '../types';
import { saveAppearance } from './appearanceSync';
import { NewsSheet } from './WhatsNew';
import { EncryptionSection } from './Encryption';
import { APPEARANCE_CHANGE_EVENT, DEFAULT_SUBTASK_COLOR, getLook, getSubtaskColor, getTheme, setLook, setSubtaskColor, setTheme, type Look, type Theme } from './theme';
import { SEARCH_FROM, byUse } from './byUse';
import { fold } from '../lib/text';
import { BUILD, buildLabel } from '../lib/build';
import { EntityEditor } from './EntityEditor';
import { isEn, langPref, tr, type LangPref } from '../i18n';
import { chooseLang } from './langSync';

interface Props {
  repo: Repo;
  sync: Sync;
  state: SyncState;
  onClose: () => void;
  toast: (msg: string) => void;
  onIntro: () => void;
  topics: Entity[]; // todos, con o sin pendientes
  people: Entity[];
  pending: Map<string, number>; // '#clave' | '@clave' -> pendientes
  onRename: (kind: EntityKind, key: string, name: string) => void;
  onDelete: (kind: EntityKind, key: string) => void;
  onShortcuts?: () => void; // abre la hoja de atajos de teclado (solo se ve con teclado y ratón)
}

export function Settings({ repo, sync, state, onClose, toast, onIntro, topics, people, pending, onRename, onDelete, onShortcuts }: Props) {
  const [editing, setEditing] = useState<{ kind: EntityKind; key: string } | null>(null);
  const [news, setNews] = useState(false);
  const sharing = state.status !== 'disabled'; // sin sincronización no hay listas compartidas
  const editEnt = editing && (editing.kind === 'topic' ? topics : people).find((e) => e.key === editing.key);
  return (<>
    <div class="sheet" role="dialog" aria-modal="true" aria-label={tr('Ajustes', 'Settings')}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div class="sheet-inner">
        <div class="bar">
          <span class="label">{tr('Ajustes', 'Settings')}</span>
          <button class="link on" onClick={onClose}>{tr('Cerrar', 'Close')}</button>
        </div>
        <section class="group" aria-labelledby="ajustes-cuenta">
          <h2 class="group-title" id="ajustes-cuenta">{tr('Cuenta', 'Account')}</h2>
          <Account sync={sync} state={state} />
          <EncryptionSection sync={sync} state={state} toast={toast} />
        </section>
        <section class="group" aria-labelledby="ajustes-apariencia">
          <h2 class="group-title" id="ajustes-apariencia">{tr('Apariencia', 'Appearance')}</h2>
          <Appearance repo={repo} toast={toast} />
          <Language repo={repo} />
        </section>
        <section class="group" aria-labelledby="ajustes-orden">
          <h2 class="group-title" id="ajustes-orden">{tr('Organización', 'Organization')}</h2>
          <EntitiesSection topics={topics} people={people} pending={pending} onEdit={(kind, key) => setEditing({ kind, key })} />
          {editing && editEnt && (
            <EntityEditor kind={editing.kind} entity={editEnt} entities={editing.kind === 'topic' ? topics : people}
              pending={pending} variant="sheet" onCancel={() => setEditing(null)}
              onSave={(name) => { setEditing(null); onRename(editing.kind, editing.key, name); }}
              onDelete={() => { setEditing(null); onDelete(editing.kind, editing.key); }} />
          )}
        </section>
        <section class="group" aria-labelledby="ajustes-datos">
          <h2 class="group-title" id="ajustes-datos">{tr('Tus datos', 'Your data')}</h2>
          <DataSection repo={repo} sync={sync} state={state} toast={toast} />
        </section>
        <section class="group" aria-labelledby="ajustes-ayuda">
          <h2 class="group-title" id="ajustes-ayuda">{tr('Ayuda', 'Help')}</h2>
          <section>
            <p>{tr('Repasa cómo funciona y todo lo que puedes escribir.', 'See how it works and everything you can type.')}</p>
            <div class="row-btns">
              <button class="btn" onClick={onIntro}>{tr('Cómo funciona', 'How it works')}</button>
              <button class="btn" onClick={() => setNews(true)}>{tr('Novedades', 'What’s new')}</button>
              {onShortcuts && <button class="btn kbd-only" onClick={onShortcuts}>{tr('Atajos de teclado', 'Keyboard shortcuts')}</button>}
            </div>
            <TipsFold sharing={sharing} />
            <CaptureFold />
          </section>
        </section>
      </div>
      {/* Firma: siempre abajo, fija al pie de Ajustes. No se traduce. */}
      <footer class="credit">
        <div class="credit-text">
          <span>Código Do Norte <span class="heart" aria-label="con cariño">♥</span> Coruña</span>
          {BUILD.time && <span class="build" title={tr('Versión y momento de compilación', 'Version and build time')}>{buildLabel()}</span>}
        </div>
        <a href="https://github.com/watollop/lista" target="_blank" rel="noopener noreferrer" aria-label="Código en GitHub" title="Código en GitHub">
          <svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
          </svg>
        </a>
      </footer>
    </div>
    {/* Fuera de .sheet: así Esc en las novedades cierra solo la hoja de novedades, no Ajustes. */}
    {news && <NewsSheet onClose={() => setNews(false)} />}
  </>);
}

function Account({ sync, state }: { sync: Sync; state: SyncState }) {
  const [google, setGoogle] = useState<boolean | null>(null); // null: comprobando
  useEffect(() => { if (state.status === 'signedOut') sync.googleEnabled().then(setGoogle); }, [state.status]);

  if (state.status === 'disabled') {
    return (
      <section>
        <span class="label">{tr('Sincronización', 'Sync')}</span>
        <p>{tr('Desactivada: los datos se guardan solo en este dispositivo. Configura Supabase (ver README) para sincronizar Mac e iPhone.', 'Off: your data is stored only on this device. Set up Supabase (see the README) to sync your Mac and iPhone.')}</p>
      </section>
    );
  }

  if (state.status === 'signedOut') {
    return (
      <section>
        <span class="label">{tr('Sincronización', 'Sync')}</span>
        <p>{tr('Entra para sincronizar este dispositivo. Solo hace falta una vez.', 'Sign in to sync this device. You only need to do it once.')}</p>
        {google && (
          <div class="row-btns">
            <button class="btn solid" onClick={() => sync.signInWithGoogle()}>{tr('Continuar con Google', 'Continue with Google')}</button>
          </div>
        )}
        {google === false && <p>{tr('El acceso con Google no está activado en Supabase (ver README).', 'Google sign-in isn’t enabled in Supabase (see the README).')}</p>}
        {state.message && <p class="err">{state.message}</p>}
      </section>
    );
  }

  const detail =
    state.status === 'syncing' ? tr('Sincronizando…', 'Syncing…')
    : state.status === 'offline' ? tr('Sin conexión. Los cambios se subirán al volver.', 'Offline. Changes will upload when you’re back online.')
    : state.status === 'error' ? `Error: ${state.message}`
    : state.status === 'locked' ? tr('Bloqueado: enlaza este dispositivo para ver tus datos cifrados.', 'Locked: link this device to see your encrypted data.')
    : state.lastSync ? tr('Última sincronización: ', 'Last synced: ') + new Date(state.lastSync).toLocaleString(isEn() ? 'en' : 'es-ES', { dateStyle: 'short', timeStyle: 'short' })
    : tr('Pendiente de sincronizar', 'Not synced yet');
  return (
    <section>
      <span class="label">{tr('Sincronización', 'Sync')}</span>
      <p>{state.email}</p>
      <p class={state.status === 'error' ? 'err' : ''}>{detail}</p>
      <div class="row-btns">
        <button class="btn" disabled={state.status === 'syncing'} onClick={() => sync.syncNow()}>{tr('Sincronizar ahora', 'Sync now')}</button>
        <button class="btn" onClick={() => sync.signOut()}>{tr('Cerrar sesión', 'Sign out')}</button>
      </div>
    </section>
  );
}

const THEMES = (): Array<[Theme, string]> => [['system', tr('Sistema', 'System')], ['light', tr('Claro', 'Light')], ['dark', tr('Oscuro', 'Dark')]];
const LOOKS = (): Array<[Look, string]> => [['classic', tr('Clásico', 'Classic')], ['industrial', 'Industrial']];
const SUBTASK_COLORS = (): Array<[string, string]> => [
  [DEFAULT_SUBTASK_COLOR, tr('Rosa', 'Pink')], ['#3689cc', tr('Azul', 'Blue')], ['#58a676', tr('Verde', 'Green')], ['#e68b45', tr('Naranja', 'Orange')],
];

function Appearance({ repo, toast }: { repo: Repo; toast: (msg: string) => void }) {
  const [theme, set] = useState(getTheme);
  const [look, setL] = useState(getLook);
  const [color, setColor] = useState(getSubtaskColor);
  useLayoutEffect(() => {
    const update = () => { setColor(getSubtaskColor()); set(getTheme()); setL(getLook()); };
    window.addEventListener(APPEARANCE_CHANGE_EVENT, update);
    update();
    return () => window.removeEventListener(APPEARANCE_CHANGE_EVENT, update);
  }, []);
  const customColor = !SUBTASK_COLORS().some(([value]) => value === color.toLowerCase());
  const persist = () => {
    void saveAppearance(repo).catch((e) => toast(e instanceof Error ? e.message : tr('No se pudo guardar la apariencia.', 'Couldn’t save the appearance.')));
  };
  const changeColor = (next: string) => {
    try { setSubtaskColor(next); persist(); }
    catch (e) { toast(e instanceof Error ? e.message : tr('No se pudo guardar el color.', 'Couldn’t save the color.')); }
  };
  return (
    <section>
      <div class="row-btns" role="radiogroup" aria-label={tr('Tema', 'Theme')}>
        {THEMES().map(([t, l]) => (
          <button key={t} role="radio" aria-checked={theme === t} class={`btn ${theme === t ? 'solid' : ''}`}
            onClick={() => { setTheme(t); persist(); }}>{l}</button>
        ))}
      </div>
      <div class="row-btns look-btns" role="radiogroup" aria-label={tr('Estilo', 'Style')}>
        {LOOKS().map(([k, l]) => (
          <button key={k} role="radio" aria-checked={look === k} class={`btn ${look === k ? 'solid' : ''}`}
            onClick={() => { setLook(k); persist(); }}>{l}</button>
        ))}
      </div>
      <p class="look-hint">{tr('Industrial: gris cálido, tipografía de puntos y acento naranja.', 'Industrial: warm grey, dot-matrix type and an orange accent.')}</p>
      {look === 'classic' && <>
        <p class="look-hint" id="subtask-color-label">{tr('Color secundario', 'Secondary color')}</p>
        <div class="row-btns look-btns subtask-colors" role="group" aria-labelledby="subtask-color-label">
          {SUBTASK_COLORS().map(([value, name]) => (
            <button key={value} class="color-option" aria-label={name} title={name}
              aria-pressed={color.toLowerCase() === value} onClick={() => changeColor(value)}>
              <span class="color-swatch" style={{ backgroundColor: value }} aria-hidden="true" />
            </button>
          ))}
          <label class={`color-option color-picker ${customColor ? 'selected' : ''}`} title={tr('Color secundario personalizado', 'Custom secondary color')}>
            <span class="color-swatch multicolor" aria-hidden="true" />
            <input id="subtask-color" type="color" aria-label={tr('Color secundario personalizado', 'Custom secondary color')}
              value={color} onInput={(e) => changeColor(e.currentTarget.value)}
              onChange={(e) => changeColor(e.currentTarget.value)} />
          </label>
        </div>
      </>}
    </section>
  );
}

/** Temas y personas: dos filas plegadas; se abre una cada vez. Dentro, los más usados arriba y búsqueda si hay muchos. */
function EntitiesSection({ topics, people, pending, onEdit }: {
  topics: Entity[]; people: Entity[]; pending: Map<string, number>;
  onEdit: (kind: EntityKind, key: string) => void;
}) {
  const [open, setOpen] = useState<EntityKind | null>(null);
  const [q, setQ] = useState('');
  const toggle = (kind: EntityKind) => { setOpen(open === kind ? null : kind); setQ(''); };

  const group = (title: string, kind: EntityKind, list: Entity[]) => {
    if (!list.length) return null;
    const sym = kind === 'topic' ? '#' : '@';
    const isOpen = open === kind;
    const shown = isOpen ? byUse(list, sym, pending).filter((e) => !q || fold(e.name).includes(fold(q))) : [];
    return (
      <div class="ent-group">
        <button class={`ent-head ${isOpen ? 'open' : ''}`} aria-expanded={isOpen} onClick={() => toggle(kind)}>
          <span>{title}</span>
          <span class="ent-head-count">{list.length}<span class="caret" aria-hidden="true" /></span>
        </button>
        {isOpen && (
          <>
            {list.length > SEARCH_FROM && (
              <input class="ent-search" type="search" placeholder={tr(`Buscar ${title.toLowerCase()}`, `Search ${title.toLowerCase()}`)} value={q}
                aria-label={tr(`Buscar ${title.toLowerCase()}`, `Search ${title.toLowerCase()}`)} onInput={(e) => setQ(e.currentTarget.value)} />
            )}
            <ul class="ent-list">
              {shown.map((e) => {
                const n = pending.get(sym + e.key) ?? 0;
                return (
                  <li key={e.key}>
                    <button class={`ent-row ${n ? '' : 'zero'}`} onClick={() => onEdit(kind, e.key)}>
                      <span class="ent-name">{sym}{e.name}</span>
                      <span class="ent-count">{n ? (isEn() ? `${n} ${n === 1 ? 'task' : 'tasks'}` : `${n} ${n === 1 ? 'tarea' : 'tareas'}`) : tr('sin tareas', 'no tasks')}</span>
                    </button>
                  </li>
                );
              })}
              {!shown.length && <li class="ent-empty">{tr('Sin resultados', 'No results')}</li>}
            </ul>
          </>
        )}
      </div>
    );
  };
  return (
    <section>
      <span class="label">{tr('Temas y personas', 'Topics and people')}</span>
      {topics.length || people.length
        ? <>{group(tr('Temas', 'Topics'), 'topic', topics)}{group(tr('Personas', 'People'), 'person', people)}</>
        : <p>{tr('Aún no hay temas ni personas. Aparecen al escribir #tema o @persona en una tarea.', 'No topics or people yet. They appear when you write #topic or @person in a task.')}</p>}
    </section>
  );
}

/** Tus datos: copia (JSON) y borrado en un solo bloque. La explicación larga del borrado sale solo al confirmarlo.
 *  Sin sesión borra este dispositivo; con sesión, también los datos de la nube y la cuenta. */
function DataSection({ repo, sync, state, toast }: { repo: Repo; sync: Sync; state: SyncState; toast: (m: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const signedIn = state.status !== 'disabled' && state.status !== 'signedOut';
  const exportJSON = async () => {
    const b = await repo.exportBackup();
    const blob = new Blob([JSON.stringify(b)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `lista-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const run = async () => {
    setBusy(true);
    try {
      const { remote } = await sync.deleteAccount();
      await repo.wipe();
      try {
        for (const k of Object.keys(localStorage)) if (k.startsWith('lista.')) localStorage.removeItem(k);
      } catch { /* modo privado */ }
      if (remote === 'data') alert(tr('Se han borrado tus datos de la nube, pero no la cuenta: falta la función delete_account en Supabase (ver supabase/schema.sql).', 'Your cloud data was deleted, but not the account: the delete_account function is missing in Supabase (see supabase/schema.sql).'));
      location.reload();
    } catch (e) {
      setBusy(false);
      toast(tr('No se pudo eliminar: ', 'Couldn’t delete: ') + (e as Error).message);
    }
  };
  return (
    <section>
      <p>{tr('Descarga una copia de todas tus tareas en un archivo JSON, o bórralo todo.', 'Download a copy of all your tasks as a JSON file, or delete everything.')}</p>
      {!confirming ? (
        <div class="row-btns">
          <button class="btn" onClick={exportJSON}>{tr('Exportar copia', 'Export a copy')}</button>
          <button class="btn danger-btn" onClick={() => setConfirming(true)}>{tr('Eliminar datos', 'Delete data')}</button>
        </div>
      ) : (
        <>
          <p class="err">{signedIn
            ? tr('Se borrarán tus tareas, temas y personas de este dispositivo y de la nube, y tu cuenta. Tus otros dispositivos dejarán de sincronizar. Las listas compartidas que creaste pasan a la persona que lleve más tiempo en cada una. No se puede deshacer.',
              'Your tasks, topics and people will be deleted from this device and the cloud, along with your account. Your other devices will stop syncing. Shared lists you created pass to the longest-standing member of each. This can’t be undone.')
            : tr('Se borrarán tus tareas, temas y personas de este dispositivo. No se puede deshacer.',
              'Your tasks, topics and people will be deleted from this device. This can’t be undone.')}</p>
          <div class="row-btns">
            <button class="btn danger-btn solid" disabled={busy} onClick={run}>
              {busy ? tr('Eliminando…', 'Deleting…') : signedIn ? tr('Sí, eliminar datos y cuenta', 'Yes, delete data and account') : tr('Sí, eliminar todo', 'Yes, delete everything')}
            </button>
            <button class="btn" disabled={busy} onClick={exportJSON}>{tr('Exportar antes', 'Export first')}</button>
            <button class="btn" disabled={busy} onClick={() => setConfirming(false)}>{tr('Cancelar', 'Cancel')}</button>
          </div>
        </>
      )}
    </section>
  );
}

/** Trucos de uso, plegados dentro de Ayuda (lo básico ya lo cuenta «Cómo funciona»). */
function TipsFold({ sharing }: { sharing: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div class="help-fold">
      <button class={`ent-head ${open ? 'open' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{tr('Trucos', 'Tips')}</span>
        <span class="ent-head-count"><span class="caret" aria-hidden="true" /></span>
      </button>
      {open && <div class="fold-body">
        {isEn()
          ? <p><strong>Tomorrow.</strong> Drag a task to the Tomorrow block by its ⠿ handle: in its editor, or with a mouse, left of the box when you hover (with a keyboard, <kbd>m</kbd>).</p>
          : <p><strong>A mañana.</strong> Arrastra la tarea al bloque Mañana por su asa ⠿: en su editor o, con ratón, a la izquierda de la casilla al pasar por encima (con teclado, <kbd>m</kbd>).</p>}
        {isEn()
          ? <p><strong>Another list.</strong> <em>Move to…</em> in its editor, or drag it onto the list’s tab.</p>
          : <p><strong>A otra lista.</strong> <em>Mover a…</em> en su editor, o arrástrala a la pestaña de la lista.</p>}
        {sharing && (isEn()
          ? <p><strong>Share a list.</strong> Tap its tab again and <em>Share</em>. One link per person, valid for 7 days, and everything stays encrypted.</p>
          : <p><strong>Compartir una lista.</strong> Toca otra vez su pestaña y <em>Compartir</em>. Un enlace por persona, vale 7 días y todo va cifrado.</p>)}
      </div>}
    </div>
  );
}

/** Apuntar desde Android con «Compartir» (share_target): plegado dentro de Ayuda. */
function CaptureFold() {
  const [open, setOpen] = useState(false);
  return (
    <div class="help-fold">
      <button class={`ent-head ${open ? 'open' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{tr('Compartir desde Android', 'Share from Android')}</span>
        <span class="ent-head-count"><span class="caret" aria-hidden="true" /></span>
      </button>
      {open && <div class="fold-body">
        <p>{tr('Desde cualquier app, «Compartir» → Lista y el contenido se apunta como tarea. Hace falta tener Lista instalada en el móvil.', 'From any app, “Share” → Lista and the content is saved as a task. Lista needs to be installed on your phone.')}</p>
      </div>}
    </div>
  );
}

/** Idioma de la app. La etiqueta va en los dos idiomas para que la encuentre quien no lea el actual. */
function Language({ repo }: { repo: Repo }) {
  const pref = langPref();
  const options: Array<[LangPref, string]> = [['auto', tr('Automático', 'Automatic')], ['es', 'Español'], ['en', 'English']];
  return (
    <section>
      <span class="label" id="lang-label">Idioma · Language</span>
      <div class="row-btns" role="radiogroup" aria-labelledby="lang-label">
        {options.map(([v, l]) => (
          <button key={v} role="radio" aria-checked={pref === v} class={`btn ${pref === v ? 'solid' : ''}`}
            onClick={() => { if (v !== pref) void chooseLang(repo, v); }}>{l}</button>
        ))}
      </div>
      <p class="look-hint">{tr('Automático usa el idioma del navegador.', 'Automatic follows your browser’s language.')}</p>
    </section>
  );
}
