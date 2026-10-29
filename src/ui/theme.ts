/** Tema y estilo elegidos en Ajustes. 'system' sigue a prefers-color-scheme. index.html los aplica antes de pintar. */
export type Theme = 'system' | 'light' | 'dark';
export type Look = 'classic' | 'industrial';

const KEY = 'lista.theme';
const LOOK_KEY = 'lista.look';
const SUBTASK_COLOR_KEY = 'lista.subtaskColor';
export const DEFAULT_SUBTASK_COLOR = '#db729f';

export function getSubtaskColor(): string {
  try {
    const color = localStorage.getItem(SUBTASK_COLOR_KEY);
    return color && /^#[\da-f]{6}$/i.test(color) ? color : DEFAULT_SUBTASK_COLOR;
  } catch {
    return DEFAULT_SUBTASK_COLOR;
  }
}

export function setSubtaskColor(color: string): void {
  if (!/^#[\da-f]{6}$/i.test(color)) throw new Error('Elige un color válido.');
  localStorage.setItem(SUBTASK_COLOR_KEY, color);
  document.documentElement.style.setProperty('--subtask-color', color);
}

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
    return localStorage.getItem(LOOK_KEY) === 'classic' ? 'classic' : 'industrial'; // Industrial por defecto
  } catch {
    return 'industrial';
  }
}

export function setLook(l: Look): void {
  try {
    localStorage.setItem(LOOK_KEY, l);
  } catch { /* modo privado */ }
  applyTheme();
}

/** Fondo de cada estilo en claro y oscuro: barra del navegador. */
const BG: Record<Look, [string, string]> = { classic: ['#ffffff', '#0c0c0c'], industrial: ['#eeede9', '#000000'] };

export function applyTheme(t: Theme = getTheme(), l: Look = getLook()): void {
  const root = document.documentElement;
  root.style.setProperty('--subtask-color', getSubtaskColor());
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
