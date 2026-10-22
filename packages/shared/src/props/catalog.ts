import { PROP_LIST } from './generated';

// Les objets animés de la carte : une planche d'images côte à côte (la porte qui s'ouvre, la vapeur du café, le feu de la cheminée). Ils sont
// rangés par `gen:assets` (apps/client/scripts/assets/animated.ts) ; la carte les place, le client les anime.

// Les genres de lumière que la nuit sait dessiner (leurs profils sont ceux du client, game/light-sources.ts).
export const LIGHT_KINDS = ['lamp', 'screen', 'fire', 'tv', 'glow', 'candle', 'water', 'exit'] as const;
export type LightKind = (typeof LIGHT_KINDS)[number];

export interface Prop {
  key: string;
  // L'adresse de la planche, telle que le client la sert.
  sheet: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
  fps: number;
  // Tourne en boucle ; sinon elle s'arrête sur l'image qu'on lui demande (une porte : fermée, ouverte).
  loop: boolean;
  // La taille d'une image en cases, `claim` : les rangées du bas qu'il occupe au sol, `solid` : s'il arrête l'avatar.
  w: number;
  h: number;
  claim: number;
  solid: boolean;
  // Éclaire la nuit.
  light?: LightKind;
}

export const PROPS: readonly Prop[] = PROP_LIST;

const BY_KEY: ReadonlyMap<string, Prop> = new Map(PROPS.map((prop) => [prop.key, prop]));

// Le prop de cette clé, ou undefined si la liste n'en a pas.
export function propByKey(key: string): Prop | undefined {
  return BY_KEY.get(key);
}
