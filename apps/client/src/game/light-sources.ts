import { TILE_SIZE, propByKey, type LightKind } from '@bureau/shared';

// Les lumières de la nuit : les éléments posés qui éclairent quand la lumière du bureau est éteinte (lampes, cheminée, écrans, télévisions), ceux
// de la carte comme ceux des bureaux. La couche de nuit (LightingLayer) troue l'obscurité autour de chacun, et y ajoute une teinte et un halo de sa
// couleur. Toutes ne se valent pas : un écran n'éclaire presque rien, un lampadaire un peu plus, une cheminée toute la pièce.

// Les genres de lumière sont ceux du partage (les objets animés de la carte disent lequel ils portent).
export type { LightKind };

// Le vacillement d'une lumière : sa portée bouge de ± `amplitude` (une part de la portée), au rythme de `hz` battements par seconde.
export interface LightFlicker {
  amplitude: number;
  hz: number;
}

// Ce que donne une sorte de lumière, quand l'élément n'a rien de plus précis.
export interface LightProfile {
  // Jusqu'où porte la lumière, en cases.
  radiusTiles: number;
  // De 0 à 1 : la part d'obscurité qu'elle efface en son centre (l'opacité du trou, qui tombe ensuite par paliers jusqu'au bord). Sa teinte et
  // son halo la suivent : à 0,2, la lumière est faible, la teinte et le halo aussi.
  strength: number;
  // La couleur de son halo : chaude pour une lampe ou un feu, froide pour un écran ou l'eau.
  color: number;
  flicker?: LightFlicker;
}

export interface LightEmitter {
  kind: LightKind;
  // La portée et la force propres à cet élément, quand elles ne sont pas celles du profil de sa sorte : un lampadaire porte plus loin qu'une lampe de
  // bureau, qui est le profil des lampes.
  radiusTiles?: number;
  strength?: number;
  // Où elle brille dans l'image de l'élément, en pixels depuis le haut de l'image (toujours au milieu de sa largeur) : l'abat-jour d'une
  // lampe, le feu d'une cheminée, le milieu d'un écran. Le haut de l'image est souvent vide : un lampadaire de 3 cases a son abat-jour dans la
  // deuxième.
  bulbY: number;
}

// Une lumière posée dans la carte, en pixels de la carte : son centre, sa portée, sa force, et son vacillement s'il en a un.
export interface LightSource {
  x: number;
  y: number;
  kind: LightKind;
  radius: number;
  color: number;
  strength: number;
  flicker?: LightFlicker;
}

// Les couleurs : la lampe (l'ambre de la nuit de l'interface), la bougie et le feu, plus orangés, l'écran et la télévision, bleu froid, l'eau,
// aqua, le point d'une LED, d'un blanc froid, et le panneau de sortie, d'un vert de signalisation.
const WARM = 0xffc56b;
const CANDLE = 0xffb061;
const FIRE = 0xff9a4a;
const COLD = 0x8cbeff;
const AQUA = 0x6fd8e8;
const LED = 0xbfeeff;
const EXIT = 0x5cf29a;

// Un profil par sorte, d'après les chiffres de départ du plan (docs/superpowers/plans), réglés à l'œil sur une capture de nuit.
export const LIGHT_PROFILES: Readonly<Record<LightKind, LightProfile>> = {
  // Un écran d'ordinateur ou un portable : très faible et très petit, froid.
  screen: { radiusTiles: 1.5, strength: 0.22, color: COLD },
  // Une lampe de bureau, articulée : faible et petite (le lampadaire et la lampe de chevet ont la leur plus bas).
  lamp: { radiusTiles: 2, strength: 0.55, color: WARM },
  // Une télévision murale : froide, qui vacille à 6 Hz.
  tv: { radiusTiles: 3, strength: 0.35, color: COLD, flicker: { amplitude: 0.06, hz: 6 } },
  // Une bougie : une flamme minuscule qui vacille.
  candle: { radiusTiles: 1.5, strength: 0.4, color: CANDLE, flicker: { amplitude: 0.08, hz: 9 } },
  // Une cheminée : forte et large, qui vacille de ±5 %.
  fire: { radiusTiles: 6, strength: 0.95, color: FIRE, flicker: { amplitude: 0.05, hz: 8 } },
  // La LED d'une enceinte ou d'une machine à café : à peine un point.
  glow: { radiusTiles: 0.9, strength: 0.15, color: LED },
  // Une piscine : aqua, sans vacillement.
  water: { radiusTiles: 5, strength: 0.35, color: AQUA },
  // Un panneau de sortie : un halo vert, petit, qui scintille doucement (3 Hz).
  exit: { radiusTiles: 2.5, strength: 0.3, color: EXIT, flicker: { amplitude: 0.1, hz: 3 } },
};

const floorLamp = (bulbY: number): LightEmitter => ({ kind: 'lamp', radiusTiles: 4, strength: 0.8, bulbY });
const DESK_LAMP: LightEmitter = { kind: 'lamp', bulbY: 10 };
const BEDSIDE_LAMP: LightEmitter = { kind: 'lamp', radiusTiles: 1.75, strength: 0.5, bulbY: 32 };
const screenAt = (bulbY: number): LightEmitter => ({ kind: 'screen', bulbY });
// Un panneau de sortie : un seul carreau, le panneau dans sa moitié haute.
const EXIT_SIGN: LightEmitter = { kind: 'exit', bulbY: 6 };

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
  'lr-4-24': { kind: 'fire', bulbY: 76 },
  // Les télévisions au mur : une lumière froide qui vacille, au milieu de l'écran.
  'tv-10-3': { kind: 'tv', bulbY: 22 },
  'tv-10-1': { kind: 'tv', bulbY: 22 },
  // L'écran de présentation, au mur : une lumière froide, très faible.
  'of-9-14': screenAt(36),
  // Les panneaux de sortie (vert vif et citron, vers la droite et vers la gauche).
  'mu-14-111': EXIT_SIGN,
  'mu-14-111-m': EXIT_SIGN,
  'mu-15-111': EXIT_SIGN,
  'mu-15-111-m': EXIT_SIGN,
  // Les écrans d'ordinateur allumés, au milieu de l'écran de leur image (les écrans noirs et blancs de la banque sont éteints, ils n'éclairent
  // pas) : les écrans bleus, ceux sur pied et les moniteurs compacts, les doubles écrans (celui du haut est allumé), les portables et les
  // postes complets.
  'of-13-12': screenAt(11),
  'of-14-12': screenAt(11),
  'of-15-12': screenAt(11),
  'of-13-13': screenAt(11),
  'of-14-13': screenAt(11),
  'of-15-13': screenAt(11),
  'of-12-35': screenAt(11),
  'of-12-36': screenAt(11),
  'of-8-44': screenAt(11),
  'of-9-44': screenAt(11),
  'of-10-35': screenAt(15),
  'of-11-35': screenAt(15),
  'of-10-44': screenAt(15),
  'of-11-44': screenAt(15),
  'of-13-15': screenAt(24),
  'of-14-15': screenAt(24),
  'of-15-15': screenAt(24),
  'of-13-17': screenAt(24),
  'of-14-17': screenAt(24),
  'of-15-17': screenAt(24),
  'of-10-30': screenAt(24),
  'of-10-32': screenAt(24),
};

// Où est l'ampoule d'un objet animé, en pixels depuis le haut de son image : la flamme est basse dans la cheminée, haute dans une bougie. Au milieu
// de l'image sans entrée ici.
const PROP_BULB_Y: Readonly<Record<string, number>> = {
  chimney: 62,
  'chimney-red': 62,
  'chimney-white': 62,
  'chimney-yellow': 62,
  candle: 14,
  'wall-candle': 14,
  amplifier: 40,
  'amplifier-big': 56,
  fishtank: 28,
};

// Les lumières des objets animés (le rectangle de leur image, en pixels de la carte : PropLayer.images) : la sorte de lumière est celle que porte
// l'objet (props/catalog.ts), son profil celui de LIGHT_PROFILES. Un objet qui n'éclaire pas, ou inconnu, n'en donne pas.
export function sourcesFromProps(images: readonly { key: string; x: number; y: number; w: number; h: number }[]): LightSource[] {
  return images.flatMap(({ key, x, y, w, h }) => {
    const kind = propByKey(key)?.light;
    if (!kind) return [];
    const profile = LIGHT_PROFILES[kind];
    return [
      {
        x: x + w / 2,
        y: y + (PROP_BULB_Y[key] ?? h / 2),
        kind,
        radius: profile.radiusTiles * TILE_SIZE,
        color: profile.color,
        strength: profile.strength,
        ...(profile.flicker && { flicker: profile.flicker }),
      },
    ];
  });
}

// Les lumières de ces éléments (le rectangle de leur image, en pixels de la carte : DecorLayer.placedImages). Un élément qui n'éclaire pas, ou
// inconnu, n'en donne pas.
export function sourcesFromItems(items: readonly { id: string; x: number; y: number; w: number; h: number }[]): LightSource[] {
  return items.flatMap(({ id, x, y, w }) => {
    const emitter = LIGHT_EMITTERS[id];
    if (!emitter) return [];
    const profile = LIGHT_PROFILES[emitter.kind];
    return [
      {
        x: x + w / 2,
        y: y + emitter.bulbY,
        kind: emitter.kind,
        radius: (emitter.radiusTiles ?? profile.radiusTiles) * TILE_SIZE,
        color: profile.color,
        strength: emitter.strength ?? profile.strength,
        ...(profile.flicker && { flicker: profile.flicker }),
      },
    ];
  });
}
