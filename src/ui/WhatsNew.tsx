import { useEffect, useRef } from 'preact/hooks';
import { tr } from '../i18n';
import { NEWS, type NewsItem } from './news';

/** Tarjeta de novedad al principio de la lista (en el flujo, sin tapar la cabecera). Ver abre la hoja; Cerrar la descarta (los gestiona App). */
export function NewsCard({ item, onOpen, onClose }: { item: NewsItem; onOpen: () => void; onClose: () => void }) {
  return (
    <section class="news-card" role="status" aria-label={tr('Novedades', 'What’s new')}>
      <div class="news-card-copy">
        <strong>{item.title()}</strong>
        <p>{item.text()}</p>
      </div>
      <div class="news-card-acts">
        <button class="link" onClick={onOpen} aria-label={tr('Ver novedades', 'See what’s new')}>{tr('Ver', 'View')}</button>
        <button class="link" onClick={onClose} aria-label={tr('Cerrar aviso de novedades', 'Close the news notice')}>{tr('Cerrar', 'Close')}</button>
      </div>
    </section>
  );
}

/** Hoja con todas las novedades. Esc o un clic fuera la cierran; el foco vuelve a donde estaba al cerrarla. */
export function NewsSheet({ onClose }: { onClose: () => void }) {
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
          {NEWS.map((item) => (
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
