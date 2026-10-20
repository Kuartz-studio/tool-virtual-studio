import { describe, expect, test } from 'vitest';
import { displayName, NAME_MAX_LENGTH, SpeakingRings } from './NameTag';

test('un nom de 20 caractères au plus est affiché tel quel', () => {
  expect(NAME_MAX_LENGTH).toBe(20);
  expect(displayName('Léa')).toBe('Léa');
  expect(displayName('Marie-Hélène Durand')).toBe('Marie-Hélène Durand');
  expect(displayName('a'.repeat(20))).toBe('a'.repeat(20));
});

test('au-delà, les 20 premiers caractères puis « … »', () => {
  expect(displayName('a'.repeat(21))).toBe(`${'a'.repeat(20)}…`);
  expect(displayName('Jean-Christophe Delacroix-Martin')).toBe('Jean-Christophe Dela…');
});

test('les caractères se comptent comme on les voit : une lettre accentuée décomposée ou un emoji en est un seul', () => {
  const decomposed = 'é'.repeat(25);   // « é » écrit avec un accent combinant
  expect(displayName(decomposed)).toBe(`${'é'.repeat(20)}…`);
  const family = '👩‍👩‍👧';   // un seul emoji, fait de cinq points de code
  expect(displayName(family.repeat(20))).toBe(family.repeat(20));
  expect(displayName(family.repeat(21))).toBe(`${family.repeat(20)}…`);
});

test('pas d\'espace avant « … »', () => {
  expect(displayName(`${'a'.repeat(19)} bcd`)).toBe(`${'a'.repeat(19)}…`);
});

// L'anneau de parole des étiquettes suit l'événement de bus media:speaking (les identifiants de ceux qui parlent, soi-même compris ;
// [] en quittant la room). La scène donne l'objet qui porte l'étiquette de chacun : l'avatar local ou un avatar distant.
describe('SpeakingRings', () => {
  // Des étiquettes qui notent leurs changements d'anneau.
  function tags(...ids: string[]) {
    const log: string[] = [];
    const shown = new Map(ids.map((id) => [id, { setSpeaking: (on: boolean) => log.push(`${id}:${on ? 'on' : 'off'}`) }]));
    return { log, rings: new SpeakingRings((id) => shown.get(id)), shown };
  }

  test('l\'anneau de ceux qui parlent s\'allume, celui de ceux qui se taisent s\'éteint', () => {
    const { log, rings } = tags('moi', 'ana', 'bob');
    rings.update(['ana']);
    rings.update(['ana', 'moi']);
    rings.update(['moi']);
    expect(log).toEqual(['ana:on', 'moi:on', 'ana:off']);
  });

  test('[] (la room quittée) : tous les anneaux s\'éteignent', () => {
    const { log, rings } = tags('moi', 'ana');
    rings.update(['moi', 'ana']);
    log.splice(0);
    rings.update([]);
    expect(log.sort()).toEqual(['ana:off', 'moi:off']);
  });

  test('rien de changé : les étiquettes ne sont pas retouchées', () => {
    const { log, rings } = tags('ana');
    rings.update(['ana']);
    rings.update(['ana']);
    expect(log).toEqual(['ana:on']);
  });

  test('quelqu\'un que la scène ne dessine pas (pas encore là, ou parti) : rien ; dessiné ensuite, isSpeaking dit s\'il parle', () => {
    const { log, rings, shown } = tags('moi');
    rings.update(['zoe']);
    expect(log).toEqual([]);
    expect(rings.isSpeaking('zoe')).toBe(true);
    expect(rings.isSpeaking('moi')).toBe(false);
    // Zoé arrive (la scène crée son avatar, et lui donne son anneau) puis se tait.
    shown.set('zoe', { setSpeaking: (on: boolean) => log.push(`zoe:${on ? 'on' : 'off'}`) });
    rings.update([]);
    expect(log).toEqual(['zoe:off']);
  });
});
