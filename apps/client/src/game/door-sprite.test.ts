import { TILE_SIZE, propByKey, type Zone } from '@bureau/shared';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { CLOSED_FRAME, DOOR_ANIMATIONS, DoorSprite, OPEN_FRAME, registerDoorAnimations } from './door-sprite';
import { propTextureKey } from './prop-textures';
import * as reducedMotion from './reduced-motion';

// Un sprite de poche : il note ce qu'on lui demande, et laisse le test finir l'animation en cours.
class FakeSprite {
  frame = -1;
  depth = 0;
  played: string[] = [];
  destroyed = false;
  interactive = false;
  private completion: (() => void) | null = null;
  constructor(readonly x: number, readonly y: number, readonly texture: string) {}
  setOrigin() { return this; }
  setDepth(depth: number) { this.depth = depth; return this; }
  setVertexRoundMode() { return this; }
  setFrame(frame: number) { this.frame = frame; return this; }
  setInteractive() { this.interactive = true; return this; }
  play(key: string) { this.played.push(key); return this; }
  once(_event: string, fn: () => void) { this.completion = fn; return this; }
  stop() { this.completion = null; return this; }
  destroy() { this.destroyed = true; }
  // L'animation en cours se termine.
  finish() {
    const done = this.completion;
    this.completion = null;
    done?.();
  }
}

function setup(initial: 'open' | 'closed' = 'open') {
  let sprite!: FakeSprite;
  const scene = {
    add: { sprite: (x: number, y: number, texture: string) => (sprite = new FakeSprite(x, y, texture)) },
  } as unknown as Phaser.Scene;
  // La porte de A1 : les cases (4..5, 9..10).
  const zone = { x: 4 * TILE_SIZE, y: 9 * TILE_SIZE, width: 2 * TILE_SIZE, height: 2 * TILE_SIZE } as Zone;
  const door = new DoorSprite(scene, zone, initial);
  const moves: boolean[] = [];
  door.onMoved((open) => moves.push(open));
  return { door, sprite, moves };
}

afterEach(() => vi.restoreAllMocks());

describe('registerDoorAnimations : s\'ouvrir et se fermer', () => {
  const door = propTextureKey('door-glass-double');
  function run(exists: (key: string) => boolean = () => false, textureThere = true) {
    const created: unknown[] = [];
    const anims = { exists, create: (config: unknown) => created.push(config), generateFrameNumbers: (key: string, config: object) => ({ key, ...config }) };
    registerDoorAnimations(anims as never, { exists: () => textureThere } as never);
    return created;
  }

  test('deux animations, une fois chacune (la porte s\'arrête sur l\'image finale), à la cadence de la planche', () => {
    const fps = propByKey('door-glass-double')!.fps;
    expect(run()).toEqual([
      { key: 'door:open', frames: { key: door, frames: [0, 1, 2, 3, 4] }, frameRate: fps, repeat: 0 },
      { key: 'door:close', frames: { key: door, frames: [4, 5, 6, 7, 0] }, frameRate: fps, repeat: 0 },
    ]);
  });

  test('une planche absente, ou des animations déjà créées (la scène redémarre) : rien', () => {
    expect(run(() => false, false)).toEqual([]);
    expect(run(() => true)).toEqual([]);
  });
});

describe('la porte vitrée', () => {
  test('l\'image de la porte vitrée double : 8 images, la 0 fermée, la 4 ouverte, celles d\'entre deux pour le mouvement', () => {
    expect(propByKey('door-glass-double')!.frames).toBe(8);
    expect([CLOSED_FRAME, OPEN_FRAME]).toEqual([0, 4]);
    expect(DOOR_ANIMATIONS.open).toEqual({ key: 'door:open', frames: [0, 1, 2, 3, 4] });
    // Elle se referme par les images 5 à 7, puis retrouve la fermée.
    expect(DOOR_ANIMATIONS.close).toEqual({ key: 'door:close', frames: [4, 5, 6, 7, 0] });
  });

  test('elle est posée au bas de sa bande de mur, au milieu de ses deux cases, devant ce qui est plus haut', () => {
    const { sprite } = setup();
    expect(sprite.texture).toBe(propTextureKey('door-glass-double'));
    expect([sprite.x, sprite.y]).toEqual([4 * TILE_SIZE, 11 * TILE_SIZE]);
    expect(sprite.depth).toBe(11 * TILE_SIZE);
  });

  test('au début, la porte est dans l\'état qu\'on lui donne, sans animation ni bruit', () => {
    const open = setup('open');
    expect([open.door.phase, open.sprite.frame, open.sprite.played]).toEqual(['open', OPEN_FRAME, []]);
    const closed = setup('closed');
    expect([closed.door.phase, closed.sprite.frame, closed.sprite.played]).toEqual(['closed', CLOSED_FRAME, []]);
    expect(open.moves.concat(closed.moves)).toEqual([]);
  });

  test('fermer une porte ouverte : l\'animation de fermeture joue, l\'écoute le sait, et à la fin la porte est fermée', () => {
    const { door, sprite, moves } = setup('open');
    door.setTarget('closed');
    expect(door.phase).toBe('closing');
    expect(sprite.played).toEqual(['door:close']);
    expect(moves).toEqual([false]);
    sprite.finish();
    expect(door.phase).toBe('closed');
    expect(sprite.frame).toBe(CLOSED_FRAME);
  });

  test('la rouvrir : l\'animation d\'ouverture, et à la fin la porte est ouverte (l\'image des battants de chant)', () => {
    const { door, sprite, moves } = setup('closed');
    door.setTarget('open');
    expect(door.phase).toBe('opening');
    expect(sprite.played).toEqual(['door:open']);
    expect(moves).toEqual([true]);
    sprite.finish();
    expect(door.phase).toBe('open');
    expect(sprite.frame).toBe(OPEN_FRAME);
  });

  test('la même cible demandée deux fois : une seule animation', () => {
    const { door, sprite, moves } = setup('open');
    door.setTarget('closed');
    door.setTarget('closed');
    expect(sprite.played).toEqual(['door:close']);
    expect(moves).toEqual([false]);
    sprite.finish();
    door.setTarget('closed');
    expect(sprite.played).toEqual(['door:close']);
  });

  test('une cible qui change en pleine fermeture : la porte finit de se fermer, puis se rouvre, sans demi-tour', () => {
    const { door, sprite, moves } = setup('open');
    door.setTarget('closed');
    door.setTarget('open');
    expect(sprite.played).toEqual(['door:close']);
    sprite.finish();
    expect(sprite.played).toEqual(['door:close', 'door:open']);
    expect(door.phase).toBe('opening');
    expect(moves).toEqual([false, true]);
    sprite.finish();
    expect(door.phase).toBe('open');
  });

  test('instant : l\'état change tout de suite, sans animation ni bruit (à l\'arrivée dans le bureau)', () => {
    const { door, sprite, moves } = setup('open');
    door.setTarget('closed', { instant: true });
    expect([door.phase, sprite.frame, sprite.played, moves]).toEqual(['closed', CLOSED_FRAME, [], []]);
    door.setTarget('open', { instant: true });
    expect([door.phase, sprite.frame]).toEqual(['open', OPEN_FRAME]);
  });

  test('mouvement réduit : elle saute à l\'image finale, sans animation, et l\'écoute en est prévenue', () => {
    vi.spyOn(reducedMotion, 'prefersReducedMotion').mockReturnValue(true);
    const { door, sprite, moves } = setup('open');
    door.setTarget('closed');
    expect([door.phase, sprite.frame, sprite.played, moves]).toEqual(['closed', CLOSED_FRAME, [], [false]]);
    door.setTarget('open');
    expect([door.phase, sprite.frame, moves]).toEqual(['open', OPEN_FRAME, [false, true]]);
  });

  test('détruite : le sprite part et l\'écoute n\'est plus prévenue ; une écoute retirée ne l\'est plus non plus', () => {
    const { door, sprite, moves } = setup('open');
    const heard: boolean[] = [];
    const off = door.onMoved((open) => heard.push(open));
    off();
    door.setTarget('closed');
    expect(heard).toEqual([]);
    expect(moves).toEqual([false]);
    door.destroy();
    expect(sprite.destroyed).toBe(true);
    sprite.finish();
    door.setTarget('open');
    expect(moves).toEqual([false]);
  });
});
