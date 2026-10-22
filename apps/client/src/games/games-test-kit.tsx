import { seededRng, type AnyGameDefinition, type GameId, type GameInvite, type GameMatchView, type GameTableView, type PublicPlayer } from '@bureau/shared';
import { makeTicTacToe, type TicTacToeEvent, type TicTacToeMove, type TicTacToeState } from '@bureau/shared/games/testing';
import { act } from '@testing-library/react';
import { useOfficeStore } from '../state/office-store';
import type { GameBoardProps, GameUi } from './types';

// Ce qu'il faut aux tests des composants de jeu (GameLobby, Ladder, GameFrame, GamePanel, les toasts) : un monde minimal au magasin, des tables et des parties à la main, et un faux jeu
// complet (le morpion, avec un plateau de neuf boutons) à la place des vrais, qui n'existent pas encore au registre.

export const SELF = 'moi';
export const BASTIEN = 'bastien';
export const CLAIRE = 'claire';

export const tictactoe = makeTicTacToe('connect4', { drawOffers: true });

export const player = (id: string, over: Partial<PublicPlayer> = {}): PublicPlayer => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  avatarKey: null,
  x: 0,
  y: 0,
  dir: 'down',
  moving: false,
  status: 'available',
  media: { mic: false, cam: false, screen: false },
  ...over,
});

export const table = (game: GameId, version: number, over: Partial<GameTableView> = {}): GameTableView => ({ game, version, chairs: [null, null], spectators: [], match: null, ...over });

export const chair = (userId: string, over: { ready?: boolean; connected?: boolean } = {}) => ({ userId, name: userId[0]!.toUpperCase() + userId.slice(1), avatarKey: null, ready: false, connected: true, ...over });

export function match(userIds: string[], state: TicTacToeState | unknown, over: Partial<GameMatchView> = {}): GameMatchView {
  return {
    id: 'm1',
    status: 'playing',
    players: userIds.map((userId) => ({ userId, name: userId[0]!.toUpperCase() + userId.slice(1), avatarKey: null, connected: true, reconnectMs: null })),
    first: 0,
    state,
    events: [],
    turnMs: 300_000,
    drawOffer: null,
    startedAt: 0,
    result: null,
    ranked: null,
    ratings: null,
    ...over,
  };
}

// Le morpion de départ, et après ces coups (les cases, en alternant).
export function morpion(cells: number[] = [], first = 0): TicTacToeState {
  let { state } = tictactoe.create({ seats: 2, first }, seededRng(1));
  for (const cell of cells) {
    const result = tictactoe.apply(state, tictactoe.turn(state)!, { cell }, seededRng(1));
    if (!result.ok) throw new Error(`coup refusé : ${cell}`);
    state = result.state;
  }
  return state;
}

// Le plateau du faux jeu : neuf boutons, qui jouent leur case quand c'est à soi ; il dit « aperçu » avant la première partie. Un clic joue `{ cell }`.
function Board({ state, canAct, onMove, preview, events }: GameBoardProps<TicTacToeState, TicTacToeMove, TicTacToeEvent>) {
  return (
    <div role="grid" aria-label="Plateau de morpion" data-preview={preview || undefined} data-events={events.length}>
      {state.cells.map((cell, index) => (
        <button key={index} type="button" data-sfx="none" aria-label={`case ${index + 1}`} disabled={!canAct || cell !== null} onClick={() => onMove({ cell: index })}>
          {cell === null ? '' : cell === 0 ? 'X' : 'O'}
        </button>
      ))}
    </div>
  );
}

export const tictactoeUi: GameUi<TicTacToeState, TicTacToeMove, TicTacToeEvent> = {
  Board,
  seatLabel: (seat) => (seat === 0 ? { name: 'Croix', color: '#222222' } : { name: 'Ronds', color: '#cc3333' }),
  describeResult: (result, names) => (result.reason === 'line' ? `Ligne de trois : ${names[result.ranking[0]![0]!]} gagne.` : 'Grille pleine.'),
  announce: (events, _state, names) => {
    const last = events.at(-1);
    return last?.type === 'placed' ? `${names[last.seat]} joue la case ${last.cell + 1}.` : null;
  },
  sounds: (events) => events.flatMap((event) => (event.type === 'placed' ? (['piece'] as const) : [])),
  rules: ['Trois pions alignés gagnent.', 'Une grille pleine est nulle.'],
};

export const tictactoeModule = { def: tictactoe as unknown as AnyGameDefinition, ui: tictactoeUi as never };

// Le monde de départ : soi-même et ces autres joueurs en ligne, ces tables.
export function applyWorld(others: string[], tables: GameTableView[], invites: GameInvite[] = []): void {
  act(() => {
    useOfficeStore.getState().reset();
    useOfficeStore.getState().applyInit({
      self: player(SELF),
      players: others.map((id) => player(id)),
      mapKey: 'office',
      chatHistory: [],
      desks: [],
      closedDesks: [],
      deskBans: [],
      games: tables,
      gameInvites: invites,
    });
  });
}
