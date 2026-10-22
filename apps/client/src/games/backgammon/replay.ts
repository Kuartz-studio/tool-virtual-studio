import { mirrorPoint, pointIndex, type BackgammonEvent, type BgPosition } from '@bureau/shared/games/backgammon';

// Rejouer le tour de l'adversaire pion par pion. Le plateau reçoit l'état d'après ; pour le montrer en mouvement, on retrouve la position d'avant en défaisant les étapes des
// événements (chacune dit d'où, vers où, et si un pion a été frappé : c'est assez pour défaire), puis on les refait une à une.

export type StepEvent = Extract<BackgammonEvent, { type: 'step' }>;

// Les étapes d'un lot d'événements, dans l'ordre, et seulement celles de ce siège si on en donne un.
export function stepEvents(events: readonly BackgammonEvent[], seat?: number): StepEvent[] {
  return events.filter((event): event is StepEvent => event.type === 'step' && (seat === undefined || event.seat === seat));
}

// Ajoute ou retire un pion de ce siège sur ce point (sa numérotation). Jamais de -0 : une somme d'entiers qui s'annulent donne +0.
function addChecker(points: number[], seat: number, point: number, delta: 1 | -1): void {
  const index = pointIndex(seat, point);
  points[index] = points[index]! + (seat === 0 ? delta : -delta);
}

const copy = (position: BgPosition): BgPosition => ({ points: [...position.points], bar: [position.bar[0], position.bar[1]], off: [position.off[0], position.off[1]] });

// La position après cette étape : le pion part de la barre ou de son point, un pion adverse seul qui était sur l'arrivée part sur la barre, le pion prend l'arrivée ou sort.
export function applyStepEvent(position: BgPosition, event: StepEvent): BgPosition {
  const next = copy(position);
  const other = event.seat === 0 ? 1 : 0;
  if (event.from === 'bar') next.bar[event.seat]--;
  else addChecker(next.points, event.seat, event.from, -1);
  if (event.to === 'off') next.off[event.seat]++;
  else {
    if (event.hit) {
      // Le pion frappé est sur le même point, que l'adversaire numérote à l'envers.
      addChecker(next.points, other, mirrorPoint(event.to), -1);
      next.bar[other]++;
    }
    addChecker(next.points, event.seat, event.to, 1);
  }
  return next;
}

function undoStepEvent(position: BgPosition, event: StepEvent): BgPosition {
  const next = copy(position);
  const other = event.seat === 0 ? 1 : 0;
  if (event.to === 'off') next.off[event.seat]--;
  else {
    addChecker(next.points, event.seat, event.to, -1);
    if (event.hit) {
      next.bar[other]--;
      addChecker(next.points, other, mirrorPoint(event.to), 1);
    }
  }
  if (event.from === 'bar') next.bar[event.seat]++;
  else addChecker(next.points, event.seat, event.from, 1);
  return next;
}

// La position d'avant ces étapes, retrouvée depuis celle d'après : on défait la dernière d'abord.
export function undoStepEvents(position: BgPosition, steps: readonly StepEvent[]): BgPosition {
  return [...steps].reverse().reduce(undoStepEvent, position);
}
