import { describe, expect, test } from 'vitest';
import { runGameConformance } from '../conformance';
import { pickIndex, seededRng } from '../rng';
import { FORFEIT_REASONS, type Rng } from '../types';
import { LUDO_HOME, LUDO_HORSES, LUDO_STABLE, ludo, trackCell, type LudoEvent, type LudoState } from './index';

// Le paquet partagé ne charge pas les types de Node (son tsconfig n'a pas de `types`) : on déclare seulement ce que ce fichier lit, l'environnement du processus de test.
declare const process: { env: Record<string, string | undefined> };

// Les parties au hasard des petits chevaux : 300 par défaut (`pnpm test`), `JEUX_FUZZ=10000` pour la recette de dix mille.
const GAMES = Number(process.env.JEUX_FUZZ ?? 300);
// 120 s pour les 300 parties du test courant ; une recette plus grande a un délai qui grandit avec elle, sans quoi elle serait coupée en route.
const TIMEOUT_MS = Math.max(120_000, GAMES * 100);
// Le garde-fou du harnais : une partie qui dépasse ce nombre d'actions n'en finit pas, c'est un échec.
const MAX_ACTIONS = 100_000;

// Un coup sans doute illégal, que le harnais essaie une fois sur dix : en phase move, un cheval au hasard (qui peut être jouable : le harnais exige alors que l'état obtenu soit celui
// d'un coup légal) ou un lancer ; en phase roll, jouer un cheval (jamais légal).
function illegal(state: unknown, rng: Rng): unknown {
  const { phase } = state as LudoState;
  if (phase === 'move' && rng() < 0.3) return { type: 'roll' };
  return { type: 'move', horse: pickIndex(rng, LUDO_HORSES) };
}

describe('petits chevaux : parties au hasard', () => {
  test(`${GAMES} parties à 2, 3 et 4 joueurs, avec des sorties : aucun état illégal, toutes finies, rejouées à l'identique`, () => {
    const report = runGameConformance(ludo, { games: GAMES, seats: [2, 3, 4], maxActions: MAX_ACTIONS, forfeitRate: 0.4, illegal });
    expect(report.games).toBe(GAMES);
    // Une partie fait des dizaines de coups, pas deux : le harnais a vraiment joué.
    expect(report.actions).toBeGreaterThanOrEqual(GAMES * 20);
    expect(report.biggestStateBytes).toBeLessThan(2_000);
    // Ce que coûte la recette, pour la noter (seulement quand on a demandé un nombre de parties).
    if (process.env.JEUX_FUZZ !== undefined) {
      console.info(`ludo : ${report.games} parties, ${report.actions} actions, la plus longue ${report.longest}, le plus gros état ${report.biggestStateBytes} octets`);
    }
  }, TIMEOUT_MS);

  test('sans sortie, le harnais finit chaque partie sur un joueur qui a ses quatre chevaux arrivés', () => {
    const report = runGameConformance(ludo, { games: Math.min(GAMES, 100), seats: [2, 3, 4], maxActions: MAX_ACTIONS, forfeitRate: 0, illegal });
    expect(report.games).toBe(Math.min(GAMES, 100));
  }, TIMEOUT_MS);
});

// ---- Plusieurs sorties dans une même partie ----------------------------------------------------------------------------------------------
// Le harnais ne fait sortir qu'un siège par partie. Or c'est la deuxième ou la troisième sortie qui éprouve le classement des sortis (« le dernier sorti devant ceux sortis avant
// lui ») et la fin « il ne reste qu'un siège ». Ces parties-ci font sortir jusqu'à trois sièges à des moments tirés au hasard, et vérifient à chaque pas ce que les règles promettent.

interface Played {
  state: LudoState;
  actions: number;
  departures: number;
}

function playWithDepartures(seed: number, seats: number): Played {
  const pick = seededRng(seed);
  const dice = seededRng(Math.imul(seed, 2654435761) >>> 0);
  const first = pickIndex(pick, seats);
  let state = ludo.create({ seats, first }, dice).state;
  // De zéro à seats − 1 sorties, chacune à un pas tiré dans les 300 premiers (une partie fait bien plus de pas : les dernières tombent parfois après la fin, et sont perdues).
  const steps = Array.from({ length: pickIndex(pick, seats) }, () => 1 + pickIndex(pick, 300)).sort((a, b) => a - b);
  let departures = 0;
  let actions = 0;

  const fail = (message: string): never => {
    throw new Error(`ludo : ${message} (graine ${seed}, ${seats} joueurs, pas ${actions}).`);
  };

  while (state.result === null) {
    if (actions > MAX_ACTIONS) fail(`la partie ne finit pas en ${MAX_ACTIONS} actions`);
    const before = state;
    let events: LudoEvent[];
    let kind: 'roll' | 'move' | 'forfeit';

    if (steps[0] === actions) {
      steps.shift();
      const staying = before.horses.map((_, seat) => seat).filter((seat) => !before.out.some((entry) => entry.seat === seat));
      const seat = staying[pickIndex(pick, staying.length)]!;
      const out = ludo.forfeit(before, seat, FORFEIT_REASONS[pickIndex(pick, FORFEIT_REASONS.length)]!);
      state = out.state;
      events = out.events;
      kind = 'forfeit';
      departures++;
    } else {
      const moves = ludo.legalMoves(before, before.turn);
      const move = moves[pickIndex(pick, moves.length)]!;
      const out = ludo.apply(before, before.turn, move, dice);
      if (!out.ok) return fail(`un coup légal est refusé (${JSON.stringify(move)}) : ${out.error}`);
      state = out.state;
      events = out.events;
      kind = move.type;
    }
    actions++;

    const problems = ludo.invariants(state);
    if (problems.length > 0) fail(`invariants violés : ${problems.join(' ; ')}`);
    checkStep(before, state, events, kind, fail);
  }
  checkResult(state, fail);
  return { state, actions, departures };
}

// Ce qu'une action promet, vu de l'extérieur (les événements et l'état d'avant et d'après), sans refaire les règles.
function checkStep(before: LudoState, after: LudoState, events: LudoEvent[], kind: 'roll' | 'move' | 'forfeit', fail: (message: string) => never): void {
  const seat = before.turn;
  const turnEvents = events.filter((event): event is Extract<LudoEvent, { type: 'turn' }> => event.type === 'turn');
  const ended = events.filter((event) => event.type === 'end');

  // Le trait ne change que par un événement `turn` qui le dit, et tout nouveau tour repart de zéro.
  if (turnEvents.length > 1) fail('plus d\'un événement turn');
  if (turnEvents[0] !== undefined) {
    if (after.turn !== turnEvents[0].seat || after.phase !== 'roll' || after.die !== null || after.sixes !== 0 || after.tries !== 0) fail('un événement turn sans tour neuf');
  } else if (after.result === null && after.turn !== seat) {
    fail(`le trait passe du siège ${seat} au siège ${after.turn} sans événement turn`);
  }
  if (after.out.some((entry) => entry.seat === after.turn) && after.result === null) fail('le trait est à un siège sorti');

  // La fin : un seul événement `end`, qui dit le classement du résultat.
  if ((after.result === null) !== (ended.length === 0)) fail('l\'événement end et le résultat ne vont pas ensemble');
  if (after.result !== null && JSON.stringify(ended[0]) !== JSON.stringify({ type: 'end', ranking: after.result.ranking })) fail('l\'événement end ne reprend pas le classement');

  // Le nombre de coups ne bouge que d'un cheval déplacé.
  if (after.moves !== before.moves + (kind === 'move' ? 1 : 0)) fail(`moves passe de ${before.moves} à ${after.moves} après ${kind}`);

  if (kind === 'roll') {
    const rolled = events[0];
    if (rolled?.type !== 'dice' || rolled.seat !== seat || rolled.value < 1 || rolled.value > 6) return fail('un lancer doit commencer par un événement dice du siège qui lance');
    if (after.phase === 'move' && after.die !== rolled.value) fail('le dé à jouer n\'est pas celui qui vient de sortir');
    if (JSON.stringify(after.horses) !== JSON.stringify(before.horses)) fail('un lancer a déplacé un cheval');
  }

  if (kind === 'move') {
    const moved = events[0];
    if (moved?.type !== 'move' || moved.seat !== seat) return fail('un coup doit commencer par un événement move du siège qui joue');
    const { horse, from, to } = moved;
    if (from !== before.horses[seat]![horse]) fail('le from de l\'événement move n\'est pas l\'avancée d\'avant');
    // Une sortie demande un 6 et se pose sur la case de départ ; sinon le cheval avance exactement du dé.
    const exits = from === LUDO_STABLE;
    if (exits ? to !== 0 || before.die !== 6 : to !== from + before.die!) fail(`le cheval ${horse} va de ${from} à ${to} avec un ${String(before.die)}`);
    if (after.horses[seat]![horse] !== to) fail('le cheval n\'est pas où l\'événement move le dit');
    // Seuls le cheval joué et la victime de la prise ont bougé.
    const capture = events.find((event): event is Extract<LudoEvent, { type: 'capture' }> => event.type === 'capture');
    const cell = trackCell(before.colors[seat]!, to);
    // Les chevaux adverses qui étaient sur la case d'arrivée : il y en a au plus un, et c'est la victime.
    const onCell = before.horses.flatMap((row, owner) =>
      owner === seat ? [] : row.flatMap((advance, index) => (cell !== null && trackCell(before.colors[owner]!, advance) === cell ? [{ seat: owner, horse: index }] : [])),
    );
    if (onCell.length > 1) fail('deux chevaux adverses sur la même case');
    if (JSON.stringify(capture?.victim ?? null) !== JSON.stringify(onCell[0] ?? null)) {
      fail(`la prise (${JSON.stringify(capture?.victim)}) n'est pas le cheval qui était sur la case (${JSON.stringify(onCell[0])})`);
    }
    before.horses.forEach((row, owner) =>
      row.forEach((advance, index) => {
        const isMover = owner === seat && index === horse;
        const isVictim = capture !== undefined && capture.victim.seat === owner && capture.victim.horse === index;
        const now = after.horses[owner]![index];
        if (isVictim && now !== LUDO_STABLE) fail('la victime n\'est pas retournée à l\'écurie');
        if (!isMover && !isVictim && now !== advance) fail(`le cheval ${index} du siège ${owner} a bougé sans raison`);
      }),
    );
    // Le dernier cheval déplacé, avec sa prise ou sans.
    const expectedLast = { seat, horse, from, to, ...(capture ? { captured: capture.victim } : {}) };
    if (JSON.stringify(after.last) !== JSON.stringify(expectedLast)) fail('last ne dit pas le coup qui vient d\'être joué');
    // Un 6 rejoue, sauf si la partie est finie ; tout autre dé passe le tour.
    if (after.result === null) {
      if (before.die === 6 && (after.turn !== seat || after.phase !== 'roll')) fail('un 6 joué doit faire rejouer le même siège');
      if (before.die !== 6 && turnEvents.length === 0) fail('un dé autre que 6 doit passer le tour');
    }
  }

  if (kind === 'forfeit') {
    const gone = after.out[after.out.length - 1]!;
    if (after.out.length !== before.out.length + 1) fail('une sortie doit ajouter un siège à out');
    const left = events[0];
    if (left?.type !== 'forfeit' || left.seat !== gone.seat || left.reason !== gone.reason) return fail('une sortie commence par son événement forfeit');
    if (after.horses[gone.seat]!.some((advance) => advance !== LUDO_STABLE)) fail('un siège sorti garde des chevaux');
    if (events.some((event) => event.type === 'capture')) fail('une sortie n\'est pas une prise');
    // Les autres sièges gardent leurs chevaux à l'avancée près.
    before.horses.forEach((row, owner) => {
      if (owner !== gone.seat && JSON.stringify(row) !== JSON.stringify(after.horses[owner])) fail(`la sortie du siège ${gone.seat} a touché les chevaux du siège ${owner}`);
    });
    // La sortie d'un autre siège ne touche pas au tour de celui qui joue : même trait, même phase, même dé.
    const othersTurnChanged = after.turn !== seat || after.phase !== before.phase || after.die !== before.die;
    if (gone.seat !== seat && after.result === null && othersTurnChanged) fail('la sortie d\'un autre siège a changé le tour de celui qui joue');
  }
}

// La fin d'une partie : un classement complet, le gagnant devant, les sortis derrière dans l'ordre inverse de leur sortie, les autres à leur avancée.
function checkResult(state: LudoState, fail: (message: string) => never): void {
  const result = state.result!;
  const seats = state.horses.length;
  const flat = result.ranking.flat();
  if (flat.length !== seats || new Set(flat).size !== seats) fail(`le classement ${JSON.stringify(result.ranking)} n'a pas chaque siège une fois`);
  const scores = (result.detail as { scores: number[] }).scores;
  if (JSON.stringify(scores) !== JSON.stringify(state.horses.map((row) => row.reduce((sum, advance) => sum + advance + 1, 0)))) fail('detail.scores n\'est pas la somme des avancées + 1');
  const winner = result.ranking[0]![0]!;
  if (result.ranking[0]!.length !== 1 || winner !== state.turn) fail('le gagnant doit être seul en tête, et avoir le trait');
  const gone = state.out.map((entry) => entry.seat).reverse();
  const tail = result.ranking.slice(result.ranking.length - gone.length);
  if (JSON.stringify(tail) !== JSON.stringify(gone.map((seat) => [seat]))) {
    fail(`les sièges sortis ${JSON.stringify(state.out)} ne sont pas derrière, du dernier sorti au premier : ${JSON.stringify(result.ranking)}`);
  }
  if (result.reason === 'finished') {
    if (!state.horses[winner]!.every((advance) => advance === LUDO_HOME)) fail('un gagnant « finished » n\'a pas ses quatre chevaux arrivés');
    // Les autres sièges encore en jeu : à leur avancée, du plus avancé au moins avancé, les égalités groupées.
    const middle = result.ranking.slice(1, result.ranking.length - gone.length);
    const values = middle.map((group) => scores[group[0]!]!);
    if (values.some((value, index) => index > 0 && value >= values[index - 1]!)) {
      fail(`les groupes du milieu ne sont pas triés à l'avancée : ${JSON.stringify(result.ranking)} pour ${JSON.stringify(scores)}`);
    }
    if (middle.some((group) => group.some((seat) => scores[seat] !== scores[group[0]!]))) fail('un groupe d\'ex æquo contient des avancées différentes');
  } else {
    if (!(FORFEIT_REASONS as readonly string[]).includes(result.reason)) fail(`raison de fin inconnue : ${result.reason}`);
    if (state.out.length !== seats - 1 || result.reason !== state.out[state.out.length - 1]!.reason) {
      fail('une fin par sortie doit avoir la raison de la dernière sortie, et un seul siège resté');
    }
  }
}

describe('petits chevaux : plusieurs sorties dans une même partie', () => {
  test(`${GAMES} parties où jusqu'à trois sièges sortent à des moments tirés au hasard : chaque pas tient ce que les règles promettent`, () => {
    let departures = 0;
    let endedByDeparture = 0;
    let finished = 0;
    for (let k = 0; k < GAMES; k++) {
      const seats = 2 + (k % 3);
      const played = playWithDepartures(7_001 + k, seats);
      departures += played.departures;
      if (played.state.result!.reason === 'finished') finished++;
      else endedByDeparture++;
    }
    // Les deux sortes de fin et les sorties en série sont bien exercées (sur 300 parties, aucune de ces nombres n'est proche de zéro).
    if (GAMES >= 100) {
      expect(departures).toBeGreaterThan(GAMES / 3);
      expect(finished).toBeGreaterThan(GAMES / 10);
      expect(endedByDeparture).toBeGreaterThan(GAMES / 10);
    }
  }, TIMEOUT_MS);
});
