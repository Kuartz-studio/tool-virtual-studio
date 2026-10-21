import { CHARACTER_PARTS, CHARACTER_SHEET, DIRECTIONS, defaultAvatarKey, formatCharacter, formatPremade } from '@bureau/shared';
import { describe, expect, test, vi } from 'vitest';
import { composeAvatar, layersOf, type ImageLoader } from './avatar-compose';
import { AvatarLibrary, FALLBACK_KEY, animKey, avatarObjectName, createAvatarAnimations, feetBody, resolveAvatarKey, specOf } from './avatars';

describe('specOf : la fiche d\'un avatar, la même pour tous', () => {
  test('immobile et marche dans les 4 directions : 6 images chacune, qui se suivent dans la planche (droite, haut, gauche, bas)', () => {
    const spec = specOf('p.01');
    for (const dir of DIRECTIONS) {
      expect(spec.idle[dir]).toHaveLength(CHARACTER_SHEET.framesPerDirection);
      expect(spec.walk[dir]).toHaveLength(CHARACTER_SHEET.framesPerDirection);
    }
    expect(spec.idle.right).toEqual([0, 1, 2, 3, 4, 5]);
    expect(spec.idle.up[0]).toBe(6);
    expect(spec.idle.left[0]).toBe(12);
    expect(spec.idle.down[0]).toBe(18);
    // La marche est sur la deuxième ligne de la planche : 24 images plus loin.
    expect(spec.walk.down[0]).toBe(CHARACTER_SHEET.columns + 18);
  });

  test('des images de 32 × 64 px ; l\'étiquette se pose au-dessus de la tête, pas du haut de l\'image', () => {
    const spec = specOf('p.01');
    expect([spec.frameWidth, spec.frameHeight]).toEqual([32, 64]);
    expect(spec.height).toBe(64 - CHARACTER_SHEET.headTop);
    expect(spec.height).toBeLessThan(spec.frameHeight);
  });

  test('l\'immobile respire plus lentement que la marche ne va', () => {
    const spec = specOf('p.01');
    expect(spec.idleFrameRate).toBeLessThan(spec.walkFrameRate);
  });
});

test('animKey : `${avatar}-${genre}-${direction}`', () => {
  expect(animKey('p.07', 'idle', 'down')).toBe('p.07-idle-down');
  expect(animKey('c.1.1.1-1.0.0', 'walk', 'left')).toBe('c.1.1.1-1.0.0-walk-left');
});

describe('resolveAvatarKey', () => {
  test('un avatar valable est gardé', () => {
    expect(resolveAvatarKey('u1', 'p.03')).toBe('p.03');
    const built = formatCharacter({ body: 2, eyes: 1, outfit: { style: CHARACTER_PARTS.outfits[0]!.number, color: 1 }, hair: null, accessory: null });
    expect(resolveAvatarKey('u1', built)).toBe(built);
  });

  test('pas d\'avatar choisi, ou une clé que ce build ne connaît pas (dont les anciennes dev-red) : un personnage prêt qui ne dépend que de la personne', () => {
    for (const unknown of [null, undefined, '', 'dev-red', 'avatar-99', 'constructor', 'p.99']) {
      expect(resolveAvatarKey('u1', unknown)).toBe(defaultAvatarKey('u1'));
    }
    expect(defaultAvatarKey('u1')).toMatch(/^p\.\d\d$/);
  });
});

test('avatarObjectName : le nom de l\'objet d\'un avatar dans la scène, par joueur', () => {
  expect(avatarObjectName('u-lea')).toBe('player:u-lea');
});

describe('layersOf : l\'ordre du pack, corps, yeux, tenue, coiffure, accessoire', () => {
  test('un personnage assemblé : une couche par pièce, la variante choisie', () => {
    const outfit = CHARACTER_PARTS.outfits[2]!;
    const hair = CHARACTER_PARTS.hair[4]!;
    const layers = layersOf({
      kind: 'built',
      build: { body: 3, eyes: 2, outfit: { style: outfit.number, color: 2 }, hair: { style: hair.number, color: 3 }, accessory: null },
    });
    expect(layers.map((l) => l.url.replace('/assets/characters/', ''))).toEqual(['bodies.png', 'eyes.png', `outfits/${String(outfit.number).padStart(2, '0')}.png`, `hair/${String(hair.number).padStart(2, '0')}.png`]);
    expect(layers.map((l) => l.row)).toEqual([2, 1, 1, 2]);
  });

  test('un personnage prêt à l\'emploi : une seule couche', () => {
    expect(layersOf({ kind: 'premade', number: 7 })).toEqual([{ url: '/assets/characters/premade.png', row: 6 }]);
  });
});

// Un « canevas » qui note ce qu'on dessine dessus, pour vérifier l'assemblage sans navigateur.
function fakeCanvas() {
  const draws: unknown[][] = [];
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: (...args: unknown[]) => draws.push(args), fillRect: () => {}, set fillStyle(_: string) {} }),
  } as unknown as HTMLCanvasElement;
  return { canvas, draws };
}

describe('composeAvatar', () => {
  test('dessine chaque couche, dans l\'ordre, à sa variante, sur une planche de 24 × 2 images', async () => {
    const load: ImageLoader = vi.fn(async (url) => ({ url }) as unknown as CanvasImageSource);
    const { canvas, draws } = fakeCanvas();
    const key = formatCharacter({ body: 2, eyes: 3, outfit: { style: CHARACTER_PARTS.outfits[0]!.number, color: 1 }, hair: null, accessory: null });
    expect(await composeAvatar(key, load, () => canvas)).toBe(canvas);
    expect([canvas.width, canvas.height]).toEqual([768, 128]);
    expect(draws).toHaveLength(3);
    expect(draws.map((d) => d[2])).toEqual([128, 256, 0]);   // la ligne de la variante dans chaque fichier : corps 2, yeux 3, tenue 1
    expect(draws.every((d) => d[5] === 0 && d[6] === 0 && d[3] === 768 && d[4] === 128)).toBe(true);
  });

  test('une clé qui n\'est pas celle d\'un personnage : rien', async () => {
    expect(await composeAvatar('dev-red', vi.fn(), () => fakeCanvas().canvas)).toBeNull();
  });
});

// Un gestionnaire de textures et d'animations de poche : ce que la bibliothèque d'avatars lui demande, rien de plus.
function fakeGame() {
  const textures = new Map<string, { frames: number }>();
  const created: string[] = [];
  const manager = {
    exists: (key: string) => textures.has(key),
    addCanvas: (key: string) => {
      const texture = { frames: 0, add: () => (texture.frames += 1) };
      textures.set(key, texture);
      return texture;
    },
  };
  const anims = {
    exists: (key: string) => created.includes(key),
    generateFrameNumbers: (_key: string, config: { frames: number[] }) => config.frames.map((frame) => ({ frame })),
    create: (config: { key: string }) => created.push(config.key),
  };
  return { textures, created, manager: manager as never, anims: anims as never };
}

describe('AvatarLibrary', () => {
  const load: ImageLoader = async (url) => ({ url }) as unknown as CanvasImageSource;

  test('crée d\'emblée la silhouette qui prend la place d\'un avatar pas encore assemblé, avec ses animations', () => {
    const game = fakeGame();
    const library = new AvatarLibrary(game.manager, game.anims, load, () => fakeCanvas().canvas);
    expect(library.has(FALLBACK_KEY)).toBe(true);
    expect(game.textures.get(FALLBACK_KEY)!.frames).toBe(48);
    expect(game.created).toContain(animKey(FALLBACK_KEY, 'walk', 'left'));
    expect(library.textureFor('p.01')).toBe(FALLBACK_KEY);
    expect(library.specFor('p.01').key).toBe(FALLBACK_KEY);
  });

  test('ensure assemble l\'avatar : texture de 48 images, 8 animations ; ensuite il est prêt, et on ne le refait pas', async () => {
    const game = fakeGame();
    const library = new AvatarLibrary(game.manager, game.anims, load, () => fakeCanvas().canvas);
    expect(await library.ensure('p.04')).toBe(true);
    expect(game.textures.get('p.04')!.frames).toBe(48);
    expect(game.created.filter((key) => key.startsWith('p.04-'))).toHaveLength(8);
    expect(library.textureFor('p.04')).toBe('p.04');
    const before = game.created.length;
    expect(await library.ensure('p.04')).toBe(true);
    expect(game.created).toHaveLength(before);
  });

  test('des demandes simultanées pour le même avatar n\'en font qu\'un', async () => {
    const game = fakeGame();
    const spy = vi.fn(load);
    const library = new AvatarLibrary(game.manager, game.anims, spy, () => fakeCanvas().canvas);
    await Promise.all([library.ensure('p.02'), library.ensure('p.02'), library.ensure('p.02')]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('des pièces qui ne se chargent pas : l\'avatar n\'est pas prêt, la silhouette reste, et on ne réessaie pas sans fin', async () => {
    const game = fakeGame();
    const failing = vi.fn(async () => {
      throw new Error('réseau');
    });
    const library = new AvatarLibrary(game.manager, game.anims, failing, () => fakeCanvas().canvas);
    expect(await library.ensure(formatPremade(5))).toBe(false);
    expect(library.textureFor(formatPremade(5))).toBe(FALLBACK_KEY);
    expect(await library.ensure(formatPremade(5))).toBe(false);
    expect(failing).toHaveBeenCalledTimes(1);
  });

  test('ensureAll n\'attend pas au-delà du délai donné', async () => {
    const game = fakeGame();
    const never: ImageLoader = () => new Promise(() => {});
    const library = new AvatarLibrary(game.manager, game.anims, never, () => fakeCanvas().canvas);
    const started = Date.now();
    await library.ensureAll(['p.01'], 30);
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe('createAvatarAnimations', () => {
  test('une animation par genre (immobile, marche) et par direction, qui boucle, à la cadence de l\'avatar', () => {
    const created: Array<{ key: string; frameRate: number; repeat: number }> = [];
    const anims = {
      exists: () => false,
      generateFrameNumbers: (_key: string, config: { frames: number[] }) => config.frames.map((frame) => ({ frame })),
      create: (config: { key: string; frameRate: number; repeat: number }) => created.push(config),
    };
    createAvatarAnimations(anims as never, specOf('p.01'));
    expect(created).toHaveLength(8);
    expect(new Set(created.map((c) => c.key)).size).toBe(8);
    expect(created.every((c) => c.repeat === -1)).toBe(true);
    expect(created.find((c) => c.key === 'p.01-idle-down')!.frameRate).toBe(CHARACTER_SHEET.idleFrameRate);
    expect(created.find((c) => c.key === 'p.01-walk-down')!.frameRate).toBe(CHARACTER_SHEET.walkFrameRate);
  });

  test('une animation déjà créée ne l\'est pas deux fois (le gestionnaire est celui du jeu, partagé entre les scènes)', () => {
    const create = vi.fn();
    const anims = { exists: () => true, generateFrameNumbers: vi.fn(), create };
    createAvatarAnimations(anims as never, specOf('p.01'));
    expect(create).not.toHaveBeenCalled();
  });
});

describe('feetBody', () => {
  test('20 × 12 px, centrée en largeur, son bas un pixel sous les pieds : pour une image de 32 × 64', () => {
    expect(feetBody({ frameWidth: 32, frameHeight: 64 })).toEqual({ width: 20, height: 12, offsetX: 6, offsetY: 53 });
  });
});
