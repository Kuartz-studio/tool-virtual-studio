import { CHARACTER_PARTS } from './character/generated';

// La clé d'avatar d'une personne : un texte que le serveur garde et diffuse tel quel, et que le client transforme en images.
// - `p.07` : un personnage prêt à l'emploi (le 7e des 20 du pack) ;
// - `c.3.2.5-1.12-4.0.6-2` : un personnage assemblé, dans l'ordre corps, yeux, tenue, coiffure, accessoire. La tenue est `famille-variante` ;
//   la coiffure et l'accessoire aussi, ou `0` s'il n'y en a pas.
export type AvatarKey = string;

export interface PartChoice {
  style: number;
  color: number;
}

// Un personnage assemblé : un corps (la couleur de peau), des yeux, une tenue, et en option une coiffure et un accessoire.
export interface CharacterBuild {
  body: number;
  eyes: number;
  outfit: PartChoice;
  hair: PartChoice | null;
  accessory: PartChoice | null;
}

export type ParsedAvatar = { kind: 'premade'; number: number } | { kind: 'built'; build: CharacterBuild };

const optional = (choice: PartChoice | null): string => (choice === null ? '0' : `${choice.style}-${choice.color}`);

export function formatCharacter(build: CharacterBuild): string {
  return `c.${build.body}.${build.eyes}.${build.outfit.style}-${build.outfit.color}.${optional(build.hair)}.${optional(build.accessory)}`;
}

export function formatPremade(number: number): string {
  return `p.${String(number).padStart(2, '0')}`;
}

function variantsOf(families: ReadonlyArray<{ number: number; variants: number }>, style: number): number {
  return families.find((family) => family.number === style)?.variants ?? 0;
}

function parseChoice(text: string, families: ReadonlyArray<{ number: number; variants: number }>, required: boolean): PartChoice | null | undefined {
  if (text === '0') return required ? undefined : null;
  const match = /^(\d{1,2})-(\d{1,2})$/.exec(text);
  if (!match) return undefined;
  const [style, color] = [Number(match[1]), Number(match[2])];
  return color >= 1 && color <= variantsOf(families, style) ? { style, color } : undefined;
}

// Ce que dit une clé d'avatar, ou null si ce n'est pas une clé que ce build connaît (une ancienne clé, une pièce qui n'existe pas).
export function parseAvatarKey(key: string): ParsedAvatar | null {
  const premade = /^p\.(\d{2})$/.exec(key);
  if (premade) {
    const number = Number(premade[1]);
    return number >= 1 && number <= CHARACTER_PARTS.premade ? { kind: 'premade', number } : null;
  }
  const built = /^c\.(\d{1,2})\.(\d{1,2})\.(\d{1,2}-\d{1,2})\.(0|\d{1,2}-\d{1,2})\.(0|\d{1,2}-\d{1,2})$/.exec(key);
  if (!built) return null;
  const [body, eyes] = [Number(built[1]), Number(built[2])];
  if (body < 1 || body > CHARACTER_PARTS.bodies || eyes < 1 || eyes > CHARACTER_PARTS.eyes) return null;
  const outfit = parseChoice(built[3]!, CHARACTER_PARTS.outfits, true);
  const hair = parseChoice(built[4]!, CHARACTER_PARTS.hair, false);
  const accessory = parseChoice(built[5]!, CHARACTER_PARTS.accessories, false);
  if (!outfit || hair === undefined || accessory === undefined) return null;
  return { kind: 'built', build: { body, eyes, outfit, hair, accessory } };
}

export function isAvatarKey(key: string): boolean {
  return parseAvatarKey(key) !== null;
}

export const DEFAULT_AVATAR_KEY: AvatarKey = 'p.01';

// L'avatar de quelqu'un qui n'en a pas choisi : un des personnages prêts à l'emploi, toujours le même pour une même personne, pour que le
// bureau ne soit pas peuplé de clones.
export function defaultAvatarKey(userId: string): AvatarKey {
  let hash = 0;
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return formatPremade((hash % Math.max(CHARACTER_PARTS.premade, 1)) + 1);
}

// Un personnage tiré au hasard (le bouton « Au hasard » du builder). `random` rend un nombre de [0, 1[.
export function randomCharacter(random: () => number = Math.random): CharacterBuild {
  const int = (n: number) => 1 + Math.floor(random() * n);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
  const choice = (families: ReadonlyArray<{ number: number; variants: number }>): PartChoice => {
    const family = pick(families);
    return { style: family.number, color: int(family.variants) };
  };
  return {
    body: int(CHARACTER_PARTS.bodies),
    eyes: int(CHARACTER_PARTS.eyes),
    outfit: choice(CHARACTER_PARTS.outfits),
    hair: random() < 0.9 ? choice(CHARACTER_PARTS.hair) : null,
    accessory: random() < 0.2 ? choice(CHARACTER_PARTS.accessories) : null,
  };
}
