import { describe, expect, test } from 'vitest';
import {
  buildOfficeTiledMap,
  DEFAULT_ROOM_MUSIC,
  MUSIC_RATE_MS,
  MUSIC_SCENES,
  MUSIC_THEME_IDS,
  MUSIC_THEMES,
  musicSetSchema,
  parseOfficeMap,
  placeByKey,
  roomSceneOf,
  themeOfScene,
  type RoomMusic,
} from '../src';

const map = parseOfficeMap(buildOfficeTiledMap());
const BY = { id: 'u1', name: 'Alice' };
const state = (over: Partial<RoomMusic> = {}): RoomMusic => ({ ...DEFAULT_ROOM_MUSIC, ...over });

test('une personne change la musique d\'une pièce au plus une fois par 800 ms', () => {
  expect(MUSIC_RATE_MS).toBe(800);
});

test('une pièce que personne n\'a touchée : allumée, son ambiance par défaut, personne n\'y a touché', () => {
  expect(DEFAULT_ROOM_MUSIC).toEqual({ on: true, scene: null, by: null, at: 0 });
});

describe('musicSetSchema : la demande de changer la musique d\'une pièce', () => {
  const ok = (value: unknown) => musicSetSchema.safeParse(value).success;

  test('la clé du lieu, et l\'état voulu : allumée ou éteinte, une ambiance, ou les deux', () => {
    expect(ok({ place: 'game', on: false })).toBe(true);
    expect(ok({ place: 'game', on: true })).toBe(true);
    expect(ok({ place: 'desk:A1', scene: 'dusk' })).toBe(true);
    expect(ok({ place: 'game', on: true, scene: 'quest' })).toBe(true);
  });

  test('null rend l\'ambiance par défaut de la pièce : c\'est un état voulu comme un autre', () => {
    expect(ok({ place: 'game', scene: null })).toBe(true);
  });

  test('chacune des ambiances, de tous les thèmes, et aucune autre', () => {
    for (const scene of MUSIC_SCENES) expect(ok({ place: 'game', scene })).toBe(true);
    expect(ok({ place: 'game', scene: 'auto' })).toBe(false);
    expect(ok({ place: 'game', scene: 'disco' })).toBe(false);
  });

  test('une demande qui ne dit rien (ni allumée, ni ambiance) n\'est pas une demande', () => {
    expect(ok({ place: 'game' })).toBe(false);
  });

  test('une clé de lieu vide ou trop longue, un état qui n\'est pas un booléen, tout autre type : refusés', () => {
    expect(ok({ place: '', on: false })).toBe(false);
    expect(ok({ place: 'x'.repeat(65), on: false })).toBe(false);
    expect(ok({ place: 'game', on: 'oui' })).toBe(false);
    expect(ok({ place: 'game', on: 1 })).toBe(false);
    expect(ok({ on: false })).toBe(false);
    expect(ok('game')).toBe(false);
    expect(ok(null)).toBe(false);
    expect(ok(undefined)).toBe(false);
  });
});

describe('roomSceneOf : ce que joue une pièce', () => {
  const game = { scene: 'dusk', music: true } as const;

  test('sans état (personne n\'y a touché) : son ambiance par défaut', () => {
    expect(roomSceneOf(game, undefined)).toBe('dusk');
    expect(roomSceneOf(game, state())).toBe('dusk');
  });

  test('éteinte : le silence, quelle que soit l\'ambiance qu\'on lui avait donnée', () => {
    expect(roomSceneOf(game, state({ on: false, by: BY, at: 5 }))).toBeNull();
    expect(roomSceneOf(game, state({ on: false, scene: 'quest', by: BY, at: 5 }))).toBeNull();
  });

  test('allumée avec une ambiance : celle-là, à la place de celle par défaut', () => {
    expect(roomSceneOf(game, state({ scene: 'quest', by: BY, at: 5 }))).toBe('quest');
  });

  test('une pièce sans enceinte (la rue, la place, la salle client) : son ambiance par défaut, toujours allumée, même si un état dit autre chose', () => {
    const street = { scene: 'lobby', music: false } as const;
    expect(roomSceneOf(street, undefined)).toBe('lobby');
    expect(roomSceneOf(street, state({ on: false }))).toBe('lobby');
    expect(roomSceneOf(street, state({ scene: 'quest' }))).toBe('lobby');
  });

  test('sur la grande carte : les pièces à enceinte se règlent (l\'octogone compris), la place et les rues non', () => {
    const settable = (key: string) => placeByKey(map, key)!.music;
    for (const key of ['cafe', 'reception', 'meeting', 'arena', 'conference', 'gym', 'game', 'lounge']) expect(settable(key), key).toBe(true);
    for (const key of ['plaza', 'street-n', 'street-s', 'street-e']) expect(settable(key), key).toBe(false);
    // Un bureau a sa musique, que son propriétaire règle.
    expect(placeByKey(map, 'desk:A1')!.music).toBe(true);
  });
});

describe('les thèmes de musique', () => {
  test('« Par défaut » puis « Pirate » ; toutes les ambiances, thème après thème, chacune une fois et dans son thème', () => {
    expect(MUSIC_THEME_IDS).toEqual(['default', 'pirate']);
    expect([...MUSIC_SCENES]).toEqual([...MUSIC_THEMES.default, ...MUSIC_THEMES.pirate]);
    expect(new Set(MUSIC_SCENES).size).toBe(MUSIC_SCENES.length);
    expect(themeOfScene('dusk')).toBe('default');
    expect(themeOfScene('silent-harbor')).toBe('pirate');
  });

  test('une musique pirate se règle pour une pièce comme une autre', () => {
    expect(musicSetSchema.safeParse({ place: 'game', scene: 'black-flag-rise' }).success).toBe(true);
  });
});
