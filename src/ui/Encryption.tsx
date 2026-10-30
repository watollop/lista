// Cifrado de extremo a extremo en la interfaz (ver docs/plan-cifrado.md): la sección de Ajustes, el panel del
// dispositivo bloqueado (en la lista y en Ajustes) y el diálogo con el que el dispositivo activado confirma un enlace.
import { useState } from 'preact/hooks';
import type { LinkState, Sync, SyncState } from '../types';

type Toast = (msg: string) => void;

/** Acción asíncrona con estado de carga y mensaje de error. run devuelve true si salió bien. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>, fallback: string): Promise<boolean> => {
    setBusy(true);
    setErr(null);
    try { await fn(); return true; }
    catch (e) { setErr(e instanceof Error && e.message ? e.message : fallback); return false; }
    finally { setBusy(false); }
  };
  return { busy, err, run };
}

/**
 * Dispositivo bloqueado (hay cifrado en la cuenta y este dispositivo no tiene la clave): explica qué pasa y lleva
 * el enlace de principio a fin. onRecovery, si se da, ofrece abrir Ajustes para usar la clave de recuperación.
 */
export function LockedPanel({ sync, onRecovery }: { sync: Sync; onRecovery?: () => void }) {
  const { busy, err, run } = useAction();
  const link = sync.link();
  const mine = link?.role === 'new' ? link : null;
  const start = () => run(() => sync.startLink(), 'No se pudo iniciar el enlace.');
  const cancel = <button class="btn" disabled={busy} onClick={() => run(() => sync.cancelLink(), 'No se pudo cancelar.')}>Cancelar</button>;

  let content;
  if (!mine) {
    content = (
      <>
        <span class="enc-title">Este dispositivo está bloqueado</span>
        <p>Tus datos están cifrados y este dispositivo aún no tiene la clave, así que no ve los cambios nuevos. Lo que cambies aquí se guarda y se subirá al enlazarlo.</p>
        <div class="row-btns">
          <button class="btn solid" disabled={busy} onClick={start}>Enlazar este dispositivo</button>
          {onRecovery && <button class="link" onClick={onRecovery}>Usar clave de recuperación</button>}
        </div>
      </>
    );
  } else if (mine.status === 'waiting') {
    content = (
      <>
        <span class="enc-title">Esperando a tu otro dispositivo…</span>
        <p>Abre Lista en el dispositivo donde ya está activado el cifrado. Aparecerá un aviso para confirmar el enlace.</p>
        <p class="enc-hint">La petición caduca en 10 minutos.</p>
        <div class="row-btns">{cancel}</div>
      </>
    );
  } else if (mine.status === 'code') {
    content = (
      <>
        <span class="enc-title">Confirma el código en tu otro dispositivo</span>
        <div class="link-code">{mine.code}</div>
        <p>Si coincide con el que ves allí, pulsa «Enlazar» en ese dispositivo.</p>
        <div class="row-btns">{cancel}</div>
      </>
    );
  } else {
    content = (
      <>
        <span class="enc-title">No se pudo enlazar</span>
        <p class="err">{mine.message}</p>
        <div class="row-btns">
          <button class="btn solid" disabled={busy}
            onClick={() => run(async () => { await sync.cancelLink(); await sync.startLink(); }, 'No se pudo iniciar el enlace.')}>
            Volver a intentarlo
          </button>
          <button class="btn" disabled={busy} onClick={() => run(() => sync.cancelLink(), 'No se pudo cerrar.')}>Cerrar</button>
        </div>
      </>
    );
  }

  return (
    <div class="lock-panel" role="status" aria-live="polite">
      {content}
      {err && <p class="err">{err}</p>}
    </div>
  );
}

/** Dispositivo activado: otro dispositivo pide enlazarse. Diálogo por encima de todo, también de Ajustes. */
export function LinkDialog({ sync, link, toast }: { sync: Sync; link: LinkState; toast: Toast }) {
  const { busy, err, run } = useAction();
  const reject = async () => { if (await run(() => sync.cancelLink(), 'No se pudo rechazar.')) toast('Enlace rechazado'); };
  const rejectBtn = <button class="btn" disabled={busy} onClick={reject}>Rechazar</button>;

  let content;
  if (link.status === 'waiting') {
    content = (
      <>
        <span class="enc-title" id="link-dialog-title">Un dispositivo quiere enlazarse</span>
        <p>Preparando el código de seguridad…</p>
        <div class="row-btns">{rejectBtn}</div>
      </>
    );
  } else if (link.status === 'code') {
    content = (
      <>
        <span class="enc-title" id="link-dialog-title">¿Enlazar un dispositivo nuevo?</span>
        <p>Comprueba que el dispositivo nuevo muestra este mismo código:</p>
        <div class="link-code">{link.code}</div>
        <p class="enc-warn">Confirma solo si eres tú quien lo está enlazando ahora mismo. Si no lo esperabas, recházalo: tendría acceso a todos tus datos.</p>
        <div class="row-btns">
          <button class="btn solid" disabled={busy}
            onClick={async () => { if (await run(() => sync.confirmLink(), 'No se pudo enlazar.')) toast('Dispositivo enlazado'); }}>
            Enlazar
          </button>
          {rejectBtn}
        </div>
      </>
    );
  } else {
    content = (
      <>
        <span class="enc-title" id="link-dialog-title">No se pudo enlazar</span>
        <p class="err">{link.message}</p>
        <div class="row-btns">
          <button class="btn" disabled={busy} onClick={() => run(() => sync.cancelLink(), 'No se pudo cerrar.')}>Cerrar</button>
        </div>
      </>
    );
  }

  return (
    <div class="dialog-backdrop">
      <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="link-dialog-title" aria-live="polite">
        {content}
        {err && <p class="err">{err}</p>}
      </div>
    </div>
  );
}

/** Sección «Cifrado» de Ajustes. Solo con sesión iniciada. */
export function EncryptionSection({ sync, state, toast }: { sync: Sync; state: SyncState; toast: Toast }) {
  const { busy, err, run } = useAction();
  const [confirmKey, setConfirmKey] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [showUnlock, setShowUnlock] = useState(false);
  const [unlockValue, setUnlockValue] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);

  if (state.status === 'disabled' || state.status === 'signedOut') return null;
  const mode = sync.encryption();

  let body;
  if (mode === 'off') {
    body = <p aria-live="polite">Tus datos se cifrarán en la primera sincronización.</p>;
  } else if (mode === 'migrating') {
    body = <p aria-live="polite">Cifrando tus datos… Mantén la app abierta hasta que termine.</p>;
  } else if (mode === 'on') {
    body = (
      <>
        <p aria-live="polite">Tus datos se guardan cifrados: nadie más puede leerlos, ni siquiera el administrador del servidor.</p>
        <p class="enc-hint">Tus otros dispositivos se enlazan con un código la primera vez que los abras. Crea una clave de recuperación por si los pierdes todos.</p>
        {recoveryKey ? (
          <div class="recovery">
            <code class="recovery-key" aria-live="polite">{recoveryKey}</code>
            <div class="row-btns">
              <button class="btn" onClick={() => copyText(recoveryKey, toast)}>Copiar</button>
              <button class="btn" onClick={() => downloadKey(recoveryKey)}>Descargar</button>
              <button class="btn" onClick={() => setRecoveryKey(null)}>Ya la he guardado</button>
            </div>
          </div>
        ) : !confirmKey ? (
          <div class="row-btns"><button class="btn" onClick={() => setConfirmKey(true)}>Crear clave de recuperación</button></div>
        ) : (
          <>
            <p>Sirve para recuperar tus datos si pierdes todos tus dispositivos. Guárdala en un lugar seguro: solo se muestra una vez y crear otra invalida la anterior.</p>
            <div class="row-btns">
              <button class="btn solid" disabled={busy}
                onClick={() => run(async () => { setRecoveryKey(await sync.createRecoveryKey()); setConfirmKey(false); }, 'No se pudo crear la clave.')}>
                {busy ? 'Creando…' : 'Crear'}
              </button>
              <button class="btn" disabled={busy} onClick={() => setConfirmKey(false)}>Cancelar</button>
            </div>
          </>
        )}
      </>
    );
  } else {
    body = (
      <>
        <LockedPanel sync={sync} />
        <div class="enc-small">
          <button class="link" aria-expanded={showUnlock} onClick={() => setShowUnlock(!showUnlock)}>Usar clave de recuperación</button>
        </div>
        {showUnlock && (
          <form class="unlock-form" onSubmit={async (e) => {
            e.preventDefault();
            if (!unlockValue.trim()) return;
            if (await run(() => sync.unlockWithRecovery(unlockValue), 'La clave no es válida.')) setUnlockValue('');
          }}>
            <input type="text" autocomplete="off" spellcheck={false} aria-label="Clave de recuperación"
              placeholder="Clave de recuperación" value={unlockValue}
              onInput={(e) => setUnlockValue(e.currentTarget.value)} />
            <div class="row-btns">
              <button class="btn solid" type="submit" disabled={busy || !unlockValue.trim()}>Desbloquear</button>
            </div>
          </form>
        )}
        <div class="enc-small">
          {!confirmReset ? (
            <button class="link" onClick={() => setConfirmReset(true)}>¿Has perdido todos tus dispositivos y la clave?</button>
          ) : (
            <>
              <p>Se borrarán los datos cifrados del servidor y se volverán a subir los de este dispositivo. Tus otros dispositivos tendrán que enlazarse de nuevo.</p>
              <div class="row-btns">
                <button class="btn danger-btn solid" disabled={busy}
                  onClick={async () => { if (await run(() => sync.resetEncryption(), 'No se pudo restablecer el cifrado.')) setConfirmReset(false); }}>
                  Restablecer cifrado
                </button>
                <button class="btn" disabled={busy} onClick={() => setConfirmReset(false)}>Cancelar</button>
              </div>
            </>
          )}
        </div>
      </>
    );
  }

  return (
    <section>
      <span class="label">Cifrado</span>
      {body}
      {err && <p class="err" role="alert">{err}</p>}
    </section>
  );
}

function copyText(text: string, toast: Toast) {
  navigator.clipboard.writeText(text).then(
    () => toast('Copiada'),
    () => toast('No se pudo copiar. Selecciona la clave y cópiala a mano.'),
  );
}

function downloadKey(key: string) {
  const blob = new Blob([`Clave de recuperación de Lista\n\n${key}\n`], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'lista-clave-recuperacion.txt';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
