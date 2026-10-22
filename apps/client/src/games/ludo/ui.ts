import type { GameResult } from '@bureau/shared';
import { LUDO_HOME, LUDO_REROLL_DIE, LUDO_STABLE, type LudoEvent, type LudoState } from '@bureau/shared/games/ludo';
import type { SfxId } from '../../audio/catalog';
import { ludoFr, t } from './fr';
import { NEUTRAL_COLOR, SEAT_COLORS } from './palette';

// La partie « contrat » du module des petits chevaux (`GameUi`, games/types.ts), en fonctions pures : la pastille de chaque siège, la phrase de fin de partie, ce que le lecteur
// d'écran entend de chaque événement, et les sons. Le plateau (Board.tsx) et l'aide « Règles » complètent le module (index.tsx).

// Le nom et la couleur d'un siège. Un siège n'est pas une couleur : l'état dit la couleur de chacun (à deux, le siège 1 est jaune). Un siège qui n'existe pas (l'aperçu en a moins que
// le jeu) a une pastille neutre et pas de nom.
export function seatLabel(seat: number, state: LudoState): { name: string; color: string } {
  const color = state.colors[seat];
  if (color === undefined) return { name: '', color: NEUTRAL_COLOR };
  return { name: ludoFr.colorNames[color] ?? '', color: SEAT_COLORS[color] ?? NEUTRAL_COLOR };
}

// La fin d'une partie. La plateforme écrit les sorties (abandon, délai, départ) ; la raison du jeu, `finished`, est dite ici. Une autre raison, que la plateforme aurait laissée
// passer, se dit comme une victoire : le premier du classement gagne.
export function describeResult(result: GameResult, names: string[], _state: LudoState): string {
  const winner = names[result.ranking[0]?.[0] ?? -1] ?? '';
  return t(result.reason === 'finished' ? ludoFr.end.finished : ludoFr.end.winner, { name: winner });
}

// « de Bastien », « d'Alice » : la préposition devant le nom de la victime d'une prise, élidée devant une voyelle ou un h.
function of(name: string): string {
  return /^[aeiouyàâäéèêëîïôöùûüœæh]/i.test(name) ? `d'${name}` : `de ${name}`;
}

// Une phrase pour le lecteur d'écran sur ce que ces événements ont provoqué, ou rien (le trait qui passe et la fin de la partie, la plateforme les dit). Un 6 joué fait rejouer le même
// siège sans événement qui le dise : la phrase « Encore un lancer. » le dit à sa place.
export function announce(events: LudoEvent[], _state: LudoState, names: string[]): string | null {
  const nameOf = (seat: number): string => names[seat] || ludoFr.someone;
  const sentences: string[] = [];
  let sixPlayed = false;
  let turnEnded = false;
  for (const event of events) {
    switch (event.type) {
      case 'dice':
        sentences.push(t(ludoFr.announce.dice, { name: nameOf(event.seat), value: event.value }));
        break;
      case 'move': {
        const name = nameOf(event.seat);
        if (event.from === LUDO_STABLE) sentences.push(t(ludoFr.announce.exit, { name }));
        else if (event.to === LUDO_HOME) sentences.push(t(ludoFr.announce.arrive, { name, n: event.horse + 1 }));
        else sentences.push(t(ludoFr.announce.advance, { name, n: event.horse + 1, steps: event.to - event.from }));
        if (event.from === LUDO_STABLE || event.to - event.from === LUDO_REROLL_DIE) sixPlayed = true;
        break;
      }
      case 'capture':
        sentences.push(t(ludoFr.announce.capture, { name: nameOf(event.seat), victim: of(nameOf(event.victim.seat)) }));
        break;
      case 'pass':
        if (event.reason === 'no-move') sentences.push(t(ludoFr.announce.noMove, { name: nameOf(event.seat) }));
        else if (event.reason === 'third-six') sentences.push(ludoFr.announce.thirdSix);
        else sentences.push(ludoFr.announce.again);
        break;
      case 'forfeit':
        sentences.push(t(ludoFr.announce.forfeit[event.reason], { name: nameOf(event.seat) }));
        break;
      case 'turn':
      case 'end':
        turnEnded = true;
        break;
    }
  }
  if (sixPlayed && !turnEnded) sentences.push(ludoFr.announce.again);
  return sentences.length > 0 ? sentences.join(' ') : null;
}

// Les effets de ces événements, dans l'ordre : un lancer fait « dice », un déplacement, une sortie ou une prise font « piece ». Le plateau n'appelle jamais le moteur audio.
export function sounds(events: LudoEvent[], _mySeat: number | null): SfxId[] {
  return events.flatMap((event): SfxId[] => (event.type === 'dice' ? ['dice'] : event.type === 'move' || event.type === 'capture' ? ['piece'] : []));
}

// L'aide « Règles » du panneau.
export const ludoRules: string[] = [...ludoFr.rules];
