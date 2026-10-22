import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MUSIC_SCENES } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { fr } from '../i18n/fr';
import { MUSIC_FORMATS, musicUrls, SCENE_IDS, SCENES, SFX, SFX_IDS, sfxUrl } from './catalog';
import { MEASURED_MUSIC, MEASURED_SFX } from './measured.generated';

// Les fichiers sont rangés dans le dossier public du client, servi tel quel (/assets/audio/…).
const PUBLIC = join(import.meta.dirname, '../../public');
const file = (url: string) => join(PUBLIC, url);

describe('le catalogue du son', () => {
  test('les six ambiances sont proposées une fois chacune, et toutes ont leurs textes', () => {
    expect([...SCENE_IDS].sort()).toEqual(Object.keys(MEASURED_MUSIC).sort());
    expect(new Set(SCENE_IDS).size).toBe(SCENE_IDS.length);
    for (const id of SCENE_IDS) {
      const text = fr.sound.scenes[id];
      expect(text.title.length, id).toBeGreaterThan(2);
      expect(text.mood.length, id).toBeGreaterThan(5);
      expect(text.where.length, id).toBeGreaterThan(5);
      expect(SCENES[id].track, id).toMatch(/ — /);
    }
    // Aucun texte pour une ambiance qui n'existe plus.
    expect(Object.keys(fr.sound.scenes).sort()).toEqual([...SCENE_IDS].sort());
  });

  test('la liste des ambiances est celle du partage : le serveur et la carte nomment les mêmes', () => {
    expect(SCENE_IDS).toBe(MUSIC_SCENES);
  });

  test('chaque ambiance a ses deux fichiers (ogg et m4a), qui existent et ne sont pas vides', () => {
    for (const id of SCENE_IDS) {
      for (const url of musicUrls(id, () => true)) {
        expect(existsSync(file(url)), url).toBe(true);
        expect(statSync(file(url)).size, url).toBeGreaterThan(100_000);
      }
    }
  });

  test('l\'ogg passe en premier quand le navigateur le lit, l\'AAC d\'abord quand il ne le lit pas, et l\'autre est toujours gardé en secours', () => {
    const ogg = MUSIC_FORMATS[0].mime;
    expect(musicUrls('focus', () => true)).toEqual(['/assets/audio/music/focus.ogg', '/assets/audio/music/focus.m4a']);
    expect(musicUrls('focus', (mime) => mime !== ogg)).toEqual(['/assets/audio/music/focus.m4a', '/assets/audio/music/focus.ogg']);
    expect(musicUrls('focus', () => false)).toHaveLength(2);
  });

  test('chaque effet a son fichier, un gain mesuré et un délai de repos', () => {
    expect([...SFX_IDS].sort()).toEqual(Object.keys(MEASURED_SFX).sort());
    for (const id of SFX_IDS) {
      expect(existsSync(file(sfxUrl(id))), id).toBe(true);
      expect(SFX[id].gain, id).toBeGreaterThan(0);
      expect(SFX[id].cooldownMs, id).toBeGreaterThanOrEqual(0);
    }
  });

  test('les gains ne sont ni nuls ni délirants : les ambiances ne font que baisser, les effets restent dans une plage raisonnable', () => {
    for (const id of SCENE_IDS) {
      expect(SCENES[id].gain, id).toBeGreaterThan(0.2);
      expect(SCENES[id].gain, id).toBeLessThanOrEqual(1.2);
    }
    for (const id of SFX_IDS) expect(SFX[id].gain, id).toBeLessThan(5);
  });

  test('les durées mesurées sont celles de boucles : de 10 secondes à 2 minutes', () => {
    for (const id of SCENE_IDS) {
      expect(MEASURED_MUSIC[id].seconds, id).toBeGreaterThan(10);
      expect(MEASURED_MUSIC[id].seconds, id).toBeLessThan(120);
    }
  });
});
