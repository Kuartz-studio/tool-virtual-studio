import { seededRng } from '@bureau/shared';
import { chess, stateFromFen, type ChessEvent, type ChessMove, type ChessState, type Promotion, type Square } from '@bureau/shared/games/chess';
import { screen } from '@testing-library/react';
import { vi } from 'vitest';
import type { GameBoardProps, GamePlayerView } from '../types';

// Ce qu'il faut aux tests de l'interface des échecs : des états faits par le vrai moteur, les événements de leur dernier coup, des joueurs, les propriétés d'un plateau, et la case
// d'un échiquier retrouvée par son nom. Rien ici n'est joué à la main : un coup refusé par les règles lève.

const rng = seededRng(1);

export const ALICE: GamePlayerView = { userId: 'alice', name: 'Alice', avatarKey: null, connected: true };
export const BASTIEN: GamePlayerView = { userId: 'bastien', name: 'Bastien', avatarKey: null, connected: true };

// « e2e4 » → { from: 'e2', to: 'e4' } ; « a7a8q » → avec la promotion.
export function moveOf(text: string): ChessMove {
  const move: ChessMove = { from: text.slice(0, 2) as Square, to: text.slice(2, 4) as Square };
  if (text.length === 5) move.promotion = text[4] as Promotion;
  return move;
}

// La partie du début : les Blancs sont au siège `white`.
export function startState(white = 0): ChessState {
  return chess.create({ seats: 2, first: white }, rng).state;
}

// Une position posée à la main : son FEN, et le siège des Blancs.
export const fromFen = (fen: string, white = 0): ChessState => stateFromFen(fen, white);

// Joue ces coups (« e2e4 e7e5 ») depuis cet état, chacun par celui qui a le trait. Rend l'état final et les événements du dernier coup (ceux que la plateforme donnerait au plateau).
export function play(state: ChessState, moves: string): { state: ChessState; events: ChessEvent[] } {
  let current = state;
  let events: ChessEvent[] = [];
  for (const word of moves.split(/\s+/).filter(Boolean)) {
    const seat = chess.turn(current);
    if (seat === null) throw new Error(`la partie est finie avant ${word}`);
    const out = chess.apply(current, seat, moveOf(word), rng);
    if (!out.ok) throw new Error(`coup refusé : ${word} (${out.error}) dans ${current.fen}`);
    current = out.state;
    events = out.events;
  }
  return { state: current, events };
}

// Les propriétés d'un plateau, celles de la plateforme : moi, au siège 0, à qui c'est de jouer, sans événement.
export function boardProps(over: Partial<GameBoardProps<ChessState, ChessMove, ChessEvent>> = {}): GameBoardProps<ChessState, ChessMove, ChessEvent> {
  return { state: startState(), mySeat: 0, players: [ALICE, BASTIEN], events: [], canAct: true, onMove: vi.fn(), reducedMotion: false, preview: false, ...over };
}

// Le bouton d'une case, retrouvé par la case que dit son nom (« e4, pion blanc, … »).
export function square(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name: new RegExp(`^${name},`) }) as HTMLButtonElement;
}

// Les cases dans l'ordre où l'écran les montre : de haut en bas, de gauche à droite.
export function squaresOnScreen(): string[] {
  return screen.getAllByRole('button').flatMap((button) => (button.hasAttribute('data-square') ? [button.getAttribute('data-square')!] : []));
}
