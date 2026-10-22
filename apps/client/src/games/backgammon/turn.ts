import { maxPlayableSteps, type BackgammonState, type BgStep } from '@bureau/shared/games/backgammon';

// Construire un tour pas à pas, côté interface : le moteur dit quelles étapes laissent finir un tour légal (`nextSteps`), ici on en tire ce qui s'éclaire (les pions qu'on peut
// prendre, les arrivées de celui qu'on a pris) et l'étape qu'un clic fait. Rien d'autre à décider : le coup envoyé au serveur est le `play` de toutes les étapes, une fois le tour
// complet.

export type Source = BgStep['from'];
export type Target = BgStep['to'];

// Les pions qu'on peut prendre : le départ de chaque étape proposée, une fois, dans l'ordre où elles viennent.
export function sourcesOf(steps: readonly BgStep[]): Source[] {
  return [...new Set(steps.map((step) => step.from))];
}

// Les arrivées du pion pris : celles de ses étapes, une fois chacune (deux dés qui sortent le même pion ne font qu'une arrivée : la sortie).
export function targetsFrom(steps: readonly BgStep[], from: Source): Target[] {
  return [...new Set(steps.filter((step) => step.from === from).map((step) => step.to))];
}

// L'étape d'un clic sur cette arrivée avec ce pion. Quand deux dés le permettent (la sortie : un dé juste, un plus fort), on joue le plus petit : le plus grand reste pour un
// autre pion, qui n'aura peut-être que lui. Toute étape proposée laisse finir un tour légal, le choix n'a donc pas d'autre conséquence.
export function pickStep(steps: readonly BgStep[], from: Source, to: Target): BgStep | null {
  let best: BgStep | null = null;
  for (const step of steps) {
    if (step.from === from && step.to === to && (best === null || step.die < best.die)) best = step;
  }
  return best;
}

// Le tour est complet quand on a joué autant de dés que les règles l'exigent (R7) : alors « Valider » s'allume. Jamais hors de la phase `move`.
export function isTurnComplete(state: BackgammonState, done: readonly BgStep[]): boolean {
  return state.phase === 'move' && done.length === maxPlayableSteps(state);
}

// Quels dés affichés sont joués, et donc s'estompent : deux dés différents, celui dont la valeur est dans une étape faite ; un doublé, dont chaque dé affiché vaut deux étapes :
// le premier est joué après deux, le second après quatre.
export function diceUsed(state: BackgammonState, done: readonly BgStep[]): [boolean, boolean] {
  const [first, second] = state.dice;
  if (first === undefined || second === undefined) return [false, false];
  if (first === second) return [done.length >= 2, done.length >= 4];
  return [done.some((step) => step.die === first), done.some((step) => step.die === second)];
}

// Ce qui change quand le serveur répond : le trait, la phase, les dés, les tours joués. Les étapes qu'on a posées en attendant ne valent que pour cette clé ; quand elle change,
// elles sont soit envoyées et jouées, soit périmées.
export function turnKey(state: BackgammonState): string {
  return `${state.turn}:${state.phase}:${state.dice.join('')}:${state.turns}`;
}
