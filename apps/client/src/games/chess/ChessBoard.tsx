import { checkedKing, chess, type ChessEvent, type ChessMove, type ChessState, type PieceType, type Promotion, type Square } from '@bureau/shared/games/chess';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from 'react';
import type { GameBoardProps } from '../types';
import { chessFr, type PieceColor } from './fr';
import { boardFromFen, materialFromFen, moveRows, type BoardPiece } from './notation';
import { PieceArt } from './PieceArt';
import { SPRITE_SIZE } from './pieces';

// L'échiquier : une grille de soixante-quatre boutons (§ 9.5 du document des jeux, § 13.6). On clique une de ses pièces, ses cases d'arrivée s'allument, on clique l'une d'elles ; au clavier, les
// flèches parcourent la grille, Entrée choisit, Échap annule. Il ne joue jamais de lui-même : un coup part par `onMove`, et seulement quand la plateforme dit que c'est à soi (`canAct`).

// La largeur qu'on suppose quand on ne peut pas mesurer (pas de ResizeObserver, pas de mise en page : les tests) : celle du panneau des jeux sur un ordinateur (408 px de contenu).
export const DEFAULT_WIDTH = 408;
// La plus petite case : une cible d'au moins 24 px (WCAG 2.5.8).
export const MIN_CELL = 24;
// L'air qu'on laisse autour d'une pièce dans sa case, en pixels : la pièce prend la plus grande échelle entière qui y tient.
const PIECE_MARGIN = 2;
// L'échelle des pièces des bandes de pièces prises.
const CAPTURED_SCALE = 1;
// Sous cette largeur d'écran, le panneau est la feuille du bas d'un téléphone : la liste des coups y est repliée (la place est comptée).
const PHONE_MEDIA = '(max-width: 719px)';
const FILES = 'abcdefgh';
const PROMOTIONS: readonly Promotion[] = ['q', 'r', 'b', 'n'];

// La taille des cases (entière : le pixel art ne se coupe pas) et l'échelle des pièces, pour la largeur dont le plateau dispose.
export function layoutFor(width: number): { cell: number; scale: number } {
  const cell = Math.max(MIN_CELL, Math.floor(width / 8));
  return { cell, scale: Math.max(1, Math.floor((cell - PIECE_MARGIN) / SPRITE_SIZE)) };
}

// La largeur du conteneur, tenue à jour (ResizeObserver) : le plateau se mesure sur lui, jamais sur la fenêtre (§ 9.5.1).
function useContainerWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const measure = (value: number) => {
      if (value > 0) setWidth(value);
    };
    measure(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => measure(entries[0]?.contentRect.width ?? 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

const isPhone = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia(PHONE_MEDIA).matches;

// Où une case tombe à l'écran : colonne et rangée, de 0 à 7 depuis le coin en haut à gauche. Le camp d'en bas est lu du côté de ses pièces : les Blancs ont a1 en bas à gauche, les Noirs h8.
function screenOf(square: Square, bottom: PieceColor): { col: number; row: number } {
  const file = FILES.indexOf(square[0]!);
  const rank = Number(square[1]) - 1;
  return bottom === 'w' ? { col: file, row: 7 - rank } : { col: 7 - file, row: rank };
}
function squareAt(col: number, row: number, bottom: PieceColor): Square {
  const file = bottom === 'w' ? col : 7 - col;
  const rank = bottom === 'w' ? 7 - row : row;
  return `${FILES[file]}${rank + 1}` as Square;
}

// Un glissement : de combien de cases (à l'écran) la pièce part de sa case de départ, vers celle d'arrivée où elle est maintenant.
interface Slide {
  dx: number;
  dy: number;
}

// Les pièces qui viennent de bouger, d'après le dernier coup de ce lot d'événements : celle qui joue, et la tour d'un roque.
function slidesOf(events: readonly ChessEvent[], bottom: PieceColor): Map<Square, Slide> {
  const slides = new Map<Square, Slide>();
  let move: Extract<ChessEvent, { type: 'move' }> | undefined;
  for (const event of events) if (event.type === 'move') move = event;
  if (!move) return slides;
  const slide = (from: Square, to: Square) => {
    const a = screenOf(from, bottom);
    const b = screenOf(to, bottom);
    slides.set(to, { dx: a.col - b.col, dy: a.row - b.row });
  };
  const { ply } = move;
  slide(ply.from, ply.to);
  if (ply.castle) {
    const rank = ply.to[1];
    slide(`${ply.castle === 'k' ? 'h' : 'a'}${rank}` as Square, `${ply.castle === 'k' ? 'f' : 'd'}${rank}` as Square);
  }
  return slides;
}

// Les coups légaux de celui qui joue, rangés par case de départ.
function groupByFrom(moves: readonly ChessMove[]): Map<Square, ChessMove[]> {
  const grouped = new Map<Square, ChessMove[]>();
  for (const move of moves) grouped.set(move.from, [...(grouped.get(move.from) ?? []), move]);
  return grouped;
}

const NO_MOVES: Map<Square, ChessMove[]> = new Map();

export function ChessBoard({ state, mySeat, players, events, canAct, onMove, reducedMotion, preview }: GameBoardProps<ChessState, ChessMove, ChessEvent>) {
  const root = useRef<HTMLDivElement>(null);
  const squares = useRef(new Map<Square, HTMLButtonElement>());
  const width = useContainerWidth(root);
  const { cell, scale } = layoutFor(width);

  // Le camp d'en bas : le sien, ou les Blancs pour qui regarde. Un siège n'est pas une couleur : c'est l'état qui dit qui a les Blancs.
  const myColor: PieceColor | null = mySeat === null ? null : mySeat === state.white ? 'w' : 'b';
  const bottom: PieceColor = myColor ?? 'w';
  const interactive = canAct && myColor !== null && !preview && state.result === null;

  const pieces = useMemo(() => boardFromFen(state.fen), [state.fen]);
  const legal = useMemo(() => (interactive && mySeat !== null ? groupByFrom(chess.legalMoves(state, mySeat)) : NO_MOVES), [interactive, mySeat, state]);
  const material = useMemo(() => materialFromFen(state.fen), [state.fen]);
  const checkSquare = useMemo(() => checkedKing(state.fen), [state.fen]);
  const lastPly = state.plies.at(-1);

  // La sélection et le choix de promotion appartiennent à la position où ils ont été faits : un nouveau coup de la partie les rend caducs, sans effet pour les défaire.
  const [pick, setPick] = useState<{ fen: string; from: Square } | null>(null);
  const [asking, setAsking] = useState<{ fen: string; from: Square; to: Square } | null>(null);
  const selected = interactive && pick?.fen === state.fen ? pick.from : null;
  const promoting = interactive && asking?.fen === state.fen ? asking : null;

  // La case que le clavier occupe (tabindex mobile) : celle où il est allé, sinon l'arrivée du dernier coup, sinon le roi de son camp.
  const [cursor, setCursor] = useState<Square | null>(null);
  const current = cursor ?? lastPly?.to ?? (bottom === 'w' ? 'e1' : 'e8');

  const hints = useMemo(() => {
    const found = new Map<Square, 'move' | 'capture'>();
    if (selected === null) return found;
    const mover = pieces.get(selected);
    for (const move of legal.get(selected) ?? []) {
      // Une prise : une pièce sur la case d'arrivée, ou, pour un pion qui change de colonne sur une case vide, la prise en passant.
      const takes = pieces.has(move.to) || (mover?.type === 'p' && move.from[0] !== move.to[0]);
      found.set(move.to, takes ? 'capture' : 'move');
    }
    return found;
  }, [legal, pieces, selected]);

  const slides = useMemo(() => (reducedMotion ? new Map<Square, Slide>() : slidesOf(events, bottom)), [events, reducedMotion, bottom]);

  function focusSquare(square: Square) {
    setCursor(square);
    squares.current.get(square)?.focus();
  }

  // Un clic, ou Entrée et Espace, sur une case.
  function activate(square: Square) {
    setCursor(square);
    if (asking) setAsking(null);
    if (!interactive) return;
    if (selected !== null) {
      const options = (legal.get(selected) ?? []).filter((move) => move.to === square);
      if (options.length > 0) {
        // Un pion qui arrive au bout : les quatre pièces sont des coups à part, on demande laquelle avant d'envoyer quoi que ce soit.
        if (options[0]!.promotion !== undefined) {
          setAsking({ fen: state.fen, from: selected, to: square });
          return;
        }
        setPick(null);
        onMove({ from: selected, to: square });
        return;
      }
      if (square === selected) {
        setPick(null);
        return;
      }
    }
    const piece = pieces.get(square);
    setPick(piece && piece.color === myColor ? { fen: state.fen, from: square } : null);
  }

  function choose(promotion: Promotion) {
    if (!promoting) return;
    setAsking(null);
    setPick(null);
    onMove({ from: promoting.from, to: promoting.to, promotion });
  }

  function cancelChoice() {
    if (!promoting) return;
    setAsking(null);
    focusSquare(promoting.to);
  }

  // Le clavier de la grille (APG, motif « grid ») : les flèches suivent l'écran, Début et Fin vont aux bouts de la rangée, Entrée et Espace agissent, Échap annule. Toute touche prise reçoit
  // preventDefault et stopPropagation : l'avatar (flèches, ZQSD), la touche E et le zoom l'ignorent alors. Celles qu'on n'utilise pas, et Échap sans rien à annuler, passent.
  function onGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-square]');
    if (!target) return;
    const square = target.dataset.square as Square;
    const { col, row } = screenOf(square, bottom);
    const go = (nextCol: number, nextRow: number) => focusSquare(squareAt(Math.min(7, Math.max(0, nextCol)), Math.min(7, Math.max(0, nextRow)), bottom));
    switch (event.key) {
      case 'ArrowUp':
        go(col, row - 1);
        break;
      case 'ArrowDown':
        go(col, row + 1);
        break;
      case 'ArrowLeft':
        go(col - 1, row);
        break;
      case 'ArrowRight':
        go(col + 1, row);
        break;
      case 'Home':
        go(0, row);
        break;
      case 'End':
        go(7, row);
        break;
      case 'Enter':
      case ' ':
        activate(square);
        break;
      case 'Escape':
        if (selected === null) return;
        setPick(null);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  // Espace agit à l'enfoncement : on l'arrête aussi au relâchement, que certains navigateurs transforment en un clic de plus.
  function onGridKeyUp(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== ' ' || event.ctrlKey || event.altKey || event.metaKey) return;
    event.preventDefault();
    event.stopPropagation();
  }

  const rows = Array.from({ length: 8 }, (_, row) => row);
  const cols = rows;
  const nameOf = (color: PieceColor): string => players[color === 'w' ? state.white : 1 - state.white]?.name ?? chessFr.seats[color].name;
  const top: PieceColor = bottom === 'w' ? 'b' : 'w';

  return (
    <div
      ref={root}
      className="game-chess"
      data-orientation={bottom}
      data-preview={preview ? 'true' : undefined}
      data-interactive={interactive ? 'true' : undefined}
      style={{ '--chess-cell': `${cell}px` } as CSSProperties}
    >
      <CapturedStrip side="top" color={top} name={nameOf(top)} captured={material.captured[top]} advantage={top === 'w' ? material.advantage : -material.advantage} />
      <div className="game-chess-board-wrap">
        <div role="grid" aria-label={chessFr.board} aria-rowcount={8} aria-colcount={8} aria-readonly={interactive ? undefined : true} className="game-chess-board" onKeyDown={onGridKeyDown} onKeyUp={onGridKeyUp}>
          {rows.map((row) => (
            <div key={row} role="row" className="game-chess-row">
              {cols.map((col) => {
                const square = squareAt(col, row, bottom);
                const piece = pieces.get(square);
                const hint = hints.get(square);
                const isLast = lastPly !== undefined && (lastPly.from === square || lastPly.to === square);
                const isCheck = checkSquare === square;
                const isSelected = selected === square;
                const slide = slides.get(square);
                const label = chessFr.square(square, piece ? chessFr.piece(piece.type, piece.color) : chessFr.empty, [
                  ...(isSelected ? [chessFr.states.selected] : []),
                  ...(hint ? [chessFr.states[hint]] : []),
                  ...(isLast ? [chessFr.states.last] : []),
                  ...(isCheck ? [chessFr.states.check] : []),
                ]);
                return (
                  <div key={square} role="gridcell" className="game-chess-cell">
                    <button
                      ref={(element) => {
                        if (element) squares.current.set(square, element);
                        else squares.current.delete(square);
                      }}
                      type="button"
                      className="game-chess-square"
                      data-square={square}
                      data-shade={(FILES.indexOf(square[0]!) + Number(square[1])) % 2 === 0 ? 'light' : 'dark'}
                      data-piece={piece ? `${piece.color}${piece.type}` : undefined}
                      data-selected={isSelected ? 'true' : undefined}
                      data-hint={hint}
                      data-last={isLast ? 'true' : undefined}
                      data-check={isCheck ? 'true' : undefined}
                      data-sfx="none"
                      aria-label={label}
                      tabIndex={square === current ? 0 : -1}
                      onClick={() => activate(square)}
                      onFocus={() => setCursor(square)}
                    >
                      {row === 7 && (
                        <span className="game-chess-coord" data-coord="file" aria-hidden="true">
                          {square[0]}
                        </span>
                      )}
                      {col === 0 && (
                        <span className="game-chess-coord" data-coord="rank" aria-hidden="true">
                          {square[1]}
                        </span>
                      )}
                      {hint && <span className="game-chess-hint" aria-hidden="true" />}
                      {piece && <Piece piece={piece} scale={scale} slide={slide} turn={state.plies.length} />}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {promoting && <PromotionChoice color={bottom} onChoose={choose} onCancel={cancelChoice} />}
      </div>
      <CapturedStrip side="bottom" color={bottom} name={nameOf(bottom)} captured={material.captured[bottom]} advantage={bottom === 'w' ? material.advantage : -material.advantage} />
      <MoveList state={state} />
    </div>
  );
}

// Une pièce dans sa case. Celle qui vient de jouer glisse de sa case de départ (une animation de la feuille, lancée par `data-slide` ; sans mouvement réduit seulement) : la clé change à chaque
// demi-coup, pour que le navigateur la relance même quand la même sorte de pièce occupe déjà la case.
function Piece({ piece, scale, slide, turn }: { piece: BoardPiece; scale: number; slide: Slide | undefined; turn: number }) {
  return (
    <span
      key={slide ? `slide-${turn}` : 'still'}
      className="game-chess-piece"
      data-slide={slide ? '' : undefined}
      style={slide ? ({ '--chess-slide-x': slide.dx, '--chess-slide-y': slide.dy } as CSSProperties) : undefined}
    >
      <PieceArt type={piece.type} color={piece.color} scale={scale} />
    </span>
  );
}

// Les pièces qu'un camp a prises, et, s'il mène, son avance de points. Les pièces sont de la couleur de ceux qui les ont perdues.
function CapturedStrip({ side, color, name, captured, advantage }: { side: 'top' | 'bottom'; color: PieceColor; name: string; captured: PieceType[]; advantage: number }) {
  const lost: PieceColor = color === 'w' ? 'b' : 'w';
  const counts = captured.reduce<Array<{ type: PieceType; count: number }>>((found, type) => {
    const last = found.at(-1);
    if (last?.type === type) last.count++;
    else found.push({ type, count: 1 });
    return found;
  }, []);
  const spoken = counts.length === 0 ? chessFr.captured.none : chessFr.captured.list(counts);
  return (
    <div role="group" aria-label={chessFr.captured.label(name)} className="game-chess-captured" data-side={side} data-color={color}>
      <span className="game-chess-captured-pieces" aria-hidden="true">
        {captured.map((type, index) => (
          <PieceArt key={`${type}-${index}`} type={type} color={lost} scale={CAPTURED_SCALE} />
        ))}
      </span>
      {advantage > 0 && (
        <span className="game-chess-advantage" aria-hidden="true">
          {chessFr.captured.plus(advantage)}
        </span>
      )}
      <span className="visually-hidden">
        {spoken}
        {advantage > 0 ? `, ${chessFr.captured.advantage(advantage)}` : ''}
      </span>
    </div>
  );
}

// Le choix de la pièce d'une promotion : quatre boutons, le focus sur la dame, Échap pour renoncer, les flèches pour passer de l'un à l'autre. Aucune touche n'en sort (ni vers le panneau, que Échap
// fermerait, ni vers l'avatar), comme dans la confirmation d'un abandon.
function PromotionChoice({ color, onChoose, onCancel }: { color: PieceColor; onChoose(promotion: Promotion): void; onCancel(): void }) {
  const titleId = useId();
  const options = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    options.current[0]?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    const at = options.current.findIndex((button) => button === document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      options.current[Math.min(PROMOTIONS.length - 1, Math.max(0, at + (event.key === 'ArrowRight' ? 1 : -1)))]?.focus();
    } else if (event.key === 'Tab') {
      // Le focus boucle entre les quatre pièces.
      event.preventDefault();
      options.current[(at + (event.shiftKey ? -1 : 1) + PROMOTIONS.length) % PROMOTIONS.length]?.focus();
    }
  }

  return (
    <div role="dialog" aria-labelledby={titleId} className="game-chess-promotion" onKeyDown={onKeyDown}>
      <p id={titleId} className="game-chess-promotion-title">
        {chessFr.promotion.title}
      </p>
      <div className="game-chess-promotion-options">
        {PROMOTIONS.map((promotion, index) => (
          <button
            key={promotion}
            ref={(element) => {
              options.current[index] = element;
            }}
            type="button"
            className="game-chess-promotion-option"
            data-sfx="none"
            onClick={() => onChoose(promotion)}
          >
            <PieceArt type={promotion} color={color} scale={2} />
            <span>{chessFr.promotion.options[promotion]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// La liste des coups, repliable : numérotée, en deux colonnes (Blancs, Noirs), en notation française, le dernier coup en évidence. Repliée d'emblée sur téléphone. Rien à lister avant le premier coup.
function MoveList({ state }: { state: ChessState }) {
  const rows = useMemo(() => moveRows(state), [state]);
  const [open, setOpen] = useState(() => !isPhone());
  const listId = useId();
  const list = useRef<HTMLOListElement>(null);

  // Le dernier coup reste en vue : la liste défile jusqu'en bas à chaque coup, d'un coup (jamais animé).
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [state.plies.length, open]);

  if (rows.length === 0) return null;
  return (
    <div className="game-chess-moves-wrap">
      <button type="button" className="bar-button game-chess-moves-toggle" data-sfx="none" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(!open)}>
        {chessFr.moves.toggle} <span className="game-chess-moves-count">({state.plies.length})</span>
      </button>
      {open && (
        <ol id={listId} ref={list} className="game-chess-moves" aria-label={chessFr.moves.list} tabIndex={0}>
          {rows.map((row) => (
            <li key={row.number} className="game-chess-move" data-move={row.number}>
              <span className="game-chess-move-number">{row.number}.</span>
              {row.white ? (
                <span className="game-chess-ply" aria-current={row.white.last ? 'true' : undefined}>
                  {row.white.text}
                </span>
              ) : (
                <span className="game-chess-ply" aria-hidden="true">
                  …
                </span>
              )}
              {row.black && (
                <span className="game-chess-ply" aria-current={row.black.last ? 'true' : undefined}>
                  {row.black.text}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
