import { lang } from '../i18n';

export interface Build { version: string; time: string; commit: string }

/** Datos de la compilación; en los tests (sin Vite) quedan vacíos. */
export const BUILD: Build = typeof __BUILD__ !== 'undefined' ? __BUILD__ : { version: '', time: '', commit: '' };

/** «v1.0.0 · 3 nov 2026, 9:51 · a1b2c3d». Sin fecha válida (desarrollo) solo queda la versión. */
export function buildLabel(b: Build = BUILD, locale: string = lang()): string {
  const when = new Date(b.time);
  const parts = [b.version && `v${b.version}`];
  if (!Number.isNaN(when.getTime())) parts.push(when.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }));
  parts.push(b.commit);
  return parts.filter(Boolean).join(' · ');
}
