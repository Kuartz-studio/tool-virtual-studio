import type { GameResult } from '@bureau/shared';
import type { BackgammonEvent, BackgammonState, BgStep } from '@bureau/shared/games/backgammon';
import type { SfxId } from '../../audio/catalog';
import { t } from '../../i18n/fr';
import { fr } from './fr';
import { PALETTE } from './sprites';

// Ce que le jeu dit : la pastille de chaque siège, la fin d'une partie, l'annonce de chaque lot d'événements, les sons, et le nom de chaque case pour le lecteur d'écran.

// Le nom et la couleur d'un siège : les Blancs (ivoire) sont le siège 0, les Rouges (rouge brique) le siège 1.
export function seatLabel(seat: number, _state: BackgammonState): { name: string; color: string } {
  return seat === 0 ? { name: fr.seats.white, color: PALETTE.white.f } : { name: fr.seats.red, color: PALETTE.red.f };
}

// « 1 pion blanc », « 5 pions rouges ».
const piecesOf = (count: number, camp: 'white' | 'red'): string => `${count} ${count === 1 ? fr.pieces[camp].one : fr.pieces[camp].many}`;

const kindSuffix = (kind: unknown): string => (kind === 'gammon' ? ` ${fr.end.gammon}` : kind === 'backgammon' ? ` ${fr.end.backgammon}` : '');

// La fin de partie : les quinze pions sortis, avec « Gammon ! » ou « Backgammon ! » quand le perdant n'a rien sorti. Les abandons, délais et départs sont écrits par la
// plateforme (jamais un gammon : ils sont une défaite simple) ; si on les demandait ici, on ne dirait que le vainqueur.
export function describeResult(result: GameResult, names: string[], _state: BackgammonState): string {
  const winner = names[result.ranking[0]?.[0] ?? -1] ?? '';
  if (result.reason === 'bearoff') return `${t(fr.end.bearoff, { name: winner })}${kindSuffix((result.detail as { kind?: unknown } | undefined)?.kind)}`;
  return t(fr.end.wins, { name: winner });
}

// Une étape dite : « 13 vers 8 », « la barre vers 20 », « 3 vers la sortie ».
const spoken = (step: { from: BgStep['from']; to: BgStep['to'] }): string =>
  t(fr.announce.stepFrom, { from: step.from === 'bar' ? fr.announce.fromBar : step.from, to: step.to === 'off' ? fr.announce.toOff : step.to });

// Ce que le lecteur d'écran entend d'un lot d'événements : l'ouverture, un lancer, un tour joué (toutes ses étapes d'une phrase, avec « et frappe » si l'une a frappé), un tour passé,
// la fin. Un abandon n'est pas dit ici : la plateforme l'écrit. Rien à dire : null.
export function announce(events: BackgammonEvent[], _state: BackgammonState, names: string[]): string | null {
  const name = (seat: number): string => names[seat] ?? '';
  const sentences: string[] = [];
  for (let index = 0; index < events.length; index++) {
    const event = events[index]!;
    switch (event.type) {
      case 'opening': {
        const [a, b] = event.rolls[event.rolls.length - 1]!;
        if (event.rolls.length > 1) sentences.push(fr.announce.tie);
        sentences.push(t(fr.announce.opening, { name: name(event.first), a, b }));
        break;
      }
      case 'dice':
        sentences.push(t(fr.announce.rolls, { name: name(event.seat), a: event.values[0], b: event.values[1] }));
        break;
      case 'step': {
        // Les étapes qui se suivent, du même joueur, font une seule phrase.
        const steps = [event];
        while (events[index + 1]?.type === 'step' && (events[index + 1] as typeof event).seat === event.seat) steps.push(events[++index] as typeof event);
        const hit = steps.some((step) => step.hit);
        sentences.push(t(hit ? fr.announce.playsHit : fr.announce.plays, { name: name(event.seat), steps: steps.map(spoken).join(', ') }));
        break;
      }
      case 'pass':
        sentences.push(t(fr.announce.pass, { name: name(event.seat) }));
        break;
      case 'end':
        sentences.push(`${t(fr.end.bearoff, { name: name(event.winner) })}${kindSuffix(event.kind)}`);
        break;
      case 'forfeit':
        break;
    }
  }
  return sentences.length > 0 ? sentences.join(' ') : null;
}

// Les effets sonores de ce lot, dans l'ordre : des dés à chaque lancer (l'ouverture est un lancer), un pion à chaque étape. Le tour passé, la fin et l'abandon n'ont pas de son à eux.
export function sounds(events: BackgammonEvent[], _mySeat: number | null): SfxId[] {
  return events.flatMap((event): SfxId[] => (event.type === 'opening' || event.type === 'dice' ? ['dice'] : event.type === 'step' ? ['piece'] : []));
}

export const rules: string[] = [...fr.rules];

// ─── Les noms des cases : leur numéro, ce qu'elles portent, puis leur état ───

export interface CellState {
  playable?: boolean;
  selected?: boolean;
  target?: boolean;
  moved?: boolean;
}

// Les états qu'on dit, dans l'ordre : choisi (ce qui est choisi est aussi jouable : on ne le dit qu'une fois), jouable, arrivée possible, dernier coup.
function statesOf(state: CellState, feminine = false): string[] {
  const found: string[] = [];
  if (state.selected) found.push(feminine ? fr.states.selectedFeminine : fr.states.selected);
  else if (state.playable) found.push(fr.states.playable);
  if (state.target) found.push(fr.states.target);
  if (state.moved) found.push(fr.states.moved);
  return found;
}

// « Point 13 : 5 pions blancs, jouable », « Point 2 : vide ». `owner` : le camp qui tient le point (0 les Blancs, 1 les Rouges), null s'il est vide.
export function pointLabel(point: number, owner: 0 | 1 | null, count: number, state: CellState): string {
  const content = owner === null || count === 0 ? fr.empty : piecesOf(count, owner === 0 ? 'white' : 'red');
  return [`${t(fr.point, { point })} : ${content}`, ...statesOf(state)].join(', ');
}

// « Barre : 1 pion blanc », « Barre : 2 pions blancs et 3 pions rouges », « Barre : vide ».
export function barLabel(onBar: { white: number; red: number }, state: CellState): string {
  const parts = [onBar.white > 0 ? piecesOf(onBar.white, 'white') : null, onBar.red > 0 ? piecesOf(onBar.red, 'red') : null].filter((part): part is string => part !== null);
  return [`${fr.bar} : ${parts.length > 0 ? parts.join(` ${fr.and} `) : fr.empty}`, ...statesOf(state, true)].join(', ');
}

// « Sortie : 3 pions sortis », « Sortie : aucun pion sorti ».
export function offLabel(count: number, state: CellState): string {
  const content = count === 0 ? fr.noneOff : count === 1 ? fr.offOne : t(fr.offMany, { count });
  return [`${fr.off} : ${content}`, ...statesOf(state, true)].join(', ');
}

// Une étape : « 13→8 », « barre→20 », « 3→sortie » ; un tour : ses étapes séparées par une virgule.
export function stepText(step: BgStep): string {
  return `${step.from === 'bar' ? fr.stepBar : step.from}→${step.to === 'off' ? fr.stepOff : step.to}`;
}
export function stepsText(steps: readonly BgStep[]): string {
  return steps.map(stepText).join(', ');
}

// « Course : toi 142 · Bastien 156 ».
export function raceText(parts: ReadonlyArray<{ name: string; pips: number }>): string {
  return t(fr.race, { parts: parts.map((part) => `${part.name} ${part.pips}`).join(' · ') });
}

// « Sortis : toi 3 · Bastien 0 » : les pions sortis, dits sous le tablier quand il n'a pas de zone de sortie (disposition serrée).
export function offText(parts: ReadonlyArray<{ name: string; off: number }>): string {
  return t(fr.offTotals, { parts: parts.map((part) => `${part.name} ${part.off}`).join(' · ') });
}

// « Dés : 5 et 2 », « Dés : 3 et 3, doublé ».
export function diceLabel(values: readonly number[]): string {
  if (values.length !== 2) return fr.noDice;
  return t(values[0] === values[1] ? fr.diceDouble : fr.dice, { values: `${values[0]} et ${values[1]}` });
}
