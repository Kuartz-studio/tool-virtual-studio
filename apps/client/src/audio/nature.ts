import { isOutside, type LightLevel, type OfficeMap } from '@bureau/shared';

// Les bruits de la nature autour de soi : l'eau, de plus en plus fort à mesure qu'on s'en approche, et dehors (le jardin, les terrasses) les oiseaux le
// jour, un coup de vent de temps en temps, les insectes la nuit. Ici, ce qu'on doit entendre là où l'on est (natureAt) et quand partent les phrases des
// oiseaux et les coups de vent (NatureSchedule) : du calcul pur, sans le son. Le lecteur (nature-player.ts) en fait du son, sur le circuit des effets du
// moteur (engine.ts) : leur volume, leur coupure. AudioDirector suit les pieds de la personne et la lumière du bureau.

// ---- La forme des fichiers (que leur fabrication, scripts/audio/build-audio.ts, partage avec le lecteur) ---------------------------------------

// Une boucle (l'eau, les insectes) est rangée avec cette marge (s) de chaque côté : la fin de sa période devant, son début derrière. Le lecteur boucle sur
// la période seule : ce que les encodeurs abîment aux bords d'un fichier (l'amorce de l'AAC, que Safari ne retire pas toujours) tombe dans les marges.
export const NATURE_LOOP_MARGIN_S = 0.25;
// Le chant des oiseaux est une banque de phrases, une par case de cette durée (s) : le lecteur en tire une au hasard.
export const BIRD_PHRASE_S = 3;

// ---- Les réglages : où l'on règle les niveaux et les courbes ------------------------------------------------------------------------

// Les niveaux de chaque bruit (des rapports d'amplitude), chacun déjà ramené au volume des ambiances (measured.generated.ts), puis passé par le volume
// des effets. La nature reste sous la musique et sous les effets, elle ne leur fait pas concurrence. Aux réglages par défaut : l'eau, au bord du bassin,
// à 13 dB environ sous la musique (un clapotis doux et étouffé, discret, audible dehors où la musique se tait) ; les insectes (à gauche et à droite), 8 dB
// sous elle ; une phrase d'oiseau, de 8 à 15 dB sous elle, selon sa distance ; un coup de vent, discret, de 14 à 21 dB sous elle ; la moto, une quinzaine de
// dB sous elle au plus près. Tous restent à -12 dB ou moins : rien ne sature.
export const NATURE_LEVELS = { water: 0.14, birds: 0.22, insects: 0.15, wind: 0.1, moto: 0.16 } as const;

// L'eau : pleine à WATER_FULL_TILES cases ou moins, plus rien à WATER_SILENT_TILES cases ; entre les deux, un carré : elle naît sans à-coup au loin, et
// monte de plus en plus vite à mesure qu'on approche.
export const WATER_FULL_TILES = 1.5;
export const WATER_SILENT_TILES = 9;
// De l'intérieur du bâtiment, on l'entend à travers le mur : à ce niveau, et passée sous ce passe-bas (Hz).
export const WATER_THROUGH_WALL = 0.3;
export const WATER_WALL_HZ = 800;
// Sa place dans la stéréo : du côté où elle est, au plus WATER_PAN_MAX, atteint à WATER_PAN_TILES cases ; tout près, elle est tout autour.
export const WATER_PAN_MAX = 0.7;
const WATER_PAN_TILES = 3;

// Ce que la lumière fait au dehors : allumée, le jour (les oiseaux) ; tamisée, le soir (deux fois moins d'oiseaux, et déjà un peu d'insectes) ; éteinte, la
// nuit (les insectes, plus d'oiseaux). `birds` est une densité (combien de phrases), `insects` un niveau. Le vent souffle à toute heure.
export const DAYLIGHT: Record<LightLevel, { birds: number; insects: number }> = {
  on: { birds: 1, insects: 0 },
  dim: { birds: 0.5, insects: 0.4 },
  off: { birds: 0, insects: 1 },
};

// Passer la porte (dedans, dehors) : les bruits du dehors arrivent ou s'en vont en fondu sur ce temps (s), comme l'eau qui passe derrière le mur. La
// lumière qui change aussi. Quand on longe l'eau, son niveau la suit de plus près (une constante de temps, s).
export const NATURE_CROSSFADE_S = 1.5;
export const WATER_FOLLOW_S = 0.15;

// Les oiseaux : d'un début de phrase au suivant, entre ces deux temps (s), au hasard, divisés par la densité (le soir, deux fois plus d'écart) ; la
// première peu après qu'on est sorti. Chaque phrase est un peu plus grave ou plus aiguë, plus ou moins vive (la vitesse de lecture), d'un côté ou de
// l'autre, plus ou moins loin (son niveau).
export const BIRD_GAP_S = { min: 1.8, max: 7 } as const;
export const BIRD_FIRST_S = { min: 0.4, max: 2.5 } as const;
export const BIRD_RATE = { min: 0.94, max: 1.06 } as const;
export const BIRD_PAN = 0.75;
export const BIRD_LEVEL = { min: 0.45, max: 1 } as const;

// Le vent : un coup de temps en temps, entre ces deux temps (s) l'un après l'autre ; le premier plus tôt, qu'on l'entende en sortant. Un coup : sa durée,
// sa montée et sa retombée (s), sa vitesse de lecture (un vent plus grave ou plus aigu), son niveau, d'où il vient et où il va dans la stéréo, et jusqu'où
// il s'éclaircit (le passe-bas qui s'ouvre avec lui, Hz, depuis WIND_DULL_HZ).
export const WIND_GAP_S = { min: 25, max: 70 } as const;
export const WIND_FIRST_S = { min: 6, max: 30 } as const;
export const GUST_SECONDS = { min: 4.5, max: 7.5 } as const;
export const GUST_ATTACK_S = { min: 1.4, max: 2.4 } as const;
export const GUST_RELEASE_S = { min: 1.8, max: 3 } as const;
export const GUST_RATE = { min: 0.85, max: 1.1 } as const;
export const GUST_LEVEL = { min: 0.6, max: 1 } as const;
export const GUST_PAN = 0.6;
export const GUST_BRIGHT_HZ = { min: 1000, max: 2000 } as const;
export const WIND_DULL_HZ = 450;

// La moto : un passage sur la route, derrière la haie, de loin en loin (« toutes les trois minutes ») : entre ces deux temps (s) l'un après l'autre, le
// premier peu après l'arrivée. L'enregistrement a déjà son effet Doppler (la note du moteur qui chute quand elle passe) ; le lecteur la fait traverser la
// stéréo d'un côté à l'autre (le côté au hasard), plus ou moins vite (sa vitesse de lecture), plus ou moins près (son niveau). On ne l'entend que dehors,
// comme les oiseaux et le vent.
export const MOTO_GAP_S = { min: 150, max: 210 } as const;
export const MOTO_FIRST_S = { min: 20, max: 60 } as const;
export const MOTO_RATE = { min: 0.95, max: 1.05 } as const;
export const MOTO_LEVEL = { min: 0.7, max: 1 } as const;
export const MOTO_PAN = 0.8;

// ---- Ce qu'on entend où l'on est --------------------------------------------------------------------------------------------------

// Ce que la nature doit faire entendre. `outside` : est-on dehors ? L'eau : son niveau à l'air libre (`open`, dehors) et à travers le mur (`wall`, dedans,
// étouffée), l'un ou l'autre, et sa place dans la stéréo (-1 à gauche, 1 à droite). Les oiseaux : leur densité (0 : aucun) ; les insectes : leur niveau ;
// le vent : 1 s'il peut souffler ; la moto : 1 si elle peut passer.
export interface NatureMix {
  outside: boolean;
  water: { open: number; wall: number; pan: number };
  birds: number;
  insects: number;
  wind: number;
  moto: number;
}

export const SILENT_NATURE: NatureMix = { outside: false, water: { open: 0, wall: 0, pan: 0 }, birds: 0, insects: 0, wind: 0, moto: 0 };

export const isSilent = (mix: NatureMix): boolean => mix.water.open + mix.water.wall + mix.birds + mix.insects + mix.wind + mix.moto === 0;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

// Le niveau de l'eau (de 0 à 1) à cette distance d'elle, en pixels.
export function waterLevel(distance: number, tileSize: number): number {
  const t = clamp01((distance / tileSize - WATER_FULL_TILES) / (WATER_SILENT_TILES - WATER_FULL_TILES));
  return (1 - t) ** 2;
}

// La place de l'eau dans la stéréo : `dx` est l'écart horizontal jusqu'à elle (positif : elle est à droite), `distance` la distance, en pixels.
export function waterPan(dx: number, distance: number, tileSize: number): number {
  if (distance <= 0) return 0;
  return WATER_PAN_MAX * (dx / distance) * Math.min(1, distance / (WATER_PAN_TILES * tileSize));
}

// L'eau la plus proche de ce point (en pixels) : sa distance (0 dedans, comme distanceToWater) et l'écart horizontal jusqu'à son point le plus proche ;
// null si la carte n'a pas d'eau.
export function waterNear(map: OfficeMap, x: number, y: number): { distance: number; dx: number } | null {
  let best: { distance: number; dx: number } | null = null;
  for (const rect of map.waters ?? []) {
    const nx = Math.min(Math.max(x, rect.x), rect.x + rect.width);
    const ny = Math.min(Math.max(y, rect.y), rect.y + rect.height);
    const distance = Math.hypot(nx - x, ny - y);
    if (best === null || distance < best.distance) best = { distance, dx: nx - x };
  }
  return best;
}

// Ce qu'on entend, dedans ou dehors, à cette lumière, à cette distance de l'eau (null : pas d'eau). Dedans, rien du dehors, et l'eau à travers le mur.
export function natureMix(where: { outside: boolean; lights: LightLevel; water: { distance: number; dx: number } | null }, tileSize: number): NatureMix {
  const level = where.water === null ? 0 : waterLevel(where.water.distance, tileSize);
  const pan = where.water === null ? 0 : waterPan(where.water.dx, where.water.distance, tileSize);
  const out = where.outside ? 1 : 0;
  const day = DAYLIGHT[where.lights];
  return {
    outside: where.outside,
    water: { open: level * out, wall: level * (1 - out) * WATER_THROUGH_WALL, pan },
    birds: day.birds * out,
    insects: day.insects * out,
    wind: out,
    moto: out,
  };
}

// Ce qu'on entend à cet endroit de la carte (les pieds, en pixels), à cette lumière.
export function natureAt(map: OfficeMap, x: number, y: number, lights: LightLevel): NatureMix {
  return natureMix({ outside: isOutside(map, x, y), lights, water: waterNear(map, x, y) }, map.tileSize);
}

// ---- Quand partent les oiseaux et le vent -----------------------------------------------------------------------------------------

// Une phrase d'oiseau : laquelle (sa case dans la banque), sa vitesse de lecture, sa place dans la stéréo, son niveau (de 0 à 1).
export interface BirdPhrase {
  kind: 'phrase';
  phrase: number;
  rate: number;
  pan: number;
  level: number;
}

// Un coup de vent : où il commence dans le fichier (s), sa durée (s, à l'oreille), sa montée et sa retombée (s), sa vitesse de lecture, son niveau, sa
// course dans la stéréo et jusqu'où il s'éclaircit (Hz).
export interface Gust {
  kind: 'gust';
  offset: number;
  seconds: number;
  attack: number;
  release: number;
  rate: number;
  level: number;
  panFrom: number;
  panTo: number;
  brightHz: number;
}

// Un passage de la moto : sa vitesse de lecture, son niveau (de 0 à 1), sa course dans la stéréo.
export interface MotoPass {
  kind: 'moto';
  rate: number;
  level: number;
  panFrom: number;
  panTo: number;
}

export type NatureEvent = BirdPhrase | Gust | MotoPass;

const pick = (random: () => number, range: { min: number; max: number }): number => range.min + (range.max - range.min) * random();
const clampPan = (pan: number): number => Math.min(0.85, Math.max(-0.85, pan));

// Le calendrier des oiseaux, du vent et de la moto. Le lecteur l'interroge régulièrement (due) avec l'heure et ce qu'on doit entendre : il dit ce qui part
// maintenant.
// Le hasard et l'heure viennent de dehors (les tests les choisissent). Rien ne s'accumule : un onglet qui a dormi longtemps rejoue une phrase, pas
// toutes celles qu'il a manquées ; un bruit qui se tait (rentrer, la nuit) oublie son prochain départ, et repart du début quand il revient.
export class NatureSchedule {
  private nextPhraseAt: number | null = null;
  private nextGustAt: number | null = null;
  private nextMotoAt: number | null = null;
  private lastPhrase = -1;

  // `phrases` : combien la banque des oiseaux en a ; `windSeconds` : la durée du fichier du vent.
  constructor(
    private readonly random: () => number,
    private readonly phrases: number,
    private readonly windSeconds: number,
  ) {}

  due(nowMs: number, mix: Pick<NatureMix, 'birds' | 'wind' | 'moto'>): NatureEvent[] {
    const events: NatureEvent[] = [];
    if (mix.birds <= 0 || this.phrases <= 0) this.nextPhraseAt = null;
    else if (this.nextPhraseAt === null) this.nextPhraseAt = nowMs + pick(this.random, BIRD_FIRST_S) * 1000;
    else if (nowMs >= this.nextPhraseAt) {
      events.push(this.phrase());
      this.nextPhraseAt = nowMs + (pick(this.random, BIRD_GAP_S) * 1000) / mix.birds;
    }
    if (mix.wind <= 0) this.nextGustAt = null;
    else if (this.nextGustAt === null) this.nextGustAt = nowMs + pick(this.random, WIND_FIRST_S) * 1000;
    else if (nowMs >= this.nextGustAt) {
      events.push(this.gust());
      this.nextGustAt = nowMs + pick(this.random, WIND_GAP_S) * 1000;
    }
    if (mix.moto <= 0) this.nextMotoAt = null;
    else if (this.nextMotoAt === null) this.nextMotoAt = nowMs + pick(this.random, MOTO_FIRST_S) * 1000;
    else if (nowMs >= this.nextMotoAt) {
      const panFrom = (this.random() < 0.5 ? -1 : 1) * MOTO_PAN;
      events.push({ kind: 'moto', rate: pick(this.random, MOTO_RATE), level: pick(this.random, MOTO_LEVEL), panFrom, panTo: -panFrom });
      this.nextMotoAt = nowMs + pick(this.random, MOTO_GAP_S) * 1000;
    }
    return events;
  }

  // Une phrase au hasard, jamais deux fois la même de suite.
  private phrase(): BirdPhrase {
    const after = this.lastPhrase >= 0 && this.phrases > 1;
    let phrase = Math.floor(this.random() * (after ? this.phrases - 1 : this.phrases));
    if (after && phrase >= this.lastPhrase) phrase++;
    this.lastPhrase = phrase;
    return { kind: 'phrase', phrase, rate: pick(this.random, BIRD_RATE), pan: (this.random() * 2 - 1) * BIRD_PAN, level: pick(this.random, BIRD_LEVEL) };
  }

  // Un coup de vent qui tient dans le fichier : plus il est lu vite, plus il en prend.
  private gust(): Gust {
    const rate = pick(this.random, GUST_RATE);
    const seconds = Math.min(pick(this.random, GUST_SECONDS), (this.windSeconds - 0.1) / rate);
    const attack = Math.min(pick(this.random, GUST_ATTACK_S), seconds * 0.45);
    const release = Math.min(pick(this.random, GUST_RELEASE_S), seconds * 0.5);
    const panFrom = (this.random() * 2 - 1) * GUST_PAN;
    return {
      kind: 'gust',
      offset: this.random() * Math.max(0, this.windSeconds - seconds * rate),
      seconds,
      attack,
      release,
      rate,
      level: pick(this.random, GUST_LEVEL),
      panFrom,
      panTo: clampPan(panFrom + (this.random() * 2 - 1) * 0.5),
      brightHz: pick(this.random, GUST_BRIGHT_HZ),
    };
  }
}

// La forme d'un coup de vent, en `points` valeurs de 0 à 1 sur sa durée : il monte en douceur, tient, et retombe.
export function gustShape(gust: Pick<Gust, 'seconds' | 'attack' | 'release'>, points = 128): Float32Array {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const t = (i / (points - 1)) * gust.seconds;
    const rise = t < gust.attack ? 0.5 - 0.5 * Math.cos((Math.PI * t) / gust.attack) : 1;
    const left = gust.seconds - t;
    const fall = left < gust.release ? 0.5 - 0.5 * Math.cos((Math.PI * left) / gust.release) : 1;
    curve[i] = rise * fall;
  }
  return curve;
}
