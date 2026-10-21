import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DEFAULT_AUDIO_PREFS, loadAudioPrefs, saveAudioPrefs, type AudioPrefs } from './prefs';

const KEY = 'bureau.audio.v1';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('sans réglage enregistré : tout est allumé, la musique en fond, l\'ambiance du lieu', () => {
  expect(loadAudioPrefs()).toEqual({ musicOn: true, musicVolume: 0.6, sfxOn: true, sfxVolume: 0.8, scene: 'auto' });
  expect(loadAudioPrefs()).toEqual(DEFAULT_AUDIO_PREFS);
});

test('enregistrés sous la clé bureau.audio.v1, puis relus tels quels', () => {
  const prefs: AudioPrefs = { musicOn: false, musicVolume: 0.25, sfxOn: true, sfxVolume: 1, scene: 'dusk' };
  saveAudioPrefs(prefs);
  expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(prefs);
  expect(loadAudioPrefs()).toEqual(prefs);
});

test('chaque lecture rend un objet neuf : le modifier ne change pas les suivantes', () => {
  const first = loadAudioPrefs();
  first.musicOn = false;
  expect(loadAudioPrefs().musicOn).toBe(true);
});

describe('contenu inattendu : ce qui est valable est gardé, le reste prend sa valeur par défaut', () => {
  test.each([
    ['{', DEFAULT_AUDIO_PREFS],
    ['null', DEFAULT_AUDIO_PREFS],
    ['[]', DEFAULT_AUDIO_PREFS],
    ['"texte"', DEFAULT_AUDIO_PREFS],
    ['{"musicOn":false}', { ...DEFAULT_AUDIO_PREFS, musicOn: false }],
    ['{"musicOn":"non","sfxOn":0,"musicVolume":"fort","sfxVolume":null,"scene":42}', DEFAULT_AUDIO_PREFS],
    // Un volume hors du curseur est ramené dans ses bornes ; une ambiance qui n'existe plus (un morceau retiré) redevient l'ambiance du lieu.
    ['{"musicVolume":3,"sfxVolume":-1}', { ...DEFAULT_AUDIO_PREFS, musicVolume: 1, sfxVolume: 0 }],
    ['{"scene":"disparue"}', DEFAULT_AUDIO_PREFS],
    ['{"scene":"quest"}', { ...DEFAULT_AUDIO_PREFS, scene: 'quest' }],
  ])('%s', (stored, expected) => {
    localStorage.setItem(KEY, stored);
    expect(loadAudioPrefs()).toEqual(expected);
  });
});

test('stockage refusé (navigation privée, cookies bloqués, quota) : valeurs par défaut, et l\'enregistrement ne lève pas', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('accès refusé', 'SecurityError');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('plus de place', 'QuotaExceededError');
  });
  expect(loadAudioPrefs()).toEqual(DEFAULT_AUDIO_PREFS);
  expect(() => saveAudioPrefs({ ...DEFAULT_AUDIO_PREFS, musicOn: false })).not.toThrow();
});
