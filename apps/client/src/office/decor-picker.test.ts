import { DECOR_ITEMS } from '@bureau/shared';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { MAX_DECOR_RECENTS, loadDecorRecents, rememberDecorItem, searchDecorItems, searchKey } from './decor-picker';

const KEY = 'bureau.decor-recents.v1';
const ids = DECOR_ITEMS.map((item) => item.id);

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('les éléments récents', () => {
  test('le dernier pris passe en tête, sans doublon, et la liste est gardée', () => {
    rememberDecorItem(ids[0]!);
    rememberDecorItem(ids[1]!);
    expect(rememberDecorItem(ids[0]!)).toEqual([ids[0], ids[1]]);
    expect(loadDecorRecents()).toEqual([ids[0], ids[1]]);
  });

  test(`${MAX_DECOR_RECENTS} au plus : le plus ancien s'en va`, () => {
    for (const id of ids.slice(0, MAX_DECOR_RECENTS + 3)) rememberDecorItem(id);
    const recents = loadDecorRecents();
    expect(recents).toHaveLength(MAX_DECOR_RECENTS);
    expect(recents[0]).toBe(ids[MAX_DECOR_RECENTS + 2]);
    expect(recents).not.toContain(ids[0]);
  });

  test('ce qui n\'est pas lisible donne une liste vide ; un élément sorti de la banque est écarté', () => {
    expect(loadDecorRecents()).toEqual([]);
    localStorage.setItem(KEY, '{abîmé');
    expect(loadDecorRecents()).toEqual([]);
    localStorage.setItem(KEY, JSON.stringify({ id: ids[0] }));
    expect(loadDecorRecents()).toEqual([]);
    localStorage.setItem(KEY, JSON.stringify(['disparu', ids[2], 7, ids[2]]));
    expect(loadDecorRecents()).toEqual([ids[2]]);
  });

  test('un stockage refusé n\'empêche rien : la liste vaut pour la visite', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(rememberDecorItem(ids[3]!)).toEqual([ids[3]]);
  });
});

describe('la recherche', () => {
  test('sans accents ni majuscules, sur toute la banque', () => {
    expect(searchKey('  Canapé ÉTÉ ')).toBe('canape ete');
    const found = searchDecorItems('CANAPE');
    expect(found.length).toBeGreaterThan(3);
    expect(found.every((item) => searchKey(item.name).includes('canape'))).toBe(true);
  });

  test('une recherche vide ou sans réponse ne trouve rien', () => {
    expect(searchDecorItems('   ')).toEqual([]);
    expect(searchDecorItems('zzzz')).toEqual([]);
  });
});
