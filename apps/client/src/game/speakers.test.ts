import { TILE_SIZE, buildOfficeTiledMap, parseOfficeMap, type RoomMusic } from '@bureau/shared';
import { expect, test, vi } from 'vitest';
import { fr } from '../i18n/fr';
import { Interactions } from './interactions';
import { layoutProps, propImages } from './prop-layer';
import { SPEAKER_REACH_TILES, speakerPlaying, speakerSprites, speakerTarget } from './speakers';

const speaker = { place: 'game', x: 34 * TILE_SIZE + 16, y: 33 * TILE_SIZE + 16 };
const OFF: RoomMusic = { on: false, scene: null, by: null, at: 1 };
const QUEST: RoomMusic = { on: true, scene: 'quest', by: null, at: 2 };

test('une pièce joue tant que personne ne l\'a éteinte : sans état, allumée ; avec une ambiance réglée, allumée aussi', () => {
  expect(speakerPlaying(undefined)).toBe(true);
  expect(speakerPlaying(QUEST)).toBe(true);
  expect(speakerPlaying(OFF)).toBe(false);
});

test('l\'enceinte est une cible de la touche E : « [E] Couper la musique » quand la pièce joue, « [E] Lancer la musique » quand elle est coupée', () => {
  let state: RoomMusic | undefined;
  const target = speakerTarget(speaker, () => state, () => undefined);
  expect(target.prompt()).toBe(`[E] ${fr.roomMusic.mute}`);
  state = OFF;
  expect(target.prompt()).toBe(`[E] ${fr.roomMusic.play}`);
  state = QUEST;
  expect(target.prompt()).toBe(`[E] ${fr.roomMusic.mute}`);
});

test('l\'actionner demande l\'état contraire de celui qu\'on voit, pour la pièce de l\'enceinte ; rien ne change avant l\'annonce du serveur', () => {
  let state: RoomMusic | undefined;
  const onUse = vi.fn();
  const target = speakerTarget(speaker, () => state, onUse);
  target.use();
  expect(onUse).toHaveBeenLastCalledWith({ place: 'game', on: false });
  state = OFF;
  target.use();
  expect(onUse).toHaveBeenLastCalledWith({ place: 'game', on: true });
  expect(onUse).toHaveBeenCalledTimes(2);
});

test('elle répond à SPEAKER_REACH_TILES cases au plus, la plus proche des cibles, par la touche E', () => {
  const onUse = vi.fn();
  const target = speakerTarget(speaker, () => undefined, onUse);
  const interactions = new Interactions();
  interactions.register(target);
  expect(SPEAKER_REACH_TILES).toBe(2);
  expect(interactions.update({ x: speaker.x, y: speaker.y + SPEAKER_REACH_TILES * TILE_SIZE })).toBe(target);
  expect(interactions.update({ x: speaker.x, y: speaker.y + SPEAKER_REACH_TILES * TILE_SIZE + 1 })).toBeNull();
  expect(interactions.use({ x: speaker.x + TILE_SIZE, y: speaker.y })).toBe(true);
  expect(onUse).toHaveBeenCalledWith({ place: 'game', on: false });
});

test('chaque enceinte a sa cible, avec sa pièce : deux enceintes ne se confondent pas', () => {
  const a = speakerTarget(speaker, () => undefined, () => undefined);
  const b = speakerTarget({ place: 'gym', x: 12 * TILE_SIZE + 16, y: 33 * TILE_SIZE + 16 }, () => undefined, () => undefined);
  expect(a.id).not.toBe(b.id);
});

test('l\'étiquette se pose au-dessus de l\'enceinte, qui monte de plusieurs cases', () => {
  const target = speakerTarget(speaker, () => undefined, () => undefined);
  expect(target.labelAt!.x).toBe(speaker.x);
  expect(target.labelAt!.y).toBeLessThan(speaker.y - TILE_SIZE);
});

// Les enceintes de la grande carte : chacune est posée sur un objet animé (amplifier) dont l'image la contient.
test('speakerSprites : les images d\'amplificateur qui contiennent l\'enceinte, et seulement elles', () => {
  const sprite = (x: number, bottom: number, w = 32, h = 96) => ({ x, y: bottom, displayWidth: w, displayHeight: h });
  const mine = sprite(34 * TILE_SIZE, 34 * TILE_SIZE);   // l'amplificateur de la salle de jeu : case (34, 33), bas de l'image à la rangée 34
  const other = sprite(12 * TILE_SIZE, 34 * TILE_SIZE);
  const above = sprite(34 * TILE_SIZE, 28 * TILE_SIZE);
  expect(speakerSprites(speaker, [mine, other, above])).toEqual([mine]);
  expect(speakerSprites(speaker, [])).toEqual([]);
});

test('sur la grande carte, chaque enceinte (zone speaker) est dans l\'image d\'au moins un amplificateur de la carte, et aucune enceinte n\'en a plus de deux', () => {
  const tiled = buildOfficeTiledMap();
  const map = parseOfficeMap(tiled);
  const layer = tiled.layers.find((l) => l.name === 'props');
  const objects = layer && layer.type === 'objectgroup' ? layer.objects : [];
  const sprites = propImages(layoutProps(objects))
    .filter((image) => image.key.startsWith('amplifier'))
    .map((image) => ({ x: image.x, y: image.y + image.h, displayWidth: image.w, displayHeight: image.h }));
  expect(map.speakers.length).toBeGreaterThanOrEqual(7);
  for (const one of map.speakers) {
    const found = speakerSprites(one, sprites);
    expect(found.length, one.place).toBeGreaterThanOrEqual(1);
    expect(found.length, one.place).toBeLessThanOrEqual(2);
  }
});
