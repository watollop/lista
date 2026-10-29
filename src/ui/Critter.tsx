import { useEffect, useState } from 'preact/hooks';

export const CRITTER_DELAY = 60_000; // aparece al minuto de tener la app abierta
export const CRITTER_DURATION = 5_000; // entra, pirueta y se va

// Bicho de píxeles (guiño al icono de Claude Code): '#' cuerpo, 'e' ojo.
const SPRITE = [
  '..#######..',
  '..#e###e#..',
  '###########',
  '###########',
  '..#######..',
  '..#.#.#.#..',
];
const PX = 5;

export function Critter({ enabled }: { enabled: boolean }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const start = setTimeout(() => setShow(true), CRITTER_DELAY);
    return () => clearTimeout(start);
  }, [enabled]);

  useEffect(() => {
    if (!show) return;
    const end = setTimeout(() => setShow(false), CRITTER_DURATION);
    return () => clearTimeout(end);
  }, [show]);

  if (!show || !enabled) return null;
  return (
    <div class="critter" aria-hidden="true">
      <svg class="critter-body" width={SPRITE[0].length * PX} height={SPRITE.length * PX}
        viewBox={`0 0 ${SPRITE[0].length} ${SPRITE.length}`} shape-rendering="crispEdges">
        {SPRITE.flatMap((row, y) => [...row].map((c, x) => c === '.' ? null : (
          <rect key={`${x},${y}`} x={x} y={y} width="1" height="1" class={c === 'e' ? 'critter-eye' : 'critter-px'} />
        )))}
      </svg>
    </div>
  );
}
