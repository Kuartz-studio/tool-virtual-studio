import { describe, expect, test } from 'vitest';
import {
  MAX_PEAK_DB,
  MUSIC_SOURCES,
  MUSIC_TARGET_LUFS,
  SFX_SOURCES,
  SFX_TARGET_RMS_DB,
  SFX_TRIMS,
  fadeOutFilter,
  musicGain,
  parseLevels,
  parseLoudness,
  renderMeasuredSource,
  sfxGain,
} from './build-audio';

// Le bilan que ffmpeg écrit pour le filtre ebur128 (peak=true), réduit à ce qui compte.
const EBUR128 = `
[Parsed_ebur128_0 @ 0x600001] Summary:

  Integrated loudness:
    I:         -13.6 LUFS
    Threshold: -23.8 LUFS

  Loudness range:
    LRA:         0.8 LU
    Threshold: -33.8 LUFS
    LRA low:   -14.2 LUFS
    LRA high:  -13.4 LUFS

  True peak:
    Peak:       -0.5 dBFS
`;

// Celui du filtre astats : une section par canal, puis « Overall ».
const ASTATS = `
[Parsed_astats_0 @ 0x1] Channel: 1
[Parsed_astats_0 @ 0x1] Peak level dB: -15.1
[Parsed_astats_0 @ 0x1] RMS peak dB: -22.5
[Parsed_astats_0 @ 0x1] Overall
[Parsed_astats_0 @ 0x1] DC offset: 0.000259
[Parsed_astats_0 @ 0x1] Peak level dB: -15.636764
[Parsed_astats_0 @ 0x1] RMS level dB: -28.797983
[Parsed_astats_0 @ 0x1] RMS peak dB: -22.991903
[Parsed_astats_0 @ 0x1] Number of samples: 56877
`;

describe('la lecture des bilans de ffmpeg', () => {
  test('ebur128 : le volume intégré et le pic', () => {
    expect(parseLoudness(EBUR128)).toEqual({ loudness: -13.6, peak: -0.5 });
  });

  test('astats : le pic et le niveau RMS du moment le plus fort, ceux de « Overall » (pas ceux d\'un canal)', () => {
    expect(parseLevels(ASTATS)).toEqual({ peak: -15.636764, rmsPeak: -22.991903 });
  });

  test('un bilan illisible (ffmpeg a changé de format) est une erreur, pas des zéros', () => {
    expect(() => parseLoudness('rien')).toThrow(/ebur128/);
    expect(() => parseLevels('rien')).toThrow(/astats/);
  });
});

describe('les gains', () => {
  const db = (gain: number) => 20 * Math.log10(gain);

  test('une ambiance est ramenée au volume visé : une boucle à -13,6 LUFS baisse de 2,4 dB', () => {
    expect(db(musicGain({ loudness: -13.6, peak: -3 }))).toBeCloseTo(MUSIC_TARGET_LUFS + 13.6, 1);
    expect(musicGain({ loudness: -13.6, peak: -3 })).toBe(0.759);
  });

  test('une ambiance plus douce que la cible est remontée, mais jamais au-delà du pic permis', () => {
    expect(db(musicGain({ loudness: -20, peak: -9 }))).toBeCloseTo(4, 1);
    expect(db(musicGain({ loudness: -30, peak: -0.5 }) * 10 ** (-0.5 / 20))).toBeCloseTo(MAX_PEAK_DB, 1);
  });

  test('un effet doux est remonté jusqu\'à son niveau visé, un effet fort est baissé (au plus de 12 dB)', () => {
    expect(db(sfxGain({ peak: -15.6, rmsPeak: -23 }))).toBeCloseTo(SFX_TARGET_RMS_DB + 23, 1);
    expect(db(sfxGain({ peak: -0.5, rmsPeak: -3 }))).toBeCloseTo(-12, 1);
  });

  test('un effet ne dépasse jamais le pic permis, même si son niveau RMS demanderait plus', () => {
    // Un son très bref et très doux dont le pic est proche du RMS : le gain s'arrête au pic.
    const gain = sfxGain({ peak: -4, rmsPeak: -30 });
    expect(db(gain) + -4).toBeLessThanOrEqual(MAX_PEAK_DB + 0.01);
  });
});

test('le fichier généré : un tableau par genre, les noms avec un tiret entre guillemets', () => {
  const source = renderMeasuredSource({
    music: { focus: { gain: 0.759, seconds: 53.333 } } as never,
    sfx: { click: { gain: 3.413, seconds: 0.177 }, 'toggle-on': { gain: 0.546, seconds: 0.476 } } as never,
  });
  expect(source).toContain('export const MEASURED_MUSIC = {\n  focus: { gain: 0.759, seconds: 53.333 },\n} as const;');
  expect(source).toContain("  'toggle-on': { gain: 0.546, seconds: 0.476 },");
  expect(source).toContain('  click: { gain: 3.413, seconds: 0.177 },');
  expect(source.startsWith('// Généré par')).toBe(true);
});

test('les ambiances et les effets listés sont ceux que le catalogue connaît', () => {
  expect(Object.keys(MUSIC_SOURCES).sort()).toEqual(['drift', 'dusk', 'focus', 'lobby', 'quest', 'sunny']);
  expect(Object.keys(SFX_SOURCES)).toHaveLength(25);
});

test('les effets des portes, du café, des modes et des jeux viennent des dossiers Environment, Other et Card and Board du pack', () => {
  expect(SFX_SOURCES).toMatchObject({
    'door-open': 'Environment/door_open.wav',
    'door-close': 'Environment/door_close.wav',
    lock: 'Environment/lock_lock.wav',
    unlock: 'Environment/lock_unlock.wav',
    coffee: 'Other/drink_slurp.wav',
    boost: 'Other/whoosh_2.wav',
    teleport: 'Other/whoosh_1.wav',
    dice: 'Card and Board/dice_roll_1.wav',
    piece: 'Card and Board/chips_place_1.wav',
    win: 'Other/applause.wav',
  });
});

test('chaque source est un .wav rangé dans un dossier du pack, et aucun fichier n\'est utilisé deux fois', () => {
  const sources = Object.values(SFX_SOURCES);
  for (const source of sources) expect(source).toMatch(/^[A-Za-z ]+\/[a-z0-9_]+\.wav$/);
  expect(new Set(sources).size).toBe(sources.length);
});

describe('les effets écourtés', () => {
  test('seule la victoire (des applaudissements de plusieurs secondes) est écourtée, et son extinction tient dans sa durée', () => {
    expect(Object.keys(SFX_TRIMS)).toEqual(['win']);
    const { seconds, fadeSeconds } = SFX_TRIMS.win!;
    expect(seconds).toBeLessThanOrEqual(4);
    expect(fadeSeconds).toBeGreaterThan(0);
    expect(fadeSeconds).toBeLessThan(seconds);
  });

  test('le filtre d\'extinction commence à la durée moins le temps d\'extinction', () => {
    expect(fadeOutFilter({ seconds: 3.5, fadeSeconds: 0.8 })).toBe('afade=t=out:st=2.7:d=0.8');
    expect(fadeOutFilter({ seconds: 3, fadeSeconds: 0.3 })).toBe('afade=t=out:st=2.7:d=0.3');
  });
});
