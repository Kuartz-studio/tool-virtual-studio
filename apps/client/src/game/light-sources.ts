import { TILE_SIZE } from '@bureau/shared';

// Les lumières de la nuit : les éléments posés qui éclairent quand la lumière du bureau est éteinte (lampes, cheminée, écrans), ceux de la carte
// comme ceux des bureaux. La couche de nuit (LightingLayer) troue l'obscurité autour de chacun et y ajoute un halo de sa couleur.

export type LightKind = 'lamp' | 'screen' | 'fire';

export interface LightEmitter {
  kind: LightKind;
  // Jusqu'où porte la lumière, en cases.
  radiusTiles: number;
  // La couleur de son halo : chaude pour une lampe ou un feu, froide pour un écran.
  color: number;
  // Où elle brille dans l'image de l'élément, en pixels depuis le haut de l'image (toujours au milieu de sa largeur) : l'abat-jour d'une
  // lampe, le feu d'une cheminée, le milieu d'un écran. Le haut de l'image est souvent vide : un lampadaire de 3 cases a son abat-jour dans la
  // deuxième.
  bulbY: number;
}

// Une lumière posée dans la carte, en pixels de la carte : son centre, sa portée.
export interface LightSource {
  x: number;
  y: number;
  kind: LightKind;
  radius: number;
  color: number;
}

// Les couleurs : la lampe (l'ambre de la nuit de l'interface), le feu, plus orangé, et l'écran, bleu froid.
const WARM = 0xffc56b;
const FIRE = 0xff9a4a;
const COLD = 0x8cbeff;

const floorLamp = (bulbY: number): LightEmitter => ({ kind: 'lamp', radiusTiles: 4, color: WARM, bulbY });
const DESK_LAMP: LightEmitter = { kind: 'lamp', radiusTiles: 2.5, color: WARM, bulbY: 10 };
const BEDSIDE_LAMP: LightEmitter = { kind: 'lamp', radiusTiles: 2.25, color: WARM, bulbY: 32 };
const screen = (radiusTiles: number, bulbY: number): LightEmitter => ({ kind: 'screen', radiusTiles, color: COLD, bulbY });

// Les éléments de la banque qui éclairent, par clé.
export const LIGHT_EMITTERS: Readonly<Record<string, LightEmitter>> = {
  // Les lampadaires : l'abat-jour en haut du pied (dans la 2e case des grands, la 1re du petit).
  'lr-12-9': floorLamp(44),
  'lr-11-9': floorLamp(30),
  'lr-13-9': floorLamp(44),
  'lr-12-12': floorLamp(44),
  'lr-13-12': floorLamp(44),
  // Les lampes articulées : la tête, en haut de l'image. Chaque bureau par défaut en a une (of-11-15).
  'of-11-15': DESK_LAMP,
  'of-10-16': DESK_LAMP,
  'of-11-17': DESK_LAMP,
  'of-11-19': DESK_LAMP,
  'of-11-21': DESK_LAMP,
  'of-11-23': DESK_LAMP,
  // Les lampes de chevet : sous l'abat-jour.
  'lr-14-7': BEDSIDE_LAMP,
  'lr-15-7': BEDSIDE_LAMP,
  'lr-14-9': BEDSIDE_LAMP,
  'lr-15-9': BEDSIDE_LAMP,
  'lr-14-13': BEDSIDE_LAMP,
  'lr-15-13': BEDSIDE_LAMP,
  // Les postes portables avec leur lampe.
  'of-8-26': DESK_LAMP,
  'of-14-26': DESK_LAMP,
  // La cheminée : le feu, en bas de l'image.
  'lr-4-24': { kind: 'fire', radiusTiles: 4.5, color: FIRE, bulbY: 76 },
  // Les écrans au mur : une petite lumière froide, au milieu de l'écran.
  'tv-10-3': screen(2.5, 22),
  'of-9-14': screen(2, 36),
  'tv-10-1': screen(2, 22),
};

// Les lumières de ces éléments (le rectangle de leur image, en pixels de la carte : DecorLayer.placedImages). Un élément qui n'éclaire pas, ou
// inconnu, n'en donne pas.
export function sourcesFromItems(items: readonly { id: string; x: number; y: number; w: number; h: number }[]): LightSource[] {
  return items.flatMap(({ id, x, y, w }) => {
    const emitter = LIGHT_EMITTERS[id];
    return emitter ? [{ x: x + w / 2, y: y + emitter.bulbY, kind: emitter.kind, radius: emitter.radiusTiles * TILE_SIZE, color: emitter.color }] : [];
  });
}
