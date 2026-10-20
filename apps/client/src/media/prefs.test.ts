import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { MediaPrefs } from './media-client';
import { loadPrefs, savePrefs } from './prefs';

const KEY = 'bureau.media.v1';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('préférences : valeurs par défaut, et stockage corrompu → valeurs par défaut', () => {
  expect(loadPrefs()).toEqual({ mic: true, cam: true });
  localStorage.setItem(KEY, '{');
  expect(loadPrefs()).toEqual({ mic: true, cam: true });
});

test('enregistrées sous la clé bureau.media.v1, puis relues telles quelles', () => {
  const prefs: MediaPrefs = { audioInput: 'micro-usb', videoInput: 'webcam', audioOutput: 'casque', mic: false, cam: true };
  savePrefs(prefs);
  expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(prefs);
  expect(loadPrefs()).toEqual(prefs);
});

test('chaque lecture rend un objet neuf : le modifier ne change pas les suivantes', () => {
  const first = loadPrefs();
  first.mic = false;
  expect(loadPrefs()).toEqual({ mic: true, cam: true });
});

describe('contenu inattendu : ce qui est valable est gardé, le reste prend sa valeur par défaut', () => {
  test.each([
    ['null', { mic: true, cam: true }],
    ['[]', { mic: true, cam: true }],
    ['"texte"', { mic: true, cam: true }],
    ['42', { mic: true, cam: true }],
    ['{"mic":false}', { mic: false, cam: true }],
    ['{"mic":"non","cam":0,"audioInput":12,"videoInput":"cam-2","audioOutput":null}', { mic: true, cam: true, videoInput: 'cam-2' }],
    ['{"mic":false,"cam":false,"inconnu":1}', { mic: false, cam: false }],
  ])('%s', (stored, expected) => {
    localStorage.setItem(KEY, stored);
    expect(loadPrefs()).toEqual(expected);
  });
});

test('stockage refusé (navigation privée, cookies bloqués, quota) : valeurs par défaut, et l\'enregistrement ne lève pas', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('accès refusé', 'SecurityError');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('plus de place', 'QuotaExceededError');
  });
  expect(loadPrefs()).toEqual({ mic: true, cam: true });
  expect(() => savePrefs({ mic: false, cam: false })).not.toThrow();
});

test('localStorage lui-même inaccessible (sa lecture lève) : valeurs par défaut, et l\'enregistrement ne lève pas', () => {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new DOMException('accès refusé', 'SecurityError');
  });
  expect(loadPrefs()).toEqual({ mic: true, cam: true });
  expect(() => savePrefs({ mic: false, cam: false })).not.toThrow();
});
