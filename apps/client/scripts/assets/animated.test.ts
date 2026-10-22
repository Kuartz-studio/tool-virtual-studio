import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { LIGHT_KINDS, PROPS, propByKey, type Prop } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { ANIMATED_PROPS, propFromSheet } from './animated';
import { ASSETS_DIR } from './build-assets';
import { readImage } from './image';

describe('propFromSheet : une planche animée devient un prop', () => {
  const spec = { key: 'porte', file: 'porte.png', frames: 8, fps: 10, loop: false, claim: 1, solid: false } as const;

  test('la taille d\'une image et son empreinte se lisent sur la planche (8 images de 64 × 96 : 2 × 3 cases)', () => {
    expect(propFromSheet(spec, 512, 96)).toEqual({
      key: 'porte',
      sheet: '/assets/props/porte.png',
      frameWidth: 64,
      frameHeight: 96,
      frames: 8,
      fps: 10,
      loop: false,
      w: 2,
      h: 3,
      claim: 1,
      solid: false,
    });
  });

  test('la lumière du prop est gardée telle quelle', () => {
    expect(propFromSheet({ ...spec, light: 'fire' }, 512, 96).light).toBe('fire');
  });

  test('une planche dont la largeur n\'est pas un multiple du nombre d\'images est refusée', () => {
    expect(() => propFromSheet(spec, 500, 96)).toThrow(/porte/);
  });

  test('une image qui n\'est pas un nombre entier de cases est refusée', () => {
    expect(() => propFromSheet(spec, 8 * 40, 96)).toThrow(/cases/);
    expect(() => propFromSheet(spec, 512, 90)).toThrow(/cases/);
  });

  test('une empreinte au sol plus haute que l\'image est refusée', () => {
    expect(() => propFromSheet({ ...spec, claim: 4 }, 512, 96)).toThrow(/empreinte/);
  });
});

describe('la liste des objets animés', () => {
  test('une clé par prop, et chacun se retrouve par sa clé', () => {
    expect(new Set(PROPS.map((p) => p.key)).size).toBe(PROPS.length);
    expect(ANIMATED_PROPS.map((p) => p.key).sort()).toEqual(PROPS.map((p) => p.key).sort());
    for (const prop of PROPS) expect(propByKey(prop.key)).toBe(prop);
    expect(propByKey('nope')).toBeUndefined();
  });

  test('ceux dont l\'appli a besoin : portes, café, cheminée, enceintes, sport, bougies, aquarium', () => {
    const shape = (key: string) => {
      const p = propByKey(key) as Prop;
      return [p.frames, p.frameWidth, p.frameHeight, p.light ?? null];
    };
    expect(shape('door-glass-double')).toEqual([8, 64, 96, null]);
    expect(shape('coffee')).toEqual([6, 32, 64, null]);
    expect(shape('chimney')).toEqual([3, 64, 96, 'fire']);
    expect(shape('amplifier')).toEqual([3, 32, 64, 'glow']);
    expect(shape('amplifier-big')).toEqual([3, 32, 96, 'glow']);
    expect(shape('treadmill')).toEqual([12, 64, 96, null]);
    expect(shape('punching-bag-left')).toEqual([6, 64, 64, null]);
    expect(shape('punching-bag-right')).toEqual([6, 64, 64, null]);
    expect(shape('candle')).toEqual([3, 32, 64, 'candle']);
    expect(shape('wall-candle')).toEqual([3, 32, 64, 'candle']);
    expect(shape('fishtank')).toEqual([8, 64, 64, 'water']);
  });

  test('la porte vitrée ne boucle pas (on s\'arrête sur l\'image où elle est ouverte ou fermée) ; le reste tourne en boucle', () => {
    expect(propByKey('door-glass-double')!.loop).toBe(false);
    for (const prop of PROPS.filter((p) => p.key !== 'door-glass-double')) expect(prop.loop, prop.key).toBe(true);
  });

  test('chaque lumière nomme un genre de lumière que la nuit sait dessiner', () => {
    for (const prop of PROPS) if (prop.light) expect(LIGHT_KINDS, prop.key).toContain(prop.light);
  });
});

// Ce que les planches sont devenues dans l'appli : le dépôt garde les fichiers produits (le pack lui-même n'y est pas).
describe('les planches animées rangées dans l\'appli', () => {
  test('chaque prop a sa planche, de la largeur de ses images, et aucune image n\'est vide', () => {
    for (const prop of PROPS) {
      const path = join(ASSETS_DIR, 'props', `${prop.key}.png`);
      expect(existsSync(path), prop.key).toBe(true);
      const sheet = readImage(path);
      expect(sheet.width, prop.key).toBe(prop.frameWidth * prop.frames);
      expect(sheet.height, prop.key).toBe(prop.frameHeight);
      for (let frame = 0; frame < prop.frames; frame++) {
        expect(sheet.crop(frame * prop.frameWidth, 0, prop.frameWidth, prop.frameHeight).isEmpty(), `${prop.key}, image ${frame}`).toBe(false);
      }
    }
  });

  test('l\'empreinte d\'un prop tient dans son image, et le chemin est celui que sert le client', () => {
    for (const prop of PROPS) {
      expect(prop.w * 32, prop.key).toBe(prop.frameWidth);
      expect(prop.h * 32, prop.key).toBe(prop.frameHeight);
      expect(prop.claim, prop.key).toBeLessThanOrEqual(prop.h);
      expect(prop.fps, prop.key).toBeGreaterThan(0);
      expect(prop.sheet, prop.key).toBe(`/assets/props/${prop.key}.png`);
    }
  });
});
