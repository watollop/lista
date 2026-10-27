import type { Priority } from '../types';

export const PRIORITY_LABEL: Record<Priority, string> = { 1: 'Alta', 2: 'Media', 3: 'Baja' };

/** Icono de prioridad: ⇈ alta, ↑ media, ↓ baja. Trazo fino en currentColor. */
export function PriorityIcon({ p }: { p: Priority }) {
  return (
    <svg class="prio-icon" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"
      fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
      {p === 1 && <path d="M3.5 10.5V1.8M1.5 3.8l2-2 2 2M8.5 10.5V1.8M6.5 3.8l2-2 2 2" />}
      {p === 2 && <path d="M6 10.5V1.8M3 4.8l3-3 3 3" />}
      {p === 3 && <path d="M6 1.5v8.7M3 7.2l3 3 3-3" />}
    </svg>
  );
}

/** Icono y nombre, para menús y filtros. */
export function PriorityName({ p }: { p: Priority }) {
  return <><PriorityIcon p={p} /> {PRIORITY_LABEL[p]}</>;
}
