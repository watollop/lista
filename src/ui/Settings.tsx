import { useEffect, useState } from 'preact/hooks';
import type { Backup, Repo, Sync, SyncState } from '../types';
import { getTheme, setTheme, type Theme } from './theme';

interface Props {
  repo: Repo;
  sync: Sync;
  state: SyncState;
  onClose: () => void;
  toast: (msg: string) => void;
}

export function Settings({ repo, sync, state, onClose, toast }: Props) {
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
        <BackupSection repo={repo} toast={toast} />
        <section>
          <span class="label">Sintaxis</span>
          <div class="syntax">
            <code>#tema</code><span>tema (se crea si no existe)</span>
            <code>@persona</code><span>persona</span>
            <code>mañana · el viernes · 15 nov · en 3 días</code><span>fecha</span>
            <code>vence:2026-11-15</code><span>fecha exacta</span>
            <code>!alta !media !baja · !1 !2 !3</code><span>prioridad ⇈ ↑ ↓</span>
            <code>cada lunes · cada día · cada mes</code><span>recurrente</span>
          </div>
        </section>
        <section>
          <span class="label">Teclado</span>
          <div class="syntax">
            <code>/ · n · ⌘K</code><span>escribir tarea</span>
            <code>j k · ↑ ↓</code><span>moverse por la lista</span>
            <code>x · espacio</code><span>completar</span>
            <code>e · intro</code><span>editar</span>
            <code>⌫</code><span>borrar</span>
            <code>h s v</code><span>hoy · semana · vencidas</span>
            <code>1–9</code><span>filtro guardado</span>
            <code>f</code><span>buscar</span>
            <code>esc</code><span>limpiar filtro</span>
          </div>
        </section>
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
