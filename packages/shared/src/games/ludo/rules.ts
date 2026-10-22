import { rollDie } from '../rng';
import type { ApplyResult, ForfeitReason, GameResult, GameSetup, Rng } from '../types';
import {
  horseScore,
  LUDO_COLORS,
  LUDO_DIE_SIDES,
  LUDO_ENTRY,
  LUDO_EXIT_DIE,
  LUDO_HOME,
  LUDO_HORSES,
  LUDO_MAX_SIXES,
  LUDO_MAX_TRIES,
  LUDO_REROLL_DIE,
  LUDO_STABLE,
  trackCell,
} from './board';
import type { LudoEvent, LudoLast, LudoMove, LudoState } from './model';

// Les règles des petits chevaux (document des jeux § 16.1 et § 16.3), en fonctions pures : chacune rend un nouvel état, jamais une modification de celui qu'on lui donne.
// Tout se décide dans l'appel qui le provoque : un tour passé faute de coup, la fin de partie, le 6 qui fait rejouer ne sont jamais remis à plus tard (R5).

// Ce qu'une transition rend : le nouvel état et ce qu'elle a provoqué (le client l'anime et en tire les sons).
export interface LudoStep {
  state: LudoState;
  events: LudoEvent[];
}

// Où un cheval arriverait avec un dé, et le cheval adverse qu'il prendrait en s'y arrêtant : de quoi montrer un coup avant de le jouer.
export interface LudoLanding {
  from: number;
  to: number;
  captured: { seat: number; horse: number } | null;
}

// La partie du début : tous les chevaux à l'écurie, le trait à `first`. Une partie qui n'est pas de 2 à 4 joueurs, ou un premier qui n'est pas un siège, est une erreur de la
// plateforme (qui choisit les deux) : on lève, comme le morpion.
export function createLudo(setup: GameSetup): LudoStep {
  const colors = LUDO_COLORS[setup.seats as keyof typeof LUDO_COLORS];
  if (colors === undefined) throw new RangeError(`Les petits chevaux se jouent de 2 à 4 joueurs (reçu : ${setup.seats}).`);
  if (!Number.isInteger(setup.first) || setup.first < 0 || setup.first >= setup.seats) {
    throw new RangeError(`Le premier joueur doit être un siège de 0 à ${setup.seats - 1} (reçu : ${setup.first}).`);
  }
  const state: LudoState = {
    colors: [...colors],
    horses: colors.map(() => Array.from({ length: LUDO_HORSES }, () => LUDO_STABLE)),
    turn: setup.first,
    phase: 'roll',
    die: null,
    sixes: 0,
    tries: 0,
    out: [],
    moves: 0,
    last: null,
    result: null,
  };
  return { state, events: [] };
}

// Un cheval est « en jeu » sur la piste ou dans son allée : ni à l'écurie, ni arrivé. C'est ce qui décide des essais : sans cheval en jeu, on a trois lancers pour sortir.
export function isInPlay(advance: number): boolean {
  return advance >= LUDO_ENTRY && advance < LUDO_HOME;
}

// Les chevaux de ce joueur qu'un dé peut jouer, dans l'ordre 0 à 3.
//  - À l'écurie : seulement avec le dé de sortie, et si sa case de départ n'est pas déjà tenue par un de ses chevaux (jamais deux de la même couleur sur une case). Une seule
//    sortie est listée, celle du premier cheval à l'écurie : les autres seraient le même coup sous un autre nom.
//  - En jeu : sans dépasser l'arrivée (compte exact) et sans finir sur un de ses chevaux, piste ou allée ; l'arrivée, elle, reçoit les quatre.
//  - Arrivé : rien. On passe librement par-dessus tous les chevaux, les siens comme ceux des autres.
export function playableHorses(row: readonly number[], die: number): number[] {
  const playable: number[] = [];
  let exitListed = false;
  row.forEach((advance, horse) => {
    if (advance === LUDO_STABLE) {
      if (die === LUDO_EXIT_DIE && !exitListed && !row.includes(LUDO_ENTRY)) {
        playable.push(horse);
        exitListed = true;
      }
    } else if (isInPlay(advance)) {
      const to = advance + die;
      if (to > LUDO_HOME) return;
      if (to < LUDO_HOME && row.includes(to)) return;
      playable.push(horse);
    }
  });
  return playable;
}

// L'arrivée d'un cheval avec ce dé, et le cheval adverse qu'il prend en s'y arrêtant : sur la piste seulement, aucune case n'est protégée, y compris la case de départ d'un
// adversaire. Deux chevaux n'étant jamais sur la même case de piste, il y a au plus une victime ; l'allée et l'arrivée ne se prennent pas. Ne juge pas la légalité du coup.
export function landingOf(state: LudoState, seat: number, horse: number, die: number): LudoLanding {
  const from = state.horses[seat]![horse]!;
  const to = from === LUDO_STABLE ? LUDO_ENTRY : from + die;
  const cell = trackCell(state.colors[seat]!, to);
  if (cell !== null) {
    for (let other = 0; other < state.horses.length; other++) {
      if (other === seat) continue;
      const victim = state.horses[other]!.findIndex((advance) => trackCell(state.colors[other]!, advance) === cell);
      if (victim !== -1) return { from, to, captured: { seat: other, horse: victim } };
    }
  }
  return { from, to, captured: null };
}

export function legalLudoMoves(state: LudoState, seat: number): LudoMove[] {
  if (state.result !== null || seat !== state.turn) return [];
  if (state.phase === 'roll') return [{ type: 'roll' }];
  if (state.phase === 'move' && state.die !== null) return playableHorses(state.horses[seat]!, state.die).map((horse): LudoMove => ({ type: 'move', horse }));
  return [];
}

// Le siège qui joue après le siège qui a le trait : le suivant qui n'est pas sorti, en faisant le tour des sièges.
function seatAfter(state: LudoState): number {
  const seats = state.horses.length;
  for (let step = 1; step <= seats; step++) {
    const seat = (state.turn + step) % seats;
    if (!state.out.some((entry) => entry.seat === seat)) return seat;
  }
  return state.turn;
}

// Le tour passe : un tour repart de zéro (aucun 6, aucun essai, pas de dé en attente) pour le siège suivant.
function passTurn(state: LudoState, events: LudoEvent[]): LudoStep {
  const seat = seatAfter(state);
  return { state: { ...state, turn: seat, phase: 'roll', die: null, sixes: 0, tries: 0 }, events: [...events, { type: 'turn', seat }] };
}

function scoreOf(row: readonly number[]): number {
  return row.reduce((sum, advance) => sum + horseScore(advance), 0);
}

// Le classement d'une partie finie : le gagnant, puis les autres sièges encore en jeu à leur avancée (la somme de ce que valent leurs chevaux, les ex æquo groupés), puis les
// sièges sortis, le dernier sorti devant ceux qui sont sortis avant lui. À la sortie qui ne laisse qu'un siège, il n'y a personne entre le gagnant et les sortis.
function finish(state: LudoState, winner: number, reason: string, events: LudoEvent[]): LudoStep {
  const scores = state.horses.map(scoreOf);
  const staying = state.horses
    .map((_, seat) => seat)
    .filter((seat) => seat !== winner && !state.out.some((entry) => entry.seat === seat))
    .sort((a, b) => scores[b]! - scores[a]! || a - b);
  const groups: number[][] = [];
  for (const seat of staying) {
    const group = groups[groups.length - 1];
    if (group !== undefined && scores[group[0]!] === scores[seat]) group.push(seat);
    else groups.push([seat]);
  }
  const gone = state.out.map((entry) => [entry.seat]).reverse();
  const ranking = [[winner], ...groups, ...gone];
  const result: GameResult = { ranking, reason, detail: { scores } };
  return { state: { ...state, turn: winner, phase: 'over', die: null, sixes: 0, tries: 0, result }, events: [...events, { type: 'end', ranking }] };
}

// Le lancer : un seul tirage du générateur, dans tous les cas (R3 : le nombre de tirages ne dépend que de l'état et du coup). Le troisième 6 de suite est perdu ; sinon on joue
// si un cheval le peut ; sinon un 6 fait rejouer quand même, un joueur sans cheval en jeu a ses trois essais, et le reste passe le tour.
function rollDice(state: LudoState, rng: Rng): LudoStep {
  const seat = state.turn;
  const row = state.horses[seat]!;
  const die = rollDie(rng, LUDO_DIE_SIDES);
  const events: LudoEvent[] = [{ type: 'dice', seat, value: die }];
  const sixes = die === LUDO_REROLL_DIE ? state.sixes + 1 : state.sixes;
  if (sixes >= LUDO_MAX_SIXES) {
    events.push({ type: 'pass', seat, reason: 'third-six' });
    return passTurn(state, events);
  }
  const inPlay = row.some(isInPlay);
  // Le plafond ne sert qu'à un état fabriqué (trois essais déjà faits, aucun cheval en jeu) : le moteur lui-même n'y arrive jamais, mais l'état rendu doit rester légal (R10).
  const tries = inPlay ? state.tries : Math.min(state.tries + 1, LUDO_MAX_TRIES);
  if (playableHorses(row, die).length > 0) return { state: { ...state, phase: 'move', die, sixes, tries }, events };
  if (die === LUDO_REROLL_DIE) {
    events.push({ type: 'pass', seat, reason: 'bonus' });
    return { state: { ...state, sixes, tries }, events };
  }
  if (!inPlay && tries < LUDO_MAX_TRIES) {
    events.push({ type: 'pass', seat, reason: 'retry' });
    return { state: { ...state, sixes, tries }, events };
  }
  events.push({ type: 'pass', seat, reason: 'no-move' });
  return passTurn(state, events);
}

// Le coup d'un cheval (déjà reconnu jouable) : il avance du dé (ou sort sur sa case de départ), prend le cheval adverse qui s'y trouve, puis la partie s'arrête si ses quatre
// chevaux sont arrivés (même avec un 6 : pas de lancer de plus), le 6 donne un nouveau lancer au même siège, tout autre dé passe le tour.
function playHorse(state: LudoState, horse: number): LudoStep {
  const seat = state.turn;
  const die = state.die!;
  const { from, to, captured } = landingOf(state, seat, horse, die);
  const horses = state.horses.map((row, owner) =>
    row.map((advance, index) => {
      if (owner === seat && index === horse) return to;
      if (captured !== null && owner === captured.seat && index === captured.horse) return LUDO_STABLE;
      return advance;
    }),
  );
  const events: LudoEvent[] = [{ type: 'move', seat, horse, from, to }];
  if (captured !== null) events.push({ type: 'capture', seat, victim: { ...captured } });
  // `captured` n'est dans `last` que s'il y a eu une prise : une clé à `undefined` ne survit pas à un aller-retour par JSON.
  const last: LudoLast = captured === null ? { seat, horse, from, to } : { seat, horse, from, to, captured: { ...captured } };
  const moved: LudoState = { ...state, horses, moves: state.moves + 1, last };
  if (horses[seat]!.every((advance) => advance === LUDO_HOME)) return finish(moved, seat, 'finished', events);
  if (die === LUDO_REROLL_DIE) return { state: { ...moved, phase: 'roll', die: null }, events };
  return passTurn(moved, events);
}

export function applyLudo(state: LudoState, seat: number, move: LudoMove, rng: Rng): ApplyResult<LudoState, LudoEvent> {
  if (state.result !== null) return { ok: false, error: 'game_over' };
  if (seat !== state.turn) return { ok: false, error: 'not_your_turn' };
  // Le coup vient du réseau : on ne lui fait pas confiance (R4), même si le schéma l'a déjà jugé.
  const loose = move as { type?: unknown; horse?: unknown } | null;
  if (loose?.type === 'roll') {
    if (state.phase !== 'roll') return { ok: false, error: 'wrong_phase' };
    return { ok: true, ...rollDice(state, rng) };
  }
  if (loose?.type === 'move') {
    if (state.phase !== 'move' || state.die === null) return { ok: false, error: 'wrong_phase' };
    const horse = loose.horse;
    if (typeof horse !== 'number' || !playableHorses(state.horses[seat]!, state.die).includes(horse)) return { ok: false, error: 'illegal' };
    return { ok: true, ...playHorse(state, horse) };
  }
  return { ok: false, error: 'illegal' };
}

// Un siège sort de la partie sans l'avoir finie : ses chevaux quittent le plateau (sans prise : ce n'est le coup de personne), son tour est sauté pour toujours, et il est
// classé derrière tous ceux qui restent. Il ne reste qu'un siège : il gagne, la partie finit sur la raison de cette sortie. Sinon, la partie continue, et si c'était à lui de
// jouer, le tour passe. Une sortie après la fin, d'un siège déjà sorti ou qui n'existe pas ne change rien (la plateforme n'en envoie pas, mais R10 demande de tenir).
export function forfeitLudo(state: LudoState, seat: number, reason: ForfeitReason): LudoStep {
  const seats = state.horses.length;
  if (state.result !== null || !Number.isInteger(seat) || seat < 0 || seat >= seats || state.out.some((entry) => entry.seat === seat)) return { state, events: [] };
  const horses = state.horses.map((row, owner) => (owner === seat ? row.map(() => LUDO_STABLE) : row));
  const departed: LudoState = { ...state, horses, out: [...state.out, { seat, reason }] };
  const events: LudoEvent[] = [{ type: 'forfeit', seat, reason }];
  const staying = horses.map((_, owner) => owner).filter((owner) => !departed.out.some((entry) => entry.seat === owner));
  if (staying.length === 1) return finish(departed, staying[0]!, reason, events);
  if (state.turn === seat) return passTurn(departed, events);
  return { state: departed, events };
}
