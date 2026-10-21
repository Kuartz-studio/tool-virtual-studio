// Le builder de personnage : les pièces du Character Generator de LimeZu, rognées à ce que le jeu anime (l'immobile et la marche) et rangées
// par famille dans public/assets/characters/. Une pièce est une planche de 24 images de 32 × 64 px par ligne (6 images pour chacune des
// directions, dans l'ordre droite, haut, gauche, bas) : l'immobile sur la première ligne, la marche sur la seconde. Les variantes (couleurs)
// d'une famille sont empilées dans un même fichier, 128 px de haut chacune : le client n'en charge que les familles qu'il affiche.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CharacterFamily, CharacterParts } from '@bureau/shared';
import { Img, readImage } from './image';

const CHARACTER_DIR = 'moderninteriors-win/2_Characters/Character_Generator';

// La zone d'une planche source qui nous intéresse : les lignes 1 et 2 (immobile, marche), 24 images de large.
const SOURCE_CROP = { x: 0, y: 64, w: 24 * 32, h: 128 };
const VARIANT_HEIGHT = SOURCE_CROP.h;

const ACCESSORY_LABELS: Record<string, string> = {
  Ladybug: 'Coccinelle',
  Bee: 'Abeille',
  Backpack: 'Sac à dos',
  Snapback: 'Casquette',
  Dino_Snapback: 'Casquette dino',
  Policeman_Hat: 'Casquette de policier',
  Bataclava: 'Cagoule',
  Detective_Hat: 'Chapeau de détective',
  Zombie_Brain: 'Cerveau de zombie',
  Bolt: 'Éclair',
  Beanie: 'Bonnet',
  Mustache: 'Moustache',
  Beard: 'Barbe',
  Gloves: 'Gants',
  Glasses: 'Lunettes',
  Monocle: 'Monocle',
  Medical_Mask: 'Masque',
  Chef: 'Toque',
  Party_Cone: 'Chapeau de fête',
};

// Les imagettes du builder : un personnage de face, immobile (la première image de la direction du bas), par pièce. Chaque pièce est vue sur un
// personnage de base (corps 1, yeux 1, première tenue pour les coiffures et les accessoires) pour qu'on la juge en situation.
const THUMB_COLUMNS = 20;
const DOWN_FRAME = 18;   // la première image de la direction du bas (droite, haut, gauche, bas) sur la ligne de l'immobile

function frameOf(sheet: Img, row: number): Img {
  return sheet.crop(DOWN_FRAME * 32, row * 64, 32, 64);
}

export interface CharacterBuild {
  files: Array<{ path: string; image: Img }>;
  parts: CharacterParts;
}

const pad = (n: number): string => String(n).padStart(2, '0');

function cropSheet(path: string): Img {
  return readImage(path).crop(SOURCE_CROP.x, SOURCE_CROP.y, SOURCE_CROP.w, SOURCE_CROP.h);
}

// Empile des planches l'une sous l'autre.
function stack(images: Img[]): Img {
  const out = new Img(SOURCE_CROP.w, VARIANT_HEIGHT * images.length);
  images.forEach((image, index) => out.paste(image, 0, index * VARIANT_HEIGHT, false));
  return out;
}

// Les fichiers `<prefix>_<famille>_32x32_<variante>.png` d'un dossier, groupés par famille.
function families(dir: string, pattern: RegExp): Map<number, { files: string[]; label?: string }> {
  const found = new Map<number, Array<{ variant: number; file: string; label?: string }>>();
  for (const name of readdirSync(dir)) {
    const match = pattern.exec(name);
    if (!match) continue;
    const family = Number(match[1]);
    const variant = Number(match[match.length - 1]);
    const label = match.length === 4 ? match[2] : undefined;
    const list = found.get(family) ?? [];
    list.push({ variant, file: join(dir, name), label });
    found.set(family, list);
  }
  return new Map(
    [...found.entries()]
      .sort(([a], [b]) => a - b)
      .map(([family, list]) => [family, { files: list.sort((a, b) => a.variant - b.variant).map((item) => item.file), label: list[0]!.label }]),
  );
}

export function buildCharacters(source: string): CharacterBuild {
  const root = join(source, CHARACTER_DIR);
  const files: CharacterBuild['files'] = [];
  const thumbs: Img[] = [];
  const addThumb = (image: Img): number => thumbs.push(image) - 1;

  const sheets = (dir: string, pattern: RegExp): Img[] =>
    readdirSync(dir)
      .filter((n) => pattern.test(n))
      .sort()
      .map((n) => cropSheet(join(dir, n)));

  const bodies = sheets(join(root, 'Bodies/32x32'), /^Body_32x32_\d+\.png$/);
  const eyes = sheets(join(root, 'Eyes/32x32'), /^Eyes_32x32_\d+\.png$/);
  const premade = sheets(join(root, '0_Premade_Characters/32x32'), /^Premade_Character_32x32_\d+\.png$/);
  files.push({ path: 'bodies.png', image: stack(bodies) });
  files.push({ path: 'eyes.png', image: stack(eyes) });
  files.push({ path: 'premade.png', image: stack(premade) });

  // Le personnage de base des imagettes : le premier corps, les premiers yeux.
  const base = new Img(SOURCE_CROP.w, VARIANT_HEIGHT);
  base.paste(bodies[0]!, 0, 0);
  base.paste(eyes[0]!, 0, 0);
  const layered = (...layers: Img[]): Img => {
    const out = new Img(SOURCE_CROP.w, VARIANT_HEIGHT);
    for (const layer of layers) out.paste(layer, 0, 0);
    return out;
  };

  const thumbBodies = addThumb(frameOf(layered(bodies[0]!, eyes[0]!), 0));
  for (const body of bodies.slice(1)) addThumb(frameOf(layered(body, eyes[0]!), 0));
  const thumbEyes = addThumb(frameOf(layered(bodies[0]!, eyes[0]!), 0));
  for (const pair of eyes.slice(1)) addThumb(frameOf(layered(bodies[0]!, pair), 0));
  const thumbPremade = addThumb(frameOf(premade[0]!, 0));
  for (const character of premade.slice(1)) addThumb(frameOf(character, 0));

  // Une famille de pièces : un fichier de variantes empilées, et une imagette par variante, vue sur `under` (ce qui vient en dessous).
  const folderOf = (dir: string, folder: string, pattern: RegExp, under: (outfit: Img) => Img[]): CharacterFamily[] => {
    const result: CharacterFamily[] = [];
    for (const [number, { files: paths, label }] of families(join(root, dir, '32x32'), pattern)) {
      const variants = paths.map(cropSheet);
      files.push({ path: `${folder}/${pad(number)}.png`, image: stack(variants) });
      const thumb = variants.map((variant) => addThumb(frameOf(layered(...under(variant), variant), 0)))[0]!;
      result.push({ number, variants: variants.length, thumb, ...(label === undefined ? {} : { label: ACCESSORY_LABELS[label] ?? label.replaceAll('_', ' ') }) });
    }
    return result;
  };

  // Les tenues se voient sur le personnage de base nu ; les coiffures et les accessoires, sur lui habillé de la première tenue.
  const outfits = folderOf('Outfits', 'outfits', /^Outfit_(\d+)_32x32_(\d+)\.png$/, () => [base]);
  const firstOutfit = cropSheet(join(root, 'Outfits/32x32', 'Outfit_01_32x32_01.png'));
  const dressed = () => [base, firstOutfit];
  const hair = folderOf('Hairstyles', 'hair', /^Hairstyle_(\d+)_32x32_(\d+)\.png$/, dressed);
  const accessories = folderOf('Accessories', 'accessories', /^Accessory_(\d+)_(.+)_32x32_(\d+)\.png$/, dressed);

  const rows = Math.ceil(thumbs.length / THUMB_COLUMNS);
  const sheet = new Img(THUMB_COLUMNS * 32, rows * 64);
  thumbs.forEach((thumb, index) => sheet.paste(thumb, (index % THUMB_COLUMNS) * 32, Math.floor(index / THUMB_COLUMNS) * 64, false));
  files.push({ path: 'thumbs.png', image: sheet });

  return {
    files,
    parts: {
      bodies: bodies.length,
      eyes: eyes.length,
      premade: premade.length,
      thumbs: { columns: THUMB_COLUMNS, bodies: thumbBodies, eyes: thumbEyes, premade: thumbPremade },
      outfits,
      hair,
      accessories,
    },
  };
}

export function renderCharactersSource(parts: CharacterParts): string {
  const family = (f: CharacterFamily) => `{ number: ${f.number}, variants: ${f.variants}, thumb: ${f.thumb}${f.label ? `, label: ${JSON.stringify(f.label)}` : ''} }`;
  return `// Généré par \`pnpm --filter @bureau/client gen:assets\` (apps/client/scripts/assets/characters.ts) : ne pas modifier à la main.
import type { CharacterParts } from './types';

export const CHARACTER_PARTS: CharacterParts = {
  bodies: ${parts.bodies},
  eyes: ${parts.eyes},
  premade: ${parts.premade},
  thumbs: { columns: ${parts.thumbs.columns}, bodies: ${parts.thumbs.bodies}, eyes: ${parts.thumbs.eyes}, premade: ${parts.thumbs.premade} },
  outfits: [${parts.outfits.map(family).join(', ')}],
  hair: [${parts.hair.map(family).join(', ')}],
  accessories: [${parts.accessories.map(family).join(', ')}],
};
`;
}
