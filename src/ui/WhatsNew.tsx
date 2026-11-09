import { useEffect, useRef } from 'preact/hooks';
import { tr } from '../i18n';
import { NEWS, type NewsItem } from './news';

/**
 * Hoja de novedades: las no vistas al entrar (App) o todas desde Ajustes. Esc o un clic fuera la cierran; el foco
 * vuelve a donde estaba al cerrarla.
 */
export function NewsSheet({ items = NEWS, onClose }: { items?: NewsItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // Guardamos el último onClose para que el efecto (que solo corre al abrir) no use uno viejo.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); }
    };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
      prev?.focus?.();
    };
  }, []);

  const title = tr('Novedades', 'What’s new');
  return (
    <div class="dialog-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="dialog news-sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <span class="label">{title}</span>
        <div class="news-list">
          {items.map((item) => (
            <article class="news-item" key={item.id}>
              <h3>{item.title()}</h3>
              <p>{item.text()}</p>
            </article>
          ))}
        </div>
        <div class="row-btns"><button class="btn" onClick={onClose}>{tr('Listo', 'Done')}</button></div>
      </div>
    </div>
  );
}
