// Compartir listas (docs/plan-listas.md, «Interfaz de compartir (fase 2D)»): el diálogo de una lista (compartir,
// invitar, miembros, quitar, salir y borrar para todos), el de unirse con un enlace y el icono de lista compartida.
import { useEffect, useRef, useState } from 'preact/hooks';
import { MAIN_LIST, type ID, type ListMemberInfo, type ListRole, type Sync, type SyncState, type TodoList } from '../types';
import { tr } from '../i18n';
import { PeopleIcon } from './PeopleIcon';
import { copyLink, formatExpiry, inviteErrorText, iosBrowser, memberLabel, nextOwner, savePendingJoin, sendLink } from './sharing';

/** Correo de la sesión, si el estado lo trae. */
const emailOf = (s: SyncState): string | undefined => (s as { email?: string }).email || undefined;

/**
 * Comportamiento común de los diálogos: foco al abrir y vuelta al cerrar; Esc y clic fuera cierran salvo mientras
 * hay una operación en marcha. Esc va en fase de captura y no sigue: no cierra también lo que haya debajo.
 */
function useDialog(onClose: () => void, busy: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (!busyRef.current) closeRef.current();
    };
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('keydown', key, true);
      prev?.focus?.();
    };
  }, []);
  const onBackdrop = (e: MouseEvent) => {
    if (e.target === e.currentTarget && !busyRef.current) closeRef.current();
  };
  return { ref, onBackdrop };
}

/** Si el proveedor de Google está activado en el servidor (para no ofrecer un botón que no funciona). */
function useGoogle(sync: Sync, active: boolean): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (active) sync.googleEnabled().then(setOk, () => setOk(false));
  }, [active]);
  return ok;
}

const LOCKED_TEXT = () => tr(
  'Este dispositivo aún no tiene la clave de cifrado. Enlázalo en Ajustes → Sincronización y vuelve a intentarlo.',
  'This device doesn’t have the encryption key yet. Link it in Settings → Sync and try again.',
);

// ---------- compartir ----------

export interface ShareDialogProps {
  list: TodoList;
  sync: Sync;
  state: SyncState;
  onClose: () => void;
  toast: (msg: string) => void;
  /** Tras salir o borrar para todos: la lista ya no está en este dispositivo. */
  onGone: (listId: ID, name: string) => void;
}

type Confirm = { kind: 'remove'; member: ListMemberInfo } | { kind: 'leave' } | { kind: 'delete' };

export function ShareDialog({ list, sync, state, onClose, toast, onGone }: ShareDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [invite, setInvite] = useState<{ link: string; expiresAt: string } | null>(null);
  const [members, setMembers] = useState<ListMemberInfo[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [myRole, setMyRole] = useState<ListRole | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const { ref, onBackdrop } = useDialog(onClose, busy);

  const shared = !!list.shared;
  const signedOut = state.status === 'signedOut';
  const locked = sync.encryption?.() === 'locked';
  const google = useGoogle(sync, signedOut);
  const myEmail = emailOf(state);
  const isMe = (m: ListMemberInfo) => !!myEmail && !!m.email && m.email.toLowerCase() === myEmail.toLowerCase();
  const me = members?.find(isMe) ?? null;
  const owner = (me?.role ?? myRole) === 'owner';

  const load = async () => {
    setLoadError('');
    try {
      const [ms, mine] = await Promise.all([sync.listMembers(list.id), sync.memberships()]);
      setMembers(ms);
      setMyRole(mine.find((m) => m.list_id === list.id)?.role ?? null);
    } catch (e) {
      setLoadError(inviteErrorText(e));
    }
  };
  useEffect(() => {
    if (shared && !signedOut && !locked) void load();
  }, [list.id, shared, signedOut, locked]);

  /** Ejecuta una operación con «ocupado» y el error en el diálogo. */
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(inviteErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const share = () => run(async () => setInvite(await sync.shareList(list.id)));
  const newInvite = () => run(async () => setInvite(await sync.createInvite(list.id)));
  const remove = (m: ListMemberInfo) => run(async () => {
    await sync.removeMember(list.id, m.user_id);
    setConfirm(null);
    toast(tr(`Has quitado a ${memberLabel(m, myEmail)}`, `You removed ${memberLabel(m, myEmail)}`));
    await load();
  });
  const leave = () => run(async () => {
    await sync.leaveList(list.id);
    onGone(list.id, list.name);
    onClose();
  });
  const destroy = () => run(async () => {
    await sync.deleteSharedList(list.id);
    onGone(list.id, list.name);
    onClose();
  });

  const send = async (link: string) => {
    const r = await sendLink(link, list.name);
    if (r === 'copied') toast(tr('Enlace copiado', 'Link copied'));
    if (r === 'failed') setError(tr('No se pudo enviar. Copia el enlace y mándalo tú.', 'Couldn’t send it. Copy the link and send it yourself.'));
  };
  const copy = async (link: string) => {
    if (await copyLink(link)) toast(tr('Enlace copiado', 'Link copied'));
    else setError(tr('No se pudo copiar. Selecciona el enlace y cópialo.', 'Couldn’t copy. Select the link and copy it.'));
  };

  const title = shared ? `«${list.name}»` : tr(`Compartir «${list.name}»`, `Share “${list.name}”`);
  const canShare = typeof navigator.share === 'function';

  const body = () => {
    if (signedOut) {
      return (
        <>
          <p>{tr('Para compartir una lista, entra con tu cuenta de Google. Así la otra persona puede unirse desde su móvil.',
            'To share a list, sign in with your Google account. Then the other person can join from their phone.')}</p>
          <div class="row-btns">
            {google && <button class="btn solid" onClick={() => sync.signInWithGoogle()}>{tr('Entrar con Google', 'Sign in with Google')}</button>}
            <button class="btn" onClick={onClose}>{tr('Cerrar', 'Close')}</button>
          </div>
        </>
      );
    }
    if (locked) {
      return (
        <>
          <p>{LOCKED_TEXT()}</p>
          <div class="row-btns"><button class="btn" onClick={onClose}>{tr('Cerrar', 'Close')}</button></div>
        </>
      );
    }
    if (list.id === MAIN_LIST) {
      return (
        <>
          <p>{tr('La lista Personal no se comparte. Crea otra lista (por ejemplo, Compra) y compártela.',
            'The Personal list isn’t shared. Create another list (for example, Shopping) and share that one.')}</p>
          <div class="row-btns"><button class="btn" onClick={onClose}>{tr('Cerrar', 'Close')}</button></div>
        </>
      );
    }
    if (invite) {
      const expiry = formatExpiry(invite.expiresAt);
      return (
        <>
          <p>{tr('Manda este enlace a la persona que quieras invitar.', 'Send this link to the person you want to invite.')}</p>
          <input class="ls-input share-url" readOnly value={invite.link} aria-label={tr('Enlace de invitación', 'Invite link')}
            onFocus={(e) => e.currentTarget.select()} />
          <div class="row-btns share-link-btns">
            {/* Un solo botón: el menú de compartir del sistema si lo hay (ya ofrece copiar); si no, copiar. */}
            {canShare
              ? <button class="btn solid" onClick={() => void send(invite.link)}>{tr('Enviar', 'Send')}</button>
              : <button class="btn solid" onClick={() => void copy(invite.link)}>{tr('Copiar', 'Copy')}</button>}
          </div>
          <p class="share-hint">{tr(
            `Sirve para una persona y caduca el ${expiry}. Quien tenga el enlace puede unirse: mándalo solo a quien quieras.`,
            `It works for one person and expires on ${expiry}. Anyone with the link can join: send it only to who you want.`)}</p>
          <div class="row-btns share-foot">
            <button class="btn" onClick={() => (shared ? setInvite(null) : onClose())}>{tr('Listo', 'Done')}</button>
          </div>
        </>
      );
    }
    if (!shared) {
      return (
        <>
          <p>{tr(`Quien se una verá y podrá editar las tareas de «${list.name}», también las completadas. Todo va cifrado: ni el servidor puede leerlo.`,
            `Whoever joins will see and edit the tasks in “${list.name}”, including completed ones. Everything is encrypted: not even the server can read it.`)}</p>
          <p>{tr('Te daremos un enlace para mandarlo por WhatsApp, Mensajes o donde quieras.',
            'You’ll get a link to send by WhatsApp, Messages or wherever you like.')}</p>
          <div class="row-btns">
            <button class="btn solid" onClick={() => void share()} disabled={busy}>
              {busy ? tr('Compartiendo…', 'Sharing…') : tr(`Compartir «${list.name}»`, `Share “${list.name}”`)}
            </button>
            <button class="btn" onClick={onClose} disabled={busy}>{tr('Cancelar', 'Cancel')}</button>
          </div>
        </>
      );
    }

    // Ya compartida: miembros, invitar y, al final, salir o borrar para todos.
    const others = (members ?? []).filter((m) => !isMe(m));
    const heir = nextOwner(members ?? [], me?.user_id);
    return (
      <>
        <span class="label share-sub">{tr('Personas', 'People')}</span>
        {members === null && !loadError && <p>{tr('Cargando…', 'Loading…')}</p>}
        {loadError && (
          <p class="share-error" role="alert">{loadError}{' '}
            <button class="link" onClick={() => void load()}>{tr('Reintentar', 'Retry')}</button></p>
        )}
        {members && (
          <ul class="share-members">
            {members.map((m) => (
              <li class="share-member" key={m.user_id}>
                <span class="share-who">
                  <span class="share-name">{memberLabel(m, myEmail)}</span>
                  {m.name && m.email && !isMe(m) && <span class="share-email">{m.email}</span>}
                </span>
                {m.role === 'owner' && <span class="share-tag">{tr('administra', 'admin')}</span>}
                {owner && !isMe(m) && (
                  <button class="link danger" onClick={() => setConfirm({ kind: 'remove', member: m })} disabled={busy}
                    aria-label={tr(`Quitar a ${memberLabel(m, myEmail)}`, `Remove ${memberLabel(m, myEmail)}`)}>
                    {tr('Quitar', 'Remove')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {confirm ? (
          <div class="share-confirm" role="alert">
            <p>{confirm.kind === 'remove'
              ? tr(`¿Quitar a ${memberLabel(confirm.member, myEmail)}? Dejará de ver la lista.`, `Remove ${memberLabel(confirm.member, myEmail)}? They’ll stop seeing the list.`)
              : confirm.kind === 'delete'
                ? tr(`Se borrará «${list.name}» con sus tareas para todas las personas. No se puede deshacer.`, `“${list.name}” and its tasks will be deleted for everyone. This can’t be undone.`)
                : owner
                  ? (heir
                    ? tr(`Dejarás de ver «${list.name}» en tus dispositivos. La lista pasará a ${memberLabel(heir, myEmail)}.`, `You’ll stop seeing “${list.name}” on your devices. The list will pass to ${memberLabel(heir, myEmail)}.`)
                    : tr('Eres la única persona: la lista se borrará.', 'You’re the only person: the list will be deleted.'))
                  : tr(`Dejarás de ver «${list.name}» en tus dispositivos. Los demás la conservan.`, `You’ll stop seeing “${list.name}” on your devices. The others keep it.`)}</p>
            <div class="row-btns">
              <button class="btn danger-btn solid" disabled={busy}
                onClick={() => void (confirm.kind === 'remove' ? remove(confirm.member) : confirm.kind === 'delete' ? destroy() : leave())}>
                {confirm.kind === 'remove' ? tr('Quitar', 'Remove') : confirm.kind === 'delete' ? tr('Borrar para todos', 'Delete for everyone') : tr('Salir', 'Leave')}
              </button>
              <button class="btn" onClick={() => setConfirm(null)} disabled={busy}>{tr('Cancelar', 'Cancel')}</button>
            </div>
          </div>
        ) : (
          <>
            <div class="row-btns">
              <button class="btn solid" onClick={() => void newInvite()} disabled={busy}>
                {busy ? tr('Creando enlace…', 'Creating link…') : tr('Invitar a alguien', 'Invite someone')}
              </button>
              <button class="btn" onClick={onClose} disabled={busy}>{tr('Cerrar', 'Close')}</button>
            </div>
            <div class="share-foot">
              <button class="link danger" onClick={() => setConfirm({ kind: 'leave' })} disabled={busy}>{tr('Salir de la lista', 'Leave the list')}</button>
              {owner && others.length > 0 && (
                <button class="link danger" onClick={() => setConfirm({ kind: 'delete' })} disabled={busy}>{tr('Borrar para todos', 'Delete for everyone')}</button>
              )}
            </div>
          </>
        )}
      </>
    );
  };

  return (
    <div class="dialog-backdrop" onClick={onBackdrop}>
      <div class="dialog share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-title" tabIndex={-1} ref={ref}>
        <h2 class="share-title" id="share-title">
          <span>{title}</span>{shared && <PeopleIcon title={tr('Compartida', 'Shared')} />}
        </h2>
        {body()}
        {error && <p class="share-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}

// ---------- unirse ----------

export interface JoinDialogProps {
  /** Enlace de invitación (#unirse=…): el que abrió la app o el que se pegó en la caja de tareas. */
  link: string;
  sync: Sync;
  state: SyncState;
  onClose: () => void;
  onJoined: (listId: ID, name: string) => void;
}

/** Enlace completo a partir de lo guardado (el fragmento solo) para copiarlo en la app instalada. */
const fullLink = (link: string): string => (link.startsWith('#') ? `${location.origin}/${link}` : link);

export function JoinDialog({ link, sync, state, onClose, onJoined }: JoinDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { ref, onBackdrop } = useDialog(onClose, busy);
  const signedOut = state.status === 'signedOut';
  const locked = sync.encryption?.() === 'locked';
  const google = useGoogle(sync, signedOut);
  const value = link.trim();

  const joinNow = async () => {
    if (!value || busy) return;
    setBusy(true);
    setError('');
    try {
      const joined = await sync.joinList(value);
      onJoined(joined.listId, joined.name);
      onClose();
    } catch (e) {
      setError(inviteErrorText(e));
      setBusy(false);
    }
  };
  // El enlace se guarda antes de ir a Google: al volver, la app vuelve a abrir este diálogo con él.
  const signIn = () => {
    if (value) savePendingJoin(value);
    sync.signInWithGoogle();
  };
  const copy = async () => {
    if (!(await copyLink(fullLink(link)))) setError(tr('No se pudo copiar el enlace.', 'Couldn’t copy the link.'));
    else setError('');
  };

  return (
    <div class="dialog-backdrop" onClick={onBackdrop}>
      <div class="dialog share-dialog" role="dialog" aria-modal="true" aria-labelledby="join-title" tabIndex={-1} ref={ref}>
        <h2 class="share-title" id="join-title">{tr('Unirse a una lista', 'Join a list')}</h2>
        <p>{tr('Te han invitado a una lista compartida. Al unirte, la verás en tus dispositivos y podrás editarla con quien te invitó.',
          'You’ve been invited to a shared list. Once you join, you’ll see it on your devices and can edit it with whoever invited you.')}</p>

        {signedOut ? (
          <>
            <p>{tr('Para unirte, entra con tu cuenta de Google.', 'To join, sign in with your Google account.')}</p>
            {iosBrowser() && (
              <p class="share-hint">{tr(
                '¿Tienes Lista en la pantalla de inicio? Copia el enlace, abre Lista y pégalo donde escribes las tareas.',
                'Have Lista on your home screen? Copy the link, open Lista and paste it where you write tasks.')}</p>
            )}
            <div class="row-btns">
              {google && <button class="btn solid" onClick={signIn}>{tr('Entrar con Google', 'Sign in with Google')}</button>}
              {iosBrowser() && <button class="btn" onClick={() => void copy()}>{tr('Copiar enlace', 'Copy link')}</button>}
              <button class="btn" onClick={onClose}>{tr('Ahora no', 'Not now')}</button>
            </div>
          </>
        ) : locked ? (
          <>
            <p>{LOCKED_TEXT()}</p>
            <div class="row-btns"><button class="btn" onClick={onClose}>{tr('Cerrar', 'Close')}</button></div>
          </>
        ) : (
          <div class="row-btns">
            <button class="btn solid" onClick={() => void joinNow()} disabled={busy}>
              {busy ? tr('Uniéndote…', 'Joining…') : tr('Unirme', 'Join')}
            </button>
            <button class="btn" onClick={onClose} disabled={busy}>{error ? tr('Cerrar', 'Close') : tr('Ahora no', 'Not now')}</button>
          </div>
        )}
        {error && <p class="share-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
