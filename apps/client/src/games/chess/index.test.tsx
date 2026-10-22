import { chess, type ChessEvent } from '@bureau/shared/games/chess';
import { describe, expect, test } from 'vitest';
import { fromFen, play, startState } from './chess-test-kit';
import { ChessBoard } from './ChessBoard';
import ui from './index';

// Le module client du jeu (GameUi, § 9.4) : ce que la plateforme lui demande à côté du plateau, c'est-à-dire le nom et la couleur d'un siège, la phrase d'une fin de partie, ce que le lecteur
// d'écran entend d'un coup, les effets sonores, et l'aide « Règles ».
const NAMES = ['Alice', 'Bastien'];

describe('le module', () => {
  test('son plateau est celui des échecs, et le module donne tout le contrat', () => {
    expect(ui.Board).toBe(ChessBoard);
    expect(Object.keys(ui).sort()).toEqual(['Board', 'announce', 'describeResult', 'rules', 'seatLabel', 'sounds']);
  });
});

describe('seatLabel : le nom et la couleur de chaque siège', () => {
  test('les Blancs et les Noirs, d\'après le siège qui a les Blancs (un siège n\'est pas une couleur)', () => {
    expect(ui.seatLabel(0, startState(0))).toEqual({ name: 'Blancs', color: '#f2ead8' });
    expect(ui.seatLabel(1, startState(0))).toEqual({ name: 'Noirs', color: '#2b2d38' });
    expect(ui.seatLabel(0, startState(1))).toEqual({ name: 'Noirs', color: '#2b2d38' });
    expect(ui.seatLabel(1, startState(1))).toEqual({ name: 'Blancs', color: '#f2ead8' });
  });
});

describe('describeResult : toutes les raisons de fin que le moteur écrit', () => {
  test('l\'échec et mat nomme celui qui gagne', () => {
    expect(ui.describeResult({ ranking: [[0], [1]], reason: 'checkmate' }, NAMES, startState())).toBe('Échec et mat : Alice gagne.');
    expect(ui.describeResult({ ranking: [[1], [0]], reason: 'checkmate' }, NAMES, startState())).toBe('Échec et mat : Bastien gagne.');
  });

  test.each([
    ['stalemate', 'Pat : nulle.'],
    ['insufficient', 'Matériel insuffisant : nulle.'],
    ['threefold', 'Triple répétition : nulle.'],
    ['fifty', 'Règle des 50 coups : nulle.'],
  ])('%s : « %s »', (reason, text) => {
    expect(ui.describeResult({ ranking: [[0, 1]], reason }, NAMES, startState())).toBe(text);
  });

  test('chaque raison que le moteur sait écrire est dite : les cinq vraies fins, jouées par le moteur', () => {
    const fools = play(startState(), 'f2f3 e7e5 g2g4 d8h4').state;
    expect(chess.result(fools)!.reason).toBe('checkmate');
    expect(ui.describeResult(chess.result(fools)!, NAMES, fools)).toBe('Échec et mat : Bastien gagne.');
    const stalemate = play(fromFen('7k/5Q2/8/6K1/8/8/8/8 w - - 0 1'), 'g5g6').state;
    expect(ui.describeResult(chess.result(stalemate)!, NAMES, stalemate)).toBe('Pat : nulle.');
    const insufficient = play(fromFen('4k3/8/8/8/8/8/5r2/4KB2 w - - 0 1'), 'e1f2').state;
    expect(ui.describeResult(chess.result(insufficient)!, NAMES, insufficient)).toBe('Matériel insuffisant : nulle.');
    const threefold = play(startState(), 'g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1 f6g8').state;
    expect(ui.describeResult(chess.result(threefold)!, NAMES, threefold)).toBe('Triple répétition : nulle.');
    const fifty = play(fromFen('8/8/8/8/8/8/R7/K6k w - - 99 80'), 'a2b2').state;
    expect(ui.describeResult(chess.result(fifty)!, NAMES, fifty)).toBe('Règle des 50 coups : nulle.');
  });

  test('une raison inconnue ne fait pas lever : une phrase neutre, avec le vainqueur ou la nulle', () => {
    expect(ui.describeResult({ ranking: [[1], [0]], reason: 'zugzwang' }, NAMES, startState())).toBe('Bastien gagne.');
    expect(ui.describeResult({ ranking: [[0, 1]], reason: 'zugzwang' }, NAMES, startState())).toBe('Partie nulle.');
  });
});

describe('announce : ce que le lecteur d\'écran entend d\'un coup', () => {
  test('un coup simple : « Alice : cavalier en f3. »', () => {
    const { state, events } = play(startState(), 'g1f3');
    expect(ui.announce(events, state, NAMES)).toBe('Alice : cavalier en f3.');
  });

  test('le coup des Noirs porte le nom du siège qui joue (ici le siège 1)', () => {
    const { state, events } = play(startState(), 'e2e4 e7e5');
    expect(ui.announce(events, state, NAMES)).toBe('Bastien : pion en e5.');
  });

  test('une prise : la pièce, sa case de départ, « prend », la case d\'arrivée', () => {
    const { state, events } = play(startState(), 'e2e4 d7d5 e4d5');
    expect(ui.announce(events, state, NAMES)).toBe('Alice : pion e4 prend d5.');
    const knight = play(fromFen('4k3/8/8/4p3/8/5N2/8/4K3 w - - 0 1'), 'f3e5');
    expect(ui.announce(knight.events, knight.state, NAMES)).toBe('Alice : cavalier f3 prend e5.');
  });

  test('une prise en passant avec échec : « Bastien : pion e5 prend d6 en passant, échec. »', () => {
    // Les Blancs sont au siège 1 (Bastien) : le Noir joue d7d5, le pion blanc prend en passant et donne échec au roi de c7.
    const { state, events } = play(fromFen('8/2kp4/8/4P3/8/8/8/4K3 b - - 0 1', 1), 'd7d5 e5d6');
    expect(ui.announce(events, state, NAMES)).toBe('Bastien : pion e5 prend d6 en passant, échec.');
  });

  test('le roque : « Alice : petit roque. », « Alice : grand roque. »', () => {
    const start = fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const short = play(start, 'e1g1');
    expect(ui.announce(short.events, short.state, NAMES)).toBe('Alice : petit roque.');
    const long = play(start, 'e1c1');
    expect(ui.announce(long.events, long.state, NAMES)).toBe('Alice : grand roque.');
    // La tour qui arrive en d1 donne échec au roi noir de d8.
    const withCheck = play(fromFen('r2k3r/8/8/8/8/8/8/R3K2R w KQ - 0 1'), 'e1c1');
    expect(ui.announce(withCheck.events, withCheck.state, NAMES)).toBe('Alice : grand roque, échec.');
  });

  test('une promotion : « Bastien : promotion en dame en a8. », avec prise, avec échec', () => {
    const quiet = play(fromFen('8/P6k/8/8/8/8/8/4K3 w - - 0 1', 1), 'a7a8q');
    expect(ui.announce(quiet.events, quiet.state, NAMES)).toBe('Bastien : promotion en dame en a8.');
    const capture = play(fromFen('r3k3/1P6/8/8/8/8/8/4K3 w - - 0 1'), 'b7a8n');
    expect(ui.announce(capture.events, capture.state, NAMES)).toBe('Alice : pion b7 prend a8, promotion en cavalier.');
    const check = play(fromFen('4k3/P7/8/8/8/8/8/4K3 w - - 0 1'), 'a7a8r');
    expect(ui.announce(check.events, check.state, NAMES)).toBe('Alice : promotion en tour en a8, échec.');
  });

  test('l\'échec et l\'échec et mat se disent', () => {
    const mate = play(startState(), 'e2e4 e7e5 f1c4 b8c6 d1h5 g8f6 h5f7');
    expect(ui.announce(mate.events, mate.state, NAMES)).toBe('Alice : dame h5 prend f7, échec et mat.');
    const check = play(startState(), 'e2e4 f7f5 d1h5');
    expect(ui.announce(check.events, check.state, NAMES)).toBe('Alice : dame en h5, échec.');
  });

  test('l\'abandon, la nulle et la fin sont dits par la plateforme : rien ici', () => {
    const state = startState();
    const events: ChessEvent[] = [{ type: 'forfeit', seat: 0, reason: 'resign' }, { type: 'end', reason: 'resign', winner: 1 }];
    expect(ui.announce(events, state, NAMES)).toBeNull();
    expect(ui.announce([{ type: 'draw' }, { type: 'end', reason: 'agreement', winner: null }], state, NAMES)).toBeNull();
    expect(ui.announce([], state, NAMES)).toBeNull();
  });
});

describe('sounds : un « piece » par coup joué', () => {
  test('un coup : le bruit d\'une pièce ; un coup qui finit la partie aussi, une seule fois', () => {
    const { events } = play(startState(), 'e2e4');
    expect(ui.sounds(events, 0)).toEqual(['piece']);
    const mate = play(startState(), 'e2e4 e7e5 f1c4 b8c6 d1h5 g8f6 h5f7');
    expect(mate.events.map((event) => event.type)).toEqual(['move', 'end']);
    expect(ui.sounds(mate.events, 1)).toEqual(['piece']);
    expect(ui.sounds(mate.events, null)).toEqual(['piece']);
  });

  test('l\'abandon et la nulle ne font pas de bruit de pièce (la victoire a le sien, que la plateforme joue)', () => {
    expect(ui.sounds([{ type: 'forfeit', seat: 1, reason: 'timeout' }, { type: 'end', reason: 'timeout', winner: 0 }], 0)).toEqual([]);
    expect(ui.sounds([{ type: 'draw' }, { type: 'end', reason: 'agreement', winner: null }], 0)).toEqual([]);
    expect(ui.sounds([], 0)).toEqual([]);
  });
});

describe('rules : l\'aide du panneau', () => {
  test('de quatre à huit phrases courtes, chacune finie par un point', () => {
    expect(ui.rules.length).toBeGreaterThanOrEqual(4);
    expect(ui.rules.length).toBeLessThanOrEqual(8);
    for (const rule of ui.rules) {
      expect(rule.endsWith('.'), rule).toBe(true);
      expect(rule.length, rule).toBeLessThan(220);
    }
  });

  test('elle dit le but, le roque, la promotion, les nulles automatiques, la nulle proposée, le délai et le clavier', () => {
    const text = ui.rules.join(' ').toLowerCase();
    for (const word of ['échec et mat', 'roque', 'promotion', 'pat', 'trois fois', 'cinquante', 'nulle', 'cinq minutes', 'clavier']) expect(text, word).toContain(word);
  });
});
