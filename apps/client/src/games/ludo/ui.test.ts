import { fabricateLudo, ludo, type LudoEvent, type LudoState } from '@bureau/shared/games/ludo';
import { describe, expect, test } from 'vitest';
import { announce, describeResult, ludoRules, seatLabel, sounds } from './ui';

// La partie « contrat » du module des petits chevaux (`GameUi`) : la pastille de chaque siège, la fin de partie, les annonces du lecteur d'écran, les sons, l'aide « Règles ». Le
// plateau lui-même est dans Board.test.tsx.

const STABLE = [-1, -1, -1, -1];
const names = ['Alice', 'Bastien', 'Claire', 'Dan'];
const game = (seats: number): LudoState => ludo.create({ seats, first: 0 }, () => 0.5).state;

describe('seatLabel : un siège n\'est pas une couleur', () => {
  test('à quatre joueurs : rouge, vert, jaune, bleu, avec la couleur de leur pastille', () => {
    const state = game(4);
    expect([0, 1, 2, 3].map((seat) => seatLabel(seat, state).name)).toEqual(['Rouge', 'Vert', 'Jaune', 'Bleu']);
    const colors = [0, 1, 2, 3].map((seat) => seatLabel(seat, state).color);
    expect(new Set(colors).size).toBe(4);
    for (const color of colors) expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });

  test('à deux joueurs, couleurs opposées : le siège 1 est jaune ; à trois : rouge, vert, jaune', () => {
    expect([0, 1].map((seat) => seatLabel(seat, game(2)).name)).toEqual(['Rouge', 'Jaune']);
    expect([0, 1, 2].map((seat) => seatLabel(seat, game(3)).name)).toEqual(['Rouge', 'Vert', 'Jaune']);
    // La pastille du jaune est la même, qu'on soit deux ou quatre.
    expect(seatLabel(1, game(2)).color).toBe(seatLabel(2, game(4)).color);
  });

  test('un siège qui n\'existe pas n\'a ni nom ni couleur qui fasse lever : une pastille neutre', () => {
    expect(() => seatLabel(7, game(2))).not.toThrow();
    expect(seatLabel(7, game(2)).name).toBe('');
  });
});

describe('describeResult : la fin d\'une partie', () => {
  test('« finished » : le nom du gagnant, celui du premier du classement', () => {
    const result = { ranking: [[2], [0], [1]], reason: 'finished', detail: { scores: [100, 10, 228] } };
    expect(describeResult(result, names, game(3))).toBe('Claire a ramené ses quatre chevaux.');
  });

  test('les raisons que la plateforme écrit d\'ordinaire ne font pas lever, et nomment le gagnant', () => {
    for (const reason of ['resign', 'timeout', 'disconnect']) {
      const text = describeResult({ ranking: [[1], [0]], reason }, names, game(2));
      expect(text).toContain('Bastien');
    }
  });
});

describe('announce : une phrase pour le lecteur d\'écran', () => {
  const say = (events: LudoEvent[]) => announce(events, game(4), names);

  test('un lancer : « Alice lance un 6. »', () => {
    expect(say([{ type: 'dice', seat: 0, value: 6 }])).toBe('Alice lance un 6.');
    expect(say([{ type: 'dice', seat: 3, value: 1 }])).toBe('Dan lance un 1.');
  });

  test('une sortie : « Alice sort un cheval. » ; avec une prise : « Bastien prend un cheval d\'Alice. »', () => {
    expect(say([{ type: 'move', seat: 0, horse: 0, from: -1, to: 0 }])).toBe('Alice sort un cheval. Encore un lancer.');
    expect(say([{ type: 'move', seat: 1, horse: 2, from: 10, to: 14 }, { type: 'capture', seat: 1, victim: { seat: 0, horse: 0 } }, { type: 'turn', seat: 2 }])).toBe(
      'Bastien avance le cheval 3 de 4. Bastien prend un cheval d\'Alice.',
    );
  });

  test('« de » devant une consonne, « d\' » devant une voyelle ou un h', () => {
    const capture = (victim: number): LudoEvent[] => [{ type: 'capture', seat: 0, victim: { seat: victim, horse: 0 } }];
    expect(say(capture(1))).toBe('Alice prend un cheval de Bastien.');
    expect(say(capture(0))).toBe('Alice prend un cheval d\'Alice.');
    expect(announce(capture(1), game(4), ['Alice', 'Hugo'])).toBe('Alice prend un cheval d\'Hugo.');
    expect(announce(capture(1), game(4), ['Alice', 'Éloïse'])).toBe('Alice prend un cheval d\'Éloïse.');
  });

  test('une arrivée, un pas ordinaire, et un 6 joué qui fait rejouer', () => {
    expect(say([{ type: 'move', seat: 2, horse: 1, from: 54, to: 56 }, { type: 'turn', seat: 3 }])).toBe('Claire amène le cheval 2 à l\'arrivée.');
    expect(say([{ type: 'move', seat: 0, horse: 0, from: 10, to: 13 }, { type: 'turn', seat: 1 }])).toBe('Alice avance le cheval 1 de 3.');
    expect(say([{ type: 'move', seat: 0, horse: 0, from: 10, to: 16 }])).toBe('Alice avance le cheval 1 de 6. Encore un lancer.');
  });

  test('un tour passé : « Claire ne peut pas jouer. », « Troisième 6 : le tour passe. », « Encore un lancer. »', () => {
    expect(say([{ type: 'dice', seat: 2, value: 4 }, { type: 'pass', seat: 2, reason: 'no-move' }, { type: 'turn', seat: 3 }])).toBe('Claire lance un 4. Claire ne peut pas jouer.');
    expect(say([{ type: 'dice', seat: 0, value: 6 }, { type: 'pass', seat: 0, reason: 'third-six' }, { type: 'turn', seat: 1 }])).toBe('Alice lance un 6. Troisième 6 : le tour passe.');
    expect(say([{ type: 'dice', seat: 0, value: 2 }, { type: 'pass', seat: 0, reason: 'retry' }])).toBe('Alice lance un 2. Encore un lancer.');
    expect(say([{ type: 'dice', seat: 0, value: 6 }, { type: 'pass', seat: 0, reason: 'bonus' }])).toBe('Alice lance un 6. Encore un lancer.');
  });

  test('une sortie de siège, avec sa raison', () => {
    expect(say([{ type: 'forfeit', seat: 2, reason: 'resign' }])).toBe('Claire abandonne : ses chevaux quittent le plateau.');
    expect(say([{ type: 'forfeit', seat: 2, reason: 'timeout' }, { type: 'turn', seat: 3 }])).toBe('Claire n\'a pas joué depuis 5 minutes : ses chevaux quittent le plateau.');
    expect(say([{ type: 'forfeit', seat: 2, reason: 'disconnect' }])).toBe('Claire a quitté le bureau : ses chevaux quittent le plateau.');
  });

  test('rien à dire : aucun événement, ou seulement le trait qui passe ou la fin (la plateforme les dit)', () => {
    expect(say([])).toBeNull();
    expect(say([{ type: 'turn', seat: 1 }])).toBeNull();
    expect(say([{ type: 'end', ranking: [[0], [1]] }])).toBeNull();
  });

  test('un siège sans nom (aperçu) ne fait pas lever la phrase', () => {
    expect(announce([{ type: 'dice', seat: 3, value: 5 }], game(4), ['Alice'])).toMatch(/^.+ lance un 5\.$/);
  });
});

describe('sounds : « dice » à chaque lancer, « piece » à chaque déplacement, sortie et prise', () => {
  test('dans l\'ordre des événements', () => {
    expect(sounds([{ type: 'dice', seat: 0, value: 3 }], 0)).toEqual(['dice']);
    expect(sounds([{ type: 'move', seat: 0, horse: 0, from: -1, to: 0 }], 1)).toEqual(['piece']);
    expect(sounds([{ type: 'move', seat: 1, horse: 2, from: 10, to: 14 }, { type: 'capture', seat: 1, victim: { seat: 0, horse: 0 } }, { type: 'turn', seat: 2 }], null)).toEqual(['piece', 'piece']);
    expect(sounds([{ type: 'dice', seat: 0, value: 6 }, { type: 'move', seat: 0, horse: 0, from: -1, to: 0 }], 0)).toEqual(['dice', 'piece']);
  });

  test('rien pour un tour passé, le trait, la fin ni une sortie de siège', () => {
    expect(sounds([{ type: 'pass', seat: 0, reason: 'retry' }, { type: 'turn', seat: 1 }, { type: 'end', ranking: [[0], [1]] }, { type: 'forfeit', seat: 1, reason: 'resign' }], 0)).toEqual([]);
    expect(sounds([], 0)).toEqual([]);
  });
});

describe('rules : l\'aide « Règles » du panneau', () => {
  test('de quatre à huit phrases courtes, qui finissent par un point', () => {
    expect(ludoRules.length).toBeGreaterThanOrEqual(4);
    expect(ludoRules.length).toBeLessThanOrEqual(8);
    for (const rule of ludoRules) {
      expect(rule.length, rule).toBeLessThanOrEqual(160);
      expect(rule.endsWith('.'), rule).toBe(true);
    }
  });

  test('elles disent les règles qui surprennent : le 6, la prise, le compte exact, le troisième 6, et le 6 plus fréquent sans cheval en jeu', () => {
    const all = ludoRules.join(' ');
    expect(all).toMatch(/6/);
    expect(all).toMatch(/renvoie|prend/);
    expect(all).toMatch(/exact/);
    expect(all).toMatch(/trois 6|troisième 6|3e 6/i);
    expect(all).toMatch(/Sans cheval en jeu, [^.]*6[^.]*deux fois sur six\./);
  });
});

// Pour un test de plus loin : un état fabriqué suffit à nommer un siège.
test('seatLabel lit la couleur de l\'état, pas le numéro du siège', () => {
  const state = fabricateLudo({ horses: [STABLE, STABLE] });
  expect(seatLabel(1, state).name).toBe('Jaune');
  expect(seatLabel(1, { ...state, colors: [1, 3] }).name).toBe('Bleu');
});
