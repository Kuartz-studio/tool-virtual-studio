import { pickIndex, seededRng, type GameResult } from '@bureau/shared';
import { backgammon, backgammonStateFrom, STARTING_LAYOUT, type BackgammonEvent } from '@bureau/shared/games/backgammon';
import { describe, expect, test } from 'vitest';
import { SFX } from '../../audio/catalog';
import { announce, barLabel, describeResult, diceLabel, offLabel, offText, pointLabel, raceText, rules, seatLabel, sounds, stepText, stepsText } from './text';

// Les textes du jeu et ce qu'il dit à la plateforme : la pastille de chaque siège, la fin de partie, ce que lit l'écran de lecture, les sons, l'aide des règles, et le nom de chaque case.

const names = ['Alice', 'Bastien'];
const state = backgammonStateFrom({ white: STARTING_LAYOUT, red: STARTING_LAYOUT });
const result = (winner: 0 | 1, kind: 'simple' | 'gammon' | 'backgammon', reason = 'bearoff'): GameResult => ({ ranking: [[winner], [1 - winner]], reason, detail: { kind } });

describe('seatLabel : la pastille de chaque siège', () => {
  test('les Blancs sont le siège 0, les Rouges le siège 1, chacun avec la couleur de ses pions', () => {
    expect(seatLabel(0, state)).toEqual({ name: 'Blancs', color: '#f2ead8' });
    const red = seatLabel(1, state);
    expect(red.name).toBe('Rouges');
    expect(red.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(red.color).not.toBe('#f2ead8');
  });
});

describe('describeResult : la fin d\'une partie, pour toutes les raisons que le moteur écrit', () => {
  test('les quinze pions sortis : « {nom} a sorti tous ses pions. », avec « Gammon ! » ou « Backgammon ! » quand le perdant n\'a rien sorti', () => {
    expect(describeResult(result(0, 'simple'), names, state)).toBe('Alice a sorti tous ses pions.');
    expect(describeResult(result(1, 'simple'), names, state)).toBe('Bastien a sorti tous ses pions.');
    expect(describeResult(result(0, 'gammon'), names, state)).toBe('Alice a sorti tous ses pions. Gammon !');
    expect(describeResult(result(1, 'backgammon'), names, state)).toBe('Bastien a sorti tous ses pions. Backgammon !');
  });

  test('un résultat sans détail : une victoire simple', () => {
    expect(describeResult({ ranking: [[1], [0]], reason: 'bearoff' }, names, state)).toBe('Bastien a sorti tous ses pions.');
  });

  test('les raisons de la plateforme (abandon, délai, départ), si on les lui demandait : le vainqueur, sans gammon (une défaite simple)', () => {
    for (const reason of ['resign', 'timeout', 'disconnect']) {
      expect(describeResult(result(1, 'simple', reason), names, state)).toBe('Bastien gagne.');
    }
    // Même si un détail disait gammon : un abandon n'en est pas un.
    expect(describeResult({ ranking: [[0], [1]], reason: 'resign', detail: { kind: 'gammon' } }, names, state)).toBe('Alice gagne.');
  });

  test('une raison inconnue : le vainqueur', () => {
    expect(describeResult({ ranking: [[0], [1]], reason: 'autre' }, names, state)).toBe('Alice gagne.');
  });
});

describe('announce : ce que lit l\'écran de lecture', () => {
  const at = (...events: BackgammonEvent[]) => announce(events, state, names);

  test('l\'ouverture : qui commence, avec quels dés ; une égalité relancée est dite', () => {
    expect(at({ type: 'opening', rolls: [[5, 2]], first: 0 })).toBe('Alice commence avec 5 et 2.');
    expect(at({ type: 'opening', rolls: [[3, 3], [1, 4]], first: 1 })).toBe('Égalité à l\'ouverture : on relance. Bastien commence avec 1 et 4.');
  });

  test('un lancer : « {nom} lance 5 et 3. »', () => {
    expect(at({ type: 'dice', seat: 0, values: [5, 3] })).toBe('Alice lance 5 et 3.');
    expect(at({ type: 'dice', seat: 1, values: [6, 6] })).toBe('Bastien lance 6 et 6.');
  });

  test('un tour joué : toutes les étapes en une phrase, et « et frappe » si un pion l\'a été', () => {
    const play = (from: number | 'bar', to: number | 'off', hit = false): BackgammonEvent => ({ type: 'step', seat: 0, from, to, die: 1, hit });
    expect(at(play(13, 8), play(13, 10, true))).toBe('Alice joue 13 vers 8, 13 vers 10, et frappe.');
    expect(at(play(13, 8), play(13, 10))).toBe('Alice joue 13 vers 8, 13 vers 10.');
    expect(at(play('bar', 20, true))).toBe('Alice joue la barre vers 20, et frappe.');
    expect(at(play(3, 'off'))).toBe('Alice joue 3 vers la sortie.');
    expect(at({ type: 'step', seat: 1, from: 6, to: 4, die: 2, hit: false })).toBe('Bastien joue 6 vers 4.');
  });

  test('un tour passé : « {nom} ne peut pas jouer. », après le lancer s\'il y en a un', () => {
    expect(at({ type: 'pass', seat: 1 })).toBe('Bastien ne peut pas jouer.');
    expect(at({ type: 'dice', seat: 1, values: [6, 6] }, { type: 'pass', seat: 1 })).toBe('Bastien lance 6 et 6. Bastien ne peut pas jouer.');
  });

  test('la fin : la phrase du résultat ; un abandon n\'est pas annoncé (la plateforme le dit)', () => {
    expect(at({ type: 'end', winner: 0, kind: 'gammon' })).toBe('Alice a sorti tous ses pions. Gammon !');
    expect(at({ type: 'step', seat: 0, from: 3, to: 'off', die: 3, hit: false }, { type: 'end', winner: 0, kind: 'simple' })).toBe('Alice joue 3 vers la sortie. Alice a sorti tous ses pions.');
    expect(at({ type: 'forfeit', seat: 0, reason: 'resign' })).toBeNull();
  });

  test('rien à dire : null', () => {
    expect(announce([], state, names)).toBeNull();
  });
});

describe('sounds : les effets de ce lot, dans l\'ordre', () => {
  test('un son de dés à chaque lancer, ouverture comprise, et un son de pion à chaque étape', () => {
    expect(sounds([{ type: 'opening', rolls: [[5, 2]], first: 0 }], null)).toEqual(['dice']);
    expect(sounds([{ type: 'dice', seat: 0, values: [5, 3] }], 1)).toEqual(['dice']);
    const step = (from: number): BackgammonEvent => ({ type: 'step', seat: 0, from, to: from - 1, die: 1, hit: false });
    expect(sounds([step(13), step(8), step(6)], 0)).toEqual(['piece', 'piece', 'piece']);
    expect(sounds([{ type: 'dice', seat: 0, values: [1, 1] }, step(13)], 0)).toEqual(['dice', 'piece']);
  });

  test('un tour passé, une fin et un abandon ne font aucun son à eux seuls', () => {
    expect(sounds([{ type: 'pass', seat: 0 }], 0)).toEqual([]);
    expect(sounds([{ type: 'end', winner: 0, kind: 'simple' }], 0)).toEqual([]);
    expect(sounds([{ type: 'forfeit', seat: 0, reason: 'timeout' }], 1)).toEqual([]);
    expect(sounds([], 0)).toEqual([]);
  });

  test('chaque effet existe au catalogue des sons', () => {
    for (const id of sounds([{ type: 'dice', seat: 0, values: [1, 2] }, { type: 'step', seat: 0, from: 3, to: 1, die: 2, hit: false }], 0)) expect(Object.hasOwn(SFX, id)).toBe(true);
  });
});

describe('rules : l\'aide du panneau', () => {
  test('de quatre à huit phrases courtes, chacune finie par un point', () => {
    expect(rules.length).toBeGreaterThanOrEqual(4);
    expect(rules.length).toBeLessThanOrEqual(8);
    for (const rule of rules) {
      expect(rule.endsWith('.'), rule).toBe(true);
      expect(rule.length, rule).toBeLessThanOrEqual(150);
    }
  });

  test('elle dit les règles qui comptent : la maison, le doublé, la barre, le plus grand dé, la sortie, le gammon, le clavier', () => {
    const text = rules.join(' ');
    for (const word of ['maison', 'doublé', 'barre', 'plus grand', 'sort', 'gammon', 'Échap']) expect(text, word).toContain(word);
  });
});

describe('les noms des cases, pour le lecteur d\'écran', () => {
  test('un point : son numéro, ce qu\'il porte, puis son état (jouable, sélectionné, arrivée possible, dernier coup)', () => {
    expect(pointLabel(13, 0, 5, { playable: true })).toBe('Point 13 : 5 pions blancs, jouable');
    expect(pointLabel(8, 1, 1, {})).toBe('Point 8 : 1 pion rouge');
    expect(pointLabel(24, 1, 3, {})).toBe('Point 24 : 3 pions rouges');
    expect(pointLabel(2, null, 0, {})).toBe('Point 2 : vide');
    expect(pointLabel(6, 0, 3, { selected: true })).toBe('Point 6 : 3 pions blancs, sélectionné');
    expect(pointLabel(8, null, 0, { target: true })).toBe('Point 8 : vide, arrivée possible');
    expect(pointLabel(4, 1, 2, { moved: true })).toBe('Point 4 : 2 pions rouges, dernier coup');
    expect(pointLabel(7, 0, 1, { target: true, moved: true })).toBe('Point 7 : 1 pion blanc, arrivée possible, dernier coup');
    // Un pion sélectionné est aussi jouable : on ne le dit qu'une fois.
    expect(pointLabel(13, 0, 5, { selected: true, playable: true })).toBe('Point 13 : 5 pions blancs, sélectionné');
  });

  test('la barre : ce qu\'elle porte de chaque couleur, puis son état', () => {
    expect(barLabel({ white: 1, red: 0 }, {})).toBe('Barre : 1 pion blanc');
    expect(barLabel({ white: 0, red: 1 }, { playable: true })).toBe('Barre : 1 pion rouge, jouable');
    expect(barLabel({ white: 2, red: 3 }, {})).toBe('Barre : 2 pions blancs et 3 pions rouges');
    expect(barLabel({ white: 0, red: 0 }, {})).toBe('Barre : vide');
    expect(barLabel({ white: 1, red: 0 }, { selected: true })).toBe('Barre : 1 pion blanc, sélectionnée');
  });

  test('la sortie : les pions sortis, et si elle est une arrivée possible', () => {
    expect(offLabel(0, {})).toBe('Sortie : aucun pion sorti');
    expect(offLabel(1, {})).toBe('Sortie : 1 pion sorti');
    expect(offLabel(3, { target: true })).toBe('Sortie : 3 pions sortis, arrivée possible');
  });

  test('une étape et un tour : « 13→8 », « barre→20 », « 3→sortie », séparées par des virgules', () => {
    expect(stepText({ from: 13, to: 8, die: 5 })).toBe('13→8');
    expect(stepText({ from: 'bar', to: 20, die: 5 })).toBe('barre→20');
    expect(stepText({ from: 3, to: 'off', die: 3 })).toBe('3→sortie');
    expect(stepsText([{ from: 13, to: 8, die: 5 }, { from: 13, to: 11, die: 2 }])).toBe('13→8, 13→11');
    expect(stepsText([])).toBe('');
  });

  test('la course, et les pions sortis (disposition serrée, sans zone de sortie)', () => {
    expect(raceText([{ name: 'toi', pips: 142 }, { name: 'Bastien', pips: 156 }])).toBe('Course : toi 142 · Bastien 156');
    expect(raceText([{ name: 'Alice', pips: 167 }, { name: 'Bastien', pips: 167 }])).toBe('Course : Alice 167 · Bastien 167');
    expect(offText([{ name: 'toi', off: 3 }, { name: 'Bastien', off: 0 }])).toBe('Sortis : toi 3 · Bastien 0');
  });

  test('les dés : leurs valeurs, et « doublé » quand c\'en est un', () => {
    expect(diceLabel([5, 2])).toBe('Dés : 5 et 2');
    expect(diceLabel([3, 3])).toBe('Dés : 3 et 3, doublé');
    expect(diceLabel([])).toBe('Pas de dés');
  });
});

describe('le jeu entier lu par ces textes', () => {
  test('chaque événement d\'une partie au hasard a une phrase ou le silence, jamais « undefined » ni « NaN »', () => {
    const dice = seededRng(7);
    const choice = seededRng(11);
    const created = backgammon.create({ seats: 2, first: 0 }, dice);
    let game = created.state;
    const spoken: string[] = [announce(created.events, game, names) ?? ''];
    for (let guard = 0; guard < 400 && game.phase !== 'over'; guard++) {
      const moves = backgammon.legalMoves(game, game.turn);
      const next = backgammon.apply(game, game.turn, moves[pickIndex(choice, moves.length)]!, dice);
      if (!next.ok) throw new Error(next.error);
      spoken.push(announce(next.events, next.state, names) ?? '');
      game = next.state;
    }
    for (const sentence of spoken) expect(sentence).not.toMatch(/undefined|NaN|null|\[object/);
    expect(spoken.filter(Boolean).length).toBeGreaterThan(100);
  });
});
