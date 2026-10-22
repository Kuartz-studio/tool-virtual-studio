import type { ChessPly, ChessState } from '@bureau/shared/games/chess';
import { describe, expect, test } from 'vitest';
import { fromFen, play, startState } from './chess-test-kit';
import { boardFromFen, frenchSan, materialFromFen, moveRows, PIECE_POINTS } from './notation';

// Les aides pures de l'interface : la notation française des coups (R16), la numérotation par le compteur du FEN (l'historique de l'état est borné à 600 demi-coups), les pièces prises
// lues sur le plateau, et le plateau lu sur le FEN.

describe('frenchSan : la notation à l\'écran (R16)', () => {
  test.each([
    ['e4', 'e4'],
    ['Nf3', 'Cf3'],
    ['Nbd2', 'Cbd2'],
    ['Bxe5', 'Fxe5'],
    ['Rad1', 'Tad1'],
    ['R1a3', 'T1a3'],
    ['Qxf7#', 'Dxf7#'],
    ['Qh4+', 'Dh4+'],
    ['Kg2', 'Rg2'],
    ['exf6', 'exf6'],
    ['bxa8=Q+', 'bxa8=D+'],
    ['a8=N', 'a8=C'],
    ['b1=R', 'b1=T'],
    ['c8=B#', 'c8=F#'],
    ['O-O', '0-0'],
    ['O-O-O', '0-0-0'],
    ['O-O+', '0-0+'],
    ['O-O-O#', '0-0-0#'],
  ])('%s s\'écrit %s', (san, french) => {
    expect(frenchSan(san)).toBe(french);
  });

  test('les colonnes (minuscules) ne sont jamais prises pour des pièces : « b » est une colonne, « B » un fou', () => {
    expect(frenchSan('bxc3')).toBe('bxc3');
    expect(frenchSan('Bxc3')).toBe('Fxc3');
  });
});

describe('boardFromFen : le plateau lu sur le FEN', () => {
  test('la position de départ : trente-deux pièces, chacune sur sa case', () => {
    const board = boardFromFen(startState().fen);
    expect(board.size).toBe(32);
    expect(board.get('e1')).toEqual({ type: 'k', color: 'w' });
    expect(board.get('d8')).toEqual({ type: 'q', color: 'b' });
    expect(board.get('a2')).toEqual({ type: 'p', color: 'w' });
    expect(board.get('g8')).toEqual({ type: 'n', color: 'b' });
    expect(board.get('h1')).toEqual({ type: 'r', color: 'w' });
    expect(board.get('c8')).toEqual({ type: 'b', color: 'b' });
    expect(board.get('e4')).toBeUndefined();
  });

  test('après des coups : les pièces ont bougé, et une prise en passant ôte le pion pris', () => {
    const board = boardFromFen(play(startState(), 'e2e4 d7d5 e4e5 f7f5 e5f6').state.fen);
    expect(board.get('f6')).toEqual({ type: 'p', color: 'w' });
    expect(board.has('f5')).toBe(false);
    expect(board.has('e5')).toBe(false);
    expect(board.size).toBe(31);
  });
});

describe('materialFromFen : les pièces prises, lues sur le plateau', () => {
  test('au départ, personne n\'a rien pris', () => {
    expect(materialFromFen(startState().fen)).toEqual({ captured: { w: [], b: [] }, advantage: 0 });
  });

  test('chacun a pris un pion : deux listes à un pion, aucune avance', () => {
    const { state } = play(startState(), 'e2e4 d7d5 e4d5 d8d5');
    expect(materialFromFen(state.fen)).toEqual({ captured: { w: ['p'], b: ['p'] }, advantage: 0 });
  });

  test('les pièces prises sont triées de la plus forte à la plus faible, et l\'avance compte les points (pion 1, cavalier 3, fou 3, tour 5, dame 9)', () => {
    // Les Noirs ont perdu un fou ; les Blancs un cavalier et une tour : 31 points contre 36.
    const material = materialFromFen('rn1qkbnr/pppppppp/8/8/8/8/PPPPPPPP/R1BQKBN1 w KQkq - 0 1');
    expect(material.captured).toEqual({ w: ['b'], b: ['r', 'n'] });
    expect(material.advantage).toBe(-5);
    expect(PIECE_POINTS).toEqual({ p: 1, n: 3, b: 3, r: 5, q: 9 });
  });

  test('une promotion n\'est pas une prise de pion : la dame de plus est prise sur le compte des pions, et l\'avance la compte', () => {
    // Les Blancs ont sept pions et deux dames (un pion a promu) ; ils ont perdu une tour. Aucun pion n'a été pris.
    const material = materialFromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPP1/RNBQKBNQ w KQkq - 0 1');
    expect(material.captured).toEqual({ w: [], b: ['r'] });
    expect(material.advantage).toBe(3);
  });

  test('un roi seul contre une armée : tout ce qui manque est pris', () => {
    const material = materialFromFen('4k3/8/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1');
    expect(material.captured.w).toEqual(['q', 'r', 'r', 'b', 'b', 'n', 'n', 'p', 'p', 'p', 'p', 'p', 'p', 'p', 'p']);
    expect(material.captured.b).toEqual([]);
    expect(material.advantage).toBe(39);
  });
});

// Un demi-coup de pacotille : la numérotation ne regarde que la place dans la liste et le FEN.
const filler = (index: number): ChessPly => ({ from: 'a1', to: 'a2', san: `Ra${index}`, piece: 'r' });

describe('moveRows : la liste des coups, numérotée par le compteur du FEN', () => {
  test('une partie qui commence : deux coups par ligne, en français, le dernier en évidence', () => {
    const { state } = play(startState(), 'e2e4 e7e5 g1f3 b8c6 f1b5 g8f6 e1g1');
    const rows = moveRows(state);
    expect(rows.map((row) => [row.number, row.white?.text ?? null, row.black?.text ?? null])).toEqual([
      [1, 'e4', 'e5'],
      [2, 'Cf3', 'Cc6'],
      [3, 'Fb5', 'Cf6'],
      [4, '0-0', null],
    ]);
    expect(rows[3]!.white).toMatchObject({ san: 'O-O', text: '0-0', last: true });
    expect(rows.flatMap((row) => [row.white, row.black]).filter((cell) => cell?.last)).toHaveLength(1);
  });

  test('le dernier coup est celui des Noirs : sa cellule est la dernière', () => {
    const rows = moveRows(play(startState(), 'e2e4 e7e5').state);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.black).toMatchObject({ text: 'e5', last: true });
    expect(rows[0]!.white).toMatchObject({ text: 'e4', last: false });
  });

  test('rien n\'a été joué : aucune ligne', () => {
    expect(moveRows(startState())).toEqual([]);
  });

  test('l\'historique a perdu ses premiers demi-coups (borné à 600) : la numérotation vient du FEN, et la première ligne commence par les Blancs', () => {
    // 700 demi-coups joués, les Blancs au trait : le FEN dit « coup 351 » ; les 600 derniers vont du demi-coup 101 au 700, soit du coup 51 (Blancs) au coup 350 (Noirs).
    const state: ChessState = { ...fromFen('4k3/8/8/8/8/8/8/4K3 w - - 0 351'), plies: Array.from({ length: 600 }, (_, index) => filler(index)) };
    const rows = moveRows(state);
    expect(rows).toHaveLength(300);
    expect(rows[0]).toMatchObject({ number: 51, white: { san: 'Ra0' }, black: { san: 'Ra1' } });
    expect(rows.at(-1)).toMatchObject({ number: 350, black: { san: 'Ra599', last: true } });
  });

  test('l\'historique perdu commence par un coup des Noirs : la première ligne n\'a pas de coup blanc', () => {
    // 701 demi-coups joués, les Noirs au trait (les Blancs viennent de jouer le coup 351) : les 600 derniers vont du demi-coup 102 au 701, soit du coup 51 (Noirs) au coup 351 (Blancs).
    const state: ChessState = { ...fromFen('4k3/8/8/8/8/8/8/4K3 b - - 0 351'), plies: Array.from({ length: 600 }, (_, index) => filler(index)) };
    const rows = moveRows(state);
    expect(rows[0]).toMatchObject({ number: 51, white: null, black: { san: 'Ra0' } });
    expect(rows[1]).toMatchObject({ number: 52, white: { san: 'Ra1' } });
    expect(rows.at(-1)).toMatchObject({ number: 351, white: { san: 'Ra599', last: true }, black: null });
  });

  test('un FEN qui ne colle pas à l\'historique (position posée à la main) : on numérote à partir de 1 plutôt que de lever', () => {
    const state: ChessState = { ...fromFen('4k3/8/8/8/8/8/8/4K3 w - - 0 1'), plies: [filler(0), filler(1), filler(2)] };
    const rows = moveRows(state);
    expect(rows.map((row) => row.number)).toEqual([1, 2]);
    expect(rows[0]!.white).toMatchObject({ san: 'Ra0' });
  });
});
