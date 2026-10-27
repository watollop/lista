import { useEffect, useState } from 'preact/hooks';
import type { Backup, Entity, EntityKind, Repo, Sync, SyncState } from '../types';
import { getTheme, setTheme, type Theme } from './theme';
import { normalizeKey, parseLine } from '../parser';
import { todayISO } from '../lib/date';
import { TaskChips } from './Chips';
import { TitleText } from './TaskList';
import { EntityEditor } from './EntityEditor';

const SYNTAX: Array<[string, string, string[]]> = [
  ['Tema', 'se crea al escribirlo', ['#trabajo', '#casa']],
  ['Persona', '', ['@ana', '@marta']],
  ['Fecha', '', ['hoy', 'mañana', 'pasado', 'el viernes', '15 nov', 'en 3 días']],
  ['Periodo', 'vence el viernes o al final del periodo', ['esta semana', 'este mes', 'este Q', 'este año']],
  ['Fecha exacta', '', ['vence:15/11', 'vence:2026-11-15']],
  ['Prioridad', '⇈ ↑ ↓ · también !1 !2 !3', ['!alta', '!media', '!baja']],
  ['Repetir', 'al completarla se crea la siguiente', ['cada día', 'cada lunes', 'cada mes']],
];

const KEYS: Array<[string[], string]> = [
  [['⌘K', '/', 'n'], 'escribir tarea'],
  [['j', 'k'], 'moverse por la lista'],
  [['x'], 'completar'],
  [['e'], 'editar'],
  [['⌫'], 'borrar'],
  [['h', 's', 'v'], 'hoy · semana · vencidas'],
  [['1–9'], 'filtro guardado'],
  [['f'], 'buscar'],
  [['esc'], 'limpiar filtro'],
];

const EXAMPLE = 'Llamar a @ana mañana #trabajo !alta';

/** Una línea de ejemplo y cómo queda la tarea, con los mismos componentes que la lista. */
function SyntaxExample() {
  const p = parseLine(EXAMPLE);
  const names = new Map<string, Entity>([
    ...p.topics.map((n): [string, Entity] => ['#' + normalizeKey(n), { key: normalizeKey(n), name: n } as Entity]),
    ...p.people.map((n): [string, Entity] => ['@' + normalizeKey(n), { key: normalizeKey(n), name: n } as Entity]),
  ]);
  return (
    <div class="syn-example">
      <div class="syn-input">{EXAMPLE}</div>
      <div class="syn-result">
        <span class="syn-title"><TitleText text={p.title} onChip={() => {}} /></span>
        <span class="syn-chips">
          <TaskChips due={p.due} period={p.period} priority={p.priority} recurrence={p.recurrence}
            topics={p.topics.map(normalizeKey)} people={p.people.map(normalizeKey)} names={names}
            today={todayISO()} title={p.title} />
        </span>
      </div>
    </div>
  );
}

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
        <h2>Lista</h2>
        <Account sync={sync} state={state} />
        <Appearance />
        <EntitiesSection topics={topics} people={people} pending={pending} onEdit={(kind, key) => setEditing({ kind, key })} />
        {editing && editEnt && (
          <EntityEditor kind={editing.kind} entity={editEnt} entities={editing.kind === 'topic' ? topics : people}
            pending={pending} variant="sheet" onCancel={() => setEditing(null)}
            onSave={(name) => { setEditing(null); onRename(editing.kind, editing.key, name); }}
            onDelete={() => { setEditing(null); onDelete(editing.kind, editing.key); }} />
        )}
        <BackupSection repo={repo} toast={toast} />
        <section>
          <span class="label">Ayuda</span>
          <div class="row-btns"><button class="btn" onClick={onIntro}>Cómo funciona</button></div>
        </section>
        <section>
          <span class="label">Sintaxis</span>
          <SyntaxExample />
          <dl class="syn">
            {SYNTAX.map(([name, hint, examples]) => (
              <div key={name}>
                <dt>{name}{hint && <small>{hint}</small>}</dt>
                <dd>{examples.map((e) => <code key={e} class="chip">{e}</code>)}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section class="kbd-only">
          <span class="label">Teclado</span>
          <dl class="keys">
            {KEYS.map(([keys, what]) => (
              <div key={what}>
                <dt>{keys.map((k) => <kbd key={k}>{k}</kbd>)}</dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </section>
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

function Appearance() {
  const [theme, set] = useState(getTheme);
  return (
    <section>
      <span class="label">Apariencia</span>
      <div class="row-btns" role="radiogroup" aria-label="Tema">
        {THEMES.map(([t, l]) => (
          <button key={t} role="radio" aria-checked={theme === t} class={`btn ${theme === t ? 'solid' : ''}`}
            onClick={() => { setTheme(t); set(t); }}>{l}</button>
        ))}
      </div>
    </section>
  );
}

/** Temas y personas con sus pendientes; tocar una fila abre el editor. */
function EntitiesSection({ topics, people, pending, onEdit }: {
  topics: Entity[]; people: Entity[]; pending: Map<string, number>;
  onEdit: (kind: EntityKind, key: string) => void;
}) {
  const group = (title: string, kind: EntityKind, list: Entity[]) => {
    if (!list.length) return null;
    const sym = kind === 'topic' ? '#' : '@';
    return (
      <div class="ent-group">
        <h3 class="label">{title}</h3>
        <ul class="ent-list">
          {list.map((e) => {
            const n = pending.get(sym + e.key) ?? 0;
            return (
              <li key={e.key}>
                <button class={`ent-row ${n ? '' : 'zero'}`} onClick={() => onEdit(kind, e.key)}>
                  <span class="ent-name">{sym}{e.name}</span>
                  <span class="ent-count">{n ? `· ${n} ${n === 1 ? 'tarea' : 'tareas'}` : 'sin tareas'}</span>
                </button>
              </li>
            );
          })}
        </ul>
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
