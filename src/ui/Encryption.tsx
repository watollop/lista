// Cifrado de extremo a extremo en la interfaz (ver docs/plan-cifrado.md): la sección de Ajustes, el panel del
// dispositivo bloqueado (en la lista y en Ajustes) y el diálogo con el que el dispositivo activado confirma un enlace.
import { useState } from 'preact/hooks';
import type { LinkState, Sync, SyncState } from '../types';
import { tr } from '../i18n';

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
  const start = () => run(() => sync.startLink(), tr('No se pudo iniciar el enlace.', 'Couldn’t start linking.'));
  const cancel = <button class="btn" disabled={busy} onClick={() => run(() => sync.cancelLink(), tr('No se pudo cancelar.', 'Couldn’t cancel.'))}>{tr('Cancelar', 'Cancel')}</button>;

  let content;
  if (!mine) {
    content = (
      <>
        <span class="enc-title">{tr('Este dispositivo está bloqueado', 'This device is locked')}</span>
        <p>{tr('Tus datos están cifrados y este dispositivo aún no tiene la clave, así que no ve los cambios nuevos. Lo que cambies aquí se guarda y se subirá al enlazarlo.', 'Your data is encrypted and this device doesn’t have the key yet, so it can’t see new changes. Anything you change here is saved and will upload once it’s linked.')}</p>
        <div class="row-btns">
          <button class="btn solid" disabled={busy} onClick={start}>{tr('Enlazar este dispositivo', 'Link this device')}</button>
          {onRecovery && <button class="link" onClick={onRecovery}>{tr('Usar clave de recuperación', 'Use recovery key')}</button>}
        </div>
      </>
    );
  } else if (mine.status === 'waiting') {
    content = (
      <>
        <span class="enc-title">{tr('Esperando a tu otro dispositivo…', 'Waiting for your other device…')}</span>
        <p>{tr('Abre Lista en el dispositivo donde ya está activado el cifrado. Aparecerá un aviso para confirmar el enlace.', 'Open Lista on the device where encryption is already on. A prompt will appear to confirm the link.')}</p>
        <p class="enc-hint">{tr('La petición caduca en 10 minutos.', 'The request expires in 10 minutes.')}</p>
        <div class="row-btns">{cancel}</div>
      </>
    );
  } else if (mine.status === 'code') {
    content = (
      <>
        <span class="enc-title">{tr('Confirma el código en tu otro dispositivo', 'Confirm the code on your other device')}</span>
        <div class="link-code">{mine.code}</div>
        <p>{tr('Si coincide con el que ves allí, pulsa «Enlazar» en ese dispositivo.', 'If it matches the one shown there, tap “Link” on that device.')}</p>
        <div class="row-btns">{cancel}</div>
      </>
    );
  } else {
    content = (
      <>
        <span class="enc-title">{tr('No se pudo enlazar', 'Couldn’t link')}</span>
        <p class="err">{mine.message}</p>
        <div class="row-btns">
          <button class="btn solid" disabled={busy}
            onClick={() => run(async () => { await sync.cancelLink(); await sync.startLink(); }, tr('No se pudo iniciar el enlace.', 'Couldn’t start linking.'))}>
            {tr('Volver a intentarlo', 'Try again')}
          </button>
          <button class="btn" disabled={busy} onClick={() => run(() => sync.cancelLink(), tr('No se pudo cerrar.', 'Couldn’t close.'))}>{tr('Cerrar', 'Close')}</button>
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
  const reject = async () => { if (await run(() => sync.cancelLink(), tr('No se pudo rechazar.', 'Couldn’t reject.'))) toast(tr('Enlace rechazado', 'Link rejected')); };
  const rejectBtn = <button class="btn" disabled={busy} onClick={reject}>{tr('Rechazar', 'Reject')}</button>;

  let content;
  if (link.status === 'waiting') {
    content = (
      <>
        <span class="enc-title" id="link-dialog-title">{tr('Un dispositivo quiere enlazarse', 'A device wants to link')}</span>
        <p>{tr('Preparando el código de seguridad…', 'Preparing the security code…')}</p>
        <div class="row-btns">{rejectBtn}</div>
      </>
    );
  } else if (link.status === 'code') {
    content = (
      <>
        <span class="enc-title" id="link-dialog-title">{tr('¿Enlazar un dispositivo nuevo?', 'Link a new device?')}</span>
        <p>{tr('Comprueba que el dispositivo nuevo muestra este mismo código:', 'Check that the new device shows this same code:')}</p>
        <div class="link-code">{link.code}</div>
        <p class="enc-warn">{tr('Confirma solo si eres tú quien lo está enlazando ahora mismo. Si no lo esperabas, recházalo: tendría acceso a todos tus datos.', 'Only confirm if you’re the one linking it right now. If you weren’t expecting it, reject it: it would get access to all your data.')}</p>
        <div class="row-btns">
          <button class="btn solid" disabled={busy}
            onClick={async () => { if (await run(() => sync.confirmLink(), tr('No se pudo enlazar.', 'Couldn’t link.'))) toast(tr('Dispositivo enlazado', 'Device linked')); }}>
            {tr('Enlazar', 'Link')}
          </button>
          {rejectBtn}
        </div>
      </>
    );
  } else {
    content = (
      <>
        <span class="enc-title" id="link-dialog-title">{tr('No se pudo enlazar', 'Couldn’t link')}</span>
        <p class="err">{link.message}</p>
        <div class="row-btns">
          <button class="btn" disabled={busy} onClick={() => run(() => sync.cancelLink(), tr('No se pudo cerrar.', 'Couldn’t close.'))}>{tr('Cerrar', 'Close')}</button>
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
    body = <p aria-live="polite">{tr('Tus datos se cifrarán en la primera sincronización.', 'Your data will be encrypted on the first sync.')}</p>;
  } else if (mode === 'migrating') {
    body = <p aria-live="polite">{tr('Cifrando tus datos… Mantén la app abierta hasta que termine.', 'Encrypting your data… Keep the app open until it finishes.')}</p>;
  } else if (mode === 'on') {
    body = (
      <>
        <p aria-live="polite">{tr('Tus datos se guardan cifrados: nadie más puede leerlos, ni siquiera el administrador del servidor.', 'Your data is stored encrypted: nobody else can read it, not even the server admin.')}</p>
        <p class="enc-hint">{tr('Tus otros dispositivos se enlazan con un código la primera vez que los abras. Crea una clave de recuperación por si los pierdes todos.', 'Your other devices link with a code the first time you open them. Create a recovery key in case you lose them all.')}</p>
        {recoveryKey ? (
          <div class="recovery">
            <code class="recovery-key" aria-live="polite">{recoveryKey}</code>
            <div class="row-btns">
              <button class="btn" onClick={() => copyText(recoveryKey, toast)}>{tr('Copiar', 'Copy')}</button>
              <button class="btn" onClick={() => downloadKey(recoveryKey)}>{tr('Descargar', 'Download')}</button>
              <button class="btn" onClick={() => setRecoveryKey(null)}>{tr('Ya la he guardado', 'I’ve saved it')}</button>
            </div>
          </div>
        ) : !confirmKey ? (
          <div class="row-btns"><button class="btn" onClick={() => setConfirmKey(true)}>{tr('Crear clave de recuperación', 'Create recovery key')}</button></div>
        ) : (
          <>
            <p>{tr('Sirve para recuperar tus datos si pierdes todos tus dispositivos. Guárdala en un lugar seguro: solo se muestra una vez y crear otra invalida la anterior.', 'It lets you recover your data if you lose all your devices. Keep it somewhere safe: it’s only shown once, and creating another one invalidates the previous one.')}</p>
            <div class="row-btns">
              <button class="btn solid" disabled={busy}
                onClick={() => run(async () => { setRecoveryKey(await sync.createRecoveryKey()); setConfirmKey(false); }, tr('No se pudo crear la clave.', 'Couldn’t create the key.'))}>
                {busy ? tr('Creando…', 'Creating…') : tr('Crear', 'Create')}
              </button>
              <button class="btn" disabled={busy} onClick={() => setConfirmKey(false)}>{tr('Cancelar', 'Cancel')}</button>
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
          <button class="link" aria-expanded={showUnlock} onClick={() => setShowUnlock(!showUnlock)}>{tr('Usar clave de recuperación', 'Use recovery key')}</button>
        </div>
        {showUnlock && (
          <form class="unlock-form" onSubmit={async (e) => {
            e.preventDefault();
            if (!unlockValue.trim()) return;
            if (await run(() => sync.unlockWithRecovery(unlockValue), tr('La clave no es válida.', 'The key isn’t valid.'))) setUnlockValue('');
          }}>
            <input type="text" autocomplete="off" spellcheck={false} aria-label={tr('Clave de recuperación', 'Recovery key')}
              placeholder={tr('Clave de recuperación', 'Recovery key')} value={unlockValue}
              onInput={(e) => setUnlockValue(e.currentTarget.value)} />
            <div class="row-btns">
              <button class="btn solid" type="submit" disabled={busy || !unlockValue.trim()}>{tr('Desbloquear', 'Unlock')}</button>
            </div>
          </form>
        )}
        <div class="enc-small">
          {!confirmReset ? (
            <button class="link" onClick={() => setConfirmReset(true)}>{tr('¿Has perdido todos tus dispositivos y la clave?', 'Lost all your devices and the key?')}</button>
          ) : (
            <>
              <p>{tr('Se borrarán los datos cifrados del servidor y se volverán a subir los de este dispositivo. Tus otros dispositivos tendrán que enlazarse de nuevo.', 'The encrypted data on the server will be deleted and this device’s data uploaded again. Your other devices will need to link again.')}</p>
              <div class="row-btns">
                <button class="btn danger-btn solid" disabled={busy}
                  onClick={async () => { if (await run(() => sync.resetEncryption(), tr('No se pudo restablecer el cifrado.', 'Couldn’t reset encryption.'))) setConfirmReset(false); }}>
                  {tr('Restablecer cifrado', 'Reset encryption')}
                </button>
                <button class="btn" disabled={busy} onClick={() => setConfirmReset(false)}>{tr('Cancelar', 'Cancel')}</button>
              </div>
            </>
          )}
        </div>
      </>
    );
  }

  return (
    <section>
      <span class="label">{tr('Cifrado', 'Encryption')}</span>
      {body}
      {err && <p class="err" role="alert">{err}</p>}
    </section>
  );
}

function copyText(text: string, toast: Toast) {
  navigator.clipboard.writeText(text).then(
    () => toast(tr('Copiada', 'Copied')),
    () => toast(tr('No se pudo copiar. Selecciona la clave y cópiala a mano.', 'Couldn’t copy. Select the key and copy it by hand.')),
  );
}

function downloadKey(key: string) {
  const blob = new Blob([`${tr('Clave de recuperación de Lista', 'Lista recovery key')}\n\n${key}\n`], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = tr('lista-clave-recuperacion.txt', 'lista-recovery-key.txt');
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
