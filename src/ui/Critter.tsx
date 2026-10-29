import { useEffect, useState } from 'preact/hooks';

export const CRITTER_DELAY = 60_000; // aparece al minuto de tener la app abierta
export const CRITTER_DURATION = 5_000; // entra a la carrera, pirueta y se va

// Cangrejo de píxeles, en el naranja de la app: '#' cuerpo, 'e' ojo.
// Cada capa mide 13 columnas y se dibuja en su fila (`row`); las que tienen dos poses se alternan con CSS.
const BODY = [
  '....#####....',
  '...##e#e##...',
  '..#########..',
  '...#######...',
];
const CLAWS_OPEN = ['#.#.......#.#', '###.......###', '.#.........#.'];
const CLAWS_SNAP = ['.##.......##.', '###.......###', '.#.........#.'];
const LEGS_A = ['...#.#.#.#...', '..#.#...#.#..'];
const LEGS_B = ['...#.#.#.#...', '...#.#.#.#...'];
const COLS = 13;
const ROWS = 7;
const PX = 5;

const Layer = ({ rows, row, cls }: { rows: string[]; row: number; cls: string }) => (
  <g class={cls}>
    {rows.flatMap((line, dy) => [...line].map((c, x) => c === '.' ? null : (
      <rect key={`${x},${dy}`} x={x} y={row + dy} width="1" height="1" class={c === 'e' ? 'critter-eye' : 'critter-px'} />
    )))}
  </g>
);

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
      <div class="critter-hop">
        <svg class="critter-body" width={COLS * PX} height={ROWS * PX} viewBox={`0 0 ${COLS} ${ROWS}`} shape-rendering="crispEdges">
          <Layer rows={BODY} row={1} cls="critter-torso" />
          <Layer rows={CLAWS_OPEN} row={0} cls="critter-claws-open" />
          <Layer rows={CLAWS_SNAP} row={0} cls="critter-claws-snap" />
          <Layer rows={LEGS_A} row={5} cls="critter-legs-a" />
          <Layer rows={LEGS_B} row={5} cls="critter-legs-b" />
        </svg>
      </div>
    </div>
  );
}
