import { TILE_SIZE, decorItem } from '@bureau/shared';
import { describe, expect, test } from 'vitest';
import { LIGHT_EMITTERS, LIGHT_PROFILES, sourcesFromItems, sourcesFromProps, type LightKind } from './light-sources';

// Le rectangle de l'image d'un élément de la banque posé à (x, y), en pixels de la carte : ce que DecorLayer donne.
const placed = (id: string, x: number, y: number) => {
  const item = decorItem(id);
  if (!item) throw new Error(`${id} n'est pas dans la banque`);
  return { id, x, y, w: item.w * TILE_SIZE, h: item.h * TILE_SIZE };
};

// Les lampadaires, les lampes articulées (et les postes portables avec la leur), les lampes de chevet.
const FLOOR_LAMPS = ['lr-12-9', 'lr-11-9', 'lr-13-9', 'lr-12-12', 'lr-13-12'];
const DESK_LAMPS = ['of-11-15', 'of-10-16', 'of-11-17', 'of-11-19', 'of-11-21', 'of-11-23', 'of-8-26', 'of-14-26'];
const BEDSIDE_LAMPS = ['lr-14-7', 'lr-15-7', 'lr-14-9', 'lr-15-9', 'lr-14-13', 'lr-15-13'];
const LAMPS = [...FLOOR_LAMPS, ...DESK_LAMPS, ...BEDSIDE_LAMPS];
// Les écrans allumés de la banque : les écrans bleus et ceux sur pied, les moniteurs compacts, les doubles écrans, les portables et les postes
// complets, plus l'écran de présentation. Les écrans noirs et blancs (éteints) n'éclairent pas.
const COMPUTER_SCREENS = [
  'of-13-12', 'of-14-12', 'of-15-12', 'of-13-13', 'of-14-13', 'of-15-13',
  'of-12-35', 'of-12-36', 'of-8-44', 'of-9-44',
  'of-10-35', 'of-11-35', 'of-10-44', 'of-11-44',
  'of-13-15', 'of-14-15', 'of-15-15', 'of-13-17', 'of-14-17', 'of-15-17',
  'of-10-30', 'of-10-32',
];
const SWITCHED_OFF_SCREENS = ['of-14-8', 'of-15-8', 'of-14-10', 'of-15-10'];
const SCREENS = ['of-9-14', ...COMPUTER_SCREENS];
const TVS = ['tv-10-3', 'tv-10-1'];
// Les panneaux de sortie : vert vif et citron, la flèche à droite et (l'image retournée) à gauche.
const EXIT_SIGNS = ['mu-14-111', 'mu-14-111-m', 'mu-15-111', 'mu-15-111-m'];
const FIREPLACE = 'lr-4-24';
// Les horloges murales qui luisent : l'horloge LED (ses chiffres rouges) et l'horloge de gare (son cadran rétroéclairé).
const GLOWING_CLOCKS = ['horloge-led', 'horloge-gare'];

// La lumière que donne cet élément, posé n'importe où.
const sourceOf = (id: string) => sourcesFromItems([placed(id, 0, 0)])[0]!;
const warmth = (color: number) => ((color >> 16) & 255) - (color & 255);

describe('LIGHT_PROFILES', () => {
  const kinds = Object.keys(LIGHT_PROFILES) as LightKind[];

  test('huit sortes de lumière, chacune avec une portée, une force entre 0 et 1 et une couleur', () => {
    expect([...kinds].sort()).toEqual(['candle', 'exit', 'fire', 'glow', 'lamp', 'screen', 'tv', 'water']);
    for (const kind of kinds) {
      const profile = LIGHT_PROFILES[kind];
      expect(profile.radiusTiles, kind).toBeGreaterThan(0);
      expect(profile.strength, kind).toBeGreaterThan(0);
      expect(profile.strength, kind).toBeLessThanOrEqual(1);
      expect(profile.color, kind).toBeGreaterThan(0);
    }
  });

  test('le feu est la lumière la plus forte et la plus large ; celle d\'une LED n\'est qu\'un point', () => {
    for (const kind of kinds.filter((other) => other !== 'fire')) {
      expect(LIGHT_PROFILES.fire.strength, kind).toBeGreaterThan(LIGHT_PROFILES[kind].strength);
      expect(LIGHT_PROFILES.fire.radiusTiles, kind).toBeGreaterThan(LIGHT_PROFILES[kind].radiusTiles);
    }
    for (const kind of kinds.filter((other) => other !== 'glow')) {
      expect(LIGHT_PROFILES.glow.strength, kind).toBeLessThan(LIGHT_PROFILES[kind].strength);
      expect(LIGHT_PROFILES.glow.radiusTiles, kind).toBeLessThan(LIGHT_PROFILES[kind].radiusTiles);
    }
  });

  test('les flammes, les télévisions et les panneaux de sortie vacillent (la télévision à 6 Hz, le panneau à 3 Hz), le reste ne bouge pas ; jamais de plus de 10 %', () => {
    expect(kinds.filter((kind) => LIGHT_PROFILES[kind].flicker).sort()).toEqual(['candle', 'exit', 'fire', 'tv']);
    expect(LIGHT_PROFILES.tv.flicker?.hz).toBe(6);
    expect(LIGHT_PROFILES.exit.flicker?.hz).toBe(3);
    for (const kind of kinds) {
      const flicker = LIGHT_PROFILES[kind].flicker;
      if (!flicker) continue;
      expect(flicker.amplitude, kind).toBeGreaterThan(0);
      expect(flicker.amplitude, kind).toBeLessThanOrEqual(0.1);
      expect(flicker.hz, kind).toBeGreaterThan(0);
    }
  });

  test('le feu, les lampes et les bougies sont chauds ; les écrans, les télévisions et l\'eau froids', () => {
    for (const kind of ['lamp', 'fire', 'candle'] as const) expect(warmth(LIGHT_PROFILES[kind].color), kind).toBeGreaterThan(0);
    for (const kind of ['screen', 'tv', 'water'] as const) expect(warmth(LIGHT_PROFILES[kind].color), kind).toBeLessThan(0);
  });
});

describe('LIGHT_EMITTERS', () => {
  test('les lampes, la cheminée, les écrans, les télévisions, les panneaux de sortie et deux horloges éclairent, et rien d\'autre', () => {
    for (const id of LAMPS) expect(LIGHT_EMITTERS[id]?.kind, id).toBe('lamp');
    expect(LIGHT_EMITTERS[FIREPLACE]?.kind).toBe('fire');
    for (const id of SCREENS) expect(LIGHT_EMITTERS[id]?.kind, id).toBe('screen');
    for (const id of TVS) expect(LIGHT_EMITTERS[id]?.kind, id).toBe('tv');
    for (const id of EXIT_SIGNS) expect(LIGHT_EMITTERS[id]?.kind, id).toBe('exit');
    for (const id of GLOWING_CLOCKS) expect(LIGHT_EMITTERS[id]?.kind, id).toBe('glow');
    expect(Object.keys(LIGHT_EMITTERS)).toHaveLength(LAMPS.length + 1 + SCREENS.length + TVS.length + EXIT_SIGNS.length + GLOWING_CLOCKS.length);
  });

  test('la nuit, l\'horloge LED luit du rouge de ses chiffres et l\'horloge de gare à peine : moins qu\'une lampe, sans vaciller ; la ronde et la pendule n\'éclairent pas', () => {
    const led = sourceOf('horloge-led');
    expect((led.color >> 16) & 255).toBeGreaterThan(led.color & 255);
    for (const id of GLOWING_CLOCKS) {
      expect(sourceOf(id).strength, id).toBeLessThan(sourceOf('of-11-15').strength);
      expect(sourceOf(id).flicker, id).toBeUndefined();
    }
    expect(sourcesFromItems([placed('horloge-ronde', 0, 0), placed('horloge-balancier', 0, 0)])).toEqual([]);
  });

  test('un panneau de sortie donne un petit halo vert, plus fort qu\'une LED et plus faible qu\'une lampe, qui scintille', () => {
    for (const id of EXIT_SIGNS) {
      const source = sourceOf(id);
      expect(source.kind, id).toBe('exit');
      // Vert : plus de vert que de rouge et que de bleu.
      const [r, g, b] = [(source.color >> 16) & 255, (source.color >> 8) & 255, source.color & 255];
      expect(g, id).toBeGreaterThan(r);
      expect(g, id).toBeGreaterThan(b);
      expect(source.strength, id).toBeGreaterThan(LIGHT_PROFILES.glow.strength);
      expect(source.strength, id).toBeLessThan(sourceOf('of-11-15').strength);
      expect(source.flicker, id).toEqual({ amplitude: 0.1, hz: 3 });
      // Le halo brille sur le panneau, dans le haut de son carreau.
      expect(source.y, id).toBeLessThan(TILE_SIZE / 2);
    }
  });

  test('chaque élément a un profil, et sa portée et sa force propres, quand il en a, restent dans les mêmes limites', () => {
    for (const [id, emitter] of Object.entries(LIGHT_EMITTERS)) {
      expect(LIGHT_PROFILES[emitter.kind], id).toBeDefined();
      if (emitter.radiusTiles !== undefined) expect(emitter.radiusTiles, id).toBeGreaterThan(0);
      if (emitter.strength !== undefined) {
        expect(emitter.strength, id).toBeGreaterThan(0);
        expect(emitter.strength, id).toBeLessThanOrEqual(1);
      }
    }
  });

  test('chaque élément est dans la banque, et sa lumière brille dans son image', () => {
    for (const [id, emitter] of Object.entries(LIGHT_EMITTERS)) {
      const item = decorItem(id);
      expect(item, id).toBeDefined();
      expect(emitter.bulbY, id).toBeGreaterThanOrEqual(0);
      expect(emitter.bulbY, id).toBeLessThan(item!.h * TILE_SIZE);
    }
  });

  test('la force suit l\'ordre feu > lampadaire > lampe de bureau > écran', () => {
    const strength = (id: string) => sourceOf(id).strength;
    expect(strength(FIREPLACE)).toBeGreaterThan(strength('lr-12-9'));
    expect(strength('lr-12-9')).toBeGreaterThan(strength('of-11-15'));
    expect(strength('of-11-15')).toBeGreaterThan(strength('of-9-14'));
  });

  test('l\'écran d\'un ordinateur, d\'un portable ou d\'un poste complet éclaire très peu : il est le plus faible de tous, de la même force que l\'écran de présentation', () => {
    for (const id of COMPUTER_SCREENS) {
      expect(LIGHT_EMITTERS[id]?.kind, id).toBe('screen');
      expect(sourceOf(id).strength, id).toBe(LIGHT_PROFILES.screen.strength);
      expect(sourceOf(id).radius, id).toBe(LIGHT_PROFILES.screen.radiusTiles * TILE_SIZE);
      // Plus faible que toute lampe, télévision ou flamme.
      for (const other of ['of-11-15', 'lr-14-7', 'lr-12-9', 'tv-10-3', FIREPLACE]) expect(sourceOf(id).strength, `${id} < ${other}`).toBeLessThan(sourceOf(other).strength);
    }
  });

  test('un écran éteint (noir ou blanc) n\'éclaire pas', () => {
    for (const id of SWITCHED_OFF_SCREENS) {
      expect(decorItem(id), id).toBeDefined();
      expect(LIGHT_EMITTERS[id], id).toBeUndefined();
    }
  });

  test('un écran et une lampe de bureau éclairent près, un lampadaire plus loin, la cheminée le plus loin', () => {
    const radius = (id: string) => sourceOf(id).radius;
    expect(radius(FIREPLACE)).toBeGreaterThan(radius('lr-12-9'));
    expect(radius('lr-12-9')).toBeGreaterThan(radius('of-11-15'));
    expect(radius('of-11-15')).toBeGreaterThan(radius('of-9-14'));
    // Une lampe de chevet est plus petite encore qu'une lampe de bureau.
    expect(radius('lr-14-7')).toBeLessThanOrEqual(radius('of-11-15'));
  });

  test('une télévision éclaire plus fort et plus loin qu\'un écran d\'ordinateur, et vacille', () => {
    for (const id of TVS) {
      expect(sourceOf(id).strength, id).toBeGreaterThan(sourceOf('of-9-14').strength);
      expect(sourceOf(id).radius, id).toBeGreaterThan(sourceOf('of-9-14').radius);
      expect(sourceOf(id).flicker, id).toEqual(LIGHT_PROFILES.tv.flicker);
    }
  });
});

describe('sourcesFromItems', () => {
  test('l\'ampoule du lampadaire lr-12-9 est en haut de son image (son abat-jour), au milieu de sa largeur, avec la portée et la force de ce lampadaire', () => {
    const [source, ...rest] = sourcesFromItems([placed('lr-12-9', 640, 320)]);
    expect(rest).toEqual([]);
    const emitter = LIGHT_EMITTERS['lr-12-9']!;
    expect(source).toEqual({
      x: 640 + TILE_SIZE / 2,
      y: 320 + emitter.bulbY,
      kind: 'lamp',
      radius: (emitter.radiusTiles ?? LIGHT_PROFILES.lamp.radiusTiles) * TILE_SIZE,
      color: LIGHT_PROFILES.lamp.color,
      strength: emitter.strength ?? LIGHT_PROFILES.lamp.strength,
    });
    // Dans la moitié haute de l'image (3 cases de haut, dont la première est vide : l'abat-jour est dans la deuxième).
    expect(source!.y).toBeGreaterThan(320 + TILE_SIZE);
    expect(source!.y).toBeLessThan(320 + (3 * TILE_SIZE) / 2);
  });

  test('un lampadaire a sa portée et sa force à lui, une lampe de bureau celles du profil des lampes', () => {
    expect(LIGHT_EMITTERS['lr-12-9']!.radiusTiles).toBeDefined();
    expect(LIGHT_EMITTERS['lr-12-9']!.strength).toBeDefined();
    expect(sourceOf('of-11-15')).toMatchObject({ radius: LIGHT_PROFILES.lamp.radiusTiles * TILE_SIZE, strength: LIGHT_PROFILES.lamp.strength });
  });

  test('la couleur et le vacillement viennent du profil de la sorte : la cheminée vacille, une lampe non', () => {
    expect(sourceOf(FIREPLACE)).toMatchObject({ kind: 'fire', color: LIGHT_PROFILES.fire.color, flicker: LIGHT_PROFILES.fire.flicker });
    expect(sourceOf('lr-12-9').flicker).toBeUndefined();
    expect(sourceOf('of-9-14')).toMatchObject({ kind: 'screen', color: LIGHT_PROFILES.screen.color });
  });

  test('un élément qui n\'éclaire pas, ou inconnu, ne donne pas de lumière', () => {
    expect(sourcesFromItems([placed('of-14-8', 0, 0), { id: 'inconnu', x: 0, y: 0, w: 32, h: 32 }])).toEqual([]);
  });

  test('une lumière par élément qui éclaire, dans l\'ordre', () => {
    const sources = sourcesFromItems([placed('lr-4-24', 0, 0), placed('of-14-8', 64, 0), placed('tv-10-3', 128, 0)]);
    expect(sources.map((s) => s.kind)).toEqual(['fire', 'tv']);
    // La cheminée brille de son feu, en bas de l'image ; l'écran géant (5 cases) au milieu de sa largeur.
    expect(sources[0]!.y).toBeGreaterThan(2 * TILE_SIZE);
    expect(sources[1]!.x).toBe(128 + (5 * TILE_SIZE) / 2);
  });
});

// Les objets animés qui éclairent : le rectangle de leur image, en pixels de la carte (propImages).
describe('sourcesFromProps : la lumière des objets animés', () => {
  const image = (key: string, x: number, y: number, w: number, h: number) => ({ key, x, y, w, h });

  test('la cheminée donne un feu, une bougie une flamme, l\'aquarium de l\'eau, une enceinte un point lumineux : la sorte que dit l\'objet', () => {
    expect(sourcesFromProps([image('chimney', 0, 0, 64, 96)])[0]).toMatchObject({ kind: 'fire', radius: LIGHT_PROFILES.fire.radiusTiles * TILE_SIZE, strength: LIGHT_PROFILES.fire.strength });
    expect(sourcesFromProps([image('candle', 0, 0, 32, 64)])[0]).toMatchObject({ kind: 'candle' });
    expect(sourcesFromProps([image('wall-candle', 0, 0, 32, 64)])[0]).toMatchObject({ kind: 'candle' });
    expect(sourcesFromProps([image('fishtank', 0, 0, 64, 64)])[0]).toMatchObject({ kind: 'water' });
    expect(sourcesFromProps([image('amplifier-big', 0, 0, 32, 96)])[0]).toMatchObject({ kind: 'glow' });
  });

  test('la lumière est au milieu de l\'image, à la hauteur de l\'ampoule : la flamme est basse dans la cheminée, haute dans la bougie', () => {
    const [fire] = sourcesFromProps([image('chimney', 100, 200, 64, 96)]);
    expect(fire!.x).toBe(100 + 32);
    expect(fire!.y).toBeGreaterThan(200 + 40);
    expect(fire!.y).toBeLessThan(200 + 96);
    const [candle] = sourcesFromProps([image('candle', 100, 200, 32, 64)]);
    expect(candle!.y).toBeLessThan(200 + 32);
  });

  test('un objet qui n\'éclaire pas (un tapis de course), ou inconnu, ne donne rien', () => {
    expect(sourcesFromProps([image('treadmill', 0, 0, 64, 96), image('nope', 0, 0, 32, 32)])).toEqual([]);
  });

  test('le feu vacille comme celui d\'un élément de la banque, l\'eau non', () => {
    expect(sourcesFromProps([image('chimney', 0, 0, 64, 96)])[0]!.flicker).toEqual(LIGHT_PROFILES.fire.flicker);
    expect(sourcesFromProps([image('fishtank', 0, 0, 64, 64)])[0]!.flicker).toBeUndefined();
  });
});
