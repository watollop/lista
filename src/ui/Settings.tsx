import { useEffect, useState } from 'preact/hooks';
import type { Backup, Entity, EntityKind, Repo, Sync, SyncState } from '../types';
import { DEFAULT_SUBTASK_COLOR, getLook, getSubtaskColor, getTheme, setLook, setSubtaskColor, setTheme, type Look, type Theme } from './theme';
import { SEARCH_FROM, byUse } from './byUse';
import { fold } from '../lib/text';
import { EntityEditor } from './EntityEditor';

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
}

export function Settings({ repo, sync, state, onClose, toast, onIntro, topics, people, pending, onRename, onDelete }: Props) {
  const [editing, setEditing] = useState<{ kind: EntityKind; key: string } | null>(null);
  const editEnt = editing && (editing.kind === 'topic' ? topics : people).find((e) => e.key === editing.key);
  return (
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Ajustes"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div class="sheet-inner">
        <div class="bar">
          <span class="label">Ajustes</span>
          <button class="link on" onClick={onClose}>Cerrar</button>
        </div>
        <Account sync={sync} state={state} />
        <Appearance toast={toast} />
        <EntitiesSection topics={topics} people={people} pending={pending} onEdit={(kind, key) => setEditing({ kind, key })} />
        {editing && editEnt && (
          <EntityEditor kind={editing.kind} entity={editEnt} entities={editing.kind === 'topic' ? topics : people}
            pending={pending} variant="sheet" onCancel={() => setEditing(null)}
            onSave={(name) => { setEditing(null); onRename(editing.kind, editing.key, name); }}
            onDelete={() => { setEditing(null); onDelete(editing.kind, editing.key); }} />
        )}
        <section>
          <span class="label">Ayuda</span>
          <p>Repasa cómo funciona y todo lo que puedes escribir: fechas, prioridades, repeticiones y atajos.</p>
          <div class="row-btns"><button class="btn" onClick={onIntro}>Cómo funciona</button></div>
          <CaptureFold toast={toast} />
        </section>
        <BackupSection repo={repo} toast={toast} />
        <DangerSection repo={repo} sync={sync} state={state} toast={toast} />
        <footer class="credit">
          <span>Código Do Norte <span class="heart" aria-label="con cariño">♥</span> Coruña</span>
          <a href="https://github.com/watollop/lista" target="_blank" rel="noopener noreferrer" aria-label="Código en GitHub" title="Código en GitHub">
            <svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
          </a>
        </footer>
      </div>
    </div>
  );
}

function Account({ sync, state }: { sync: Sync; state: SyncState }) {
  const [google, setGoogle] = useState<boolean | null>(null); // null: comprobando
  useEffect(() => { if (state.status === 'signedOut') sync.googleEnabled().then(setGoogle); }, [state.status]);

  if (state.status === 'disabled') {
    return (
      <section>
        <span class="label">Sincronización</span>
        <p>Desactivada: los datos se guardan solo en este dispositivo. Configura Supabase (ver README) para sincronizar Mac e iPhone.</p>
      </section>
    );
  }

  if (state.status === 'signedOut') {
    return (
      <section>
        <span class="label">Sincronización</span>
        <p>Entra para sincronizar este dispositivo. Solo hace falta una vez.</p>
        {google && (
          <div class="row-btns">
            <button class="btn solid" onClick={() => sync.signInWithGoogle()}>Continuar con Google</button>
          </div>
        )}
        {google === false && <p>El acceso con Google no está activado en Supabase (ver README).</p>}
        {state.message && <p class="err">{state.message}</p>}
      </section>
    );
  }

  const detail =
    state.status === 'syncing' ? 'Sincronizando…'
    : state.status === 'offline' ? 'Sin conexión. Los cambios se subirán al volver.'
    : state.status === 'error' ? `Error: ${state.message}`
    : state.lastSync ? `Última sincronización: ${new Date(state.lastSync).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}`
    : 'Pendiente de sincronizar';
  return (
    <section>
      <span class="label">Sincronización</span>
      <p>{state.email}</p>
      <p class={state.status === 'error' ? 'err' : ''}>{detail}</p>
      <div class="row-btns">
        <button class="btn" disabled={state.status === 'syncing'} onClick={() => sync.syncNow()}>Sincronizar ahora</button>
        <button class="btn" onClick={() => sync.signOut()}>Cerrar sesión</button>
      </div>
    </section>
  );
}

const THEMES: Array<[Theme, string]> = [['system', 'Sistema'], ['light', 'Claro'], ['dark', 'Oscuro']];
const LOOKS: Array<[Look, string]> = [['classic', 'Clásico'], ['industrial', 'Industrial']];

function Appearance({ toast }: { toast: (msg: string) => void }) {
  const [theme, set] = useState(getTheme);
  const [look, setL] = useState(getLook);
  const [color, setColor] = useState(getSubtaskColor);
  const changeColor = (next: string) => {
    try { setSubtaskColor(next); setColor(next); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo guardar el color.'); }
  };
  return (
    <section>
      <span class="label">Apariencia</span>
      <div class="row-btns" role="radiogroup" aria-label="Tema">
        {THEMES.map(([t, l]) => (
          <button key={t} role="radio" aria-checked={theme === t} class={`btn ${theme === t ? 'solid' : ''}`}
            onClick={() => { setTheme(t); set(t); }}>{l}</button>
        ))}
      </div>
      <div class="row-btns look-btns" role="radiogroup" aria-label="Estilo">
        {LOOKS.map(([k, l]) => (
          <button key={k} role="radio" aria-checked={look === k} class={`btn ${look === k ? 'solid' : ''}`}
            onClick={() => { setLook(k); setL(k); }}>{l}</button>
        ))}
      </div>
      <p class="look-hint">Industrial: gris cálido, tipografía de puntos y acento naranja.</p>
      <p class="look-hint" id="subtask-color-label">Color de la línea de subtareas</p>
      <div class="row-btns look-btns" role="group" aria-labelledby="subtask-color-label">
        <button class={`btn ${color === DEFAULT_SUBTASK_COLOR ? 'solid' : ''}`}
          aria-pressed={color === DEFAULT_SUBTASK_COLOR} onClick={() => changeColor(DEFAULT_SUBTASK_COLOR)}>Rosa</button>
        <label class={`btn color-picker ${color !== DEFAULT_SUBTASK_COLOR ? 'solid' : ''}`}>
          <span class="color-swatch" style={{ backgroundColor: color }} aria-hidden="true" />
          Personalizado
          <input id="subtask-color" type="color" aria-label="Color personalizado de subtareas"
            value={color} onInput={(e) => changeColor(e.currentTarget.value)} />
        </label>
      </div>
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
              <input class="ent-search" type="search" placeholder={`Buscar ${title.toLowerCase()}`} value={q}
                aria-label={`Buscar ${title.toLowerCase()}`} onInput={(e) => setQ(e.currentTarget.value)} />
            )}
            <ul class="ent-list">
              {shown.map((e) => {
                const n = pending.get(sym + e.key) ?? 0;
                return (
                  <li key={e.key}>
                    <button class={`ent-row ${n ? '' : 'zero'}`} onClick={() => onEdit(kind, e.key)}>
                      <span class="ent-name">{sym}{e.name}</span>
                      <span class="ent-count">{n ? `${n} ${n === 1 ? 'tarea' : 'tareas'}` : 'sin tareas'}</span>
                    </button>
                  </li>
                );
              })}
              {!shown.length && <li class="ent-empty">Sin resultados</li>}
            </ul>
          </>
        )}
      </div>
    );
  };
  return (
    <section>
      <span class="label">Temas y personas</span>
      {topics.length || people.length
        ? <>{group('Temas', 'topic', topics)}{group('Personas', 'person', people)}</>
        : <p>Aún no hay temas ni personas. Aparecen al escribir #tema o @persona en una tarea.</p>}
    </section>
  );
}

/** Eliminar datos: en local borra este dispositivo; con sesión, también los datos de la nube y la cuenta. */
function DangerSection({ repo, sync, state, toast }: { repo: Repo; sync: Sync; state: SyncState; toast: (m: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const signedIn = state.status !== 'disabled' && state.status !== 'signedOut';
  const run = async () => {
    setBusy(true);
    try {
      const { remote } = await sync.deleteAccount();
      await repo.wipe();
      try {
        for (const k of Object.keys(localStorage)) if (k.startsWith('lista.')) localStorage.removeItem(k);
      } catch { /* modo privado */ }
      if (remote === 'data') alert('Se han borrado tus datos de la nube, pero no la cuenta: falta la función delete_account en Supabase (ver supabase/schema.sql).');
      location.reload();
    } catch (e) {
      setBusy(false);
      toast(`No se pudo eliminar: ${(e as Error).message}`);
    }
  };
  return (
    <section>
      <span class="label">Eliminar datos</span>
      <p>
        {signedIn
          ? 'Borra todas tus tareas, temas y personas de este dispositivo y de la nube, y elimina tu cuenta. Los otros dispositivos dejarán de sincronizar.'
          : 'Borra todas tus tareas, temas y personas de este dispositivo.'}
      </p>
      {!confirming ? (
        <div class="row-btns"><button class="btn danger-btn" onClick={() => setConfirming(true)}>Eliminar datos</button></div>
      ) : (
        <>
          <p class="err">No se puede deshacer. Si quieres conservarlos, exporta antes una copia.</p>
          <div class="row-btns">
            <button class="btn danger-btn solid" disabled={busy} onClick={run}>
              {busy ? 'Eliminando…' : signedIn ? 'Sí, eliminar datos y cuenta' : 'Sí, eliminar todo'}
            </button>
            <button class="btn" disabled={busy} onClick={() => setConfirming(false)}>Cancelar</button>
          </div>
        </>
      )}
    </section>
  );
}

/** Apuntar sin abrir la app (Siri, «Compartir» en Android o un enlace): plegado dentro de Ayuda. */
function CaptureFold({ toast }: { toast: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const link = `${location.origin}${location.pathname}?nueva=`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); toast('Enlace copiado'); } catch { toast(link); }
  };
  return (
    <div class="help-fold">
      <button class={`ent-head ${open ? 'open' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>Apuntar sin abrir la app</span>
        <span class="ent-head-count"><span class="caret" aria-hidden="true" /></span>
      </button>
      {open && <div class="fold-body">
      <ul class="howto">
        <li><b>iPhone, con Siri.</b> En la app Atajos crea un atajo con «Dictar texto» y «Abrir URL» con el enlace de abajo seguido del texto dictado. Llámalo «Apuntar en Lista» y di «Oye Siri, apuntar en Lista». Se abre en el navegador: inicia sesión también allí para que llegue a la app.</li>
        <li><b>Android.</b> Desde cualquier app, «Compartir» → Lista (con la app instalada).</li>
        <li><b>Ordenador.</b> Cualquier enlace con el texto detrás apunta la tarea al abrirlo.</li>
      </ul>
      <code class="howto-link">{link}<span>Llamar a Ana mañana</span></code>
      <div class="row-btns"><button class="btn" onClick={copy}>Copiar enlace</button></div>
      </div>}
    </div>
  );
}

function BackupSection({ repo, toast }: { repo: Repo; toast: (m: string) => void }) {
  const exportJSON = async () => {
    const b = await repo.exportBackup();
    const blob = new Blob([JSON.stringify(b)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `lista-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const importJSON = (mode: 'merge' | 'replace') => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (mode === 'replace' && !confirm('Se sustituirán todas las tareas actuales por las de la copia. ¿Continuar?')) return;
      try {
        await repo.importBackup(JSON.parse(await file.text()) as Backup, mode);
        toast('Copia importada');
      } catch (e) {
        toast((e as Error).message || 'No se pudo importar');
      }
    };
    input.click();
  };
  return (
    <section>
      <span class="label">Copia de seguridad</span>
      <p>Exporta todas tus tareas a un archivo JSON. Al importar, «Combinar» conserva lo más reciente de cada tarea.</p>
      <div class="row-btns">
        <button class="btn" onClick={exportJSON}>Exportar</button>
        <button class="btn" onClick={() => importJSON('merge')}>Importar · combinar</button>
        <button class="btn" onClick={() => importJSON('replace')}>Importar · sustituir</button>
      </div>
    </section>
  );
}
