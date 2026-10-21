import { describe, expect, test } from 'vitest';
import { SIM_BOT_PREFIX, SIM_MEDIA_URL, decodeSimToken, encodeSimToken, isSimAudioFile, isSimBot } from '../src';

describe('jeton du faux live', () => {
  test('encode puis décode : room, identité et nom, accents compris', () => {
    const token = { room: 'abc123-g1', identity: 'u_42', name: 'Léa « la 2e » d\'Été & co' };
    expect(decodeSimToken(encodeSimToken(token))).toEqual(token);
  });

  test('un jeton illisible ou incomplet → null', () => {
    expect(decodeSimToken('')).toBeNull();
    expect(decodeSimToken('pas du json')).toBeNull();
    expect(decodeSimToken('%E0%A4%A')).toBeNull();   // un pourcentage mal formé
    expect(decodeSimToken(encodeURIComponent('null'))).toBeNull();
    expect(decodeSimToken(encodeURIComponent(JSON.stringify({ room: 'r', identity: 'i' })))).toBeNull();
    expect(decodeSimToken(encodeURIComponent(JSON.stringify({ room: 'r', identity: 'i', name: 3 })))).toBeNull();
  });

  test('l\'adresse du faux live n\'est pas celle d\'un serveur LiveKit', () => {
    expect(SIM_MEDIA_URL).toMatch(/^sim:\/\//);
  });
});

test('isSimBot : seulement les identifiants qui commencent par le préfixe', () => {
  expect(isSimBot(`${SIM_BOT_PREFIX}a1b2c3d4`)).toBe(true);
  expect(isSimBot('a1b2c3d4')).toBe(false);
  expect(isSimBot('')).toBe(false);
});

describe('isSimAudioFile', () => {
  test.each(['voix.mp3', 'Réunion 2 (copie).wav', 'a_b-c+d.ogg', 'ÉTÉ.M4A', 'x.flac', 'y.webm', 'z.aac'])('%s est accepté', (name) => {
    expect(isSimAudioFile(name)).toBe(true);
  });

  test.each([
    '',
    '.caché.mp3',
    '../secret.mp3',
    'dossier/voix.mp3',
    'dossier\\voix.mp3',
    'voix.mp3.exe',
    'voix.txt',
    'voix',
    'a..b.mp3',
    `${'a'.repeat(130)}.mp3`,
    'voix\n.mp3',
  ])('%j est refusé', (name) => {
    expect(isSimAudioFile(name)).toBe(false);
  });
});
