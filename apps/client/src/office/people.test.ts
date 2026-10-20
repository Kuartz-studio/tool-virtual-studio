import { describe, expect, test } from 'vitest';
import { sortPeople } from './people';

const person = (id: string, name: string) => ({ id, name });
const names = (people: Array<{ name: string }>) => people.map((p) => p.name);

describe('sortPeople', () => {
  test('en ligne d\'abord, puis ordre alphabétique', () => {
    const members = [person('1', 'Zoé'), person('2', 'Bob'), person('3', 'Alice'), person('4', 'Marc'), person('5', 'Chloé')];
    const { online, offline } = sortPeople(members, new Set(['1', '4']));
    expect(names(online)).toEqual(['Marc', 'Zoé']);
    expect(names(offline)).toEqual(['Alice', 'Bob', 'Chloé']);
  });

  test('tout le monde en ligne, ou personne : une liste vide de l\'autre côté', () => {
    const members = [person('1', 'Bob'), person('2', 'Alice')];
    expect(sortPeople(members, new Set(['1', '2']))).toEqual({ online: [members[1], members[0]], offline: [] });
    expect(sortPeople(members, new Set())).toEqual({ online: [], offline: [members[1], members[0]] });
    expect(sortPeople([], new Set(['1']))).toEqual({ online: [], offline: [] });
  });

  test('l\'ordre est celui du français : les accents ne rejettent pas un nom en fin de liste', () => {
    const members = [person('1', 'Zoé'), person('2', 'Émile'), person('3', 'Eve'), person('4', 'Élise'), person('5', 'Adèle'), person('6', 'Alice')];
    const { offline } = sortPeople(members, new Set());
    // Avec une comparaison des points de code, « Émile » et « Élise » viendraient après « Zoé ».
    expect(names(offline)).toEqual(['Adèle', 'Alice', 'Élise', 'Émile', 'Eve', 'Zoé']);
  });

  test('majuscules et minuscules se mêlent', () => {
    const members = [person('1', 'bob'), person('2', 'Alice'), person('3', 'chloé'), person('4', 'Dan')];
    expect(names(sortPeople(members, new Set()).offline)).toEqual(['Alice', 'bob', 'chloé', 'Dan']);
  });

  test('deux personnes de même nom : toujours dans le même ordre, quel que soit celui de la liste', () => {
    const a = person('a', 'Léa');
    const b = person('b', 'Léa');
    expect(sortPeople([a, b], new Set()).offline).toEqual([a, b]);
    expect(sortPeople([b, a], new Set()).offline).toEqual([a, b]);
  });

  test('les identifiants en ligne qui ne sont pas des membres sont ignorés', () => {
    const { online, offline } = sortPeople([person('1', 'Bob')], new Set(['inconnu', '1']));
    expect(names(online)).toEqual(['Bob']);
    expect(offline).toEqual([]);
  });

  test('ce que portent les membres (avatar…) est gardé, et la liste d\'entrée n\'est pas modifiée', () => {
    const members = [{ id: '2', name: 'Bob', avatarKey: 'dev-red' }, { id: '1', name: 'Alice', avatarKey: null }];
    const before = structuredClone(members);
    const { offline } = sortPeople(members, new Set());
    expect(offline).toEqual([members[1], members[0]]);
    expect(offline[0]).toBe(members[1]);
    expect(members).toEqual(before);
  });
});
