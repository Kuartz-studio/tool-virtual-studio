// Le tsconfig de ce paquet ne charge pas les types de Node (`types` n'y est pas déclaré, alors que celui du serveur déclare « node ») : `process`, `node:fs` et
// `import.meta.dirname` n'existeraient pas pour le typage. Cette ligne les charge pour ce fichier seulement, sans toucher au tsconfig de la plateforme.
/// <reference types="node" />
import { describe, expect, test } from 'vitest';
import { runGameConformance } from '../conformance';
import { pickIndex, scriptedRng, seededRng, type Rng } from '../rng';
import { connect4, type Connect4State } from './index';

// Des parties au hasard contre le harnais de conformité de la plateforme (§ 11.2 du document des jeux) : à chaque pas, l'état est légal (`invariants`), survit à un
// aller-retour par JSON, n'est pas modifié par `apply`, et `turn` est nul si et seulement si `result` ne l'est pas ; chaque partie finie est rejouée depuis son
// journal et retombe sur le même état. 2 000 parties par défaut ; JEUX_FUZZ=10000 pour la vérification complète.
const GAMES = Number(process.env.JEUX_FUZZ ?? 2_000);

// Les colonnes de 0 à 6 dont la case du haut est prise, lues d'après la convention de l'état (colonne × 6 + rangée) sans rien demander au moteur.
const fullColumns = (cells: readonly number[]): number[] => [0, 1, 2, 3, 4, 5, 6].filter((col) => cells[col * 6 + 5] !== 0);

type Kind = 'colonne pleine' | 'colonne négative' | 'colonne trop grande' | 'colonne fractionnaire';

// Un coup que le jeu doit refuser : une colonne pleine quand il y en a une, sinon, ou au hasard, une colonne qui n'existe pas (négative, après la septième, ou
// entre deux colonnes). Le harnais en essaie un une fois sur dix, et vérifie que l'état ne change pas.
function illegalMove(state: unknown, rng: Rng): { move: unknown; kind: Kind } {
  const full = fullColumns((state as Connect4State).cells);
  const draw = rng();
  if (full.length > 0 && draw < 0.5) return { move: { col: full[pickIndex(rng, full.length)] }, kind: 'colonne pleine' };
  if (draw < 0.7) return { move: { col: -1 - pickIndex(rng, 3) }, kind: 'colonne négative' };
  if (draw < 0.9) return { move: { col: 7 + pickIndex(rng, 3) }, kind: 'colonne trop grande' };
  return { move: { col: pickIndex(rng, 7) + 0.5 }, kind: 'colonne fractionnaire' };
}
const illegal = (state: unknown, rng: Rng): unknown => illegalMove(state, rng).move;

describe('Puissance 4 : parties au hasard contre le harnais de conformité', () => {
  test(`${GAMES} parties au hasard (avec des abandons, et des coups illégaux une fois sur dix) : états légaux, toutes finies, rejouées à l'identique`, () => {
    const report = runGameConformance(connect4, { games: GAMES, seats: [2], maxActions: 42, illegal });
    expect(report.games).toBe(GAMES);
    // 42 jetons au plus : la grille pleine ou un alignement termine toute partie (un abandon compte une action de plus qu'il n'y a eu de jetons, jamais 43).
    expect(report.longest).toBeLessThanOrEqual(42);
    // Chaque partie pose au moins un jeton (un abandon n'arrive qu'après le premier).
    expect(report.actions).toBeGreaterThanOrEqual(GAMES);
    // L'état est une grille, une liste de colonnes et un résultat : de l'ordre de la demi-douzaine de centaines d'octets, loin des 50 ko permis. Même une partie
    // neuve pèse plus de cent octets (ses 42 cases).
    expect(report.biggestStateBytes).toBeGreaterThan(100);
    expect(report.biggestStateBytes).toBeLessThan(1_000);
  }, 120_000);

  test('sans aucun abandon : chaque partie se joue jusqu\'au bout, par un alignement ou par la grille pleine', () => {
    const games = Math.min(GAMES, 1_000);
    const report = runGameConformance(connect4, { games, seats: [2], maxActions: 42, illegal, forfeitRate: 0, seed: 50_000 });
    expect(report.games).toBe(games);
    // Sans abandon, une partie est de 7 jetons au moins (quatre du même côté, trois de l'autre) et de 42 au plus.
    expect(report.longest).toBeGreaterThanOrEqual(7);
    expect(report.longest).toBeLessThanOrEqual(42);
  }, 120_000);

  test('avec presque toujours un abandon, à tout moment : le harnais ne trouve rien à redire', () => {
    const report = runGameConformance(connect4, { games: Math.min(GAMES, 500), seats: [2], maxActions: 42, illegal, forfeitRate: 0.9, seed: 90_000 });
    expect(report.games).toBe(Math.min(GAMES, 500));
  }, 120_000);

  test('le générateur de coups illégaux ne fabrique que des coups que le jeu refuse, de chacune des quatre sortes', () => {
    const noDraw = scriptedRng([]);
    const seen = new Set<Kind>();
    for (let game = 0; game < 300; game++) {
      const choice = seededRng(game + 1);
      let state = connect4.create({ seats: 2, first: pickIndex(choice, 2) }, noDraw).state;
      for (;;) {
        const seat = connect4.turn(state);
        if (seat === null) break;
        for (let attempt = 0; attempt < 3; attempt++) {
          const { move, kind } = illegalMove(state, choice);
          seen.add(kind);
          expect(connect4.apply(state, seat, move as never, noDraw), `${kind} : ${JSON.stringify(move)}`).toMatchObject({ ok: false });
        }
        const legal = connect4.legalMoves(state, seat);
        const out = connect4.apply(state, seat, legal[pickIndex(choice, legal.length)]!, noDraw);
        if (!out.ok) throw new Error(`apply refuse un coup légal : ${out.error}`);
        state = out.state;
      }
    }
    expect([...seen].sort()).toStrictEqual(['colonne fractionnaire', 'colonne négative', 'colonne pleine', 'colonne trop grande']);
  });
});
