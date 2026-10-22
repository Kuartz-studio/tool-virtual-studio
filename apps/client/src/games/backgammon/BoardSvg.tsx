import { checkersAt, type BgPosition } from '@bureau/shared/games/backgammon';
import { useId, useMemo } from 'react';
import { Dice, type DiceProps } from './Dice';
import { barSlot, cellsOf, offDiscWidth, OFF_DISC, offSlot, offX, pointPlace, stackSlot, type BoardLayout, type Cell, type CellId } from './geometry';
import { discPixels, PALETTE, spriteRuns, type DiscPalette } from './sprites';

// Le dessin du tablier, en SVG et en pixel art (`shape-rendering="crispEdges"`, à l'échelle entière) : le cadre, les 24 flèches de deux tons, la barre, la zone de sortie, les piles
// de pions, ce qui s'éclaire (pions jouables, pion choisi, arrivées, pions que l'adversaire vient de déplacer) et les dés. Il ne décide de rien : tout vient de ses propriétés, et le
// SVG est caché aux lecteurs d'écran (chaque case est un bouton qui dit ce qu'elle porte).

export interface CellMarks {
  playable?: boolean;
  selected?: boolean;
  target?: boolean;
  moved?: boolean;
}

export interface BoardSvgProps {
  layout: BoardLayout;
  // Le siège de celui qui regarde : sa maison est en bas à droite, ses pions en bas de la barre.
  viewSeat: 0 | 1;
  position: BgPosition;
  marks: ReadonlyMap<CellId, CellMarks>;
  dice: DiceProps | null;
}

type Camp = 'white' | 'red';
const campOf = (seat: number): Camp => (seat === 0 ? 'white' : 'red');

function triangle(layout: BoardLayout, cell: Cell): string {
  const apex = cell.row === 'top' ? cell.y + layout.pointLength : cell.y;
  const base = cell.row === 'top' ? cell.y : cell.y + layout.pointLength;
  return `${cell.x},${base} ${cell.x + cell.width},${base} ${cell.x + cell.width / 2},${apex}`;
}

export function BoardSvg({ layout, viewSeat, position, marks, dice }: BoardSvgProps) {
  const id = useId();
  const cells = useMemo(() => cellsOf(layout), [layout]);
  const sprite = useMemo(() => spriteRuns(discPixels(layout.discArt)), [layout.discArt]);
  const art = layout.artPixel;
  const mineCamp = campOf(viewSeat);
  const theirCamp = campOf(1 - viewSeat);
  const spriteId = (camp: Camp): string => `${id}-${camp}`;
  const innerWidth = layout.width - 2 * layout.pad;
  const innerHeight = layout.height - 2 * layout.pad;

  // Une pile de pions de ce camp, du bord vers le milieu ; au-delà de ce qu'une pile montre, « +n » sur le dernier pion dessiné.
  function stack(camp: Camp, count: number, slot: (index: number) => { x: number; y: number }, key: string) {
    const shown = Math.min(count, layout.visibleStack);
    const half = layout.checker / 2;
    return (
      <g key={key} className="game-backgammon-stack" data-camp={camp} data-count={count}>
        {Array.from({ length: shown }, (_, index) => {
          const { x, y } = slot(index);
          return <use key={index} href={`#${spriteId(camp)}`} x={x - half} y={y - half} />;
        })}
        {count > shown && (
          <text className="game-backgammon-count" data-camp={camp} x={slot(shown - 1).x} y={slot(shown - 1).y} textAnchor="middle" dominantBaseline="central">
            +{count - shown}
          </text>
        )}
      </g>
    );
  }

  const points = cells.filter((cell) => cell.kind === 'point');
  const barCell = cells.find((cell) => cell.kind === 'bar');
  const offCell = cells.find((cell) => cell.kind === 'off');

  return (
    <svg className="game-backgammon-svg" width={layout.width} height={layout.stageHeight} viewBox={`0 0 ${layout.width} ${layout.stageHeight}`} aria-hidden="true" focusable="false" shapeRendering="crispEdges">
      <defs>
        {(['white', 'red'] as const).map((camp) => {
          const palette: DiscPalette = PALETTE[camp];
          return (
            <g key={camp} id={spriteId(camp)}>
              {sprite.map((run, index) => (
                <rect key={index} x={run.x * art} y={run.y * art} width={run.width * art} height={art} fill={palette[run.letter]} />
              ))}
            </g>
          );
        })}
      </defs>

      {/* Les numéros des points, dans la numérotation de celui qui regarde, en petit le long des bords (les deux bandes, au-dessus et au-dessous du tablier). */}
      {points.map((cell) => (
        <text
          key={cell.id}
          className="game-backgammon-number"
          x={cell.x + cell.width / 2}
          y={cell.row === 'top' ? layout.band / 2 : layout.stageHeight - layout.band / 2}
          textAnchor="middle"
          dominantBaseline="central"
        >
          {cell.point}
        </text>
      ))}

      <g transform={`translate(0 ${layout.band})`}>
      <rect className="game-backgammon-frame" x={0} y={0} width={layout.width} height={layout.height} />
      <rect className="game-backgammon-bed" x={layout.pad} y={layout.pad} width={innerWidth} height={innerHeight} />

      {points.map((cell) => {
        // Deux tons qui alternent d'une colonne à l'autre, et d'une rangée à l'autre dans une même colonne.
        const tone = (pointPlace(cell.point!).column + (cell.row === 'top' ? 0 : 1)) % 2 === 0 ? 'dark' : 'light';
        return <polygon key={cell.id} className="game-backgammon-point" data-tone={tone} points={triangle(layout, cell)} />;
      })}

      {barCell && <rect className="game-backgammon-bar" x={barCell.x} y={barCell.y} width={barCell.width} height={barCell.height} />}
      {offCell && (
        <g className="game-backgammon-trays">
          <rect className="game-backgammon-tray" x={offX(layout)} y={layout.pad} width={layout.off} height={offCell.y - layout.pad - 2} />
          <rect className="game-backgammon-tray" x={offCell.x} y={offCell.y} width={offCell.width} height={offCell.height} />
        </g>
      )}

      {/* Sous les pions : les arrivées et le point du pion choisi s'éclairent. */}
      {points.map((cell) => {
        const mark = marks.get(cell.id);
        if (!mark?.target && !mark?.selected) return null;
        return <polygon key={cell.id} className="game-backgammon-glow" data-kind={mark.selected ? 'selected' : 'target'} points={triangle(layout, cell)} />;
      })}
      {barCell && (marks.get('bar')?.selected || marks.get('bar')?.playable) && (
        <rect className="game-backgammon-glow" data-kind={marks.get('bar')?.selected ? 'selected' : 'playable'} x={barCell.x} y={barCell.y} width={barCell.width} height={barCell.height} />
      )}
      {offCell && marks.get('off')?.target && <rect className="game-backgammon-glow" data-kind="target" x={offCell.x} y={offCell.y} width={offCell.width} height={offCell.height} />}

      {points.map((cell) => {
        const { owner, count } = checkersAt(position, viewSeat, cell.point!);
        if (owner === null || count === 0) return null;
        return stack(campOf(owner), count, (index) => stackSlot(layout, cell, index), cell.id);
      })}

      {/* La barre : ses pions (en bas) et ceux de l'adversaire (en haut). */}
      {position.bar[viewSeat] > 0 && stack(mineCamp, position.bar[viewSeat], (index) => barSlot(layout, 'bottom', index), 'bar-mine')}
      {position.bar[1 - viewSeat] > 0 && stack(theirCamp, position.bar[1 - viewSeat], (index) => barSlot(layout, 'top', index), 'bar-theirs')}

      {/* La zone de sortie (disposition large) : les pions sortis, à plat, et leur nombre. */}
      {offCell &&
        ([
          { seat: viewSeat, side: 'bottom' as const },
          { seat: 1 - viewSeat, side: 'top' as const },
        ] as const).map(({ seat, side }) => {
          const count = position.off[seat];
          const palette = PALETTE[campOf(seat)];
          const width = offDiscWidth(layout);
          return (
            <g key={side} className="game-backgammon-off" data-camp={campOf(seat)} data-count={count}>
              {Array.from({ length: count }, (_, index) => {
                const { x, y } = offSlot(layout, side, index);
                return (
                  <g key={index}>
                    <rect x={x - width / 2} y={y - OFF_DISC.height / 2} width={width} height={OFF_DISC.height} fill={palette.o} />
                    <rect x={x - width / 2 + 1} y={y - OFF_DISC.height / 2 + 1} width={width - 2} height={OFF_DISC.height - 2} fill={palette.f} />
                  </g>
                );
              })}
              {count > 0 && (
                <text className="game-backgammon-offcount" x={offX(layout) + layout.off / 2} y={side === 'bottom' ? offSlot(layout, side, count).y - 4 : offSlot(layout, side, count).y + 4} textAnchor="middle" dominantBaseline="central">
                  {count}
                </text>
              )}
            </g>
          );
        })}

      {/* Une arrivée : un point d'ambre à la place du prochain pion (celui d'un pion adverse seul qui sera frappé, à sa place). */}
      {points.map((cell) => {
        if (!marks.get(cell.id)?.target) return null;
        const { owner, count } = checkersAt(position, viewSeat, cell.point!);
        const next = owner === viewSeat ? Math.min(count, layout.visibleStack - 1) : 0;
        const slot = stackSlot(layout, cell, next);
        return <circle key={cell.id} className="game-backgammon-dot" cx={slot.x} cy={slot.y} r={layout.checker / 2 - 4} />;
      })}

      {/* Au-dessus des pions : ce qu'on peut prendre (souligné), le pion choisi (cerclé), ce que l'adversaire vient de déplacer (souligné d'une autre couleur). */}
      {points.map((cell) => {
        const mark = marks.get(cell.id);
        if (!mark || (!mark.playable && !mark.selected && !mark.moved)) return null;
        const { count } = checkersAt(position, viewSeat, cell.point!);
        const shown = Math.min(Math.max(count, 1), layout.visibleStack);
        const outer = stackSlot(layout, cell, shown - 1);
        const edge = cell.row === 'top' ? outer.y + layout.checker / 2 + 2 : outer.y - layout.checker / 2 - 5;
        const lineWidth = layout.cell - 6;
        return (
          <g key={cell.id} className="game-backgammon-marks">
            {mark.selected && <circle className="game-backgammon-ring" cx={outer.x} cy={outer.y} r={layout.checker / 2 + 2} />}
            {mark.moved && <rect className="game-backgammon-underline" data-kind="moved" x={outer.x - lineWidth / 2} y={edge + (cell.row === 'top' ? 4 : -4)} width={lineWidth} height={3} />}
            {(mark.playable || mark.selected) && <rect className="game-backgammon-underline" data-kind="playable" x={outer.x - lineWidth / 2} y={edge} width={lineWidth} height={3} />}
          </g>
        );
      })}
      {offCell && marks.get('off')?.moved && <rect className="game-backgammon-underline" data-kind="moved" x={offCell.x + 4} y={offCell.y + offCell.height - 4} width={offCell.width - 8} height={3} />}

      {dice && <Dice {...dice} />}
      </g>
    </svg>
  );
}
