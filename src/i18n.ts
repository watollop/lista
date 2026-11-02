/**
 * Idioma de la interfaz: español o inglés. «Lista» (el nombre) y la firma de Ajustes no se traducen.
 * - Por defecto sigue al navegador: español si alguna de sus lenguas preferidas es español; si no, inglés.
 * - Se puede fijar en Ajustes: se guarda en este dispositivo y viaja con la cuenta (ver ui/langSync). Cambiarlo recarga la app.
 * - El intérprete de la captura entiende el idioma activo (en español no se cuelan palabras inglesas
 *   como «daily», y al revés).
 * Mientras no se llama a initLang (tests), el idioma es español.
 */
export type Lang = 'es' | 'en';
export type LangPref = Lang | 'auto';

const KEY = 'lista.lang';
let current: Lang = 'es';

export const lang = (): Lang => current;
export const isEn = () => current === 'en';
/** Texto según el idioma: tr('Ajustes', 'Settings'). */
export const tr = (es: string, en: string) => (current === 'en' ? en : es);

/** Solo para tests: fija el idioma sin tocar el almacenamiento. */
export function setLangForTests(l: Lang) { current = l; }

export function detectLang(languages: readonly string[] | undefined): Lang {
  return (languages ?? []).some((l) => l.toLowerCase().startsWith('es')) ? 'es' : 'en';
}

export function langPref(): LangPref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'es' || v === 'en' ? v : 'auto';
  } catch { return 'auto'; }
}

/** Al arrancar: preferencia guardada o idioma del navegador. Pone también <html lang>. */
/** Idioma que resulta de una preferencia en este navegador. */
export function effectiveLang(pref: LangPref): Lang {
  if (pref !== 'auto') return pref;
  const nav = typeof navigator !== 'undefined' ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : [];
  return detectLang(nav);
}

export function initLang(): Lang {
  current = effectiveLang(langPref());
  if (typeof document !== 'undefined') document.documentElement.lang = current;
  return current;
}

export const isLangPref = (v: unknown): v is LangPref => v === 'auto' || v === 'es' || v === 'en';

/** Guarda la preferencia en este dispositivo (sin recargar). */
export function storeLangPref(pref: LangPref) {
  try {
    if (pref === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, pref);
  } catch { /* modo privado: solo esta sesión */ }
}

/** ¿Hay un idioma elegido a mano en este dispositivo? */
export function hasStoredLang(): boolean {
  try { return localStorage.getItem(KEY) !== null; } catch { return false; }
}

/** Cambia la preferencia y recarga para que toda la app (y las vistas diferidas) salgan en el idioma nuevo. */
export function setLangPref(pref: LangPref) {
  storeLangPref(pref);
  location.reload();
}
