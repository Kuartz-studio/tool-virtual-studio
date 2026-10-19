import type { InitPayload, PublicPlayer } from '@bureau/shared';
import { beforeEach, expect, test } from 'vitest';
import { createOfficeStore, useOfficeStore } from './office-store';

const player = (id: string, over: Partial<PublicPlayer> = {}): PublicPlayer => ({
  id,
  name: id.toUpperCase(),
  avatarKey: null,
  x: 80,
  y: 240,
  dir: 'down',
  moving: false,
  status: 'available',
  media: { mic: false, cam: false, screen: false },
  ...over,
});

const init = (self: PublicPlayer, players: PublicPlayer[], mapKey = 'dev-office'): InitPayload => ({ self, players, mapKey, chatHistory: [] });

const SELF = player('moi');
const A = player('a');
const B = player('b');

let store: ReturnType<typeof createOfficeStore>;
beforeEach(() => {
  store = createOfficeStore();
});

test('deuxième init : joueurs remplacés', () => {
  store.getState().applyInit(init(SELF, [A, B]));
  store.getState().applyInit(init(SELF, [A]));
  expect(Object.keys(store.getState().players)).toEqual(['a']);
});

test('avant tout init : personne, pas de carte, pas remplacé', () => {
  expect(store.getState()).toMatchObject({ selfId: null, self: null, mapKey: null, players: {}, replaced: false });
});

test('init : soi-même à part (selfId, self), les autres dans players, la carte du serveur', () => {
  store.getState().applyInit(init(SELF, [A, B], 'bureau'));
  const state = store.getState();
  expect(state.selfId).toBe('moi');
  expect(state.self).toEqual(SELF);
  expect(state.mapKey).toBe('bureau');
  expect(state.players).toEqual({ a: A, b: B });
});

test('init : soi-même n\'est jamais dans players, même si le serveur le listait', () => {
  store.getState().applyInit(init(SELF, [A, SELF]));
  expect(Object.keys(store.getState().players)).toEqual(['a']);
});

test('init : on n\'est plus « remplacé » (l\'onglet a repris la main : « Utiliser ici »)', () => {
  store.getState().setReplaced(true);
  expect(store.getState().replaced).toBe(true);
  store.getState().applyInit(init(SELF, []));
  expect(store.getState().replaced).toBe(false);
});

test('upsertPlayer : ajoute, ou remplace le joueur du même identifiant ; soi-même met à jour self', () => {
  store.getState().applyInit(init(SELF, [A]));
  store.getState().upsertPlayer(B);
  store.getState().upsertPlayer({ ...A, name: 'Alice' });
  expect(store.getState().players).toEqual({ a: { ...A, name: 'Alice' }, b: B });
  store.getState().upsertPlayer({ ...SELF, x: 100 });
  expect(store.getState().self?.x).toBe(100);
  expect(store.getState().players.moi).toBeUndefined();
});

test('removePlayer : retire ; un inconnu, ou soi-même, ne change rien', () => {
  store.getState().applyInit(init(SELF, [A, B]));
  store.getState().removePlayer('a');
  expect(Object.keys(store.getState().players)).toEqual(['b']);
  const before = store.getState();
  store.getState().removePlayer('inconnu');
  store.getState().removePlayer('moi');
  expect(store.getState()).toBe(before);
});

test('setStatus, setMedia, setProfile : pour un autre joueur, et pour soi-même', () => {
  store.getState().applyInit(init(SELF, [A]));
  const { setStatus, setMedia, setProfile } = store.getState();
  setStatus('a', 'dnd');
  setStatus('moi', 'busy');
  setMedia('a', { mic: true, cam: false, screen: true });
  setMedia('moi', { mic: false, cam: true, screen: false });
  setProfile({ id: 'a', name: 'Alice', avatarKey: 'dev-blue' });
  setProfile({ id: 'moi', name: 'Moi-même', avatarKey: 'dev-green' });
  const { players, self } = store.getState();
  expect(players.a).toMatchObject({ status: 'dnd', media: { mic: true, cam: false, screen: true }, name: 'Alice', avatarKey: 'dev-blue' });
  expect(self).toMatchObject({ status: 'busy', media: { mic: false, cam: true, screen: false }, name: 'Moi-même', avatarKey: 'dev-green' });
});

test('un identifiant inconnu (parti, ou pas encore arrivé) ne change rien, et ne crée personne', () => {
  store.getState().applyInit(init(SELF, [A]));
  const before = store.getState();
  store.getState().setStatus('x', 'away');
  store.getState().setMedia('x', { mic: true, cam: true, screen: true });
  store.getState().setProfile({ id: 'x', name: 'X', avatarKey: null });
  expect(store.getState()).toBe(before);
});

test('chaque changement donne de nouveaux objets (React ne voit que ce qui change), sans toucher aux autres joueurs', () => {
  store.getState().applyInit(init(SELF, [A, B]));
  const before = store.getState();
  store.getState().setStatus('a', 'away');
  const after = store.getState();
  expect(after.players).not.toBe(before.players);
  expect(after.players.a).not.toBe(before.players.a);
  expect(after.players.b).toBe(before.players.b);
  expect(before.players.a!.status).toBe('available');
});

test('reset : l\'état de départ (une autre session, un autre compte)', () => {
  store.getState().applyInit(init(SELF, [A]));
  store.getState().setReplaced(true);
  store.getState().reset();
  expect(store.getState()).toMatchObject({ selfId: null, self: null, mapKey: null, players: {}, replaced: false });
});

test('useOfficeStore est le magasin de l\'appli', () => {
  useOfficeStore.getState().reset();
  useOfficeStore.getState().applyInit(init(SELF, [A]));
  expect(useOfficeStore.getState().selfId).toBe('moi');
  useOfficeStore.getState().reset();
});
