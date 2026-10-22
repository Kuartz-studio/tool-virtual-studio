import type { BgPosition, BgStep } from './types';

// Une seconde implémentation des règles d'un tour, pour les tests seulement : jamais importée par le jeu. Elle est volontairement naïve et écrite autrement que le
// moteur (`search.ts`), pour que les deux ne se trompent pas ensemble : les coordonnées sont celles du tableau `points` (aucune conversion de numérotation : un siège va
// vers les petits index, l'autre vers les grands, et la barre est un index virtuel juste hors du plateau), chaque étape recopie toute la position, et on essaie tous les
// ordres des dés l'un après l'autre, sans mémoire. C'est lent, et c'est le but : chaque règle s'y lit comme dans le texte.
// `oracle.test.ts` compare les deux sur des milliers de positions.

const POINTS = 24;
const CHECKERS = 15;
const HOME = 6;

export interface ReferenceSequence {
  steps: BgStep[];
  // La position qu'elle laisse.
  final: BgPosition;
}

export interface ReferenceTurn {
  // Le nombre de dés qu'il faut jouer (0 : aucun coup possible, le tour est perdu).
  max: number;
  // Toutes les suites d'étapes qui jouent `max` dés, dans tous les ordres, sans oublier la règle du plus grand dé.
  legal: ReferenceSequence[];
  // Toutes les autres suites d'étapes permises une à une (dont la suite vide) : trop courtes, ou qui jouent le petit dé quand il fallait le grand.
  rejected: ReferenceSequence[];
}

const copy = (position: BgPosition): BgPosition => ({ points: [...position.points], bar: [position.bar[0], position.bar[1]], off: [position.off[0], position.off[1]] });

// Les étapes permises avec ce dé, sur la position telle qu'elle est.
function singleSteps(position: BgPosition, seat: 0 | 1, die: number): Array<{ step: BgStep; after: BgPosition }> {
  const sign = seat === 0 ? 1 : -1;
  // Le siège 0 va vers l'index 0 et sort par la gauche ; le siège 1 va vers l'index 23 et sort par la droite. Son numéro de point : i + 1 pour l'un, 24 − i pour l'autre.
  const direction = seat === 0 ? -1 : 1;
  const pointNo = (index: number): number => (seat === 0 ? index + 1 : POINTS - index);
  const mine = (index: number): number => (position.points[index]! * sign > 0 ? Math.abs(position.points[index]!) : 0);
  const theirs = (index: number): number => (position.points[index]! * sign < 0 ? Math.abs(position.points[index]!) : 0);
  const inHome = (index: number): boolean => (seat === 0 ? index < HOME : index >= POINTS - HOME);
  // Plus loin de la sortie que ce point.
  const farther = (index: number, than: number): boolean => (seat === 0 ? index > than : index < than);

  const owned: number[] = [];
  for (let index = 0; index < POINTS; index++) if (mine(index) > 0) owned.push(index);
  const onBar = position.bar[seat]!;
  const allHome = onBar === 0 && owned.every(inHome);
  // La barre est juste avant le premier point que le pion traverse : un index virtuel hors du plateau.
  const barIndex = seat === 0 ? POINTS : -1;
  const sources: Array<'bar' | number> = onBar > 0 ? ['bar'] : owned;

  const results: Array<{ step: BgStep; after: BgPosition }> = [];
  for (const source of sources) {
    const startIndex = source === 'bar' ? barIndex : source;
    const target = startIndex + direction * die;
    const after = copy(position);
    if (source === 'bar') after.bar[seat] = onBar - 1;
    else after.points[source] = position.points[source]! - sign;
    const from: BgStep['from'] = source === 'bar' ? 'bar' : pointNo(source);

    if (target >= 0 && target < POINTS) {
      if (theirs(target) >= 2) continue;
      if (theirs(target) === 1) {
        after.points[target] = 0;
        after.bar[1 - seat] = position.bar[1 - seat]! + 1;
      }
      after.points[target] = after.points[target]! + sign;
      results.push({ step: { from, to: pointNo(target), die }, after });
    } else {
      // Au-delà du plateau : la sortie. Seulement avec tous ses pions dans la maison ; avec le dé juste, ou plus fort si aucun pion n'est plus loin de la sortie.
      if (source === 'bar' || !allHome) continue;
      const exact = seat === 0 ? target === -1 : target === POINTS;
      if (!exact && owned.some((index) => farther(index, source))) continue;
      after.off[seat] = position.off[seat]! + 1;
      results.push({ step: { from, to: 'off', die }, after });
    }
  }
  return results;
}

export function referenceTurn(position: BgPosition, seat: 0 | 1, dice: readonly number[]): ReferenceTurn {
  const [a, b] = dice as [number, number];
  const orders = a === b ? [[a, a, a, a]] : [[a, b], [b, a]];
  const seen = new Set<string>();
  const all: ReferenceSequence[] = [];
  const walk = (current: BgPosition, order: number[], index: number, steps: BgStep[]): void => {
    const signature = JSON.stringify(steps);
    if (!seen.has(signature)) {
      seen.add(signature);
      all.push({ steps, final: current });
    }
    if (index === order.length) return;
    for (const { step, after } of singleSteps(current, seat, order[index]!)) walk(after, order, index + 1, [...steps, step]);
  };
  for (const order of orders) walk(position, order, 0, []);

  const max = Math.max(...all.map((sequence) => sequence.steps.length));
  let legal = all.filter((sequence) => sequence.steps.length === max && max > 0);
  // Un seul dé joué, deux dés différents : le plus grand s'il se joue.
  if (max === 1 && a !== b) {
    const larger = Math.max(a, b);
    if (legal.some((sequence) => sequence.steps[0]!.die === larger)) legal = legal.filter((sequence) => sequence.steps[0]!.die === larger);
  }
  const kept = new Set(legal);
  return { max, legal, rejected: all.filter((sequence) => !kept.has(sequence) && !(max === 0 && sequence.steps.length === 0)) };
}

// Une position tirée au hasard, pour comparer les deux implémentations sur des cas que le jeu ne produit pas souvent : barre pleine, sortie avec des pions adverses
// qui tiennent des points de la maison, points fermés… `unit()` rend un nombre dans [0, 1).
export function randomPosition(unit: () => number): BgPosition {
  const pick = (n: number): number => Math.min(n - 1, Math.floor(unit() * n));
  const points = new Array<number>(POINTS).fill(0);
  const bar: [number, number] = [0, 0];
  const off: [number, number] = [0, 0];
  // Un style par camp : partout sur le plateau, ou en train de sortir (tout à la maison, une partie déjà sortie), ou avec des pions sur la barre.
  for (const seat of [0, 1] as const) {
    const style = pick(4);
    bar[seat] = style === 2 ? 1 + pick(3) : pick(8) === 0 ? 1 : 0;
    // Jamais les quinze sortis : la partie serait finie.
    off[seat] = style === 1 ? pick(CHECKERS - bar[seat]) : pick(10) === 0 ? pick(4) : 0;
    const onBoard = CHECKERS - bar[seat] - off[seat];
    const sign = seat === 0 ? 1 : -1;
    const home = Array.from({ length: HOME }, (_, k) => (seat === 0 ? k : POINTS - 1 - k));
    for (let placed = 0; placed < onBoard; placed++) {
      // Les camps ne partagent pas un point : on cherche un point libre ou déjà à soi.
      for (let attempt = 0; attempt < 200; attempt++) {
        const index = style === 1 ? home[pick(HOME)]! : pick(POINTS);
        const value = points[index]!;
        if (value === 0 || value * sign > 0) {
          points[index] = value + sign;
          // Une fois sur trois, on empile par deux : plus de points fermés.
          if (pick(3) === 0 && placed + 1 < onBoard) {
            points[index] = points[index]! + sign;
            placed++;
          }
          break;
        }
      }
    }
  }
  // Le tirage peut manquer de place pour un camp (200 essais sans point libre) : on complète en posant sur la barre ce qui n'a pas trouvé de point.
  for (const seat of [0, 1] as const) {
    const sign = seat === 0 ? 1 : -1;
    const onBoard = points.reduce((total, value) => total + (value * sign > 0 ? Math.abs(value) : 0), 0);
    bar[seat] = CHECKERS - off[seat] - onBoard;
  }
  return { points, bar, off };
}
