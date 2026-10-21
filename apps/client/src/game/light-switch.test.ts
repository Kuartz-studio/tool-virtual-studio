import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TILE_SIZE, buildOffice, buildOfficeTiledMap, parseOfficeMap } from '@bureau/shared';
import { PNG } from 'pngjs';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { DECOR_DEPTH, layoutDecor, type Drawn } from './decor-layout';
import { addSwitchTextures, LightSwitch, PLATE, plateRows, SWITCH_TEXTURES } from './light-switch';
import { DEPTH } from './map-layers';

const POS = { x: 1040, y: 336 };
const cases = (n: number) => n * TILE_SIZE;
const feet = (dx: number, dy: number) => ({ x: POS.x + dx, y: POS.y + dy });

// Un objet de jeu de poche (Phaser a besoin d'un vrai canevas) : il note ce qu'on lui demande, rien de plus.
class FakeObject {
  depth = 0;
  visible = true;
  text = '';
  textureKey = '';
  resolution = 1;
  interactive = false;
  destroyed = false;
  readonly handlers = new Map<string, () => void>();
  constructor(
    readonly kind: 'image' | 'rectangle' | 'text',
    readonly x: number,
    readonly y: number,
    readonly extra: Record<string, unknown> = {},
  ) {
    if (typeof extra.texture === 'string') this.textureKey = extra.texture;
    if (typeof extra.text === 'string') this.text = extra.text;
  }
  setDepth(depth: number) { this.depth = depth; return this; }
  setVisible(visible: boolean) { this.visible = visible; return this; }
  setOrigin() { return this; }
  setVertexRoundMode() { return this; }
  setInteractive() { this.interactive = true; return this; }
  setText(text: string) { this.text = text; return this; }
  setTexture(key: string) { this.textureKey = key; return this; }
  setResolution(resolution: number) { this.resolution = resolution; return this; }
  on(event: string, fn: () => void) { this.handlers.set(event, fn); return this; }
  destroy() { this.destroyed = true; }
}

function fakeScene() {
  const made: FakeObject[] = [];
  const make = (kind: FakeObject['kind'], x: number, y: number, extra?: Record<string, unknown>) => {
    const object = new FakeObject(kind, x, y, extra);
    made.push(object);
    return object;
  };
  const scene = {
    add: {
      image: (x: number, y: number, texture: string) => make('image', x, y, { texture }),
      rectangle: (x: number, y: number, width: number, height: number, color: number) => make('rectangle', x, y, { width, height, color }),
      text: (x: number, y: number, text: string, style: Record<string, unknown>) => make('text', x, y, { text, style }),
    },
  } as unknown as Phaser.Scene;
  const only = (kind: FakeObject['kind']) => made.find((object) => object.kind === kind)!;
  return { scene, made, plate: () => only('image'), beacon: () => only('rectangle'), label: () => only('text') };
}

const switches: LightSwitch[] = [];
function setup(onUse: () => void = () => {}) {
  const game = fakeScene();
  const lightSwitch = new LightSwitch(game.scene, POS, onUse);
  switches.push(lightSwitch);
  return { ...game, lightSwitch };
}
afterEach(() => {
  for (const lightSwitch of switches.splice(0)) lightSwitch.destroy();
  document.body.replaceChildren();
});

const pressE = (init: KeyboardEventInit = {}, target: EventTarget = window) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', code: 'KeyE', bubbles: true, cancelable: true, ...init }));

describe('la plaque', () => {
  test('10 × 14 px, sur la face du mur au-dessus de la plinthe : devant les murs et ce qu\'on y accroche, derrière les meubles et les avatars', () => {
    const { plate } = setup();
    expect(PLATE).toEqual({ width: 10, height: 14, offsetY: -4 });
    expect([plate().x, plate().y]).toEqual([POS.x, POS.y - 4]);
    expect(plate().depth).toBeGreaterThan(DECOR_DEPTH.wall);
    expect(plate().depth).toBeLessThan(DEPTH.meublesBas);
  });

  test('allumée au départ : la plaque « allumée », sans témoin ni étiquette', () => {
    const { plate, beacon, label } = setup();
    expect(plate().textureKey).toBe(SWITCH_TEXTURES.on);
    expect(beacon().visible).toBe(false);
    expect(label().visible).toBe(false);
  });

  test('éteinte : la plaque « éteinte » et le témoin ambré de 2 × 2 px, au-dessus de la nuit ; rallumée : le témoin s\'éteint', () => {
    const { lightSwitch, plate, beacon } = setup();
    lightSwitch.setOn(false);
    expect(plate().textureKey).toBe(SWITCH_TEXTURES.off);
    expect(beacon().visible).toBe(true);
    expect(beacon().extra).toMatchObject({ width: 2, height: 2, color: 0xf59e0b });
    // La couche de nuit sera à 1 000 000,5 : le témoin passe devant, pour qu'on trouve la plaque dans le noir.
    expect(beacon().depth).toBe(1_000_000.6);
    lightSwitch.setOn(true);
    expect(plate().textureKey).toBe(SWITCH_TEXTURES.on);
    expect(beacon().visible).toBe(false);
  });

  test('le témoin est posé sur la plaque, sur des pixels entiers', () => {
    const { beacon } = setup();
    const { plate } = setup();
    const [left, right] = [beacon().x - 1, beacon().x + 1];
    const [top, bottom] = [beacon().y - 1, beacon().y + 1];
    expect(left).toBeGreaterThanOrEqual(plate().x - PLATE.width / 2);
    expect(right).toBeLessThanOrEqual(plate().x + PLATE.width / 2);
    expect(top).toBeGreaterThanOrEqual(plate().y - PLATE.height / 2);
    expect(bottom).toBeLessThanOrEqual(plate().y + PLATE.height / 2);
    expect([left, top].every(Number.isInteger)).toBe(true);
  });
});

describe('à portée', () => {
  test('updateReach : à 3 cases c\'est à portée, à 4 cases non, en ligne droite', () => {
    const { lightSwitch } = setup();
    expect(lightSwitch.updateReach(feet(0, cases(3)))).toBe(true);
    expect(lightSwitch.updateReach(feet(cases(3), 0))).toBe(true);
    expect(lightSwitch.updateReach(feet(0, cases(4)))).toBe(false);
    expect(lightSwitch.updateReach(feet(0, cases(3) + 1))).toBe(false);
    expect(lightSwitch.updateReach(feet(cases(2), cases(2)))).toBe(true);   // 2,83 cases
    expect(lightSwitch.updateReach(feet(72, 72))).toBe(false);   // 3,18 cases
    expect(lightSwitch.updateReach(feet(0, 0))).toBe(true);
  });

  test('l\'étiquette n\'est là qu\'à portée, devant tout, au-dessus de la plaque', () => {
    const { lightSwitch, label, plate } = setup();
    lightSwitch.updateReach(feet(0, cases(2)));
    expect(label().visible).toBe(true);
    expect(label().depth).toBe(DEPTH.nameTags);
    expect(label().y).toBeLessThanOrEqual(plate().y - PLATE.height / 2);
    expect(label().x).toBe(POS.x);
    lightSwitch.updateReach(feet(0, cases(5)));
    expect(label().visible).toBe(false);
  });

  test('l\'étiquette dit ce que la touche va faire : « [E] Éteindre » quand c\'est allumé, « [E] Allumer » quand c\'est éteint', () => {
    const { lightSwitch, label } = setup();
    expect(label().text).toBe('[E] Éteindre');
    lightSwitch.setOn(false);
    expect(label().text).toBe('[E] Allumer');
    lightSwitch.setOn(true);
    expect(label().text).toBe('[E] Éteindre');
  });

  test('l\'étiquette est dans le style de celles des noms : texte blanc de 10 px sur une pastille sombre translucide', () => {
    const { label } = setup();
    expect(label().extra.style).toMatchObject({ fontSize: '10px', color: '#ffffff', backgroundColor: 'rgba(29, 32, 48, 0.75)', padding: { x: 3, y: 1 } });
  });

  test('setZoom : le texte est dessiné à la taille où on le voit, jamais en dessous de 1', () => {
    const { lightSwitch, label } = setup();
    lightSwitch.setZoom(2);
    expect(label().resolution).toBe(2);
    lightSwitch.setZoom(0.5);
    expect(label().resolution).toBe(1);
  });
});

describe('la touche E et le clic', () => {
  test('E : onUse est appelé à portée seulement', () => {
    const onUse = vi.fn();
    const { lightSwitch } = setup(onUse);
    pressE();
    expect(onUse).not.toHaveBeenCalled();   // personne n'est encore à portée

    lightSwitch.updateReach(feet(0, cases(3)));
    pressE();
    expect(onUse).toHaveBeenCalledTimes(1);

    lightSwitch.updateReach(feet(0, cases(4)));
    pressE();
    expect(onUse).toHaveBeenCalledTimes(1);
  });

  test('si l\'on sait où sont ses pieds, la portée est celle de l\'instant : un pas, ou une téléportation, depuis la dernière image comptent', () => {
    const onUse = vi.fn();
    const game = fakeScene();
    let where = feet(0, cases(8));
    switches.push(new LightSwitch(game.scene, POS, onUse, () => where));
    pressE();
    expect(onUse).not.toHaveBeenCalled();
    expect(game.label().visible).toBe(false);

    where = feet(0, cases(2));   // aucune image entre-temps : personne n'a appelé updateReach
    pressE();
    expect(onUse).toHaveBeenCalledTimes(1);
    expect(game.label().visible).toBe(true);

    where = feet(0, cases(8));
    game.plate().handlers.get('pointerdown')!();
    expect(onUse).toHaveBeenCalledTimes(1);
    expect(game.label().visible).toBe(false);
  });

  test('le clic sur la plaque : de même, à portée seulement', () => {
    const onUse = vi.fn();
    const { lightSwitch, plate } = setup(onUse);
    expect(plate().interactive).toBe(true);
    const click = plate().handlers.get('pointerdown')!;
    click();
    expect(onUse).not.toHaveBeenCalled();
    lightSwitch.updateReach(feet(cases(1), cases(1)));
    click();
    expect(onUse).toHaveBeenCalledTimes(1);
  });

  test('dans un champ de saisie (le chat), E s\'écrit : rien', () => {
    const onUse = vi.fn();
    const { lightSwitch } = setup(onUse);
    lightSwitch.updateReach(feet(0, cases(1)));
    const field = document.body.appendChild(document.createElement('input'));
    field.focus();
    pressE({}, field);
    expect(onUse).not.toHaveBeenCalled();
  });

  test('ce n\'est qu\'une demande : la plaque ne change qu\'à l\'annonce du serveur (setOn)', () => {
    const { lightSwitch, plate } = setup();
    lightSwitch.updateReach(feet(0, cases(1)));
    pressE();
    expect(plate().textureKey).toBe(SWITCH_TEXTURES.on);
    lightSwitch.setOn(false);
    expect(plate().textureKey).toBe(SWITCH_TEXTURES.off);
  });

  test('destroy : les objets disparaissent et la touche E ne fait plus rien', () => {
    const onUse = vi.fn();
    const { lightSwitch, made } = setup(onUse);
    lightSwitch.updateReach(feet(0, cases(1)));
    lightSwitch.destroy();
    expect(made.every((object) => object.destroyed)).toBe(true);
    pressE();
    expect(onUse).not.toHaveBeenCalled();
  });
});

// La vraie carte : l'interrupteur y est posé, et rien ne s'interpose entre lui et celui qui le regarde.
describe('l\'interrupteur de la grande carte', () => {
  const map = parseOfficeMap(buildOfficeTiledMap());
  const ATLASES = join(import.meta.dirname, '../../public/assets/decor');
  const atlases = new Map<string, PNG>();
  const atlasOf = (category: string) => {
    if (!atlases.has(category)) atlases.set(category, PNG.sync.read(readFileSync(join(ATLASES, `${category}.png`))));
    return atlases.get(category)!;
  };

  // Un pixel de ce meuble (et non seulement le rectangle de son image, dont le haut est souvent transparent) tombe-t-il dans cette zone ?
  function paintsOver(drawn: Drawn, area: { left: number; right: number; top: number; bottom: number }): boolean {
    const [width, height] = [drawn.item.w * TILE_SIZE, drawn.item.h * TILE_SIZE];
    const top = drawn.bottom - height;
    const atlas = atlasOf(drawn.item.cat);
    for (let y = Math.max(area.top, top); y < Math.min(area.bottom, drawn.bottom); y++) {
      for (let x = Math.max(area.left, drawn.left); x < Math.min(area.right, drawn.left + width); x++) {
        const [sx, sy] = [drawn.item.fx + (x - drawn.left), drawn.item.fy + (y - top)];
        if (atlas.data[(sy * atlas.width + sx) * 4 + 3]! > 0) return true;
      }
    }
    return false;
  }

  test('il y en a un, lu comme le lit le serveur', () => {
    expect(map.switches).toHaveLength(1);
  });

  test('aucun meuble ne passe devant la plaque : l\'image de l\'arbuste voisin monte jusqu\'au mur, mais ses feuilles n\'y arrivent pas', () => {
    const [position] = map.switches;
    const game = fakeScene();
    switches.push(new LightSwitch(game.scene, position!, () => {}));
    const [plateX, plateY] = [game.plate().x, game.plate().y];
    const area = { left: plateX - PLATE.width / 2, right: plateX + PLATE.width / 2, top: plateY - PLATE.height / 2, bottom: plateY + PLATE.height / 2 };
    const placed = buildOffice().canvas.decor.map(({ id, x, y }) => ({ id, x, y }));
    for (const drawn of layoutDecor(placed)) {
      if (drawn.depth <= game.plate().depth) continue;   // les tapis et ce qui est accroché aux murs sont sous la plaque
      expect(paintsOver(drawn, area), `${drawn.item.name} en case ${drawn.placed.x}, ${drawn.placed.y}`).toBe(false);
    }
  });

  test('il est sur la face du mur nord du couloir, entre les portes des bureaux A3 et A4, et on peut s\'y tenir en dessous', () => {
    const [position] = map.switches;
    const [tx, ty] = [Math.floor(position!.x / TILE_SIZE), Math.floor(position!.y / TILE_SIZE)];
    expect([tx, ty]).toEqual([32, 10]);
    const doors = map.zones.filter((zone) => zone.type === 'door');
    const between = (key: string) => doors.find((door) => door.name === key)!;
    expect(tx * TILE_SIZE).toBeGreaterThan(between('A3').x + between('A3').width);
    expect((tx + 1) * TILE_SIZE).toBeLessThan(between('A4').x);
    // Un mur sous lui : l'avatar ne s'y met pas ; la case juste au sud est le couloir, praticable.
    expect(map.blocked[ty * map.widthTiles + tx]).toBe(1);
    expect(map.blocked[(ty + 1) * map.widthTiles + tx]).toBe(0);
  });
});

describe('les textures de la plaque', () => {
  const COLORS = new Set(['o', 'h', 'p', 's', 'k', 'd']);

  test('14 rangées de 10 pixels, chacun transparent ou d\'une couleur de la palette', () => {
    for (const on of [true, false]) {
      const rows = plateRows(on);
      expect(rows).toHaveLength(PLATE.height);
      for (const row of rows) {
        expect(row).toHaveLength(PLATE.width);
        for (const pixel of row) expect(pixel === '.' || COLORS.has(pixel), pixel).toBe(true);
      }
    }
  });

  test('un contour sombre ferme la plaque : rien de clair sur un bord', () => {
    const rows = plateRows(true);
    expect([...rows[0]!].filter((pixel) => pixel !== '.' && pixel !== 'o')).toEqual([]);
    expect([...rows.at(-1)!].filter((pixel) => pixel !== '.' && pixel !== 'o')).toEqual([]);
    for (const row of rows.slice(1, -1)) expect(row.replaceAll('.', '').at(0) === 'o' && row.replaceAll('.', '').at(-1) === 'o').toBe(true);
  });

  test('allumée et éteinte ne diffèrent que par le basculeur : sa moitié claire est en haut, ou en bas', () => {
    const [on, off] = [plateRows(true), plateRows(false)];
    const differing = on.flatMap((row, y) => [...row].flatMap((pixel, x) => (pixel === off[y]![x] ? [] : [[x, y] as const])));
    expect(differing.length).toBeGreaterThan(0);
    // Tous dans la face du basculeur (2 pixels de large, au milieu), et ni sur son contour ni sur la plaque.
    for (const [x, y] of differing) {
      expect(x).toBeGreaterThanOrEqual(4);
      expect(x).toBeLessThanOrEqual(5);
      expect(y).toBeGreaterThanOrEqual(4);
      expect(y).toBeLessThanOrEqual(9);
    }
    expect(on[4]![4]).toBe('k');
    expect(on[9]![4]).toBe('d');
    expect(off[4]![4]).toBe('d');
    expect(off[9]![4]).toBe('k');
  });

  describe('addSwitchTextures', () => {
    // Un canevas qui note ce qu'on dessine dessus, et un gestionnaire de textures de poche.
    function fakeTextures() {
      const existing = new Set<string>();
      const drawn = new Map<string, Array<[x: number, y: number, w: number, h: number, color: string]>>();
      const canvases: Array<{ width: number; height: number }> = [];
      const makeCanvas = () => {
        const fills: Array<[number, number, number, number, string]> = [];
        let color = '';
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => ({
            set fillStyle(value: string) { color = value; },
            fillRect: (x: number, y: number, w: number, h: number) => fills.push([x, y, w, h, color]),
          }),
          fills,
        };
        canvases.push(canvas);
        return canvas as unknown as HTMLCanvasElement & { fills: typeof fills };
      };
      const textures = {
        exists: (key: string) => existing.has(key),
        addCanvas: (key: string, canvas: { fills: Array<[number, number, number, number, string]> }) => {
          existing.add(key);
          drawn.set(key, canvas.fills);
          return {};
        },
      } as unknown as Phaser.Textures.TextureManager;
      return { textures, makeCanvas, drawn, canvases, existing };
    }

    test('les deux plaques, de 10 × 14 px, dessinées pixel par pixel', () => {
      const game = fakeTextures();
      addSwitchTextures(game.textures, game.makeCanvas);
      expect([...game.drawn.keys()]).toEqual(['switch:on', 'switch:off']);
      expect(game.canvases.map((canvas) => [canvas.width, canvas.height])).toEqual([[10, 14], [10, 14]]);
      for (const [key, fills] of game.drawn) {
        const rows = plateRows(key === 'switch:on');
        const opaque = rows.flatMap((row) => [...row]).filter((pixel) => pixel !== '.').length;
        expect(fills, key).toHaveLength(opaque);
        expect(fills.every(([, , w, h]) => w === 1 && h === 1)).toBe(true);
        expect(fills.every(([, , , , color]) => /^#[0-9a-f]{6}$/.test(color))).toBe(true);
      }
    });

    test('déjà créées (le jeu relance la scène) : rien n\'est refait', () => {
      const game = fakeTextures();
      addSwitchTextures(game.textures, game.makeCanvas);
      addSwitchTextures(game.textures, game.makeCanvas);
      expect(game.canvases).toHaveLength(2);
    });

    test('un navigateur sans contexte 2D : pas de plantage, les textures existent quand même (vides), pas de rectangle vert « texture absente »', () => {
      const game = fakeTextures();
      const noContext = () => ({ width: 0, height: 0, getContext: () => null }) as unknown as HTMLCanvasElement;
      expect(() => addSwitchTextures(game.textures, noContext)).not.toThrow();
      expect([...game.existing]).toEqual(['switch:on', 'switch:off']);
    });
  });
});
