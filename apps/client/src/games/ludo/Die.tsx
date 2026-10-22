import { ludoFr, t } from './fr';

// Le dé : un carré à points, dessiné en code (§ 9.5.6), en pixel art (des points carrés, des bords nets). Sa feuille de style (`ludo.css`) lui met ses couleurs.

// Le dessin est sur une grille de 10 × 10 ; un point est un carré de 2 sur 2.
const DIE_UNITS = 10;
const PIP = 2;
// Les points de chaque face, par le coin haut gauche de leur carré : trois colonnes (1, 4, 7) et trois rangées.
const NEAR = 1.5;
const MIDDLE = 4;
const FAR = 6.5;
const PIPS: Record<number, ReadonlyArray<readonly [number, number]>> = {
  1: [[MIDDLE, MIDDLE]],
  2: [[NEAR, NEAR], [FAR, FAR]],
  3: [[NEAR, NEAR], [MIDDLE, MIDDLE], [FAR, FAR]],
  4: [[NEAR, NEAR], [FAR, NEAR], [NEAR, FAR], [FAR, FAR]],
  5: [[NEAR, NEAR], [FAR, NEAR], [MIDDLE, MIDDLE], [NEAR, FAR], [FAR, FAR]],
  6: [[NEAR, NEAR], [FAR, NEAR], [NEAR, MIDDLE], [FAR, MIDDLE], [NEAR, FAR], [FAR, FAR]],
};

export interface DieProps {
  // La valeur du dernier lancer, ou null (pas encore lancé).
  value: number | null;
  rolling: boolean;
  // Pendant qu'il roule : la face montrée, au hasard.
  face: number | null;
}

export function Die({ value, rolling, face }: DieProps) {
  const shown = rolling ? face : value;
  const label = rolling ? ludoFr.die.rolling : value === null ? ludoFr.die.empty : t(ludoFr.die.label, { value });
  return (
    <svg className="ludo-die" role="img" aria-label={label} viewBox={`0 0 ${DIE_UNITS} ${DIE_UNITS}`} shapeRendering="crispEdges" data-value={value ?? undefined} data-rolling={rolling || undefined}>
      <rect className="ludo-die-body" x={0.5} y={0.5} width={DIE_UNITS - 1} height={DIE_UNITS - 1} rx={1.5} />
      {(shown === null ? [] : (PIPS[shown] ?? [])).map(([x, y]) => (
        <rect key={`${x}-${y}`} className="ludo-die-pip" x={x} y={y} width={PIP} height={PIP} />
      ))}
    </svg>
  );
}
