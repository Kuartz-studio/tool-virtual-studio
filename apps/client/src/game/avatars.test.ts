import { DEFAULT_AVATAR_KEY, DEV_AVATAR_KEYS, DIRECTIONS } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { animKey, avatarObjectName, avatarSpec, AVATARS, createAvatarAnimations, feetBody, resolveAvatarKey } from './avatars';

test('chaque avatar a immobile et marche dans les 4 directions', () => {
  for (const k of DEV_AVATAR_KEYS) for (const d of DIRECTIONS) { expect(AVATARS[k].idle[d].length).toBeGreaterThan(0); expect(AVATARS[k].walk[d].length).toBeGreaterThan(1); }
});

describe('avatars de développement', () => {
  test('le registre contient les 4 avatars de développement, sous leur clé', () => {
    expect(Object.keys(AVATARS).sort()).toEqual([...DEV_AVATAR_KEYS].sort());
    for (const key of DEV_AVATAR_KEYS) {
      expect(AVATARS[key].key).toBe(key);
      expect(AVATARS[key].url).toBe(`/assets/dev/avatars/${key}.png`);
      expect([AVATARS[key].frameWidth, AVATARS[key].frameHeight]).toEqual([32, 32]);
    }
  });

  test('la planche a 3 colonnes (immobile, pas 1, pas 2) et 4 lignes : bas 0, gauche 1, droite 2, haut 3', () => {
    const rows = { down: 0, left: 1, right: 2, up: 3 } as const;
    for (const key of DEV_AVATAR_KEYS) {
      for (const dir of DIRECTIONS) {
        const first = rows[dir] * 3;
        expect(AVATARS[key].idle[dir], `${key} immobile ${dir}`).toEqual([first]);
        expect(AVATARS[key].walk[dir], `${key} marche ${dir}`).toEqual([first, first + 1, first, first + 2]);
      }
    }
  });

  test('8 images par seconde', () => {
    for (const key of DEV_AVATAR_KEYS) expect(AVATARS[key].frameRate).toBe(8);
  });
});

test('animKey : `${avatar}-${genre}-${direction}`', () => {
  expect(animKey('dev-red', 'idle', 'down')).toBe('dev-red-idle-down');
  expect(animKey('dev-blue', 'walk', 'left')).toBe('dev-blue-walk-left');
  expect(animKey('avatar-03', 'walk', 'up')).toBe('avatar-03-walk-up');
});

describe('resolveAvatarKey', () => {
  test('un avatar du registre est gardé', () => {
    expect(resolveAvatarKey('dev-blue')).toBe('dev-blue');
  });

  test('pas d\'avatar choisi, ou un avatar que ce build ne connaît pas : l\'avatar par défaut', () => {
    for (const unknown of [null, undefined, '', 'avatar-99', 'constructor', 'toString']) expect(resolveAvatarKey(unknown)).toBe(DEFAULT_AVATAR_KEY);
  });

  test('l\'avatar par défaut est dans le registre', () => {
    expect(AVATARS[DEFAULT_AVATAR_KEY]).toBeDefined();
  });
});

test('avatarObjectName : le nom de l\'objet d\'un avatar dans la scène, par joueur', () => {
  expect(avatarObjectName('u-lea')).toBe('player:u-lea');
});

describe('avatarSpec', () => {
  test('la fiche de l\'avatar du registre', () => {
    expect(avatarSpec('dev-green')).toBe(AVATARS['dev-green']);
  });

  test('pas d\'avatar choisi, ou un avatar que ce build ne connaît pas : la fiche de l\'avatar par défaut', () => {
    for (const unknown of [null, undefined, '', 'avatar-99', 'constructor', '__proto__']) {
      expect(avatarSpec(unknown)).toBe(AVATARS[DEFAULT_AVATAR_KEY]);
      expect(avatarSpec(unknown).key).toBe(DEFAULT_AVATAR_KEY);
    }
  });
});

describe('createAvatarAnimations', () => {
  // Un gestionnaire d'animations qui note ce qu'on lui demande de créer.
  function fakeAnims() {
    const created: Array<{ key: string; frames: Array<{ key: string; frame: number }>; frameRate: number; repeat: number }> = [];
    const anims = {
      exists: (key: string) => created.some((anim) => anim.key === key),
      create: (config: (typeof created)[number]) => created.push(config),
      generateFrameNumbers: (texture: string, config: { frames: number[] }) => config.frames.map((frame) => ({ key: texture, frame })),
    };
    return { created, anims: anims as unknown as Parameters<typeof createAvatarAnimations>[0] };
  }

  test('une animation par genre (immobile, marche) et par direction, qui boucle, à la cadence de l\'avatar', () => {
    const { created, anims } = fakeAnims();
    createAvatarAnimations(anims, AVATARS['dev-green']);

    expect(created.map((anim) => anim.key).sort()).toEqual(
      DIRECTIONS.flatMap((dir) => [animKey('dev-green', 'idle', dir), animKey('dev-green', 'walk', dir)]).sort(),
    );
    for (const anim of created) {
      expect(anim.frameRate).toBe(8);
      expect(anim.repeat).toBe(-1);
    }
    const walkLeft = created.find((anim) => anim.key === 'dev-green-walk-left');
    expect(walkLeft?.frames).toEqual([3, 4, 3, 5].map((frame) => ({ key: 'dev-green', frame })));
    const idleUp = created.find((anim) => anim.key === 'dev-green-idle-up');
    expect(idleUp?.frames).toEqual([{ key: 'dev-green', frame: 9 }]);
  });

  test('une animation déjà créée ne l\'est pas deux fois (le gestionnaire est celui du jeu, partagé entre les scènes)', () => {
    const { created, anims } = fakeAnims();
    createAvatarAnimations(anims, AVATARS['dev-red']);
    createAvatarAnimations(anims, AVATARS['dev-red']);
    createAvatarAnimations(anims, AVATARS['dev-blue']);
    expect(created).toHaveLength(16);
  });
});

describe('feetBody', () => {
  test('20 × 12 px, centré sur la largeur et posé sur les pieds', () => {
    const body = feetBody({ frameWidth: 32, frameHeight: 32 });
    expect([body.width, body.height]).toEqual([20, 12]);
    expect(body.offsetX).toBe(6);
  });

  test('il dépasse d\'un pixel sous les pieds : arrêté contre un mur au sud, l\'avatar reste dans sa case', () => {
    // Les pieds (x, y) sont dans la case floor(y / 32) pour le serveur. Contre un mur au sud, le bas du corps touche le bord du
    // mur (y = 480, par exemple) : sans ce pixel, les pieds seraient en y = 480, déjà dans la case du mur.
    const body = feetBody({ frameWidth: 32, frameHeight: 32 });
    const bottom = body.offsetY + body.height;
    expect(bottom).toBe(32 + 1);
  });

  test('suit la taille de l\'image : une planche de 32 × 64 px a son corps en bas', () => {
    const body = feetBody({ frameWidth: 32, frameHeight: 64 });
    expect(body.offsetX).toBe(6);
    expect(body.offsetY + body.height).toBe(64 + 1);
  });
});
