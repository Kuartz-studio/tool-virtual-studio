import { PROPS } from '@bureau/shared';
import { expect, test, vi } from 'vitest';
import { propAnimationKey, propSheets, propTextureKey, registerPropAnimations } from './prop-textures';

test('une planche par objet animé, à l\'adresse où le serveur la sert, découpée à la taille d\'une image', () => {
  const sheets = propSheets();
  expect(sheets).toHaveLength(PROPS.length);
  expect(sheets.find((sheet) => sheet.key === 'prop:treadmill')).toEqual({ key: 'prop:treadmill', url: '/assets/props/treadmill.png', frameWidth: 64, frameHeight: 96 });
  expect(propTextureKey('coffee')).toBe('prop:coffee');
  expect(propAnimationKey('coffee')).toBe('prop:coffee:loop');
});

function fakeAnims(exists: (key: string) => boolean = () => false) {
  const created: Array<{ key: string; frames: { key: string; start: number; end: number }; frameRate: number; repeat: number }> = [];
  const anims = {
    exists,
    create: (config: (typeof created)[number]) => created.push(config),
    generateFrameNumbers: (key: string, { start, end }: { start: number; end: number }) => ({ key, start, end }),
  };
  return { anims, created };
}

test('une animation en boucle par objet qui tourne, à sa cadence ; la porte (qui ne boucle pas) et les planches absentes sont laissées de côté', () => {
  const { anims, created } = fakeAnims();
  registerPropAnimations(anims as never, { exists: (key: string) => key !== propTextureKey('candle') } as never);
  const keys = created.map((config) => config.key);
  expect(keys).toContain(propAnimationKey('treadmill'));
  expect(keys).not.toContain(propAnimationKey('door-glass-double'));
  expect(keys).not.toContain(propAnimationKey('candle'));
  expect(created.find((config) => config.key === propAnimationKey('treadmill'))).toEqual({
    key: 'prop:treadmill:loop',
    frames: { key: 'prop:treadmill', start: 0, end: 11 },
    frameRate: 12,
    repeat: -1,
  });
});

test('une animation déjà créée ne l\'est pas deux fois', () => {
  const create = vi.fn();
  registerPropAnimations({ exists: () => true, create, generateFrameNumbers: vi.fn() } as never, { exists: () => true } as never);
  expect(create).not.toHaveBeenCalled();
});
