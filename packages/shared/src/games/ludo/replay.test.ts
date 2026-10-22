import { describe, expect, test } from 'vitest';
import { replayMatch } from '../conformance';
import type { MatchLogEntry } from '../protocol';
import { scriptedRng } from '../rng';
import type { ForfeitReason } from '../types';
import abandon from './fixtures/deux-joueurs-abandon.json';
import deux from './fixtures/deux-joueurs.json';
import quatre from './fixtures/quatre-joueurs.json';
import troisDeuxSorties from './fixtures/trois-joueurs-deux-sorties.json';
import trois from './fixtures/trois-joueurs.json';
import { ludo, type LudoEvent, type LudoMove, type LudoState } from './index';

// Les parties enregistrées : cinq journaux de parties complètes (`MatchLogEntry[]`, dés compris : chaque lancer garde la valeur que le générateur a rendue), rejoués à l'identique.
// Elles ont été jouées par un joueur qui tire au hasard un coup légal à chaque pas, avec la graine dite dans leur `description` ; deux sortent des sièges à des moments où ils ont
// le trait et à d'autres où ils ne l'ont pas. Si une règle change, ces journaux cessent d'être rejouables : c'est exactement ce qu'ils sont là pour dire.

interface Fixture {
  description: string;
  seats: number;
  log: MatchLogEntry[];
  final: LudoState;
}

// Ce que chaque partie a donné, relevé une fois : le siège qui a commencé, le nombre d'entrées du journal et de chevaux déplacés, les sièges sortis, la fin.
const EXPECTED: Array<{
  name: string;
  fixture: Fixture;
  first: number;
  entries: number;
  moves: number;
  out: Array<{ seat: number; reason: ForfeitReason }>;
  reason: string;
  ranking: number[][];
  scores: number[];
}> = [
  { name: 'deux joueurs, jusqu\'au bout', fixture: deux as unknown as Fixture, first: 0, entries: 354, moves: 161, out: [], reason: 'finished', ranking: [[1], [0]], scores: [165, 228] },
  { name: 'deux joueurs, un abandon', fixture: abandon as unknown as Fixture, first: 1, entries: 92, moves: 44, out: [{ seat: 0, reason: 'timeout' }], reason: 'timeout', ranking: [[1], [0]], scores: [0, 37] },
  {
    name: 'trois joueurs, une sortie',
    fixture: trois as unknown as Fixture,
    first: 1,
    entries: 344,
    moves: 161,
    out: [{ seat: 0, reason: 'timeout' }],
    reason: 'finished',
    ranking: [[2], [1], [0]],
    scores: [0, 205, 228],
  },
  {
    name: 'trois joueurs, deux sorties',
    fixture: troisDeuxSorties as unknown as Fixture,
    first: 2,
    entries: 182,
    moves: 85,
    out: [{ seat: 2, reason: 'disconnect' }, { seat: 1, reason: 'timeout' }],
    reason: 'timeout',
    ranking: [[0], [1], [2]],
    scores: [54, 0, 0],
  },
  {
    name: 'quatre joueurs, deux sorties',
    fixture: quatre as unknown as Fixture,
    first: 2,
    entries: 488,
    moves: 230,
    out: [{ seat: 0, reason: 'resign' }, { seat: 1, reason: 'timeout' }],
    reason: 'finished',
    ranking: [[2], [3], [1], [0]],
    scores: [0, 0, 228, 181],
  },
];

// Rejoue le journal entrée par entrée, comme la plateforme l'a joué : chaque coup l'est par le siège qui a le trait, avec les valeurs du générateur de l'entrée, toutes consommées ;
// chaque état est légal ; la partie ne finit qu'à la dernière entrée. Rend l'état final et tout ce que la partie a provoqué.
function replayStepByStep(log: readonly MatchLogEntry[]): { state: LudoState; events: LudoEvent[] } {
  const [head, ...rest] = log;
  if (head?.kind !== 'create') throw new Error('le journal doit commencer par create');
  const made = ludo.create(head.setup, scriptedRng(head.rng));
  let state = made.state;
  const events: LudoEvent[] = [...made.events];
  rest.forEach((entry, index) => {
    const last = index === rest.length - 1;
    expect(ludo.result(state), `la partie est finie avant l'entrée ${index + 1}`).toBeNull();
    if (entry.kind === 'move') {
      expect(ludo.turn(state), `entrée ${index + 1} : ce n'est pas au siège ${entry.seat} de jouer`).toBe(entry.seat);
      expect(ludo.legalMoves(state, entry.seat), `entrée ${index + 1} : coup illégal`).toContainEqual(entry.move);
      const rng = scriptedRng(entry.rng);
      const out = ludo.apply(state, entry.seat, entry.move as LudoMove, rng);
      if (!out.ok) throw new Error(`entrée ${index + 1} : coup refusé (${out.error})`);
      // Toutes les valeurs du journal ont servi, et pas une de plus.
      expect(() => rng(), `entrée ${index + 1} : le coup n'a pas tiré toutes les valeurs du journal`).toThrow(/plus de valeurs/);
      state = out.state;
      events.push(...out.events);
    } else if (entry.kind === 'forfeit') {
      const out = ludo.forfeit(state, entry.seat, entry.reason);
      expect(out.state.out[out.state.out.length - 1], `entrée ${index + 1} : la sortie n'est pas notée`).toEqual({ seat: entry.seat, reason: entry.reason });
      state = out.state;
      events.push(...out.events);
    } else {
      throw new Error(`entrée ${index + 1} : ni coup ni sortie (${entry.kind})`);
    }
    expect(ludo.invariants(state), `entrée ${index + 1} : état illégal`).toEqual([]);
    expect(ludo.result(state) !== null, `entrée ${index + 1} : la fin de la partie n'est pas à la dernière entrée`).toBe(last);
  });
  return { state, events };
}

describe('petits chevaux : parties enregistrées, rejouées', () => {
  test.each(EXPECTED)('$name : replayMatch redonne l\'état final enregistré, au bit près', ({ fixture, first, entries, moves, out, reason, ranking, scores }) => {
    expect(fixture.log).toHaveLength(entries);
    expect(fixture.log[0]).toMatchObject({ kind: 'create', setup: { seats: fixture.seats, first } });
    const state = replayMatch(ludo, fixture.log) as LudoState;
    expect(state).toStrictEqual(fixture.final);
    expect(state).toMatchObject({ phase: 'over', moves, out, die: null });
    expect(ludo.result(state)).toEqual({ ranking, reason, detail: { scores } });
    expect(ludo.turn(state)).toBeNull();
    expect(ludo.countedMoves(state)).toBe(moves);
    expect(ludo.invariants(state)).toEqual([]);
  });

  test.each(EXPECTED)('$name : pas à pas, chaque coup est légal et joué par celui qui a le trait, chaque état est légal', ({ fixture }) => {
    const { state } = replayStepByStep(fixture.log);
    expect(state).toStrictEqual(fixture.final);
  });

  test.each(EXPECTED)('$name : le journal est contraignant : sans sa dernière entrée la partie n\'est pas finie, avec un dé changé elle n\'est plus la même', ({ fixture }) => {
    const shorter = replayMatch(ludo, fixture.log.slice(0, -1)) as LudoState;
    expect(shorter.result).toBeNull();
    expect(shorter).not.toStrictEqual(fixture.final);

    // Le premier lancer du journal sort un 6 s'il n'en était pas un, et un 1 s'il en était un : un 6 de plus ou de moins change toujours la partie (le 6 sort un cheval et fait
    // rejouer), alors qu'un 2 changé en 5, sans cheval en jeu, aurait donné le même tour perdu. Le coup qui suit n'a plus de sens, ou la partie diverge.
    const firstRoll = fixture.log.findIndex((entry) => entry.kind === 'move' && entry.rng.length > 0);
    const entry = fixture.log[firstRoll] as Extract<MatchLogEntry, { kind: 'move' }>;
    const wasSix = entry.rng[0]! >= 5 / 6;
    const tampered = fixture.log.map((other, index) => (index === firstRoll ? { ...entry, rng: [wasSix ? 0.01 : 0.99] } : other));
    let diverged = false;
    try {
      diverged = JSON.stringify(replayMatch(ludo, tampered)) !== JSON.stringify(fixture.final);
    } catch {
      diverged = true;
    }
    expect(diverged).toBe(true);
  });

  test('ensemble, les cinq parties ont fait jouer tout ce que les règles prévoient : sortie, prise, arrivée, chaque sorte de tour passé, chaque raison de sortie, chaque sorte de fin', () => {
    const events = EXPECTED.flatMap(({ fixture }) => replayStepByStep(fixture.log).events);
    const seen = (predicate: (event: LudoEvent) => boolean): boolean => events.some(predicate);
    expect(seen((event) => event.type === 'dice')).toBe(true);
    expect(seen((event) => event.type === 'move' && event.from === -1 && event.to === 0)).toBe(true);
    expect(seen((event) => event.type === 'move' && event.from >= 0 && event.to === event.from + 1)).toBe(true);
    expect(seen((event) => event.type === 'move' && event.to === 56)).toBe(true);
    expect(seen((event) => event.type === 'move' && event.from >= 0 && event.from <= 50 && event.to >= 51 && event.to <= 55)).toBe(true);
    expect(seen((event) => event.type === 'capture')).toBe(true);
    for (const reason of ['no-move', 'retry', 'bonus', 'third-six'] as const) expect(seen((event) => event.type === 'pass' && event.reason === reason), `aucun pass ${reason}`).toBe(true);
    for (const reason of ['resign', 'timeout', 'disconnect'] as const) expect(seen((event) => event.type === 'forfeit' && event.reason === reason), `aucune sortie ${reason}`).toBe(true);
    expect(seen((event) => event.type === 'turn')).toBe(true);
    expect(events.filter((event) => event.type === 'end')).toHaveLength(EXPECTED.length);
    // Les deux sortes de fin : un joueur qui arrive, des sièges qui sortent jusqu'à n'en laisser qu'un.
    expect(EXPECTED.map(({ reason }) => reason).sort()).toEqual(['finished', 'finished', 'finished', 'timeout', 'timeout']);
    // La partie à deux, jusqu'au bout, a vu un 6 qui ne peut pas être joué et un troisième 6 (la sortie d'un 6 qui rejoue, puis d'un autre, puis le troisième qui passe).
    const full = replayStepByStep(deux.log as unknown as MatchLogEntry[]).events;
    expect(full.some((event) => event.type === 'pass' && event.reason === 'third-six')).toBe(true);
    expect(full.some((event) => event.type === 'pass' && event.reason === 'bonus')).toBe(true);
  });
});
