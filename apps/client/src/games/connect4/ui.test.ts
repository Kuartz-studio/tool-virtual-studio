import type { GameResult } from '@bureau/shared';
import { playColumns, type Connect4Event } from '@bureau/shared/games/connect4';
import { describe, expect, test } from 'vitest';
import { connect4Fr } from './fr';
import ui from './index';
import { TOKEN_PALETTES } from './sprites';
import { announce, describeResult, rules, seatLabel, sounds } from './ui';

// Ce que le Puissance 4 dit à la plateforme (le contrat `GameUi`, § 9.4 du document des jeux) : le nom et la couleur de chaque siège, la fin de la partie, l'annonce d'un coup au lecteur
// d'écran, les sons d'un lot d'événements, l'aide des règles.

const NAMES = ['Alice', 'Bastien'];
const drop = (seat: 0 | 1, col: number, row: number): Connect4Event => ({ type: 'drop', seat, col, row });
const state = playColumns(0, []);

describe('le module du jeu', () => {
  test('l\'export par défaut de index.tsx est un GameUi complet : plateau, nom de siège, fin, annonce, sons, règles', () => {
    expect(Object.keys(ui).sort()).toEqual(['Board', 'announce', 'describeResult', 'rules', 'seatLabel', 'sounds']);
    expect(typeof ui.Board).toBe('function');
    expect(ui.seatLabel).toBe(seatLabel);
    expect(ui.describeResult).toBe(describeResult);
    expect(ui.announce).toBe(announce);
    expect(ui.sounds).toBe(sounds);
    expect(ui.rules).toBe(rules);
  });
});

describe('seatLabel : la pastille de la ligne d\'un joueur', () => {
  test('le siège 0 joue les jetons rouges, le siège 1 les jaunes ; la pastille a la couleur du jeton', () => {
    expect(seatLabel(0, state)).toEqual({ name: 'Rouge', color: TOKEN_PALETTES.red.b });
    expect(seatLabel(1, state)).toEqual({ name: 'Jaune', color: TOKEN_PALETTES.yellow.b });
  });

  test('les textes viennent de fr.ts du jeu, jamais de la plateforme', () => {
    expect(connect4Fr.seats.map((seat) => seat.name)).toEqual(['Rouge', 'Jaune']);
  });
});

describe('describeResult : la fin d\'une partie', () => {
  const four = (winner: number): GameResult => ({ ranking: [[winner], [1 - winner]], reason: 'four', detail: { cells: [18, 19, 20, 21] } });

  test('quatre alignés : le nom du gagnant, quel que soit son siège', () => {
    expect(describeResult(four(0), NAMES, state)).toBe('Quatre alignés : Alice gagne.');
    expect(describeResult(four(1), NAMES, state)).toBe('Quatre alignés : Bastien gagne.');
  });

  test('grille pleine : nulle', () => {
    expect(describeResult({ ranking: [[0, 1]], reason: 'full' }, NAMES, state)).toBe('Grille pleine : nulle.');
  });

  test('les raisons de la plateforme (abandon, délai, départ) sont dites sans se tromper, même si la plateforme les écrit elle-même d\'abord', () => {
    expect(describeResult({ ranking: [[1], [0]], reason: 'resign' }, NAMES, state)).toBe('Alice abandonne. Bastien gagne.');
    expect(describeResult({ ranking: [[0], [1]], reason: 'timeout' }, NAMES, state)).toBe('Bastien n\'a pas joué depuis 5 minutes. Alice gagne.');
    expect(describeResult({ ranking: [[0], [1]], reason: 'disconnect' }, NAMES, state)).toBe('Bastien a quitté le bureau. Alice gagne.');
  });
});

describe('announce : ce que lit le lecteur d\'écran', () => {
  test('un jeton : qui joue, dans quelle colonne (numérotée de 1 à 7)', () => {
    expect(announce([drop(0, 3, 0)], playColumns(0, [3]), NAMES)).toBe('Alice joue en colonne 4.');
    expect(announce([drop(1, 0, 2)], playColumns(0, [0, 0]), NAMES)).toBe('Bastien joue en colonne 1.');
    expect(announce([drop(1, 6, 0)], playColumns(1, [6]), NAMES)).toBe('Bastien joue en colonne 7.');
  });

  test('le jeton qui gagne : la fin s\'ajoute, dite comme la ligne d\'état', () => {
    const won = playColumns(0, [3, 4, 3, 4, 3, 4, 3]);
    expect(announce([drop(0, 3, 3), { type: 'end', winner: 0, cells: [18, 19, 20, 21] }], won, NAMES)).toBe('Alice joue en colonne 4. Quatre alignés : Alice gagne.');
  });

  test('le jeton qui remplit la grille : nulle', () => {
    const full = playColumns(0, '0 2 2 2 2 2 2 0 0 0 0 0 1 3 3 3 3 3 3 1 1 1 1 1 4 6 6 6 6 6 6 4 4 4 4 4 5 5 5 5 5 5'.split(' ').map(Number));
    expect(announce([drop(1, 5, 5), { type: 'end', winner: null, cells: [] }], full, NAMES)).toBe('Bastien joue en colonne 6. Grille pleine : nulle.');
  });

  test('rien à dire sans jeton : aucun événement (un saut d\'état), ou un abandon (la plateforme le dit elle-même)', () => {
    expect(announce([], state, NAMES)).toBeNull();
    expect(announce([{ type: 'forfeit', seat: 1, reason: 'resign' }], state, NAMES)).toBeNull();
  });
});

describe('sounds : les effets d\'un lot d\'événements', () => {
  test('un jeton fait « piece », une fois par jeton', () => {
    expect(sounds([drop(0, 3, 0)], 0)).toEqual(['piece']);
    expect(sounds([drop(0, 3, 0), drop(1, 4, 0)], 1)).toEqual(['piece', 'piece']);
  });

  test('la fin de partie ne fait pas de bruit de plus (la victoire est jouée par la plateforme), ni un abandon, ni un lot vide', () => {
    expect(sounds([drop(0, 3, 3), { type: 'end', winner: 0, cells: [18, 19, 20, 21] }], 0)).toEqual(['piece']);
    expect(sounds([{ type: 'end', winner: null, cells: [] }], 0)).toEqual([]);
    expect(sounds([{ type: 'forfeit', seat: 0, reason: 'timeout' }], 1)).toEqual([]);
    expect(sounds([], null)).toEqual([]);
  });

  test('un spectateur entend les jetons aussi', () => {
    expect(sounds([drop(1, 2, 0)], null)).toEqual(['piece']);
  });
});

describe('rules : l\'aide du panneau', () => {
  test('de quatre à huit phrases courtes, dites en français, sans doublon', () => {
    expect(rules.length).toBeGreaterThanOrEqual(4);
    expect(rules.length).toBeLessThanOrEqual(8);
    expect(new Set(rules).size).toBe(rules.length);
    for (const rule of rules) {
      expect(rule.length, rule).toBeGreaterThan(10);
      expect(rule.length, rule).toBeLessThanOrEqual(140);
      expect(rule, rule).toMatch(/[.]$/);
    }
  });

  test('elles disent l\'essentiel : sept colonnes, quatre alignés, la nulle, le clavier', () => {
    const all = rules.join(' ');
    for (const word of [/sept colonnes/i, /quatre/i, /diagonale/i, /nulle/i, /Entrée/, /1 à 7/]) expect(all).toMatch(word);
  });
});
