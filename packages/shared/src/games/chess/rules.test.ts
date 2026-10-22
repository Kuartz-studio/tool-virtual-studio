import { describe, expect, test } from 'vitest';
import { deepFreeze } from '../conformance';
import { GAMES } from '../index';
import { chess, chessMoveSchema, MAX_PLIES_KEPT, positionKey, START_FEN, stateFromFen, type ChessState } from './index';
import { fields, legalTexts, moveOf, noRandom, play, playSan, randomPlayout, startState, stateOf, textOf } from './test-helpers';

// Les cas nommés du § 13.5 du document des jeux (C1 à C37), un test par cas, son numéro en tête du titre ; puis les cas que l'agent ajoute (A1 à A32) : ce que le
// document ne nomme pas mais que les règles, le contrat et le SAN exigent aussi. Les coups s'écrivent de+vers(+pièce) : `e2e4`, `a7a8q`.

// Le siège qui a le trait, qui doit exister.
function seatToMove(state: ChessState): number {
  const seat = chess.turn(state);
  if (seat === null) throw new Error('la partie est finie');
  return seat;
}

// Tente un coup et rend la réponse brute de `apply`.
function tryMove(state: ChessState, text: string, seat = seatToMove(state)) {
  return chess.apply(state, seat, moveOf(text), noRandom);
}

// Joue un coup et rend l'état et les événements, ou lève.
function playOne(state: ChessState, text: string) {
  const out = tryMove(state, text);
  if (!out.ok) throw new Error(`coup refusé : ${text} (${out.error})`);
  return out;
}

// Le dernier demi-coup joué.
function lastPly(state: ChessState) {
  const ply = state.plies.at(-1);
  if (!ply) throw new Error('aucun demi-coup joué');
  return ply;
}

describe('cas nommés du document des jeux (§ 13.5)', () => {
  test('C1 : create(first 0) donne la position de départ, ses 20 coups légaux et le trait au siège 0', () => {
    const { state, events } = chess.create({ seats: 2, first: 0 }, noRandom);
    expect(state.fen).toBe(START_FEN);
    expect(state.white).toBe(0);
    expect(state.plies).toEqual([]);
    expect(state.result).toBeNull();
    expect(state.positions).toEqual({ 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -': 1 });
    expect(events).toEqual([]);
    expect(chess.turn(state)).toBe(0);
    expect(chess.legalMoves(state, 0)).toHaveLength(20);
  });

  test('C2 : create(first 1) donne les Blancs au siège 1, qui a le trait ; le siège 0 n\'a aucun coup', () => {
    const { state } = chess.create({ seats: 2, first: 1 }, noRandom);
    expect(state.white).toBe(1);
    expect(chess.turn(state)).toBe(1);
    expect(chess.legalMoves(state, 0)).toEqual([]);
    expect(chess.legalMoves(state, 1)).toHaveLength(20);
  });

  test('C3 : la prise en passant, au coup suivant l\'avance de deux cases', () => {
    const state = play(startState(), 'e2e4 d7d5 e4e5 f7f5');
    expect(positionKey(state.fen)).toBe('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6');
    const moves = legalTexts(state);
    expect(moves).toContain('e5f6');
    expect(moves).not.toContain('e5d6');
    const after = play(state, 'e5f6');
    expect(fields(after.fen, 3)).toBe('rnbqkbnr/ppp1p1pp/5P2/3p4/8/8/PPPP1PPP/RNBQKBNR b KQkq');
    expect(lastPly(after)).toMatchObject({ from: 'e5', to: 'f6', piece: 'p', captured: 'p', enPassant: true, san: 'exf6' });
  });

  test('C4 : la prise en passant se perd si on ne la joue pas tout de suite', () => {
    const state = play(startState(), 'e2e4 d7d5 e4e5 f7f5 g1f3 b8c6');
    expect(legalTexts(state)).not.toContain('e5f6');
    expect(tryMove(state, 'e5f6').ok).toBe(false);
  });

  test('C5 : la prise en passant qui découvrirait le roi est illégale, et la clé de répétition l\'ignore', () => {
    const state = stateOf('8/8/8/KPp4r/8/8/8/4k3 w - c6 0 2');
    expect(legalTexts(state)).not.toContain('b5c6');
    expect(tryMove(state, 'b5c6').ok).toBe(false);
    expect(positionKey(state.fen)).toBe(positionKey('8/8/8/KPp4r/8/8/8/4k3 w - - 0 2'));
    expect(positionKey(state.fen)).toBe('8/8/8/KPp4r/8/8/8/4k3 w - -');
  });

  test('C6 : le roque des deux côtés est légal ; le petit roque pose le roi en g1 et la tour en f1, et ôte les droits blancs', () => {
    const state = stateOf('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(legalTexts(state)).toEqual(expect.arrayContaining(['e1g1', 'e1c1']));
    const after = play(state, 'e1g1');
    expect(fields(after.fen, 3)).toBe('r3k2r/8/8/8/8/8/8/R4RK1 b kq');
    expect(lastPly(after)).toMatchObject({ from: 'e1', to: 'g1', piece: 'k', castle: 'k', san: 'O-O' });
  });

  test('C7 : on ne roque pas à travers une case attaquée (f1), mais l\'autre côté reste permis', () => {
    const state = stateOf('r3kr2/8/8/8/8/8/8/R3K2R w KQq - 0 1');
    expect(legalTexts(state)).not.toContain('e1g1');
    expect(legalTexts(state)).toContain('e1c1');
  });

  test('C8 : au grand roque, b1 peut être attaquée : le roi ne la traverse pas', () => {
    const state = stateOf('1r2k2r/8/8/8/8/8/8/R3K2R w KQk - 0 1');
    expect(legalTexts(state)).toContain('e1c1');
  });

  test('C9 : le roi ne traverse pas une case attaquée (d1) : grand roque illégal, petit roque légal', () => {
    const state = stateOf('3rk2r/8/8/8/8/8/8/R3K2R w KQk - 0 1');
    expect(legalTexts(state)).not.toContain('e1c1');
    expect(legalTexts(state)).toContain('e1g1');
  });

  test('C10 : on ne roque pas en échec', () => {
    const state = stateOf('4r1k1/8/8/8/8/8/8/R3K2R w KQ - 0 1');
    expect(legalTexts(state)).not.toContain('e1g1');
    expect(legalTexts(state)).not.toContain('e1c1');
  });

  test('C11 : on ne roque pas avec une pièce entre le roi et la tour (cavalier en b1)', () => {
    const state = stateOf('r3k2r/8/8/8/8/8/8/RN2K2R w KQkq - 0 1');
    expect(legalTexts(state)).not.toContain('e1c1');
    expect(legalTexts(state)).toContain('e1g1');
  });

  test('C12 : la tour peut être attaquée : le petit roque reste légal', () => {
    const state = stateOf('4k2r/8/8/8/8/8/8/4K2R w Kk - 0 1');
    expect(legalTexts(state)).toContain('e1g1');
  });

  test('C13 : un roi qui a bougé, même revenu sur sa case, a perdu ses droits de roque', () => {
    const state = play(stateOf('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'), 'e1e2 e8e7 e2e1 e7e8');
    expect(fields(state.fen, 3)).toBe('r3k2r/8/8/8/8/8/8/R3K2R w -');
    expect(legalTexts(state)).not.toContain('e1g1');
    expect(legalTexts(state)).not.toContain('e1c1');
  });

  test('C14 : une tour prise sur sa case de départ emporte le droit de roque qui allait avec', () => {
    const state = play(stateOf('r3k2r/8/8/8/8/8/6b1/R3K2R b KQkq - 0 1'), 'g2h1');
    expect(fields(state.fen, 3)).toBe('r3k2r/8/8/8/8/8/8/R3K2b w Qkq');
  });

  test('C15 : la promotion : quatre coups par arrivée, la pièce est obligatoire, et le SAN dit la pièce et l\'échec', () => {
    const state = stateOf('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    const moves = legalTexts(state);
    expect(moves).toHaveLength(9);
    expect(moves).toEqual(expect.arrayContaining(['a7a8q', 'a7a8r', 'a7a8b', 'a7a8n']));
    expect(tryMove(state, 'a7a8').ok).toBe(false);
    const knight = play(state, 'a7a8n');
    expect(fields(knight.fen, 1)).toBe('N3k3/8/8/8/8/8/8/4K3');
    const sans = Object.fromEntries(['q', 'r', 'b', 'n'].map((piece) => [piece, lastPly(play(state, `a7a8${piece}`)).san]));
    expect(sans).toEqual({ q: 'a8=Q+', r: 'a8=R+', b: 'a8=B', n: 'a8=N' });
  });

  test('C16 : une promotion sur un coup qui n\'en est pas une est refusée, et le roi n\'est pas une promotion', () => {
    const state = startState();
    expect(chess.apply(state, 0, { from: 'e2', to: 'e4', promotion: 'q' }, noRandom).ok).toBe(false);
    expect(chessMoveSchema.safeParse({ from: 'e2', to: 'e4', promotion: 'k' }).success).toBe(false);
  });

  test('C17 : une pièce clouée ne bouge pas : seuls les coups du roi restent', () => {
    const state = stateOf('4r1k1/8/8/8/8/8/4B3/4K3 w - - 0 1');
    expect(legalTexts(state)).toEqual(['e1d1', 'e1d2', 'e1f1', 'e1f2']);
  });

  test('C18 : le roi en échec par une tour voisine ne peut que la prendre (si elle n\'est pas protégée) ou fuir hors de sa ligne', () => {
    const state = stateOf('4k3/8/8/8/8/8/3r4/4K3 w - - 0 1');
    expect(legalTexts(state)).toEqual(['e1d2', 'e1f1']);
  });

  test('C19 : le mat du berger : les Blancs gagnent, le dernier coup s\'écrit Qxf7#', () => {
    const state = play(startState(), 'e2e4 e7e5 f1c4 b8c6 d1h5 g8f6 h5f7');
    expect(chess.result(state)).toEqual({ ranking: [[0], [1]], reason: 'checkmate' });
    expect(chess.turn(state)).toBeNull();
    expect(lastPly(state)).toMatchObject({ san: 'Qxf7#', piece: 'q', captured: 'p', check: true, mate: true });
  });

  test('C20 : le mat du fou : les Noirs gagnent, et c\'est le siège des Noirs', () => {
    const state = play(startState(), 'f2f3 e7e5 g2g4 d8h4');
    expect(chess.result(state)).toEqual({ ranking: [[1], [0]], reason: 'checkmate' });
    expect(lastPly(state).san).toBe('Qh4#');
  });

  test('C21 : le pat : nulle', () => {
    const state = play(stateOf('7k/5Q2/8/6K1/8/8/8/8 w - - 0 1'), 'g5g6');
    expect(chess.result(state)).toEqual({ ranking: [[0, 1]], reason: 'stalemate' });
    expect(chess.turn(state)).toBeNull();
  });

  test('C22 : le pat de Sam Loyd, en dix coups : nulle au 19e demi-coup, et pas avant', () => {
    const moves = 'e2e3 a7a5 d1h5 a8a6 h5a5 h7h5 h2h4 a6h6 a5c7 f7f6 c7d7 e8f7 d7b7 d8d3 b7b8 d3h7 b8c8 f7g6 c8e6'.split(' ');
    expect(moves).toHaveLength(19);
    const beforeLast = play(startState(), moves.slice(0, 18).join(' '));
    expect(chess.result(beforeLast)).toBeNull();
    const state = play(beforeLast, moves[18]!);
    expect(state.plies).toHaveLength(19);
    expect(chess.result(state)).toEqual({ ranking: [[0, 1]], reason: 'stalemate' });
    expect(fields(positionKey(state.fen), 3)).toBe('5bnr/4p1pq/4Qpkr/7p/7P/4P3/PPPP1PP1/RNB1KBNR b KQ');
  });

  test('C23 : le roi et le fou contre le roi : nulle immédiate, matériel insuffisant', () => {
    const state = play(stateOf('4k3/8/8/8/8/8/5r2/4KB2 w - - 0 1'), 'e1f2');
    expect(chess.result(state)).toEqual({ ranking: [[0, 1]], reason: 'insufficient' });
  });

  test('C24 : des fous sur des cases de même couleur, d\'un camp et de l\'autre : nulle', () => {
    const state = play(stateOf('5b1k/8/8/8/8/8/1r6/K1B5 w - - 0 1'), 'a1b2');
    expect(chess.result(state)).toEqual({ ranking: [[0, 1]], reason: 'insufficient' });
  });

  test('C25 : des fous de couleurs opposées : la partie continue', () => {
    const state = play(stateOf('2b4k/8/8/8/8/8/1r6/K1B5 w - - 0 1'), 'a1b2');
    expect(chess.result(state)).toBeNull();
  });

  test.each([
    ['cavalier contre cavalier', '6nk/8/8/8/8/8/8/KN6 w - - 0 1', 'a1a2'],
    ['deux cavaliers contre le roi', '7k/8/8/8/8/8/8/KNN5 w - - 0 1', 'a1a2'],
    ['un pion contre le roi', '7k/8/8/8/8/8/P7/K7 w - - 0 1', 'a1b1'],
  ])('C26 : %s : la partie continue', (_name, fen, move) => {
    expect(chess.result(play(stateOf(fen), move))).toBeNull();
  });

  test('C27 : la triple répétition : nulle au 8e demi-coup, pas avant', () => {
    const shuffle = 'g1f3 g8f6 f3g1 f6g8';
    const beforeLast = play(startState(), `${shuffle} g1f3 g8f6 f3g1`);
    expect(chess.result(beforeLast)).toBeNull();
    const state = play(beforeLast, 'f6g8');
    expect(state.plies).toHaveLength(8);
    expect(chess.result(state)).toEqual({ ranking: [[0, 1]], reason: 'threefold' });
  });

  test('C28 : la case de prise en passant du FEN ne compte pas quand aucune prise n\'est possible : nulle au 9e demi-coup', () => {
    const beforeLast = play(startState(), 'e2e4 g8f6 g1f3 f6g8 f3g1 g8f6 g1f3 f6g8');
    expect(chess.result(beforeLast)).toBeNull();
    // Le FEN garde bien la case e3 après e2e4 (aucun pion noir ne peut prendre) : c'est la clé de répétition qui l'ignore.
    expect(play(startState(), 'e2e4').fen.split(' ')[3]).toBe('e3');
    const state = play(beforeLast, 'f3g1');
    expect(state.plies).toHaveLength(9);
    expect(chess.result(state)).toEqual({ ranking: [[0, 1]], reason: 'threefold' });
  });

  test('C29 : la case de prise en passant compte quand la prise est possible : nulle au 10e demi-coup, pas au 9e', () => {
    const start = stateOf('4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1');
    const atNinth = play(start, 'd7d5 e1e2 e8e7 e2e1 e7e8 e1e2 e8e7 e2e1 e7e8');
    expect(chess.result(atNinth)).toBeNull();
    const state = play(atNinth, 'e1e2');
    expect(state.plies).toHaveLength(10);
    expect(chess.result(state)).toEqual({ ranking: [[0, 1]], reason: 'threefold' });
  });

  test('C30 : les droits de roque perdus changent la position : nulle au 10e demi-coup, pas au 8e', () => {
    const start = stateOf('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const shuffle = 'e1e2 e8e7 e2e1 e7e8';
    const atEighth = play(start, `${shuffle} ${shuffle}`);
    expect(chess.result(atEighth)).toBeNull();
    const atNinth = play(atEighth, 'e1e2');
    expect(chess.result(atNinth)).toBeNull();
    const state = play(atNinth, 'e8e7');
    expect(state.plies).toHaveLength(10);
    expect(chess.result(state)).toEqual({ ranking: [[0, 1]], reason: 'threefold' });
  });

  test('C31 : la règle des 50 coups : nulle au centième demi-coup sans pion ni prise', () => {
    const state = play(stateOf('8/8/8/8/8/8/R7/K6k w - - 99 80'), 'a2b2');
    expect(chess.result(state)).toEqual({ ranking: [[0, 1]], reason: 'fifty' });
  });

  test('C32 : un mat donné au centième demi-coup l\'emporte sur la règle des 50 coups', () => {
    const state = play(stateOf('7k/8/6K1/8/8/8/8/R7 w - - 99 80'), 'a1a8');
    expect(chess.result(state)).toEqual({ ranking: [[0], [1]], reason: 'checkmate' });
  });

  test('C33 : un coup de pion remet le compteur de demi-coups à zéro : la partie continue', () => {
    const state = play(stateOf('8/8/8/8/8/8/RP6/K6k w - - 99 80'), 'b2b3');
    expect(state.fen.split(' ')[4]).toBe('0');
    expect(chess.result(state)).toBeNull();
  });

  describe('C34 : un coup refusé rend { ok: false } et laisse l\'état tel qu\'il était', () => {
    const mated = play(startState(), 'e2e4 e7e5 f1c4 b8c6 d1h5 g8f6 h5f7');
    test.each([
      ['mauvais siège', startState(), 'e2e4', 1],
      ['case de départ vide', startState(), 'e3e4', 0],
      ['pièce adverse', startState(), 'e7e5', 0],
      // Le coup d'un client qui se croit une position plus loin : le fou de f1 ne passe pas encore à travers le pion de e2.
      ['coup d\'une autre position', startState(), 'f1c4', 0],
      ['pièce qui ne se déplace pas ainsi', startState(), 'b1b3', 0],
      ['rien à jouer : la partie est finie (Blancs)', mated, 'a2a3', 0],
      ['rien à jouer : la partie est finie (Noirs)', mated, 'a7a6', 1],
    ])('%s', (_name, state, text, seat) => {
      const before = structuredClone(state);
      const out = chess.apply(state, seat, moveOf(text), noRandom);
      expect(out.ok).toBe(false);
      expect(state).toStrictEqual(before);
    });

    // La plateforme a déjà passé le coup au schéma, mais `apply` se méfie quand même (R4) : rien ne lève, rien ne change.
    test.each<[string, unknown]>([
      ['un coup nul', null],
      ['un coup sans cases', {}],
      ['une case qui n\'existe pas', { from: 'z9', to: 'e4' }],
      ['des cases qui ne sont pas du texte', { from: 12, to: 28 }],
      ['une promotion en roi', { from: 'e2', to: 'e4', promotion: 'k' }],
      ['un texte au lieu d\'un coup', 'e2e4'],
    ])('un coup mal formé (%s)', (_name, move) => {
      const state = startState();
      const before = structuredClone(state);
      expect(chess.apply(state, 0, move as never, noRandom).ok).toBe(false);
      expect(state).toStrictEqual(before);
    });
  });

  test('C35 : deux cavaliers peuvent aller sur la même case : le SAN dit lequel (Nbd2, Nfd2)', () => {
    const state = play(startState(), 'g1f3 d7d6 d2d3 e7e6');
    expect(lastPly(play(state, 'b1d2')).san).toBe('Nbd2');
    expect(lastPly(play(state, 'f3d2')).san).toBe('Nfd2');
    // L'affichage français (« Cbd2 ») est l'affaire du module client, qui lit ce SAN.
  });

  test('C36 : l\'abandon et la nulle par accord : le résultat, et plus aucun coup', () => {
    const state = play(startState(), 'e2e4 e7e5');
    const resigned = chess.forfeit(state, 0, 'resign');
    expect(chess.result(resigned.state)).toEqual({ ranking: [[1], [0]], reason: 'resign' });
    expect(resigned.events).toEqual([{ type: 'forfeit', seat: 0, reason: 'resign' }, { type: 'end', reason: 'resign', winner: 1 }]);
    const drawn = chess.agreeDraw!(state);
    expect(chess.result(drawn.state)).toEqual({ ranking: [[0, 1]], reason: 'agreement' });
    expect(drawn.events).toEqual([{ type: 'draw' }, { type: 'end', reason: 'agreement', winner: null }]);
    for (const ended of [resigned.state, drawn.state]) {
      expect(chess.turn(ended)).toBeNull();
      expect(chess.legalMoves(ended, 0)).toEqual([]);
      expect(chess.legalMoves(ended, 1)).toEqual([]);
    }
  });

  test('C37 : aller-retour : la clé de répétition est stable, l\'état survit à JSON, le FEN relu puis réécrit est identique', () => {
    const fens = [
      START_FEN,
      'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
      '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
      'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
      'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
      '8/8/8/KPp4r/8/8/8/4k3 w - c6 0 2',
    ];
    for (const fen of fens) {
      expect(positionKey(fen)).toBe(positionKey(fen));
      const state = stateFromFen(fen);
      expect(fields(state.fen, 4)).toBe(fields(fen, 4));
      expect(positionKey(state.fen)).toBe(positionKey(fen));
      expect(fields(stateFromFen(state.fen).fen, 4)).toBe(fields(fen, 4));
    }
    // Une partie qui passe par une prise en passant, une prise ordinaire et les deux roques, puis une promotion avec prise : tous les genres de demi-coup.
    const game = play(startState(), 'e2e4 d7d5 e4e5 f7f5 e5f6 g8f6 g1f3 e7e6 f1e2 f8e7 e1g1 e8g8');
    expect(game.plies.map((ply) => ply.castle ?? ply.enPassant ?? null).filter((flag) => flag !== null)).toEqual([true, 'k', 'k']);
    const promoted = play(stateOf('r3k3/1P6/8/8/8/8/8/4K3 w - - 0 1'), 'b7a8q');
    for (const state of [game, promoted]) expect(JSON.parse(JSON.stringify(state))).toStrictEqual(state);
  });
});

describe('cas ajoutés par l\'agent (A1 à A21)', () => {
  test('A1 : le SAN lève l\'ambiguïté par la colonne, par la rangée, puis par les deux', () => {
    const rooksOnAFile = stateOf('4k3/8/8/8/8/R7/8/R3K3 w - - 0 1');
    expect(lastPly(play(rooksOnAFile, 'a1a2')).san).toBe('R1a2');
    expect(lastPly(play(rooksOnAFile, 'a3a2')).san).toBe('R3a2');
    const rooksOnARank = stateOf('4k3/8/8/8/8/8/4K3/R6R w - - 0 1');
    expect(lastPly(play(rooksOnARank, 'a1d1')).san).toBe('Rad1');
    expect(lastPly(play(rooksOnARank, 'h1d1')).san).toBe('Rhd1');
    // Trois dames vers g7 : celle de c3 partage sa colonne avec c7 et sa rangée avec g3, il faut donc les deux.
    const threeQueens = stateOf('8/2Q5/8/8/k7/2Q3Q1/8/7K w - - 0 1');
    expect(lastPly(play(threeQueens, 'c3g7')).san).toBe('Qc3g7');
    expect(lastPly(play(threeQueens, 'c7g7')).san).toBe('Q7g7');
    expect(lastPly(play(threeQueens, 'g3g7')).san).toBe('Qgg7');
  });

  test('A2 : une pièce clouée n\'oblige pas à désambiguïser : seuls les coups légaux comptent', () => {
    // Deux cavaliers visent g3, mais celui de e2 est cloué à son roi par la tour de e8 : le coup de h1 s'écrit Ng3 tout court.
    const state = stateOf('4r1k1/8/8/8/8/8/4N3/4K2N w - - 0 1');
    expect(legalTexts(state)).toContain('h1g3');
    expect(legalTexts(state)).not.toContain('e2g3');
    expect(lastPly(play(state, 'h1g3')).san).toBe('Ng3');
  });

  test('A3 : la prise avec promotion et le SAN d\'un pion qui prend (bxa8=Q+, exd5)', () => {
    const state = stateOf('r3k3/1P6/8/8/8/8/8/4K3 w - - 0 1');
    expect(lastPly(play(state, 'b7a8q')).san).toBe('bxa8=Q+');
    expect(lastPly(play(state, 'b7a8n')).san).toBe('bxa8=N');
    expect(lastPly(play(state, 'b7b8q')).san).toBe('b8=Q+');
    expect(lastPly(play(startState(), 'e2e4 d7d5 e4d5')).san).toBe('exd5');
  });

  test('A4 : les drapeaux d\'un demi-coup : roque, prise en passant, promotion, échec, mat', () => {
    const castle = play(stateOf('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'), 'e1c1');
    expect(lastPly(castle)).toStrictEqual({ from: 'e1', to: 'c1', san: 'O-O-O', piece: 'k', castle: 'q' });
    const promotion = play(stateOf('4k3/P7/8/8/8/8/8/4K3 w - - 0 1'), 'a7a8q');
    expect(lastPly(promotion)).toStrictEqual({ from: 'a7', to: 'a8', promotion: 'q', san: 'a8=Q+', piece: 'p', check: true });
    const quiet = play(startState(), 'g1f3');
    expect(lastPly(quiet)).toStrictEqual({ from: 'g1', to: 'f3', san: 'Nf3', piece: 'n' });
    expect('check' in lastPly(quiet) || 'captured' in lastPly(quiet) || 'castle' in lastPly(quiet) || 'enPassant' in lastPly(quiet) || 'mate' in lastPly(quiet)).toBe(false);
  });

  test('A5 : un coup donne un événement `move`, et un événement `end` quand il finit la partie', () => {
    const state = play(startState(), 'e2e4 e7e5 f1c4 b8c6 d1h5 g8f6');
    const quiet = playOne(startState(), 'e2e4');
    expect(quiet.events).toEqual([{ type: 'move', seat: 0, ply: { from: 'e2', to: 'e4', san: 'e4', piece: 'p' } }]);
    const mate = playOne(state, 'h5f7');
    expect(mate.events).toHaveLength(2);
    expect(mate.events[0]).toMatchObject({ type: 'move', seat: 0 });
    expect(mate.events[1]).toEqual({ type: 'end', reason: 'checkmate', winner: 0 });
    const stalemate = playOne(stateOf('7k/5Q2/8/6K1/8/8/8/8 w - - 0 1'), 'g5g6');
    expect(stalemate.events[1]).toEqual({ type: 'end', reason: 'stalemate', winner: null });
  });

  test('A6 : avec les Blancs au siège 1, c\'est le siège 1 qui joue en premier et qui gagne le mat du berger', () => {
    const state = startState(1);
    expect(chess.apply(state, 0, moveOf('e2e4'), noRandom)).toEqual({ ok: false, error: 'not_your_turn' });
    const mated = play(state, 'e2e4 e7e5 f1c4 b8c6 d1h5 g8f6 h5f7');
    expect(chess.result(mated)).toEqual({ ranking: [[1], [0]], reason: 'checkmate' });
    expect(playOne(play(state, 'e2e4 e7e5 f1c4 b8c6 d1h5 g8f6'), 'h5f7').events[1]).toEqual({ type: 'end', reason: 'checkmate', winner: 1 });
  });

  test('A7 : `positions` repart de zéro après un pion, une prise ou un droit de roque perdu, et grandit sinon', () => {
    const start = startState();
    expect(Object.keys(play(start, 'g1f3 g8f6').positions)).toHaveLength(3);
    expect(Object.keys(play(start, 'g1f3 g8f6 e2e4').positions)).toHaveLength(1);
    const castling = stateOf('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(Object.keys(play(castling, 'a1a2').positions)).toHaveLength(1);
    expect(Object.keys(play(castling, 'a1a2 a8a7').positions)).toHaveLength(1);
    expect(Object.keys(play(castling, 'a1a2 a8a7 a2a1').positions)).toHaveLength(2);
    const capture = play(stateOf('4k3/8/8/8/8/8/1r6/K7 w - - 0 1'), 'a1b2');
    expect(Object.keys(capture.positions)).toHaveLength(1);
    expect(capture.positions).toEqual({ [positionKey(capture.fen)]: 1 });
  });

  test('A8 : dans toute partie au hasard, `positions` garde 101 entrées au plus et aucune apparition au-delà de la deuxième tant que la partie dure', () => {
    for (let seed = 1; seed <= 12; seed++) {
      for (const state of randomPlayout(seed)) {
        expect(Object.keys(state.positions).length).toBeLessThanOrEqual(101);
        if (state.result === null) for (const count of Object.values(state.positions)) expect(count).toBeLessThanOrEqual(2);
      }
    }
  });

  test('A9 : l\'ordre des nulles automatiques : le pat l\'emporte sur le matériel insuffisant, la triple répétition sur les 50 coups', () => {
    // Roi et fou contre roi nu, et pourtant pat : l'ordre du document (mat, pat, matériel, répétition, 50 coups) donne « pat ».
    const stalemate = play(stateOf('k7/8/1K6/4B3/8/8/8/8 w - - 0 1'), 'e5c7');
    expect(chess.result(stalemate)?.reason).toBe('stalemate');
    // Un pat donné au centième demi-coup reste un pat (la règle des 50 coups vient après lui, comme après le mat).
    const lateStalemate = play(stateOf('k7/8/1K6/8/8/8/8/2Q5 w - - 99 80'), 'c1c7');
    expect(lateStalemate.fen.split(' ')[4]).toBe('100');
    expect(chess.result(lateStalemate)?.reason).toBe('stalemate');
    // Le même coup fait apparaître une position pour la 3e fois et porte le compteur à 100.
    const before = stateOf('7k/8/8/8/8/8/8/R3K3 w - - 99 80');
    const after = play(before, 'a1b1');
    const seen: ChessState = { ...before, positions: { ...before.positions, [positionKey(after.fen)]: 2 } };
    expect(chess.invariants(seen)).toEqual([]);
    expect(chess.result(playOne(seen, 'a1b1').state)?.reason).toBe('threefold');
  });

  test('A10 : stateFromFen reconnaît une position déjà finie : mat, pat, 50 coups, matériel insuffisant', () => {
    expect(stateFromFen('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3').result).toEqual({ ranking: [[1], [0]], reason: 'checkmate' });
    expect(stateFromFen('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3', 1).result).toEqual({ ranking: [[0], [1]], reason: 'checkmate' });
    expect(stateFromFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1').result).toEqual({ ranking: [[0, 1]], reason: 'stalemate' });
    expect(stateFromFen('8/8/8/8/8/8/R7/K6k w - - 100 80').result).toEqual({ ranking: [[0, 1]], reason: 'fifty' });
    expect(stateFromFen('7k/8/8/8/8/8/8/KB6 w - - 0 1').result).toEqual({ ranking: [[0, 1]], reason: 'insufficient' });
    expect(stateFromFen(START_FEN).result).toBeNull();
    for (const fen of [START_FEN, '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', '8/8/8/8/8/8/R7/K6k w - - 100 80']) expect(chess.invariants(stateFromFen(fen))).toEqual([]);
  });

  test.each([
    ['le roi contre le roi', '7k/8/8/8/8/8/8/K7 w - - 0 1', true],
    ['le roi et un fou contre le roi', '7k/8/8/8/8/8/8/KB6 w - - 0 1', true],
    ['le roi et un cavalier contre le roi', '7k/8/8/8/8/8/8/KN6 w - - 0 1', true],
    ['des fous d\'un camp, tous sur des cases sombres', '7k/8/8/8/8/8/8/K1B1B3 w - - 0 1', true],
    ['des fous des deux camps, tous sur des cases sombres', '5b1k/8/8/8/8/8/8/K1B5 w - - 0 1', true],
    ['deux fous de couleurs opposées contre le roi', '7k/8/8/8/8/8/8/KBB5 w - - 0 1', false],
    ['deux cavaliers contre le roi', '7k/8/8/8/8/8/8/KNN5 w - - 0 1', false],
    ['un cavalier contre un cavalier', '6nk/8/8/8/8/8/8/KN6 w - - 0 1', false],
    ['un fou contre un cavalier', '6nk/8/8/8/8/8/8/KB6 w - - 0 1', false],
    ['un pion contre le roi', '7k/8/8/8/8/8/P7/K7 w - - 0 1', false],
    ['une tour contre le roi', '7k/8/8/8/8/8/8/KR6 w - - 0 1', false],
    ['une dame contre le roi', '7k/8/8/8/8/8/8/KQ6 w - - 0 1', false],
    ['un fou contre un fou, de couleurs opposées', '2b4k/8/8/8/8/8/8/K1B5 w - - 0 1', false],
  ])('A11 : matériel insuffisant, %s : %s', (_name, fen, insufficient) => {
    expect(stateFromFen(fen).result?.reason ?? null).toBe(insufficient ? 'insufficient' : null);
  });

  test('A12 : un droit de roque se perd avec sa tour (tour qui bouge, tour prise), pas avec l\'autre', () => {
    const state = stateOf('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(fields(play(state, 'a1a2').fen, 3)).toBe('r3k2r/8/8/8/8/8/R7/4K2R b Kkq');
    expect(fields(play(state, 'h1h2').fen, 3)).toBe('r3k2r/8/8/8/8/8/7R/R3K3 b Qkq');
    expect(fields(play(state, 'e1e2').fen, 3)).toBe('r3k2r/8/8/8/8/8/4K3/R6R b kq');
    // La tour blanche prend la tour noire de h8 : les Blancs perdent le petit roque (leur tour a bougé), les Noirs le leur (leur tour est prise).
    expect(fields(play(state, 'h1h8').fen, 3)).toBe('r3k2R/8/8/8/8/8/8/R3K3 b Qq');
  });

  test('A13 : la case de prise en passant du FEN suit toute avance de deux cases, la clé de répétition seulement les prises possibles', () => {
    const afterE4 = play(startState(), 'e2e4');
    expect(afterE4.fen.split(' ')[3]).toBe('e3');
    expect(positionKey(afterE4.fen).split(' ')[3]).toBe('-');
    const afterE5 = play(afterE4, 'e7e5');
    expect(afterE5.fen.split(' ')[3]).toBe('e6');
    expect(play(afterE5, 'g1f3').fen.split(' ')[3]).toBe('-');
    expect(play(startState(), 'a2a3').fen.split(' ')[3]).toBe('-');
  });

  test('A14 : une fois la partie finie, ni abandon ni nulle ne changent plus rien', () => {
    const mated = play(startState(), 'e2e4 e7e5 f1c4 b8c6 d1h5 g8f6 h5f7');
    expect(chess.forfeit(mated, 0, 'resign')).toEqual({ state: mated, events: [] });
    expect(chess.agreeDraw!(mated)).toEqual({ state: mated, events: [] });
  });

  test('A15 : countedMoves compte les demi-coups joués, jamais l\'abandon ni la nulle', () => {
    const state = play(startState(), 'e2e4 e7e5 g1f3');
    expect(chess.countedMoves(startState())).toBe(0);
    expect(chess.countedMoves(state)).toBe(3);
    expect(chess.countedMoves(chess.forfeit(state, 1, 'timeout').state)).toBe(3);
  });

  test('A16 : legalMoves rend à chaque appel des objets neufs : les modifier ne change pas l\'appel suivant', () => {
    const state = startState();
    const first = chess.legalMoves(state, 0);
    first[0]!.to = 'h8';
    first.length = 0;
    const again = chess.legalMoves(state, 0);
    expect(again).toHaveLength(20);
    expect(again.map(textOf)).not.toContain('a2h8');
    expect(again).toStrictEqual(chess.legalMoves(state, 0));
  });

  test('A17 : les coups légaux tiennent dans le schéma, avec la promotion seulement quand il y en a une', () => {
    for (const fen of [START_FEN, '4k3/P7/8/8/8/8/8/4K3 w - - 0 1', 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1']) {
      const state = stateOf(fen);
      for (const move of chess.legalMoves(state, 0)) {
        expect(chessMoveSchema.safeParse(move).success).toBe(true);
        expect('promotion' in move).toBe(move.to[1] === '8' && move.from[1] === '7');
      }
    }
    expect(chessMoveSchema.safeParse({ from: 'e2', to: 'e4' }).success).toBe(true);
    expect(chessMoveSchema.safeParse({ from: 'a7', to: 'a8', promotion: 'n' }).success).toBe(true);
    for (const bad of [{ from: 'e9', to: 'e4' }, { from: 'e2' }, { from: 'E2', to: 'E4' }, { from: 'e2', to: 'e4', promotion: 'p' }, 'e2e4', null, 12]) {
      expect(chessMoveSchema.safeParse(bad).success).toBe(false);
    }
  });

  test('A18 : create refuse une partie qui n\'est pas à deux, ou dont le premier siège n\'existe pas', () => {
    expect(() => chess.create({ seats: 3, first: 0 }, noRandom)).toThrow(/deux/);
    expect(() => chess.create({ seats: 2, first: 2 }, noRandom)).toThrow();
  });

  test('A19 : l\'identité du jeu : « chess », « Échecs », deux joueurs, la nulle par accord offerte (avec sa fonction), et il est au registre', () => {
    expect(chess).toMatchObject({ id: 'chess', label: 'Échecs', minPlayers: 2, maxPlayers: 2, drawOffers: true });
    expect(typeof chess.agreeDraw).toBe('function');
    expect(GAMES.chess).toBe(chess);
  });

  test('A20 : l\'historique est borné à MAX_PLIES_KEPT demi-coups : le plus ancien s\'en va, et un état de plus de MAX_PLIES_KEPT demi-coups n\'est pas légal', () => {
    const base = stateOf('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
    const old = Array.from({ length: MAX_PLIES_KEPT }, (_, index) => ({ from: 'a1' as const, to: 'a2' as const, san: `ancien ${index + 1}`, piece: 'r' as const }));
    const full: ChessState = deepFreeze({ ...base, plies: old });
    expect(chess.invariants(full)).toEqual([]);
    const next = playOne(full, 'a1a2').state;
    expect(next.plies).toHaveLength(MAX_PLIES_KEPT);
    expect(next.plies[0]!.san).toBe('ancien 2');
    expect(next.plies.at(-1)!.san).toBe('Ra2');
    expect(chess.countedMoves(next)).toBe(MAX_PLIES_KEPT);
    expect(chess.invariants({ ...full, plies: [...old, old[0]!] })).not.toEqual([]);
    // Le plus gros état possible reste très en dessous des 50 ko de R8 : 600 demi-coups ordinaires, et la table des répétitions pleine de ses 101 entrées.
    const packed = { ...next, positions: Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq ${index}`, 2])) };
    expect(JSON.stringify(packed).length).toBeLessThan(45_000);
  });

  test('A21 : les coups légaux d\'une position fabriquée avec plusieurs dames et promotions se jouent tous sans erreur', () => {
    const state = stateOf('r3k2r/1P4P1/8/8/8/8/1p4p1/R3K2R w KQkq - 0 1');
    const moves = chess.legalMoves(state, 0);
    expect(moves.length).toBeGreaterThan(30);
    for (const move of moves) expect(chess.apply(state, 0, move, noRandom).ok).toBe(true);
  });
});

// Des parties réelles, jouées en SAN : chaque coup du texte doit être retrouvé parmi les coups légaux par l'écriture que le moteur lui donne (lettres, prises,
// désambiguïsation, roque, échec, mat). Ce sont des données que l'agent n'a pas fabriquées : si le moteur ou le SAN se trompent quelque part, un coup manque.
describe('cas ajoutés par l\'agent : parties célèbres jouées par leur notation (A22 à A25), symétries et bords (A26 à A32)', () => {
  const sans = (state: ChessState): string[] => state.plies.map((ply) => ply.san);

  test('A22 : l\'Opéra de Morphy (Paris, 1858) : 33 demi-coups, un grand roque, Nbd7, et le mat Rd8#', () => {
    const text =
      'e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#';
    const state = playSan(startState(), text);
    expect(sans(state).join(' ')).toBe(text);
    expect(state.plies).toHaveLength(33);
    expect(chess.result(state)).toEqual({ ranking: [[0], [1]], reason: 'checkmate' });
    expect(state.fen).toBe('1n1Rkb1r/p4ppp/4q3/4p1B1/4P3/8/PPP2PPP/2K5 b k - 1 17');
  });

  test('A23 : l\'Immortelle (Anderssen, Kieseritzky, 1851) : 45 demi-coups, les deux rois ont bougé, et le mat Be7#', () => {
    const text =
      'e4 e5 f4 exf4 Bc4 Qh4+ Kf1 b5 Bxb5 Nf6 Nf3 Qh6 d3 Nh5 Nh4 Qg5 Nf5 c6 g4 Nf6 Rg1 cxb5 h4 Qg6 h5 Qg5 Qf3 Ng8 Bxf4 Qf6 Nc3 Bc5 Nd5 Qxb2 Bd6 Bxg1 e5 Qxa1+ Ke2 Na6 Nxg7+ Kd8 Qf6+ Nxf6 Be7#';
    const state = playSan(startState(), text);
    expect(sans(state).join(' ')).toBe(text);
    expect(state.plies).toHaveLength(45);
    expect(chess.result(state)).toEqual({ ranking: [[0], [1]], reason: 'checkmate' });
    // La position finale publiée : le roi blanc a bougé (Kf1, Ke2) et le noir aussi (Kd8), donc plus aucun droit de roque.
    expect(fields(state.fen, 3)).toBe('r1bk3r/p2pBpNp/n4n2/1p1NP2P/6P1/3P4/P1P1K3/q5b1 b -');
  });

  test('A24 : la Toujours-verte (Anderssen, Dufresne, 1852) : 47 demi-coups, un petit roque, Nbd2, et le mat Bxe7#', () => {
    const text =
      'e4 e5 Nf3 Nc6 Bc4 Bc5 b4 Bxb4 c3 Ba5 d4 exd4 O-O d3 Qb3 Qf6 e5 Qg6 Re1 Nge7 Ba3 b5 Qxb5 Rb8 Qa4 Bb6 Nbd2 Bb7 Ne4 Qf5 Bxd3 Qh5 Nf6+ gxf6 exf6 Rg8 Rad1 Qxf3 Rxe7+ Nxe7 Qxd7+ Kxd7 Bf5+ Ke8 Bd7+ Kf8 Bxe7#';
    const state = playSan(startState(), text);
    expect(sans(state).join(' ')).toBe(text);
    expect(state.plies).toHaveLength(47);
    expect(chess.result(state)).toEqual({ ranking: [[0], [1]], reason: 'checkmate' });
  });

  test('A25 : une partie célèbre jouée au siège 1 pour les Blancs donne le même mat, au siège 1', () => {
    const state = playSan(startState(1), 'e4 e5 Qh5 Nc6 Bc4 Nf6 Qxf7#');
    expect(chess.result(state)).toEqual({ ranking: [[1], [0]], reason: 'checkmate' });
  });

  test('A26 : la prise en passant et la promotion des Noirs, symétriques de celles des Blancs', () => {
    const afterDouble = play(startState(), 'a2a3 e7e5 a3a4 e5e4 d2d4');
    expect(afterDouble.fen.split(' ')[3]).toBe('d3');
    expect(legalTexts(afterDouble)).toContain('e4d3');
    const captured = play(afterDouble, 'e4d3');
    expect(lastPly(captured)).toMatchObject({ from: 'e4', to: 'd3', piece: 'p', captured: 'p', enPassant: true, san: 'exd3' });
    expect(fields(captured.fen, 1)).toBe('rnbqkbnr/pppp1ppp/8/8/P7/3p4/1PP1PPPP/RNBQKBNR');
    const promotion = stateOf('4k3/8/8/8/8/8/p7/4K3 b - - 0 1');
    expect(legalTexts(promotion)).toHaveLength(9);
    expect(lastPly(play(promotion, 'a2a1q')).san).toBe('a1=Q+');
    expect(lastPly(play(promotion, 'a2a1n')).san).toBe('a1=N');
    expect(fields(play(promotion, 'a2a1n').fen, 1)).toBe('4k3/8/8/8/8/8/8/n3K3');
  });

  // Après un mat ou un pat, la position n'a plus de coup : refuser est facile. Après un abandon, une nulle ou une nulle automatique, elle en a encore, et c'est le seul
  // garde du résultat qui interdit de continuer à jouer.
  test('A27 : une partie finie sur une position qui a encore des coups (abandon, délai, nulle, répétition, 50 coups, matériel) n\'accepte plus aucun coup', () => {
    const live = play(startState(), 'e2e4 e7e5');
    const ended: Array<[string, ChessState]> = [
      ['abandon', chess.forfeit(live, 1, 'resign').state],
      ['délai écoulé', chess.forfeit(live, 0, 'timeout').state],
      ['nulle par accord', chess.agreeDraw!(live).state],
      ['triple répétition', play(startState(), 'g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1 f6g8')],
      ['règle des 50 coups', play(stateOf('8/8/8/8/8/8/R7/K6k w - - 99 80'), 'a2b2')],
      ['matériel insuffisant', play(stateOf('4k3/8/8/8/8/8/5r2/4KB2 w - - 0 1'), 'e1f2')],
    ];
    for (const [name, state] of ended) {
      expect(chess.result(state), name).not.toBeNull();
      // Le même état, la partie reprise : la position a un coup légal, et c'est celui qu'on essaie de jouer à la fin.
      const resumed: ChessState = { ...state, result: null };
      const seat = chess.turn(resumed)!;
      const move = chess.legalMoves(resumed, seat)[0]!;
      for (const who of [0, 1]) {
        const before = structuredClone(state);
        expect(chess.apply(state, who, move, noRandom), `${name}, siège ${who}`).toEqual({ ok: false, error: 'wrong_phase' });
        expect(state).toStrictEqual(before);
      }
    }
  });

  test.each<[string, string]>([
    ['un FEN vide', ''],
    ['trop peu de champs', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w'],
    ['trop de champs', `${START_FEN} encore`],
    ['sept rangées seulement', 'rnbqkbnr/pppppppp/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'],
    ['une rangée trop longue', 'rnbqkbnrr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'],
    ['une rangée trop courte', 'rnbqkbn/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'],
    ['une pièce qui n\'existe pas', 'rnbqkbnx/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'],
    ['un chiffre qui n\'est pas une case vide', 'rnbqkbnr/pppppppp/9/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'],
    ['un trait qui n\'est ni w ni b', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1'],
    ['des droits de roque en double', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KKkq - 0 1'],
    ['des droits de roque inconnus', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkx - 0 1'],
    ['une case de prise en passant hors de l\'échiquier', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq e9 0 1'],
    ['un compteur qui n\'est pas un entier', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - x 1'],
    ['un compteur négatif', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - -1 1'],
    ['pas de roi noir', 'rnbq1bnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'],
    ['deux rois blancs', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBKKBNR w KQkq - 0 1'],
  ])('A28 : un FEN illisible lève une erreur qui le dit (%s)', (_name, fen) => {
    expect(() => positionKey(fen)).toThrow(/FEN illisible/);
    expect(() => stateFromFen(fen)).toThrow(/FEN illisible/);
  });

  test('A29 : un FEN à quatre champs est lu (compteurs à 0 et 1) et réécrit à six', () => {
    expect(stateFromFen('4k3/8/8/8/8/8/8/4K3 w - -').fen).toBe('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
    expect(stateFromFen('4k3/8/8/8/8/8/8/4K3 w - - 7').fen).toBe('4k3/8/8/8/8/8/8/4K3 w - - 7 1');
  });

  test('A30 : un pion n\'avance de deux cases que de sa case de départ, et seulement si les deux cases sont libres', () => {
    // Un pion déjà avancé (e4 pour les Blancs, d6 pour les Noirs) ne fait plus qu'un pas.
    const advanced = play(startState(), 'e2e4 d7d6');
    expect(legalTexts(advanced).filter((move) => move.startsWith('e4'))).toEqual(['e4e5']);
    expect(legalTexts(play(advanced, 'a2a3')).filter((move) => move.startsWith('d6'))).toEqual(['d6d5']);
    // Une pièce sur la case d'en face ferme le pion ; une pièce sur la seconde case lui laisse le pas simple ; le pion ne saute pas.
    expect(legalTexts(stateOf('4k3/8/8/8/8/4n3/4P3/4K3 w - - 0 1')).filter((move) => move.startsWith('e2'))).toEqual([]);
    expect(legalTexts(stateOf('4k3/8/8/8/4n3/8/4P3/4K3 w - - 0 1')).filter((move) => move.startsWith('e2'))).toEqual(['e2e3']);
  });

  test('A31 : une case de prise en passant mal placée (FEN fabriqué, hors invariants) n\'ouvre aucune prise', () => {
    // Un pion blanc en d4, un pion noir en e4 et une case « e5 » donnée comme case de prise en passant : ce n'est pas la 6e rangée, rien à prendre en passant.
    const state = stateOf('4k3/8/8/8/3Pp3/8/8/4K3 w - e5 0 1');
    expect(chess.invariants(state)).not.toEqual([]);
    expect(legalTexts(state)).not.toContain('d4e5');
    expect(legalTexts(state)).toContain('d4d5');
  });

  test('A32 : un siège qui n\'existe pas ne peut ni abandonner ni jouer', () => {
    const state = play(startState(), 'e2e4');
    expect(chess.forfeit(state, 5, 'resign')).toEqual({ state, events: [] });
    expect(chess.forfeit(state, -1, 'timeout')).toEqual({ state, events: [] });
    expect(chess.legalMoves(state, 7)).toEqual([]);
    expect(chess.apply(state, 7, moveOf('e7e5'), noRandom).ok).toBe(false);
  });
});

describe('invariants (§ 13.3)', () => {
  const healthy = play(startState(), 'e2e4 d7d5 e4e5 f7f5');

  test('un état juste n\'a aucune violation, au départ, en pleine partie et à la fin', () => {
    expect(chess.invariants(startState())).toEqual([]);
    expect(chess.invariants(healthy)).toEqual([]);
    expect(chess.invariants(play(startState(), 'e2e4 e7e5 f1c4 b8c6 d1h5 g8f6 h5f7'))).toEqual([]);
    expect(chess.invariants(chess.forfeit(healthy, 0, 'resign').state)).toEqual([]);
    expect(chess.invariants(chess.agreeDraw!(healthy).state)).toEqual([]);
  });

  // Chaque défaut fabriqué : une phrase au moins, qui parle de ce qui ne va pas. Un FEN que le moteur ne sait pas lire n'a pas de clé : on lui en donne une quelconque.
  const keyOf = (fen: string): string => {
    try {
      return positionKey(fen);
    } catch {
      return 'illisible';
    }
  };
  const withFen = (fen: string): ChessState => ({ ...healthy, fen, positions: { ...healthy.positions, [keyOf(fen)]: 1 } });
  test.each<[string, (state: ChessState) => ChessState, RegExp]>([
    ['un FEN illisible', (state) => ({ ...state, fen: 'ceci n\'est pas un FEN' }), /FEN/],
    ['un FEN sans roi noir', () => withFen('8/8/8/8/8/8/8/K7 w - - 0 1'), /roi/],
    ['deux rois blancs', () => withFen('4k3/8/8/8/8/8/8/K3K3 w - - 0 1'), /roi/],
    ['un pion sur la première rangée', () => withFen('4k3/8/8/8/8/8/8/P3K3 w - - 0 1'), /pion/],
    ['un pion sur la huitième rangée', () => withFen('P3k3/8/8/8/8/8/8/4K3 w - - 0 1'), /pion/],
    ['le camp qui n\'a pas le trait est en échec', () => withFen('4k3/8/8/8/8/8/4R3/4K3 w - - 0 1'), /échec/],
    ['un droit de roque sans sa tour', () => withFen('4k3/8/8/8/8/8/8/4K3 w K - 0 1'), /roque/],
    ['un droit de roque noir sans son roi', () => withFen('r2k3r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'), /roque/],
    ['une case de prise en passant à la mauvaise rangée', () => withFen('4k3/8/8/8/8/8/8/4K3 w - e3 0 1'), /prise en passant/],
    ['une case de prise en passant sans le pion devant', () => withFen('4k3/8/8/8/8/8/8/4K3 b - e3 0 1'), /prise en passant/],
    ['une case de prise en passant occupée', () => withFen('4k3/8/8/8/4P3/4N3/8/4K3 b - e3 0 1'), /prise en passant/],
    ['un numéro de coup à zéro', () => withFen('4k3/8/8/8/8/8/8/4K3 w - - 0 0'), /coup/],
    ['la position courante absente de positions', (state) => ({ ...state, positions: {} }), /positions/],
    ['une apparition comptée zéro fois', (state) => ({ ...state, positions: { [positionKey(state.fen)]: 0 } }), /positions/],
    ['un siège blanc qui n\'existe pas', (state) => ({ ...state, white: 2 }), /Blancs|siège/],
    ['un résultat alors que la partie continue', (state) => ({ ...state, result: { ranking: [[0, 1]], reason: 'stalemate' } }), /résultat|pat/],
    ['pas de résultat alors que la position est un mat', () => stateOf('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3'), /résultat|mat/],
    ['pas de résultat alors que la triple répétition est atteinte', (state) => ({ ...state, positions: { [positionKey(state.fen)]: 3 } }), /résultat|répétition/],
    ['un classement qui oublie un siège', (state) => ({ ...state, result: { ranking: [[0]], reason: 'resign' } }), /classement|siège/],
    ['un classement qui compte un siège deux fois', (state) => ({ ...state, result: { ranking: [[0], [0, 1]], reason: 'resign' } }), /classement|siège/],
    ['une raison de fin inconnue', (state) => ({ ...state, result: { ranking: [[0], [1]], reason: 'zugzwang' } }), /inconnue/],
    ['une défaite classée en un seul groupe', (state) => ({ ...state, result: { ranking: [[0, 1]], reason: 'resign' } }), /défaite/],
    ['une nulle par accord classée en deux groupes', (state) => ({ ...state, result: { ranking: [[0], [1]], reason: 'agreement' } }), /accord/],
    ['un pat classé en deux groupes', () => ({ ...stateFromFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'), result: { ranking: [[0], [1]], reason: 'stalemate' } }), /nulle/],
    ['positions qui n\'est pas un objet', (state) => ({ ...state, positions: [] as unknown as Record<string, number> }), /positions/],
    ['un mat dont le gagnant est le mauvais siège', () => ({ ...stateFromFen('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3'), result: { ranking: [[0], [1]], reason: 'checkmate' } }), /mat|gagnant/],
  ])('une violation : %s', (_name, damage, pattern) => {
    const problems = chess.invariants(deepFreeze(damage(healthy)));
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(' | ')).toMatch(pattern);
  });

  test('un objet qui n\'est pas un état ne fait jamais lever invariants : il rend des phrases', () => {
    for (const junk of [{}, null, 12, 'x', { fen: 3 }, { fen: START_FEN }, { fen: START_FEN, white: 0, plies: 'non', positions: {}, result: null }]) {
      expect(chess.invariants(junk as never).length).toBeGreaterThan(0);
    }
  });
});
