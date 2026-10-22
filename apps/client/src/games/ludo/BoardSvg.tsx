import { LUDO_HOME, LUDO_START, type LudoState } from '@bureau/shared/games/ludo';
import { CAPTURE_MS } from './frames';
import { ludoFr } from './fr';
import {
  BOARD_CELLS,
  HOME_ANCHORS,
  HOME_TRIANGLES,
  LANE_CELLS,
  TRACK_CELLS,
  YARD_ORIGINS,
  YARD_SIZE,
  cellCenter,
  horseCenter,
  rotatePoint,
  yardSlot,
  type Cell,
  type Point,
} from './geometry';
import { HORSE_SIZE, horsePaths } from './horse-art';
import type { MoveOption } from './moves';
import { hitSizeFor, horseSizeFor } from './sizing';

// Le dessin du plateau : un SVG de 15 × 15 unités (une case = une unité), aux bords nets, où tout est dessiné en code (§ 9.5.6) : la piste, les allées, les écuries, l'arrivée et les
// chevaux. Les couleurs sont celles de l'illustration (ludo.css), le jour comme la nuit. Tout est dit pour « rouge en haut à gauche » (geometry.ts), puis tourné par quarts de tour (`turns`)
// pour que l'écurie de celui qui joue soit en bas à gauche ; le texte, lui, n'est jamais tourné.

// Ce que mesure le dessin, en cases (la taille d'une tête de cheval dépend de la case : sizing.ts).
const SLOT_RADIUS = 0.55;
const TARGET_RADIUS = 0.52;
const LAST_INSET = 0.06;
// Le nom du joueur, écrit dans son écurie sous son bord haut ; au-delà de 10 lettres, il est coupé.
const NAME_ROW = 0.85;
const NAME_MAX = 10;
// Le nombre de chevaux arrivés, écrit à côté du cheval du triangle, sur le côté (pas vers le centre : les quatre nombres s'y toucheraient) : les quatre tournent autour du centre,
// chacun dans son triangle, à cette distance du cheval.
const COUNT_OFFSET = 0.75;
const BOARD_CENTER: Point = { x: BOARD_CELLS / 2, y: BOARD_CELLS / 2 };
// Un cheval jouable est souligné (un trait sous lui) et numéroté (le numéro de son bouton, en haut à droite), à ces fractions de sa taille.
const UNDERLINE_GAP = 0.06;
const UNDERLINE_THICKNESS = 0.1;
const NUMBER_AT = { x: 0.45, y: -0.38 };

const PATHS = horsePaths();

// Le dessin d'une tête de cheval (12 × 12), mis à l'échelle pour faire `size` cases de côté, centré sur l'origine.
const spriteTransform = (size: number): string => `translate(${-size / 2} ${-size / 2}) scale(${size / HORSE_SIZE})`;

// Une tête de cheval, en pixel art : un chemin par lettre de la grille, que la feuille de style colore selon le joueur (`.ludo-tone-N .px-b`…).
function Sprite({ size }: { size: number }) {
  return (
    <g transform={spriteTransform(size)}>
      {PATHS.map(({ key, d }) => (
        <path key={key} className={`px-${key}`} d={d} />
      ))}
    </g>
  );
}

const shortName = (name: string): string => (name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1)}…` : name);

export interface BoardSvgProps {
  state: LudoState;
  // Les avancées que le plateau montre (l'animation les change case par case), par siège.
  horses: number[][];
  // Le cheval qui glisse jusqu'à son écurie (il vient d'être pris), ou null.
  sliding: { seat: number; horse: number } | null;
  // Le nom de chaque siège (il peut en manquer, dans l'aperçu).
  names: readonly string[];
  // Le siège dont l'écurie porte le cadre épais du trait, ou null : personne n'a le trait avant la partie (l'aperçu) ni après (elle est finie).
  turnSeat: number | null;
  // Les quarts de tour qui amènent l'écurie de celui qui regarde en bas à gauche.
  turns: number;
  // Le côté d'une case, en pixels.
  cell: number;
  // L'identifiant de « Position des chevaux », l'équivalent texte du plateau.
  describedBy: string;
  mySeat: number | null;
  // Les chevaux qu'un clic joue (ceux de `mySeat`, par numéro de cheval) : vide quand rien n'est cliquable.
  playable: ReadonlyMap<number, MoveOption>;
  onPick(option: MoveOption): void;
  // Le coup dont on montre la case d'arrivée (au survol, ou le focus d'un bouton), ou null.
  previewed: MoveOption | null;
  onPreview(horse: number | null): void;
}

export function BoardSvg({ state, horses, sliding, names, turnSeat, turns, cell, describedBy, mySeat, playable, onPick, previewed, onPreview }: BoardSvgProps) {
  const size = BOARD_CELLS;
  const turn = (point: Point): Point => rotatePoint(point, turns);
  // Le coin haut gauche d'une case, une fois le plateau tourné.
  const topLeft = (at: Cell): Point => {
    const center = turn(cellCenter(at));
    return { x: center.x - 0.5, y: center.y - 0.5 };
  };
  const seatOfColor = (color: number): number => state.colors.indexOf(color);
  const isOut = (seat: number): boolean => state.out.some((entry) => entry.seat === seat);
  const hit = hitSizeFor(cell);
  // La taille d'une tête de cheval, en cases.
  const horseSize = horseSizeFor(cell) / cell;

  const drawn = state.colors.flatMap((color, seat) =>
    isOut(seat) ? [] : (horses[seat] ?? []).flatMap((advance, index) => (advance >= LUDO_HOME ? [] : [{ seat, index, color, advance, option: seat === mySeat ? playable.get(index) : undefined }])),
  );
  // Les chevaux jouables sont dessinés par-dessus les autres, et celui qui glisse tout au-dessus.
  const isSliding = (seat: number, index: number): boolean => sliding?.seat === seat && sliding.horse === index;
  const order = [...drawn.filter((h) => !h.option && !isSliding(h.seat, h.index)), ...drawn.filter((h) => h.option && !isSliding(h.seat, h.index)), ...drawn.filter((h) => isSliding(h.seat, h.index))];

  const last = state.last;
  const lastColor = last ? state.colors[last.seat] : undefined;
  const lastAt = last && lastColor !== undefined && last.to < LUDO_HOME ? turn(horseCenter(lastColor, last.horse, last.to)) : null;
  const myColor = mySeat === null ? undefined : state.colors[mySeat];
  const targetAt = previewed && myColor !== undefined ? turn(horseCenter(myColor, previewed.horse, previewed.to)) : null;

  return (
    <svg className="ludo-board" role="img" aria-label={ludoFr.board.label} aria-describedby={describedBy} width={size * cell} height={size * cell} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges">
      <rect className="ludo-frame" x={0} y={0} width={size} height={size} />

      {YARD_ORIGINS.map(([col, row], color) => {
        const seat = seatOfColor(color);
        const used = seat !== -1;
        const gone = used && isOut(seat);
        const hasTurn = used && turnSeat === seat;
        const center = turn({ x: col + YARD_SIZE / 2, y: row + YARD_SIZE / 2 });
        const corner = { x: center.x - YARD_SIZE / 2, y: center.y - YARD_SIZE / 2 };
        return (
          <g key={color} className={`ludo-yard ludo-tone-${color}`} data-color={color} data-out={gone || undefined} data-unused={!used || undefined} data-turn={hasTurn || undefined}>
            <rect className="ludo-yard-bg" x={corner.x} y={corner.y} width={YARD_SIZE} height={YARD_SIZE} />
            {used &&
              !gone &&
              [0, 1, 2, 3].map((horse) => {
                const slot = turn(yardSlot(color, horse));
                return <circle key={horse} className="ludo-slot" cx={slot.x} cy={slot.y} r={SLOT_RADIUS} />;
              })}
            {used && names[seat] && (
              <text className="ludo-yard-name" x={center.x} y={corner.y + NAME_ROW} textAnchor="middle">
                {shortName(names[seat]!)}
              </text>
            )}
            {gone && (
              <text className="ludo-yard-out" x={center.x} y={center.y} textAnchor="middle" dominantBaseline="central">
                {ludoFr.board.yardOut}
              </text>
            )}
          </g>
        );
      })}

      {LANE_CELLS.map((lane, color) =>
        lane.map((at, k) => {
          const corner = topLeft(at);
          return <rect key={`${color}-${k}`} className={`ludo-lane ludo-tone-${color}`} x={corner.x} y={corner.y} width={1} height={1} />;
        }),
      )}

      {TRACK_CELLS.map((at, index) => {
        const corner = topLeft(at);
        const start = (LUDO_START as readonly number[]).indexOf(index);
        return <rect key={index} className={start === -1 ? 'ludo-cell' : `ludo-cell ludo-start ludo-tone-${start}`} data-cell={index} x={corner.x} y={corner.y} width={1} height={1} />;
      })}

      {HOME_TRIANGLES.map((triangle, color) => (
        <polygon
          key={color}
          className={`ludo-home ludo-tone-${color}`}
          data-color={color}
          points={triangle
            .map(turn)
            .map((point) => `${point.x},${point.y}`)
            .join(' ')}
        />
      ))}

      {state.colors.map((color, seat) => {
        const count = isOut(seat) ? 0 : (horses[seat] ?? []).filter((advance) => advance >= LUDO_HOME).length;
        if (count === 0) return null;
        const anchor = turn(HOME_ANCHORS[color]!);
        const toCenter = { x: BOARD_CENTER.x - anchor.x, y: BOARD_CENTER.y - anchor.y };
        const length = Math.hypot(toCenter.x, toCenter.y) || 1;
        // Un quart de tour de la direction du centre : le nombre est sur le côté du cheval, dans le triangle.
        const aside = { x: -toCenter.y / length, y: toCenter.x / length };
        const digit = { x: anchor.x + aside.x * COUNT_OFFSET, y: anchor.y + aside.y * COUNT_OFFSET };
        return (
          <g key={color} className={`ludo-arrived ludo-tone-${color}`} data-color={color} data-count={count}>
            <g transform={`translate(${anchor.x} ${anchor.y})`}>
              <Sprite size={horseSize} />
            </g>
            <text className="ludo-arrived-count" x={digit.x} y={digit.y} textAnchor="middle" dominantBaseline="central">
              {count}
            </text>
          </g>
        );
      })}

      {lastAt && <rect className="ludo-last" x={lastAt.x - 0.5 + LAST_INSET} y={lastAt.y - 0.5 + LAST_INSET} width={1 - 2 * LAST_INSET} height={1 - 2 * LAST_INSET} data-x={lastAt.x} data-y={lastAt.y} />}

      {order.map(({ seat, index, color, advance, option }) => {
        const at = turn(horseCenter(color, index, advance));
        const slides = isSliding(seat, index);
        return (
          <g
            key={`${seat}-${index}`}
            className={`ludo-horse ludo-tone-${color}`}
            data-seat={seat}
            data-horse={index}
            data-color={color}
            data-advance={advance}
            data-x={at.x}
            data-y={at.y}
            data-playable={option ? 'true' : undefined}
            data-sliding={slides ? 'true' : undefined}
            style={{ transform: `translate(${at.x}px, ${at.y}px)`, transitionDuration: slides ? `${CAPTURE_MS}ms` : undefined }}
          >
            <Sprite size={horseSize} />
            {option && (
              <rect className="ludo-underline" x={-horseSize / 2} y={horseSize / 2 + UNDERLINE_GAP} width={horseSize} height={UNDERLINE_THICKNESS} rx={UNDERLINE_THICKNESS / 2} />
            )}
            {option && (
              <text className="ludo-horse-number" x={horseSize * NUMBER_AT.x} y={horseSize * NUMBER_AT.y} textAnchor="middle" dominantBaseline="central">
                {index + 1}
              </text>
            )}
            {option && (
              <rect
                className="ludo-hit"
                x={-hit / 2}
                y={-hit / 2}
                width={hit}
                height={hit}
                onClick={() => onPick(option)}
                onMouseEnter={() => onPreview(index)}
                onMouseLeave={() => onPreview(null)}
              />
            )}
          </g>
        );
      })}

      {targetAt && previewed && <circle className="ludo-target" cx={targetAt.x} cy={targetAt.y} r={TARGET_RADIUS} data-horse={previewed.horse} data-capture={previewed.capture ? 'true' : undefined} />}
    </svg>
  );
}
