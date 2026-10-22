import type { MatchLogEntry } from './protocol';
import { pickIndex, recordingRng, scriptedRng, seededRng } from './rng';
import { FORFEIT_REASONS, type AnyGameDefinition, type Rng } from './types';

// Le harnais de conformité : il joue des parties au hasard contre un jeu (GameDefinition) et vérifie à chaque pas les règles R1 à R10 du document des jeux (§ 2.2) :
// pur, JSON, déterministe, méfiant, transitions dans `apply`, `turn` nul si et seulement si `result` ne l'est pas, classement complet, état petit. Il sert aux
// tests de la plateforme (le morpion, et des jeux faux exprès qu'il doit attraper) et à ceux de chaque vrai jeu. Un échec lève une `Error` qui donne le jeu, la
// graine, le pas et les 30 dernières entrées du journal : de quoi rejouer la partie.

export interface ConformanceOptions {
  // Le nombre de parties au hasard (les tests passent Number(process.env.JEUX_FUZZ ?? le défaut du jeu)).
  games: number;
  // La partie k joue avec la graine seed + k : un échec cite sa graine.
  seed?: number;
  // Les nombres de joueurs essayés à tour de rôle (petits chevaux : [2, 3, 4]).
  seats: number[];
  // Un garde-fou : au-delà de ce nombre d'actions, la partie n'en finit pas, et c'est un échec.
  maxActions: number;
  // La part des parties où un siège tiré au hasard sort à un moment tiré au hasard (0,05 par défaut).
  forfeitRate?: number;
  // Les jeux à nulle par accord : la part des parties finies par accord, après 2 coups comptés (0,01 par défaut).
  drawRate?: number;
  // Un coup sans doute illégal, fabriqué par le jeu : soit refusé, soit accepté avec l'état de l'un des coups légaux.
  illegal?(state: unknown, rng: Rng): unknown;
  // Deux états « au même point » ; par défaut l'égalité profonde stricte.
  sameOutcome?(a: unknown, b: unknown): boolean;
}

export interface ConformanceReport {
  games: number;
  actions: number;
  // La plus longue partie, en actions.
  longest: number;
  // Le plus gros état vu, en octets de JSON.
  biggestStateBytes: number;
}

// Un état reste sous 50 ko de JSON : il part à tout le bureau à chaque coup (R8).
export const MAX_STATE_BYTES = 50_000;
// Combien de coups légaux on essaie contre le schéma de coup à chaque pas.
const SCHEMA_SAMPLE = 20;
// Une fois sur dix, on essaie un coup sans doute illégal.
const ILLEGAL_RATE = 0.1;
// Combien d'entrées du journal on cite dans un échec.
const LOG_TAIL = 30;

// Gèle l'objet et tout ce qu'il contient : une fonction qui modifie son argument lève alors une erreur (R1). Rend l'objet lui-même.
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

// L'égalité profonde stricte : mêmes clés propres (une clé à `undefined` n'est pas une clé absente), même prototype, `Object.is` sur les nombres (−0 et 0 diffèrent).
function strictEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => Object.hasOwn(b, key) && strictEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

// L'état final d'une partie, en rejouant son journal : chaque coup avec les valeurs du générateur qu'il avait tirées, chaque sortie, la nulle, ou un état de
// débogage posé tel quel. Un coup refusé au rejeu lève une erreur.
export function replayMatch(def: AnyGameDefinition, log: readonly MatchLogEntry[]): unknown {
  let state: unknown;
  let started = false;
  for (const entry of log) {
    switch (entry.kind) {
      case 'create':
        state = def.create(entry.setup, scriptedRng(entry.rng)).state;
        started = true;
        break;
      case 'debug':
        state = entry.state;
        break;
      default: {
        if (!started) throw new Error('replayMatch : le journal ne commence pas par `create`.');
        if (entry.kind === 'move') {
          const result = def.apply(state, entry.seat, entry.move, scriptedRng(entry.rng));
          if (!result.ok) throw new Error(`replayMatch : le coup ${JSON.stringify(entry.move)} du siège ${entry.seat} est refusé (${result.error}).`);
          state = result.state;
        } else if (entry.kind === 'forfeit') {
          state = def.forfeit(state, entry.seat, entry.reason).state;
        } else {
          if (!def.agreeDraw) throw new Error('replayMatch : le journal a une nulle par accord, que ce jeu n\'offre pas.');
          state = def.agreeDraw(state).state;
        }
      }
    }
  }
  if (!started) throw new Error('replayMatch : le journal est vide.');
  return state;
}

// Joue `o.games` parties au hasard contre ce jeu, en vérifiant tout. Rend ce qu'elles ont coûté, ou lève la première erreur.
export function runGameConformance(def: AnyGameDefinition, o: ConformanceOptions): ConformanceReport {
  const same = o.sameOutcome ?? strictEqual;
  const forfeitRate = o.forfeitRate ?? 0.05;
  const drawRate = o.drawRate ?? 0.01;
  const report: ConformanceReport = { games: 0, actions: 0, longest: 0, biggestStateBytes: 0 };

  for (let k = 0; k < o.games; k++) {
    const seed = (o.seed ?? 1) + k;
    const seats = o.seats[k % o.seats.length]!;
    const choice = seededRng(Math.imul(seed, 2654435761) >>> 0);
    const log: MatchLogEntry[] = [];
    let step = 0;

    const fail = (message: string): never => {
      throw new Error(`${def.id} : ${message} (graine ${seed}, ${seats} joueurs, pas ${step}).\nDernières entrées du journal : ${JSON.stringify(log.slice(-LOG_TAIL))}`);
    };
    // Appelle une fonction du jeu : une exception devient un échec lisible, qui dit laquelle.
    const call = <T>(name: string, fn: () => T): T => {
      try {
        return fn();
      } catch (err) {
        return fail(`${name} a levé : ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    const first = pickIndex(choice, seats);
    const created = recordingRng(seededRng(seed));
    const made = call('create', () => def.create({ seats, first }, created.rng));
    log.push({ kind: 'create', setup: { seats, first }, rng: created.take() });
    let state: unknown = deepFreeze(made.state);
    deepFreeze(made.events);

    // Ce que cette partie aura de spécial : un siège qui sort, une nulle par accord.
    const forfeitAt = choice() < forfeitRate ? 1 + pickIndex(choice, 40) : -1;
    const forfeitSeat = pickIndex(choice, seats);
    const drawsByAgreement = def.drawOffers && choice() < drawRate;

    // Les règles qui valent pour tout état, avant toute action.
    const checkState = () => {
      const problems = call('invariants', () => def.invariants(state));
      if (problems.length > 0) fail(`invariants violés : ${problems.join(' ; ')}`);
      const bytes = JSON.stringify(state)?.length ?? 0;
      report.biggestStateBytes = Math.max(report.biggestStateBytes, bytes);
      if (bytes > MAX_STATE_BYTES) fail(`l'état est trop gros : ${bytes} octets de JSON, pour ${MAX_STATE_BYTES} au plus`);
      if (!strictEqual(JSON.parse(JSON.stringify(state)), state)) fail('l\'état ne survit pas à un aller-retour par JSON (une clé à undefined, un Map, une Date, une classe, un nombre non fini ?)');
      const turn = call('turn', () => def.turn(state));
      const result = call('result', () => def.result(state));
      if ((turn === null) === (result === null)) fail(`turn (${String(turn)}) et result (${result === null ? 'nul' : 'non nul'}) : exactement l'un des deux doit être nul`);
      for (let seat = 0; seat < seats; seat++) {
        const moves = call('legalMoves', () => def.legalMoves(state, seat));
        if (seat !== turn && moves.length > 0) fail(`legalMoves du siège ${seat} n'est pas vide alors que le trait est à ${String(turn)}`);
      }
      if (result !== null) {
        const ranked = result.ranking.flat().sort((a, b) => a - b);
        if (ranked.length !== seats || ranked.some((seat, index) => seat !== index)) {
          fail(`le classement ${JSON.stringify(result.ranking)} ne contient pas chaque siège une fois`);
        }
      }
    };

    for (;;) {
      checkState();
      if (def.result(state) !== null) break;
      if (step > o.maxActions) fail(`la partie ne finit pas en ${o.maxActions} actions`);

      if (step === forfeitAt) {
        const reason = FORFEIT_REASONS[pickIndex(choice, FORFEIT_REASONS.length)]!;
        const out = call('forfeit', () => def.forfeit(state, forfeitSeat, reason));
        log.push({ kind: 'forfeit', seat: forfeitSeat, reason, at: step });
        state = deepFreeze(out.state);
        deepFreeze(out.events);
        step++;
        continue;
      }
      if (drawsByAgreement && def.agreeDraw && call('countedMoves', () => def.countedMoves(state)) >= 2) {
        const out = call('agreeDraw', () => def.agreeDraw!(state));
        log.push({ kind: 'draw', at: step });
        state = deepFreeze(out.state);
        deepFreeze(out.events);
        step++;
        continue;
      }

      const actor = call('turn', () => def.turn(state))!;
      const legal = call('legalMoves', () => def.legalMoves(state, actor));
      if (legal.length === 0) fail(`aucun coup légal pour le siège ${actor} alors que la partie n'est pas finie : apply doit passer le tour de lui-même`);
      for (const move of legal.slice(0, SCHEMA_SAMPLE)) {
        if (!def.moveSchema.safeParse(move).success) fail(`un coup légal ne passe pas moveSchema : ${JSON.stringify(move)}`);
      }

      // Un coup sans doute illégal : refusé, ou accepté pour de bon (l'état est alors celui de l'un des coups légaux).
      if (o.illegal && choice() < ILLEGAL_RATE) {
        const bad = deepFreeze(o.illegal(state, choice));
        const drawn = recordingRng(seededRng(seed * 31 + step));
        const out = call('apply (coup illégal)', () => def.apply(state, actor, bad, drawn.rng));
        if (out.ok) {
          const values = drawn.take();
          const accepted = legal.some((move) => {
            const twin = def.apply(state, actor, move, scriptedRng(values, () => 0.5));
            return twin.ok && same(twin.state, out.state);
          });
          if (!accepted) fail(`apply a accepté un coup illégal (${JSON.stringify(bad)}) sans qu'il donne l'état d'un coup légal`);
        }
      }

      const move = deepFreeze(legal[pickIndex(choice, legal.length)]);
      const drawn = recordingRng(seededRng(seed * 1_000_003 + step));
      const out = call('apply', () => def.apply(state, actor, move, drawn.rng));
      const values = drawn.take();
      if (!out.ok) return fail(`apply refuse un coup légal (${JSON.stringify(move)}, siège ${actor}) : ${out.error}`);
      // R3 : mêmes données, mêmes valeurs du générateur, même résultat (et le même nombre de tirages : un tirage de plus lèverait ici).
      const twin = call('apply (rejoué)', () => def.apply(state, actor, move, scriptedRng(values)));
      if (!twin.ok || !strictEqual(twin.state, out.state) || !strictEqual(twin.events, out.events)) {
        fail(`apply n'est pas déterministe : le même coup (${JSON.stringify(move)}) avec les mêmes valeurs du générateur donne deux résultats`);
      }
      log.push({ kind: 'move', seat: actor, move, rng: values, at: step });
      state = deepFreeze(out.state);
      deepFreeze(out.events);
      report.actions++;
      step++;
    }

    // Rejouer le journal redonne l'état final.
    const replayed = call('replayMatch', () => replayMatch(def, log));
    if (!same(replayed, state)) fail('rejouer le journal de la partie ne redonne pas son état final');
    report.games++;
    report.longest = Math.max(report.longest, step);
  }
  return report;
}
