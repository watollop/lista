// Sesión contra la API de Auth (GoTrue) de Supabase, con fetch directo.
import { HttpError, parseBody } from './api';

export interface SyncConfig {
  url: string;
  anonKey: string;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // ms epoch
  userId: string;
  email: string;
}

export type SessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type FetchLike = typeof fetch;

export const SESSION_KEY = 'lista.session';
export const SIGNUP_CONFIRM_MESSAGE = 'Revisa tu email para confirmar la cuenta y luego inicia sesión';
const BAD_CREDENTIALS_MESSAGE = 'Email o contraseña incorrectos';

interface AuthBody {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: { id?: string; email?: string };
  error_description?: string;
  msg?: string;
  message?: string;
  error?: string;
}

/** Traduce el error de GoTrue a un mensaje en castellano. */
function authMessage(status: number, body: AuthBody): string {
  const raw = String(body.error_description || body.msg || body.message || body.error || '');
  if (/invalid login credentials/i.test(raw)) return BAD_CREDENTIALS_MESSAGE;
  if (/email not confirmed/i.test(raw)) return SIGNUP_CONFIRM_MESSAGE;
  if (/already (registered|been registered)/i.test(raw)) return 'Ya existe una cuenta con ese email';
  if (/rate limit|too many|security purposes/i.test(raw)) return 'Demasiados intentos: espera unos minutos';
  return raw || `No se pudo completar la operación (${status})`;
}

async function authPost(
  cfg: SyncConfig,
  path: string,
  body: unknown,
  fetchImpl: FetchLike,
): Promise<AuthBody> {
  const res = await fetchImpl(`${cfg.url}${path}`, {
    method: 'POST',
    headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await parseBody(res)) as AuthBody;
  if (!res.ok) throw new HttpError(res.status, authMessage(res.status, data));
  return data;
}

function toSession(body: AuthBody, now: number): Session {
  if (!body.access_token || !body.refresh_token || !body.user?.id) {
    throw new Error('Respuesta de autenticación inesperada');
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: now + (body.expires_in ?? 3600) * 1000,
    userId: body.user.id,
    email: body.user.email ?? '',
  };
}

export async function signIn(
  cfg: SyncConfig,
  email: string,
  password: string,
  fetchImpl: FetchLike,
  now: () => number = Date.now,
): Promise<Session> {
  const body = await authPost(cfg, '/auth/v1/token?grant_type=password', { email, password }, fetchImpl);
  return toSession(body, now());
}

/** Sin access_token en la respuesta => la confirmación por email está activada. */
export async function signUp(
  cfg: SyncConfig,
  email: string,
  password: string,
  fetchImpl: FetchLike,
  now: () => number = Date.now,
): Promise<Session> {
  const body = await authPost(cfg, '/auth/v1/signup', { email, password }, fetchImpl);
  if (!body.access_token) throw new Error(SIGNUP_CONFIRM_MESSAGE);
  return toSession(body, now());
}

/** URL de Google OAuth de Supabase. Al volver, los tokens llegan en el hash de redirectTo. */
export function googleAuthorizeUrl(cfg: SyncConfig, redirectTo: string): string {
  return `${cfg.url}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;
}

/** ¿Está activado el acceso con Google en el proyecto? (GET /auth/v1/settings, público). */
export async function googleEnabled(cfg: SyncConfig, fetchImpl: FetchLike): Promise<boolean> {
  try {
    const res = await fetchImpl(`${cfg.url}/auth/v1/settings`, { headers: { apikey: cfg.anonKey } });
    if (!res.ok) return false;
    const data = (await res.json()) as { external?: { google?: boolean } };
    return data.external?.google === true;
  } catch {
    return false;
  }
}

/** Lee la sesión del hash tras volver de Google (#access_token=…). null si el hash no es de auth. */
export async function sessionFromRedirect(
  cfg: SyncConfig,
  hash: string,
  fetchImpl: FetchLike,
  now: () => number = Date.now,
): Promise<Session | null> {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const error = p.get('error_description') || p.get('error');
  if (error) throw new Error(error.replace(/\+/g, ' '));
  const accessToken = p.get('access_token');
  const refreshToken = p.get('refresh_token');
  if (!accessToken || !refreshToken) return null;
  const res = await fetchImpl(`${cfg.url}/auth/v1/user`, {
    headers: { apikey: cfg.anonKey, Authorization: `Bearer ${accessToken}` },
  });
  const user = (await parseBody(res)) as { id?: string; email?: string };
  if (!res.ok || !user.id) throw new HttpError(res.status, 'No se pudo completar el acceso con Google');
  return {
    accessToken,
    refreshToken,
    expiresAt: now() + Number(p.get('expires_in') ?? 3600) * 1000,
    userId: user.id,
    email: user.email ?? '',
  };
}

export async function refresh(
  cfg: SyncConfig,
  refreshToken: string,
  fetchImpl: FetchLike,
  now: () => number = Date.now,
): Promise<Session> {
  const body = await authPost(
    cfg,
    '/auth/v1/token?grant_type=refresh_token',
    { refresh_token: refreshToken },
    fetchImpl,
  );
  return toSession(body, now());
}

/** Cierre de sesión en el servidor. Los errores se ignoran: el cliente igualmente olvida la sesión. */
export async function signOut(cfg: SyncConfig, accessToken: string, fetchImpl: FetchLike): Promise<void> {
  try {
    await fetchImpl(`${cfg.url}/auth/v1/logout`, {
      method: 'POST',
      headers: { apikey: cfg.anonKey, Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    // ignorado a propósito
  }
}

export function loadSession(storage: SessionStorage): Session | null {
  try {
    const raw = storage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (!s || !s.accessToken || !s.refreshToken || !s.userId) return null;
    return s;
  } catch {
    return null;
  }
}

export function saveSession(storage: SessionStorage, s: Session): void {
  try {
    storage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    // almacenamiento no disponible (p. ej. ventana privada): la sesión vive solo en memoria
  }
}

export function clearSession(storage: SessionStorage): void {
  try {
    storage.removeItem(SESSION_KEY);
  } catch {
    // ignorado
  }
}
