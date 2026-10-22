import { CONNECT4_COLUMNS, CONNECT4_ROWS, cellIndex, dropRow, lastDrop, type Connect4Event, type Connect4Move, type Connect4State } from '@bureau/shared/games/connect4';
import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from 'react';
import type { GameBoardProps } from '../types';
import { columnLabel, connect4Fr } from './fr';
import { DEFAULT_WIDTH, START_COLUMN, cellSize, digitColumn, nextColumn, screenRow, spriteScale } from './layout';
import { DISC_ROWS, SLOT_PALETTE, SPRITE_SIZE, TOKEN_PALETTES, spriteLayers, type PathLayer } from './sprites';

// Le plateau du Puissance 4 : sept colonnes, dont chacune est un seul bouton qui va du fantôme, au-dessus, jusqu'au fond ; six rangées de trous, dessinés en code (sprites.ts), derrière les jetons.
// Il se mesure sur son conteneur (ResizeObserver), jamais sur la fenêtre ; son clavier est celui d'un groupe à tabindex mobile (flèches, Début, Fin, Entrée, Espace, et les chiffres de 1 à 7) ;
// la chute d'un jeton et la pulsation de la ligne gagnante sont de la feuille de style, que le mouvement réduit coupe : le plateau ne mène lui-même aucune animation (§ 9.5 du document des jeux).

type Props = GameBoardProps<Connect4State, Connect4Move, Connect4Event>;
type Drop = Extract<Connect4Event, { type: 'drop' }>;

const LAYERS = {
  red: spriteLayers(DISC_ROWS, TOKEN_PALETTES.red),
  yellow: spriteLayers(DISC_ROWS, TOKEN_PALETTES.yellow),
  redLast: spriteLayers(DISC_ROWS, TOKEN_PALETTES.redLast),
  yellowLast: spriteLayers(DISC_ROWS, TOKEN_PALETTES.yellowLast),
  slot: spriteLayers(DISC_ROWS, SLOT_PALETTE),
};

// Un jeton ou un trou : un SVG de 13 pixels de côté, aux bords nets, posé à l'échelle entière (`size` = 13 × l'échelle). Décoratif : le nom de la colonne dit ce qu'elle contient.
function Sprite({ layers, size, className }: { layers: PathLayer[]; size: number; className: string }) {
  return (
    <svg className={className} viewBox={`0 0 ${SPRITE_SIZE} ${SPRITE_SIZE}`} width={size} height={size} shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      {layers.map((layer) => (
        <path key={layer.color} d={layer.d} fill={layer.color} />
      ))}
    </svg>
  );
}

// La largeur du conteneur du plateau, mesurée quand il est monté puis à chaque changement de sa taille. Avant la première mesure, ou là où on ne peut pas mesurer (pas de mise en page, pas
// de ResizeObserver), la largeur du panneau d'un ordinateur.
function useContainerWidth(element: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useLayoutEffect(() => {
    const target = element.current;
    if (!target) return;
    const measure = () => {
      const measured = target.getBoundingClientRect().width;
      if (measured > 0) setWidth(measured);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    return () => observer.disconnect();
  }, [element]);
  return width;
}

const isDrop = (event: Connect4Event): event is Drop => event.type === 'drop';

// Les sièges des jetons d'une colonne, de bas en haut.
function seatsInColumn(state: Connect4State, col: number): number[] {
  const seats: number[] = [];
  for (let row = 0; row < CONNECT4_ROWS; row++) {
    const piece = state.cells[cellIndex(col, row)];
    if (!piece) break;
    seats.push(piece - 1);
  }
  return seats;
}

// Une touche que le plateau prend : ni l'avatar (game/input.ts), ni la touche E, ni le zoom ne la voient.
function take(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

export function Board({ state, mySeat, events, canAct, onMove, reducedMotion, preview }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const [active, setActive] = useState(START_COLUMN);
  const width = useContainerWidth(root);

  const cell = cellSize(width);
  const size = SPRITE_SIZE * spriteScale(cell);
  // Le jeton est posé à un décalage entier dans sa case : le pixel art ne tombe jamais entre deux pixels de l'écran.
  const inset = Math.floor((cell - size) / 2);

  // On ne peut jouer que si la plateforme le dit, qu'on est assis (un spectateur n'a pas de siège), et que la partie n'est pas finie.
  const over = state.result !== null;
  const interactive = canAct && mySeat !== null && !over;
  const last = lastDrop(state);
  const winners = new Set(state.winLine);
  // Les jetons qui tombent : ceux des événements, sauf en mouvement réduit, où tout est posé tout de suite (et un saut d'état n'a aucun événement).
  const falling = reducedMotion ? [] : events.filter(isDrop);

  function play(col: number): void {
    if (!interactive || dropRow(state.cells, col) === -1) return;
    onMove({ col });
  }

  function focusColumn(col: number): void {
    setActive(col);
    buttons.current[col]?.focus();
  }

  // Les touches qu'un raccourci du navigateur ou du système porte (Ctrl, Alt, ⌘) ne sont pas pour le plateau.
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, col: number): void {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const target = nextColumn(col, event.key);
    if (target !== null) {
      take(event);
      focusColumn(target);
      return;
    }
    const digit = digitColumn(event);
    if (event.key === 'Enter' || event.key === ' ' || digit !== null) {
      take(event);
      // Une touche maintenue se répète : un seul jeton par appui.
      if (!event.repeat) play(event.key === 'Enter' || event.key === ' ' ? col : digit!);
    }
  }

  // Entrée et Espace sont aussi prises au relâchement : le navigateur en ferait sinon un clic de plus, et le coup partirait deux fois. Les flèches relâchées passent : l'avatar qui marchait s'arrête.
  function onKeyUp(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key === 'Enter' || event.key === ' ') take(event);
  }

  const style = { '--game-connect4-cell': `${cell}px`, '--game-connect4-inset': `${inset}px` } as CSSProperties;
  const mine = mySeat === 1 ? LAYERS.yellow : LAYERS.red;

  return (
    <div ref={root} className="game-connect4" data-preview={preview || undefined} data-over={over || undefined} style={style}>
      <div className="game-connect4-frame">
        <div className="game-connect4-plate" aria-hidden="true" />
        <div role="group" aria-label={connect4Fr.columns} className="game-connect4-columns">
          {Array.from({ length: CONNECT4_COLUMNS }, (_, col) => {
            const seats = seatsInColumn(state, col);
            const full = seats.length === CONNECT4_ROWS;
            const playable = interactive && !full;
            return (
              <button
                key={col}
                ref={(element) => {
                  buttons.current[col] = element;
                }}
                type="button"
                className="game-connect4-column"
                aria-label={columnLabel(col, seats, CONNECT4_ROWS - seats.length)}
                aria-disabled={!playable}
                tabIndex={col === active ? 0 : -1}
                data-col={col}
                data-sfx="none"
                onClick={() => play(col)}
                onFocus={() => setActive(col)}
                onKeyDown={(event) => onKeyDown(event, col)}
                onKeyUp={onKeyUp}
              >
                <span className="game-connect4-lane" aria-hidden="true">
                  {playable && (
                    <span className="game-connect4-ghost" data-seat={mySeat} aria-hidden="true">
                      <Sprite layers={mine} size={size} className="game-connect4-disc" />
                    </span>
                  )}
                </span>
                <span className="game-connect4-cells" aria-hidden="true">
                  {Array.from({ length: CONNECT4_ROWS }, (_, from) => {
                    // De haut en bas de l'écran : la rangée 5 de l'état d'abord.
                    const row = screenRow(from);
                    const piece = state.cells[cellIndex(col, row)] ?? 0;
                    const seat = piece - 1;
                    const isLast = last !== null && last.col === col && last.row === row;
                    const isWinning = winners.has(cellIndex(col, row));
                    const isFalling = piece !== 0 && falling.some((event) => event.col === col && event.row === row);
                    return (
                      <span key={row} className="game-connect4-cell" data-row={row}>
                        <Sprite layers={LAYERS.slot} size={size} className="game-connect4-slot" />
                        {piece !== 0 && (
                          <span
                            className="game-connect4-token"
                            data-col={col}
                            data-row={row}
                            data-seat={seat}
                            data-last={isLast || undefined}
                            data-win={isWinning || undefined}
                            data-dim={(winners.size > 0 && !isWinning) || undefined}
                            data-falling={isFalling || undefined}
                            style={isFalling ? ({ '--game-connect4-fall-rows': screenRow(row) + 1 } as CSSProperties) : undefined}
                          >
                            <Sprite layers={seat === 1 ? (isLast ? LAYERS.yellowLast : LAYERS.yellow) : isLast ? LAYERS.redLast : LAYERS.red} size={size} className="game-connect4-disc" />
                          </span>
                        )}
                      </span>
                    );
                  })}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
