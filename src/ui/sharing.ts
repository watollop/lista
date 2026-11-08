// Helpers puros de compartir listas (docs/plan-listas.md, fase 2D): enlace de unirse guardado en sessionStorage,
// textos de error de las invitaciones, quién es quién en los miembros y envío del enlace (menú del sistema o portapapeles).
import type { ListMemberInfo } from '../types';
import { InviteRejectedError, SharingUnavailableError } from '../sync/listapi';
import { lang, tr } from '../i18n';

/** Clave de sessionStorage con el fragmento `#unirse=…` pendiente (sobrevive al regreso de Google). */
export const JOIN_KEY = 'lista.join';
const JOIN_PREFIX = '#unirse=';

/** Lo que usan estos helpers de navigator, para poder pasar objetos falsos en los tests. */
export interface ShareNav {
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
  clipboard?: { writeText(text: string): Promise<void> };
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  standalone?: boolean; // iOS: navigator.standalone en la app instalada
}

interface WinLike {
  matchMedia?: (query: string) => { matches: boolean };
}

/**
 * Si la URL trae `#unirse=…`, guarda el fragmento en store y lo quita de la barra (replaceState) antes de nada.
 * Devuelve true si lo capturó. Nunca lanza: si el almacenamiento falla, no toca la URL y devuelve false.
 */
export function captureJoinLink(
  loc: { hash: string; pathname: string; search: string } = location,
  hist: { replaceState(data: unknown, unused: string, url?: string | null): void } = history,
  store: { setItem(key: string, value: string): void } = sessionStorage,
): boolean {
  if (!loc.hash.startsWith(JOIN_PREFIX)) return false;
  try {
    store.setItem(JOIN_KEY, loc.hash);
  } catch {
    return false; // sin almacenamiento no se puede guardar el enlace: mejor dejarlo en la URL
  }
  try {
    hist.replaceState(null, '', loc.pathname + loc.search);
  } catch { /* la URL se queda como está; el enlace ya está guardado */ }
  return true;
}

/** Guarda un enlace pegado a mano (completo o solo el fragmento) para después de entrar con Google. */
export function savePendingJoin(link: string, store: { setItem(key: string, value: string): void } = sessionStorage): boolean {
  const i = link.indexOf(JOIN_PREFIX);
  if (i < 0) return false;
  try {
    store.setItem(JOIN_KEY, link.slice(i));
    return true;
  } catch {
    return false;
  }
}

/** Fragmento pendiente (`#unirse=…`) o null. Nunca lanza. */
export function pendingJoin(store: { getItem(key: string): string | null } = sessionStorage): string | null {
  try {
    return store.getItem(JOIN_KEY);
  } catch {
    return null;
  }
}

/** Quita el fragmento pendiente. Nunca lanza. */
export function clearPendingJoin(store: { removeItem(key: string): void } = sessionStorage): void {
  try {
    store.removeItem(JOIN_KEY);
  } catch { /* nada que limpiar */ }
}

/** Texto para mostrar al usuario cuando falla compartir, invitar o unirse. */
export function inviteErrorText(e: unknown): string {
  const generic = tr('No se pudo completar. Inténtalo de nuevo.', 'Couldn’t finish. Try again.');
  if (e instanceof InviteRejectedError) {
    switch (e.code) {
      case 'invite_invalid':
        return tr('Este enlace no es válido. Pide uno nuevo.', 'This link isn’t valid. Ask for a new one.');
      case 'invite_used':
        return tr(
          'Este enlace ya se usó. Cada enlace sirve para una persona: pide uno nuevo.',
          'This link was already used. Each link works for one person: ask for a new one.',
        );
      case 'invite_expired':
        return tr('Este enlace ha caducado. Pide uno nuevo.', 'This link has expired. Ask for a new one.');
      case 'list_full':
        return tr('Esta lista ya tiene 50 personas.', 'This list already has 50 people.');
      default:
        return generic;
    }
  }
  if (e instanceof SharingUnavailableError) {
    return tr('Tu servidor aún no admite listas compartidas.', 'Your server doesn’t support shared lists yet.');
  }
  if (e instanceof Error && e.message) return e.message;
  return generic;
}

/** Nombre a mostrar de un miembro: «Tú» si su email es el mío; si no, nombre, email o «Alguien». */
export function memberLabel(m: ListMemberInfo, myEmail?: string): string {
  if (myEmail && m.email && m.email.trim().toLowerCase() === myEmail.trim().toLowerCase()) return tr('Tú', 'You');
  const name = m.name?.trim();
  if (name) return name;
  const email = m.email?.trim();
  if (email) return email;
  return tr('Alguien', 'Someone');
}

/**
 * Quien heredaría la lista si la owner se va: el miembro más antiguo entre los demás (tie → user_id menor).
 * null si no hay nadie más. myUserId se excluye (es quien se va).
 */
export function nextOwner(members: ListMemberInfo[], myUserId?: string): ListMemberInfo | null {
  let best: ListMemberInfo | null = null;
  for (const m of members) {
    if (m.user_id === myUserId) continue;
    if (!best) { best = m; continue; }
    const a = Date.parse(m.joined_at);
    const b = Date.parse(best.joined_at);
    if (a < b || (a === b && m.user_id < best.user_id)) best = m;
  }
  return best;
}

/** Fecha corta y local de caducidad: «15 nov» en español, «Nov 15» en inglés. '' si la fecha no es válida. */
export function formatExpiry(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(lang() === 'en' ? 'en-US' : 'es-ES', { day: 'numeric', month: 'short' }).format(d);
}

function isAbort(e: unknown): boolean {
  return (e as { name?: unknown } | null)?.name === 'AbortError';
}

/**
 * Envía el enlace con el menú de compartir del sistema si lo hay; si no, o si falla, lo copia.
 * 'cancelled' si el usuario cierra el menú; 'failed' si no se pudo ni enviar ni copiar.
 */
export async function sendLink(link: string, listName: string, nav: ShareNav = navigator): Promise<'shared' | 'copied' | 'cancelled' | 'failed'> {
  if (typeof nav.share === 'function') {
    try {
      await nav.share({
        title: tr('Lista', 'Lista'),
        text: tr(`Te invito a mi lista «${listName}» en Lista`, `I’m inviting you to my list «${listName}» in Lista`),
        url: link,
      });
      return 'shared';
    } catch (e) {
      if (isAbort(e)) return 'cancelled';
      // Otro fallo (p. ej. sin gesto de usuario): se intenta copiar.
    }
  }
  return (await copyLink(link, nav)) ? 'copied' : 'failed';
}

/** Copia el enlace al portapapeles. false si el navegador no deja. */
export async function copyLink(link: string, nav: ShareNav = navigator): Promise<boolean> {
  if (!nav.clipboard) return false;
  try {
    await nav.clipboard.writeText(link);
    return true;
  } catch {
    return false;
  }
}

/**
 * iPhone/iPad fuera de la app instalada (en Safari, o en cualquier navegador de iOS): ahí el almacenamiento
 * no se comparte con la app de la pantalla de inicio, así que hay que copiar el enlace y pegarlo allí.
 */
export function iosBrowser(nav: ShareNav = navigator, win: WinLike = window): boolean {
  const ua = nav.userAgent ?? '';
  const ios = /iPhone|iPad|iPod/.test(ua) || (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1);
  if (!ios) return false;
  const standalone = nav.standalone === true || win.matchMedia?.('(display-mode: standalone)').matches === true;
  return !standalone;
}
