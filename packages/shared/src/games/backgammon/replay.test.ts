/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { replayMatch } from '../conformance';
import type { MatchLogEntry } from '../protocol';
import { scriptedRng } from '../rng';
import { backgammon, type BackgammonEvent, type BackgammonState } from './index';

// Des parties enregistrées, rejouées à l'identique : chaque journal est celui que la plateforme garde (`MatchLogEntry[]`, § 4.3 du document des jeux), avec les
// valeurs du générateur de chaque lancer. Les trois premières sont des parties au hasard de graines fixes (3581, 1794 et 1869), choisies parmi quatre mille pour leur
// brièveté et leur variété (un pion frappé, une rentrée depuis la barre, un tour passé) ; les deux autres sont écrites à la main, dans la position qu'un humain
// vérifie à l'œil. Si une règle change, un coup enregistré devient illégal et le rejeu le dit.

const load = (name: string): MatchLogEntry[] => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')) as MatchLogEntry[];
const replay = (log: readonly MatchLogEntry[]): BackgammonState => replayMatch(backgammon as never, log) as BackgammonState;

interface Expected {
  fixture: string;
  winner: 0 | 1;
  reason: string;
  kind: 'simple' | 'gammon' | 'backgammon';
  turns: number;
  off: [number, number];
  points: number[];
}

const EXPECTED: Expected[] = [
  {
    fixture: 'partie-simple',
    winner: 1,
    reason: 'bearoff',
    kind: 'simple',
    turns: 37,
    off: [4, 15],
    points: [6, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    fixture: 'partie-gammon',
    winner: 1,
    reason: 'bearoff',
    kind: 'gammon',
    turns: 36,
    off: [0, 15],
    points: [1, 5, 3, 2, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    fixture: 'partie-backgammon',
    winner: 1,
    reason: 'bearoff',
    kind: 'backgammon',
    turns: 35,
    off: [0, 15],
    points: [1, 1, 4, 2, 1, 3, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  },
  {
    // Les Blancs ont quatorze pions sortis et un sur le point 13 : le doublé de 5 sort le dernier, les Rouges n'ont rien sorti et rien dans la maison des Blancs.
    fixture: 'gammon-pose-a-la-main',
    winner: 0,
    reason: 'bearoff',
    kind: 'gammon',
    turns: 7,
    off: [15, 0],
    points: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -15, 0, 0, 0, 0, 0],
  },
  {
    // Le 3-1 fait le point 5, le 4-2 des Rouges fait leur point 4 (le point 21 des Blancs), le 6-1 fait le point de la barre (7) ; puis les Rouges n'ont pas joué
    // depuis cinq minutes : les Blancs gagnent, victoire simple.
    fixture: 'abandon-en-cours',
    winner: 0,
    reason: 'timeout',
    kind: 'simple',
    turns: 3,
    off: [0, 0],
    points: [-2, 0, 0, 0, 2, 4, 2, 1, 0, 0, 0, -5, 4, 0, 0, 0, -2, 0, -4, 0, -2, 0, 0, 2],
  },
];

describe('backgammon : des parties enregistrées, rejouées à l\'identique', () => {
  for (const expected of EXPECTED) {
    test(`${expected.fixture} : le journal rejoué redonne la partie finie`, () => {
      const log = load(expected.fixture);
      const state = replay(log);
      expect(state.phase).toBe('over');
      expect(state.points).toEqual(expected.points);
      expect(state.off).toEqual(expected.off);
      expect(state.turns).toBe(expected.turns);
      expect(backgammon.result(state)).toEqual({
        ranking: [[expected.winner], [1 - expected.winner]],
        reason: expected.reason,
        detail: { kind: expected.kind },
      });
      expect(backgammon.turn(state)).toBeNull();
      expect(backgammon.invariants(state)).toEqual([]);
      // Un deuxième rejeu donne exactement le même état.
      expect(replay(log)).toEqual(state);
    });
  }

  test('chaque début de partie rejoué est un état légal (invariants vides) et la partie finit à la dernière entrée seulement', () => {
    for (const { fixture } of EXPECTED) {
      const log = load(fixture);
      for (let length = 1; length <= log.length; length++) {
        const state = replay(log.slice(0, length));
        expect(backgammon.invariants(state), `${fixture}, ${length} entrées`).toEqual([]);
        if (length < log.length) expect(state.phase, `${fixture}, ${length} entrées`).not.toBe('over');
      }
    }
  });

  test('la partie simple contient bien ce qu\'on lui demande : un pion frappé, une rentrée, un tour passé, des sorties', () => {
    // On rejoue à la main pour lire les événements, que `replayMatch` ne rend pas.
    let state: BackgammonState | undefined;
    const events: BackgammonEvent[] = [];
    for (const entry of load('partie-simple')) {
      if (entry.kind === 'create') state = backgammon.create(entry.setup, scriptedRng(entry.rng)).state;
      else if (entry.kind === 'move') {
        const result = backgammon.apply(state!, entry.seat, entry.move as never, scriptedRng(entry.rng));
        if (!result.ok) throw new Error(result.error);
        state = result.state;
        events.push(...result.events);
      }
    }
    expect(events.some((event) => event.type === 'step' && event.hit)).toBe(true);
    expect(events.some((event) => event.type === 'step' && event.from === 'bar')).toBe(true);
    expect(events.some((event) => event.type === 'pass')).toBe(true);
    expect(events.some((event) => event.type === 'step' && event.to === 'off')).toBe(true);
    expect(events.at(-1)).toEqual({ type: 'end', winner: 1, kind: 'simple' });
  });

  test('un journal altéré est refusé : un dé changé rend un coup enregistré illégal', () => {
    const log = load('partie-simple');
    const altered = structuredClone(log);
    const firstPlay = altered.find((entry) => entry.kind === 'move' && (entry.move as { type: string }).type === 'play')!;
    ((firstPlay as { move: { steps: Array<{ die: number }> } }).move.steps[0]!).die = 5;
    expect(() => replay(altered)).toThrow(/refusé/);
  });

  test('un lancer dont on a retiré une valeur du générateur lève : le rejeu ne tire que ce que le journal a gardé', () => {
    const altered = structuredClone(load('partie-gammon'));
    const firstRoll = altered.find((entry) => entry.kind === 'move' && entry.rng.length === 2)!;
    (firstRoll as { rng: number[] }).rng = (firstRoll as { rng: number[] }).rng.slice(0, 1);
    expect(() => replay(altered)).toThrow(/plus de valeurs/);
  });

  test('un journal qui s\'arrête en cours de route rejoue une partie en cours, au bon trait', () => {
    const log = load('partie-gammon');
    const state = replay(log.slice(0, 11));
    expect(state.phase).not.toBe('over');
    expect(state.result).toBeNull();
    expect(backgammon.turn(state)).toBe(state.turn);
  });
});
