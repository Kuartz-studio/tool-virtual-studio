import type { RoomMusic } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { createAudioStore, selectWantedScene } from './audio-store';
import { DEFAULT_AUDIO_PREFS, type AudioPrefs } from './prefs';

const BY = { id: 'u1', name: 'Alice' };
const OFF: RoomMusic = { on: false, scene: null, by: BY, at: 1 };
const QUEST: RoomMusic = { on: true, scene: 'quest', by: BY, at: 2 };

// L'état dont le choix de l'ambiance dépend : les réglages de la personne, l'ambiance par défaut de l'endroit, sa clé s'il a une enceinte, et si l'on est dehors.
const wanted = (
  over: { prefs?: Partial<AudioPrefs>; place?: 'lobby' | 'focus' | 'sunny' | 'dusk' | 'drift' | 'quest'; placeKey?: string | null; outside?: boolean } = {},
  music: Record<string, RoomMusic> = {},
) =>
  selectWantedScene(
    { prefs: { ...DEFAULT_AUDIO_PREFS, ...over.prefs }, place: over.place ?? 'dusk', placeKey: over.placeKey === undefined ? 'game' : over.placeKey, outside: over.outside ?? false },
    music,
  );

describe('selectWantedScene : ce qu\'on entend', () => {
  test('musique coupée : le silence, quoi que dise la pièce ou l\'ambiance choisie', () => {
    expect(wanted({ prefs: { musicOn: false } })).toBeNull();
    expect(wanted({ prefs: { musicOn: false, scene: 'quest' } })).toBeNull();
    expect(wanted({ prefs: { musicOn: false } }, { game: QUEST })).toBeNull();
  });

  test('« auto » dans une pièce que personne n\'a réglée : son ambiance par défaut', () => {
    expect(wanted()).toBe('dusk');
  });

  test('« auto » dans une pièce dont l\'ambiance a été choisie : celle-là', () => {
    expect(wanted({}, { game: QUEST })).toBe('quest');
  });

  test('« auto » dans une pièce éteinte : le silence, même avec une ambiance réglée', () => {
    expect(wanted({}, { game: OFF })).toBeNull();
    expect(wanted({}, { game: { ...OFF, scene: 'quest' } })).toBeNull();
  });

  test('l\'état d\'une autre pièce ne compte pas', () => {
    expect(wanted({}, { gym: OFF, cafe: QUEST })).toBe('dusk');
  });

  test('une ambiance choisie dans le panneau Son (son casque) passe avant la pièce, éteinte ou non', () => {
    expect(wanted({ prefs: { scene: 'sunny' } })).toBe('sunny');
    expect(wanted({ prefs: { scene: 'sunny' } }, { game: OFF })).toBe('sunny');
    expect(wanted({ prefs: { scene: 'sunny' } }, { game: QUEST })).toBe('sunny');
  });

  test('un endroit sans enceinte (la rue, la place) : son ambiance par défaut, toujours, même si un état traîne', () => {
    expect(wanted({ place: 'lobby', placeKey: null }, { game: OFF, 'street-n': OFF })).toBe('lobby');
    expect(wanted({ place: 'focus', placeKey: null })).toBe('focus');
  });

  test('dehors (le jardin, une terrasse), pas d\'enceinte : le silence, que la nature remplit ; la musique qu\'on a choisie (son casque) nous suit', () => {
    expect(wanted({ place: 'lobby', placeKey: null, outside: true })).toBeNull();
    expect(wanted({ place: 'lobby', placeKey: null, outside: true }, { garden: QUEST })).toBeNull();
    expect(wanted({ place: 'lobby', placeKey: null, outside: true, prefs: { scene: 'sunny' } })).toBe('sunny');
  });
});

describe('le magasin du son', () => {
  test('setPlace : l\'ambiance par défaut de l\'endroit et sa pièce réglable ; rien ne change (même objet d\'état) s\'ils sont les mêmes', () => {
    const store = createAudioStore();
    expect(store.getState()).toMatchObject({ place: 'lobby', placeKey: null });
    store.getState().setPlace('dusk', 'game');
    expect(store.getState()).toMatchObject({ place: 'dusk', placeKey: 'game' });
    const before = store.getState();
    store.getState().setPlace('dusk', 'game');
    expect(store.getState()).toBe(before);
    store.getState().setPlace('dusk');
    expect(store.getState()).toMatchObject({ place: 'dusk', placeKey: null, outside: false });
    store.getState().setPlace('lobby', null, true);
    expect(store.getState()).toMatchObject({ place: 'lobby', placeKey: null, outside: true });
  });
});
