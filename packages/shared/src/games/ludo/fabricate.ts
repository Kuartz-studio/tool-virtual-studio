import { LUDO_COLORS } from './board';
import { ludoInvariants } from './invariants';
import type { LudoLast, LudoPhase, LudoState } from './model';

// Ce qu'il faut dire pour fabriquer un état : l'avancée de chaque cheval de chaque siège (la longueur de `horses` donne le nombre de joueurs), le reste a une valeur par défaut.
export interface LudoFabrication {
  horses: number[][];
  // Le siège qui a le trait (0 par défaut).
  turn?: number;
  // `move` si un dé est donné, sinon `roll`.
  phase?: Exclude<LudoPhase, 'over'>;
  die?: number | null;
  sixes?: number;
  tries?: number;
  out?: LudoState['out'];
  moves?: number;
  last?: LudoLast | null;
}

// Un état en cours de partie, fabriqué à la main : pour les tests des règles, des composants et de bout en bout (`debug:game` pose un état tel quel, il faut donc qu'il soit
// légal). Un état illégal lève une erreur qui dit pourquoi : on ne fabrique pas un état que le moteur ne produirait jamais, sauf à en modifier un exprès après coup.
export function fabricateLudo(spec: LudoFabrication): LudoState {
  const colors = LUDO_COLORS[spec.horses.length as keyof typeof LUDO_COLORS];
  if (colors === undefined) throw new RangeError(`fabricateLudo : ${spec.horses.length} sièges, il en faut de 2 à 4.`);
  const die = spec.die ?? null;
  const state: LudoState = {
    colors: [...colors],
    horses: spec.horses.map((row) => [...row]),
    turn: spec.turn ?? 0,
    phase: spec.phase ?? (die === null ? 'roll' : 'move'),
    die,
    sixes: spec.sixes ?? 0,
    tries: spec.tries ?? 0,
    out: (spec.out ?? []).map((entry) => ({ ...entry })),
    moves: spec.moves ?? 0,
    last: spec.last ?? null,
    result: null,
  };
  const problems = ludoInvariants(state);
  if (problems.length > 0) throw new Error(`fabricateLudo : l'état n'est pas légal : ${problems.join(' ; ')}`);
  return state;
}
