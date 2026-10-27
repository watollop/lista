/** Tema elegido en Ajustes. 'system' sigue a prefers-color-scheme. index.html lo aplica antes de pintar. */
export type Theme = 'system' | 'light' | 'dark';

const KEY = 'lista.theme';

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

export function applyTheme(t: Theme = getTheme()): void {
  const root = document.documentElement;
  if (t === 'system') delete root.dataset.theme;
  else root.dataset.theme = t;
  // Color de la barra del navegador: las dos metas (claro/oscuro) apuntan al tema forzado, o cada una al suyo.
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    const dark = t === 'dark' || (t === 'system' && /dark/.test(m.getAttribute('media') ?? ''));
    m.setAttribute('content', dark ? '#0c0c0c' : '#ffffff');
  });
}
