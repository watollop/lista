// Icono de lista compartida: módulo aparte y diminuto, porque lo usan la cabecera, la barra y la hoja de listas,
// mientras que los diálogos de compartir (Share.tsx) se cargan solo al abrirlos.
/** Icono de lista compartida (dos personas). Con title se anuncia; sin él es decorativo. */
export function PeopleIcon({ title }: { title?: string }) {
  return (
    <svg class="shared-ico" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2"
      {...(title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': 'true' })}>
      {title && <title>{title}</title>}
      <circle cx="6" cy="5.5" r="2.2" />
      <path d="M2 13c.4-2.3 2-3.6 4-3.6s3.6 1.3 4 3.6" />
      <circle cx="11.2" cy="6.2" r="1.7" />
      <path d="M11.2 9.6c1.5 0 2.6 1 2.9 2.7" />
    </svg>
  );
}
