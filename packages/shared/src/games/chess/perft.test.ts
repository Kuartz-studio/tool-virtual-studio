import { describe, expect, test } from 'vitest';
import { START_FEN, stateFromFen } from './index';
import { perft, perftApi, perftDetail, perftDivide, type PerftDetail } from './perft';
import { env } from './test-helpers';

// Les perft du § 13.5 du document des jeux : les nombres publiés (Chess Programming Wiki) pour la position de départ et les positions classiques « à trous », celles
// qui piègent le roque, la prise en passant, le clouage et la promotion. Les profondeurs qui prennent des dizaines de secondes sont « longues » : elles ne tournent
// qu'avec JEUX_LONG=1 (`JEUX_LONG=1 pnpm vitest run packages/shared/src/games/chess/perft.test.ts`), et le critère d'acceptation les exige une fois.
const LONG = env.JEUX_LONG === '1';
const SHORT_TIMEOUT = 120_000;
const LONG_TIMEOUT = 1_800_000;

interface Reference {
  name: string;
  fen: string;
  // Le nombre de positions à la profondeur 1, 2, 3…
  counts: number[];
  // À partir de quelle profondeur le calcul est « long » ; absent : jamais.
  longFrom?: number;
}

const KIWIPETE = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
const POSITION_3 = '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1';
const POSITION_4 = 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1';
const POSITION_4_MIRROR = 'r2q1rk1/pP1p2pp/Q4n2/bbp1p3/Np6/1B3NBn/pPPP1PPP/R3K2R b KQ - 0 1';
const POSITION_5 = 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8';
const POSITION_6 = 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10';

const REFERENCES: Reference[] = [
  { name: 'départ', fen: START_FEN, counts: [20, 400, 8902, 197281, 4865609], longFrom: 5 },
  { name: 'position 2 (« Kiwipete »)', fen: KIWIPETE, counts: [48, 2039, 97862, 4085603], longFrom: 4 },
  { name: 'position 3', fen: POSITION_3, counts: [14, 191, 2812, 43238, 674624] },
  { name: 'position 4', fen: POSITION_4, counts: [6, 264, 9467, 422333, 15833292], longFrom: 5 },
  { name: 'position 4 en miroir', fen: POSITION_4_MIRROR, counts: [6, 264, 9467, 422333] },
  { name: 'position 5', fen: POSITION_5, counts: [44, 1486, 62379, 2103487], longFrom: 4 },
  { name: 'position 6', fen: POSITION_6, counts: [46, 2079, 89890, 3894594], longFrom: 4 },
];

describe('perft du moteur (positions publiées)', () => {
  for (const reference of REFERENCES) {
    reference.counts.forEach((expected, index) => {
      const depth = index + 1;
      const isLong = reference.longFrom !== undefined && depth >= reference.longFrom;
      const run = isLong ? test.skipIf(!LONG) : test;
      run(`${reference.name}, profondeur ${depth} : ${expected.toLocaleString('fr-FR')} positions${isLong ? ' (long)' : ''}`, { timeout: isLong ? LONG_TIMEOUT : SHORT_TIMEOUT }, () => {
        expect(perft(reference.fen, depth)).toBe(expected);
      });
    });
  }

  test('le détail par premier coup (divide) s\'additionne au total, et le départ a vingt coups à une position chacun', () => {
    const one = perftDivide(START_FEN, 1);
    expect(Object.keys(one)).toHaveLength(20);
    expect(Object.values(one).every((value) => value === 1)).toBe(true);
    const two = perftDivide(START_FEN, 2);
    expect(Object.values(two).reduce((sum, value) => sum + value, 0)).toBe(400);
    expect(Object.values(two).every((value) => value === 20)).toBe(true);
    // Kiwipete : les promotions s'écrivent avec leur pièce, et les deux roques y sont.
    expect(perftDivide(KIWIPETE, 1)).toMatchObject({ e1g1: 1, e1c1: 1 });
  });
});

// Le détail publié avec les nombres : prises, prises en passant, roques, promotions, échecs, mats à la dernière profondeur. Il attrape ce que le total laisse passer.
describe('perft détaillé du moteur (prises, prises en passant, roques, promotions, échecs, mats)', () => {
  const details: Array<{ name: string; fen: string; depth: number; expected: PerftDetail; isLong?: boolean }> = [
    { name: 'départ', fen: START_FEN, depth: 3, expected: { nodes: 8902, captures: 34, enPassant: 0, castles: 0, promotions: 0, checks: 12, mates: 0 } },
    { name: 'départ', fen: START_FEN, depth: 4, expected: { nodes: 197281, captures: 1576, enPassant: 0, castles: 0, promotions: 0, checks: 469, mates: 8 } },
    { name: 'départ', fen: START_FEN, depth: 5, expected: { nodes: 4865609, captures: 82719, enPassant: 258, castles: 0, promotions: 0, checks: 27351, mates: 347 }, isLong: true },
    { name: 'Kiwipete', fen: KIWIPETE, depth: 1, expected: { nodes: 48, captures: 8, enPassant: 0, castles: 2, promotions: 0, checks: 0, mates: 0 } },
    { name: 'Kiwipete', fen: KIWIPETE, depth: 2, expected: { nodes: 2039, captures: 351, enPassant: 1, castles: 91, promotions: 0, checks: 3, mates: 0 } },
    { name: 'Kiwipete', fen: KIWIPETE, depth: 3, expected: { nodes: 97862, captures: 17102, enPassant: 45, castles: 3162, promotions: 0, checks: 993, mates: 1 } },
  ];
  for (const { name, fen, depth, expected, isLong } of details) {
    const run = isLong ? test.skipIf(!LONG) : test;
    run(`${name}, profondeur ${depth}${isLong ? ' (long)' : ''}`, { timeout: isLong ? LONG_TIMEOUT : SHORT_TIMEOUT }, () => {
      expect(perftDetail(fen, depth)).toEqual(expected);
    });
  }
});

// Le même compte à travers l'enveloppe du jeu (`legalMoves`, `apply`, états JSON) : il prouve la mise à notre forme des promotions, des roques et de la prise en passant.
describe('perft par l\'API (legalMoves et apply, états JSON)', () => {
  test('départ, profondeur 3 : 8 902', () => {
    expect(perftApi(stateFromFen(START_FEN), 3)).toBe(8902);
  });

  test('Kiwipete, profondeur 2 : 2 039', () => {
    expect(perftApi(stateFromFen(KIWIPETE), 2)).toBe(2039);
  });

  test('position 3, profondeur 3 : 2 812', () => {
    expect(perftApi(stateFromFen(POSITION_3), 3)).toBe(2812);
  });

  // Les promotions (quatre coups par arrivée) et les roques passent par l'enveloppe : la position 4 en est pleine.
  test('position 4 et son miroir, profondeur 2 : 264, par l\'API comme par le moteur', () => {
    expect(perftApi(stateFromFen(POSITION_4), 2)).toBe(264);
    expect(perftApi(stateFromFen(POSITION_4_MIRROR, 1), 2)).toBe(264);
  });
});
