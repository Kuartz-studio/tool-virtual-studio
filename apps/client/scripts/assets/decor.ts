// La banque d'éléments : découpe les entrées retenues (curation/) dans les planches du pack, range chaque catégorie dans un atlas
// (public/assets/decor/<catégorie>.png) et écrit la liste (packages/shared/src/decor/generated.ts) que lisent le client et le serveur.
import { join } from 'node:path';
import { DECOR_CATEGORIES, type DecorCategoryId, type DecorItem, type DecorKind } from '@bureau/shared';
import { BASEMENT_ENTRIES } from './curation/basement';
import { GYM_ENTRIES } from './curation/gym';
import { INTERIOR_ENTRIES } from './curation/interiors';
import { OFFICE_ENTRIES } from './curation/office';
import { SHEETS, type Entry } from './curation/types';
import { Img, readImage } from './image';
import { packImages } from './pack';
import { segmentSheet, type Component } from './segment';

export const ENTRIES: Entry[] = [...OFFICE_ENTRIES, ...INTERIOR_ENTRIES, ...GYM_ENTRIES, ...BASEMENT_ENTRIES];

type Rect = readonly [number, number, number, number];
export type ResolvedEntry = Entry & { rect: Rect };

// Un meuble arrête l'avatar s'il est gros, et se traverse s'il est petit : les petites plantes (même hautes), les petites tables, les
// imprimantes de bureau ne gênent pas la marche (les sièges non plus, et les objets posés sur un meuble ne comptent pas). Gros, c'est :
// - une plante qui prend au moins 2 cases au sol (un palmier, un ficus) ; une plante d'une seule case, même haute, se traverse ;
// - pour tout autre meuble, 2 cases au sol au moins, ou 3 cases d'image (largeur × hauteur) : un bureau, une table, une bibliothèque, un
//   frigo, une fontaine à eau.
// Une entrée de la curation peut toujours dire `solid` elle-même, pour un meuble qui sort de la règle (la cheminée, la borne tactile).
export const BIG_ITEM_TILES = 3;
export const BIG_FOOTPRINT_CELLS = 2;

// La taille de l'élément en cases : celle de son rectangle, ou de son découpage au pixel près (`crop`, multiple de 32 px) quand la curation en
// donne un. `fit` : le résultat de fitOnFootprint (largeur et profondeur au sol ramenées à ce que le dessin couvre).
export function cellsOf(entry: ResolvedEntry): readonly [number, number] {
  if (!entry.crop) return [entry.rect[2], entry.rect[3]];
  const [, , pw, ph] = entry.crop;
  if (pw % 32 !== 0 || ph % 32 !== 0) throw new Error(`« ${entry.name} » : le découpage ${pw} × ${ph} px n'est pas un nombre entier de cases.`);
  return [pw / 32, ph / 32];
}

// Le rectangle à découper dans la planche, en pixels.
export function pixelRect(entry: ResolvedEntry): readonly [number, number, number, number] {
  if (entry.crop) return entry.crop;
  const [tx, ty, tw, th] = entry.rect;
  return [tx * 32, ty * 32, tw * 32, th * 32];
}

export function defaultsOf(entry: ResolvedEntry, fit?: Pick<FittedSprite, 'w' | 'h'>): { kind: DecorKind; claim: number; solid: boolean } {
  const [cellsW, cellsH] = cellsOf(entry);
  const [w, h] = fit ? [fit.w, fit.h] : [cellsW, cellsH];
  const kind: DecorKind = entry.kind ?? (entry.cat === 'ecrans' || entry.cat === 'papeterie' ? 'onTop' : 'object');
  const claim = Math.min(entry.claim ?? (kind === 'wall' ? 0 : kind === 'floor' ? h : entry.cat === 'bureaux' ? h : 1), h);
  const wide = w * claim >= BIG_FOOTPRINT_CELLS;
  const big = entry.cat === 'plantes' ? wide : wide || w * h >= BIG_ITEM_TILES;
  const solid = entry.solid ?? (kind === 'object' && entry.cat !== 'sieges' && big);
  return { kind, claim, solid };
}

export function itemId(entry: ResolvedEntry): string {
  return `${entry.sheet}-${entry.rect[0]}-${entry.rect[1]}`;
}

export interface BuiltDecor {
  items: DecorItem[];
  atlases: Map<DecorCategoryId, Img>;
  sprites: Map<string, Img>;
}

// Les planches lues et découpées une fois.
export class Sheets {
  private readonly images = new Map<string, Img>();
  private readonly components = new Map<string, Component[]>();

  constructor(private readonly source: string) {}

  image(key: string): Img {
    let img = this.images.get(key);
    if (!img) {
      const rel = SHEETS[key];
      if (!rel) throw new Error(`Planche inconnue : « ${key} ».`);
      img = readImage(join(this.source, rel));
      this.images.set(key, img);
    }
    return img;
  }

  private componentsOf(key: string): Component[] {
    let found = this.components.get(key);
    if (!found) {
      found = segmentSheet(this.image(key));
      this.components.set(key, found);
    }
    return found;
  }

  // Le rectangle de l'entrée : le sien, ou celui de l'objet dont le coin haut-gauche est à `at` (le plus grand, s'il y en a plusieurs).
  resolve(entry: Entry): ResolvedEntry {
    if (entry.rect) return entry as ResolvedEntry;
    if (!entry.at) throw new Error(`« ${entry.name} » n'a ni rectangle ni case de départ.`);
    const [tx, ty] = entry.at;
    const found = this.componentsOf(entry.sheet)
      .filter((c) => c.tx === tx && c.ty === ty)
      .sort((a, b) => b.tw * b.th - a.tw * a.th)[0];
    if (!found) throw new Error(`« ${entry.name} » : aucun objet ne commence à la case ${tx}, ${ty} de la planche ${entry.sheet}.`);
    return { ...entry, rect: [found.tx, found.ty, found.tw, found.th] };
  }
}

// Les rectangles de la curation suivent les cases de la planche, pas les objets : un meuble de 1,4 case de haut dans un rectangle de
// 2 cases flotterait 20 px au-dessus de sa case, et une table de 3,75 cases dans un rectangle de 5 bloquerait 1,25 case de vide. À la
// génération, chaque meuble posé au sol est donc ramené sur sa case :
// - son dessin descend jusqu'au bas de son empreinte (quand il flotte d'au moins MIN_FLOAT_PX) ;
// - une table ou un bureau (catégorie `bureaux`) n'occupe que les colonnes qu'il couvre vraiment : sa largeur est arrondie à ce que le
//   dessin couvre, et le dessin est recentré. Cela ne fait que rétrécir : une déco enregistrée avant reste valable. (La profondeur au sol,
//   `claim`, reste celle de la curation : elle fixe où le bas du dessin se pose, et la changer déplacerait tout ce qui est déjà posé.)
export const MIN_FLOAT_PX = 4;

export interface FittedSprite {
  image: Img;
  w: number;
  h: number;
}

export function fitOnFootprint(image: Img, entry: ResolvedEntry, kind: DecorKind): FittedSprite {
  const [w, h] = cellsOf(entry);
  const box = image.contentBox();
  if (kind !== 'object' || !box) return { image, w, h };
  let fitted = image;
  const lift = h * 32 - box.bottom;
  if (lift >= MIN_FLOAT_PX) {
    fitted = new Img(image.width, image.height);
    fitted.paste(image, 0, lift, false);
  }
  if (entry.cat !== 'bureaux') return { image: fitted, w, h };
  const fitW = Math.max(1, Math.min(w, Math.ceil((box.right - box.left) / 32)));
  if (fitW < w) fitted = fitted.crop(Math.round((box.left + box.right) / 2 - fitW * 16), 0, fitW * 32, h * 32);
  return { image: fitted, w: fitW, h };
}

export function buildDecor(sheets: Sheets, entries: Entry[] = ENTRIES): BuiltDecor {
  const resolved = entries.map((entry) => sheets.resolve(entry));
  const sprites = new Map<string, Img>();
  const fits = new Map<string, FittedSprite>();
  for (const entry of resolved) {
    const id = itemId(entry);
    if (sprites.has(id)) throw new Error(`Deux éléments portent l'identifiant ${id} (« ${entry.name} »).`);
    const [px, py, pw, ph] = pixelRect(entry);
    const image = sheets.image(entry.sheet).crop(px, py, pw, ph);
    if (image.isEmpty()) throw new Error(`« ${entry.name} » (${id}) : le rectangle est vide.`);
    const fit = fitOnFootprint(image, entry, defaultsOf(entry).kind);
    fits.set(id, fit);
    sprites.set(id, fit.image);
  }

  const items: DecorItem[] = [];
  const atlases = new Map<DecorCategoryId, Img>();
  for (const { id: cat } of DECOR_CATEGORIES) {
    const inCat = resolved.filter((entry) => entry.cat === cat);
    if (inCat.length === 0) continue;
    const packed = packImages(inCat.map((entry) => ({ key: itemId(entry), image: sprites.get(itemId(entry))! })));
    atlases.set(cat, packed.atlas);
    for (const entry of inCat) {
      const frame = packed.frames.get(itemId(entry))!;
      const fit = fits.get(itemId(entry))!;
      const { kind, claim, solid } = defaultsOf(entry, fit);
      items.push({ id: itemId(entry), cat, name: entry.name, kind, w: fit.w, h: fit.h, claim, solid, fx: frame.x, fy: frame.y });
    }
  }
  return { items, atlases, sprites };
}

// Le fichier TypeScript généré : une ligne par élément, dans l'ordre des catégories puis des planches.
export function renderCatalogSource(items: DecorItem[]): string {
  const lines = items.map(
    (i) =>
      `  { id: ${JSON.stringify(i.id)}, cat: ${JSON.stringify(i.cat)}, name: ${JSON.stringify(i.name)}, kind: ${JSON.stringify(i.kind)}, w: ${i.w}, h: ${i.h}, claim: ${i.claim}, solid: ${i.solid}, fx: ${i.fx}, fy: ${i.fy} },`,
  );
  return `// Généré par \`pnpm --filter @bureau/client gen:assets\` (apps/client/scripts/assets) : ne pas modifier à la main.
import type { DecorItem } from './types';

export const DECOR_ITEMS: readonly DecorItem[] = [
${lines.join('\n')}
];
`;
}
