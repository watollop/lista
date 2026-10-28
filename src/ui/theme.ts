/** Tema y estilo elegidos en Ajustes. 'system' sigue a prefers-color-scheme. index.html los aplica antes de pintar. */
export type Theme = 'system' | 'light' | 'dark';
export type Look = 'classic' | 'industrial';

const KEY = 'lista.theme';
const LOOK_KEY = 'lista.look';

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

export function setTheme(t: Theme): void {
  try {
    if (t === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch { /* modo privado */ }
  applyTheme(t);
}

export function getLook(): Look {
  try {
    return localStorage.getItem(LOOK_KEY) === 'industrial' ? 'industrial' : 'classic';
  } catch {
    return 'classic';
  }
}

export function setLook(l: Look): void {
  try {
    if (l === 'classic') localStorage.removeItem(LOOK_KEY);
    else localStorage.setItem(LOOK_KEY, l);
  } catch { /* modo privado */ }
  applyTheme();
}

/** Fondo de cada estilo en claro y oscuro: barra del navegador. */
const BG: Record<Look, [string, string]> = { classic: ['#ffffff', '#0c0c0c'], industrial: ['#eeede9', '#000000'] };

export function applyTheme(t: Theme = getTheme(), l: Look = getLook()): void {
  const root = document.documentElement;
  if (t === 'system') delete root.dataset.theme;
  else root.dataset.theme = t;
  if (l === 'classic') delete root.dataset.look;
  else root.dataset.look = l;
  // Color de la barra del navegador: las dos metas (claro/oscuro) apuntan al tema forzado, o cada una al suyo.
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    const dark = t === 'dark' || (t === 'system' && /dark/.test(m.getAttribute('media') ?? ''));
    m.setAttribute('content', BG[l][dark ? 1 : 0]);
  });
}
